import { execFile } from 'node:child_process'
import { access, readFile } from 'node:fs/promises'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const appId = 'ai.tokenroll.toolbridgemobile.dev'
const apkPath = 'android/app/build/outputs/apk/debug/app-debug.apk'
const devServerUrl = process.env.EXPO_DEV_SERVER_URL ?? 'http://localhost:8081'
const devServerPort = new URL(devServerUrl).port || '80'
let displaySize
let density
const forbiddenPermissions = [
  'android.permission.ACCESS_BACKGROUND_LOCATION',
  'android.permission.RECEIVE_BOOT_COMPLETED',
  'android.permission.READ_APP_BADGE',
  'android.permission.READ_EXTERNAL_STORAGE',
  'android.permission.RECORD_AUDIO',
  'android.permission.SCHEDULE_EXACT_ALARM',
  'android.permission.SYSTEM_ALERT_WINDOW',
  'android.permission.USE_BIOMETRIC',
  'android.permission.USE_FINGERPRINT',
  'android.permission.WRITE_EXTERNAL_STORAGE',
  'com.google.android.c2dm.permission.RECEIVE',
  'com.sec.android.provider.badge.permission.READ',
  'com.sec.android.provider.badge.permission.WRITE',
]
const forbiddenRemoteNotificationComponents = [
  'expo.modules.notifications.service.ExpoFirebaseMessagingService',
  'com.google.firebase.iid.FirebaseInstanceIdReceiver',
  'com.google.firebase.messaging.FirebaseMessagingService',
  'com.google.firebase.provider.FirebaseInitProvider',
]

async function adb(...args) {
  const { stdout } = await execFileAsync('adb', args, { maxBuffer: 20 * 1024 * 1024 })
  return stdout
}

function delay(milliseconds) {
  return new Promise(resolve => { setTimeout(resolve, milliseconds) })
}

async function dumpUi() {
  await adb('shell', 'uiautomator', 'dump', '/sdcard/tool-bridge-window.xml')
  return adb('shell', 'cat', '/sdcard/tool-bridge-window.xml')
}

function nodeWithAttribute(source, attribute, predicate) {
  for (const match of source.matchAll(/<node\b[^>]*>/gu)) {
    const node = match[0]
    const value = new RegExp(`${attribute}="([^"]*)"`, 'u').exec(node)?.[1]
    if (value !== undefined && predicate(value)) return node
  }
  return null
}

function tapPoint(node) {
  const bounds = /bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/u.exec(node)
  if (bounds === null) throw new Error(`UI node 缺少 bounds: ${node}`)
  const [, left, top, right, bottom] = bounds.map(Number)
  if ([left, top, right, bottom].some(value => !Number.isFinite(value))) {
    throw new Error(`UI node bounds 无效: ${node}`)
  }
  return [Math.round((left + right) / 2), Math.round((top + bottom) / 2)]
}

function nodeHeightDp(node, density) {
  const bounds = /bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/u.exec(node)
  if (bounds === null) throw new Error(`UI node 缺少 bounds: ${node}`)
  const top = Number(bounds[2])
  const bottom = Number(bounds[4])
  return (bottom - top) / (density / 160)
}

function requireSelectedTab(source, accessibilityLabel) {
  const node = nodeWithAttribute(source, 'content-desc', value => value === accessibilityLabel)
  if (node === null) throw new Error(`找不到 tab 语义节点: ${accessibilityLabel}`)
  if (!node.includes('selected="true"')) throw new Error(`tab 未投影 selected=true: ${accessibilityLabel}`)
}

async function tapNode(node) {
  const [x, y] = tapPoint(node)
  await adb('shell', 'input', 'tap', String(x), String(y))
}

async function waitForUi(predicate, label, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs
  let lastDump = ''
  while (Date.now() < deadline) {
    try {
      lastDump = await dumpUi()
      if (predicate(lastDump)) return lastDump
    } catch {
      // Activity 切换或 bundle 加载期间 uiautomator 可短暂失败。
    }
    await delay(500)
  }
  throw new Error(`等待 UI 失败: ${label}\n${lastDump.slice(0, 2_000)}`)
}

function hasText(source, text) {
  return nodeWithAttribute(source, 'text', value => value === text) !== null
}

function describedNode(source, description) {
  return nodeWithAttribute(source, 'content-desc', value => (
    value === description || value.endsWith(`, ${description}`)
  ))
}

async function swipeContent(direction) {
  const [width, height] = displaySize
  const x = Math.round(width * 0.5)
  // 留出固定标题栏与底部 tab；不要在导航区域触发滑动。
  const start = Math.round(height * (direction === 'down' ? 0.72 : 0.35))
  const end = Math.round(height * (direction === 'down' ? 0.35 : 0.72))
  await adb('shell', 'input', 'swipe', String(x), String(start), String(x), String(end), '300')
  await delay(250)
}

async function findUi(predicate, label) {
  let source = await dumpUi()
  if (predicate(source)) return source
  // tab 保留滚动位置；先向下查找，再向上查找，不能假定当前位于顶部。
  for (const direction of ['down', 'up']) {
    for (let attempt = 0; attempt < 60; attempt += 1) {
      await swipeContent(direction)
      const next = await dumpUi()
      if (predicate(next)) return next
      if (next === source) break
      source = next
    }
  }
  throw new Error(`滚动后仍找不到 UI: ${label}\n${source.slice(0, 2_000)}`)
}

async function findDescription(description, minimumHeightDp = 0) {
  const source = await findUi(current => {
    const node = describedNode(current, description)
    return node !== null && nodeHeightDp(node, density) >= minimumHeightDp
  }, description)
  return describedNode(source, description)
}

async function tapByDescription(description) {
  const node = await findDescription(description, 48)
  if (node === null) throw new Error(`找不到 accessibility 节点: ${description}`)
  await tapNode(node)
}

async function openDevice() {
  await tapByDescription('设备标签页')
  const source = await waitForUi(current => describedNode(current, '设备标签页')?.includes('selected="true"') === true, '设备总览')
  requireSelectedTab(source, '设备标签页')
}

async function returnToDevice() {
  await tapByDescription('设备')
  const source = await waitForUi(current => describedNode(current, '设备标签页')?.includes('selected="true"') === true, '返回设备总览')
  requireSelectedTab(source, '设备标签页')
}

async function launchApp() {
  const deepLink = `toolbridgemobile-dev://expo-development-client/?url=${encodeURIComponent(devServerUrl)}`
  await adb(
    'shell',
    'am',
    'start',
    '-W',
    '-a',
    'android.intent.action.VIEW',
    '-d',
    deepLink,
    appId,
  )

  let source = await waitForUi(current => (
    hasText(current, 'Continue')
    || describedNode(current, '信箱标签页') !== null
  ), 'development client 或 App 首页')
  if (hasText(source, 'Continue')) {
    const continueNode = nodeWithAttribute(source, 'text', value => value === 'Continue')
    if (continueNode === null) throw new Error('development client Continue 节点消失')
    await tapNode(continueNode)
    source = await waitForUi(current => (
      nodeWithAttribute(current, 'content-desc', value => value === 'Close') !== null
    ), 'development client Close')
    const closeNode = nodeWithAttribute(source, 'content-desc', value => value === 'Close')
    if (closeNode === null) throw new Error('development client Close 节点消失')
    await tapNode(closeNode)
  }
  return waitForUi(current => describedNode(current, '信箱标签页') !== null, 'Tool Bridge Mobile 信箱首页')
}

async function ensureMetro() {
  try {
    const response = await fetch(`${devServerUrl}/status`, { signal: AbortSignal.timeout(2_000) })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
  } catch (error) {
    throw new Error(
      `development server 不可达: ${devServerUrl}；请先运行 pnpm start。${String(error)}`,
    )
  }
}

await access(apkPath)
await ensureMetro()
const devices = (await adb('devices')).split('\n').filter(line => /\tdevice$/u.test(line))
if (devices.length !== 1 || !devices[0]?.startsWith('emulator-')) {
  throw new Error(`需要且只允许一个已启动 Android emulator，当前: ${devices.join(', ')}`)
}
if ((await adb('shell', 'getprop', 'sys.boot_completed')).trim() !== '1') {
  throw new Error('Android emulator 尚未完成启动')
}

await adb('logcat', '-c')
await execFileAsync('adb', ['uninstall', appId]).catch(() => undefined)
await adb('install', apkPath)
await adb('reverse', `tcp:${devServerPort}`, `tcp:${devServerPort}`)

const sizeOutput = await adb('shell', 'wm', 'size')
const sizeMatch = /Override size: (\d+)x(\d+)/u.exec(sizeOutput)
  ?? /Physical size: (\d+)x(\d+)/u.exec(sizeOutput)
if (sizeMatch === null) throw new Error(`无法读取 emulator size: ${sizeOutput}`)
displaySize = [Number(sizeMatch[1]), Number(sizeMatch[2])]
const densityOutput = await adb('shell', 'wm', 'density')
const densityMatch = /Override density: (\d+)/u.exec(densityOutput)
  ?? /Physical density: (\d+)/u.exec(densityOutput)
if (densityMatch === null) throw new Error(`无法读取 emulator density: ${densityOutput}`)
density = Number(densityMatch[1])

// 与发布 gate 使用同一版本事实入口；不把某次历史 APK 版本固定在 smoke 中。
const appConfig = await readFile(new URL('../app.config.ts', import.meta.url), 'utf8')
const appVersion = /export const APP_VERSION = '([^']+)'/u.exec(appConfig)?.[1]
const versionCode = /export const ANDROID_VERSION_CODE = (\d+)/u.exec(appConfig)?.[1]
if (appVersion === undefined || versionCode === undefined) throw new Error('无法从 app.config.ts 读取发布版本')
const packageInfo = await adb('shell', 'dumpsys', 'package', appId)
for (const expected of [`versionCode=${versionCode} minSdk=24 targetSdk=36`, `versionName=${appVersion}`]) {
  if (!packageInfo.includes(expected)) throw new Error(`安装包信息缺少: ${expected}`)
}
for (const forbidden of forbiddenPermissions) {
  if (packageInfo.includes(forbidden)) throw new Error(`最终安装包不得声明 ${forbidden}`)
}
for (const forbidden of forbiddenRemoteNotificationComponents) {
  if (packageInfo.includes(forbidden)) throw new Error(`local-only App 不得注册 ${forbidden}`)
}
for (const expected of [
  'android.permission.ACCESS_COARSE_LOCATION',
  'android.permission.ACCESS_FINE_LOCATION',
  'android.permission.POST_NOTIFICATIONS',
  'android.permission.VIBRATE',
]) {
  if (!packageInfo.includes(expected)) throw new Error(`最终安装包缺少 ${expected}`)
}

let source = await launchApp()
for (const tabLabel of ['信箱标签页', '活动标签页', '设备标签页']) {
  if (describedNode(source, tabLabel) === null) throw new Error(`首页缺少唯一 tab accessibility label: ${tabLabel}`)
}
requireSelectedTab(source, '信箱标签页')
await findUi(current => hasText(current, '最近还没有 Agent 来信。'), 'fresh install 信箱空态')

await openDevice()
await tapByDescription('连接配置')
await waitForUi(current => hasText(current, '连接配置'), '连接配置页面')
await findDescription('Tool Bridge API key', 48)
await returnToDevice()
await tapByDescription('授权与安全')
await waitForUi(current => hasText(current, '授权与安全'), '授权与安全页面')
await findDescription('每次确认（当前）', 48)
await findDescription('启用本地通知', 48)
await returnToDevice()
await tapByDescription('运行详情')
await waitForUi(current => hasText(current, '设备状态'), '运行详情页面')
await findUi(current => describedNode(current, '控制模式：每次确认') !== null, '默认控制模式')
await findUi(current => describedNode(current, '连接：unconfigured') !== null, '未配置网关的连接状态')
await returnToDevice()

await tapByDescription('设备能力')
await waitForUi(current => hasText(current, '能力'), '能力页面')
for (const capability of [
  'phone/apps.can_open_url',
  'phone/location.current',
  'phone/location.open_map',
  'phone/productivity.notify',
  'phone/productivity.timer_start',
  'phone/productivity.timer_cancel',
  'phone/productivity.timer_status',
]) {
  await findUi(current => hasText(current, capability), `能力 ${capability}`)
  if (capability === 'phone/location.current') {
    await findUi(current => current.includes('permission_required: foreground_location_permission_required'), '未授权位置能力的 permission_required')
  }
  if (capability === 'phone/productivity.notify') {
    await findUi(current => current.includes('unavailable: notification_permission_requestable'), 'fresh install 通知仅本地可请求')
  }
}
await returnToDevice()

await tapByDescription('紧急停用远程能力')
await findUi(current => hasText(current, '新命令当前均被拒绝。恢复后，仍需在本机逐次确认。'), '紧急停用状态')
await findDescription('恢复为每次确认', 48)
await adb('shell', 'am', 'force-stop', appId)
source = await launchApp()
requireSelectedTab(source, '信箱标签页')
await openDevice()
await findUi(current => hasText(current, '远程能力已停用'), '重启后保留 disabled 模式')
await tapByDescription('恢复为每次确认')
await tapByDescription('授权与安全')
await findDescription('每次确认（当前）', 48)
await returnToDevice()

await tapByDescription('活动标签页')
source = await waitForUi(current => describedNode(current, '活动标签页')?.includes('selected="true"') === true, '活动页面')
requireSelectedTab(source, '活动标签页')
await findUi(current => hasText(current, '暂无远程调用记录。'), '本地活动空态')
await findUi(current => current.includes('显示最近 100 条，本机最多保留 5,000 条；不展示参数、正文或结果载荷。'), '本地活动历史范围')
await tapByDescription('清除本机活动历史')
await findUi(current => hasText(current, '确认清除当前活动历史？'), '活动历史确认标题')
await findUi(current => current.includes('不会清除防重放记录、计时器、设置、installation identity 或凭证'), '活动清除保留对象')
await tapByDescription('取消清除活动历史')
await tapByDescription('清除本机活动历史')
await findUi(current => hasText(current, '确认清除当前活动历史？'), '再次确认清除活动历史')
await tapByDescription('确认清除活动历史')
await findUi(current => hasText(current, '已清除 0 条本机活动历史；后续调用会继续记录。'), '清除空活动历史的真实结果')

const fontScaleSource = (await adb('shell', 'settings', 'get', 'system', 'font_scale')).trim()
const originalFontScale = /^\d+(?:\.\d+)?$/u.test(fontScaleSource) ? fontScaleSource : '1.0'
await adb('shell', 'settings', 'put', 'system', 'font_scale', '2.0')
try {
  await adb('shell', 'am', 'force-stop', appId)
  source = await launchApp()
  requireSelectedTab(source, '信箱标签页')
  await openDevice()
  await tapByDescription('媒体会话')
  await findUi(current => hasText(current, '暂无 App 自有媒体会话。'), '200% 字号媒体空态')
  await returnToDevice()

  await tapByDescription('活动标签页')
  source = await waitForUi(current => describedNode(current, '活动标签页')?.includes('selected="true"') === true, '200% 字号活动页面')
  requireSelectedTab(source, '活动标签页')
  await tapByDescription('清除本机活动历史')
  // 分别滚动到每个 action 并核对 48dp，不要求放大字号后仍处于同一屏。
  for (const actionLabel of ['取消清除活动历史', '确认清除活动历史']) {
    await findDescription(actionLabel, 48)
  }
  await tapByDescription('取消清除活动历史')
  await tapByDescription('清除本机活动历史')
  await tapByDescription('确认清除活动历史')
  await findUi(current => hasText(current, '已清除 0 条本机活动历史；后续调用会继续记录。'), '200% 字号确认清除结果')

  await openDevice()
  await tapByDescription('设备能力')
  await findUi(current => hasText(current, 'phone/apps.can_open_url'), '200% 字号能力列表可达')
  await returnToDevice()
  await tapByDescription('运行详情')
  await findUi(current => describedNode(current, '控制模式：每次确认') !== null, '200% 字号运行状态可读')
  await returnToDevice()
  await tapByDescription('连接配置')
  await findDescription('Tool Bridge API key', 48)
  await returnToDevice()
  await tapByDescription('授权与安全')
  await findDescription('每次确认（当前）', 48)
  await findDescription('允许后台运行', 48)
  await returnToDevice()
} finally {
  await adb('shell', 'settings', 'put', 'system', 'font_scale', originalFontScale)
  await adb('shell', 'am', 'force-stop', appId)
  await launchApp()
}

const logcat = await adb('logcat', '-d', '-t', '1200')
if (/FATAL EXCEPTION:[\s\S]*ai\.tokenroll\.toolbridgemobile\.dev/u.test(logcat)) {
  throw new Error('Android smoke 期间发生 App FATAL EXCEPTION')
}

console.log('Android emulator smoke 通过：安装/启动、local-only 通知与 timer 边界、动态能力、紧急停用持久化、活动历史清除确认及 200% 字号语义交互。')

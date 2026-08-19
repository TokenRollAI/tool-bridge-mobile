import { execFile } from 'node:child_process'
import { access } from 'node:fs/promises'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const appId = 'ai.tokenroll.toolbridgemobile.dev'
const apkPath = 'android/app/build/outputs/apk/debug/app-debug.apk'
const devServerUrl = process.env.EXPO_DEV_SERVER_URL ?? 'http://localhost:8081'
const devServerPort = new URL(devServerUrl).port || '80'
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

async function tapByDescription(description) {
  const source = await dumpUi()
  const node = nodeWithAttribute(source, 'content-desc', value => (
    value === description || value.endsWith(`, ${description}`)
  ))
  if (node === null) throw new Error(`找不到 accessibility 节点: ${description}`)
  await tapNode(node)
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
    || hasText(current, '设备裁决优先')
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
  return waitForUi(current => hasText(current, '设备裁决优先'), 'Tool Bridge Mobile 首页')
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

const packageInfo = await adb('shell', 'dumpsys', 'package', appId)
for (const expected of ['versionCode=2 minSdk=24 targetSdk=36', 'versionName=0.0.2']) {
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
for (const expected of ['ready', 'unconfigured', 'ask_every_time']) {
  if (!hasText(source, expected)) throw new Error(`首页缺少运行时状态: ${expected}`)
}
for (const tabLabel of ['状态标签页', '能力标签页', '媒体标签页', '活动标签页']) {
  if (nodeWithAttribute(source, 'content-desc', value => value === tabLabel) === null) {
    throw new Error(`首页缺少唯一 tab accessibility label: ${tabLabel}`)
  }
}
requireSelectedTab(source, '状态标签页')

await tapByDescription('能力标签页')
source = await waitForUi(current => hasText(current, 'phone/apps.can_open_url'), '能力页')
requireSelectedTab(source, '能力标签页')
for (let attempt = 0; attempt < 24 && !hasText(source, 'phone/location.current'); attempt += 1) {
  await adb('shell', 'input', 'swipe', '540', '1750', '540', '1150', '250')
  await delay(200)
  source = await dumpUi()
}
if (!hasText(source, 'phone/location.current')) {
  throw new Error('能力页未显示 phone/location.current')
}
for (
  let attempt = 0;
  attempt < 6 && !source.includes('permission_required: foreground_location_permission_required');
  attempt += 1
) {
  await adb('shell', 'input', 'swipe', '540', '1750', '540', '1250', '250')
  await delay(200)
  source = await dumpUi()
}
if (!source.includes('permission_required: foreground_location_permission_required')) {
  throw new Error('未授权位置能力没有显示 permission_required')
}
for (let attempt = 0; attempt < 16 && !hasText(source, 'phone/location.open_map'); attempt += 1) {
  await adb('shell', 'input', 'swipe', '540', '1600', '540', '1350', '200')
  await delay(200)
  source = await dumpUi()
}
if (!hasText(source, 'phone/location.open_map')) {
  throw new Error('能力页未显示 phone/location.open_map')
}
for (
  let attempt = 0;
  attempt < 24 && !hasText(source, 'phone/productivity.notify');
  attempt += 1
) {
  await adb('shell', 'input', 'swipe', '540', '1650', '540', '1200', '200')
  await delay(200)
  source = await dumpUi()
}
if (!hasText(source, 'phone/productivity.notify')) {
  throw new Error('能力页未显示 phone/productivity.notify')
}
for (
  let attempt = 0;
  attempt < 8 && !source.includes('unavailable: notification_permission_requestable');
  attempt += 1
) {
  await adb('shell', 'input', 'swipe', '540', '1650', '540', '1350', '200')
  await delay(200)
  source = await dumpUi()
}
if (!source.includes('unavailable: notification_permission_requestable')) {
  throw new Error('fresh install 的通知能力没有显示未授权且仅本地可请求')
}
for (const timerCapability of [
  'phone/productivity.timer_start',
  'phone/productivity.timer_cancel',
  'phone/productivity.timer_status',
]) {
  for (let attempt = 0; attempt < 12 && !hasText(source, timerCapability); attempt += 1) {
    await adb('shell', 'input', 'swipe', '540', '1650', '540', '1250', '200')
    await delay(200)
    source = await dumpUi()
  }
  if (!hasText(source, timerCapability)) {
    throw new Error(`能力页未显示 ${timerCapability}`)
  }
}

await tapByDescription('状态标签页')
await waitForUi(current => hasText(current, '设备裁决优先'), '返回状态页')
await tapByDescription('紧急停用远程能力')
await waitForUi(current => (
  hasText(current, 'disabled') && hasText(current, '恢复为每次确认')
), '紧急停用状态')
await adb('shell', 'am', 'force-stop', appId)
source = await launchApp()
if (!hasText(source, 'disabled') || !hasText(source, '恢复为每次确认')) {
  throw new Error('紧急停用状态未在进程重启后恢复')
}
await tapByDescription('恢复为每次确认')
await waitForUi(current => hasText(current, 'ask_every_time'), '恢复控制模式')

await tapByDescription('活动标签页')
source = await waitForUi(current => (
  hasText(current, '暂无远程调用记录。')
  && current.includes('最近 100 条调用元数据')
  && current.includes('最多保留 5,000 条')
), '本地活动历史范围')
await tapByDescription('清除本机活动历史')
source = await waitForUi(current => (
  hasText(current, '确认清除当前活动历史？')
  && current.includes('不会清除防重放记录、计时器、设置、installation identity 或凭证')
), '活动历史 destructive confirmation')
await tapByDescription('取消清除活动历史')
await waitForUi(current => (
  nodeWithAttribute(current, 'content-desc', value => value === '清除本机活动历史') !== null
), '取消清除活动历史')
await tapByDescription('清除本机活动历史')
await waitForUi(current => hasText(current, '确认清除当前活动历史？'), '再次确认清除活动历史')
await tapByDescription('确认清除活动历史')
await waitForUi(current => (
  hasText(current, '已清除 0 条本机活动历史；后续调用会继续记录。')
), '清除空活动历史的真实结果')

const fontScaleSource = (await adb('shell', 'settings', 'get', 'system', 'font_scale')).trim()
const originalFontScale = /^\d+(?:\.\d+)?$/u.test(fontScaleSource) ? fontScaleSource : '1.0'
const densityOutput = await adb('shell', 'wm', 'density')
const densityMatch = /Override density: (\d+)/u.exec(densityOutput)
  ?? /Physical density: (\d+)/u.exec(densityOutput)
if (densityMatch === null) throw new Error(`无法读取 emulator density: ${densityOutput}`)
const density = Number(densityMatch[1])

await adb('shell', 'settings', 'put', 'system', 'font_scale', '2.0')
try {
  await adb('shell', 'am', 'force-stop', appId)
  source = await launchApp()
  requireSelectedTab(source, '状态标签页')

  await tapByDescription('媒体标签页')
  source = await waitForUi(current => hasText(current, '暂无 App 自有媒体会话。'), '200% 字号媒体页')
  requireSelectedTab(source, '媒体标签页')

  await tapByDescription('活动标签页')
  source = await waitForUi(current => (
    nodeWithAttribute(current, 'content-desc', value => value === '清除本机活动历史') !== null
  ), '200% 字号活动页')
  requireSelectedTab(source, '活动标签页')
  const clearNode = nodeWithAttribute(source, 'content-desc', value => value === '清除本机活动历史')
  if (clearNode === null || nodeHeightDp(clearNode, density) < 48) {
    throw new Error(`200% 字号清除按钮不足 48dp: ${clearNode ?? 'missing'}`)
  }
  await tapNode(clearNode)
  source = await waitForUi(current => (
    nodeWithAttribute(current, 'content-desc', value => value === '取消清除活动历史') !== null
    && nodeWithAttribute(current, 'content-desc', value => value === '确认清除活动历史') !== null
  ), '200% 字号 destructive confirmation controls')
  for (const actionLabel of ['取消清除活动历史', '确认清除活动历史']) {
    const actionNode = nodeWithAttribute(source, 'content-desc', value => value === actionLabel)
    if (actionNode === null || nodeHeightDp(actionNode, density) < 48) {
      throw new Error(`200% 字号操作不足 48dp: ${actionLabel}`)
    }
  }
  await tapByDescription('取消清除活动历史')

  await tapByDescription('能力标签页')
  source = await waitForUi(current => hasText(current, 'phone/apps.can_open_url'), '200% 字号能力页')
  requireSelectedTab(source, '能力标签页')

  await tapByDescription('状态标签页')
  source = await waitForUi(current => hasText(current, '设备裁决优先'), '200% 字号状态页')
  requireSelectedTab(source, '状态标签页')
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

import { readFile } from 'node:fs/promises'

const packageRoot = new URL('../node_modules/@tool-bridge/sdk/', import.meta.url)
const packageJson = JSON.parse(await readFile(new URL('package.json', packageRoot), 'utf8'))

if (packageJson.version !== '0.20.1') {
  throw new Error(`@tool-bridge/sdk 必须精确锁定 0.20.1，当前为 ${packageJson.version}`)
}
const deviceExport = packageJson.exports?.['./device']
if (
  deviceExport?.types !== './dist/device.d.ts'
  || deviceExport?.['react-native'] !== './dist/device.js'
  || deviceExport?.import !== './dist/device.js'
) {
  throw new Error('@tool-bridge/sdk/device 的 types/react-native/import export 不符合已验收契约')
}

function moduleSpecifiers(source) {
  const specifiers = new Set()
  const patterns = [
    /\bimport\s+(?:type\s+)?(?:[^;"']+?\s+from\s+)?(["'])([^"']+)\1/g,
    /\bexport\s+(?:type\s+)?(?:\*[^;"']*|\{[^}]*\})\s+from\s+(["'])([^"']+)\1/g,
    /\bimport\s*\(\s*(["'])([^"']+)\1\s*\)/g,
  ]
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) specifiers.add(match[2])
  }
  return [...specifiers]
}

function assertInsidePackage(url) {
  if (!url.href.startsWith(packageRoot.href)) {
    throw new Error(`device 子入口的相对 import 越出 SDK package: ${url.href}`)
  }
}

async function readJavaScriptGraph(entryUrl) {
  const sources = new Map()
  const externalImports = new Set()
  const pending = [entryUrl]

  while (pending.length > 0) {
    const url = pending.pop()
    if (sources.has(url.href)) continue
    assertInsidePackage(url)

    const source = await readFile(url, 'utf8')
    sources.set(url.href, source)
    for (const specifier of moduleSpecifiers(source)) {
      if (specifier.startsWith('./') || specifier.startsWith('../')) {
        const importedUrl = new URL(specifier, url)
        assertInsidePackage(importedUrl)
        if (!sources.has(importedUrl.href)) pending.push(importedUrl)
      } else {
        externalImports.add(specifier)
      }
    }
  }

  return { externalImports: [...externalImports].sort(), sources }
}

function declarationUrl(specifier, parentUrl) {
  const url = new URL(specifier, parentUrl)
  if (url.pathname.endsWith('.js')) url.pathname = `${url.pathname.slice(0, -3)}.d.ts`
  else if (url.pathname.endsWith('.mjs')) url.pathname = `${url.pathname.slice(0, -4)}.d.mts`
  else if (url.pathname.endsWith('.cjs')) url.pathname = `${url.pathname.slice(0, -4)}.d.cts`
  return url
}

async function readDeclarationGraph(entryUrl) {
  const sources = new Map()
  const pending = [entryUrl]

  while (pending.length > 0) {
    const url = pending.pop()
    if (sources.has(url.href)) continue
    assertInsidePackage(url)

    const source = await readFile(url, 'utf8')
    sources.set(url.href, source)
    for (const specifier of moduleSpecifiers(source)) {
      if (!specifier.startsWith('./') && !specifier.startsWith('../')) continue
      const importedUrl = declarationUrl(specifier, url)
      assertInsidePackage(importedUrl)
      if (!sources.has(importedUrl.href)) pending.push(importedUrl)
    }
  }

  return sources
}

const deviceJavaScriptUrl = new URL('dist/device.js', packageRoot)
const { externalImports, sources: javaScriptSources } = await readJavaScriptGraph(deviceJavaScriptUrl)
if (JSON.stringify(externalImports) !== JSON.stringify(['partysocket/ws'])) {
  throw new Error(`device 子入口递归 import 图出现未验收的外部 import: ${externalImports.join(', ')}`)
}
for (const [url, source] of javaScriptSources) {
  if (/\bprocess\s*\.\s*env\b/.test(source) || /\brequire\s*\(\s*["']ws["']\s*\)/.test(source)) {
    throw new Error(`device 子入口递归 import 图泄漏了 Node ws/process.env: ${url}`)
  }
}

const deviceTypesUrl = new URL('dist/device.d.ts', packageRoot)
const declarationSources = await readDeclarationGraph(deviceTypesUrl)
const deviceTypes = declarationSources.get(deviceTypesUrl.href)
const declarationGraph = [...declarationSources.values()].join('\n')
if (
  !/type\s+DeviceCallHandler\s*=\s*\(call:\s*\{[\s\S]*?uploadObject\(options:\s*CallUploadObjectOptions\):\s*Promise<StoreObjectDescriptor>;[\s\S]*?\}\)\s*=>/.test(deviceTypes)
  || !/type\s+CallUploadObjectOptions\s*=\s*UploadObjectInput;/.test(deviceTypes)
  || !/export\s*\{[^}]*\btype\s+CallUploadObjectOptions\b[^}]*\};/.test(deviceTypes)
  || !/export\s*\{[^}]*\bStoreObjectDescriptor\b[^}]*\};/.test(deviceTypes)
  || !/type\s+StoreUri\s*=\s*`store:\/\/default\/\$\{string\}`;/.test(declarationGraph)
  || !/interface\s+StoreObjectDescriptor\s*\{[\s\S]*?\buri:\s*StoreUri;[\s\S]*?\}/.test(declarationGraph)
) {
  throw new Error('@tool-bridge/sdk/device 缺少已验收的 call-scoped uploadObject/StoreObjectDescriptor 类型契约')
}
if (
  !/interface\s+DeviceNodeCmd\s*\{[\s\S]*?\bdelivery\?:\s*DeviceCommandDelivery;[\s\S]*?\}/.test(declarationGraph)
  || !/type\s+DeviceCommandDelivery\s*=\s*'realtime'\s*\|\s*'mailbox'\s*\|\s*'both';/.test(declarationGraph)
  || !/interface\s+DeviceOperationJournal\s*\{[\s\S]*?get\(operationId:\s*string\):\s*Promise<DeviceOperationJournalEntry\s*\|\s*null>;[\s\S]*?put\(entry:\s*DeviceOperationJournalEntry\):\s*Promise<void>;[\s\S]*?remove\(operationId:\s*string\):\s*Promise<void>;[\s\S]*?\}/.test(deviceTypes)
  || !/declare\s+function\s+createDeviceMailboxProcessor\(opts:\s*DeviceMailboxProcessorOptions\):\s*DeviceMailboxProcessor;/.test(deviceTypes)
  || !/export\s*\{[^}]*\bcreateDeviceMailboxProcessor\b[^}]*\};/.test(deviceTypes)
  || !/export\s*\{[^}]*\btype\s+DeviceOperationJournal\b[^}]*\};/.test(deviceTypes)
) {
  throw new Error('@tool-bridge/sdk/device 缺少已验收的 mailbox processor/journal/delivery 类型契约')
}
if (/\buploadContextObject\b/.test(deviceTypes)) {
  throw new Error('@tool-bridge/sdk/device 仍暴露旧 uploadContextObject 类型契约')
}

console.log('@tool-bridge/sdk/device@0.20.1 入口验证通过：递归 RN import 图仅依赖 partysocket/ws，call-scoped uploadObject/Store URI 与 mailbox processor/journal/delivery 类型存在，无旧 uploadContextObject 或 Node ws/process.env 泄漏。')

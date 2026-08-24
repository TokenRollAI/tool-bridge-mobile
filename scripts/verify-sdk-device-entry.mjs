import { readFile } from 'node:fs/promises'

const packageRoot = new URL('../node_modules/@tool-bridge/sdk/', import.meta.url)
const packageJson = JSON.parse(await readFile(new URL('package.json', packageRoot), 'utf8'))

if (packageJson.version !== '0.15.0') {
  throw new Error(`@tool-bridge/sdk 必须精确锁定 0.15.0，当前为 ${packageJson.version}`)
}
const deviceExport = packageJson.exports?.['./device']
if (
  deviceExport?.types !== './dist/device.d.ts'
  || deviceExport?.['react-native'] !== './dist/device.js'
  || deviceExport?.import !== './dist/device.js'
) {
  throw new Error('@tool-bridge/sdk/device 的 types/react-native/import export 不符合已验收契约')
}

const deviceBundle = await readFile(new URL('dist/device.js', packageRoot), 'utf8')
const externalImports = [...deviceBundle.matchAll(/\bfrom\s+["']([^"']+)["']/g)]
  .map(match => match[1])
if (JSON.stringify(externalImports) !== JSON.stringify(['partysocket/ws'])) {
  throw new Error(`device 子入口出现未验收的外部 import: ${externalImports.join(', ')}`)
}
if (/\bprocess\.env\b/.test(deviceBundle) || /\bfrom\s+["']ws["']/.test(deviceBundle)) {
  throw new Error('device 子入口泄漏了 Node process.env 或 ws 根依赖')
}

const deviceTypes = await readFile(new URL('dist/device.d.ts', packageRoot), 'utf8')
if (
  !deviceTypes.includes('declare function uploadContextObject(')
  || !deviceTypes.includes('body: NonNullable<RequestInit[\'body\']>')
  || !deviceTypes.includes('uri: string;')
) {
  throw new Error('@tool-bridge/sdk/device 缺少已验收的 uploadContextObject 类型契约')
}

console.log('@tool-bridge/sdk/device@0.15.0 入口验证通过：独立 RN export、对象直传类型存在，无 Node ws/process.env 泄漏。')

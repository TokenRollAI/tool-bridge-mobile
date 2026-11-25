import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

const probe = String.raw`
import { createRequire } from 'node:module'
import imageSize from 'image-size'

const require = createRequire(import.meta.url)
const queryStringPath = require.resolve('query-string', {
  paths: [require.resolve('expo-router/package.json')],
})
const decodeUriComponent = require(require.resolve('decode-uri-component', { paths: [queryStringPath] }))

function mustReject(label, input) {
  try {
    imageSize(input)
    throw new Error(label + ' unexpectedly parsed')
  } catch (error) {
    if (error instanceof Error && error.message.endsWith('unexpectedly parsed')) throw error
  }
}

const icns = Buffer.alloc(16)
icns.write('icns', 0, 'ascii')
icns.writeUInt32BE(16, 4)
icns.write('icp4', 8, 'ascii')
icns.writeUInt32BE(0, 12)
mustReject('zero-length ICNS entry', icns)

const jxl = Buffer.alloc(36)
jxl.writeUInt32BE(12, 0)
jxl.write('JXL ', 4, 'ascii')
jxl.writeUInt32BE(16, 12)
jxl.write('ftyp', 16, 'ascii')
jxl.write('jxl ', 20, 'ascii')
jxl.writeUInt32BE(0, 28)
jxl.write('jxlp', 32, 'ascii')
mustReject('zero-length JXL partial box', jxl)

let uriPayload = ''
for (let i = 0; i < 32_000; i += 1) {
  const high = Math.floor(i / 256).toString(16).padStart(2, '0')
  const low = (i % 256).toString(16).padStart(2, '0')
  uriPayload += '%' + high + '%' + low + 'x'
}
uriPayload += '%zz'
const startedAt = performance.now()
const decoded = decodeUriComponent(uriPayload)
if (!decoded.endsWith('%zz') || performance.now() - startedAt > 500) {
  throw new Error('decode-uri-component linear fallback regression')
}
`

await execFileAsync(
  process.execPath,
  ['--input-type=module', '--eval', probe],
  { timeout: 2_000 },
)

console.log('依赖缓解验证通过：恶意 ICNS/JXL 零长结构与超长畸形百分号编码均在有限时间内安全处理。')

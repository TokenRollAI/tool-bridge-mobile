import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { extname } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const forbiddenNames = [
  /(^|\/)AuthKey_[^/]+\.p8$/,
  /(^|\/)GoogleService-Info\.plist$/,
  /(^|\/)google-services\.json$/,
  /\.(jks|keystore|mobileprovision|p12|pfx)$/,
]
const textExtensions = new Set([
  '', '.cjs', '.css', '.env', '.example', '.js', '.json', '.jsx', '.md', '.mjs',
  '.ts', '.tsx', '.txt', '.yaml', '.yml',
])
const secretPatterns = [
  /-----BEGIN (?:EC |OPENSSH |RSA )?PRIVATE KEY-----/,
  /\b(?:sk|tb_sk)_[A-Za-z0-9_-]{24,}\b/,
]

const { stdout } = await execFileAsync(
  'git',
  ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
  { encoding: 'buffer' },
)
const trackedFiles = stdout.toString('utf8').split('\0').filter(Boolean)
const failures = []

for (const file of trackedFiles) {
  if (forbiddenNames.some(pattern => pattern.test(file))) {
    failures.push(`${file}: 禁止提交签名材料或服务配置`)
    continue
  }
  if (file === 'scripts/verify-secrets.mjs' || !textExtensions.has(extname(file))) continue
  const source = await readFile(file, 'utf8')
  if (secretPatterns.some(pattern => pattern.test(source))) {
    failures.push(`${file}: 疑似包含私钥或 Tool Bridge 凭证`)
  }
}

if (failures.length > 0) {
  console.error(failures.join('\n'))
  process.exitCode = 1
} else {
  console.log(`敏感文件验证通过：已检查 ${trackedFiles.length} 个受版本控制文件。`)
}

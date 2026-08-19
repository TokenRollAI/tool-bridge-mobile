import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

const allowedLicenses = new Set([
  '(BSD-3-Clause OR GPL-2.0)',
  '(MIT OR Apache-2.0)',
  '(MIT OR CC0-1.0)',
  '0BSD',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'BlueOak-1.0.0',
  'CC-BY-4.0',
  'ISC',
  'MIT',
  'MIT AND Apache-2.0',
  'MPL-2.0',
  'Python-2.0',
  'Unlicense',
])

const { stdout } = await execFileAsync(
  'pnpm',
  ['licenses', 'list', '--prod', '--json'],
  { maxBuffer: 20 * 1024 * 1024 },
)
const licenses = JSON.parse(stdout)
const unknownLicenses = Object.keys(licenses).filter(license => !allowedLicenses.has(license))
if (unknownLicenses.length > 0) {
  throw new Error(`发现未评审许可证: ${unknownLicenses.join(', ')}`)
}

console.log(`许可证验证通过：${Object.keys(licenses).length} 种表达式均在已评审清单内。`)

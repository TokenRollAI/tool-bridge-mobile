import { access, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
const appConfig = await readFile(join(root, 'app.config.ts'), 'utf8')

const semverPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/
if (typeof packageJson.version !== 'string' || !semverPattern.test(packageJson.version)) {
  throw new Error('package.json version 必须是无前缀的稳定 SemVer x.y.z')
}

const escapedVersion = packageJson.version.replaceAll('.', '\\.')
if (!new RegExp(`export const APP_VERSION = '${escapedVersion}'`).test(appConfig)) {
  throw new Error('app.config.ts APP_VERSION 必须与 package.json version 完全一致')
}

const expectedTag = `v${packageJson.version}`
const releaseNotes = join(root, 'docs', 'releases', `${expectedTag}.md`)
await access(releaseNotes)

// 普通 branch / pull_request workflow 也会设置 GITHUB_REF_NAME；只有 release
// workflow 显式传入的第一个参数才代表待发布 tag。
const requestedTag = process.argv[2]
if (requestedTag !== undefined && requestedTag !== expectedTag) {
  throw new Error(`Release tag 必须与 App 版本一致：期望 ${expectedTag}，收到 ${requestedTag}`)
}

console.log(`Release metadata 验证通过：App ${packageJson.version}，tag ${expectedTag}，发布说明存在。`)

import { readFile } from 'node:fs/promises'
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
const changelog = await readFile(join(root, 'CHANGELOG.md'), 'utf8')
const changelogHeadingPattern = /^## \[((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))\] - (\d{4}-\d{2}-\d{2})$/gm
const latestHeading = changelogHeadingPattern.exec(changelog)

if (latestHeading === null) {
  throw new Error('CHANGELOG.md 必须以“## [x.y.z] - YYYY-MM-DD”记录最新版本')
}

const [, changelogVersion, changelogDate] = latestHeading
const bodyStart = latestHeading.index + latestHeading[0].length
const nextHeading = changelogHeadingPattern.exec(changelog)
const changelogBody = changelog.slice(bodyStart, nextHeading?.index ?? changelog.length).trim()
if (changelogVersion !== packageJson.version) {
  throw new Error(`CHANGELOG.md 最新版本必须与 App 版本一致：期望 ${packageJson.version}，收到 ${changelogVersion}`)
}

if (changelogBody.trim().length === 0) {
  throw new Error(`CHANGELOG.md 的 ${expectedTag} 版本段不能为空`)
}

// 普通 branch / pull_request workflow 也会设置 GITHUB_REF_NAME；只有 release
// workflow 显式传入的第一个参数才代表待发布 tag。
const requestedTag = process.argv.slice(2).find(argument => !argument.startsWith('--'))
if (requestedTag !== undefined && requestedTag !== expectedTag) {
  throw new Error(`Release tag 必须与 App 版本一致：期望 ${expectedTag}，收到 ${requestedTag}`)
}

if (process.argv.includes('--notes')) {
  process.stdout.write(`# Tool Bridge Mobile ${expectedTag}（Preview）\n\n${changelogBody}\n`)
} else {
  console.log(`Release metadata 验证通过：App ${packageJson.version}，tag ${expectedTag}，最新 changelog 日期 ${changelogDate}。`)
}

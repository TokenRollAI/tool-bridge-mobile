const { readFile, writeFile } = require('node:fs/promises')
const { join } = require('node:path')

const { withDangerousMod } = require('expo/config-plugins.js')

const SYSTEM_ALERT_WINDOW_LINE = /^\s*<uses-permission\s+android:name="android\.permission\.SYSTEM_ALERT_WINDOW"\s*\/>\s*$/gmu

function removeUnusedDevelopmentPermissions(source) {
  return source.replace(SYSTEM_ALERT_WINDOW_LINE, '')
}

function withAndroidDevelopmentPermissionHardening(config) {
  return withDangerousMod(config, ['android', async modConfig => {
    const manifestPath = join(
      modConfig.modRequest.platformProjectRoot,
      'app',
      'src',
      'debug',
      'AndroidManifest.xml',
    )
    const source = await readFile(manifestPath, 'utf8')
    const hardened = removeUnusedDevelopmentPermissions(source)
    if (hardened.includes('android.permission.SYSTEM_ALERT_WINDOW')) {
      throw new Error('无法从 Android debug manifest 移除 SYSTEM_ALERT_WINDOW')
    }
    await writeFile(manifestPath, hardened, 'utf8')
    return modConfig
  }])
}

module.exports = withAndroidDevelopmentPermissionHardening
module.exports.removeUnusedDevelopmentPermissions = removeUnusedDevelopmentPermissions

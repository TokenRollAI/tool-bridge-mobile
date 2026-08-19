const { withAndroidManifest } = require('expo/config-plugins')

const SERVICE_NAME = 'ai.tokenroll.toolbridge.system.ToolBridgeForegroundService'

// 把后台运行前台服务注入 app 级 manifest：non-exported、dataSync 类型。
// 服务实现在 modules/tool-bridge-system，这里只负责声明，使配置 introspection 与最终 APK 一致。
function addBackgroundRuntimeService(androidManifest) {
  const application = androidManifest.manifest.application?.[0]
  if (application === undefined) throw new Error('Android manifest 缺少 application')
  application.service = (application.service ?? []).filter(
    entry => entry.$?.['android:name'] !== SERVICE_NAME,
  )
  application.service.push({
    $: {
      'android:enabled': 'true',
      'android:exported': 'false',
      'android:foregroundServiceType': 'dataSync',
      'android:name': SERVICE_NAME,
    },
  })
  return androidManifest
}

function withBackgroundRuntimeService(config) {
  return withAndroidManifest(config, current => {
    current.modResults = addBackgroundRuntimeService(current.modResults)
    return current
  })
}

module.exports = withBackgroundRuntimeService
module.exports.addBackgroundRuntimeService = addBackgroundRuntimeService

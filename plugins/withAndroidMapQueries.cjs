const { withAndroidManifest } = require('expo/config-plugins.js')

const ACTION_VIEW = 'android.intent.action.VIEW'
const MAP_SCHEME = 'geo'

function ensureAndroidMapQueries(androidManifest) {
  const manifest = androidManifest.manifest
  manifest.queries ??= [{}]
  if (hasGeoQuery(manifest.queries)) return androidManifest

  const queryBlock = manifest.queries[0] ?? {}
  queryBlock.intent ??= []
  queryBlock.intent.push({
    action: [{ $: { 'android:name': ACTION_VIEW } }],
    data: [{ $: { 'android:scheme': MAP_SCHEME } }],
  })
  manifest.queries[0] = queryBlock
  return androidManifest
}

function hasGeoQuery(queryBlocks) {
  return queryBlocks.some(block => block.intent?.some(intent => (
    intent.action?.some(action => action.$?.['android:name'] === ACTION_VIEW)
    && intent.data?.some(data => data.$?.['android:scheme'] === MAP_SCHEME)
  )))
}

function withAndroidMapQueries(config) {
  return withAndroidManifest(config, modConfig => {
    modConfig.modResults = ensureAndroidMapQueries(modConfig.modResults)
    return modConfig
  })
}

module.exports = withAndroidMapQueries
module.exports.ensureAndroidMapQueries = ensureAndroidMapQueries

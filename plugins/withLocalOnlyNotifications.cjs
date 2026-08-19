const { withAndroidManifest, withEntitlementsPlist } = require('expo/config-plugins')

const NOTIFICATION_EVENT = 'expo.modules.notifications.NOTIFICATION_EVENT'
const NOTIFICATIONS_SERVICE = 'expo.modules.notifications.service.NotificationsService'
const REMOTE_SERVICES = [
  'expo.modules.notifications.service.ExpoFirebaseMessagingService',
  'com.google.firebase.messaging.FirebaseMessagingService',
  'com.google.firebase.components.ComponentDiscoveryService',
  'com.google.android.datatransport.runtime.backends.TransportBackendDiscovery',
  'com.google.android.datatransport.runtime.scheduling.jobscheduling.JobInfoSchedulerService',
]
const REMOTE_RECEIVERS = [
  'com.google.firebase.iid.FirebaseInstanceIdReceiver',
  'com.google.android.datatransport.runtime.scheduling.jobscheduling.AlarmManagerSchedulerBroadcastReceiver',
]
const REMOTE_PROVIDERS = ['com.google.firebase.provider.FirebaseInitProvider']

function removePushEntitlement(entitlements) {
  delete entitlements['aps-environment']
  return entitlements
}

function hardenLocalOnlyAndroidManifest(androidManifest) {
  const application = androidManifest.manifest.application?.[0]
  if (application === undefined) throw new Error('Android manifest 缺少 application')

  application.service = replaceNamedEntriesWithRemovals(application.service, REMOTE_SERVICES)
  application.provider = replaceNamedEntriesWithRemovals(application.provider, REMOTE_PROVIDERS)
  application.receiver = replaceNamedEntriesWithRemovals(
    application.receiver,
    REMOTE_RECEIVERS,
  ).filter(entry => entry.$?.['android:name'] !== NOTIFICATIONS_SERVICE)
  application.receiver.push({
    $: {
      'android:enabled': 'true',
      'android:exported': 'false',
      'android:name': NOTIFICATIONS_SERVICE,
      'tools:node': 'replace',
    },
    'intent-filter': [{
      $: { 'android:priority': '-1' },
      action: [{ $: { 'android:name': NOTIFICATION_EVENT } }],
    }],
  })
  return androidManifest
}

function replaceNamedEntriesWithRemovals(entries = [], names) {
  const namesToRemove = new Set(names)
  const retained = entries.filter(entry => !namesToRemove.has(entry.$?.['android:name']))
  return retained.concat(names.map(name => ({
    $: { 'android:name': name, 'tools:node': 'remove' },
  })))
}

function withLocalOnlyNotifications(config) {
  const withAndroidHardening = withAndroidManifest(config, current => {
    current.modResults = hardenLocalOnlyAndroidManifest(current.modResults)
    return current
  })
  return withEntitlementsPlist(withAndroidHardening, current => {
    removePushEntitlement(current.modResults)
    return current
  })
}

module.exports = withLocalOnlyNotifications
module.exports.hardenLocalOnlyAndroidManifest = hardenLocalOnlyAndroidManifest
module.exports.removePushEntitlement = removePushEntitlement

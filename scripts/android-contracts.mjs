// Android advertises the same JSON Schemas as the existing device capabilities.
import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { z } from 'zod'

const specs = {
  'inbox/schema': [['inbox/deliver', 'inboxDeliveryArguments', 'inboxDeliveryResult']],
  'capabilities/status/schema': [['status/get', 'statusArguments', 'statusResult']],
  'capabilities/runtime/schema': [
    ['runtime/capabilities', 'runtimeEmptyArguments', 'runtimeCapabilitiesResult'],
    ['runtime/pending_commands', 'runtimeEmptyArguments', 'runtimePendingCommandsResult'],
    ['runtime/cancel', 'runtimeCancelArguments', 'runtimeCancelResult'],
  ],
  'capabilities/system/schema': [
    ['system/accessibility_status', 'accessibilityStatusArguments', 'accessibilityStatusResult'],
    ['system/clipboard_get', 'clipboardGetArguments', 'clipboardGetResult'],
    ['system/clipboard_set', 'clipboardSetArguments', 'clipboardSetResult'],
    ['system/open_intent', 'openIntentArguments', 'openIntentResult'],
  ],
  'capabilities/productivity/notificationSchema': [['productivity/notify','localNotificationArguments','localNotificationResult']],
  'capabilities/productivity/timerSchema': [
    ['productivity/timer_start','timerStartArguments','timerStartResult'],
    ['productivity/timer_cancel','timerReferenceArguments','timerCancelResult'],
    ['productivity/timer_status','timerReferenceArguments','timerStatusResult'],
  ],
  'capabilities/attention/schema': [
    ['attention/ring','ringArguments','ringResult'], ['attention/stop','stopArguments','stopResult'],
  ],
  'capabilities/apps/schema': [
    ['apps/can_open_url','appUrlArguments','appCanOpenResult'], ['apps/open_url','appUrlArguments','appOpenResult'],
  ],
  'capabilities/location/schema': [['location/current','currentLocationArguments','currentLocationResult']],
  'capabilities/location/openMapSchema': [['location/open_map','openMapArguments','openMapResult']],
  'capabilities/camera/schema': [['camera/capture_photo','cameraCaptureArguments','cameraCaptureResult']],
  'capabilities/media/schema': ['play','pause','resume','seek','stop','status'].map(tool => [
    'media/'+tool, tool === 'play' ? 'mediaPlayArguments' : tool === 'seek' ? 'mediaSeekArguments' : 'mediaSessionArguments', 'mediaSessionResult',
  ]),
}
const pairs = {}
for (const [file, entries] of Object.entries(specs)) {
  const exports = await import(pathToFileURL(resolve('src',file+'.ts')))
  for (const [key, args, result] of entries) {
    pairs[key] = {
      inputSchema: z.toJSONSchema(exports[args+'Schema'], { io: 'input' }),
      outputSchema: z.toJSONSchema(exports[result+'Schema']),
    }
  }
}
const element = z.string().min(1).max(128)
const accepted = z.strictObject({ accepted: z.boolean() })
const remote = {
  observe: [z.strictObject({}), z.strictObject({package:z.string(),elements:z.array(z.strictObject({
    element,label:z.string(),clickable:z.boolean(),editable:z.boolean(),scrollable:z.boolean()
  }))})],
  screenshot: [z.strictObject({}), z.strictObject({uri:z.string(),width:z.number().int(),height:z.number().int(),contentType:z.literal("image/jpeg")})],
  tap: [z.strictObject({element}),accepted],
  type: [z.strictObject({element,text:z.string().max(2048)}),accepted],
  scroll: [z.strictObject({element,direction:z.enum(['forward','backward'])}),accepted],
}
for (const [key,[input,output]] of Object.entries(remote)) {
  pairs['control/'+key] = {inputSchema:z.toJSONSchema(input),outputSchema:z.toJSONSchema(output)}
}
await writeFile('native-android/app/src/main/assets/contracts.json', JSON.stringify(pairs, null, 2)+'\n')

import { z } from 'zod'

const v = z.literal(2)
const ref = z.string().min(1).max(128)
const name = z.string().min(1).max(512)
const role = z.string().min(1).max(64)
const normalized = z.number().int().min(0).max(1000)
const bounds = z.array(normalized).length(4)
const actions = z.array(z.enum(['tap', 'type', 'scroll_forward', 'scroll_backward']))
const window = z.strictObject({ ref, app: name, boundsSpace: z.literal('window_normalized_1000') })
const region = z.strictObject({ ref, position: z.string(), label: z.string(), bounds, actions,
  depth: z.number().int().nonnegative(), parent: ref.optional(), truncated: z.boolean(),
})
const item = z.strictObject({ ref, region: ref, role, name: z.string(), context: z.string(), bounds, actions,
  enabled: z.boolean(), selected: z.boolean(),
})
const snapshotFields = {
  v, snapshot: ref, window, regions: z.array(region), items: z.array(item), truncated: z.boolean(),
}
const snapshot = z.discriminatedUnion('kind', [
  z.strictObject({ ...snapshotFields, kind: z.literal('full') }),
  z.strictObject({
    ...snapshotFields, kind: z.literal('delta'), base: ref,
    removedItems: z.array(ref), removedRegions: z.array(ref),
  }),
])
const target = z.union([
  z.strictObject({ ref, region: ref }),
  z.strictObject({ region: ref, role, name, context: z.string().max(512).optional() }),
])
const expected = z.union([
  z.strictObject({ visible: z.strictObject({ role, name }) }),
  z.strictObject({ transition: z.strictObject({ fromRole: role, toRole: role, name }) }),
  z.strictObject({ regionChanged: ref }),
])
const common = { v, snapshot: ref, target, expect: expected.optional(), waitMs: z.number().int().min(0).max(2000).optional() }
const receipt = z.strictObject({
  v, dispatch: z.enum(['not_sent', 'sent', 'unknown']),
  outcome: z.enum(['verified', 'not_verified', 'ambiguous_target', 'target_missing', 'stale_snapshot', 'unsupported', 'result_unknown']),
  resolution: z.enum(['direct', 'relocated_unique', 'selector']).optional(),
  changes: snapshot.optional(), evidence: z.strictObject({ role, name: z.string() }).optional(),
  candidates: z.array(z.strictObject({ ref, region: ref })).optional(),
})
const accepted = z.strictObject({ accepted: z.boolean() })
const wrappedAction = (legacy, extra = {}) => [
  z.union([z.strictObject(legacy), z.strictObject({ ...common, ...extra })]),
  z.union([accepted, receipt]),
]
const direction = z.enum(['forward', 'backward'])
const text = z.string().max(2048)
const image = { uri: z.string(), width: z.number().int(), height: z.number().int(), contentType: z.literal('image/jpeg') }
const appPackage = z.string().min(1).max(255).regex(/^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)*$/)
const appCursor = z.strictObject({ session: ref, after: appPackage })
const control = {
  apps: [z.strictObject({ v, limit: z.number().int().min(1).max(32).optional(), cursor: appCursor.optional() }),
    z.strictObject({ v, session: ref, apps: z.array(z.strictObject({ app: appPackage, label: z.string().max(80) })).max(32),
      nextCursor: appCursor.optional() })],
  open_app: [z.strictObject({ v, session: ref, app: appPackage }),
    z.strictObject({ v, app: appPackage, dispatch: z.literal('sent') })],
  status: [z.strictObject({ v }), z.strictObject({
    v, state: z.enum(['service_unavailable', 'locked', 'local_grant_required', 'session_in_use', 'awaiting_selected_app', 'ready']),
    serviceConnected: z.boolean(), remainingMs: z.number().int().nonnegative().nullable(),
    mode: z.enum(['selected_timed', 'all_apps_until_stopped']).optional(),
    app: name.optional(), supported: z.array(z.string()),
  })],
  observe: [z.union([z.strictObject({}), z.strictObject({ v, region: ref.optional(), since: ref.optional() })]),
    z.union([z.strictObject({ package: z.string(), elements: z.array(z.strictObject({
      element: ref, label: z.string(), clickable: z.boolean(), editable: z.boolean(), scrollable: z.boolean(),
    })) }), snapshot])],
  screenshot: [z.union([z.strictObject({}), z.strictObject({ v })]), z.union([z.strictObject(image), z.strictObject({
    ...image, v, window: ref, capturedAt: z.string(),
    sourcePx: z.strictObject({ width: z.number().int().positive(), height: z.number().int().positive() }),
    windowBoundsPx: z.array(z.number().int()).length(4), rotationDegrees: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]).nullable(),
  })])],
  tap: wrappedAction({ element: ref }),
  type: wrappedAction({ element: ref, text }, { text }),
  scroll: wrappedAction({ element: ref, direction }, { direction }),
  back: [z.strictObject(common), receipt],
  media: [z.strictObject({ ...common, operation: z.enum(['play', 'pause']) }), receipt],
}
export function androidControlContracts() {
  return Object.fromEntries(Object.entries(control).map(([key, [input, output]]) => [
    'control/' + key,
    {
      inputSchema: z.toJSONSchema(input, { reused: 'ref' }),
      outputSchema: z.toJSONSchema(output, { reused: 'ref' }),
    },
  ]))
}

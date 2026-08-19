const SENSITIVE_KEY = /(?:authorization|credential|key|password|secret|signed.?url|ticket|token)/i
const PRECISE_LOCATION_KEY = /^(?:lat|latitude|lng|longitude|coordinate|coordinates)$/i

export function redactForLog(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactForLog)
  if (value === null || typeof value !== 'object') return value

  const redacted: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value)) {
    if (SENSITIVE_KEY.test(key) || PRECISE_LOCATION_KEY.test(key)) {
      redacted[key] = '[REDACTED]'
    } else {
      redacted[key] = redactForLog(child)
    }
  }
  return redacted
}

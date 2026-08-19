import type { OpenMapTarget } from './openMapSchema'

export type MapPlatform = 'android' | 'ios'
export type MapProvider = 'android_geo_handler' | 'apple_map_link'

export type BuiltMapTarget = Readonly<{
  provider: MapProvider
  uri: string
}>

export function buildMapTarget(platform: MapPlatform, target: OpenMapTarget): BuiltMapTarget {
  if (platform === 'android') {
    return {
      provider: 'android_geo_handler',
      uri: buildAndroidTarget(target),
    }
  }
  return {
    provider: 'apple_map_link',
    uri: buildAppleTarget(target),
  }
}

export function summarizeMapTarget(target: OpenMapTarget): string {
  if (target.kind === 'query') return target.query
  if (target.label !== undefined) return target.label
  return formatCoordinatePair(target.latitude, target.longitude)
}

function buildAndroidTarget(target: OpenMapTarget): string {
  if (target.kind === 'query') return `geo:0,0?q=${strictEncode(target.query)}`
  const coordinate = formatCoordinatePair(target.latitude, target.longitude)
  if (target.label !== undefined) {
    const zoom = target.zoom === undefined ? '' : `&z=${target.zoom}`
    return `geo:0,0?q=${strictEncode(`${coordinate}(${target.label})`)}${zoom}`
  }
  return `geo:${coordinate}${target.zoom === undefined ? '' : `?z=${target.zoom}`}`
}

function buildAppleTarget(target: OpenMapTarget): string {
  if (target.kind === 'query') {
    return `https://maps.apple.com/?q=${strictEncode(target.query)}`
  }
  const parameters = [`ll=${strictEncode(formatCoordinatePair(target.latitude, target.longitude))}`]
  if (target.label !== undefined) parameters.push(`q=${strictEncode(target.label)}`)
  if (target.zoom !== undefined) parameters.push(`z=${target.zoom}`)
  return `https://maps.apple.com/?${parameters.join('&')}`
}

function formatCoordinatePair(latitude: number, longitude: number): string {
  return `${formatCoordinate(latitude)},${formatCoordinate(longitude)}`
}

function formatCoordinate(value: number): string {
  if (Object.is(value, -0)) return '0'
  return value.toFixed(6).replace(/(?:\.0+|(\.\d*?)0+)$/u, '$1')
}

function strictEncode(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/gu, character => (
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`
  ))
}

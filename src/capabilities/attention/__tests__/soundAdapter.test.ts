import { createFindDeviceWaveBytes } from '../soundAdapter'

jest.mock('expo-audio', () => ({
  createAudioPlayer: jest.fn(),
  setAudioModeAsync: jest.fn(),
}))

jest.mock('expo-file-system', () => ({
  Directory: class {},
  File: class {},
  Paths: { cache: 'file:///cache' },
}))

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.slice(offset, offset + length))
}

describe('attention built-in sound', () => {
  test('生成有限、可识别且包含非静音样本的 PCM WAV', () => {
    const bytes = createFindDeviceWaveBytes()
    const view = new DataView(bytes.buffer)

    expect(ascii(bytes, 0, 4)).toBe('RIFF')
    expect(ascii(bytes, 8, 4)).toBe('WAVE')
    expect(ascii(bytes, 36, 4)).toBe('data')
    expect(view.getUint32(4, true) + 8).toBe(bytes.length)
    expect(view.getUint32(24, true)).toBe(8_000)
    expect(view.getUint16(34, true)).toBe(16)
    expect(bytes.length).toBeLessThan(16_384)
    expect(bytes.slice(44).some(value => value !== 0)).toBe(true)
  })
})

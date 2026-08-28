const { readFileSync } = jest.requireActual<{
  readFileSync(path: string, encoding: 'utf8'): string
}>('node:fs')
const { join } = jest.requireActual<{
  join(...paths: string[]): string
}>('node:path')
const nodeProcess = jest.requireActual<{ cwd(): string }>('node:process')

const serviceSource = readFileSync(join(
  nodeProcess.cwd(),
  'modules/tool-bridge-system/android/src/main/java/ai/tokenroll/toolbridge/system/ToolBridgeForegroundService.kt',
), 'utf8')

describe('Android background runtime service contract', () => {
  test('dataSync 超时时立即停止服务', () => {
    expect(serviceSource).toMatch(
      /override fun onTimeout\(startId: Int, fgsType: Int\)\s*\{\s*(?:\/\/[^\n]*\n\s*)*stopSelf\(\)\s*}/,
    )
  })

  test('进程被回收后不由系统 sticky 重建空服务', () => {
    expect(serviceSource).toContain('return START_NOT_STICKY')
    expect(serviceSource).not.toMatch(/\breturn START_STICKY\b/)
  })
})

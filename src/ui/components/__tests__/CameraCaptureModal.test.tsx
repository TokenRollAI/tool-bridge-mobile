import { act, fireEvent, render, waitFor } from '@testing-library/react-native'

import { CameraCaptureModal } from '../CameraCaptureModal'

import type { CameraCaptureRequestSnapshot } from '@/capabilities/camera/captureCoordinator'

const mockTakePictureAsync = jest.fn()
const mockGetCameraPermissionsAsync = jest.fn()
const mockRequestCameraPermissionsAsync = jest.fn()

jest.mock('expo-camera', () => {
  const React = jest.requireActual<typeof import('react')>('react')
  const { Pressable, Text } = jest.requireActual<typeof import('react-native')>('react-native')
  return {
    Camera: {
      getCameraPermissionsAsync: (...args: unknown[]) => mockGetCameraPermissionsAsync(...args),
      requestCameraPermissionsAsync: (...args: unknown[]) => mockRequestCameraPermissionsAsync(...args),
    },
    CameraView: React.forwardRef(function MockCameraView(
      props: Readonly<{ onCameraReady(): void }>,
      ref: React.ForwardedRef<Readonly<{ takePictureAsync(): Promise<unknown> }>>,
    ) {
      React.useImperativeHandle(ref, () => ({
        takePictureAsync: (...args: unknown[]) => mockTakePictureAsync(...args),
      }))
      return (
        <Pressable onPress={props.onCameraReady} testID="camera-ready">
          <Text>相机预览 fixture</Text>
        </Pressable>
      )
    }),
  }
})

const mockDeleteFile = jest.fn()
jest.mock('expo-file-system', () => ({
  File: class MockFile {
    exists = true
    readonly path: string
    constructor(mockUri: string) { this.path = mockUri }
    delete() { mockDeleteFile(this.path) }
  },
}))

const baseRequest: CameraCaptureRequestSnapshot = {
  automatic: false,
  callerDisplayName: '视觉 Agent',
  callerSubjectId: 'caller_01',
  commandId: 'command_01',
  expiresAt: '2099-08-25T08:02:00.000Z',
  facing: 'back',
  purpose: '查看桌面设备',
  quality: 'medium',
}

describe('CameraCaptureModal', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetCameraPermissionsAsync.mockResolvedValue({ canAskAgain: true, granted: true, status: 'granted' })
    mockRequestCameraPermissionsAsync.mockResolvedValue({ canAskAgain: true, granted: true, status: 'granted' })
  })

  test('direct_call 在可见预览 ready 后自动拍摄并直接提交', async () => {
    let resolvePhoto!: (photo: Readonly<{ height: number; uri: string; width: number }>) => void
    const photoPromise = new Promise<Readonly<{ height: number; uri: string; width: number }>>(resolve => {
      resolvePhoto = resolve
    })
    mockTakePictureAsync.mockReturnValueOnce(photoPromise)
    const onSubmit = jest.fn(() => true)
    const rendered = await render(
      <CameraCaptureModal
        onFail={jest.fn(() => true)}
        onSubmit={onSubmit}
        request={{ ...baseRequest, automatic: true }}
      />,
    )
    const preview = await waitFor(() => rendered.getByTestId('camera-ready'))
    await fireEvent.press(preview)
    await waitFor(() => expect(mockTakePictureAsync).toHaveBeenCalledTimes(1), { timeout: 1_000 })
    await act(async () => {
      resolvePhoto({ height: 3024, uri: 'file:///cache/photo.jpg', width: 4032 })
      await photoPromise
    })
    expect(onSubmit).toHaveBeenCalledWith('command_01', expect.objectContaining({
      uri: 'file:///cache/photo.jpg',
    }))
    expect(rendered.queryByRole('button', { name: '拍摄照片' })).toBeNull()
    await rendered.unmount()
  })

  test('非 direct_call 由用户按快门并确认上传', async () => {
    let resolvePhoto!: (photo: Readonly<{ height: number; uri: string; width: number }>) => void
    const photoPromise = new Promise<Readonly<{ height: number; uri: string; width: number }>>(resolve => {
      resolvePhoto = resolve
    })
    mockTakePictureAsync.mockReturnValueOnce(photoPromise)
    const onSubmit = jest.fn(() => true)
    const rendered = await render(
      <CameraCaptureModal
        onFail={jest.fn(() => true)}
        onSubmit={onSubmit}
        request={baseRequest}
      />,
    )
    await fireEvent.press(await waitFor(() => rendered.getByTestId('camera-ready')))
    await fireEvent.press(rendered.getByRole('button', { name: '拍摄照片' }))
    expect(mockTakePictureAsync).toHaveBeenCalledTimes(1)
    await act(async () => {
      resolvePhoto({ height: 3024, uri: 'file:///cache/photo.jpg', width: 4032 })
      await photoPromise
    })
    const accept = await waitFor(() => rendered.getByRole('button', { name: '使用并上传' }))
    expect(onSubmit).not.toHaveBeenCalled()
    await fireEvent.press(accept)
    expect(onSubmit).toHaveBeenCalledTimes(1)
  })

  test('未授权时只提供本地权限入口，拒绝后结束命令', async () => {
    mockGetCameraPermissionsAsync.mockResolvedValueOnce({
      canAskAgain: true,
      granted: false,
      status: 'undetermined',
    })
    mockRequestCameraPermissionsAsync.mockResolvedValueOnce({
      canAskAgain: false,
      granted: false,
      status: 'denied',
    })
    const onFail = jest.fn(() => true)
    const rendered = await render(
      <CameraCaptureModal
        onFail={onFail}
        onSubmit={jest.fn(() => true)}
        request={baseRequest}
      />,
    )
    await fireEvent.press(await waitFor(() => rendered.getByRole('button', { name: '允许使用相机' })))
    expect(onFail).toHaveBeenCalledWith('command_01', 'permission_denied')
    expect(mockTakePictureAsync).not.toHaveBeenCalled()
  })
})

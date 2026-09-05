import {
  Camera,
  CameraView,
} from 'expo-camera'
import { File } from 'expo-file-system'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Image,
  Modal,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { AccessibleAction } from '@/ui/components/AccessibleAction'
import { radius, spacing, useThemedStyles, type ThemeColors } from '@/ui/theme'

import type {
  CameraCaptureFailure,
  CameraCaptureRequestSnapshot,
  CapturedCameraPhoto,
} from '@/capabilities/camera/captureCoordinator'
import type { CameraCapturedPicture, PermissionResponse } from 'expo-camera'

const CAMERA_QUALITY = {
  high: 0.92,
  low: 0.55,
  medium: 0.75,
} as const

type CapturePhase = 'capturing' | 'permission' | 'preview' | 'review'

type CameraCaptureModalProps = Readonly<{
  onFail(commandId: string, failure: CameraCaptureFailure): boolean
  onSubmit(commandId: string, photo: CapturedCameraPhoto): boolean
  request: CameraCaptureRequestSnapshot | null
}>

export function CameraCaptureModal({
  onFail,
  onSubmit,
  request,
}: CameraCaptureModalProps) {
  const styles = useThemedStyles(createStyles)
  const cameraRef = useRef<CameraView>(null)
  const automaticCommandRef = useRef<string | null>(null)
  const reviewPhotoRef = useRef<CameraCapturedPicture | null>(null)
  const [cameraReady, setCameraReady] = useState(false)
  const [permission, setPermission] = useState<PermissionResponse | null>(null)
  const [phase, setPhase] = useState<CapturePhase>('permission')
  const [reviewPhoto, setReviewPhoto] = useState<CameraCapturedPicture | null>(null)
  const commandId = request?.commandId ?? null

  const clearReviewPhoto = useCallback(() => {
    const photo = reviewPhotoRef.current
    reviewPhotoRef.current = null
    setReviewPhoto(null)
    if (photo === null) return
    try {
      const file = new File(photo.uri)
      if (file.exists) file.delete()
    } catch {
      // App 私有 cache 的 best-effort 清理；URI 不会被记录或返回。
    }
  }, [])

  useEffect(() => {
    if (commandId === null) return
    let active = true
    void Camera.getCameraPermissionsAsync().then(current => {
      if (!active) return
      setPermission(current)
      setPhase(current.granted ? 'preview' : 'permission')
    }).catch(() => {
      if (active) setPhase('permission')
    })
    return () => { active = false }
  }, [commandId])

  useEffect(() => () => {
    const photo = reviewPhotoRef.current
    reviewPhotoRef.current = null
    if (photo !== null) discardPhoto(photo)
  }, [])

  const takePhoto = useCallback(async () => {
    if (request === null || !cameraReady || phase !== 'preview') return
    setPhase('capturing')
    try {
      const photo = await cameraRef.current?.takePictureAsync({
        base64: false,
        exif: false,
        quality: CAMERA_QUALITY[request.quality],
        shutterSound: true,
        skipProcessing: false,
      })
      if (photo === undefined) throw new Error('camera returned no photo')
      if (request.automatic) {
        if (!onSubmit(request.commandId, photo)) discardPhoto(photo)
        return
      }
      reviewPhotoRef.current = photo
      setReviewPhoto(photo)
      setPhase('review')
    } catch {
      onFail(request.commandId, 'camera_mount_failed')
    }
  }, [cameraReady, onFail, onSubmit, phase, request])

  useEffect(() => {
    if (
      request === null
      || !request.automatic
      || !cameraReady
      || phase !== 'preview'
      || automaticCommandRef.current === request.commandId
    ) return
    automaticCommandRef.current = request.commandId
    const timer = setTimeout(() => { void takePhoto() }, 300)
    return () => { clearTimeout(timer) }
  }, [cameraReady, phase, request, takePhoto])

  if (request === null) return null
  const caller = request.callerDisplayName ?? request.callerSubjectId

  const cancel = () => {
    clearReviewPhoto()
    onFail(request.commandId, 'user_cancelled')
  }
  const requestPermission = async () => {
    try {
      const next = await Camera.requestCameraPermissionsAsync()
      setPermission(next)
      if (next.granted) setPhase('preview')
      else onFail(request.commandId, 'permission_denied')
    } catch {
      onFail(request.commandId, 'permission_denied')
    }
  }
  const acceptPhoto = () => {
    const photo = reviewPhotoRef.current
    if (photo === null) return
    reviewPhotoRef.current = null
    setReviewPhoto(null)
    if (!onSubmit(request.commandId, photo)) discardPhoto(photo)
  }
  const retake = () => {
    clearReviewPhoto()
    setCameraReady(false)
    setPhase('preview')
  }

  return (
    <Modal
      animationType="fade"
      onRequestClose={cancel}
      presentationStyle="fullScreen"
      statusBarTranslucent={false}
      visible
    >
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.header}>
          <Text accessibilityRole="header" style={styles.heading}>相机请求</Text>
          <Text style={styles.detail}>调用方：{caller}</Text>
          <Text style={styles.detail}>用途：{request.purpose}</Text>
          <Text style={styles.mode}>
            {request.automatic
              ? '允许直接调用：可见预览就绪后将自动拍摄并上传。'
              : '每次确认：请在预览中主动拍摄，并确认要上传的照片。'}
          </Text>
        </View>

        {phase === 'permission' || permission?.granted !== true ? (
          <View style={styles.centered}>
            <Text style={styles.body}>
              必须先授予系统相机权限。Tool Bridge 不会请求麦克风、后台相机或照片图库权限。
            </Text>
            <AccessibleAction
              accessibilityHint="打开系统相机权限请求"
              icon="camera"
              label="允许使用相机"
              onPress={() => { void requestPermission() }}
            />
            <AccessibleAction
              accessibilityHint="拒绝并结束当前拍摄请求"
              icon="danger"
              label="取消拍摄"
              onPress={cancel}
              variant="secondary"
            />
          </View>
        ) : phase === 'review' && reviewPhoto !== null ? (
          <View style={styles.previewContainer}>
            <Image
              accessibilityLabel="刚刚拍摄、等待确认上传的照片"
              resizeMode="contain"
              source={{ uri: reviewPhoto.uri }}
              style={styles.preview}
            />
            <View style={styles.actions}>
              <AccessibleAction
                accessibilityHint="删除当前临时照片并返回相机预览"
                icon="camera"
                label="重新拍摄"
                onPress={retake}
                variant="secondary"
              />
              <AccessibleAction
                accessibilityHint="处理并上传当前照片，只向调用方返回对象引用与元数据"
                icon="positive"
                label="使用并上传"
                onPress={acceptPhoto}
              />
            </View>
          </View>
        ) : (
          <View style={styles.cameraContainer}>
            <CameraView
              accessibilityLabel={`${request.facing === 'front' ? '前置' : '后置'}相机可见预览`}
              facing={request.facing}
              mode="picture"
              onCameraReady={() => {
                setCameraReady(true)
                if (phase === 'capturing') setPhase('preview')
              }}
              onMountError={() => { onFail(request.commandId, 'camera_mount_failed') }}
              ref={cameraRef}
              style={styles.camera}
            />
            <View style={styles.overlay}>
              <Text style={styles.statusText}>
                {phase === 'capturing'
                  ? '正在拍摄…'
                  : cameraReady
                    ? request.automatic ? '预览已就绪，即将自动拍摄…' : '预览已就绪'
                    : '正在启动相机预览…'}
              </Text>
              <View style={styles.actions}>
                <AccessibleAction
                  accessibilityHint="结束当前拍摄请求"
                  icon="danger"
                  label="取消拍摄"
                  onPress={cancel}
                  variant="secondary"
                />
                {request.automatic ? null : (
                  <AccessibleAction
                    accessibilityHint="拍摄一张照片并进入上传确认"
                    busy={phase === 'capturing'}
                    disabled={!cameraReady}
                    icon="camera"
                    label="拍摄照片"
                    onPress={() => { void takePhoto() }}
                  />
                )}
              </View>
            </View>
          </View>
        )}
      </SafeAreaView>
    </Modal>
  )
}

function discardPhoto(photo: Readonly<{ uri: string }>): void {
  try {
    const file = new File(photo.uri)
    if (file.exists) file.delete()
  } catch {
    // App 私有 cache 的 best-effort 清理。
  }
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    justifyContent: 'center',
    padding: spacing.lg,
  },
  body: {
    color: colors.text,
    fontSize: 16,
    lineHeight: 24,
    textAlign: 'center',
  },
  camera: {
    flex: 1,
  },
  cameraContainer: {
    backgroundColor: '#000000',
    flex: 1,
  },
  centered: {
    alignItems: 'center',
    flex: 1,
    gap: spacing.lg,
    justifyContent: 'center',
    padding: spacing.xxl,
  },
  detail: {
    color: colors.text,
    fontSize: 14,
    lineHeight: 20,
  },
  header: {
    backgroundColor: colors.panel,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    gap: spacing.sm,
    padding: spacing.xl,
  },
  heading: {
    color: colors.text,
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: -0.6,
  },
  mode: {
    backgroundColor: colors.warningSoft,
    borderRadius: radius.sm,
    color: colors.warning,
    fontSize: 13,
    lineHeight: 19,
    marginTop: spacing.xs,
    padding: spacing.md,
  },
  overlay: {
    backgroundColor: 'rgba(8, 17, 31, 0.9)',
  },
  preview: {
    backgroundColor: '#000000',
    borderRadius: radius.md,
    flex: 1,
    margin: spacing.lg,
  },
  previewContainer: {
    flex: 1,
  },
  safeArea: {
    backgroundColor: colors.background,
    flex: 1,
  },
  statusText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    textAlign: 'center',
  },
})

package ai.tokenroll.toolbridge.attention

import android.content.Context
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraManager
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class ToolBridgeAttentionModule : Module() {
  private fun vibrator(): Vibrator? {
    val context = appContext.reactContext ?: return null
    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      context.getSystemService(VibratorManager::class.java)?.defaultVibrator
    } else {
      @Suppress("DEPRECATION")
      context.getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator
    }
  }

  private fun cameraManager(): CameraManager? {
    val context = appContext.reactContext ?: return null
    return context.getSystemService(Context.CAMERA_SERVICE) as? CameraManager
  }

  // 返回第一个带闪光灯单元的摄像头 id；没有则返回 null。setTorchMode 只需
  // FLASH 硬件特性，不需要 CAMERA 运行时权限，也不打开相机采集流。
  private fun torchCameraId(): String? {
    val manager = cameraManager() ?: return null
    return manager.cameraIdList.firstOrNull { id ->
      val characteristics = manager.getCameraCharacteristics(id)
      characteristics.get(CameraCharacteristics.FLASH_INFO_AVAILABLE) == true
    }
  }

  override fun definition() = ModuleDefinition {
    Name("ToolBridgeAttention")

    AsyncFunction("probeHapticsAsync") {
      return@AsyncFunction vibrator()?.hasVibrator() == true
    }

    AsyncFunction("pulseAsync") {
      val deviceVibrator = vibrator() ?: return@AsyncFunction false
      if (!deviceVibrator.hasVibrator()) return@AsyncFunction false
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        deviceVibrator.vibrate(
          VibrationEffect.createOneShot(450L, VibrationEffect.DEFAULT_AMPLITUDE)
        )
      } else {
        @Suppress("DEPRECATION")
        deviceVibrator.vibrate(450L)
      }
      return@AsyncFunction true
    }

    AsyncFunction("cancelAsync") {
      vibrator()?.cancel()
    }

    AsyncFunction("probeTorchAsync") {
      return@AsyncFunction try {
        torchCameraId() != null
      } catch (_: Throwable) {
        false
      }
    }

    AsyncFunction("enableTorchAsync") {
      val manager = cameraManager() ?: return@AsyncFunction false
      val cameraId = try {
        torchCameraId()
      } catch (_: Throwable) {
        null
      } ?: return@AsyncFunction false
      try {
        manager.setTorchMode(cameraId, true)
      } catch (error: Throwable) {
        // torch 可能被其他 App 占用或被系统策略拒绝；诚实上报失败，不假装点亮。
        throw CodedException("torch_unavailable", "无法点亮闪光灯", error)
      }
      return@AsyncFunction true
    }

    AsyncFunction("disableTorchAsync") {
      val manager = cameraManager()
      val cameraId = try {
        torchCameraId()
      } catch (_: Throwable) {
        null
      }
      if (manager != null && cameraId != null) {
        try {
          manager.setTorchMode(cameraId, false)
        } catch (_: Throwable) {
          // 释放阶段的失败不阻断停止流程；会话已在 JS 侧标记结束。
        }
      }
    }
  }
}

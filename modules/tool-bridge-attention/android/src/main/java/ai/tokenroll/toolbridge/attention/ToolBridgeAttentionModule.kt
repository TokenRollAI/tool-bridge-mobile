package ai.tokenroll.toolbridge.attention

import android.content.Context
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
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
  }
}

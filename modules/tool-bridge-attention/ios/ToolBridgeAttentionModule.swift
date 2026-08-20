import AVFoundation
import CoreHaptics
import ExpoModulesCore
import UIKit

public class ToolBridgeAttentionModule: Module {
  // 带 torch 的内建后置摄像头。torch 控制不触发相机隐私授权，也不打开采集会话。
  private func torchDevice() -> AVCaptureDevice? {
    guard let device = AVCaptureDevice.default(for: .video) else { return nil }
    return device.hasTorch && device.isTorchAvailable ? device : nil
  }

  public func definition() -> ModuleDefinition {
    Name("ToolBridgeAttention")

    AsyncFunction("probeHapticsAsync") {
      return CHHapticEngine.capabilitiesForHardware().supportsHaptics
    }

    AsyncFunction("pulseAsync") {
      guard CHHapticEngine.capabilitiesForHardware().supportsHaptics else {
        return false
      }
      let generator = UIImpactFeedbackGenerator(style: .heavy)
      generator.prepare()
      generator.impactOccurred(intensity: 1.0)
      return true
    }.runOnQueue(.main)

    // UIImpactFeedbackGenerator is one-shot; the JS session controller cancels future pulses.
    AsyncFunction("cancelAsync") {}

    AsyncFunction("probeTorchAsync") {
      return self.torchDevice() != nil
    }

    AsyncFunction("enableTorchAsync") { () -> Bool in
      guard let device = self.torchDevice() else { return false }
      do {
        try device.lockForConfiguration()
        defer { device.unlockForConfiguration() }
        try device.setTorchModeOn(level: AVCaptureDevice.maxAvailableTorchLevel)
        return true
      } catch {
        // torch 被占用或配置失败时诚实上报，不假装点亮。
        throw Exception(name: "torch_unavailable", description: "无法点亮闪光灯")
      }
    }

    AsyncFunction("disableTorchAsync") {
      guard let device = self.torchDevice() else { return }
      do {
        try device.lockForConfiguration()
        defer { device.unlockForConfiguration() }
        device.torchMode = .off
      } catch {
        // 释放阶段的失败不阻断停止流程。
      }
    }
  }
}

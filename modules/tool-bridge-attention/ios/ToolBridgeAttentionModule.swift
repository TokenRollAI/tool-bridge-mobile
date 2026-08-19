import CoreHaptics
import ExpoModulesCore
import UIKit

public class ToolBridgeAttentionModule: Module {
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
  }
}

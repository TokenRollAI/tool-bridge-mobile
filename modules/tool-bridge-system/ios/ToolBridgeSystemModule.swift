import ExpoModulesCore
import UIKit

// iOS 沙箱不允许 App 执行任意子进程，也没有 Android AccessibilityService 的对等物。
// 该模块只提供剪贴板边界，其余高特权能力在 iOS 结构化返回 unavailable，不伪装成功。
public class ToolBridgeSystemModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ToolBridgeSystem")

    AsyncFunction("execShellAsync") { (_: String, _: Int, _: Int) -> [String: Any] in
      return ["exitCode": -1, "stdout": "", "stderr": "unsupported_platform", "truncated": false]
    }

    AsyncFunction("getClipboardAsync") { () -> String in
      return UIPasteboard.general.string ?? ""
    }.runOnQueue(.main)

    AsyncFunction("setClipboardAsync") { (text: String) in
      UIPasteboard.general.string = text
    }.runOnQueue(.main)

    AsyncFunction("probeAccessibilityAsync") { () -> Bool in
      return false
    }

    AsyncFunction("openAccessibilitySettingsAsync") {
      throw Exception(name: "unsupported_platform", description: "iOS has no accessibility automation entry")
    }

    // iOS 不允许普通 App 常驻后台长连接；后台可达需依赖上游未交付的 push/mailbox，这里 no-op。
    AsyncFunction("startBackgroundRuntimeAsync") {}
    AsyncFunction("stopBackgroundRuntimeAsync") {}
  }
}

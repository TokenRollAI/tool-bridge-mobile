package ai.tokenroll.toolbridge.system

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.provider.Settings
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.ByteArrayOutputStream
import java.util.concurrent.TimeUnit

// 高特权本地系统模块。仅在用户于设备本地选择 direct_call / trusted_session 时经由 JS 能力调用。
// 该模块不声明任何 Android 权限；shell 以 App 自身 uid 运行，不获取 root。
class ToolBridgeSystemModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("ToolBridgeSystem")

    AsyncFunction("execShellAsync") { command: String, timeoutMs: Int, maxOutputBytes: Int ->
      execShell(command, timeoutMs.toLong(), maxOutputBytes)
    }

    AsyncFunction("getClipboardAsync") {
      val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager
        ?: return@AsyncFunction ""
      val clip = clipboard.primaryClip ?: return@AsyncFunction ""
      if (clip.itemCount == 0) return@AsyncFunction ""
      return@AsyncFunction clip.getItemAt(0).coerceToText(context).toString()
    }

    AsyncFunction("setClipboardAsync") { text: String ->
      val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager
        ?: throw IllegalStateException("clipboard_unavailable")
      clipboard.setPrimaryClip(ClipData.newPlainText("Tool Bridge", text))
    }

    AsyncFunction("probeAccessibilityAsync") {
      val enabled = Settings.Secure.getInt(
        context.contentResolver,
        Settings.Secure.ACCESSIBILITY_ENABLED,
        0,
      )
      return@AsyncFunction enabled == 1
    }

    AsyncFunction("openAccessibilitySettingsAsync") {
      val intent = Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)
      intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      context.startActivity(intent)
    }

    AsyncFunction("startBackgroundRuntimeAsync") {
      ToolBridgeForegroundService.start(context)
    }

    AsyncFunction("stopBackgroundRuntimeAsync") {
      ToolBridgeForegroundService.stop(context)
    }
  }

  private fun execShell(command: String, timeoutMs: Long, maxOutputBytes: Int): Map<String, Any> {
    val process = ProcessBuilder("/system/bin/sh", "-c", command)
      .redirectErrorStream(false)
      .start()
    val stdout = ByteArrayOutputStream()
    val stderr = ByteArrayOutputStream()
    var truncated = false

    val stdoutThread = Thread { truncated = pump(process.inputStream, stdout, maxOutputBytes) || truncated }
    val stderrThread = Thread { truncated = pump(process.errorStream, stderr, maxOutputBytes) || truncated }
    stdoutThread.start()
    stderrThread.start()

    val finished = process.waitFor(timeoutMs, TimeUnit.MILLISECONDS)
    if (!finished) {
      process.destroyForcibly()
      stdoutThread.join(500)
      stderrThread.join(500)
      throw IllegalStateException("shell_timeout")
    }
    stdoutThread.join(1000)
    stderrThread.join(1000)

    return mapOf(
      "exitCode" to process.exitValue(),
      "stdout" to stdout.toString(Charsets.UTF_8.name()),
      "stderr" to stderr.toString(Charsets.UTF_8.name()),
      "truncated" to truncated,
    )
  }

  // 逐块读取并在字节上限处截断，避免单条命令输出耗尽内存。返回是否发生截断。
  private fun pump(input: java.io.InputStream, sink: ByteArrayOutputStream, maxBytes: Int): Boolean {
    val buffer = ByteArray(8192)
    var total = 0
    var truncated = false
    input.use { stream ->
      while (true) {
        val read = stream.read(buffer)
        if (read < 0) break
        if (total >= maxBytes) { truncated = true; continue }
        val remaining = maxBytes - total
        val toWrite = if (read > remaining) read.coerceAtMost(remaining) else read
        sink.write(buffer, 0, toWrite)
        total += toWrite
        if (toWrite < read) truncated = true
      }
    }
    return truncated
  }
}

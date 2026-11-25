package ai.tokenroll.toolbridge.mobile

import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.Settings
import org.json.JSONObject
import java.net.URI

internal val unsafeDeviceText = Regex("[\\p{Cc}\\u202a-\\u202e\\u2066-\\u2069]")

internal fun deviceText(args: JSONObject, key: String, max: Int): String {
    val raw = args.opt(key) as? String ?: throw WireFailure("invalid_argument", "缺少文本参数")
    if (raw.length > max || raw.isBlank() || unsafeDeviceText.containsMatchIn(raw))
        throw WireFailure("invalid_argument", "文本参数无效")
    return raw.trim()
}

internal fun deviceLink(raw: String): URI {
    val link = runCatching { URI(raw) }.getOrNull()
    if (raw.length > 4096 || unsafeDeviceText.containsMatchIn(raw) || link == null ||
        !link.scheme.equals("https", true) && !link.scheme.equals("http", true) ||
        link.host.isNullOrEmpty() || link.rawUserInfo != null)
        throw WireFailure("invalid_argument", "仅可打开有效的 HTTP 或 HTTPS 网页链接")
    return link
}

class DeviceTools(val context: Context, val store: NativeStore, val foreground: () -> Boolean, val changed: () -> Unit) {
    private val notifications = DeviceToolsNotifications(context)
    private val ring = DeviceToolsAttention(context, foreground, ::publishChange)
    private val timers = DeviceToolsTimers(context, store, notifications)
    // Finish recovery before a new reservation can be mistaken for an interrupted command.
    private val recovery = java.util.concurrent.FutureTask {
        timers.reconcile()
        publishChange()
    }.also { Thread(it, "DeviceTools-timer-recovery").start() }

    private fun publishChange() {
        // Refresh failures cannot undo an already committed timer or attention session.
        try { changed() } catch (_: RuntimeException) { }
    }

    fun available(key: String): Boolean = runCatching {
        when (key) {
            "productivity/notify" -> foreground() && notifications.enabled()
            "productivity/timer_start" -> foreground() && notifications.enabled() && timers.canSchedule()
            "productivity/timer_cancel", "productivity/timer_status", "attention/stop", "system/accessibility_status" -> true
            "attention/ring" -> foreground() && ring.hasChannel()
            "system/clipboard_get", "system/clipboard_set" -> foreground() && context.getSystemService(ClipboardManager::class.java) != null
            "system/open_intent" -> foreground()
            else -> false
        }
    }.getOrDefault(false)

    private fun foregroundCall(call: WireCall) {
        call.checkActive()
        if (!foreground()) throw WireFailure("foreground_required", "请在手机前台使用此能力")
    }

    fun execute(call: WireCall): JSONObject {
        call.checkActive()
        val args = call.arguments
        return when (call.path.removePrefix("phone/") + "/" + call.tool) {
            "attention/ring" -> { foregroundCall(call); ring.start(call) }
            "attention/stop" -> ring.stopRemote(args.opt("sessionId") as? String)
            "productivity/notify" -> {
                deviceText(args, "purpose", 120)
                val body = deviceText(args, "message", 240)
                foregroundCall(call)
                notifications.requireEnabled("notification_unavailable")
                foregroundCall(call)
                val id = "tb_local_notify_" + NativeJson.digest(call.id)
                notifications.post(id, "Tool Bridge", "Agent 通知：$body")
                obj("notificationId" to id, "presentation" to "system_determined",
                    "scheduledAt" to NativeJson.now(), "status" to "scheduled")
            }
            "productivity/timer_start" -> {
                recovery.get()
                timers.start(call) { foregroundCall(call) }.also { publishChange() }
            }
            "productivity/timer_cancel", "productivity/timer_status" -> {
                recovery.get()
                timers.control(call).also { if (call.tool == "timer_cancel") publishChange() }
            }
            "system/accessibility_status" -> obj("enabled" to (Settings.Secure.getInt(
                context.contentResolver, Settings.Secure.ACCESSIBILITY_ENABLED, 0) == 1))
            "system/clipboard_get", "system/clipboard_set" -> {
                foregroundCall(call)
                val clipboard = context.getSystemService(ClipboardManager::class.java)
                    ?: throw WireFailure("unavailable", "系统剪贴板不可用")
                if (call.tool == "clipboard_set") {
                    val text = args.opt("text") as? String
                    if (text == null || text.length > 64000) throw WireFailure("invalid_argument", "剪贴板文本无效")
                    clipboard.setPrimaryClip(ClipData.newPlainText("Tool Bridge", text))
                    obj("status" to "set")
                } else {
                    val clip = clipboard.primaryClip
                    // Only read inline text. URI/Intent clipboard entries can reference private providers.
                    val text = if (clip != null && clip.itemCount > 0) clip.getItemAt(0).text?.toString().orEmpty() else ""
                    val result = obj("text" to text)
                    if (text.length > 68 * 1024 || result.toString().toByteArray().size > 68 * 1024)
                        throw WireFailure("result_too_large", "剪贴板文本超出返回大小限制")
                    result
                }
            }
            "system/open_intent" -> {
                val url = deviceLink(args.getString("url"))
                foregroundCall(call)
                val view = Intent(Intent.ACTION_VIEW, Uri.parse(url.toASCIIString()))
                    .addCategory(Intent.CATEGORY_BROWSABLE).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                try { context.startActivity(view) }
                catch (_: ActivityNotFoundException) { throw WireFailure("unavailable", "系统未接受该链接") }
                catch (_: SecurityException) { throw WireFailure("permission_denied", "系统拒绝打开该链接") }
                obj("status" to "handed_off")
            }
            else -> throw WireFailure("not_found", "手机未开放该能力")
        }
    }

    fun attention(): JSONObject? = ring.snapshot()
    fun localStopAttention() = ring.stopLocal()
    fun localCancelTimer(id: String) {
        recovery.get()
        timers.cancelLocal(id)
        publishChange()
    }
    fun notifyInbox(messageId: String): JSONObject = notifications.inbox(messageId)
    fun close() { ring.close(); recovery.get() }
}

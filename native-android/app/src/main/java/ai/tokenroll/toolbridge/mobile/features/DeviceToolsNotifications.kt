package ai.tokenroll.toolbridge.mobile

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import org.json.JSONObject

internal class DeviceToolsNotifications(private val context: Context) {
    private val manager get() = context.getSystemService(NotificationManager::class.java)
        ?: throw WireFailure("unavailable", "设备没有通知服务")

    private fun authorization(): String {
        if (Build.VERSION.SDK_INT >= 33 && context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)
            != PackageManager.PERMISSION_GRANTED) return "permission_required"
        if (!manager.areNotificationsEnabled()) return "unavailable"
        if (Build.VERSION.SDK_INT >= 26) {
            if (manager.getNotificationChannel(CHANNEL) == null) {
                val channel = NotificationChannel(CHANNEL, "Tool Bridge 本地通知", NotificationManager.IMPORTANCE_DEFAULT).apply {
                    description = "用户允许后由 Tool Bridge 创建的本地可见通知"
                    setSound(null, null)
                    enableLights(false)
                    enableVibration(false)
                    setShowBadge(false)
                    lockscreenVisibility = Notification.VISIBILITY_PRIVATE
                }
                manager.createNotificationChannel(channel)
            }
            val actual = manager.getNotificationChannel(CHANNEL) ?: return "unavailable"
            if (actual.importance == NotificationManager.IMPORTANCE_NONE) return "unavailable"
            if (Build.VERSION.SDK_INT >= 28 && actual.group?.let { manager.getNotificationChannelGroup(it)?.isBlocked } == true)
                return "unavailable"
        }
        return "granted"
    }

    fun enabled() = authorization() == "granted"

    fun requireEnabled(code: String) {
        if (!enabled()) throw WireFailure(code, "系统通知授权或通知渠道不可用")
    }

    @Suppress("DEPRECATION")
    fun post(id: String, title: String, body: String) {
        val builder = if (Build.VERSION.SDK_INT >= 26) Notification.Builder(context, CHANNEL) else Notification.Builder(context)
        val notification = builder.setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle(title).setContentText(body).setVisibility(Notification.VISIBILITY_PRIVATE)
            .setDefaults(0).setOnlyAlertOnce(true).setAutoCancel(true).build()
        try { manager.notify(id, 1, notification) }
        catch (_: SecurityException) { throw WireFailure("notification_unavailable", "系统拒绝了通知") }
        catch (_: RuntimeException) { throw WireFailure("notification_status_unknown", "系统未确认通知状态") }
    }

    fun dismiss(id: String) { manager.cancel(id, 1) }

    fun inbox(messageId: String): JSONObject {
        if (!messageId.matches(Regex("inbox_[a-f0-9]{64}"))) return obj("status" to "not_attempted")
        return try {
            when (val status = authorization()) {
                "granted" -> {
                    val id = "tb_local_" + messageId
                    post(id, "Tool Bridge 信箱", "收到一条 Agent 来信，请在 App 内查看。")
                    obj("status" to "scheduled", "notificationId" to id)
                }
                else -> obj("status" to status)
            }
        } catch (_: Exception) { obj("status" to "status_unknown") }
    }

    companion object { const val CHANNEL = "tool_bridge_local_requests_v1" }
}

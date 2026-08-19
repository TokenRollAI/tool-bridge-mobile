package ai.tokenroll.toolbridge.system

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder

// 常驻前台服务，用于在 App 退到后台时降低进程被系统回收的概率，从而让 device 连接尽量存活。
// 它只显示一个用户始终可见的通知（符合“敏感动作可见”），不做任何自有业务逻辑；连接与命令
// 执行仍在 JS 运行时。系统 Doze、厂商省电与强制停止仍可能中断它，因此不承诺后台可靠可达。
class ToolBridgeForegroundService : Service() {
  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    ensureChannel()
    startForeground(NOTIFICATION_ID, buildNotification())
    // START_STICKY: 进程若被系统回收后在资源允许时尝试重建服务。
    return START_STICKY
  }

  private fun ensureChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager ?: return
    if (manager.getNotificationChannel(CHANNEL_ID) != null) return
    val channel = NotificationChannel(
      CHANNEL_ID,
      "Tool Bridge 后台运行",
      NotificationManager.IMPORTANCE_LOW,
    )
    channel.description = "在后台保持设备连接时显示的常驻通知"
    channel.setShowBadge(false)
    manager.createNotificationChannel(channel)
  }

  private fun buildNotification(): Notification {
    val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      Notification.Builder(this, CHANNEL_ID)
    } else {
      @Suppress("DEPRECATION")
      Notification.Builder(this)
    }
    return builder
      .setContentTitle("Tool Bridge 正在后台运行")
      .setContentText("设备连接保持中；可在 App 内关闭后台运行。")
      .setSmallIcon(applicationInfo.icon)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .build()
  }

  companion object {
    const val CHANNEL_ID = "tool_bridge_background_runtime_v1"
    const val NOTIFICATION_ID = 0x7B01

    fun start(context: Context) {
      val intent = Intent(context, ToolBridgeForegroundService::class.java)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        context.startForegroundService(intent)
      } else {
        context.startService(intent)
      }
    }

    fun stop(context: Context) {
      context.stopService(Intent(context, ToolBridgeForegroundService::class.java))
    }
  }
}

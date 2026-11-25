package ai.tokenroll.toolbridge.mobile

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder

class ConnectionService : Service() {
    private var foregroundShown = false
    private var timedOut = false
    override fun onCreate() { super.onCreate(); running = this }
    override fun onDestroy() { if (running === this) running = null; super.onDestroy() }
    override fun onBind(intent: Intent?): IBinder? = null
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == STOP) RemoteSession.stop()
        ensureChannel(this)
        val open = PendingIntent.getActivity(this, 1, Intent(this, if (RemoteSession.active) ControlActivity::class.java else MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val builder = if (Build.VERSION.SDK_INT >= 26) Notification.Builder(this, CHANNEL) else Notification.Builder(this)
        builder.setSmallIcon(android.R.drawable.stat_notify_sync).setContentIntent(open).setOngoing(true)
            .setContentTitle(if (RemoteSession.active) "Tool Bridge 正在远程控制" else "Tool Bridge 后台连接")
        if (RemoteSession.active) {
            val stop = PendingIntent.getService(this, 2, Intent(this, ConnectionService::class.java).setAction(STOP),
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
            builder.addAction(Notification.Action.Builder(null, "结束控制", stop).build())
        }
        startForeground(503, builder.build())
        foregroundShown = true
        if (!RemoteSession.active && !(application as PhoneApp).runtime.backgroundEnabled()) stopSelf()
        return START_NOT_STICKY
    }
    override fun onTimeout(startId: Int, fgsType: Int) { timedOut = true; RemoteSession.stop(); stopSelf() }
    companion object {
        private var running: ConnectionService? = null
        fun updateIfRunning() {
            val service = running ?: return
            // A pending startForegroundService must always present its notification first.
            if (service.foregroundShown && !service.timedOut) service.onStartCommand(null,0,0)
        }
        private const val CHANNEL = "tb_native_session"
        private const val STOP = "ai.tokenroll.toolbridge.mobile.END_LOCAL_SESSION"
        private fun ensureChannel(context: Context) {
            if (Build.VERSION.SDK_INT >= 26) context.getSystemService(NotificationManager::class.java)
                .createNotificationChannel(NotificationChannel(CHANNEL, "设备连接和远控", NotificationManager.IMPORTANCE_LOW))
        }
        fun canShowControls(context: Context): Boolean {
            ensureChannel(context)
            val manager = context.getSystemService(NotificationManager::class.java)
            return manager.areNotificationsEnabled() && (Build.VERSION.SDK_INT < 26 ||
                manager.getNotificationChannel(CHANNEL).importance != NotificationManager.IMPORTANCE_NONE)
        }
        fun start(context: Context) {
            val intent = Intent(context, ConnectionService::class.java)
            if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(intent) else context.startService(intent)
        }
    }
}

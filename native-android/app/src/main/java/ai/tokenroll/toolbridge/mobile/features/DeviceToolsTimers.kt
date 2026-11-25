package ai.tokenroll.toolbridge.mobile

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import java.time.Instant
import org.json.JSONObject

private val timerIdPattern = Regex("timer_[a-f0-9]{64}")
private const val timerAction = "ai.tokenroll.toolbridge.mobile.TIMER_DUE"
private val activeStates = listOf("preparing", "scheduled", "cancelling", "status_unknown")
private val timerLock = Any()

internal fun timerInstant(value: String): Long {
    val ms = runCatching { Instant.parse(value).toEpochMilli() }.getOrNull()
    if (ms == null || NativeJson.now(ms) != value) throw WireFailure("invalid_argument", "需要规范的 UTC 毫秒时间")
    return ms
}

internal fun checkTimerLead(ms: Long, now: Long) {
    val lead = ms - now
    if (lead < 10000) throw WireFailure("timer_too_soon", "计时目标必须至少在当前时间 10 秒之后")
    if (lead > 86400000) throw WireFailure("timer_too_far", "计时器最多只能创建到 24 小时之后")
}

internal class DeviceToolsTimers(private val context: Context, private val store: NativeStore,
                                private val notifications: DeviceToolsNotifications) {
    private val alarms get() = context.getSystemService(AlarmManager::class.java)
        ?: throw WireFailure("timer_unavailable", "系统计时器不可用")

    private fun pending(id: String, create: Boolean): PendingIntent? {
        require(timerIdPattern.matches(id))
        // Extras do not participate in PendingIntent identity. Use the full local digest.
        val intent = Intent(context, DeviceToolsTimerReceiver::class.java).setAction(timerAction)
            .setData(Uri.fromParts("tb-timer", id, null))
        val flags = PendingIntent.FLAG_IMMUTABLE or (if (create) 0 else PendingIntent.FLAG_NO_CREATE)
        return PendingIntent.getBroadcast(context, 0, intent, flags)
    }

    @Suppress("DEPRECATION")
    fun canSchedule(): Boolean {
        val component = ComponentName(context, DeviceToolsTimerReceiver::class.java)
        val receiver = try { context.packageManager.getReceiverInfo(component, 0) }
        catch (_: PackageManager.NameNotFoundException) { null }
        return receiver != null && receiver.enabled && !receiver.exported && context.getSystemService(AlarmManager::class.java) != null
    }

    private fun arm(id: String, ms: Long) {
        if (!canSchedule())
            throw WireFailure("timer_unavailable", "本机计时器接收组件不可用")
        alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, ms, checkNotNull(pending(id, true)))
    }

    fun start(call: WireCall, checkActive: () -> Unit): JSONObject = synchronized(timerLock) {
        checkActive()
        deviceText(call.arguments, "purpose", 120)
        val firesAt = call.arguments.getString("firesAt")
        val ms = timerInstant(firesAt)
        val digest = NativeJson.digest(call.id)
        val id = "timer_" + digest
        val owner = call.callerSubjectId
        val existing = store.getTimerForOwner(id, owner)
        if (existing != null) {
            if (existing.getString("state") == "scheduled") return@synchronized startResult(existing)
            throw WireFailure("timer_schedule_status_unknown", "该命令已处理，不会再次调度")
        }
        checkTimerLead(ms, System.currentTimeMillis())
        notifications.requireEnabled("timer_unavailable")
        if (store.controlMode() == "disabled") throw WireFailure("disabled", "手机已停用远程调用")
        val reservation = try {
            store.reserveTimer(obj("timerId" to id, "sourceCommandId" to call.id, "ownerSubjectId" to owner,
                "notificationId" to "tb_local_timer_$digest", "firesAt" to firesAt, "now" to NativeJson.now()), 32, 8)
        } catch (_: IllegalStateException) { throw WireFailure("result_unknown", "无法安全复用计时器命令") }
        if (reservation.getString("kind") != "reserved")
            throw WireFailure("timer_capacity_reached", "活动计时器数量已达上限")
        val row = reservation.getJSONObject("timer")
        try {
            checkActive()
            checkTimerLead(ms, System.currentTimeMillis())
            arm(id, ms)
            checkActive()
            if (store.controlMode() == "disabled") throw WireFailure("disabled", "手机已停用远程调用")
            check(store.markTimerState(id, listOf("preparing"), "scheduled", NativeJson.now()))
        } catch (e: Exception) {
            cancel(row)
            if (e is WireFailure) throw e
            throw WireFailure("timer_schedule_failed", "系统未能创建计时器", true)
        }
        startResult(row)
    }

    private fun startResult(row: JSONObject) = obj("timerId" to row.getString("timerId"),
        "firesAt" to row.getString("firesAt"), "state" to "scheduled", "scheduling" to "system_accepted",
        "accuracy" to "system_determined")

    fun control(call: WireCall): JSONObject = synchronized(timerLock) {
        call.checkActive()
        val id = call.arguments.getString("timerId")
        if (!timerIdPattern.matches(id)) throw WireFailure("invalid_argument", "计时器标识无效")
        val row = store.getTimerForOwner(id, call.callerSubjectId) ?: notFound()
        if (call.tool == "timer_cancel") return@synchronized cancel(row)
        val stored = row.getString("state")
        val now = NativeJson.now()
        val state = when {
            stored == "cancelled" -> "cancelled"
            row.getString("firesAt") <= now || stored == "deadline_elapsed" -> "deadline_elapsed"
            stored != "scheduled" -> "status_unknown"
            pending(id, false) == null -> "schedule_missing"
            else -> "scheduled"
        }
        // Android exposes the PendingIntent token, but cannot enumerate pending alarms.
        obj("timerId" to id, "firesAt" to row.getString("firesAt"), "observedAt" to now,
            "state" to state, "scheduling" to when (state) {
                "cancelled", "deadline_elapsed", "schedule_missing" -> "not_pending"
                else -> "unknown"
            }, "presentation" to if (state == "scheduled") "system_determined" else "unknown")
    }

    fun cancelLocal(id: String) = synchronized(timerLock) {
        val row = store.listActiveTimers().singleOrNull { it.getString("timerId") == id } ?: notFound()
        cancel(row)
    }

    private fun notFound(): Nothing = throw WireFailure("not_found", "指定计时器不存在")

    private fun clearAlarm(id: String) {
        pending(id, false)?.let { alarms.cancel(it); it.cancel() }
    }

    private fun cancel(row: JSONObject): JSONObject {
        val id = row.getString("timerId")
        if (row.getString("state") != "cancelled") {
            check(store.markTimerState(id, activeStates + "deadline_elapsed", "cancelling", NativeJson.now()))
            try {
                clearAlarm(id)
                notifications.dismiss(row.getString("notificationId"))
                check(store.markTimerState(id, listOf("cancelling"), "cancelled", NativeJson.now()))
            } catch (_: Exception) {
                store.markTimerState(id, listOf("cancelling"), "status_unknown", NativeJson.now())
                throw WireFailure("timer_cancel_status_unknown", "系统未能确认计时器已清理")
            }
            store.pruneTerminalTimers(500)
        }
        return obj("timerId" to id, "state" to "cancelled", "presentation" to "unknown")
    }

    fun reconcile() = synchronized(timerLock) {
        val disabled = store.controlMode() == "disabled"
        for (row in store.listTimersForReconciliation()) {
            val id = row.getString("timerId")
            try {
                when {
                    disabled || row.optString("sourceCommandStatus") != "succeeded" || row.getString("state") != "scheduled" -> cancel(row)
                    // A delayed inexact alarm can wake this process after the deadline.
                    // Let its receiver commit presentation while the token still exists.
                    row.getString("firesAt") <= NativeJson.now() -> {
                        if (pending(id, false) == null)
                            store.markTimerState(id, listOf("scheduled"), "deadline_elapsed", NativeJson.now())
                    }
                    else -> {
                        notifications.requireEnabled("timer_unavailable")
                        // Replacing the same alarm is safe even when only its token survived.
                        arm(id, timerInstant(row.getString("firesAt")))
                    }
                }
            } catch (_: Exception) {
                store.markTimerState(id, activeStates, "status_unknown", NativeJson.now())
            }
        }
        store.pruneTerminalTimers(500)
    }

    fun receive(id: String) = synchronized(timerLock) {
        val row = store.listTimersForReconciliation().singleOrNull { it.getString("timerId") == id }
            ?: return@synchronized
        if (row.getString("state") != "scheduled" || row.optString("sourceCommandStatus") != "succeeded" ||
            store.controlMode() == "disabled") {
            cancel(row)
            return@synchronized
        }
        if (row.getString("firesAt") > NativeJson.now()) return@synchronized
        if (!store.markTimerState(id, listOf("scheduled"), "deadline_elapsed", NativeJson.now())) return@synchronized
        try {
            notifications.requireEnabled("timer_unavailable")
            notifications.post(row.getString("notificationId"), "Tool Bridge", "Agent 计时器已到期")
        } finally {
            clearAlarm(id)
            store.pruneTerminalTimers(500)
        }
    }
}

class DeviceToolsTimerReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != timerAction || intent.data?.scheme != "tb-timer") return
        val id = intent.data?.schemeSpecificPart?.takeIf(timerIdPattern::matches) ?: return
        val pending = goAsync()
        Thread({
            try {
                NativeStore(context).use { DeviceToolsTimers(context, it, DeviceToolsNotifications(context)).receive(id) }
            } catch (_: Exception) {
                // A revoked notification permission must not crash the process or replay a reminder.
            } finally {
                try { (context.applicationContext as? PhoneApp)?.runtime?.refresh() }
                finally { pending.finish() }
            }
        }, "DeviceTools-timer-delivery").start()
    }
}

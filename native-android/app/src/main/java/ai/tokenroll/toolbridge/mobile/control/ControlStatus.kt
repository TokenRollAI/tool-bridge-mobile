package ai.tokenroll.toolbridge.mobile

import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.accessibility.AccessibilityWindowInfo
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.Callable
import java.util.concurrent.ExecutionException
import java.util.concurrent.FutureTask
import java.util.concurrent.TimeUnit

internal fun semanticWindowRef(epoch: String, pkg: String, windowId: Int): String =
    "w" + NativeJson.digest("$epoch/$pkg/$windowId").take(18)

/** Checking readiness never claims the local grant or discloses the package of an unapproved window. */
internal object ControlStatus {
    fun read(call: WireCall): JSONObject {
        call.checkActive()
        if (Looper.myLooper() == Looper.getMainLooper()) return sample(call)
        val task = FutureTask(Callable { sample(call) })
        val main = Handler(Looper.getMainLooper())
        if (!main.post(task)) throw WireFailure("unavailable", "设备运行时已停止")
        val link = call.signal.onCancel { task.cancel(false) }
        try {
            return task.get(2, TimeUnit.SECONDS)
        } catch (error: ExecutionException) {
            throw error.cause ?: error
        } finally {
            task.cancel(false)
            main.removeCallbacks(task)
            link.close()
        }
    }

    private fun isActiveAppWindow(service: PhoneControlService, windowId: Int): Boolean {
        val windows = service.windows
        return try {
            windows.any { it.id == windowId && it.isActive && it.type == AccessibilityWindowInfo.TYPE_APPLICATION }
        } finally {
            windows.forEach { it.recycle() }
        }
    }

    private fun sample(call: WireCall): JSONObject {
        call.checkActive()
        val service = RemoteSession.service
        var app: String? = null
        val state = when {
            service == null -> "service_unavailable"
            !RemoteSession.unlocked(service) -> "locked"
            !RemoteSession.active -> "local_grant_required"
            !RemoteSession.availableTo(call.callerSubjectId) -> "session_in_use"
            else -> {
                val root = service.rootInActiveWindow
                try {
                    val pkg = root?.packageName?.toString()
                    if (root != null && pkg in RemoteSession.packages &&
                        isActiveAppWindow(service, root.windowId)) {
                        app = pkg
                        "ready"
                    } else "awaiting_selected_app"
                } finally { root?.recycle() }
            }
        }
        val available = state == "ready"
        val tools = JSONArray().put("status")
        if (available) {
            for (key in listOf("observe", "tap", "scroll", "type", "back", "media")) tools.put(key)
            if (Build.VERSION.SDK_INT >= 34) tools.put("screenshot")
        }
        val visibleGrant = available || state == "awaiting_selected_app"
        if (visibleGrant && RemoteSession.unlimited) tools.put("apps").put("open_app")
        val remaining: Any = if (!visibleGrant) 0L else RemoteSession.expiresAt?.let {
            (it - SystemClock.elapsedRealtime()).coerceAtLeast(0)
        } ?: JSONObject.NULL
        return obj("v" to 2, "state" to state, "serviceConnected" to (service != null),
            "remainingMs" to remaining, "supported" to tools).apply {
            if (visibleGrant) put("mode", if (RemoteSession.unlimited) "all_apps_until_stopped" else "selected_timed")
            if (app != null) put("app", app)
        }
    }
}

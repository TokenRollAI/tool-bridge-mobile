package ai.tokenroll.toolbridge.mobile

import android.content.ComponentName
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.os.Handler
import android.os.Looper
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.Callable
import java.util.concurrent.ExecutionException
import java.util.concurrent.FutureTask
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException

internal sealed class BroadAppRequest {
    data class Page(val limit: Int, val session: String?, val after: String?) : BroadAppRequest()
    data class Open(val session: String, val app: String) : BroadAppRequest()

    fun checkSession(current: String) {
        val expected = when (this) {
            is Page -> session
            is Open -> session
        }
        if (expected != null && expected != current) denied()
    }

    companion object {
        private val packagePattern = Regex("""[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)*""")
        fun validPackage(value: String) = value.length <= 255 && packagePattern.matches(value)

        fun parse(tool: String, args: JSONObject): BroadAppRequest {
            if ((args.opt("v") as? Number)?.toDouble() != 2.0) invalidWire()
            fun session(value: JSONObject) = value.string("session").takeIf { it.length <= 128 } ?: invalidWire()
            fun pkg(value: JSONObject, key: String) = value.string(key).takeIf(::validPackage) ?: invalidWire()
            return when (tool) {
                "apps" -> {
                    args.only("v", "limit", "cursor")
                    val limit = if (args.has("limit")) {
                        val n = args.opt("limit") as? Number ?: invalidWire()
                        n.toInt().takeIf { it in 1..32 && it.toDouble() == n.toDouble() } ?: invalidWire()
                    } else 16
                    val cursor = if (args.has("cursor")) args.objectField("cursor") else null
                    cursor?.only("session", "after")
                    Page(limit, cursor?.let(::session), cursor?.let { pkg(it, "after") })
                }
                "open_app" -> {
                    args.only("v", "session", "app")
                    Open(session(args), pkg(args, "app"))
                }
                else -> invalidWire()
            }
        }
    }
}

private fun denied(): Nothing = throw WireFailure("permission_denied", "当前授权不允许此请求")

internal fun BroadAppRequest.Page.result(current: String, labels: Map<String, String>): JSONObject {
    checkSession(current)
    val keys = labels.keys.asSequence().filter { after == null || it > after }.sorted().take(limit + 1).toList()
    val page = keys.take(limit)
    val apps = page.map { app ->
        // Avoid splitting a surrogate pair at the wire limit.
        val label = labels.getValue(app).take(80).dropLastWhile { it.isHighSurrogate() }
        obj("app" to app, "label" to label)
    }
    return obj("v" to 2, "session" to current, "apps" to JSONArray(apps)).apply {
        if (keys.size > limit) put("nextCursor", obj("session" to current, "after" to page.last()))
    }
}

internal object BroadAppControl {
    fun invoke(call: WireCall, main: Handler): JSONObject {
        if (call.delivery != "realtime") denied()
        call.checkActive()
        val request = BroadAppRequest.parse(call.tool, call.arguments)
        val run = Callable { execute(call, request) }
        if (Looper.myLooper() == main.looper) return run.call()
        val task = FutureTask(run)
        if (!main.post(task)) throw WireFailure("unavailable", "手机运行时已停止")
        val cancellation = call.signal.onCancel { task.cancel(false) }
        try {
            return task.get((call.expiresAtMs - System.currentTimeMillis()).coerceAtLeast(1), TimeUnit.MILLISECONDS)
        } catch (error: ExecutionException) {
            throw error.cause ?: error
        } catch (_: TimeoutException) {
            throw WireFailure("expired", "请求已超时，请重新查询状态")
        } catch (_: InterruptedException) {
            call.signal.cancel()
            Thread.currentThread().interrupt()
            throw WireFailure("cancelled", "请求已中断，请重新查询状态")
        } finally {
            task.cancel(false)
            main.removeCallbacks(task)
            cancellation.close()
        }
    }

    private fun execute(call: WireCall, request: BroadAppRequest): JSONObject {
        val service = RemoteSession.service ?: denied()
        fun checkGrant(): String {
            call.checkActive()
            if (!RemoteSession.unlimited || call.appGrantAtReceipt !== RemoteSession.packages) denied()
            return RemoteSession.checkGrant(service, call.callerSubjectId, allowUnbound = true)
                .also { request.checkSession(it) }
        }
        val session = checkGrant()
        val eligible = PhoneControlService.allowedApps(service).filterKeys {
            it in RemoteSession.packages && BroadAppRequest.validPackage(it)
        }
        val target = (request as? BroadAppRequest.Open)?.app
        if (target != null && target !in eligible) denied()
        val launcher = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER).setPackage(target)
        val pm = service.packageManager
        val components = linkedMapOf<String, ComponentName>()
        for (match in pm.queryIntentActivities(launcher, 0)) {
            val info = match.activityInfo ?: continue
            val pkg = info.packageName
            if (pkg !in eligible || (target != null && pkg != target) || !info.exported ||
                info.applicationInfo.flags and ApplicationInfo.FLAG_SUSPENDED != 0) continue
            if (info.permission != null && service.checkSelfPermission(info.permission) != PackageManager.PERMISSION_GRANTED) continue
            if (pkg !in components) components[pkg] = ComponentName(pkg, info.name)
        }

        return when (request) {
            is BroadAppRequest.Page -> {
                val page = request.result(session, eligible.filterKeys { it in components })
                checkGrant()
                RemoteSession.requireGrant(service, call.callerSubjectId)
                call.checkActive()
                page
            }
            is BroadAppRequest.Open -> {
                val component = components[request.app] ?: denied()
                launcher.setComponent(component).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED)
                service.discardObservation()
                checkGrant()
                RemoteSession.requireGrant(service, call.callerSubjectId)
                call.checkActive()
                try {
                    service.startActivity(launcher)
                } catch (_: RuntimeException) {
                    throw WireFailure("unavailable", "启动请求未能确认，请重新查询状态")
                }
                obj("v" to 2, "app" to request.app, "dispatch" to "sent")
            }
        }
    }
}

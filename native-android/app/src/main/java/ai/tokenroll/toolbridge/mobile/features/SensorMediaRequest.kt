@file:Suppress("DEPRECATION")

package ai.tokenroll.toolbridge.mobile

import android.app.Activity
import android.app.AlertDialog
import android.app.Dialog
import android.app.Fragment
import android.app.KeyguardManager
import android.content.pm.PackageManager
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.os.SystemClock
import org.json.JSONObject
import java.util.concurrent.CompletableFuture
import java.util.concurrent.ExecutionException
import java.util.concurrent.ExecutorService
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException

internal fun sensorFailure(code: String, message: String): Nothing = throw WireFailure(code, message)
internal fun sensorForeground(host: Activity?) = host != null && !host.isFinishing && !host.isDestroyed &&
    host.getSystemService(KeyguardManager::class.java)?.isDeviceLocked == false &&
    host.getSystemService(PowerManager::class.java)?.isInteractive == true

// The framework can recreate this fragment after process death. It never restores a remote request.
class SensorMediaPermissionFragment : Fragment() {
    internal var request: SensorMediaRequest? = null
    private var continuation: (() -> Unit)? = null
    private var permissionReturned = false

    internal fun ask(names: Array<String>, ready: () -> Unit) {
        continuation = ready
        requestPermissions(names, 1)
    }

    override fun onRequestPermissionsResult(code: Int, names: Array<out String>, results: IntArray) {
        super.onRequestPermissionsResult(code, names, results)
        if (code == 1) {
            permissionReturned = true
            resumePermission()
        }
    }

    override fun onResume() {
        super.onResume()
        if (request == null) fragmentManager?.beginTransaction()?.remove(this)?.commitAllowingStateLoss()
        else resumePermission()
    }

    private fun resumePermission() {
        val op = request ?: return
        op.main.post {
            if (isResumed && permissionReturned) {
                val ready = continuation
                continuation = null
                permissionReturned = false
                if (ready != null) op.guard(ready)
            }
        }
    }

    override fun onPause() {
        if (continuation == null) request?.foregroundLost()
        super.onPause()
    }

    override fun onStop() {
        request?.foregroundLost()
        super.onStop()
    }
}

internal class SensorMediaRequest(
    val call: WireCall, val host: Activity, private val currentHost: () -> Activity?,
    private val pool: ExecutorService, timeoutMs: Long,
) {
    val main = Handler(Looper.getMainLooper())
    private val deadline = SystemClock.elapsedRealtime() + timeoutMs.coerceAtLeast(0)
    private val result = CompletableFuture<JSONObject>()
    private val cleanup = mutableListOf<() -> Unit>()
    private val fragment = SensorMediaPermissionFragment()
    val caller = call.callerDisplayName.take(120).replace(unsafeDeviceText, " ").trim().ifEmpty { "远程调用方" }
    private var dialog: Dialog? = null
    private fun timeout() = if (System.currentTimeMillis() >= call.expiresAtMs) WireFailure("expired", "调用已过期")
        else WireFailure("timeout", "操作已超时", true)
    private val expired = Runnable { fail(timeout()) }

    fun run(start: () -> Unit): JSONObject {
        val sub = call.signal.onCancel {
            fail(if (System.currentTimeMillis() >= call.expiresAtMs) timeout() else WireFailure("cancelled", "操作已取消"))
        }
        try {
            main.post {
                guard {
                    fragment.request = this
                    host.fragmentManager.beginTransaction().add(fragment, null).commitNow()
                    onEnd {
                        fragment.request = null
                        if (fragment.isAdded) host.fragmentManager.beginTransaction().remove(fragment).commitAllowingStateLoss()
                    }
                    main.postDelayed(expired, remaining())
                    start()
                }
            }
            return try { result.get(remaining(), TimeUnit.MILLISECONDS) }
            catch (_: TimeoutException) {
                fail(timeout())
                result.get()
            }
        } catch (e: ExecutionException) {
            throw e.cause ?: e
        } catch (e: InterruptedException) {
            fail(WireFailure("cancelled", "操作已取消"))
            Thread.currentThread().interrupt()
            throw WireFailure("cancelled", "操作已取消")
        } finally { sub.close() }
    }

    private fun remaining() = minOf(deadline - SystemClock.elapsedRealtime(),
        call.expiresAtMs - System.currentTimeMillis()).coerceAtLeast(0)

    fun succeeded() = result.isDone && !result.isCompletedExceptionally

    fun check() {
        call.checkActive()
        if (result.isDone) sensorFailure("cancelled", "操作已结束")
        if (remaining() == 0L) sensorFailure("timeout", "操作已超时")
        if (currentHost() !== host || !sensorForeground(host)) sensorFailure("foreground_required", "请保持手机解锁并停留在应用前台")
    }

    fun guard(action: () -> Unit) {
        if (result.isDone) return
        try { check(); action() }
        catch (e: Exception) { fail(safeError(e)) }
    }

    private fun safeError(e: Exception) = when (e) {
        is WireFailure -> e
        is SecurityException -> WireFailure("permission_denied", "系统拒绝了此操作")
        else -> WireFailure("unavailable", "系统无法完成此操作", true)
    }

    fun <T> io(discard: (T) -> Unit = {}, work: () -> T, receive: (T) -> Unit) {
        pool.execute {
            try {
                check()
                val value = work()
                main.post {
                    try { if (!result.isDone) { check(); receive(value) } }
                    catch (e: Exception) { fail(safeError(e)) }
                    finally { discard(value) }
                }
            } catch (e: Exception) { fail(safeError(e)) }
        }
    }

    fun granted(name: String) = host.checkSelfPermission(name) == PackageManager.PERMISSION_GRANTED

    fun permission(names: Array<String>, message: String, ready: () -> Unit) {
        if (names.any(::granted)) { ready(); return }
        prompt("需要系统授权", message, "请求权限") {
            fragment.ask(names) {
                if (!names.any(::granted)) sensorFailure("permission_denied", "未获得前台权限，请在系统设置中检查授权")
                ready()
            }
        }
    }

    fun show(next: Dialog) {
        check()
        dialog?.dismiss()
        dialog = next
        next.setOnCancelListener { reject() }
        next.show()
    }

    fun prompt(title: String, message: String, action: String, next: () -> Unit) {
        show(AlertDialog.Builder(host).setTitle(title).setMessage(message)
            .setPositiveButton(action) { _, _ -> guard(next) }
            .setNegativeButton("取消") { _, _ -> reject() }.create())
    }

    fun reject() = fail(WireFailure("user_rejected", "用户已取消"))
    fun foregroundLost() = fail(WireFailure("foreground_required", "应用已离开前台"))
    fun onEnd(action: () -> Unit) { cleanup.add(action) }

    private fun release() {
        main.removeCallbacks(expired)
        runCatching { dialog?.dismiss() }
        dialog = null
        cleanup.asReversed().forEach { runCatching(it) }
        cleanup.clear()
    }

    fun finish(output: JSONObject) {
        check()
        if (result.complete(output)) release()
    }

    fun fail(error: WireFailure) {
        if (!result.completeExceptionally(error)) return
        call.signal.cancel()
        if (Looper.myLooper() == main.looper) release() else main.post { release() }
    }
}

package ai.tokenroll.toolbridge.mobile

import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import org.json.JSONObject
import java.util.concurrent.CompletableFuture
import java.util.concurrent.ExecutionException
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException

/** Cancellation and entry into the single framework action are ordered across main and wire threads. */
internal class ScopedDispatchResult {
    val result = CompletableFuture<JSONObject>()
    private var dispatch = "not_sent"

    @Synchronized
    fun begin(checkActive: () -> Unit): Boolean {
        if (result.isDone || dispatch != "not_sent") return false
        checkActive()
        dispatch = "unknown"
        return true
    }

    @Synchronized
    fun dispatched() { dispatch = "sent" }

    @Synchronized
    fun stop(error: Throwable) {
        if (dispatch == "not_sent") result.completeExceptionally(error)
        else result.complete(scopedReceipt(dispatch, "result_unknown"))
    }
}

/** Only the wire worker waits. Main-loop callbacks after dispatch can only sample or finish. */
internal class ScopedActionCall private constructor(val wire: WireCall, private val main: Handler) {
    val dispatch = ScopedDispatchResult()
    private val result get() = dispatch.result
    private val callbackToken = Any()

    fun finish(value: JSONObject) { result.complete(value) }

    fun post(delay: Long = 0, block: () -> Unit) {
        if (result.isDone) return
        val posted = main.postAtTime({
            if (!result.isDone) {
                try {
                    wire.checkActive()
                    block()
                } catch (error: Exception) {
                    dispatch.stop(error)
                }
            }
        }, callbackToken, SystemClock.uptimeMillis() + delay)
        if (!posted) dispatch.stop(WireFailure("unavailable", "手机运行时已停止"))
    }

    companion object {
        fun invoke(wire: WireCall, main: Handler): JSONObject {
            check(Looper.myLooper() != main.looper)
            wire.checkActive()
            val call = ScopedActionCall(wire, main)
            val cancel = wire.signal.onCancel {
                val error = if (RemoteSession.active) WireFailure("cancelled", "远控调用已取消")
                    else WireFailure("permission_denied", "本次远控授权已结束")
                call.dispatch.stop(error)
            }
            try {
                call.post {
                    val service = RemoteSession.service ?: throw WireFailure("unavailable", "无障碍服务已断开")
                    service.scopedActions.start(call)
                }
                val remaining = (wire.expiresAtMs - System.currentTimeMillis()).coerceIn(1L, 6_000L)
                try {
                    return call.result.get(remaining, TimeUnit.MILLISECONDS)
                } catch (_: TimeoutException) {
                    call.dispatch.stop(WireFailure("timeout", "远控调用超时"))
                    return call.result.get()
                } catch (error: InterruptedException) {
                    call.dispatch.stop(WireFailure("cancelled", "远控调用已中断"))
                    Thread.currentThread().interrupt()
                    return call.result.get()
                }
            } catch (error: ExecutionException) {
                throw error.cause ?: error
            } finally {
                main.removeCallbacksAndMessages(call.callbackToken)
                cancel.close()
            }
        }
    }
}

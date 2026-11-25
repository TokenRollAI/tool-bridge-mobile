package ai.tokenroll.toolbridge.mobile

import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONObject
import java.io.Closeable
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.Executors
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit.MILLISECONDS

enum class GatewayState { SUSPENDED, CONNECTING, READY, RECONNECTING, CREDENTIALS_REQUIRED, CLOSED }

/** One device identity at one origin. onState is serialized; execute runs off the socket thread. */
class GatewayConnection internal constructor(
    private val device: WireDevice,
    private val onState: (GatewayState) -> Unit = {},
    private val heartbeatMs: Long = 30_000L,
    private val sockets: WebSocket.Factory,
) : Closeable {
    constructor(device: WireDevice, onState: (GatewayState) -> Unit = {}) :
        this(device, onState, 30_000L, device.http)

    init { require(heartbeatMs > 0) }

    private val control = Executors.newSingleThreadScheduledExecutor()
    private val workers = ThreadPoolExecutor(4, 4, 30, java.util.concurrent.TimeUnit.SECONDS, ArrayBlockingQueue(32))
    @Volatile private var scope: WireSignal? = null
    @Volatile private var closed = false
    @Volatile var state = GatewayState.SUSPENDED
        private set
    @Volatile var mountPath: String? = null
        private set

    // Only the control thread mutates socket/session state and the result cache.
    private var socket: WebSocket? = null
    private var socketScope: WireSignal? = null
    private var timer: ScheduledFuture<*>? = null
    private var alive = true
    private var retryMs = 500L
    private var principal: String? = null
    private val results = LinkedHashMap<String, String>()
    private val calls = mutableMapOf<String, Pending>()
    private class Pending(val signal: WireSignal, val link: Closeable, var replyTo: WebSocket) {
        var deadline: ScheduledFuture<*>? = null
    }

    fun setEnabled(enabled: Boolean) {
        val previous = synchronized(this) {
            if (closed || enabled == (scope != null)) return
            val old = scope
            val current = if (enabled) WireSignal() else null
            scope = current
            post {
                disconnect()
                if (scope !== current || closed) return@post
                if (current == null) publish(GatewayState.SUSPENDED)
                else {
                    retryMs = 500
                    publish(GatewayState.CONNECTING)
                    connect(current)
                }
            }
            old
        }
        previous?.cancel()
    }

    override fun close() {
        val previous = synchronized(this) {
            if (closed) return
            closed = true
            val old = scope
            scope = null
            post {
                disconnect()
                calls.values.forEach { it.deadline?.cancel(false); it.link.close() }
                calls.clear()
                workers.shutdown()
                results.clear()
                publish(GatewayState.CLOSED)
                control.shutdown()
            }
            old
        }
        previous?.cancel()
    }

    private fun post(action: () -> Unit) {
        try { control.execute(action) } catch (_: RejectedExecutionException) { /* already closed */ }
    }

    private fun publish(next: GatewayState) {
        if (state == next) return
        state = next
        runCatching { onState(next) }
    }

    private fun disconnect() {
        timer?.cancel(false)
        timer = null
        val old = socket
        socket = null
        socketScope = null
        mountPath = null
        old?.cancel()
        calls.values.toList().forEach { it.signal.cancel() }
    }

    private fun retry(current: WireSignal) {
        disconnect()
        if (scope !== current || closed) return
        publish(GatewayState.RECONNECTING)
        timer = control.schedule({ connect(current) }, retryMs, MILLISECONDS)
        retryMs = minOf(30_000L, retryMs * 2)
    }

    private fun rejected(current: WireSignal, credential: WireCredential? = null) {
        synchronized(this) {
            if (scope !== current || closed) return
            scope = null
        }
        current.cancel()
        disconnect()
        publish(GatewayState.CREDENTIALS_REQUIRED)
        if (credential != null) runCatching { device.onCredentialInvalid(credential) }
    }

    private fun connect(current: WireSignal) {
        if (scope !== current || closed) return
        val credential = try { device.currentCredential() } catch (_: Exception) {
            rejected(current)
            return
        }
        if (principal != null && principal != credential.keyId) {
            rejected(current)
            return
        }
        principal = credential.keyId
        val hello = try {
            JSONObject().put("type", "hello").put("deviceId", device.deviceId)
                .put("mountPath", "device/phone/" + device.deviceId)
                .put("expose", JSONObject().put("nodes", device.wireNodes())).toString()
        } catch (_: Exception) {
            close()
            return
        }
        val url = device.origin.newBuilder().encodedPath("/system/device/ws")
            .addQueryParameter("deviceId", device.deviceId).build()
        val request = Request.Builder().url(url).header("Authorization", "Bearer " + credential.material).build()
        if (scope !== current) return
        socketScope = current
        socket = sockets.newWebSocket(request, object : WebSocketListener() {
            fun active(ws: WebSocket) = scope === current && !closed && socket === ws
            override fun onOpen(webSocket: WebSocket, response: Response) = post {
                if (!active(webSocket)) { webSocket.cancel(); return@post }
                if (!webSocket.send(hello)) { retry(current); return@post }
                alive = true
                timer = control.scheduleAtFixedRate({
                    if (active(webSocket)) {
                        if (!alive || !webSocket.send("""{"type":"ping"}""")) retry(current)
                        else alive = false
                    }
                }, heartbeatMs, heartbeatMs, MILLISECONDS)
            }
            override fun onMessage(webSocket: WebSocket, text: String) = post {
                if (!active(webSocket)) return@post
                alive = true
                try {
                    val frame = JSONObject(text)
                    when (frame.string("type")) {
                        "ready" -> if (state == GatewayState.CONNECTING || state == GatewayState.RECONNECTING) {
                            mountPath = frame.string("mountPath")
                            retryMs = 500
                            publish(GatewayState.READY)
                        }
                        "ping" -> if (!webSocket.send("""{"type":"pong"}""")) retry(current)
                        "error" -> {
                            val error = frame.objectField("error")
                            if (error.opt("code") in errorCodes && error.opt("message") is String &&
                                error.opt("retryable") is Boolean) rejected(current, credential)
                        }
                        "cancel" -> calls[frame.string("id")]?.signal?.cancel()
                        "call" -> if (state == GatewayState.READY) dispatch(webSocket, current, credential, frame)
                    }
                } catch (_: Exception) { /* Ignore invalid wire frames. Never echo the payload. */ }
            }
            override fun onClosing(webSocket: WebSocket, code: Int, reason: String) = post {
                if (active(webSocket)) retry(current)
            }
            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) = post {
                if (active(webSocket)) retry(current)
            }
            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) = post {
                if (active(webSocket)) {
                    if (response?.code == 401 || response?.code == 403) rejected(current, credential)
                    else retry(current)
                }
            }
        })
    }

    private fun dispatch(ws: WebSocket, current: WireSignal, credential: WireCredential, frame: JSONObject) {
        val id = frame.string("id")
        results[id]?.let { ws.send(it); return }
        calls[id]?.let { it.replyTo = ws; return }
        val signal = WireSignal()
        val pending = Pending(signal, current.onCancel(signal::cancel), ws)
        calls[id] = pending
        val call = try { device.call(id, frame, credential, signal, "realtime") } catch (e: Exception) {
            finish(id, pending, failure(id, e.safeFailure(signal)))
            return
        }
        pending.deadline = control.schedule({ signal.cancel() },
            maxOf(0, call.expiresAtMs - System.currentTimeMillis()), MILLISECONDS)
        try {
            workers.execute {
                val result = try {
                    val value = device.invokeCall(call)
                    JSONObject().put("type", "result").put("id", id).put("ok", true).put("value", value)
                } catch (e: Exception) {
                    failure(id, e.safeFailure(signal))
                }
                post { finish(id, pending, result) }
            }
        } catch (_: RejectedExecutionException) {
            finish(id, pending, failure(id, WireFailure("rate_limited", "Device executor busy", true)))
        }
    }

    private fun finish(id: String, pending: Pending, result: JSONObject) {
        if (calls[id] !== pending) return
        pending.deadline?.cancel(false)
        pending.link.close()
        calls.remove(id)
        val reply = result.toString()
        results[id] = reply
        if (results.size > 1000) results.remove(results.keys.first())
        if (socketScope != null && socketScope === scope && state == GatewayState.READY && socket === pending.replyTo) {
            if (!pending.replyTo.send(reply)) scope?.let(::retry)
        }
    }

    private fun failure(id: String, failure: WireFailure): JSONObject =
        JSONObject().put("type", "result").put("id", id).put("ok", false).put("error", failure.body())

    private companion object {
        val errorCodes = setOf("permission_denied", "invalid_argument", "not_found", "conflict",
            "unavailable", "internal", "rate_limited")
    }
}

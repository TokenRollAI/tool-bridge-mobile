package ai.tokenroll.toolbridge.mobile

import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.io.Closeable
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit.MILLISECONDS
import java.util.concurrent.TimeUnit.NANOSECONDS

/** put must commit before it returns. Entries contain metadata and terminal replies only. */
class WireJournal(
    val get: (String) -> JSONObject?,
    val put: (JSONObject) -> Unit,
    val remove: (String) -> Unit,
)

/** Explicit foreground drain. The caller owns when to start it and its installation-local journal. */
class GatewayMailbox(private val device: WireDevice, private val journal: WireJournal) : Closeable {
    private var active: WireSignal? = null
    private var closed = false

    fun cancel() { synchronized(this) { active }?.cancel() }

    override fun close() {
        synchronized(this) { closed = true; active }?.cancel()
    }

    fun drain(maxOperations: Int = 20): Int {
        require(maxOperations in 1..200)
        val signal = synchronized(this) {
            if (closed) throw WireFailure("unavailable", "Mailbox closed")
            if (active != null) throw WireFailure("conflict", "Mailbox already active")
            WireSignal().also { active = it }
        }
        try {
            val credential = device.currentCredential()
            var processed = 0
            var cursor: String? = null
            val seen = mutableSetOf<String>()
            while (processed < maxOperations) {
                val page = control("claim", JSONObject().put("cursor", cursor), credential, signal)
                val serverNow = epoch(page.string("serverNow"))
                if (page.has("operation")) {
                    process(page.objectField("operation"), serverNow, credential, signal)
                    processed++
                    cursor = null
                    seen.clear()
                } else {
                    if (!page.has("cursor")) break
                    cursor = page.string("cursor")
                    if (!seen.add(cursor) || seen.size > 200) throw WireFailure("unavailable", "Invalid mailbox cursor")
                }
            }
            return processed
        } finally {
            signal.cancel()
            synchronized(this) { active = null }
        }
    }

    private fun control(action: String, body: JSONObject, initial: WireCredential, signal: WireSignal): JSONObject {
        signal.checkActive()
        val cred = device.currentCredential()
        if (initial.keyId != cred.keyId) throw WireFailure("permission_denied", "Mailbox credential changed")
        val request = Request.Builder().url(device.origin.resolve("/~device/mailbox/" + action)!!)
            .header("Authorization", "Bearer " + cred.material).header("Accept", "application/json")
            .post(body.put("deviceId", device.deviceId).toString().toRequestBody(jsonMedia)).build()
        return device.request(request, signal, onUnauthorized = {
            close()
            device.onCredentialInvalid(cred)
        })
    }

    private fun queueable(path: String): Boolean {
        val nodes = device.wireNodes()
        for (i in 0 until nodes.length()) {
            val node = nodes.getJSONObject(i)
            if (node.string("kind") != "tool") continue
            val commands = node.optJSONArray("cmds") ?: continue
            for (j in 0 until commands.length()) {
                val command = commands.getJSONObject(j)
                if ((node.string("path") + "/" + command.string("name")).equals(path, ignoreCase = true) &&
                    command.opt("delivery") in setOf("mailbox", "both")) return true
            }
        }
        return false
    }

    private fun process(operation: JSONObject, serverNow: Long, cred: WireCredential, outer: WireSignal) {
        val receivedNs = System.nanoTime()
        val id = operation.string("operationId")
        val leaseId = operation.string("leaseId")
        val expiresAt = operation.string("expiresAt")
        val expiry = epoch(expiresAt)
        val lease = epoch(operation.string("leaseUntil"))
        val path = operation.string("path")
        if (operation.byteCount("attempt") < 1 || lease <= serverNow) invalidWire()
        operation.string("targetPath")
        if (operation.has("cancelRequestedAt")) epoch(operation.string("cancelRequestedAt"))
        fun persist(state: String, completion: JSONObject? = null) {
            journal.put(JSONObject().put("operationId", id).put("expiresAt", expiresAt).put("updatedAt", nowIso())
                .put("state", state).put("completion", completion))
        }
        val existing = journal.get(id)
        if (existing != null) {
            if (existing.string("operationId") != id ||
                existing.has("completion") != (existing.string("state") == "terminal")) invalidWire()
            epoch(existing.string("expiresAt"))
            epoch(existing.string("updatedAt"))
        }
        val terminal = when (existing?.string("state")) {
            "terminal" -> existing.objectField("completion")
            "executing" -> unknown()
            null, "discovered" -> {
                if (existing == null) persist("discovered")
                outer.checkActive()
                if (operation.has("cancelRequestedAt") || expiry <= maxOf(serverNow, System.currentTimeMillis()) || !queueable(path)) {
                    JSONObject().put("outcome", "rejected").put("error",
                        WireFailure("invalid_argument", "Operation cancelled, expired or unavailable").body())
                } else {
                    val context = JSONObject().put("caller", operation.objectField("caller"))
                        .put("createdAt", operation.string("createdAt")).put("expiresAt", expiresAt)
                        .put("traceId", operation.string("traceId"))
                    val frame = JSONObject().put("path", path).put("context", context)
                        .put("arguments", operation.objectField("arguments"))
                    val inner = WireSignal()
                    val link = outer.onCancel(inner::cancel)
                    try {
                        val call = device.call(id, frame, cred, inner, "mailbox")
                        call.checkActive()
                        persist("executing")
                        val elapsedMs = NANOSECONDS.toMillis(System.nanoTime() - receivedNs)
                        val remaining = lease - serverNow - elapsedMs
                        if (remaining <= 0) {
                            JSONObject().put("outcome", "rejected").put("error",
                                WireFailure("unavailable", "Lease expired before execution").body())
                        } else executeLeased(call, cred, leaseId, remaining)
                    } finally {
                        link.close()
                        inner.cancel()
                    }
                }
            }
            else -> invalidWire()
        }
        if (existing?.opt("state") != "terminal") persist("terminal", terminal)
        val body = JSONObject(terminal.toString()).put("operationId", id).put("leaseId", leaseId)
        val ack = control("complete", body, cred, outer)
        if (ack.string("operationId") != id || ack.string("deviceId") != device.deviceId ||
            ack.string("state") != terminal.string("outcome")) throw WireFailure("unavailable", "Invalid mailbox receipt")
        journal.remove(id)
    }

    private fun executeLeased(call: WireCall, cred: WireCredential, leaseId: String, remainingMs: Long): JSONObject {
        val timers = Executors.newScheduledThreadPool(2)
        val renewal = WireSignal()
        val link = call.signal.onCancel(renewal::cancel)
        var leaseTimeout: java.util.concurrent.ScheduledFuture<*>? = null
        fun schedule(remaining: Long) {
            renewal.checkActive()
            leaseTimeout?.cancel(false)
            leaseTimeout = timers.schedule(call.signal::cancel, remaining, MILLISECONDS)
            timers.schedule({
                try {
                    val body = JSONObject().put("operationId", call.id).put("leaseId", leaseId)
                    val ack = control("renew", body, cred, renewal)
                    val left = epoch(ack.string("leaseUntil")) - epoch(ack.string("serverNow"))
                    if (left <= 0 || ack.has("cancelRequestedAt")) call.signal.cancel()
                    else schedule(left)
                } catch (_: Exception) {
                    if (!renewal.cancelled) call.signal.cancel()
                }
            }, maxOf(250L, remaining / 2), MILLISECONDS)
        }
        return try {
            schedule(remainingMs)
            timers.schedule(call.signal::cancel, maxOf(0L, call.expiresAtMs - System.currentTimeMillis()), MILLISECONDS)
            val value = device.invokeCall(call)
            JSONObject().put("outcome", "succeeded").put("result", value)
        } catch (e: Exception) {
            if (call.signal.cancelled) unknown()
            else JSONObject().put("outcome", "failed").put("error", e.safeFailure(call.signal).body())
        } finally {
            renewal.cancel()
            link.close()
            timers.shutdownNow()
        }
    }

    private fun unknown() = JSONObject().put("outcome", "result_unknown").put("error",
        WireFailure("unavailable", "Operation interrupted after execution began").body())
}

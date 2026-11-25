package ai.tokenroll.toolbridge.mobile

import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Request
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.Buffer
import okio.ByteString
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.IOException
import java.util.concurrent.CountDownLatch
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit.SECONDS

class GatewayWireTest {
    private val origin = "https://gateway.example"
    private val credential = WireCredential(origin, "device1", "gateway-key", "device-test-value")
    private val future = "2099-02-03T12:00:00Z"
    private val then = "2025-03-07T08:00:00+08:00"

    private fun device(
        http: OkHttpClient = OkHttpClient(),
        invalidated: (WireCredential) -> Unit = {},
        execute: (WireCall) -> Any?,
    ) = WireDevice(origin, "device1", { credential }, {
        JSONArray().put(JSONObject().put("path", "phone/inbox").put("kind", "tool").put("description", "Inbox")
            .put("cmds", JSONArray().put(JSONObject().put("name", "deliver").put("delivery", "both"))))
    }, execute, invalidated, http)

    private fun <T> LinkedBlockingQueue<T>.next(): T = poll(4, SECONDS) ?: error("Timed out")
    private val sockets = LinkedBlockingQueue<Socket>()
    private val factory = WebSocket.Factory { request, listener -> Socket(request, listener).also(sockets::add) }

    private inner class Socket(val req: Request, val listener: WebSocketListener) : WebSocket {
        val sent = LinkedBlockingQueue<String>()
        val stopped = CountDownLatch(1)
        override fun request() = req
        override fun queueSize() = 0L
        override fun send(text: String) = sent.offer(text)
        override fun send(bytes: ByteString) = error("unexpected binary frame")
        override fun close(code: Int, reason: String?): Boolean { stopped.countDown(); return true }
        override fun cancel() = stopped.countDown()
        fun receive(json: String) = listener.onMessage(this, json)
        fun open() = listener.onOpen(this, response(req, 101, ""))
        fun pingBarrier() {
            receive("""{"type":"ping"}""")
            assertEquals("""{"type":"pong"}""", sent.next())
        }
        fun ready() = receive("""{"type":"ready","mountPath":"device/phone/device1"}""")
    }

    private fun call(id: String) = JSONObject().put("type", "call").put("id", id)
        .put("path", "nested/inbox/deliver").put("arguments", JSONObject())

    @Test fun handshakeDispatchCancelAndReplay() {
        val calls = LinkedBlockingQueue<WireCall>()
        val runtime = device {
            calls.add(it)
            if (it.id == "cancel") {
                val cancelled = CountDownLatch(1)
                it.signal.onCancel(cancelled::countDown).use { assertTrue(cancelled.await(3, SECONDS)) }
                it.checkActive()
            }
            JSONObject().put("stored", true)
        }
        GatewayConnection(runtime, sockets = factory).use { connection ->
            connection.setEnabled(true)
            val ws = sockets.next()
            assertEquals("/system/device/ws?deviceId=device1", ws.req.url.encodedPath + "?" + ws.req.url.encodedQuery)
            assertEquals("Bearer device-test-value", ws.req.header("Authorization"))
            ws.open()
            val hello = JSONObject(ws.sent.next())
            assertEquals("hello", hello.getString("type"))
            assertEquals("device/phone/device1", hello.getString("mountPath"))
            assertEquals("inbox", hello.getJSONObject("expose").getJSONArray("nodes").getJSONObject(0).getString("path"))
            ws.receive(call("early").toString())
            ws.pingBarrier()
            assertTrue(calls.isEmpty())
            ws.ready()
            val ctx = JSONObject().put("traceId", "trace").put("caller", JSONObject().put("keyId", "agent1").put("owner", "owner"))
                .put("createdAt", then).put("expiresAt", future)
            val frame = call("once").put("context", ctx).toString()
            ws.receive(frame)
            val first = calls.next()
            assertEquals("phone/nested/inbox", first.path)
            assertEquals("deliver", first.tool)
            assertEquals("agent1", first.callerSubjectId)
            assertEquals(epoch("2025-03-07T00:00:00Z"), first.createdAtMs)
            assertTrue(first.expiresAtMs <= System.currentTimeMillis() + 30_000)
            val reply = ws.sent.next()
            assertTrue(JSONObject(reply).getJSONObject("value").getBoolean("stored"))
            ws.receive(frame)
            assertEquals(reply, ws.sent.next())
            assertTrue(calls.isEmpty())
            ws.receive(call("cancel").toString())
            val pending = calls.next()
            assertEquals("gateway-key", pending.callerSubjectId)
            ws.receive("""{"type":"cancel","id":"cancel"}""")
            assertEquals("unavailable", JSONObject(ws.sent.next()).getJSONObject("error").getString("code"))
            connection.setEnabled(false)
            assertTrue(ws.stopped.await(2, SECONDS))
            ws.receive(call("late").toString())
            connection.setEnabled(true)
            val next = sockets.next()
            next.open()
            assertEquals("hello", JSONObject(next.sent.next()).getString("type"))
            next.pingBarrier()
            assertTrue(calls.isEmpty())
        }
    }

    @Test fun heartbeatReconnectAndRevocationIgnoreOldSocket() {
        val invalid = LinkedBlockingQueue<WireCredential>()
        val states = LinkedBlockingQueue<GatewayState>()
        GatewayConnection(device(invalidated = invalid::add) { error("unexpected call") },
            onState = states::add, heartbeatMs = 80, sockets = factory).use { connection ->
            connection.setEnabled(true)
            val old = sockets.next()
            old.open()
            old.sent.next()
            assertEquals("""{"type":"ping"}""", old.sent.next())
            val next = sockets.next()
            old.receive("""{"type":"error","error":{"code":"permission_denied","retryable":false,"message":"old"}}""")
            next.open()
            assertEquals("hello", JSONObject(next.sent.next()).getString("type"))
            assertTrue(invalid.isEmpty())
            next.receive("""{"type":"error","error":{"code":"permission_denied","retryable":false,"message":"expired"}}""")
            assertSame(credential, invalid.next())
            assertEquals(GatewayState.CREDENTIALS_REQUIRED, connection.state)
            assertTrue(states.contains(GatewayState.RECONNECTING))
        }
    }

    private fun response(req: Request, code: Int, body: String) = Response.Builder()
        .request(req).protocol(Protocol.HTTP_1_1).code(code).message("test").body(body.toResponseBody()).build()

    private fun client(reply: (Request, JSONObject) -> JSONObject): OkHttpClient =
        OkHttpClient.Builder().addInterceptor { chain ->
            val req = chain.request()
            val body = if (req.method == "POST") {
                val buffer = Buffer()
                req.body!!.writeTo(buffer)
                JSONObject(buffer.readUtf8())
            } else JSONObject()
            response(req, 200, reply(req, body).toString())
        }.build()

    private fun operation() = JSONObject().put("operationId", "operation1").put("leaseId", "lease1")
        .put("caller", JSONObject().put("keyId", "agent").put("owner", "writer"))
        .put("createdAt", then).put("expiresAt", future).put("leaseUntil", future)
        .put("path", "inbox/deliver").put("targetPath", "device/phone/device1/inbox/deliver")
        .put("traceId", "trace").put("attempt", 1).put("arguments", JSONObject().put("body", "private-body"))

    @Test fun mailboxCommitBeforeExecutionAndReplayOnlyResult() {
        var stored: JSONObject? = null
        var failComplete = true
        var acked = false
        var executions = 0
        val journal = WireJournal({ stored }, { row ->
            assertFalse(row.toString().contains("private-body"))
            stored = row
        }, { stored = null })
        val http = client { req, body ->
            assertEquals("Bearer device-test-value", req.header("Authorization"))
            when (req.url.encodedPath) {
                "/~device/mailbox/claim" -> JSONObject().put("serverNow", then)
                    .also { if (!acked) it.put("operation", operation()) }
                "/~device/mailbox/complete" -> {
                    assertEquals("terminal", stored!!.getString("state"))
                    assertEquals("lease1", body.getString("leaseId"))
                    if (failComplete) throw IOException("lost reply")
                    acked = true
                    JSONObject().put("deviceId", "device1").put("operationId", "operation1").put("state", body.getString("outcome"))
                }
                else -> error("Unexpected request")
            }
        }
        val runtime = device(http) { call ->
            assertEquals("executing", stored!!.getString("state"))
            assertEquals("mailbox", call.delivery)
            assertEquals(epoch(future), call.expiresAtMs)
            assertNull(call.upload)
            executions++
            JSONObject().put("messageId", "receipt")
        }
        GatewayMailbox(runtime, journal).use { mailbox ->
            assertThrows(WireFailure::class.java) { mailbox.drain() }
        }
        failComplete = false
        GatewayMailbox(runtime, journal).use { mailbox -> assertEquals(1, mailbox.drain()) }
        assertNull(stored)
        assertEquals(1, executions)
        stored = JSONObject().put("state", "executing").put("operationId", "operation1")
            .put("updatedAt", then).put("expiresAt", future)
        acked = false
        val outcomes = mutableListOf<String>()
        val recovery = WireJournal({ stored }, { row ->
            stored = row
            outcomes.add(row.getJSONObject("completion").getString("outcome"))
        }, { stored = null })
        GatewayMailbox(runtime, recovery).use { mailbox -> assertEquals(1, mailbox.drain()) }
        assertEquals(listOf("result_unknown"), outcomes)
        assertEquals(1, executions)
    }

    @Test fun renewalCancellationReportsUncertainOutcome() {
        var row: JSONObject? = null
        val journal = WireJournal({ row }, { row = it }, { row = null })
        val outcomes = LinkedBlockingQueue<String>()
        val http = client { req, body ->
            when (req.url.encodedPath) {
                "/~device/mailbox/claim" -> JSONObject().put("serverNow", then).put("operation",
                    operation().put("leaseUntil", "2025-03-07T08:00:02+08:00"))
                "/~device/mailbox/renew" -> {
                    assertEquals("lease1", body.getString("leaseId"))
                    JSONObject().put("serverNow", then).put("leaseUntil", future).put("cancelRequestedAt", then)
                }
                "/~device/mailbox/complete" -> {
                    outcomes.add(body.getString("outcome"))
                    JSONObject().put("operationId", "operation1").put("deviceId", "device1").put("state", body.getString("outcome"))
                }
                else -> error("Unexpected request")
            }
        }
        GatewayMailbox(device(http) { call ->
            val stop = CountDownLatch(1)
            call.signal.onCancel(stop::countDown).use { assertTrue(stop.await(3, SECONDS)) }
            call.checkActive()
        }, journal).use { assertEquals(1, it.drain(1)) }
        assertEquals("result_unknown", outcomes.next())
        assertNull(row)
    }

    @Test fun disableCancelsRunningHandlerAndDropsItsLateReply() {
        val started = LinkedBlockingQueue<WireCall>()
        val release = CountDownLatch(1)
        val runtime = device {
            started.add(it)
            check(release.await(3, SECONDS))
            it.checkActive()
            error("disabled call proceeded")
        }
        GatewayConnection(runtime, sockets = factory).use { connection ->
            connection.setEnabled(true)
            val old = sockets.next()
            old.open()
            old.sent.next()
            old.ready()
            old.receive(call("active").toString())
            val pending = started.next()
            connection.setEnabled(false)
            assertTrue(pending.signal.cancelled)
            assertTrue(old.stopped.await(2, SECONDS))
            release.countDown()
            connection.setEnabled(true)
            val current = sockets.next()
            current.open()
            current.sent.next()
            current.ready()
            current.pingBarrier()
            assertTrue(old.sent.isEmpty())
        }
    }

    @Test fun rejectsCrossOriginRelayBeforeSendingBytes() {
        var grants = 0
        val runtime = device(client { req, _ ->
            assertEquals("/system/store/create_upload", req.url.encodedPath)
            grants++
            JSONObject().put("url", "https://other.example/~store/uploads/u1").put("transport", "relay")
                .put("expiresAt", future).put("method", "PUT").put("maxBytes", 4)
                .put("objectUri", "store://default/abcdefghijklmnopqrstuv").put("uploadId", "u1")
                .put("headers", JSONObject()).put("uploadToken", "grant-token")
        }) { null }
        val upload = WireUpload(runtime, JSONObject().put("token", "call-token").put("maxBytes", 4)
            .put("maxObjects", 1).put("expiresAt", future), WireSignal())
        assertThrows(WireFailure::class.java) { upload.put(ByteArray(4), "image/jpeg") }
        assertEquals(1, grants)
    }

    @Test fun storeUsesSeparateCredentialsAndFiltersReturnedDescriptor() {
        for (relay in listOf(true, false)) {
            val uri = "store://default/abcdefghijklmnopqrstuv"
            val descriptor = JSONObject().put("uri", uri).put("size", 3).put("createdAt", then)
                .put("readyAt", then).put("contentType", "image/jpeg").put("debugToken", "never-return")
            val steps = mutableListOf<String>()
            val http = client { req, body ->
                steps.add(req.method)
                assertNull(req.header("Authorization"))
                when (req.url.encodedPath) {
                    "/system/store/create_upload" -> {
                        assertEquals("call-token", req.header("x-tb-store-capability"))
                        assertEquals(3, body.getInt("size"))
                        assertEquals("sha256", body.getJSONObject("checksum").getString("algorithm"))
                        JSONObject().put("url", if (relay) origin + "/~store/uploads/u1" else "https://storage.example/signed")
                            .put("transport", if (relay) "relay" else "presigned-put").put("expiresAt", future)
                            .put("method", "PUT").put("maxBytes", 3).put("objectUri", uri).put("uploadId", "u1")
                            .put("headers", JSONObject()).put("uploadToken", "grant-token")
                    }
                    "/system/store/complete_upload" -> {
                        assertEquals("grant-token", req.header("x-tb-store-upload"))
                        assertNull(req.header("x-tb-store-capability"))
                        assertEquals("u1", body.getString("uploadId"))
                        descriptor
                    }
                    else -> {
                        assertEquals("PUT", req.method)
                        assertNull(req.header("x-tb-store-capability"))
                        assertEquals(if (relay) "grant-token" else null, req.header("x-tb-store-upload"))
                        descriptor
                    }
                }
            }
            val signal = WireSignal()
            val upload = WireUpload(device(http) { null }, JSONObject().put("token", "call-token")
                .put("maxObjects", 1).put("maxBytes", 3).put("expiresAt", future), signal)
            assertThrows(WireFailure::class.java) { upload.put(ByteArray(4), "image/jpeg") }
            val result = upload.put(byteArrayOf(1, 2, 3), "image/jpeg", checksumSha256 = "digest")
            assertEquals(uri, result.getString("uri"))
            assertFalse(result.has("debugToken"))
            assertEquals(if (relay) listOf("POST", "PUT") else listOf("POST", "PUT", "POST"), steps)
            signal.cancel()
            assertThrows(WireFailure::class.java) { upload.put(ByteArray(1), "image/jpeg") }
        }
    }
}

package ai.tokenroll.toolbridge.mobile

import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.OkHttpClient
import org.json.JSONArray
import org.json.JSONObject
import java.io.Closeable
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.TimeZone

class WireCredential(val audienceOrigin: String, val deviceId: String, val keyId: String, val material: String)

class WireDevice internal constructor(
    baseUrl: String,
    val deviceId: String,
    val credential: () -> WireCredential?,
    val expose: () -> JSONArray,
    val execute: (WireCall) -> Any?,
    val onCredentialInvalid: (WireCredential) -> Unit = {},
    client: OkHttpClient,
) {
    constructor(
        baseUrl: String, deviceId: String, credential: () -> WireCredential?, expose: () -> JSONArray,
        execute: (WireCall) -> Any?, onCredentialInvalid: (WireCredential) -> Unit = {},
    ) : this(baseUrl, deviceId, credential, expose, execute, onCredentialInvalid, OkHttpClient())

    internal val origin = baseUrl.toHttpUrl()
    internal val http = client.newBuilder().followRedirects(false).followSslRedirects(false)
        .retryOnConnectionFailure(false).build()

    init {
        require(origin.username.isEmpty() && origin.password.isEmpty() && origin.query == null &&
            origin.fragment == null && origin.encodedPath == "/") { "Expected a gateway origin" }
        require(deviceId.isNotBlank() && '/' !in deviceId)
    }

    internal fun currentCredential(): WireCredential {
        val c = credential()
        if (c == null || c.deviceId != deviceId || c.audienceOrigin.toHttpUrlOrNull() != origin ||
            c.keyId.isBlank() || c.material.isBlank() || c.material.any { it.code !in 33..126 }) {
            throw WireFailure("permission_denied", "Device credential unavailable")
        }
        return c
    }

    internal fun wireNodes(): JSONArray {
        val nodes = JSONArray(expose().toString())
        require(nodes.length() > 0)
        for (i in 0 until nodes.length()) {
            val node = nodes.getJSONObject(i)
            val path = node.string("path").removePrefix("phone/")
            require(path.split('/').none { it.isBlank() || it == "." || it == ".." })
            require(node.string("kind") in setOf("tool", "context") && node.opt("description") is String)
            node.put("path", path)
        }
        return nodes
    }
}

class WireSignal internal constructor() {
    @Volatile var cancelled = false
        private set
    private val listeners = mutableSetOf<() -> Unit>()

    fun onCancel(listener: () -> Unit): Closeable {
        synchronized(this) {
            if (!cancelled) {
                listeners.add(listener)
                return Closeable { synchronized(this) { listeners.remove(listener) } }
            }
        }
        listener()
        return Closeable {}
    }

    internal fun cancel() {
        val callbacks = synchronized(this) {
            if (cancelled) return
            cancelled = true
            listeners.toList().also { listeners.clear() }
        }
        callbacks.forEach { runCatching(it) }
    }

    fun checkActive() {
        if (cancelled) throw WireFailure("unavailable", "Device call cancelled", true)
    }
}

class WireCall internal constructor(
    val id: String, val path: String, val tool: String, val arguments: JSONObject,
    val callerSubjectId: String, val callerDisplayName: String,
    val createdAtMs: Long, val expiresAtMs: Long, val delivery: String,
    val signal: WireSignal, val upload: WireUpload?,
) {
    fun checkActive() {
        signal.checkActive()
        if (System.currentTimeMillis() >= expiresAtMs) throw WireFailure("expired", "Device call expired")
    }
}

/** Only pass user-safe messages here. Unexpected exception messages never go on the wire. */
class WireFailure(val localCode: String, override val message: String, val retryable: Boolean = false) :
    RuntimeException(message) {
    internal fun body(): JSONObject {
        val code = when (localCode) {
            "invalid_argument", "not_found", "rate_limited", "conflict" -> localCode
            "confirmation_queue_full", "confirmation_required", "disabled", "permission_denied",
            "source_not_allowed", "url_not_allowed", "user_rejected" -> "permission_denied"
            "cancelled", "camera_busy", "camera_capture_failed", "camera_processing_failed",
            "camera_probe_failed", "camera_unavailable", "camera_upload_conflict", "camera_upload_failed",
            "camera_upload_invalid", "camera_upload_unavailable", "runtime_pending_read_failed",
            "expired", "foreground_required", "linking_probe_timeout", "media_fetch_failed",
            "notification_status_unknown", "notification_unavailable", "photo_too_large", "stale_location",
            "timeout", "timer_cancel_status_unknown", "timer_schedule_status_unknown", "timer_unavailable",
            "unavailable" -> "unavailable"
            else -> "internal"
        }
        return JSONObject().put("code", code).put("message", message)
            .put("retryable", retryable && code in setOf("unavailable", "internal", "rate_limited"))
    }
}

internal fun invalidWire(): Nothing = throw WireFailure("invalid_argument", "Invalid device wire fields")
internal fun JSONObject.string(key: String): String =
    (opt(key) as? String)?.takeIf { it.isNotEmpty() } ?: invalidWire()

internal fun JSONObject.objectField(key: String): JSONObject = optJSONObject(key) ?: invalidWire()

private val timestamp = Regex("""(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})""")

// java.time.Instant requires API 26 without core-library desugaring.
internal fun epoch(value: String): Long {
    val parts = timestamp.matchEntire(value)?.groupValues ?: invalidWire()
    val format = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSSXXX", Locale.US).apply { isLenient = false }
    val normalized = parts[1] + "." + parts[2].take(3).padEnd(3, '0') + parts[3]
    return try { format.parse(normalized)?.time ?: invalidWire() } catch (_: java.text.ParseException) { invalidWire() }
}

internal fun nowIso(): String = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply {
    timeZone = TimeZone.getTimeZone("UTC")
}.format(java.util.Date())

internal fun WireDevice.call(
    id: String, frame: JSONObject, credential: WireCredential, signal: WireSignal, delivery: String,
    received: Long = System.currentTimeMillis(),
): WireCall {
    val parts = frame.string("path").split('/')
    if (parts.size < 2 || parts.any(String::isEmpty)) invalidWire()
    val node = parts.dropLast(1).joinToString("/")
    val tool = parts.last()
    val localLimit = if (node == "camera" && tool == "capture_photo") 120_000L else 30_000L
    val context = if (frame.has("context")) frame.objectField("context") else null
    if (node.removePrefix("phone/") == "control" && context == null)
        throw WireFailure("permission_denied", "远控需要网关提供调用者身份")
    val caller = context?.objectField("caller")
    context?.string("traceId")
    val subject = caller?.string("keyId") ?: credential.keyId
    val owner = caller?.string("owner") ?: "Tool Bridge 网关"
    val display = if (caller?.has("displayName") == true) caller.opt("displayName") as? String ?: invalidWire() else owner
    val created = context?.let { epoch(it.string("createdAt")) } ?: received
    val gatewayExpiry = context?.let { epoch(it.string("expiresAt")) } ?: (received + localLimit)
    val upload = if (context?.has("upload") == true && delivery == "realtime") {
        WireUpload(this, context.objectField("upload"), signal)
    } else null
    val expires = minOf(gatewayExpiry, if (delivery == "mailbox") Long.MAX_VALUE else received + localLimit,
        upload?.expiresAt ?: Long.MAX_VALUE)
    return WireCall(id, "phone/" + node.removePrefix("phone/"), tool, frame.objectField("arguments"),
        subject, display, created, expires, delivery, signal, upload)
}

private fun jsonValue(value: Any?, ancestors: java.util.IdentityHashMap<Any, Boolean>): Any {
    if (value == null || value === JSONObject.NULL) return JSONObject.NULL
    if (value is Boolean || value is String) return value
    if (value is Number && value.toDouble().isFinite()) return value
    if (ancestors.put(value, true) != null) throw WireFailure("internal", "Cyclic JSON result")
    return try {
        when (value) {
            is JSONObject -> JSONObject().also { copy ->
                for (key in value.keys()) copy.put(key, jsonValue(value.get(key), ancestors))
            }
            is JSONArray -> JSONArray().also { copy ->
                for (i in 0 until value.length()) copy.put(jsonValue(value.get(i), ancestors))
            }
            else -> throw WireFailure("internal", "Invalid JSON result")
        }
    } finally {
        ancestors.remove(value)
    }
}

internal fun WireDevice.invokeCall(call: WireCall): Any = try {
    call.checkActive()
    jsonValue(execute(call), java.util.IdentityHashMap())
} finally {
    call.upload?.finish()
}

internal fun Throwable.safeFailure(signal: WireSignal): WireFailure = when {
    this is WireFailure -> this
    signal.cancelled -> WireFailure("unavailable", "Device call cancelled", true)
    else -> WireFailure("internal", "Device handler failed")
}

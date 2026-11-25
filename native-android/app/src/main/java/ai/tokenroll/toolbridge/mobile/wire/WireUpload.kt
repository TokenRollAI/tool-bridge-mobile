package ai.tokenroll.toolbridge.mobile

import okhttp3.Headers
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.io.IOException

internal val jsonMedia = "application/json".toMediaType()

internal fun WireDevice.request(
    request: Request, signal: WireSignal, expectJson: Boolean = true, onUnauthorized: () -> Unit = {},
): JSONObject {
    signal.checkActive()
    val call = http.newCall(request)
    val registration = signal.onCancel(call::cancel)
    try {
        return call.execute().use { response ->
            if (!response.isSuccessful) {
                if (response.code == 401) onUnauthorized()
                val code = when (response.code) {
                    400 -> "invalid_argument"
                    401, 403 -> "permission_denied"
                    404 -> "not_found"
                    409 -> "conflict"
                    429 -> "rate_limited"
                    else -> "unavailable"
                }
                throw WireFailure(code, "Gateway HTTP " + response.code, response.code == 429 || response.code >= 500)
            }
            if (!expectJson) return@use JSONObject()
            try { JSONObject(response.body?.string() ?: "") }
            catch (_: org.json.JSONException) { throw WireFailure("unavailable", "Invalid gateway response", true) }
        }
    } catch (error: IOException) {
        signal.checkActive()
        val stage = when (request.method) { "PUT" -> "上传"; else -> "网关请求" }
        val detail = when (error) {
            is javax.net.ssl.SSLException -> "TLS 验证失败"
            is java.net.SocketTimeoutException -> "超时"
            is java.net.ConnectException -> "连接失败"
            is java.net.UnknownHostException -> "域名解析失败"
            is java.net.ProtocolException -> "响应协议错误"
            else -> "网络连接中断"
        }
        throw WireFailure("unavailable", stage + detail, true)
    } finally { registration.close() }
}

internal fun JSONObject.byteCount(key: String): Long {
    val value = opt(key) as? Number ?: invalidWire()
    val count = value.toLong()
    if (count !in 0..9_007_199_254_740_991L || value.toDouble() != count.toDouble()) invalidWire()
    return count
}

/** Call-scoped upload. Only a validated object descriptor reaches the caller. */
class WireUpload internal constructor(
    private val device: WireDevice, capability: JSONObject, parent: WireSignal,
) {
    internal val expiresAt = epoch(capability.string("expiresAt"))
    private val token = capability.string("token")
    private val maxBytes = capability.byteCount("maxBytes")
    init {
        if (token.any { it.code !in 33..126 } || maxBytes < 1 || capability.byteCount("maxObjects") < 1) invalidWire()
    }

    private val signal = WireSignal()
    private val registration = parent.onCancel(signal::cancel)

    internal fun finish() {
        registration.close()
        signal.cancel()
    }

    fun put(
        bytes: ByteArray, contentType: String, filename: String? = null, idempotencyKey: String? = null,
        checksumSha256: String? = null,
    ): JSONObject {
        signal.checkActive()
        if (System.currentTimeMillis() >= expiresAt) throw WireFailure("unavailable", "Upload capability expired")
        if (bytes.size > maxBytes || contentType.isBlank() || idempotencyKey?.isBlank() == true ||
            listOfNotNull(contentType, filename, idempotencyKey).any { '\r' in it || '\n' in it }) invalidWire()
        val metadata = JSONObject().put("size", bytes.size).put("contentType", contentType)
            .put("filename", filename).put("idempotencyKey", idempotencyKey)
        if (checksumSha256 != null) {
            if (checksumSha256.isBlank()) invalidWire()
            metadata.put("checksum", JSONObject().put("algorithm", "sha256").put("value", checksumSha256))
        }
        val create = Request.Builder().url(device.origin.resolve("/system/store/create_upload")!!)
            .header("x-tb-store-capability", token).post(metadata.toString().toRequestBody(jsonMedia)).build()
        val grant = device.request(create, signal)
        val uri = grant.string("objectUri")
        val transport = grant.string("transport")
        val relay = transport == "relay"
        val target = grant.string("url").toHttpUrlOrNull() ?: invalidWire()
        val uploadId = grant.string("uploadId")
        val uploadToken = grant.string("uploadToken")
        val grantExpiry = epoch(grant.string("expiresAt"))
        val grantLimit = grant.byteCount("maxBytes")
        if (!storeUri.matches(uri) || grant.string("method") != "PUT" || grantLimit < 1 ||
            (!relay && transport != "presigned-put") || uploadToken.any { it.code !in 33..126 } ||
            target.username.isNotEmpty() || target.password.isNotEmpty()) invalidWire()
        val relayRoute = device.origin.newBuilder().addPathSegments("~store/uploads").addPathSegment(uploadId).build()
        if (relay && target != relayRoute) invalidWire()
        val headers = Headers.Builder()
        val signed = grant.objectField("headers")
        for (name in signed.keys()) {
            val value = signed.opt(name) as? String ?: invalidWire()
            val lower = name.lowercase()
            if (lower == "x-tb-store-upload" && relay && value == uploadToken) continue
            if (lower.startsWith("x-tb-") || lower in forbiddenHeaders) invalidWire()
            headers.add(name, value)
        }
        fun checkedDescriptor(raw: JSONObject): JSONObject {
            val safe = descriptor(raw, uri)
            val returnedHash = safe.optJSONObject("checksum")?.string("value")
            if (safe.byteCount("size") != bytes.size.toLong() || safe.string("contentType") != contentType ||
                (checksumSha256 != null && returnedHash != null && checksumSha256 != returnedHash)) invalidWire()
            return safe
        }
        if (grant.has("alreadyCompleted") || grant.has("descriptor")) {
            if (grant.opt("alreadyCompleted") != true) invalidWire()
            return checkedDescriptor(grant.objectField("descriptor"))
        }
        if (grantExpiry <= System.currentTimeMillis()) throw WireFailure("unavailable", "Upload grant expired", true)
        if (bytes.size > grantLimit) throw WireFailure("invalid_argument", "Object exceeds upload grant")
        if (relay) headers.set("x-tb-store-upload", uploadToken)
        // Only grant headers go to storage. OkHttp must not replace a signed content-type.
        val put = Request.Builder().url(target).headers(headers.build()).put(bytes.toRequestBody(null)).build()
        val uploaded = device.request(put, signal, expectJson = relay)
        if (relay) return checkedDescriptor(uploaded)
        val complete = Request.Builder().url(device.origin.resolve("/system/store/complete_upload")!!)
            .header("x-tb-store-upload", uploadToken)
            .post(JSONObject().put("uploadId", uploadId).toString().toRequestBody(jsonMedia)).build()
        return checkedDescriptor(device.request(complete, signal))
    }

    private fun descriptor(raw: JSONObject, uri: String): JSONObject {
        if (raw.string("uri") != uri) invalidWire()
        val safe = JSONObject().put("uri", uri).put("size", raw.byteCount("size"))
            .put("contentType", raw.string("contentType"))
        for (key in listOf("readyAt", "createdAt")) {
            val time = raw.string(key)
            epoch(time)
            safe.put(key, time)
        }
        for (key in listOf("etag", "filename")) {
            if (raw.has(key)) safe.put(key, raw.opt(key) as? String ?: invalidWire())
        }
        if (raw.has("checksum")) {
            val checksum = raw.objectField("checksum")
            if (checksum.string("algorithm") != "sha256") invalidWire()
            safe.put("checksum", JSONObject().put("algorithm", "sha256").put("value", checksum.string("value")))
        }
        return safe
    }

    private companion object {
        val storeUri = Regex("""store://default/[A-Za-z0-9_-]{22,64}""")
        val forbiddenHeaders = setOf("authorization", "proxy-authorization", "cookie", "cookie2", "host")
    }
}

package ai.tokenroll.toolbridge.mobile

import okhttp3.HttpUrl
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.Closeable
import java.io.File
import java.io.RandomAccessFile
import java.util.concurrent.TimeUnit

internal data class SensorAudio(val data: RandomAccessFile, val mime: String, val size: Long) : Closeable {
    override fun close() = data.close()
}

internal class SensorMediaSource(val hosts: Set<String>) {
    private val http = OkHttpClient.Builder().followRedirects(false).followSslRedirects(false)
        .retryOnConnectionFailure(false).callTimeout(30, TimeUnit.SECONDS).build()

    fun url(raw: String) = sensorUrl(raw, hosts, "source_not_allowed")

    fun fetch(op: SensorMediaRequest, source: HttpUrl): SensorAudio {
        var target = source
        repeat(4) { redirects ->
            op.check()
            val request = http.newCall(Request.Builder().url(target).header("Accept-Encoding", "identity").build())
            val stop = op.call.signal.onCancel(request::cancel)
            try {
                request.execute().use { response ->
                    if (response.code in setOf(301, 302, 303, 307, 308)) {
                        if (redirects == 3) sensorFailure("media_redirect_rejected", "媒体重定向次数超过上限")
                        val next = response.header("Location")?.let { target.resolve(it) }
                            ?: sensorFailure("media_redirect_rejected", "无效的媒体重定向")
                        target = url(next.toString())
                    } else {
                        if (!response.isSuccessful) sensorFailure("media_fetch_failed", "媒体服务器未返回音频")
                        val body = response.body ?: sensorFailure("media_fetch_failed", "媒体响应为空")
                        val mime = response.header("Content-Type").orEmpty().substringBefore(';').trim().lowercase()
                        if (mime !in allowedMime) sensorFailure("media_mime_not_allowed", "不支持该媒体格式")
                        val declared = response.header("Content-Length")?.let {
                            it.toLongOrNull()?.takeIf { n -> n > 0 } ?: sensorFailure("media_size_invalid", "媒体声明大小无效")
                        }
                        if (declared != null && declared > maxBytes) sensorFailure("media_too_large", "音频超过 25 MiB")
                        return buffer(op, body.byteStream(), mime)
                    }
                }
            } catch (e: java.io.IOException) {
                op.check()
                throw WireFailure("media_fetch_failed", "媒体下载失败", true)
            } finally { stop.close() }
        }
        sensorFailure("media_redirect_rejected", "无法解析媒体来源")
    }

    private fun buffer(op: SensorMediaRequest, input: java.io.InputStream, mime: String): SensorAudio {
        val path = File.createTempFile("sensor-audio-", ".tmp", op.host.cacheDir)
        val file = try { RandomAccessFile(path, "rw") } finally { path.delete() }
        // The open, unlinked private file survives until the decoder closes its last descriptor.
        try {
            val chunk = ByteArray(16384)
            var size = 0L
            while (true) {
                op.check()
                val count = input.read(chunk)
                if (count < 0) break
                size += count
                if (size > maxBytes) sensorFailure("media_too_large", "音频超过 25 MiB")
                file.write(chunk, 0, count)
            }
            file.seek(0)
            val head = ByteArray(minOf(16L, size).toInt()).also(file::readFully)
            if (!signature(mime, head)) sensorFailure("media_content_invalid", "音频内容与声明格式不符")
            file.seek(0)
            return SensorAudio(file, mime, size)
        } catch (e: Throwable) { file.close(); throw e }
    }

    companion object {
        private const val maxBytes = 25L * 1024 * 1024
        private val allowedMime = setOf("audio/flac", "audio/ogg", "audio/wav", "audio/x-wav",
            "audio/mp4", "audio/webm", "audio/mpeg", "audio/aac")

        internal fun signature(mime: String, bytes: ByteArray): Boolean {
            val head = String(bytes, Charsets.ISO_8859_1)
            fun octet(i: Int) = bytes.getOrNull(i)?.toInt()?.and(255) ?: -1
            return when (mime) {
                "audio/flac" -> head.startsWith("fLaC")
                "audio/ogg" -> head.startsWith("OggS")
                "audio/wav", "audio/x-wav" -> head.startsWith("RIFF") && head.startsWith("WAVE", 8)
                "audio/mp4" -> head.startsWith("ftyp", 4)
                "audio/webm" -> head.startsWith("\u001a\u0045\u00df\u00a3")
                "audio/mpeg" -> head.startsWith("ID3") || octet(0) == 255 && octet(1) >= 224
                "audio/aac" -> octet(0) == 255 && octet(1) >= 0 && (octet(1) and 0xf6) == 0xf0
                else -> false
            }
        }
    }
}

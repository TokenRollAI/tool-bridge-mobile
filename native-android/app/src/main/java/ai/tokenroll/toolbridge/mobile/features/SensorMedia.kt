package ai.tokenroll.toolbridge.mobile

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.location.LocationManager
import android.net.Uri
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import org.json.JSONObject
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicReference

internal fun sensorHosts(csv: String) = csv.split(',').map { it.trim().lowercase() }.filter { it.isNotEmpty() }.toSet()

// Browsers also interpret hexadecimal and shortened numeric IPv4 hosts as IP literals.
private val numericHost = Regex("""(?:[0-9]+|0x[0-9a-f]+)(?:\.(?:[0-9]+|0x[0-9a-f]+)){0,3}\.?""")

internal fun sensorUrl(raw: String, hosts: Set<String>, error: String): HttpUrl {
    val url = raw.toHttpUrlOrNull() ?: sensorFailure("invalid_argument", "无效的 HTTPS 地址")
    if (raw.length > 2048 || raw.any { it <= ' ' || it == '\\' } || !url.isHttps || url.port != 443 ||
        url.username.isNotEmpty() || url.password.isNotEmpty() || url.fragment != null ||
        url.host.contains(':') || numericHost.matches(url.host) || url.host !in hosts)
        sensorFailure(error, "地址必须属于允许的 HTTPS 主机，且不能含凭证或片段")
    return url
}

class SensorMedia(val context: Context, val activity: () -> Activity?, val direct: () -> Boolean, val changed: () -> Unit) {
    private val pool = Executors.newFixedThreadPool(2)
    private val active = AtomicReference<SensorMediaRequest?>()
    @Volatile private var closed = false
    private val linkHosts = sensorHosts(BuildConfig.LINK_HOSTS)
    private val media = SensorMediaPlayback(context, sensorHosts(BuildConfig.MEDIA_HOSTS), changed)

    fun available(key: String): Boolean = !closed && runCatching {
        when (key) {
            "media/play", "media/pause", "media/resume", "media/stop", "media/seek", "media/status" -> media.available()
            "apps/open_url", "apps/can_open_url" -> linkHosts.isNotEmpty() && sensorForeground(activity())
            "camera/capture_photo" -> sensorForeground(activity()) && SensorMediaCamera.cameras().isNotEmpty()
            "location/current" -> sensorForeground(activity()) &&
                context.getSystemService(LocationManager::class.java)?.let { enabledLocationProviders(it).isNotEmpty() } == true
            "location/open_map" -> sensorForeground(activity()) &&
                Intent(Intent.ACTION_VIEW, Uri.parse("geo:0,0")).resolveActivity(context.packageManager) != null
            else -> false
        }
    }.getOrDefault(false)

    fun execute(call: WireCall): JSONObject {
        call.checkActive()
        if (closed) sensorFailure("unavailable", "本机能力已关闭")
        val key = call.path.removePrefix("phone/") + "/" + call.tool
        if (key in playbackControls) return media.control(call)
        val host = activity()?.takeIf(::sensorForeground) ?: sensorFailure("foreground_required", "请在解锁的手机前台操作")
        val camera = key == "camera/capture_photo"
        val timeout = if (camera) minOf(120000L,
            (call.upload ?: sensorFailure("camera_upload_unavailable", "本次调用未提供照片上传授权")).expiresAt - System.currentTimeMillis())
            else 30000L
        val op = SensorMediaRequest(call, host, activity, pool, timeout)
        if (!active.compareAndSet(null, op)) sensorFailure(if (camera) "camera_busy" else "conflict", "手机正在处理另一项前台操作")
        try {
            if (closed) sensorFailure("unavailable", "本机能力已关闭")
            return op.run {
                when (key) {
                    "camera/capture_photo" -> SensorMediaCamera(op, direct).start()
                    "location/current" -> currentLocation(op, direct())
                    "apps/can_open_url", "apps/open_url", "location/open_map" -> handoff(op, key)
                    "media/play" -> media.play(op, direct())
                    else -> sensorFailure("not_found", "手机未开放该能力")
                }
            }
        } finally { active.compareAndSet(op, null) }
    }

    private fun handoff(op: SensorMediaRequest, key: String) {
        val args = op.call.arguments
        val map = key == "location/open_map"
        val target: JSONObject
        val intent: Intent
        val detail: String
        if (map) {
            val purpose = deviceText(args, "purpose", 120)
            val (uri, label) = sensorMapTarget(args.getJSONObject("target"))
            intent = Intent(Intent.ACTION_VIEW, Uri.parse(uri))
            target = obj("kind" to "map", "provider" to "android_geo_handler")
            detail = "$purpose\n$label"
        } else {
            val url = sensorUrl(args.getString("url"), linkHosts, "url_not_allowed")
            intent = Intent(Intent.ACTION_VIEW, Uri.parse(url.toString())).addCategory(Intent.CATEGORY_BROWSABLE)
            target = obj("kind" to "https", "host" to url.host)
            detail = url.host
        }
        val timeout = Runnable { op.fail(WireFailure("linking_probe_timeout", "检查系统处理器超时", true)) }
        op.main.postDelayed(timeout, 5000)
        op.onEnd { op.main.removeCallbacks(timeout) }
        op.io(work = { intent.resolveActivity(context.packageManager) != null }) { supported ->
            op.main.removeCallbacks(timeout)
            if (key == "apps/can_open_url") op.finish(obj("canOpen" to supported, "target" to target))
            else {
                if (!supported) sensorFailure("unavailable", "未找到能打开目标的应用")
                val open = {
                    op.check()
                    op.host.startActivity(intent)
                    op.finish(obj("status" to "handed_off", "target" to target))
                }
                if (direct()) open()
                else op.prompt(if (map) "打开地图" else "打开链接", op.caller + "\n" + detail, "打开", open)
            }
        }
    }

    fun session(): JSONObject? = media.session()
    fun localPlayback(id: String, operation: String) { media.local(id, operation) }
    fun pauseSensitive() { active.get()?.foregroundLost() }
    fun close() {
        closed = true
        pauseSensitive()
        media.close()
        pool.shutdownNow()
    }

    private companion object {
        val playbackControls = setOf("media/status", "media/pause", "media/resume", "media/seek", "media/stop")
    }
}

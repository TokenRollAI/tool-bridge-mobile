package ai.tokenroll.toolbridge.mobile

import android.content.Context
import android.content.pm.PackageManager
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraManager
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack
import android.os.Build
import android.os.SystemClock
import android.os.VibrationEffect
import android.os.Vibrator
import org.json.JSONObject
import java.io.Closeable
import java.util.UUID
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit
import kotlin.math.PI
import kotlin.math.sin

internal class DeviceToolsAttention(private val context: Context, private val foreground: () -> Boolean,
                                    private val changed: () -> Unit) {
    private val clock = Executors.newSingleThreadScheduledExecutor()
    private val attempts = ArrayDeque<Pair<String, Long>>()
    private var session: Session? = null
    private var closed = false

    private class Session(val owner: String, val expires: Long, val deadline: Long) {
        val id = "attention_" + UUID.randomUUID()
        var sound: AudioTrack? = null
        var vibrator: Vibrator? = null
        var torch: Pair<CameraManager, String>? = null
        var monitor: ScheduledFuture<*>? = null
        var timeout: ScheduledFuture<*>? = null
        var subscription: Closeable? = null
        var lastPulse = SystemClock.elapsedRealtime()
    }

    private fun torch(): Pair<CameraManager, String>? {
        val manager = context.getSystemService(CameraManager::class.java) ?: return null
        val id = manager.cameraIdList.firstOrNull {
            manager.getCameraCharacteristics(it)[CameraCharacteristics.FLASH_INFO_AVAILABLE] == true
        } ?: return null
        return manager to id
    }

    fun hasChannel(): Boolean = context.packageManager.hasSystemFeature(PackageManager.FEATURE_AUDIO_OUTPUT) ||
        context.getSystemService(Vibrator::class.java)?.hasVibrator() == true || runCatching { torch() != null }.getOrDefault(false)

    private fun startSound(duration: Long): AudioTrack? {
        val rate = 8000
        val samples = ShortArray(4800) { i ->
            val envelope = minOf(1.0, i / 160.0, (4800 - i) / 160.0)
            (sin(2 * PI * 880 * i / rate) * envelope * 8000).toInt().toShort()
        }
        val track = AudioTrack.Builder().setAudioAttributes(AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build())
            .setAudioFormat(AudioFormat.Builder().setSampleRate(rate).setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                .setChannelMask(AudioFormat.CHANNEL_OUT_MONO).build())
            .setTransferMode(AudioTrack.MODE_STATIC).setBufferSizeInBytes(samples.size * 2).build()
        try {
            check(track.write(samples, 0, samples.size) == samples.size)
            check(track.setLoopPoints(0, samples.size, (duration / 600).toInt()) == AudioTrack.SUCCESS)
            track.setVolume(0.65f)
            track.play()
            return track
        } catch (e: Exception) { track.release(); throw e }
    }

    @Suppress("DEPRECATION")
    private fun pulse(vibrator: Vibrator) {
        if (Build.VERSION.SDK_INT >= 26) vibrator.vibrate(VibrationEffect.createOneShot(450, VibrationEffect.DEFAULT_AMPLITUDE))
        else vibrator.vibrate(450)
    }

    private fun channel(started: Boolean, reason: String) = if (started) obj("status" to "requested")
        else obj("status" to "unavailable", "reason" to reason)

    @Synchronized fun start(call: WireCall): JSONObject {
        if (closed || !foreground()) throw WireFailure("unavailable", "设备提示需要手机前台")
        val args = call.arguments
        val duration = args.optInt("durationSeconds", 30)
        if (duration !in 1..120 || args.optString("sound", "find_device") != "find_device" ||
            args.optString("message").let { it.length > 120 || unsafeDeviceText.containsMatchIn(it) })
            throw WireFailure("invalid_argument", "设备提示参数无效")
        val now = SystemClock.elapsedRealtime()
        while (attempts.isNotEmpty() && now - attempts.first().second >= 60000) attempts.removeFirst()
        if (attempts.size >= 6 || attempts.count { it.first == call.callerSubjectId } >= 3)
            throw WireFailure("rate_limited", "设备提示请求过于频繁", true)
        attempts.addLast(call.callerSubjectId to now)
        if (session != null) throw WireFailure("attention_active", "已有设备提示正在运行")
        call.checkActive()
        val wall = System.currentTimeMillis()
        val length = minOf(duration * 1000L, call.expiresAtMs - wall).coerceAtLeast(1)
        val active = Session(call.callerSubjectId, wall + length, now + length)
        val vibration = args.optBoolean("vibrate", true)
        val flash = args.optBoolean("flash", false)
        session = active
        try {
            active.sound = runCatching { startSound(length) }.getOrNull()
            if (vibration) active.vibrator = runCatching {
                context.getSystemService(Vibrator::class.java)?.takeIf { it.hasVibrator() }?.also { pulse(it) }
            }.getOrNull()
            if (flash) active.torch = runCatching {
                torch()?.also { (manager, id) -> manager.setTorchMode(id, true) }
            }.getOrNull()
            if (active.sound == null && active.vibrator == null && active.torch == null)
                throw WireFailure("unavailable", "设备没有可执行的提示通道")
            active.subscription = call.signal.onCancel { stop(active) }
            call.checkActive()
            if (!foreground()) throw WireFailure("foreground_required", "设备提示需要手机前台")
            active.timeout = clock.schedule({ stop(active) }, active.deadline - SystemClock.elapsedRealtime(), TimeUnit.MILLISECONDS)
            active.monitor = clock.scheduleWithFixedDelay({ tick(active) }, 200, 200, TimeUnit.MILLISECONDS)
            changed()
            return obj("sessionId" to active.id, "expiresAt" to NativeJson.now(active.expires),
                "channels" to obj("sound" to channel(active.sound != null, "sound_unavailable"),
                    "vibration" to channel(active.vibrator != null, if (vibration) "haptics_unavailable" else "not_requested"),
                    "flash" to channel(active.torch != null, if (flash) "flash_unavailable" else "not_requested")))
        } catch (e: Exception) { stop(active); throw e }
    }

    @Synchronized private fun tick(active: Session) {
        if (session !== active) return
        val now = SystemClock.elapsedRealtime()
        if (!foreground() || now >= active.deadline) { stop(active); return }
        if (active.vibrator != null && now - active.lastPulse >= 1500) {
            try { pulse(active.vibrator!!); active.lastPulse = now }
            catch (_: Exception) { stop(active) }
        }
    }

    @Synchronized fun snapshot(): JSONObject? = session?.let {
        obj("sessionId" to it.id, "callerSubjectId" to it.owner, "expiresAt" to NativeJson.now(it.expires),
            "remainingSeconds" to ((it.deadline - SystemClock.elapsedRealtime()).coerceAtLeast(0) + 999) / 1000)
    }

    @Synchronized private fun stop(active: Session) {
        if (session !== active) return
        session = null
        active.monitor?.cancel(false)
        active.timeout?.cancel(false)
        active.subscription?.close()
        runCatching { active.sound?.stop() }
        runCatching { active.sound?.release() }
        runCatching { active.vibrator?.cancel() }
        runCatching { active.torch?.let { (manager, id) -> manager.setTorchMode(id, false) } }
        changed()
    }

    @Synchronized fun stopRemote(id: String?): JSONObject {
        val active = session?.takeIf { id == null || it.id == id }
            ?: throw WireFailure("not_found", "指定设备提示未在运行")
        stop(active)
        return obj("status" to "stopped", "sessionId" to active.id)
    }

    @Synchronized fun stopLocal() { session?.let(::stop) }
    @Synchronized fun close() { closed = true; stopLocal(); clock.shutdownNow() }
}

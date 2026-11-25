@file:Suppress("DEPRECATION")

package ai.tokenroll.toolbridge.mobile

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.media.AudioAttributes
import android.media.AudioManager
import android.media.MediaMetadata
import android.media.MediaPlayer
import android.media.session.MediaSession
import android.media.session.PlaybackState
import android.os.Build
import android.os.Handler
import android.os.Looper
import org.json.JSONObject
import java.util.UUID
import java.util.concurrent.ExecutionException
import java.util.concurrent.FutureTask
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException

// MediaPlayer, MediaSession, and the mutable session snapshot are owned by the main looper.
internal class SensorMediaPlayback(private val context: Context, hosts: Set<String>, private val changed: () -> Unit) {
    private val source = SensorMediaSource(hosts)
    private val main = Handler(Looper.getMainLooper())
    private val audio = context.getSystemService(AudioManager::class.java)
    private val notices = context.getSystemService(NotificationManager::class.java)
    private var player: MediaPlayer? = null
    private var controls: MediaSession? = null
    private var receiver: BroadcastReceiver? = null
    private var model: JSONObject? = null
    @Volatile private var snapshot: String? = null
    private var state = "stopped"
    private var duration = 0
    private var position = 0
    private var preparing: SensorMediaRequest? = null
    private var focus: AudioManager.OnAudioFocusChangeListener? = null
    private var notificationAction = ""
    private val tick = object : Runnable {
        override fun run() {
            if (state != "playing") return
            position = runCatching { player?.currentPosition }.getOrNull() ?: position
            publish(false)
            main.postDelayed(this, 1000)
        }
    }

    fun available() = source.hosts.isNotEmpty() && audio != null &&
        context.packageManager.hasSystemFeature(android.content.pm.PackageManager.FEATURE_AUDIO_OUTPUT)

    fun session(): JSONObject? = snapshot?.let(::JSONObject)

    fun play(op: SensorMediaRequest, direct: Boolean) {
        if (player != null) sensorFailure("media_active", "请先停止当前媒体会话")
        val args = op.call.arguments
        val title = deviceText(args, "title", 120)
        val artist = if (args.has("artist")) deviceText(args, "artist", 120) else null
        val target = args.getJSONObject("source")
        if (target.getString("kind") != "https") sensorFailure("source_not_allowed", "需要 HTTPS 音频来源")
        val url = source.url(target.getString("url"))
        val start = {
            op.io(discard = SensorAudio::close, work = { source.fetch(op, url) }) { data ->
                val device = MediaPlayer()
                player = device
                preparing = op
                state = "loading"
                position = 0
                duration = 0
                val id = "media_" + UUID.randomUUID()
                model = obj("sessionId" to id, "callerSubjectId" to op.call.callerSubjectId, "title" to title,
                    "artist" to artist, "mimeType" to data.mime, "sizeBytes" to data.size, "sourceHost" to url.host)
                op.onEnd { if (player === device && !op.succeeded()) end("failed") }
                publish(false)
                device.setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA)
                    .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC).build())
                device.setDataSource(data.data.fd, 0L, data.size)
                val timeout = Runnable { op.fail(WireFailure("media_metadata_timeout", "读取音频时长超时")) }
                op.onEnd { main.removeCallbacks(timeout) }
                main.postDelayed(timeout, 10000)
                device.setOnErrorListener { failed, _, _ ->
                    if (player === failed) {
                        preparing?.fail(WireFailure("media_content_invalid", "音频无法解码"))
                        if (player === failed) end("failed")
                    }
                    true
                }
                device.setOnCompletionListener { if (player === it) { position = duration; end("stopped") } }
                device.setOnSeekCompleteListener {
                    if (player === it) { position = it.currentPosition; publish(false) }
                }
                device.setOnPreparedListener {
                    device.setOnPreparedListener(null)
                    op.guard {
                        if (player !== device) sensorFailure("cancelled", "播放已取消")
                        duration = device.duration
                        if (duration !in 1..7200000) sensorFailure("media_duration_not_allowed", "音频需要有效时长且不超过两小时")
                        setupControls(id, title, artist, op.caller)
                        startPlaying()
                        op.finish(requireNotNull(session()))
                        preparing = null
                    }
                }
                device.prepareAsync()
            }
        }
        if (direct) start() else op.prompt("播放音频", op.caller + "\n" + title + "\n" + url.host, "播放", start)
    }

    private fun startPlaying() {
        val device = player ?: sensorFailure("not_found", "媒体会话已结束")
        val listener = AudioManager.OnAudioFocusChangeListener { change ->
            if (change < 0 && player === device && state == "playing") {
                device.pause()
                state = "interrupted"
                position = device.currentPosition
                publish(true)
            }
        }
        focus?.let { audio?.abandonAudioFocus(it) }
        if (audio?.requestAudioFocus(listener, AudioManager.STREAM_MUSIC, AudioManager.AUDIOFOCUS_GAIN) !=
            AudioManager.AUDIOFOCUS_REQUEST_GRANTED) sensorFailure("unavailable", "系统未授予音频焦点")
        focus = listener
        device.start()
        state = "playing"
        publish(true)
        main.removeCallbacks(tick)
        main.postDelayed(tick, 1000)
    }

    private fun setupControls(id: String, title: String, artist: String?, caller: String) {
        val system = MediaSession(context, "Tool Bridge")
        controls = system
        system.setFlags(MediaSession.FLAG_HANDLES_MEDIA_BUTTONS or MediaSession.FLAG_HANDLES_TRANSPORT_CONTROLS)
        system.setMetadata(MediaMetadata.Builder().putString(MediaMetadata.METADATA_KEY_TITLE, title)
            .putString(MediaMetadata.METADATA_KEY_ARTIST, artist ?: caller)
            .putLong(MediaMetadata.METADATA_KEY_DURATION, duration.toLong()).build())
        system.setCallback(object : MediaSession.Callback() {
            override fun onPause() = fromSystem(id, "pause")
            override fun onPlay() = fromSystem(id, "resume")
            override fun onStop() = fromSystem(id, "stop")
            override fun onSeekTo(pos: Long) = fromSystem(id, "seek", pos)
        }, main)
        notificationAction = context.packageName + ".media." + UUID.randomUUID()
        val receiverForSession = object : BroadcastReceiver() {
            override fun onReceive(ctx: Context, intent: Intent) {
                if (intent.action == notificationAction) intent.getStringExtra("operation")?.let { fromSystem(id, it) }
            }
        }
        val filter = IntentFilter(notificationAction)
        if (Build.VERSION.SDK_INT >= 33) context.registerReceiver(receiverForSession, filter, Context.RECEIVER_NOT_EXPORTED)
        else {
            // Before API 33 only applications sharing our signature can send these commands.
            @android.annotation.SuppressLint("UnspecifiedRegisterReceiverFlag")
            val sticky = context.registerReceiver(receiverForSession, filter, context.packageName + ".permission.MEDIA_CONTROL", null)
        }
        receiver = receiverForSession
        system.isActive = true
    }

    private fun fromSystem(id: String, operation: String, seek: Long = 0) {
        runCatching { applyControl(id, operation, seek) }
    }

    private fun publish(system: Boolean) {
        val meta = model ?: return
        meta.put("state", state).put("currentTimeSeconds", position.coerceAtLeast(0) / 1000.0)
            .put("durationSeconds", if (duration > 0) duration / 1000.0 else JSONObject.NULL)
        snapshot = meta.toString()
        if (system && controls != null) {
            val playing = state == "playing"
            controls?.setPlaybackState(PlaybackState.Builder().setActions(PlaybackState.ACTION_PAUSE or
                PlaybackState.ACTION_PLAY or PlaybackState.ACTION_PLAY_PAUSE or PlaybackState.ACTION_STOP or PlaybackState.ACTION_SEEK_TO)
                .setState(if (playing) PlaybackState.STATE_PLAYING else PlaybackState.STATE_PAUSED,
                    position.toLong(), if (playing) 1f else 0f).build())
            notification(meta, playing)
        }
        changed()
    }

    private fun notification(meta: JSONObject, playing: Boolean) {
        val channel = "tb_media_playback"
        val builder = if (Build.VERSION.SDK_INT >= 26) {
            notices?.createNotificationChannel(NotificationChannel(channel, "媒体播放", NotificationManager.IMPORTANCE_LOW))
            Notification.Builder(context, channel)
        } else Notification.Builder(context)
        fun action(op: String, icon: Int, label: String): Notification.Action {
            val intent = Intent(notificationAction).setPackage(context.packageName).putExtra("operation", op)
            val pending = PendingIntent.getBroadcast(context, op.hashCode(), intent, PendingIntent.FLAG_IMMUTABLE)
            return Notification.Action.Builder(icon, label, pending).build()
        }
        builder.setSmallIcon(android.R.drawable.ic_media_play).setContentTitle(meta.getString("title"))
            .setContentText(meta.getString("sourceHost")).setOnlyAlertOnce(true).setShowWhen(false)
            .setVisibility(Notification.VISIBILITY_PRIVATE).setOngoing(playing)
            .setStyle(Notification.MediaStyle().setMediaSession(controls!!.sessionToken).setShowActionsInCompactView(0, 1))
            .addAction(if (playing) action("pause", android.R.drawable.ic_media_pause, "暂停")
                else action("resume", android.R.drawable.ic_media_play, "继续"))
            .addAction(action("stop", android.R.drawable.ic_delete, "停止"))
        notices?.notify("tb_media", 1, builder.build())
    }

    private fun end(finalState: String) {
        state = finalState
        main.removeCallbacks(tick)
        preparing = null
        player?.release()
        player = null
        focus?.let { audio?.abandonAudioFocus(it) }
        focus = null
        controls?.release()
        controls = null
        receiver?.let(context::unregisterReceiver)
        receiver = null
        notices?.cancel("tb_media", 1)
        publish(false)
    }

    private fun applyControl(id: String, operation: String, seek: Long): JSONObject {
        if (id != model?.optString("sessionId")) sensorFailure("not_found", "指定媒体会话不存在")
        val device = player
        if (operation == "status" || operation == "stop" && device == null) return requireNotNull(session())
        if (device == null) sensorFailure("not_found", "媒体会话已结束")
        when (operation) {
            "pause" -> {
                if (state != "playing") sensorFailure("invalid_state", "当前无法暂停")
                device.pause()
                position = device.currentPosition
                state = "paused"
                publish(true)
            }
            "resume" -> {
                if (state != "paused" && state != "interrupted") sensorFailure("invalid_state", "当前无法继续")
                startPlaying()
            }
            "seek" -> {
                if (duration <= 0) sensorFailure("invalid_state", "尚未取得音频时长")
                if (seek !in 0L..duration.toLong()) sensorFailure("invalid_argument", "播放位置超出时长")
                device.seekTo(seek.toInt())
                position = seek.toInt()
                publish(true)
            }
            "stop" -> {
                if (duration > 0) position = device.currentPosition
                val pending = preparing
                end("stopped")
                pending?.fail(WireFailure("cancelled", "本机已停止播放"))
            }
            else -> sensorFailure("invalid_argument", "无效的播放操作")
        }
        return requireNotNull(session())
    }

    private fun <T> onMain(timeout: Long = 5000, block: () -> T): T {
        if (Looper.myLooper() == main.looper) return block()
        val task = FutureTask(block)
        main.post(task)
        try { return task.get(timeout.coerceAtLeast(0), TimeUnit.MILLISECONDS) }
        catch (e: ExecutionException) { throw e.cause ?: e }
        catch (_: TimeoutException) { sensorFailure("timeout", "操作超时") }
        finally { task.cancel(false); main.removeCallbacks(task) }
    }

    fun control(call: WireCall) = onMain(minOf(5000, call.expiresAtMs - System.currentTimeMillis())) {
        call.checkActive()
        if (model?.optString("callerSubjectId") != call.callerSubjectId) sensorFailure("not_found", "指定媒体会话不存在")
        applyControl(call.arguments.getString("sessionId"), call.tool, call.arguments.optLong("positionMs", 0))
    }
    fun local(id: String, operation: String) { onMain { applyControl(id, operation, 0) } }
    fun close() { onMain { if (player != null) end("stopped") } }
}

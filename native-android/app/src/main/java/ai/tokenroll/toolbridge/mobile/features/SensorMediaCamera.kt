@file:Suppress("DEPRECATION")

package ai.tokenroll.toolbridge.mobile

import android.Manifest.permission.CAMERA
import android.app.Dialog
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import android.graphics.Matrix
import android.graphics.SurfaceTexture
import android.hardware.Camera
import android.view.Gravity
import android.view.TextureView
import android.view.View
import android.view.ViewGroup.LayoutParams.MATCH_PARENT
import android.view.WindowManager
import android.widget.Button
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import java.io.ByteArrayOutputStream
import java.security.MessageDigest
import kotlin.math.abs
import kotlin.math.roundToInt

internal class SensorMediaCamera(private val op: SensorMediaRequest, private val direct: () -> Boolean) {
    private val host = op.host
    private var automatic = direct()
    private lateinit var stage: FrameLayout
    private lateinit var hint: TextView
    private lateinit var shutter: Button
    private lateinit var retake: Button
    private lateinit var dialog: Dialog
    private var camera: Camera? = null
    private var texture: TextureView? = null
    private var captured: Photo? = null
    private var ready = false
    private var cameraId = -1
    private var rotation = 0
    private var edge = 1920
    private var compression = 75

    fun start() {
        val args = op.call.arguments
        val purpose = deviceText(args, "purpose", 120)
        val facing = when (args.optString("facing", "back")) {
            "back" -> Camera.CameraInfo.CAMERA_FACING_BACK
            "front" -> Camera.CameraInfo.CAMERA_FACING_FRONT
            else -> sensorFailure("invalid_argument", "镜头方向无效")
        }
        cameraId = cameras().entries.firstOrNull { it.value.facing == facing }?.key
            ?: sensorFailure("camera_facing_unavailable", "设备没有所选镜头")
        when (args.optString("quality", "medium")) {
            "low" -> { edge = 1280; compression = 55 }
            "medium" -> Unit
            "high" -> { edge = 2560; compression = 90 }
            else -> sensorFailure("invalid_argument", "照片质量参数无效")
        }
        val lens = if (facing == Camera.CameraInfo.CAMERA_FACING_BACK) "后置镜头" else "前置镜头"
        val description = op.caller + "\n" + purpose + " · " + lens
        op.permission(arrayOf(CAMERA), description) {
            op.onEnd {
                releaseCamera()
                texture = null
                captured = null
            }
            val pad = (16 * host.resources.displayMetrics.density).roundToInt()
            val body = LinearLayout(host).apply {
                orientation = LinearLayout.VERTICAL
                setPadding(pad, pad, pad, pad)
            }
            body.addView(TextView(host).apply { text = description })
            hint = TextView(host)
            body.addView(hint)
            stage = FrameLayout(host).apply { setBackgroundColor(Color.BLACK) }
            body.addView(stage, LinearLayout.LayoutParams(MATCH_PARENT, 0, 1f))
            val buttons = LinearLayout(host).apply { gravity = Gravity.END }
            body.addView(buttons)
            buttons.addView(Button(host).apply { text = "取消"; setOnClickListener { op.reject() } })
            retake = Button(host).apply { text = "重拍"; setOnClickListener { op.guard { preview() } } }
            buttons.addView(retake)
            shutter = Button(host).apply {
                setOnClickListener { op.guard { captured?.let(::upload) ?: takePhoto() } }
            }
            buttons.addView(shutter)
            dialog = Dialog(host).apply {
                setTitle("拍摄照片")
                setContentView(body, android.view.ViewGroup.LayoutParams(MATCH_PARENT, MATCH_PARENT))
                window?.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
            }
            op.show(dialog)
            dialog.window?.setLayout(MATCH_PARENT, MATCH_PARENT)
            preview()
        }
    }

    private fun releaseCamera() {
        val old = camera
        camera = null
        ready = false
        old?.release()
    }

    private fun preview() {
        captured = null
        stage.removeAllViews()
        retake.visibility = View.GONE
        shutter.text = "拍摄"
        shutter.visibility = if (automatic && direct()) View.GONE else View.VISIBLE
        shutter.isEnabled = false
        hint.text = if (automatic && direct()) "预览就绪后将自动拍摄并上传" else "请预览画面，再按拍摄"
        var openWhenFocused: (() -> Unit)? = null
        val view = object : TextureView(host) {
            override fun onWindowFocusChanged(focused: Boolean) {
                super.onWindowFocusChanged(focused)
                if (!focused && camera != null && texture === this) op.foregroundLost()
                if (focused) openWhenFocused?.invoke()
            }
        }
        texture = view
        view.surfaceTextureListener = object : TextureView.SurfaceTextureListener {
            override fun onSurfaceTextureAvailable(surface: SurfaceTexture, w: Int, h: Int) {
                openWhenFocused = {
                    if (texture === view && view.hasWindowFocus()) op.guard {
                        openWhenFocused = null
                        openCamera(view, surface, w, h)
                    }
                }
                openWhenFocused?.invoke()
            }
            override fun onSurfaceTextureUpdated(surface: SurfaceTexture) {
                if (texture !== view || ready || camera == null || !view.hasWindowFocus()) return
                ready = true
                if (automatic && direct()) {
                    view.postDelayed({ op.guard {
                        if (texture === view && camera != null) {
                            if (direct()) takePhoto() else manualShutter()
                        }
                    } }, 300)
                } else manualShutter()
            }
            override fun onSurfaceTextureSizeChanged(surface: SurfaceTexture, w: Int, h: Int) = Unit
            override fun onSurfaceTextureDestroyed(surface: SurfaceTexture): Boolean {
                openWhenFocused = null
                if (texture === view && camera != null) op.foregroundLost()
                return true
            }
        }
        stage.addView(view, FrameLayout.LayoutParams(MATCH_PARENT, MATCH_PARENT))
    }

    private fun openCamera(view: TextureView, surface: SurfaceTexture, w: Int, h: Int) {
        if (!view.isShown || !view.hasWindowFocus() || !dialog.isShowing) sensorFailure("foreground_required", "相机预览不可见")
        val info = Camera.CameraInfo().also { Camera.getCameraInfo(cameraId, it) }
        val deviceDegrees = host.windowManager.defaultDisplay.rotation * 90
        val front = info.facing == Camera.CameraInfo.CAMERA_FACING_FRONT
        rotation = if (front) (info.orientation + deviceDegrees) % 360 else (info.orientation - deviceDegrees + 360) % 360
        val displayDegrees = if (front) (360 - rotation) % 360 else rotation
        val device = Camera.open(cameraId)
        camera = device
        device.setErrorCallback { _, broken -> if (camera === broken) op.fail(WireFailure("camera_unavailable", "相机连接中断")) }
        val params = device.parameters
        val sizes = params.supportedPictureSizes.filter { it.width.toLong() * it.height <= 12_000_000 }
        val picture = sizes.filter { maxOf(it.width, it.height) >= edge }.minByOrNull { it.width.toLong() * it.height }
            ?: sizes.maxByOrNull { it.width.toLong() * it.height }
            ?: sensorFailure("camera_unavailable", "镜头不能输出可处理的照片尺寸")
        val ratio = picture.width.toDouble() / picture.height
        val preview = params.supportedPreviewSizes.minWith(compareBy<Camera.Size>(
            { abs(it.width.toDouble() / it.height - ratio) }, { abs(maxOf(it.width, it.height) - 1280) }))
        params.setPreviewSize(preview.width, preview.height)
        params.setPictureSize(picture.width, picture.height)
        params.pictureFormat = android.graphics.ImageFormat.JPEG
        params.setRotation(0)
        params.removeGpsData()
        if (Camera.Parameters.FOCUS_MODE_CONTINUOUS_PICTURE in params.supportedFocusModes.orEmpty())
            params.focusMode = Camera.Parameters.FOCUS_MODE_CONTINUOUS_PICTURE
        device.parameters = params
        device.setDisplayOrientation(displayDegrees)
        val sideways = displayDegrees % 180 != 0
        val pw = if (sideways) preview.height else preview.width
        val ph = if (sideways) preview.width else preview.height
        val scale = minOf(w.toDouble() / pw, h.toDouble() / ph)
        view.layoutParams = FrameLayout.LayoutParams((pw * scale).roundToInt(), (ph * scale).roundToInt(), Gravity.CENTER)
        device.enableShutterSound(true)
        device.setPreviewTexture(surface)
        op.check()
        device.startPreview()
    }

    private fun manualShutter() {
        automatic = false
        hint.text = "请预览画面，再按拍摄"
        shutter.visibility = View.VISIBLE
        shutter.isEnabled = true
    }

    private fun takePhoto() {
        val device = camera ?: return
        if (!direct()) automatic = false
        if (!ready || texture?.isShown != true || !dialog.isShowing || !dialog.window!!.decorView.hasWindowFocus())
            sensorFailure("foreground_required", "拍摄需要可见预览")
        shutter.isEnabled = false
        hint.text = "正在拍摄…"
        device.takePicture(null, null, Camera.PictureCallback { bytes, source ->
            op.guard {
                if (camera !== source) return@guard
                releaseCamera()
                texture = null
                stage.removeAllViews()
                op.io(work = { process(bytes, rotation, edge, compression) }) { photo ->
                    if (automatic && direct()) upload(photo) else review(photo)
                }
            }
        })
    }

    private fun review(photo: Photo) {
        automatic = false
        captured = photo
        val options = BitmapFactory.Options().apply { inSampleSize = if (maxOf(photo.width, photo.height) > 1600) 2 else 1 }
        val bitmap = BitmapFactory.decodeByteArray(photo.bytes, 0, photo.bytes.size, options)
            ?: sensorFailure("camera_processing_failed", "无法显示待上传的照片")
        stage.addView(ImageView(host).apply {
            contentDescription = "待上传的照片"
            scaleType = ImageView.ScaleType.FIT_CENTER
            setImageBitmap(bitmap)
        }, FrameLayout.LayoutParams(MATCH_PARENT, MATCH_PARENT))
        hint.text = "确认这张照片可以发给请求方"
        retake.visibility = View.VISIBLE
        shutter.text = "使用并上传"
        shutter.visibility = View.VISIBLE
        shutter.isEnabled = true
    }

    private fun upload(photo: Photo) {
        captured = null
        shutter.isEnabled = false
        retake.isEnabled = false
        hint.text = "正在上传照片…"
        op.io(work = {
            val id = NativeJson.digest(op.call.id)
            val sha = MessageDigest.getInstance("SHA-256").digest(photo.bytes).joinToString("") { "%02x".format(it) }
            op.check()
            val stored = op.call.upload!!.put(photo.bytes, "image/jpeg", "$id.jpg", "camera-$id", sha)
            obj("objectRef" to stored.getString("uri"), "bytes" to photo.bytes.size, "sha256" to sha,
                "height" to photo.height, "width" to photo.width, "mimeType" to "image/jpeg")
        }, receive = op::finish)
    }

    private data class Photo(val bytes: ByteArray, val width: Int, val height: Int)

    companion object {
        fun cameras() = (0 until Camera.getNumberOfCameras()).associateWith { id ->
            Camera.CameraInfo().also { Camera.getCameraInfo(id, it) }
        }.filterValues { it.facing == Camera.CameraInfo.CAMERA_FACING_BACK || it.facing == Camera.CameraInfo.CAMERA_FACING_FRONT }

        private fun process(raw: ByteArray?, rotation: Int, edge: Int, quality: Int): Photo {
            if (raw == null || raw.isEmpty()) sensorFailure("camera_capture_failed", "相机未返回照片")
            if (raw.size > 30 * 1024 * 1024) sensorFailure("photo_too_large", "原始照片超过上限")
            val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            BitmapFactory.decodeByteArray(raw, 0, raw.size, bounds)
            if (bounds.outWidth <= 0 || bounds.outHeight <= 0 || bounds.outWidth.toLong() * bounds.outHeight > 12_000_000)
                sensorFailure("camera_processing_failed", "无效的相机图像尺寸")
            val options = BitmapFactory.Options()
            val largest = maxOf(bounds.outWidth, bounds.outHeight)
            var sample = 1
            while (largest / (sample * 2) >= edge) sample *= 2
            options.inSampleSize = sample
            val source = BitmapFactory.decodeByteArray(raw, 0, raw.size, options)
                ?: sensorFailure("camera_processing_failed", "无法读取相机照片")
            try {
                val scale = minOf(1f, edge.toFloat() / maxOf(source.width, source.height))
                val transform = Matrix().apply { setScale(scale, scale); postRotate(rotation.toFloat()) }
                val output = Bitmap.createBitmap(source, 0, 0, source.width, source.height, transform, true)
                try {
                    val stream = ByteArrayOutputStream()
                    if (!output.compress(Bitmap.CompressFormat.JPEG, quality, stream))
                        sensorFailure("camera_processing_failed", "无法生成 JPEG 照片")
                    if (stream.size() > 10 * 1024 * 1024) sensorFailure("photo_too_large", "照片超过上传上限")
                    val bytes = stream.toByteArray()
                    if (bytes.size < 4 || bytes[0] != (-1).toByte() || bytes[1] != 0xd8.toByte() ||
                        bytes[bytes.lastIndex - 1] != (-1).toByte() || bytes.last() != 0xd9.toByte())
                        sensorFailure("camera_processing_failed", "照片不完整")
                    return Photo(bytes, output.width, output.height)
                } finally { if (output !== source) output.recycle() }
            } finally { source.recycle() }
        }
    }
}

package ai.tokenroll.toolbridge.mobile

import android.accessibilityservice.AccessibilityService
import android.graphics.Rect
import android.hardware.display.DisplayManager
import android.graphics.Bitmap
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.view.accessibility.AccessibilityWindowInfo
import java.io.ByteArrayOutputStream
import java.util.concurrent.CompletableFuture
import java.util.concurrent.TimeUnit
import org.json.JSONArray
import org.json.JSONObject

/** Only capture a particular application window. A whole-display fallback could include other apps. */
internal object WindowCapture {
    private val main = Handler(Looper.getMainLooper())
    private data class Target(val epoch: String, val packageName: String, val windowId: Int, val bounds: Rect, val rotation: Int?)
    private fun target(s: PhoneControlService, call: WireCall): Target {
        call.checkActive()
        val epoch = RemoteSession.requireGrant(s,call.callerSubjectId)
        val node = s.rootInActiveWindow ?: throw WireFailure("unavailable","当前窗口不可用")
        try {
            val pkg = node.packageName?.toString().orEmpty()
            if (pkg !in RemoteSession.packages) throw WireFailure("permission_denied","当前窗口不在授权范围")
            val windows = s.windows
            try {
                val window = windows.firstOrNull { it.id == node.windowId && it.isActive && it.type == AccessibilityWindowInfo.TYPE_APPLICATION }
                    ?: throw WireFailure("permission_denied","当前窗口不在授权范围")
                val bounds = Rect().also(window::getBoundsInScreen)
                val rotation = if (Build.VERSION.SDK_INT >= 30)
                    s.getSystemService(DisplayManager::class.java).getDisplay(window.displayId)?.rotation?.times(90)
                    else null
                return Target(epoch,pkg,node.windowId,bounds,rotation)
            } finally { windows.forEach { it.recycle() } }
        } finally { node.recycle() }
    }
    fun capture(call: WireCall): JSONObject {
        if (Build.VERSION.SDK_INT < 34) throw WireFailure("unavailable","按窗口截图需要 Android 14")
        val upload = call.upload ?: throw WireFailure("permission_denied","本次调用没有图片上传授权")
        val result = CompletableFuture<Pair<Bitmap, String>>()
        val selected = CompletableFuture<Target>()
        val sub = call.signal.onCancel { result.cancel(false) }
        try {
            main.post {
                if (result.isDone) return@post
                try {
                    val s = RemoteSession.service ?: throw WireFailure("unavailable","无障碍服务已断开")
                    val initial = target(s,call)
                    selected.complete(initial)
                    s.takeScreenshotOfWindow(initial.windowId,s.mainExecutor,object : AccessibilityService.TakeScreenshotCallback {
                        override fun onSuccess(image: AccessibilityService.ScreenshotResult) {
                            image.hardwareBuffer.use { buffer ->
                                if (result.isDone) return
                                try {
                                    if (target(s,call) != initial) throw WireFailure("permission_denied","授权窗口已变化")
                                    val bmp = Bitmap.wrapHardwareBuffer(buffer,image.colorSpace) ?: error("capture")
                                    if (!result.complete(bmp to NativeJson.now())) bmp.recycle()
                                } catch (e: Exception) { result.completeExceptionally(e) }
                            }
                        }
                        override fun onFailure(errorCode: Int) {
                            result.completeExceptionally(WireFailure("unavailable","系统未提供此窗口的截图"))
                        }
                    })
                } catch (e: Exception) { result.completeExceptionally(e) }
            }
            val (source, capturedAt) = result.get(4,TimeUnit.SECONDS)
            val sourceWidth = source.width
            val sourceHeight = source.height
            val original = try { source.copy(Bitmap.Config.ARGB_8888,false) } finally { source.recycle() }
            val scale = minOf(1.0, 1280.0/maxOf(original.width,original.height))
            val bitmap = Bitmap.createScaledBitmap(original,(original.width*scale).toInt().coerceAtLeast(1),
                (original.height*scale).toInt().coerceAtLeast(1),true)
            if (bitmap !== original) original.recycle()
            val width = bitmap.width
            val height = bitmap.height
            val bytes = try { ByteArrayOutputStream().use { out ->
                check(bitmap.compress(Bitmap.CompressFormat.JPEG,78,out)); out.toByteArray()
            } } finally { bitmap.recycle() }
            val check = CompletableFuture<Boolean>()
            main.post { check.complete(runCatching { RemoteSession.service?.let { target(it,call) } == selected.getNow(null) }.getOrDefault(false)) }
            if (!check.get(2,TimeUnit.SECONDS)) throw WireFailure("permission_denied","本次授权已结束")
            call.checkActive()
            val descriptor = upload.put(bytes,"image/jpeg","window.jpg",call.id)
            val output = obj("uri" to descriptor.getString("uri"),"contentType" to "image/jpeg","width" to width,"height" to height)
            if (call.arguments.optInt("v") == 2) {
                val frame = selected.get()
                val bounds = frame.bounds
                output.put("v", 2).put("window", semanticWindowRef(frame.epoch,frame.packageName,frame.windowId))
                    .put("capturedAt", capturedAt).put("sourcePx", obj("width" to sourceWidth, "height" to sourceHeight))
                    .put("windowBoundsPx", JSONArray(listOf(bounds.left, bounds.top, bounds.right, bounds.bottom)))
                    .put("rotationDegrees", frame.rotation ?: JSONObject.NULL)
            }
            return output
        } catch (e: java.util.concurrent.ExecutionException) {
            throw e.cause ?: e
        } finally { result.cancel(false); sub.close() }
    }
}

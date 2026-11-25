package ai.tokenroll.toolbridge.mobile

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.CancellationSignal
import android.provider.Settings
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

class MainActivity : Activity(), NativeScreenActions {
    private lateinit var screens: NativeScreens
    private val runtime get() = (application as PhoneApp).runtime
    private val images = Executors.newFixedThreadPool(2)
    private val http = OkHttpClient.Builder().followRedirects(false).followSslRedirects(false)
        .callTimeout(10,TimeUnit.SECONDS).build()
    private var pendingPermission: ((Boolean) -> Unit)? = null
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        screens = NativeScreens(this,this)
        setContentView(screens.view)
        runtime.refreshed = { if (!isDestroyed) screens.refresh() }
        intent?.getStringExtra("messageId")?.let(screens::openMessage)
    }
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent); intent.getStringExtra("messageId")?.let(screens::openMessage)
    }
    override fun onResume() { super.onResume(); runtime.refresh() }
    // NativeScreens registers OnBackInvokedCallback on API 33+. Older Android calls this entry.
    @android.annotation.SuppressLint("GestureBackNavigation")
    @Deprecated("Legacy Android back dispatch")
    override fun onBackPressed() { if (!screens.onBackPressed()) super.onBackPressed() }
    override fun onDestroy() {
        runtime.refreshed = null; screens.dispose(); http.dispatcher.cancelAll(); images.shutdownNow()
        pendingPermission?.invoke(false); pendingPermission = null
        super.onDestroy()
    }
    override fun snapshot() = runtime.state()
    override fun message(messageId: String) = runtime.message(messageId)
    override fun openRemoteControlConfiguration() { startActivity(Intent(this,ControlActivity::class.java)) }
    override fun perform(action: NativeScreenAction, complete: (Boolean) -> Unit) {
        when (action) {
            is NativeScreenAction.OpenInboxLink -> complete(runCatching {
                require(action.url.length <= 2048)
                val url = safeUrl(action.url)
                startActivity(Intent(Intent.ACTION_VIEW,Uri.parse(url.toString())).addCategory(Intent.CATEGORY_BROWSABLE))
            }.isSuccess)
            is NativeScreenAction.PermissionAction -> {
                if (action.openSettings) {
                    startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,Uri.parse("package:" + packageName)))
                    complete(true)
                } else {
                    val name = if (action.permission == NativeScreenAction.Permission.CAMERA) Manifest.permission.CAMERA
                        else if (Build.VERSION.SDK_INT >= 33) Manifest.permission.POST_NOTIFICATIONS else null
                    if (name == null || checkSelfPermission(name) == PackageManager.PERMISSION_GRANTED) complete(true)
                    else if (pendingPermission != null) complete(false) else {
                        pendingPermission = complete; requestPermissions(arrayOf(name),29)
                    }
                }
            }
            else -> runtime.action(action,complete)
        }
    }
    override fun onRequestPermissionsResult(code: Int, permissions: Array<out String>, results: IntArray) {
        super.onRequestPermissionsResult(code,permissions,results)
        if (code == 29) {
            val cb = pendingPermission; pendingPermission = null; runtime.refresh()
            cb?.invoke(results.firstOrNull() == PackageManager.PERMISSION_GRANTED)
        }
    }
    private fun safeUrl(raw: String): HttpUrl {
        val url = requireNotNull(raw.toHttpUrlOrNull())
        require(url.isHttps && url.username.isEmpty() && url.password.isEmpty() && url.port == 443 &&
            !url.host.contains(':') && !Regex("[0-9.]+").matches(url.host))
        return url
    }
    override fun resolveInboxImage(url: String, cancellation: CancellationSignal, complete: (Bitmap?) -> Unit) {
        images.execute {
            val image = runCatching { fetchImage(url,cancellation) }.getOrNull()
            runOnUiThread { if (!isDestroyed && !cancellation.isCanceled) complete(image) else image?.recycle() }
        }
    }
    private fun fetchImage(raw: String, signal: CancellationSignal): Bitmap? {
        var target = safeUrl(raw)
        repeat(4) { index ->
            require(target.fragment == null)
            signal.throwIfCanceled()
            val call = http.newCall(Request.Builder().url(target).build())
            signal.setOnCancelListener(call::cancel)
            try {
                call.execute().use { res ->
                    if (res.isRedirect) {
                        require(index < 3)
                        target = safeUrl(requireNotNull(target.resolve(requireNotNull(res.header("Location")))).toString())
                    } else {
                        val body = requireNotNull(res.body)
                        val type = body.contentType()?.let { it.type + "/" + it.subtype }
                        require(res.isSuccessful && type in setOf("image/png","image/jpeg") && body.contentLength() <= 3 * 1024 * 1024)
                        val stream = ByteArrayOutputStream()
                        val buf = ByteArray(8192)
                        val input = body.byteStream()
                        while (true) {
                            val n = input.read(buf); if (n < 0) break
                            require(stream.size() + n <= 3 * 1024 * 1024)
                            stream.write(buf,0,n)
                        }
                        val bytes = stream.toByteArray()
                        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
                        BitmapFactory.decodeByteArray(bytes,0,bytes.size,bounds)
                        require(bounds.outMimeType == type && bounds.outWidth in 1..4096 && bounds.outHeight in 1..4096 &&
                            bounds.outWidth.toLong()*bounds.outHeight <= 16000000)
                        signal.throwIfCanceled()
                        return BitmapFactory.decodeByteArray(bytes,0,bytes.size)
                    }
                }
            } finally { signal.setOnCancelListener(null) }
        }
        return null
    }
}

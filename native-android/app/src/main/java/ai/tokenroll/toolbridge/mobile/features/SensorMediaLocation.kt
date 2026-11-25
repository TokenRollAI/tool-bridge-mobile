@file:Suppress("DEPRECATION")

package ai.tokenroll.toolbridge.mobile

import android.Manifest.permission.ACCESS_COARSE_LOCATION
import android.Manifest.permission.ACCESS_FINE_LOCATION
import android.app.AlertDialog
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import java.net.URLEncoder
import android.os.Build
import android.os.Bundle
import org.json.JSONObject
import java.util.Locale

// geo query data must stay data even when a label contains the Android geo delimiters.
private fun mapParameter(value: String) = URLEncoder.encode(value, "UTF-8")
    .replace("+", "%20").replace("*", "%2A").replace("%7E", "~")

internal fun sensorMapTarget(target: JSONObject): Pair<String, String> {
    if (target.getString("kind") == "query") {
        val query = deviceText(target, "query", 200)
        return ("geo:0,0?q=" + mapParameter(query)) to query
    }
    if (target.getString("kind") != "coordinate") sensorFailure("invalid_argument", "地图目标类型无效")
    fun coordinate(key: String, max: Double): String {
        val n = target.getDouble(key)
        if (n !in -max..max) sensorFailure("invalid_argument", "无效的地图坐标")
        return String.format(Locale.US, "%.6f", n).trimEnd('0').trimEnd('.').let { if (it == "-0") "0" else it }
    }
    val pair = coordinate("latitude", 90.0) + "," + coordinate("longitude", 180.0)
    val zoom = if (target.has("zoom")) target.getInt("zoom").also {
        if (it !in 2..21) sensorFailure("invalid_argument", "地图缩放级别无效")
    } else null
    if (!target.has("label")) return ("geo:" + pair + (zoom?.let { "?z=$it" } ?: "")) to pair
    val label = deviceText(target, "label", 80)
    return ("geo:0,0?q=" + mapParameter("$pair($label)") + (zoom?.let { "&z=$it" } ?: "")) to "$label ($pair)"
}

internal fun enabledLocationProviders(manager: LocationManager): List<String> {
    val supported = manager.allProviders
    val preferred = buildList {
        add(LocationManager.NETWORK_PROVIDER)
        if (Build.VERSION.SDK_INT >= 31) add(LocationManager.FUSED_PROVIDER)
        add(LocationManager.GPS_PROVIDER)
    }
    return preferred.filter { it in supported && manager.isProviderEnabled(it) }
}

internal fun currentLocation(op: SensorMediaRequest, direct: Boolean) {
    val args = op.call.arguments
    val purpose = deviceText(args, "purpose", 120)
    val high = when (args.optString("accuracy", "balanced")) {
        "high" -> true
        "balanced" -> false
        else -> sensorFailure("invalid_argument", "定位精度无效")
    }
    val seconds = args.optInt("timeoutSeconds", 15)
    if (seconds !in 5..30) sensorFailure("invalid_argument", "定位时限无效")
    val accuracy = if (high) "高精度" else "均衡精度"
    val message = "${op.caller}\n$purpose\n$accuracy · 最长 ${seconds} 秒"
    val start = {
        op.permission(arrayOf(ACCESS_COARSE_LOCATION, ACCESS_FINE_LOCATION), message) {
            val manager = op.host.getSystemService(LocationManager::class.java)
                ?: sensorFailure("unavailable", "系统定位不可用")
            val precise = op.granted(ACCESS_FINE_LOCATION)
            val providers = enabledLocationProviders(manager)
            val provider = (if (high && precise) providers.reversed() else providers)
                .firstOrNull { it != LocationManager.GPS_PROVIDER || precise }
                ?: sensorFailure("unavailable", "没有与当前授权相符的定位服务")
            op.show(AlertDialog.Builder(op.host).setTitle("正在获取一次位置").setMessage(message)
                .setNegativeButton("取消") { _, _ -> op.reject() }.create())
            val listener = object : LocationListener {
                override fun onLocationChanged(fix: Location) = op.guard {
                    if (!op.granted(ACCESS_FINE_LOCATION) && !op.granted(ACCESS_COARSE_LOCATION))
                        sensorFailure("permission_denied", "前台位置授权已撤销")
                    if (System.currentTimeMillis() - fix.time !in -5000L..30000L)
                        sensorFailure("stale_location", "系统返回的位置已过期")
                    if (fix.latitude !in -90.0..90.0 || fix.longitude !in -180.0..180.0)
                        sensorFailure("unavailable", "系统返回的位置无效")
                    op.finish(obj("capturedAt" to NativeJson.now(fix.time),
                        "coordinate" to obj("latitude" to fix.latitude, "longitude" to fix.longitude),
                        "horizontalAccuracyMeters" to fix.accuracy.takeIf { fix.hasAccuracy() && it.isFinite() && it >= 0 },
                        "mocked" to fix.isFromMockProvider,
                        "permissionAccuracy" to if (op.granted(ACCESS_FINE_LOCATION)) "precise" else "approximate"))
                }
                override fun onProviderDisabled(name: String) { op.fail(WireFailure("unavailable", "定位服务已关闭")) }
                override fun onProviderEnabled(name: String) = Unit
                override fun onStatusChanged(name: String?, status: Int, extras: Bundle?) = Unit
            }
            val timeout = Runnable { op.fail(WireFailure("timeout", "未在时限内取得位置", true)) }
            op.onEnd { op.main.removeCallbacks(timeout); manager.removeUpdates(listener) }
            op.check()
            try { manager.requestSingleUpdate(provider, listener, op.main.looper) }
            catch (_: SecurityException) {
                throw WireFailure("permission_denied", "位置权限已被撤销")
            }
            op.main.postDelayed(timeout, seconds * 1000L)
        }
    }
    if (direct || !op.granted(ACCESS_COARSE_LOCATION) && !op.granted(ACCESS_FINE_LOCATION)) start()
    else op.prompt("共享一次当前位置", message, "获取位置", start)
}

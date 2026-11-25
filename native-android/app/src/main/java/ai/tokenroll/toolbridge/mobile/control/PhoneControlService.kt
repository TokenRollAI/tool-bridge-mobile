package ai.tokenroll.toolbridge.mobile

import android.accessibilityservice.AccessibilityService
import android.app.KeyguardManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.os.SystemClock
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import android.view.accessibility.AccessibilityWindowInfo
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID
import java.util.concurrent.Callable
import java.util.concurrent.FutureTask
import java.util.concurrent.TimeUnit

/** Local-only grant. Process death, service loss and device lock all invalidate it. */
object RemoteSession {
    const val DURATION_MS = 5 * 60_000L
    private val main = Handler(Looper.getMainLooper())
    @Volatile var service: PhoneControlService? = null
        internal set
    @Volatile var packages: Set<String> = emptySet()
        private set
    @Volatile var expiresAt = 0L
        private set
    private var epoch = ""
    private var owner: String? = null
    private val stopTimer = Runnable { stop() }
    var onChange: (() -> Unit)? = null
    val active get() = packages.isNotEmpty() && SystemClock.elapsedRealtime() < expiresAt

    fun begin(context: Context, selected: Set<String>) {
        check(Looper.myLooper() == Looper.getMainLooper())
        require(selected.isNotEmpty() && PhoneControlService.allowedApps(context).keys.containsAll(selected))
        check(service != null && unlocked(context))
        main.removeCallbacks(stopTimer)
        service?.discardObservation()
        owner = null
        packages = selected.toSet()
        epoch = UUID.randomUUID().toString()
        expiresAt = SystemClock.elapsedRealtime() + DURATION_MS
        main.postDelayed(stopTimer, DURATION_MS)
        onChange?.invoke()
    }

    fun stop() {
        check(Looper.myLooper() == Looper.getMainLooper())
        main.removeCallbacks(stopTimer)
        packages = emptySet()
        epoch = ""
        owner = null
        expiresAt = 0L
        service?.discardObservation()
        onChange?.invoke()
    }

    fun requireGrant(context: Context, caller: String): String {
        if (!active || !unlocked(context) || caller.isBlank()) throw WireFailure("permission_denied", "请在已解锁的手机上开始远控")
        if (owner == null) owner = caller
        if (owner != caller) throw WireFailure("permission_denied", "会话已绑定另一调用者")
        return epoch
    }

    fun unlocked(context: Context) = context.getSystemService(PowerManager::class.java).isInteractive &&
        !context.getSystemService(KeyguardManager::class.java).isDeviceLocked

    fun invoke(call: WireCall): JSONObject {
        if (call.delivery != "realtime") throw WireFailure("permission_denied", "远控仅接受实时操作")
        if (call.tool == "screenshot") return WindowCapture.capture(call)
        val task = FutureTask(Callable {
            call.checkActive()
            val target = service ?: throw WireFailure("unavailable", "请在系统设置中开启无障碍服务")
            target.performCall(call)
        })
        if (!main.post(task)) throw WireFailure("unavailable", "手机运行时已停止")
        val cancellation = call.signal.onCancel { task.cancel(false) }
        try {
            return task.get(4, TimeUnit.SECONDS)
        } catch (error: java.util.concurrent.ExecutionException) {
            throw error.cause ?: error
        } finally {
            task.cancel(false)
            main.removeCallbacks(task)
            cancellation.close()
        }
    }
}

class PhoneControlService : AccessibilityService() {
    private val refs = mutableMapOf<String, AccessibilityNodeInfo>()
    private var observedWindow = -1
    private var observedPackage = ""
    private val locked = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) { RemoteSession.stop() }
    }

    override fun onServiceConnected() {
        super.onServiceConnected()
        RemoteSession.service = this
        val filter = IntentFilter(Intent.ACTION_SCREEN_OFF)
        if (Build.VERSION.SDK_INT >= 33) registerReceiver(locked, filter, RECEIVER_NOT_EXPORTED)
        else registerReceiver(locked, filter)
        RemoteSession.onChange?.invoke()
    }
    override fun onInterrupt() { RemoteSession.stop() }
    override fun onDestroy() {
        if (RemoteSession.service === this) {
            RemoteSession.stop()
            RemoteSession.service = null
            RemoteSession.onChange?.invoke()
        }
        runCatching { unregisterReceiver(locked) }
        super.onDestroy()
    }

    fun discardObservation() {
        refs.values.forEach { it.recycle() }
        refs.clear()
        observedWindow = -1
        observedPackage = ""
    }
    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        // A snapshot is single-use and valid only while its window and content remain current.
        if (refs.isNotEmpty() && event != null) discardObservation()
    }

    internal fun performCall(call: WireCall): JSONObject {
        val epoch = RemoteSession.requireGrant(this, call.callerSubjectId)
        val root = rootInActiveWindow ?: throw WireFailure("unavailable", "当前窗口不可读取")
        try {
            val pkg = root.packageName?.toString() ?: ""
            if (pkg !in RemoteSession.packages || windows.none {
                    it.id == root.windowId && it.type == AccessibilityWindowInfo.TYPE_APPLICATION && it.isActive
                }) {
                discardObservation()
                throw WireFailure("permission_denied", "当前窗口不在本次授权范围内")
            }
            if (call.tool == "observe") return observe(root, pkg, epoch)
            val args = call.arguments
            val node = refs[args.optString("element")]
            if (node == null || observedWindow != root.windowId || observedPackage != pkg ||
                !node.refresh() || node.windowId != root.windowId || node.packageName?.toString() != pkg ||
                !node.isVisibleToUser || !node.isEnabled || sensitive(node)) {
                discardObservation()
                throw WireFailure("unavailable", "界面已变化，请重新读取")
            }
            val action = when (call.tool) {
                "tap" -> AccessibilityNodeInfo.ACTION_CLICK
                "scroll" -> when (args.optString("direction")) {
                    "forward" -> AccessibilityNodeInfo.ACTION_SCROLL_FORWARD
                    "backward" -> AccessibilityNodeInfo.ACTION_SCROLL_BACKWARD
                    else -> throw WireFailure("invalid_argument", "滚动方向无效")
                }
                "type" -> AccessibilityNodeInfo.ACTION_SET_TEXT
                else -> throw WireFailure("not_found", "未知操作")
            }
            if (node.actionList.none { it.id == action }) throw WireFailure("unavailable", "控件不支持此操作")
            val params = if (call.tool == "type") {
                val text = args.opt("text") as? String ?: throw WireFailure("invalid_argument", "请输入文本")
                if (text.length > 2048 || !node.isEditable) throw WireFailure("invalid_argument", "文本或输入框不支持")
                Bundle().apply { putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, text) }
            } else null
            call.checkActive()
            RemoteSession.requireGrant(this, call.callerSubjectId)
            val accepted = try { node.performAction(action, params) } finally { discardObservation() }
            if (!accepted) throw WireFailure("unavailable", "目标 App 拒绝操作")
            return JSONObject().put("accepted", true)
        } finally { root.recycle() }
    }

    private fun observe(root: AccessibilityNodeInfo, pkg: String, epoch: String): JSONObject {
        discardObservation()
        observedWindow = root.windowId
        observedPackage = pkg
        val prefix = epoch + "." + UUID.randomUUID().toString() + "."
        val elements = JSONArray()
        var visited = 0
        fun visit(node: AccessibilityNodeInfo, depth: Int) {
            if (++visited > 256 || depth > 35 || elements.length() >= 96 || !node.isVisibleToUser ||
                node.packageName?.toString() != pkg || sensitive(node)) return
            val actions = node.actionList.map { it.id }.toSet()
            val label = (node.contentDescription ?: node.text)?.take(140)?.toString().orEmpty()
            val clickable = AccessibilityNodeInfo.ACTION_CLICK in actions
            val editable = node.isEditable && AccessibilityNodeInfo.ACTION_SET_TEXT in actions
            val scrollable = node.isScrollable
            if (label.isNotEmpty() || clickable || editable || scrollable) {
                val id = prefix + elements.length()
                refs[id] = AccessibilityNodeInfo.obtain(node)
                elements.put(JSONObject().put("element", id).put("label", label)
                    .put("clickable", clickable).put("editable", editable).put("scrollable", scrollable))
            }
            for (i in 0 until node.childCount) {
                if (visited >= 256 || elements.length() >= 96) break
                val child = node.getChild(i) ?: continue
                try { visit(child, depth + 1) } finally { child.recycle() }
            }
        }
        visit(root, 0)
        return JSONObject().put("package", pkg).put("elements", elements)
    }

    private fun sensitive(node: AccessibilityNodeInfo): Boolean = node.isPassword ||
        (Build.VERSION.SDK_INT >= 34 && node.isAccessibilityDataSensitive)

    companion object {
        fun allowedApps(context: Context): Map<String, String> {
            val pm = context.packageManager
            val intent = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
            val home = pm.resolveActivity(Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME), 0)?.activityInfo?.packageName
            val excluded = setOfNotNull(context.packageName, home, "android", "com.android.settings", "com.android.systemui",
                pm.resolveActivity(Intent(android.provider.Settings.ACTION_SETTINGS), 0)?.activityInfo?.packageName,
                pm.resolveActivity(Intent("android.intent.action.MANAGE_APP_PERMISSIONS"), 0)?.activityInfo?.packageName)
            return pm.queryIntentActivities(intent, 0).filter { it.activityInfo.exported && it.activityInfo.packageName !in excluded }
                .associate { it.activityInfo.packageName to it.loadLabel(pm).toString() }
        }
    }
}

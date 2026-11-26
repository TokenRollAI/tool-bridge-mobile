package ai.tokenroll.toolbridge.mobile

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.AccessibilityServiceInfo
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
    private data class Grant(val packages: Set<String>, val deadline: Long?, val epoch: String)
    @Volatile private var grant: Grant? = null
    val packages: Set<String> get() = grant?.packages.orEmpty()
    val unlimited: Boolean get() = grant?.let { it.deadline == null } == true
    val expiresAt: Long? get() {
        val current = grant ?: return 0L
        return current.deadline
    }
    private val epoch: String get() = grant?.epoch.orEmpty()
    private var owner: String? = null
    private val stopTimer = Runnable { stop() }
    var onChange: (() -> Unit)? = null
    val active: Boolean get() {
        val current = grant ?: return false
        return current.deadline == null || SystemClock.elapsedRealtime() < current.deadline
    }

    fun begin(context: Context, selected: Set<String>) {
        check(Looper.myLooper() == Looper.getMainLooper())
        require(PhoneControlService.allowedApps(context).keys.containsAll(selected))
        start(context, selected, SystemClock.elapsedRealtime() + DURATION_MS)
    }

    fun beginUnlimited(context: Context) {
        check(Looper.myLooper() == Looper.getMainLooper())
        start(context, PhoneControlService.allowedApps(context).keys, null)
    }

    private fun start(context: Context, selected: Set<String>, deadline: Long?) {
        require(selected.isNotEmpty())
        check(service != null && unlocked(context) && ConnectionService.canShowControls(context))
        main.removeCallbacks(stopTimer)
        service?.discardObservation()
        owner = null
        grant = Grant(selected.toSet(), deadline, UUID.randomUUID().toString())
        if (deadline != null) main.postDelayed(stopTimer, (deadline - SystemClock.elapsedRealtime()).coerceAtLeast(0))
        onChange?.invoke()
    }

    fun stop() {
        check(Looper.myLooper() == Looper.getMainLooper())
        main.removeCallbacks(stopTimer)
        grant = null
        owner = null
        service?.discardObservation()
        onChange?.invoke()
    }

    // Main-thread queries for the status reader and continuations of an existing operation.
    fun availableTo(caller: String) = owner == null || owner == caller

    private fun activeUnlocked(context: Context): Boolean {
        if (!active) return false
        if (unlocked(context)) return true
        stop()
        return false
    }

    internal fun holds(context: Context, scope: SemanticScope) =
        activeUnlocked(context) && epoch == scope.epoch && owner == scope.caller && scope.app in packages

    internal fun checkGrant(context: Context, caller: String, allowUnbound: Boolean): String {
        if (!activeUnlocked(context) || caller.isBlank()) throw WireFailure("permission_denied", "请在已解锁的手机上开始远控")
        if (owner != caller && !(allowUnbound && owner == null))
            throw WireFailure("permission_denied", "调用者没有本次授权")
        return epoch
    }

    fun requireGrant(context: Context, caller: String): String {
        val current = checkGrant(context, caller, allowUnbound = true)
        owner = caller
        return current
    }

    fun unlocked(context: Context) = context.getSystemService(PowerManager::class.java).isInteractive &&
        !context.getSystemService(KeyguardManager::class.java).isDeviceLocked

    fun invoke(call: WireCall): JSONObject {
        if (call.delivery != "realtime") throw WireFailure("permission_denied", "远控仅接受实时操作")
        val v2 = (call.arguments.opt("v") as? Number)?.toDouble() == 2.0
        if (call.arguments.has("v") && !v2) invalidWire()
        if (call.tool in setOf("status", "back", "media") && !v2) invalidWire()
        if (call.tool == "status") return ControlStatus.read(call)
        if (call.tool == "apps") return BroadAppControl.invoke(call, main)
        if (call.tool == "open_app") return BroadAppControl.invoke(call, main)
        if (call.tool == "screenshot") return WindowCapture.capture(call)
        if (v2) return ScopedActionCall.invoke(call, main)
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
    internal val scopedActions = ScopedActions(this)
    private val refs = mutableMapOf<String, AccessibilityNodeInfo>()
    private var observedWindow = -1
    private var observedPackage = ""
    private val locked = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) { RemoteSession.stop() }
    }

    override fun onServiceConnected() {
        super.onServiceConnected()
        serviceInfo = serviceInfo.apply {
            eventTypes = eventTypes or AccessibilityEvent.TYPE_VIEW_SCROLLED
            flags = flags or AccessibilityServiceInfo.FLAG_REPORT_VIEW_IDS
        }
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
        scopedActions.reset()
        discardLegacyObservation()
    }

    private fun discardLegacyObservation() {
        refs.values.forEach { it.recycle() }
        refs.clear()
        observedWindow = -1
        observedPackage = ""
    }
    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        // Legacy references still expire on every event in the original service subscription.
        if (event == null) return
        if (refs.isNotEmpty() && event.eventType != AccessibilityEvent.TYPE_VIEW_SCROLLED) discardLegacyObservation()
        when (event.eventType) {
            AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED,
            AccessibilityEvent.TYPE_WINDOWS_CHANGED -> {
                if (RemoteSession.active && !RemoteSession.unlocked(this)) RemoteSession.stop()
                else scopedActions.navigation(event)
            }
            else -> scopedActions.contentChanged(event.eventType == AccessibilityEvent.TYPE_VIEW_SCROLLED)
        }
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
                discardLegacyObservation()
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
            scopedActions.otherAction(scrolled = call.tool == "scroll")
            val accepted = try { node.performAction(action, params) } finally { discardLegacyObservation() }
            if (!accepted) throw WireFailure("unavailable", "目标 App 拒绝操作")
            return JSONObject().put("accepted", true)
        } finally { root.recycle() }
    }

    private fun observe(root: AccessibilityNodeInfo, pkg: String, epoch: String): JSONObject {
        discardLegacyObservation()
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

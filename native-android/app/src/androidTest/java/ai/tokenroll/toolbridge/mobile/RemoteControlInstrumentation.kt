package ai.tokenroll.toolbridge.mobile

import android.app.Activity
import android.app.Instrumentation
import android.content.ComponentName
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.accessibility.AccessibilityWindowInfo
import org.json.JSONObject
import java.util.UUID
import java.util.concurrent.Callable
import java.util.concurrent.FutureTask
import java.util.concurrent.TimeUnit

/** No UiAutomation client. The host enables the real service after instrumentation has started. */
class RemoteControlInstrumentation : Instrumentation() {
    private var optedIn = false
    private val notes get() = context.packageName
    private val phone get() = targetContext.packageName

    override fun onCreate(arguments: Bundle?) {
        super.onCreate(arguments)
        optedIn = arguments?.getString("isolatedAvd") == "yes"
        start()
    }

    override fun onStart() {
        val outcome = runCatching {
            check(optedIn && Build.HARDWARE in setOf("ranchu", "goldfish")) { "Requires an isolated AVD" }
            check(phone == "ai.tokenroll.toolbridgemobile.dev" && notes == "$phone.test")
            check(!RemoteSession.active)
            status("ready")
            await("system accessibility service", 45_000) { main { RemoteSession.service != null } }
            try {
                exercise()
            } finally {
                main { RemoteSession.stop() }
            }
        }
        val error = outcome.exceptionOrNull()
        val result = Bundle().apply {
            putString("remoteControl", if (error == null) "PASS" else "FAIL")
            error?.let { putString("stream", it.stackTraceToString()) }
        }
        finish(if (error == null) Activity.RESULT_OK else Activity.RESULT_CANCELED, result)
    }

    private fun exercise() {
        val v2 = V2RemoteControlChecks(targetContext, notes, ::call)
        check(notes in PhoneControlService.allowedApps(targetContext))
        openNotes()
        expectFailure("permission_denied") { call("observe") }
        expectFailure("permission_denied") { call("tap", JSONObject().put("element", "no-grant")) }
        v2.denied()
        v2.appsDenied("local_grant_required")
        status("未授权读取和点击被拒绝")

        openControl()
        begin()
        openNotes()
        val body = "买牛奶 " + UUID.randomUUID().toString().take(8)
        act("type", JSONObject().put("text", body)) { it.getBoolean("editable") }
        await("输入框显示新正文") { observe().any { it.getBoolean("editable") && it.label == body } }
        act("tap") { it.label == "保存便签" && it.getBoolean("clickable") }
        await("保存按钮更新便签") { observe().any { it.label == "已保存：$body" } }
        val before = lastVisibleRow()
        act("scroll", JSONObject().put("direction", "forward")) { it.getBoolean("scrollable") }
        await("滚动后出现新的历史便签") { lastVisibleRow() > before }
        status("选中便签完成读取、输入、保存和滚动")

        val v2Prior = v2.noteRef()
        val prior = saveRef()
        openControl()
        check(RemoteSession.active)
        expectFailure("permission_denied") { call("observe") }
        expectFailure("permission_denied") { call("tap", prior) }
        v2.denied(v2Prior)
        openNotes()
        val v2AtStop = v2.noteRef()
        val atStop = saveRef()
        main { RemoteSession.stop() }
        check(RemoteSession.unlocked(targetContext))
        expectFailure("permission_denied") { call("tap", atStop) }
        expectFailure("permission_denied") { call("observe") }
        v2.denied(v2AtStop)
        status("未选中窗口和手动结束后的调用被拒绝")

        openControl()
        val started = SystemClock.elapsedRealtime()
        begin()
        val deadline = requireNotNull(RemoteSession.expiresAt)
        check(deadline in (started + 300_000)..(SystemClock.elapsedRealtime() + 300_000)) {
            "授权时长应为五分钟"
        }
        openNotes()
        v2.appsDenied("ready")
        expectFailure("unavailable") { call("tap", atStop) }
        saveRef()
        v2.previousGrant(v2AtStop)
        openControl()
        v2.feed({ awaitWindow(notes) }, { awaitWindow(phone) })
        v2.denied(v2AtStop)
        status("动态双栏已通过单次派发、歧义拒绝、分栏滚动与授权边界检查")
        openNotes()
        status("等待五分钟授权自然到期")
        SystemClock.sleep((deadline - SystemClock.elapsedRealtime() - 5_000).coerceAtLeast(0))
        val v2AtExpiry = v2.noteRef()
        val atExpiry = saveRef()
        SystemClock.sleep((deadline - SystemClock.elapsedRealtime()).coerceAtLeast(0))
        await("到期回收授权") { main { RemoteSession.packages.isEmpty() } }
        awaitWindow(notes)
        check(RemoteSession.unlocked(targetContext))
        expectFailure("permission_denied") { call("tap", atExpiry) }
        expectFailure("permission_denied") { call("observe") }
        v2.denied(v2AtExpiry)
        v2.appsDenied("local_grant_required")
        status("到期后读取和旧控件操作被拒绝")

        unlimitedSession(v2)

        openControl()
        begin()
        openNotes()
        v2.lockIsolatedAvd { lock -> main(lock) }
        status("模拟器锁屏已撤销授权和旧引用")
    }

    private fun unlimitedSession(v2: V2RemoteControlChecks) {
        openControl()
        main { RemoteSession.beginUnlimited(targetContext) }
        val started = SystemClock.elapsedRealtime()
        val session = v2.openListedNotes()
        awaitWindow(notes)
        v2.unlimitedReady(session)
        v2.noteRef()
        status("等待不限时授权跨过第二个真实五分钟")
        SystemClock.sleep((started + 300_001 - SystemClock.elapsedRealtime()).coerceAtLeast(0))
        v2.unlimitedReady(session)
        val beforeStop = v2.noteRef()
        main { RemoteSession.stop() }
        checkEnded()
        v2.denied(beforeStop)
        v2.appsDenied("local_grant_required", session)

        openControl()
        checkEnded()
        main { RemoteSession.beginUnlimited(targetContext) }
        val nextSession = v2.openListedNotes()
        check(nextSession != session)
        v2.rejectOldSession(session)
        awaitWindow(notes)
        v2.previousGrant(beforeStop)
        val beforeLock = v2.lockIsolatedAvd { lock -> main(lock) }
        checkEnded()
        v2.appsDenied("locked", nextSession)
        status("wake_isolated_avd")
        await("模拟器解锁") { RemoteSession.unlocked(targetContext) }
        openNotes()
        checkEnded()
        v2.denied(beforeLock)
        v2.appsDenied("local_grant_required", nextSession)
        status("不限时授权跨过五分钟，手动停止及锁屏解锁后均已回收")
    }

    private fun checkEnded() {
        check(!RemoteSession.active && !RemoteSession.unlimited && RemoteSession.expiresAt == 0L &&
            RemoteSession.packages.isEmpty()) { "已结束的授权应清空应用范围并将截止时间归零" }
    }

    private fun status(message: String) = sendStatus(1, Bundle().apply { putString("remoteControl", message) })

    private fun begin() = main { RemoteSession.begin(targetContext, setOf(notes)) }

    private fun openNotes() = open(notes, ControlTargetActivity::class.java.name)
    private fun openControl() = open(phone, "ai.tokenroll.toolbridge.mobile.ControlActivity")
    private fun open(pkg: String, activity: String) {
        targetContext.startActivity(Intent().setComponent(ComponentName(pkg, activity))
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT))
        awaitWindow(pkg)
    }

    private fun awaitWindow(pkg: String) {
        var last: android.graphics.Rect? = null
        var steadySince = 0L
        await("活动窗口 $pkg 完成入场") {
            val bounds = main {
                val service = checkNotNull(RemoteSession.service)
                val root = service.rootInActiveWindow ?: return@main null
                val windows = service.windows
                try {
                    if (root.packageName != pkg || !root.refresh()) return@main null
                    val active = windows.singleOrNull {
                        it.id == root.windowId && it.isActive && it.type == AccessibilityWindowInfo.TYPE_APPLICATION
                    } ?: return@main null
                    val frame = android.graphics.Rect().also(active::getBoundsInScreen)
                    val content = android.graphics.Rect().also(root::getBoundsInScreen)
                    content.takeIf { !it.isEmpty && frame.contains(it) }
                } finally {
                    windows.forEach { it.recycle() }
                    root.recycle()
                }
            }
            val now = SystemClock.elapsedRealtime()
            if (bounds == null || bounds != last) steadySince = now
            last = bounds
            bounds != null && now - steadySince >= 450L
        }
    }

    private fun call(tool: String, args: JSONObject = JSONObject(), caller: String = "notes-tester"): JSONObject {
        val now = System.currentTimeMillis()
        return RemoteSession.invoke(WireCall(UUID.randomUUID().toString(), "phone/control", tool, args,
            caller, "便签验收", now, now + 10_000, "realtime", WireSignal(), null))
    }

    private val JSONObject.label: String get() = getString("label")

    private fun observe(): List<JSONObject> {
        val result = call("observe")
        check(result.getString("package") == notes)
        val elements = result.getJSONArray("elements")
        return List(elements.length()) { elements.getJSONObject(it) }
    }

    private fun lastVisibleRow() = observe().mapNotNull {
        it.label.removePrefix("历史便签 ").toIntOrNull()
    }.maxOrNull() ?: error("没有可见的历史便签")

    private fun saveRef() = JSONObject().put("element",
        observe().first { it.label == "保存便签" && it.getBoolean("clickable") }.getString("element"))

    private fun act(tool: String, args: JSONObject = JSONObject(), select: (JSONObject) -> Boolean) {
        await("执行 $tool") {
            val node = observe().firstOrNull(select) ?: return@await false
            args.put("element", node.getString("element"))
            try {
                check(call(tool, args).getBoolean("accepted"))
                true
            } catch (e: WireFailure) {
                // The service invalidates observed references on window/content changes.
                if (e.localCode != "unavailable") throw e
                false
            }
        }
    }

    private fun expectFailure(code: String, action: () -> Unit) {
        try { action() } catch (e: WireFailure) {
            check(e.localCode == code) { "Expected $code, got ${e.localCode}" }
            return
        }
        error("Expected $code, operation succeeded")
    }

    private fun <T> main(read: () -> T): T {
        val task = FutureTask(Callable { read() })
        check(Handler(Looper.getMainLooper()).post(task))
        return task.get(5, TimeUnit.SECONDS)
    }

    private fun await(description: String, timeout: Long = 10_000, condition: () -> Boolean) {
        val end = SystemClock.elapsedRealtime() + timeout
        while (!condition()) {
            check(SystemClock.elapsedRealtime() < end) { "Timed out: $description" }
            SystemClock.sleep(100)
        }
    }
}

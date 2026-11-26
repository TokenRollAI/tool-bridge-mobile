package ai.tokenroll.toolbridge.mobile

import android.graphics.Rect
import android.os.Build
import android.os.Bundle
import android.os.SystemClock
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import android.view.accessibility.AccessibilityWindowInfo
import org.json.JSONObject

/** Main-thread owner of the semantic history. No Android node crosses a main-loop turn. */
internal class ScopedActions(private val service: PhoneControlService) {
    private val engine = SemanticEngine()
    private var settledWindow: SemanticScope? = null
    private var lastScope: SemanticScope? = null
    private var actionGeneration = 0L

    fun otherAction(scrolled: Boolean = false) {
        actionGeneration++
        // A second wire call can arrive before Android delivers the scroll event.
        if (scrolled) contentChanged(true)
    }

    fun reset() {
        engine.reset()
        settledWindow = null
        lastScope = null
        otherAction()
    }

    fun contentChanged(scrolled: Boolean) = engine.invalidate(scrolled)

    fun navigation(event: AccessibilityEvent) {
        val scope = lastScope ?: return
        settledWindow = null
        // Same-window navigation invalidates old targets, but can still provide post-action evidence.
        if (event.eventType == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED &&
            event.windowId == scope.windowId && event.packageName?.toString() == scope.app) engine.reset()
        else reset()
    }

    private fun denied(): Nothing {
        reset()
        throw WireFailure("permission_denied", "本次授权或活动窗口已变化")
    }

    private fun <T> window(wire: WireCall, expected: SemanticScope?, read: (SemanticScope, AccessibilityNodeInfo) -> T): T {
        wire.checkActive()
        if (RemoteSession.service !== service) denied()
        // Never claim a subsequent grant from a continuation of an old operation.
        val epoch = if (expected == null) {
            val initialObserve = wire.tool == "observe" && !wire.arguments.has("since") && !wire.arguments.has("region")
            RemoteSession.checkGrant(service, wire.callerSubjectId, allowUnbound = initialObserve)
        } else {
            if (!RemoteSession.holds(service, expected)) denied()
            expected.epoch
        }
        val root = service.rootInActiveWindow ?: denied()
        try {
            val pkg = root.packageName?.toString() ?: denied()
            if (pkg !in RemoteSession.packages || (expected != null &&
                    (expected.app != pkg || expected.windowId != root.windowId))) denied()
            val windows = service.windows
            val authorized = try {
                windows.any { it.id == root.windowId && it.isActive && it.type == AccessibilityWindowInfo.TYPE_APPLICATION }
            } finally { windows.forEach { it.recycle() } }
            if (!authorized) denied()
            // Only a successful active-window check may bind the first observer.
            if (expected == null) RemoteSession.requireGrant(service, wire.callerSubjectId)
            val scope = SemanticScope(epoch, wire.callerSubjectId, pkg, root.windowId)
            if (scope != lastScope) {
                reset()
                lastScope = scope
            }
            return read(scope, root)
        } finally { root.recycle() }
    }

    fun start(call: ScopedActionCall) {
        val wire = call.wire
        val args = wire.arguments
        if (wire.tool == "observe") {
            args.only("v", "region", "since")
            val region = if (args.has("region")) args.string("region") else null
            val since = if (args.has("since")) args.string("since") else null
            val deadline = SystemClock.elapsedRealtime() + 1200L
            var previousBounds: Rect? = null
            var steadySince = 0L
            fun read(expected: SemanticScope?) {
                window(wire, expected) { scope, root ->
                    val now = SystemClock.elapsedRealtime()
                    if (region == null && since == null && settledWindow != scope) {
                        // An Android window can already be active while its surface is sliding on-screen.
                        val bounds = Rect().also(root::getBoundsInScreen)
                        if (bounds != previousBounds) {
                            previousBounds = bounds
                            steadySince = now
                        }
                        if (bounds.isEmpty || now - steadySince < 250L) {
                            if (now >= deadline) throw WireFailure("unavailable", "窗口仍在切换，请重新观察")
                            call.post(85) { read(scope) }
                            return@window
                        }
                    }
                    val frame = engine.observe(scope, root, region, since)
                    if (region == null && since == null && frame.getJSONArray("items").length() == 0 && now < deadline) {
                        call.post(100) { read(scope) }
                    } else {
                        window(wire, scope) { _, _ ->
                            settledWindow = scope
                            call.finish(frame)
                        }
                    }
                }
            }
            read(null)
            return
        }
        val request = ScopedActionRequest.parse(wire)
        window(wire, null) { scope, root ->
            val before = if (request.expect == null) null else engine.readForAction(scope, root, request.snapshot)
            window(wire, scope) { _, live ->
                when (val resolved = engine.resolve(scope, live, request.snapshot, request.target)) {
                    is SemanticResolution.Rejected ->
                        window(wire, scope) { _, _ -> call.finish(scopedReceipt("not_sent", resolved.outcome)) }
                    is SemanticResolution.Found -> resolved.use { dispatch(call, request, scope, before, it) }
                }
            }
        }
    }

    private fun dispatch(call: ScopedActionCall, request: ScopedActionRequest, scope: SemanticScope,
                         before: JSONObject?, found: SemanticResolution.Found) {
        val node = found.node
        val original = node.identityFields()
        if (!node.refresh() || node.windowId != scope.windowId || node.packageName?.toString() != scope.app ||
            !node.isVisibleToUser || !node.isEnabled || node.isPassword ||
            (Build.VERSION.SDK_INT >= 34 && node.isAccessibilityDataSensitive) || node.identityFields() != original) {
            window(call.wire, scope) { _, _ -> call.finish(scopedReceipt("not_sent", "target_missing")) }
            return
        }
        if (node.actionList.none { it.id == request.action } || !request.supported(node, found)) {
            window(call.wire, scope) { _, _ -> call.finish(scopedReceipt("not_sent", "unsupported")) }
            return
        }
        val params = request.text?.let {
            Bundle().apply { putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, it) }
        }
        val accepted = window(call.wire, scope) { _, _ ->
            if (!call.dispatch.begin(call.wire::checkActive)) return@window null
            otherAction(scrolled = call.wire.tool == "scroll")
            node.performAction(request.action, params).also { call.dispatch.dispatched() }
        } ?: return
        if (!accepted) {
            window(call.wire, scope) { _, _ -> call.finish(scopedReceipt("sent", "not_verified", found.resolution)) }
            return
        }
        val wait = ScopedReadbackWindow(SystemClock.elapsedRealtime(), request.waitMs)
        val generation = actionGeneration
        val resolution = found.resolution
        // Returning to the Looper lets accessibility updates and local revocation run before readback.
        fun poll() {
            if (generation != actionGeneration) {
                call.finish(scopedReceipt("sent", "result_unknown"))
                return
            }
            window(call.wire, scope) { _, root ->
                if (wait.expired(SystemClock.elapsedRealtime())) {
                    call.finish(scopedReceipt("sent", "not_verified", resolution))
                    return@window
                }
                val after = engine.readForAction(scope, root, request.snapshot)
                val verified = before != null && request.expect?.verified(before, after) == true
                window(call.wire, scope) { _, _ ->
                    val now = SystemClock.elapsedRealtime()
                    val inTime = verified && !wait.expired(now)
                    val delay = wait.nextDelay(now)
                    if (inTime || request.expect == null || delay == null) {
                        val receipt = scopedReceipt("sent", if (inTime) "verified" else "not_verified", resolution)
                        if (inTime) receipt.put("evidence", request.expect?.evidence())
                        receipt.put("changes", after)
                        if (receipt.toString().toByteArray(Charsets.UTF_8).size > 65_536) receipt.remove("changes")
                        call.finish(receipt)
                    } else call.post(delay, ::poll)
                }
            }
        }
        call.post(block = ::poll)
    }
}

/** Zero wait requests one immediate sample, with no follow-up timer. */
internal class ScopedReadbackWindow(start: Long, private val waitMs: Long) {
    private val deadline = start + waitMs
    fun expired(now: Long) = waitMs > 0 && now > deadline
    fun nextDelay(now: Long): Long? =
        if (waitMs == 0L || now >= deadline) null else minOf(deadline - now, 125L)
}

// A provider can reuse the framework node handle between resolution and ACTION_CLICK.
private fun AccessibilityNodeInfo.identityFields() = listOf(
    className?.toString(), viewIdResourceName,
    (contentDescription?.takeIf { it.isNotBlank() } ?: text)?.take(141)?.toString(),
    if (Build.VERSION.SDK_INT >= 33) uniqueId else null,
)

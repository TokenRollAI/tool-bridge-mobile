@file:Suppress("DEPRECATION") // obtain/recycle are required on supported pre-33 devices.

package ai.tokenroll.toolbridge.mobile

import android.graphics.Rect
import android.os.Build
import android.os.SystemClock
import android.view.accessibility.AccessibilityNodeInfo
import android.view.accessibility.AccessibilityWindowInfo
import org.json.JSONObject
import java.io.Closeable

internal sealed class SemanticResolution {
    class Found(val node: AccessibilityNodeInfo, val resolution: String, val role: String, val name: String) :
        SemanticResolution(), Closeable {
        override fun close() = node.recycle()
    }
    class Rejected(val outcome: String) : SemanticResolution()
}

/** Called synchronously by the service on its main thread. Root ownership stays with the caller. */
internal class SemanticEngine {
    private val snapshots = SemanticSnapshots()

    fun reset() = snapshots.reset()
    fun invalidate(scrolled: Boolean = true) = snapshots.invalidate(scrolled)

    fun observe(scope: SemanticScope, root: AccessibilityNodeInfo, region: String? = null,
                since: String? = null): JSONObject {
        return observeFresh(scope, root, region, since, since)
    }

    fun readForAction(scope: SemanticScope, root: AccessibilityNodeInfo, snapshot: String): JSONObject =
        observeFresh(scope, root, null, null, snapshot)

    private fun observeFresh(scope: SemanticScope, root: AccessibilityNodeInfo, region: String?,
                             since: String?, domainToken: String?): JSONObject {
        snapshots.bind(scope)
        snapshots.checkDomain(domainToken)
        val bounds = allowedWindow(scope, root)
        val layout = sample(scope, root, bounds)
        if (allowedWindow(scope, root) != bounds) throw WireFailure("unavailable", "窗口边界已变化")
        return snapshots.publish(layout, region, since)
    }

    fun resolve(scope: SemanticScope, root: AccessibilityNodeInfo, snapshot: String,
                target: JSONObject): SemanticResolution {
        snapshots.bind(scope)
        snapshots.checkDomain(snapshot)
        val bounds = allowedWindow(scope, root)
        var path = snapshots.pathHint(snapshot, target)
        repeat(2) {
            var owned: AccessibilityNodeInfo? = null
            try {
                // Retain only the hinted handle. The same fresh traversal must prove both the
                // region and entity unique. A relocation gets one more traversal at its new path.
                if (allowedWindow(scope, root) != bounds) return SemanticResolution.Rejected("stale_snapshot")
                val current = sample(scope, root, bounds) { address, node ->
                    if (address == path) owned = AccessibilityNodeInfo.obtain(node)
                }
                val match = snapshots.match(snapshot, target, current)
                if (allowedWindow(scope, root) != bounds) return SemanticResolution.Rejected("stale_snapshot")
                when (match) {
                    is SemanticMatch.Miss -> return SemanticResolution.Rejected(match.outcome)
                    is SemanticMatch.Hit -> {
                        val verified = owned
                        if (verified != null && match.item.path == path) {
                            val result = SemanticResolution.Found(verified, match.resolution,
                                match.item.identity.role, match.item.identity.name)
                            owned = null
                            return result
                        }
                        path = match.item.path
                    }
                }
            } finally {
                owned?.recycle()
            }
        }
        return SemanticResolution.Rejected("stale_snapshot")
    }

    private fun allowedWindow(scope: SemanticScope, root: AccessibilityNodeInfo): Rect {
        val service = RemoteSession.service
        if (service == null || !RemoteSession.holds(service, scope) ||
            root.windowId != scope.windowId || root.packageName?.toString() != scope.app) denied()
        val window = root.window ?: denied()
        try {
            if (window.type != AccessibilityWindowInfo.TYPE_APPLICATION ||
                !window.isActive || window.id != scope.windowId) denied()
            val bounds = Rect().also(window::getBoundsInScreen)
            if (bounds.isEmpty) throw WireFailure("unavailable", "窗口没有可见边界")
            return bounds
        } finally {
            window.recycle()
        }
    }

    private fun denied(): Nothing {
        reset()
        throw WireFailure("permission_denied", "当前窗口不在本次授权范围内")
    }

    private fun sample(scope: SemanticScope, root: AccessibilityNodeInfo, window: Rect,
                       capture: (List<Int>, AccessibilityNodeInfo) -> Unit = { _, _ -> }): SemanticLayout {
        var lastWindowCheck = SystemClock.elapsedRealtime()
        val reader = object : SemanticTreeReader<AccessibilityNodeInfo>() {
            override fun refresh(node: AccessibilityNodeInfo): Boolean {
                val now = SystemClock.elapsedRealtime()
                if (RemoteSession.expiresAt?.let { now >= it } == true) denied()
                // Do not continue a long provider traversal after a lock or a window switch.
                if (now - lastWindowCheck >= 50L) {
                    if (allowedWindow(scope, root) != window) throw WireFailure("unavailable", "窗口边界已变化")
                    lastWindowCheck = now
                }
                return node.refresh()
            }
            override fun count(node: AccessibilityNodeInfo) = node.childCount
            override fun child(node: AccessibilityNodeInfo, index: Int): AccessibilityNodeInfo? = node.getChild(index)
            override fun release(node: AccessibilityNodeInfo) = node.recycle()
            override fun describe(node: AccessibilityNodeInfo, index: Int): SemanticNode? =
                describeNode(scope, window, node, index)
        }
        return reader.read(root, capture)
    }

    private fun describeNode(scope: SemanticScope, window: Rect, node: AccessibilityNodeInfo,
                             index: Int): SemanticNode? {
        if (!scope.permitsNode(node.windowId, node.packageName, node.isVisibleToUser, node.isPassword,
                Build.VERSION.SDK_INT >= 34 && node.isAccessibilityDataSensitive)) return null
        val box = Rect().also(node::getBoundsInScreen)
        if (!box.intersect(window)) return null
        fun axis(value: Int, start: Int, end: Int) =
            ((value.toLong() - start) * 1000 / (end.toLong() - start)).toInt().coerceIn(0, 1000)
        val bounds = SemanticBox(axis(box.left, window.left, window.right), axis(box.top, window.top, window.bottom),
            axis(box.right, window.left, window.right), axis(box.bottom, window.top, window.bottom))
        val supported = node.actionList.map { it.id }
        val actions = mutableListOf<String>()
        if (node.isEnabled) {
            if (AccessibilityNodeInfo.ACTION_CLICK in supported) actions += "tap"
            if (node.isEditable && AccessibilityNodeInfo.ACTION_SET_TEXT in supported) actions += "type"
            if (AccessibilityNodeInfo.ACTION_SCROLL_FORWARD in supported) actions += "scroll_forward"
            if (AccessibilityNodeInfo.ACTION_SCROLL_BACKWARD in supported) actions += "scroll_backward"
        }
        var shortened = false
        fun bounded(value: CharSequence?, limit: Int): String {
            if (value == null) return ""
            if (value.length > limit) shortened = true
            return value.subSequence(0, minOf(value.length, limit)).toString().trim()
        }
        val cls = bounded(node.className, 180)
        val id = bounded(node.viewIdResourceName, 200)
        val uid = if (Build.VERSION.SDK_INT >= 33) bounded(node.uniqueId, 200) else ""
        val desc = node.contentDescription
        val label = bounded(if (desc.isNullOrEmpty()) node.text else desc, 140)
        val scroll = node.isScrollable || node.collectionInfo != null ||
            supported.any { it == AccessibilityNodeInfo.ACTION_SCROLL_FORWARD || it == AccessibilityNodeInfo.ACTION_SCROLL_BACKWARD }
        return SemanticNode(index, cls, id, uid, label, bounds, actions, scroll,
            node.isEditable, Build.VERSION.SDK_INT >= 28 && node.isHeading, node.collectionItemInfo != null,
            emptyList(), shortened = shortened, selected = node.isSelected, enabled = node.isEnabled)
    }
}

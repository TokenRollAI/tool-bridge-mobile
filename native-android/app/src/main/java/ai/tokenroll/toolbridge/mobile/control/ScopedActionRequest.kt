package ai.tokenroll.toolbridge.mobile

import android.view.accessibility.AccessibilityNodeInfo
import org.json.JSONObject

internal class ScopedActionRequest private constructor(
    val snapshot: String,
    val target: JSONObject,
    val expect: ScopedExpectation?,
    val waitMs: Long,
    val action: Int,
    val text: String?,
    private val tool: String,
    private val operation: String?,
) {
    fun supported(node: AccessibilityNodeInfo, found: SemanticResolution.Found): Boolean = when (tool) {
        "type" -> node.isEditable
        "back", "media" -> scopedButton(tool, operation, found.role, found.name) &&
            // A name synthesized from children or stale after node.refresh() cannot authorize a click.
            listOf(node.contentDescription, node.text).any { it?.toString()?.trim() == found.name }
        else -> true
    }

    companion object {
        fun parse(wire: WireCall): ScopedActionRequest {
            val args = wire.arguments
            val fields = listOf("v", "snapshot", "target", "expect", "waitMs")
            val extra = when (wire.tool) {
                "tap", "back" -> emptyList()
                "type" -> listOf("text")
                "scroll" -> listOf("direction")
                "media" -> listOf("operation")
                else -> throw WireFailure("not_found", "未知远控操作")
            }
            args.only(*(fields + extra).toTypedArray())
            val snapshot = args.string("snapshot")
            val target = args.objectField("target")
            target.string("region")
            if (target.has("ref")) {
                target.only("ref", "region")
                target.string("ref")
            } else {
                target.only("role", "name", "region", "context")
                target.string("role")
                target.string("name")
                if (target.has("context") && target.opt("context") !is String) invalidWire()
            }
            val waitMs = if (args.has("waitMs")) {
                val value = args.opt("waitMs") as? Number ?: invalidWire()
                value.toLong().takeIf { it in 0..2000 && value.toDouble() == it.toDouble() } ?: invalidWire()
            } else 750L
            val action = when (wire.tool) {
                "type" -> AccessibilityNodeInfo.ACTION_SET_TEXT
                "scroll" -> when (args.string("direction")) {
                    "forward" -> AccessibilityNodeInfo.ACTION_SCROLL_FORWARD
                    "backward" -> AccessibilityNodeInfo.ACTION_SCROLL_BACKWARD
                    else -> invalidWire()
                }
                else -> AccessibilityNodeInfo.ACTION_CLICK
            }
            val text = if (wire.tool == "type") (args.opt("text") as? String)?.takeIf { it.length <= 2048 }
                ?: invalidWire() else null
            val operation = if (wire.tool == "media") args.string("operation").also {
                if (it !in setOf("play", "pause")) invalidWire()
            } else null
            return ScopedActionRequest(snapshot, target, ScopedExpectation.parse(args), waitMs,
                action, text, wire.tool, operation)
        }
    }
}

internal fun scopedButton(tool: String, operation: String?, role: String, name: String): Boolean {
    if (role != "button") return false
    val labels = when {
        tool == "back" -> setOf("back", "navigate up", "go back", "返回", "向上导航")
        tool == "media" && operation == "play" -> setOf("play", "play video", "play audio", "播放", "播放视频", "播放音频")
        tool == "media" && operation == "pause" -> setOf("pause", "pause video", "pause audio", "暂停", "暂停视频", "暂停音频")
        else -> return false
    }
    return name.lowercase() in labels
}

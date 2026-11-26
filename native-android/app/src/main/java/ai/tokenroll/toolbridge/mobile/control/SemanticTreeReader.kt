package ai.tokenroll.toolbridge.mobile

internal fun SemanticScope.permitsNode(id: Int, pkg: CharSequence?, visible: Boolean,
                                       password: Boolean, sensitive: Boolean): Boolean =
    windowId == id && app == pkg?.toString() && visible && !password && !sensitive

/** Returning null from describe prunes the whole subtree. Roots are borrowed, children are owned. */
internal abstract class SemanticTreeReader<N : Any> {
    abstract fun refresh(node: N): Boolean
    abstract fun describe(node: N, index: Int): SemanticNode?
    abstract fun count(node: N): Int
    abstract fun child(node: N, index: Int): N?
    abstract fun release(node: N)

    fun read(root: N, capture: (List<Int>, N) -> Unit): SemanticLayout {
        var remaining = 640
        fun visit(node: N, path: List<Int>): SemanticNode? {
            val data = describe(node, path.lastOrNull() ?: 0) ?: return null
            capture(path, node)
            val count = count(node)
            val children = mutableListOf<SemanticNode>()
            var index = 0
            var unread = false
            while (index < count && index < 256 && remaining > 0 && path.size < 32) {
                remaining-- // Missing and redacted slots also consume traversal budget.
                val next = child(node, index)
                if (next == null) unread = true
                else try {
                    if (!refresh(next)) unread = true
                    else visit(next, path + index)?.let(children::add)
                } finally {
                    release(next)
                }
                index++
            }
            return data.copy(children = children, incomplete = unread || index < count)
        }
        if (!refresh(root)) throw WireFailure("unavailable", "窗口无法重新读取")
        return SemanticLayout(visit(root, emptyList()))
    }
}

package ai.tokenroll.toolbridge.mobile

/** Window-relative edges in thousandths. Never used to locate an action target. */
internal data class SemanticBox(val left: Int, val top: Int, val right: Int, val bottom: Int) {
    val position: String get() = when {
        right <= 600 && left + right < 800 -> "left"
        left >= 400 && left + right > 1200 -> "right"
        bottom <= 400 -> "top"
        top >= 600 -> "bottom"
        else -> "center"
    }

    fun edges() = listOf(left, top, right, bottom)
}

/** Sanitized visible application tree. Indices are the original child indices before redaction. */
internal data class SemanticNode(
    val index: Int,
    val cls: String,
    val viewId: String,
    val uniqueId: String,
    val label: String,
    val bounds: SemanticBox,
    val actions: List<String>,
    val scroll: Boolean,
    val editable: Boolean,
    val heading: Boolean,
    val collectionItem: Boolean,
    val children: List<SemanticNode>,
    val incomplete: Boolean = false,
    val shortened: Boolean = false,
    val selected: Boolean = false,
    val enabled: Boolean = true
)

internal data class SemanticAnchor(val cls: String, val id: String, val unique: String, val label: String,
                                   val cardLabels: List<String> = emptyList())
internal data class SemanticRegionKey(val lineage: List<SemanticAnchor>)
internal data class SemanticIdentity(
    val role: String, val name: String, val context: String, val anchor: SemanticAnchor,
    val owners: List<SemanticAnchor>
)

internal data class SemanticItem(
    val path: List<Int>, val identity: SemanticIdentity, val bounds: SemanticBox,
    val actions: List<String>, val inList: Boolean, val hasEntityName: Boolean,
    val enabled: Boolean, val selected: Boolean
)

internal class SemanticRegion(
    val key: SemanticRegionKey, val label: String, val bounds: SemanticBox,
    val actions: List<String>, val depth: Int, val parent: SemanticRegion?
) {
    val items = mutableListOf<SemanticItem>()
    var incomplete = false
    var unreadBranches = false
    var keyShortened = false
}

internal class SemanticLayout(root: SemanticNode?) {
    val regions = mutableListOf<SemanticRegion>()
    // An unread branch could also contain a second region with the same identity.
    var incompleteTree = false
        private set

    private val groups by lazy { regions.groupBy { it.key } }

    fun matching(key: SemanticRegionKey) = groups[key].orEmpty()

    fun identifiable(region: SemanticRegion): Boolean {
        if (region.keyShortened || matching(region.key).size != 1) return false
        val parent = region.parent ?: return true
        return !parent.unreadBranches && identifiable(parent)
    }

    init {
        val window = SemanticRegion(SemanticRegionKey(emptyList()), "当前窗口",
            SemanticBox(0, 0, 1000, 1000), emptyList(), 0, null)
        regions.add(window)
        if (root == null) {
            incompleteTree = true
            window.unreadBranches = true
            window.incomplete = true
        } else visit(root, emptyList(), window, emptyList(), "", false)
    }

    private fun visit(node: SemanticNode, path: List<Int>, enclosing: SemanticRegion,
                      ancestors: List<SemanticAnchor>, ownerName: String, rowRoot: Boolean,
                      incompleteOwner: Boolean = false) {
        val anchor = SemanticAnchor(node.cls, node.viewId, node.uniqueId, node.label)
        val lineage = ancestors + anchor
        val region = if (node.scroll) {
            // A named top-level pane survives anonymous wrapper churn. Duplicate names
            // still collide and are never disambiguated by their screen position.
            val key = if (enclosing.depth == 0 && node.label.isNotEmpty()) listOf(anchor) else lineage
            SemanticRegion(SemanticRegionKey(key), node.label, node.bounds,
                node.actions.filter { it.startsWith("scroll_") }, enclosing.depth + 1, enclosing)
                .also { it.keyShortened = node.shortened || incompleteOwner; regions.add(it) }
        } else enclosing
        if (node.incomplete) {
            incompleteTree = true
            region.unreadBranches = true
        }
        if (node.incomplete || node.shortened || incompleteOwner) region.incomplete = true

        val actionable = node.actions.isNotEmpty()
        val ownsRowActions = region.depth > 0 && node.children.size <= 6 && node.children.any { it.actions.isNotEmpty() } &&
            node.children.any { it.label.isNotEmpty() && it.actions.isEmpty() }
        val isOwner = !node.scroll && (actionable || node.collectionItem || rowRoot || ownsRowActions)
        // Only non-interactive descendants contribute to a card's accessible title/author.
        val labels = if (isOwner) cardLabels(node) else listOf(node.label).filter(String::isNotEmpty)
        val title = labels.firstOrNull().orEmpty()
        val details = labels.drop(1).joinToString(" · ")
        val fullContext = listOf(ownerName, details).filter(String::isNotEmpty).distinct().joinToString(" · ")
        if (actionable || node.editable || node.scroll || node.heading || node.label.isNotEmpty()) {
            val name = title.ifEmpty { if (node.scroll) regionLabel(region) else "" }
            val role = when {
                node.editable -> "textbox"
                node.heading -> "heading"
                node.scroll -> "scroll"
                node.cls.endsWith("Button") -> "button"
                node.collectionItem || (actionable && node.children.isNotEmpty()) -> "item"
                actionable -> "button"
                else -> "text"
            }
            val identity = SemanticIdentity(role, name, fullContext.take(CONTEXT_LIMIT),
                anchor.copy(cardLabels = labels), ancestors)
            region.items += SemanticItem(path, identity, node.bounds, node.actions,
                region.depth > 0 && !node.scroll, title.isNotEmpty() || ownerName.isNotEmpty(),
                node.enabled, node.selected)
        }
        val nextOwner = when {
            node.scroll -> ""
            isOwner && labels.isNotEmpty() -> listOf(ownerName, labels.joinToString(" · "))
                .filter(String::isNotEmpty).distinct().joinToString(" · ")
            else -> ownerName
        }
        // Keep identity strings and the wire representation bounded without trusting a shared prefix.
        if (fullContext.length > CONTEXT_LIMIT || nextOwner.length > CONTEXT_LIMIT) region.incomplete = true
        val childLineage = if (isOwner) ancestors + anchor.copy(cardLabels = labels) else lineage
        for (child in node.children) visit(child, path + child.index, region, childLineage,
            nextOwner.take(CONTEXT_LIMIT), node.scroll && node.children.size > 1,
            incompleteOwner || node.shortened || nextOwner.length > CONTEXT_LIMIT)
    }

    private fun cardLabels(root: SemanticNode): List<String> {
        val parts = linkedSetOf<String>()
        fun collect(node: SemanticNode) {
            if (node.label.isNotEmpty()) parts.add(node.label)
            for (child in node.children) {
                if (!child.scroll && child.actions.isEmpty() && !child.editable) collect(child)
            }
        }
        collect(root)
        return parts.toList()
    }

    companion object {
        const val CONTEXT_LIMIT = 192
        fun regionLabel(region: SemanticRegion): String = region.label.ifEmpty {
            when (region.bounds.position) {
                "left" -> "左侧可滚动区域"
                "right" -> "右侧可滚动区域"
                "top" -> "上方可滚动区域"
                "bottom" -> "下方可滚动区域"
                else -> "可滚动区域"
            }
        }
    }
}

package ai.tokenroll.toolbridge.mobile

import org.json.JSONArray
import org.json.JSONObject

internal data class SemanticScope(val epoch: String, val caller: String, val app: String, val windowId: Int)

internal sealed class SemanticMatch {
    data class Hit(val item: SemanticItem, val resolution: String) : SemanticMatch()
    data class Miss(val outcome: String) : SemanticMatch()
}

/** Main-thread, bounded history. Keeps values only, never Android nodes or user input arguments. */
internal class SemanticSnapshots {
    private data class Region(val key: SemanticRegionKey, val unique: Boolean, val wire: JSONObject)
    private data class Item(val region: String, val row: SemanticItem, val wire: JSONObject)
    private data class Frame(
        val id: String, val focus: String?, val scrollGeneration: Long, val regions: Map<String, Region>,
        val items: Map<String, Item>, val incomplete: Set<String>, val truncated: Boolean
    )
    private val history = LinkedHashMap<String, Frame>()
    private var scope: SemanticScope? = null
    private var domain = ""
    private var serial = java.security.SecureRandom().nextInt(Int.MAX_VALUE).toLong()
    private var scrollGeneration = 0L

    fun reset() {
        history.clear()
        scope = null
        domain = ""
        scrollGeneration = 0
    }

    fun bind(value: SemanticScope) {
        if (scope == value) return
        reset()
        require(value.epoch.isNotEmpty() && value.caller.isNotBlank() && value.app.isNotBlank())
        scope = value
        domain = NativeJson.digest(JSONArray(listOf(value.epoch, value.caller, value.app, value.windowId))
            .toString()).take(16)
    }

    fun invalidate(scrolled: Boolean) {
        if (scrolled) scrollGeneration++
    }

    private fun next(prefix: String) = prefix + (++serial).toString(36)
    fun checkDomain(id: String?) {
        if (id == null) return
        if (id.startsWith("s") && id.contains('.') && id.substringBefore('.') != "s$domain")
            throw WireFailure("permission_denied", "快照不属于当前授权窗口")
    }

    private fun baseline(id: String?): Frame? {
        checkDomain(id)
        return history[id]
    }

    fun publish(layout: SemanticLayout, focus: String?, since: String?): JSONObject {
        val active = checkNotNull(scope)
        val base = baseline(since)
        val recent = history.values.toList().asReversed()
        val prior = listOfNotNull(base) + recent
        val focusRegion = focus?.let { ref ->
            val old = (if (base != null) listOf(base) else recent).firstNotNullOfOrNull { it.regions[ref] }
            val current = old?.let { layout.matching(it.key).singleOrNull() }
            if (old == null) throw WireFailure("unavailable", "区域引用已失效，请重新读取窗口")
            if (!old.unique || current == null) throw WireFailure("unavailable", "无法唯一识别区域，请重新读取窗口")
            if (!layout.identifiable(current)) throw WireFailure("unavailable", "窗口尚未完整读取，请稍后重新观察")
            current
        }
        val visible = if (focusRegion == null) layout.regions.take(MAX_REGIONS) else listOf(focusRegion)
        val regions = linkedMapOf<String, Region>()
        val items = linkedMapOf<String, Item>()
        val incomplete = mutableSetOf<String>()
        val regionRefs = mutableMapOf<SemanticRegion, String>()
        var remaining = WIRE_BUDGET
        val limit = if (focus == null) 96 else 192

        for (region in visible) {
            val unique = layout.identifiable(region)
            val known = if (unique) prior.firstNotNullOfOrNull { frame ->
                frame.regions.entries.firstOrNull { it.value.unique && it.value.key == region.key }?.key
            } else null
            val ref = if (region === focusRegion) checkNotNull(focus) else known ?: next("r")
            regionRefs[region] = ref
            val wire = JSONObject().put("ref", ref).put("position", region.bounds.position)
                .put("label", SemanticLayout.regionLabel(region)).put("bounds", JSONArray(region.bounds.edges()))
                .put("actions", JSONArray(region.actions)).put("depth", region.depth)
            region.parent?.let { parent ->
                val parentRef = regionRefs[parent] ?: prior.firstNotNullOfOrNull { frame ->
                    frame.regions.entries.firstOrNull { it.value.unique && it.value.key == parent.key }?.key
                }
                if (parentRef != null) wire.put("parent", parentRef)
            }
            regions[ref] = Region(region.key, unique, wire)
            remaining -= wire.toString().toByteArray().size + 32
            if (region.incomplete || (layout.incompleteTree && !unique)) incomplete += ref
        }
        for (region in visible) {
            val ref = regionRefs.getValue(region)
            val identities = region.items.groupingBy { it.identity }.eachCount()
            val previous = prior.firstOrNull { it.regions.containsKey(ref) }?.items.orEmpty()
                .entries.filter { it.value.region == ref }.groupBy { it.value.row.identity }
            for (row in region.items) {
                if (items.size >= limit) {
                    incomplete += ref
                    break
                }
                val old = if (identities[row.identity] == 1) previous[row.identity]?.singleOrNull() else null
                val itemRef = old?.key ?: next("e")
                val wire = JSONObject().put("ref", itemRef).put("region", ref).put("role", row.identity.role)
                    .put("name", row.identity.name).put("context", row.identity.context.take(SemanticLayout.CONTEXT_LIMIT))
                    .put("bounds", JSONArray(row.bounds.edges())).put("actions", JSONArray(row.actions))
                    .put("enabled", row.enabled).put("selected", row.selected)
                val bytes = wire.toString().toByteArray().size + 1
                if (bytes > remaining) {
                    incomplete += ref
                    break
                }
                remaining -= bytes
                items[itemRef] = Item(ref, row, wire)
            }
        }
        for ((ref, region) in regions) region.wire.put("truncated", ref in incomplete)
        val frame = Frame("s$domain." + next(""), focus, scrollGeneration, regions, items, incomplete,
            incomplete.isNotEmpty() || (focus == null && layout.regions.size > MAX_REGIONS))
        val delta = base?.takeIf { it.focus == focus && !it.truncated && !frame.truncated }
        val result = JSONObject().put("v", 2).put("kind", if (delta == null) "full" else "delta")
            .put("snapshot", frame.id).put("window", JSONObject()
                .put("ref", semanticWindowRef(active.epoch, active.app, active.windowId))
                .put("app", active.app).put("boundsSpace", "window_normalized_1000"))
            .put("truncated", frame.truncated)
        fun changed(rows: Map<String, JSONObject>, previous: Map<String, JSONObject>): JSONArray {
            val array = JSONArray()
            for ((ref, json) in rows) if (json.toString() != previous[ref]?.toString())
                array.put(JSONObject(json.toString()))
            return array
        }
        result.put("regions", changed(regions.mapValues { it.value.wire }, delta?.regions.orEmpty().mapValues { it.value.wire }))
        result.put("items", changed(items.mapValues { it.value.wire }, delta?.items.orEmpty().mapValues { it.value.wire }))
        if (delta != null) result.put("base", delta.id)
            .put("removedRegions", JSONArray(delta.regions.keys - regions.keys))
            .put("removedItems", JSONArray(delta.items.keys - items.keys))
        history[frame.id] = frame
        if (history.size > HISTORY) history.remove(history.keys.first())
        return result
    }

    /** A hint selects a handle to retain. Only match() can authorize handing that handle out. */
    fun pathHint(snapshot: String, target: JSONObject): List<Int>? {
        val frame = baseline(snapshot) ?: return null
        val region = target.opt("region") as? String ?: return null
        val ref = target.opt("ref") as? String
        if (ref != null) return frame.items[ref]?.takeIf { it.region == region }?.row?.path
        return frame.items.values.firstOrNull { it.region == region && selects(target, it.row) }?.row?.path
    }

    private fun selects(target: JSONObject, row: SemanticItem) = row.identity.role == target.opt("role") &&
        row.identity.name == target.opt("name") &&
        (!target.has("context") || row.identity.context == target.opt("context"))

    fun match(snapshot: String, target: JSONObject, current: SemanticLayout): SemanticMatch {
        val base = baseline(snapshot) ?: return miss("stale_snapshot")
        val regionRef = target.opt("region") as? String ?: return miss("stale_snapshot")
        val region = base.regions[regionRef] ?: return miss("stale_snapshot")
        if (regionRef in base.incomplete) return miss("stale_snapshot")
        if (!region.unique) return miss("ambiguous_target")
        val now = current.matching(region.key)
        if (now.isEmpty()) return miss(if (current.incompleteTree) "stale_snapshot" else "target_missing")
        val currentRegion = now.singleOrNull() ?: return miss("ambiguous_target")
        if (currentRegion.incomplete || !current.identifiable(currentRegion)) return miss("stale_snapshot")
        val priorRows = base.items.values.filter { it.region == regionRef }.map { it.row }
        val ref = target.opt("ref") as? String
        val prior = if (ref != null) {
            if (target.keys().asSequence().toSet() != setOf("ref", "region")) return miss("stale_snapshot")
            val old = base.items[ref]?.takeIf { it.region == regionRef } ?: return miss("stale_snapshot")
            priorRows.filter { it.identity == old.row.identity }
        } else {
            if (target.keys().asSequence().any { it !in setOf("region", "role", "name", "context") } ||
                (target.opt("name") as? String).isNullOrEmpty()) return miss("stale_snapshot")
            priorRows.filter { selects(target, it) }
        }
        if (prior.isEmpty()) return miss("target_missing")
        val original = prior.singleOrNull() ?: return miss("ambiguous_target")
        if ((original.inList || currentRegion.depth > 1) && base.scrollGeneration != scrollGeneration)
            return miss("stale_snapshot")
        // Framework and app-supplied IDs may both identify a recycled view holder.
        // Identical entity descriptions in a list do not become unique through those IDs.
        if (original.inList) {
            fun twin(row: SemanticItem) = row.identity.role == original.identity.role &&
                row.identity.name == original.identity.name && row.identity.context == original.identity.context
            if (priorRows.count(::twin) > 1 || currentRegion.items.count(::twin) > 1)
                return miss("ambiguous_target")
        }
        val candidates = currentRegion.items.filter {
            if (ref == null) selects(target, it) else it.identity == original.identity
        }
        if (candidates.isEmpty()) return miss("target_missing")
        val hit = candidates.singleOrNull() ?: return miss("ambiguous_target")
        if (hit.identity != original.identity) return miss("stale_snapshot")
        if (hit.inList && !sameViewport(priorRows, currentRegion.items, hit.identity.context.isEmpty())) return miss("stale_snapshot")
        // A reusable row layout ID or a path cannot identify the entity behind an unnamed action.
        if (hit.inList && !hit.hasEntityName) return miss("stale_snapshot")
        if (!hit.inList && hit.identity.name.isEmpty() && hit.identity.anchor.id.isEmpty() &&
            hit.identity.anchor.unique.isEmpty()) return miss("stale_snapshot")
        val resolution = when {
            ref == null -> "selector"
            hit.path == original.path -> "direct"
            else -> "relocated_unique"
        }
        return SemanticMatch.Hit(hit, resolution)
    }

    // A scroll or rebind can precede delivery of its event. Verify visible action identities
    // and occupied slots as unordered sets with multiplicity. A pure reorder preserves both.
    private fun sameViewport(before: List<SemanticItem>, after: List<SemanticItem>, needsContext: Boolean): Boolean {
        // A generic child action in an ungrouped provider tree has no row context of its own.
        // Include visible text there too, in case a holder acquired a different passive title.
        fun witnesses(rows: List<SemanticItem>) = rows.filter { it.inList && (needsContext || it.actions.isNotEmpty()) }
        val old = witnesses(before)
        val current = witnesses(after)
        return old.groupingBy { it.identity }.eachCount() == current.groupingBy { it.identity }.eachCount() &&
            old.groupingBy { it.bounds }.eachCount() == current.groupingBy { it.bounds }.eachCount()
    }

    private fun miss(outcome: String) = SemanticMatch.Miss(outcome)

    private companion object {
        const val HISTORY = 8
        const val MAX_REGIONS = 24
        const val WIRE_BUDGET = 52 * 1024
    }
}

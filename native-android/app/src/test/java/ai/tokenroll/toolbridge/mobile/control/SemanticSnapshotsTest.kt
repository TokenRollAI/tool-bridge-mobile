package ai.tokenroll.toolbridge.mobile

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class SemanticSnapshotsTest {
    private val scope = SemanticScope("local-grant", "caller", "test.app", 17)
    private val book = SemanticSnapshots().apply { bind(scope) }
    private val box = SemanticBox(0, 0, 1000, 1000)
    private fun node(label: String = "", vararg child: SemanticNode, index: Int = 0) =
        SemanticNode(index, "View", "", "", label, box, emptyList(), false, false, false, false,
            child.mapIndexed { i, n -> n.copy(index = i) })
    private fun button(label: String) = node(label).copy(cls = "Button", actions = listOf("tap"), viewId = "button")
    private fun list(label: String, vararg rows: SemanticNode) = node(label, *rows)
        .copy(scroll = true, actions = listOf("scroll_forward"))
    private fun layout(vararg children: SemanticNode) = SemanticLayout(node("", *children))
    private fun JSONObject.rows(key: String) = getJSONArray(key).let { a -> List(a.length()) { a.getJSONObject(it) } }
    private fun JSONObject.target(name: String): JSONObject {
        val row = rows("items").first { it.getString("name") == name }
        return JSONObject().put("region", row.getString("region")).put("ref", row.getString("ref"))
    }
    private fun publish(tree: SemanticLayout, focus: String? = null, since: JSONObject? = null) =
        book.publish(tree, focus, since?.getString("snapshot"))
    private fun match(frame: JSONObject, target: JSONObject, now: SemanticLayout) =
        book.match(frame.getString("snapshot"), target, now)
    private fun outcome(frame: JSONObject, target: JSONObject, tree: SemanticLayout) =
        (match(frame, target, tree) as SemanticMatch.Miss).outcome

    @Test fun nestedRegionsAndCardsUseVisibleSemanticsAndDeclaredDirections() {
        val card = node("", node("磁悬浮"), node("作者甲"), button("更多")).copy(actions = listOf("tap"))
        val tree = layout(list("栏目", list("推荐", card).copy(bounds = SemanticBox(670, 0, 1000, 900))))
        val full = publish(tree)
        val right = full.rows("regions").single { it.getString("label") == "推荐" }
        assertEquals(2, right.getInt("depth"))
        assertEquals("right", right.getString("position"))
        assertEquals(full.target("栏目").getString("region"), right.getString("parent"))
        assertEquals(listOf("scroll_forward"), right.getJSONArray("actions").let { List(it.length(), it::getString) })
        val item = full.rows("items").single { it.getString("role") == "item" }
        assertEquals("磁悬浮", item.getString("name"))
        assertEquals("作者甲", item.getString("context"))
        assertEquals("磁悬浮 · 作者甲", full.rows("items").single { it.getString("name") == "更多" }.getString("context"))
        assertEquals(right.getString("ref"), item.getString("region"))
    }

    @Test fun reorderedUniqueCardRelocatesWhileSameHandleWithDifferentContentDoesNot() {
        val a = button("城市散步")
        val b = button("海边日记")
        val before = publish(layout(list("推荐", a, b)))
        val target = before.target("城市散步")
        book.invalidate(false)
        val reordered = layout(list("推荐", b, a))
        assertEquals("relocated_unique", (match(before, target, reordered) as SemanticMatch.Hit).resolution)
        assertEquals("target_missing", outcome(before, target, layout(list("推荐", b, b))))
        val twins = layout(list("推荐", a, a))
        assertEquals("ambiguous_target", outcome(before, target, twins))
        val duplicate = publish(twins)
        assertEquals("ambiguous_target", outcome(duplicate, duplicate.target("城市散步"), reordered))
        book.invalidate(true)
        assertEquals("stale_snapshot", outcome(before, target, reordered))
        val renewed = publish(reordered)
        assertEquals("direct", (match(renewed, renewed.target("城市散步"), reordered) as SemanticMatch.Hit).resolution)
    }

    @Test fun selectorRevalidatesOriginalEntityAndBothRegions() {
        fun card(author: String) = node("", node("同一标题"), node(author)).copy(actions = listOf("tap"))
        fun feed(author: String) = layout(list("左栏", card("甲")), list("右栏", card(author)))
        val initial = publish(feed("乙"))
        val card = initial.rows("items").single { it.getString("role") == "item" && it.getString("context") == "乙" }
        val selector = JSONObject().put("region", card.getString("region")).put("role", "item").put("name", "同一标题")
        assertEquals("selector", (match(initial, selector, feed("乙")) as SemanticMatch.Hit).resolution)
        assertEquals("stale_snapshot", outcome(initial, selector, feed("丙")))
        selector.put("context", "乙")
        assertEquals("target_missing", outcome(initial, selector, feed("丙")))
        val wrongRegion = JSONObject().put("ref", card.getString("ref")).put("region", initial.target("左栏").getString("region"))
        assertEquals("stale_snapshot", outcome(initial, wrongRegion, feed("乙")))
    }

    @Test fun sameLayoutIdAndGenericActionInsideRecycledRowCannotBindReplacement() {
        fun page(title: String) = layout(list("推荐", node("", node(title), button("更多")).copy(collectionItem = true)))
        val before = publish(page("旧文章"))
        assertEquals("target_missing", outcome(before, before.target("更多"), page("新文章")))
    }

    @Test fun duplicateAnonymousScrollContainersCannotBeDistinguishedByCoordinates() {
        val left = list("", button("A")).copy(bounds = SemanticBox(0, 0, 400, 1000))
        val right = list("", button("B")).copy(bounds = SemanticBox(600, 0, 1000, 1000))
        val tree = layout(left, right)
        val before = publish(tree)
        val target = before.target("B")
        assertEquals("ambiguous_target", outcome(before, target, layout(right, left)))
        assertThrows(WireFailure::class.java) { publish(tree, target.getString("region")) }
    }

    @Test fun scopedExpansionDoesNotUsePartialRegionAsProof() {
        val tree = layout(list("右栏", *Array(115) { button("项目$it") }), list("左栏", button("左侧")))
        val full = publish(tree)
        assertTrue(full.getBoolean("truncated"))
        val target = full.target("项目0")
        assertEquals("stale_snapshot", outcome(full, target, tree))
        val region = target.getString("region")
        val expanded = publish(tree, region, full)
        assertFalse(expanded.getBoolean("truncated"))
        assertEquals("full", expanded.getString("kind"))
        assertTrue(expanded.rows("items").all { it.getString("region") == region })
        assertTrue(match(expanded, expanded.target("项目113"), tree) is SemanticMatch.Hit)
        val delta = publish(tree, region, expanded)
        assertEquals("delta", delta.getString("kind"))
        assertEquals(0, delta.rows("items").size)
        assertEquals("full", publish(tree, since = expanded).getString("kind"))
    }

    @Test fun incompleteCurrentTraversalCannotReportAbsenceOrDeletion() {
        val tree = layout(list("区域", button("已读")))
        val full = publish(tree)
        val partial = layout(list("区域").copy(incomplete = true))
        val target = full.target("已读")
        assertEquals("stale_snapshot", outcome(full, target, partial))
        val diff = publish(partial, since = full)
        assertTrue(diff.getBoolean("truncated"))
        assertEquals("full", diff.getString("kind"))
        assertFalse(diff.has("removedItems"))
        assertEquals("full", publish(tree, since = diff).getString("kind"))
    }

    @Test fun differencesUseNamedBaseEvenAfterIntermediateFrames() {
        fun feed(vararg labels: String) = layout(list("Feed", *labels.map(::button).toTypedArray()))
        val base = publish(feed("first", "keep"))
        val keep = base.target("keep")
        publish(feed("intermediate"))
        val delta = publish(feed("keep", "new"), since = base)
        assertEquals(base.getString("snapshot"), delta.getString("base"))
        assertEquals(listOf("new"), delta.rows("items").map { it.getString("name") })
        assertEquals(base.target("first").getString("ref"), delta.getJSONArray("removedItems").getString(0))
        // A delta token identifies the reconstructed frame, including an omitted unchanged row.
        assertTrue(match(delta, keep, feed("keep", "new")) is SemanticMatch.Hit)
        repeat(8) { publish(feed("keep")) }
        assertEquals("full", publish(feed("keep"), since = base).getString("kind"))
        assertEquals("stale_snapshot", outcome(base, keep, feed("keep")))
    }

    @Test fun scopeChangesInvalidateTokensAndResetForgetsAllRows() {
        val tree = layout(button("确认"))
        val base = publish(tree)
        val target = base.target("确认")
        for (other in listOf(scope.copy(epoch = "new"), scope.copy(caller = "other"),
                scope.copy(windowId = 90), scope.copy(app = "other.app"))) {
            book.bind(other)
            assertEquals("permission_denied", assertThrows(WireFailure::class.java) {
                match(base, target, tree)
            }.localCode)
        }
        book.reset()
        book.bind(scope)
        assertEquals("stale_snapshot", outcome(base, target, tree))
        assertThrows(WireFailure::class.java) { publish(tree, target.getString("region")) }
    }

    @Test fun incompleteSiblingListDoesNotHideDuplicatesInAnotherTopLevelPane() {
        val left = list("更新", button("新闻")).copy(incomplete = true)
        val right = list("推荐", button("收藏"))
        val tree = layout(left, right)
        val before = publish(tree)
        val target = before.target("收藏")
        assertTrue(before.getBoolean("truncated"))
        assertTrue(match(before, target, tree) is SemanticMatch.Hit)
        assertFalse(publish(tree, target.getString("region")).getBoolean("truncated"))
        val missingParentBranch = SemanticLayout(node("", left, right).copy(incomplete = true))
        assertEquals("stale_snapshot", outcome(before, target, missingParentBranch))
    }

    @Test fun reusableFrameworkIdsDoNotDisambiguateIdenticalListEntities() {
        val a = button("更多").copy(uniqueId = "holder-1")
        val b = a.copy(uniqueId = "holder-2")
        val tree = layout(list("动态", a))
        val frame = publish(tree)
        assertEquals("ambiguous_target", outcome(frame, frame.target("更多"), layout(list("动态", a, b))))
        book.invalidate(true)
        assertEquals("stale_snapshot", outcome(frame, frame.target("更多"), tree))
    }

    @Test fun viewportChangesBeforeScrollEventInvalidateAnOtherwiseIdenticalHolder() {
        val save = button("收藏")
        val before = publish(layout(list("动态", save, button("原条目"))))
        val target = before.target("收藏")
        assertEquals("stale_snapshot", outcome(before, target, layout(list("动态", save, button("新条目")))))
        val moved = save.copy(bounds = SemanticBox(0, 100, 1000, 300))
        assertEquals("stale_snapshot", outcome(before, target, layout(list("动态", moved, button("原条目")))))
    }

    @Test fun passiveTitleChangeAroundAnUngroupedActionRequiresAnotherObservation() {
        fun tree(title: String) = layout(list("列表", node("", node(title), button("更多"),
            node("栏目"), node("摘要"), node("时间"), node("来源"), node("作者"))))
        val frame = publish(tree("文章一"))
        assertEquals("stale_snapshot", outcome(frame, frame.target("更多"), tree("文章二")))
    }

    @Test fun unreadRootFallsBackToIncompleteFullWithoutReportingDeletedRows() {
        val before = publish(layout(button("返回")))
        val empty = SemanticLayout(null)
        val next = publish(empty, since = before)
        assertEquals("full", next.getString("kind"))
        assertTrue(next.getBoolean("truncated"))
        assertFalse(next.has("removedItems"))
        assertEquals("stale_snapshot", outcome(before, before.target("返回"), empty))
    }

    @Test fun escapedMultibyteRowsRemainBoundedWithExplicitTruncation() {
        val root = list("目录", *Array(190) { button("文\u0001".repeat(64) + it) })
        val frame = publish(layout(root))
        val focus = frame.rows("regions").single { it.getString("label") == "目录" }.getString("ref")
        val expanded = publish(layout(root), focus)
        assertTrue(expanded.getBoolean("truncated"))
        assertTrue(expanded.toString().toByteArray().size <= 65536)
        assertTrue(expanded.rows("items").all { it.getString("ref").length < 16 })
    }
}

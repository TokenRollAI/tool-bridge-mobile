package ai.tokenroll.toolbridge.mobile

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class ScopedActionTest {
    private fun frame(vararg rows: JSONObject): JSONObject = JSONObject().put("kind", "full")
        .put("window", JSONObject().put("ref", "w")).put("truncated", false)
        .put("regions", JSONArray(listOf("left", "right").map {
            JSONObject().put("ref", it).put("label", it).put("position", it)
                .put("bounds", JSONArray()).put("actions", JSONArray())
        })).put("items", JSONArray(rows.toList()))

    private fun row(name: String, role: String = "button", region: String = "right") = JSONObject()
        .put("ref", "ref").put("region", region).put("role", role).put("name", name)
        .put("context", "").put("bounds", JSONArray()).put("actions", JSONArray())

    @Test fun visibleNeedsANewUnambiguousObservation() {
        val expect = ScopedExpectation.Visible("button", "暂停")
        val play = frame(row("播放"))
        val pause = frame(row("暂停"))
        assertTrue(expect.verified(play, pause))
        assertFalse(expect.verified(pause, pause))
        assertFalse(expect.verified(play, frame(row("暂停"), row("暂停"))))
        assertFalse(expect.verified(play, frame(row("暂停")).put("kind", "delta")))
        assertFalse(expect.verified(play.put("truncated", true), pause))
    }

    @Test fun transitionNeedsOldStateToDisappearAndNewStateInSameRegion() {
        val expect = ScopedExpectation.Transition("text", "button", "详情")
        val before = frame(row("详情", "text"))
        val after = frame(row("详情"))
        assertTrue(expect.verified(before, after))
        assertFalse(expect.verified(before, frame(row("详情"), row("详情", "text"))))
        assertFalse(expect.verified(before, frame(row("详情", region = "left"))))
        assertFalse(expect.verified(before, after.put("window", JSONObject().put("ref", "w2"))))
    }

    @Test fun regionIgnoresShortRefsAndUnrelatedTicker() {
        val expect = ScopedExpectation.RegionChanged("right")
        val before = frame(row("收藏"), row("100", "text", "left"))
        assertFalse(expect.verified(before, frame(row("收藏").put("ref", "different"), row("101", "text", "left"))))
        assertTrue(expect.verified(before, frame(row("已收藏"), row("101", "text", "left"))))
        assertTrue(expect.verified(before, frame(row("收藏").put("selected", true))))
        assertFalse(ScopedExpectation.RegionChanged("missing").verified(before, frame()))
    }

    private fun parse(tool: String, edit: (JSONObject) -> Unit = {}): ScopedActionRequest {
        val args = JSONObject().put("v", 2).put("snapshot", "s")
            .put("target", JSONObject().put("ref", "e").put("region", "r")).also(edit)
        return ScopedActionRequest.parse(WireCall("id", "phone/control", tool, args, "caller", "",
            0, Long.MAX_VALUE, "realtime", WireSignal(), null))
    }

    @Test fun parseOnlyAllowsTheArgumentsOfTheSelectedAction() {
        assertEquals("", parse("type") { it.put("text", "") }.text)
        assertEquals(0L, parse("tap") { it.put("waitMs", 0) }.waitMs)
        assertEquals(2000L, parse("tap") { it.put("waitMs", 2000) }.waitMs)
        assertThrows(WireFailure::class.java) { parse("tap") { it.put("waitMs", 1.5) } }
        assertThrows(WireFailure::class.java) { parse("tap") { it.put("waitMs", 2001) } }
        assertThrows(WireFailure::class.java) { parse("tap") { it.put("text", "hidden") } }
        assertThrows(WireFailure::class.java) { parse("tap") { it.put("x", 0) } }
        assertThrows(WireFailure::class.java) { parse("back") { it.remove("target") } }
        assertThrows(WireFailure::class.java) { parse("tap") { it.getJSONObject("target").put("role", "button") } }
        assertThrows(WireFailure::class.java) { parse("media") { it.put("operation", "toggle") } }
        assertThrows(WireFailure::class.java) { parse("scroll") { it.put("direction", "down") } }
    }

    @Test fun aNavigationOrPlayerActionRequiresItsSpecificButton() {
        assertTrue(scopedButton("back", null, "button", "Navigate up"))
        assertTrue(scopedButton("media", "play", "button", "播放"))
        assertTrue(scopedButton("media", "pause", "button", "Pause"))
        assertFalse(scopedButton("back", null, "text", "返回"))
        assertFalse(scopedButton("media", "pause", "button", "播放"))
        assertFalse(scopedButton("media", "play", "button", "播放列表"))
    }

    @Test fun readbackCannotVerifyAfterTheDeadlineOrScheduleBeyondIt() {
        val wait = ScopedReadbackWindow(1000, 500)
        assertEquals(125L, wait.nextDelay(1000))
        assertEquals(1L, wait.nextDelay(1499))
        assertNull(wait.nextDelay(1500))
        assertTrue(wait.expired(1501))
        val once = ScopedReadbackWindow(1000, 0)
        assertNull(once.nextDelay(1000))
    }

    @Test fun cancellationBeforeDispatchLeavesTheBoundaryClosed() {
        val result = ScopedDispatchResult()
        result.stop(IllegalStateException())
        assertFalse(result.begin { fail("cancelled request reached dispatch") })
        assertTrue(result.result.isCompletedExceptionally)
    }

    @Test fun uncertainOrSentActionIsNeverRepeatedAndReturnsNoWindowData() {
        for (returned in listOf(false, true)) {
            val result = ScopedDispatchResult()
            assertTrue(result.begin {})
            if (returned) result.dispatched()
            assertFalse(result.begin { fail("duplicate action reached dispatch") })
            result.stop(IllegalStateException())
            val receipt = result.result.get()
            assertEquals(if (returned) "sent" else "unknown", receipt.getString("dispatch"))
            assertEquals("result_unknown", receipt.getString("outcome"))
            assertEquals(setOf("v", "dispatch", "outcome"), receipt.keys().asSequence().toSet())
        }
    }
}

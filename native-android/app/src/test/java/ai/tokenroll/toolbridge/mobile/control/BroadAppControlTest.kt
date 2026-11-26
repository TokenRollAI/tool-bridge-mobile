package ai.tokenroll.toolbridge.mobile

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class BroadAppControlTest {
    private fun page(args: JSONObject = obj("v" to 2)) =
        BroadAppRequest.parse("apps", args) as BroadAppRequest.Page

    @Test fun pagesStayBoundedAndResumeAfterTheLastPackageEvenIfItDisappears() {
        val labels = (100..150).reversed().associate { "example.app$it" to "😀".repeat(70) }
        val first = page().result("grant", labels)
        val rows = first.getJSONArray("apps")
        assertEquals(16, rows.length())
        assertEquals("example.app100", rows.getJSONObject(0).getString("app"))
        assertEquals(80, rows.getJSONObject(0).getString("label").length)
        val cursor = first.getJSONObject("nextCursor")
        assertEquals("example.app115", cursor.getString("after"))
        val next = page(obj("v" to 2, "limit" to 32, "cursor" to cursor))
        val second = next.result("grant", labels - "example.app115")
        assertEquals(32, second.getJSONArray("apps").length())
        assertEquals("example.app116", second.getJSONArray("apps").getJSONObject(0).getString("app"))
        val last = page(obj("v" to 2, "cursor" to second.getJSONObject("nextCursor"))).result("grant", labels)
        assertEquals(3, last.getJSONArray("apps").length())
        assertFalse(last.has("nextCursor"))
        assertThrows(WireFailure::class.java) { next.result("new-grant", labels) }
    }

    @Test fun invalidPageSizesVersionsAndCursorFieldsFailClosed() {
        for (limit in listOf(0, -1, 33, 1.5, "2", JSONObject.NULL)) {
            assertThrows(WireFailure::class.java) { page(obj("v" to 2, "limit" to limit)) }
        }
        assertThrows(WireFailure::class.java) { page(JSONObject()) }
        assertThrows(WireFailure::class.java) { page(obj("v" to "2")) }
        assertThrows(WireFailure::class.java) { page(obj("v" to 2, "cursor" to obj("after" to "some.app"))) }
        assertThrows(WireFailure::class.java) { page(obj("v" to 2, "all" to true)) }
    }

    @Test fun openRequiresTheListedSessionAndOnlyAcceptsAPackage() {
        fun args() = obj("v" to 2, "session" to "grant", "app" to "example.app")
        val open = BroadAppRequest.parse("open_app", args())
        open.checkSession("grant")
        assertThrows(WireFailure::class.java) { open.checkSession("new-grant") }
        assertThrows(WireFailure::class.java) { BroadAppRequest.parse("open_app", args().apply { remove("session") }) }
        for (key in listOf("intent", "uri", "activity", "component", "action", "flags", "gesture")) {
            assertThrows(WireFailure::class.java) { BroadAppRequest.parse("open_app", args().put(key, "value")) }
        }
        for (value in listOf("example.app/.Activity", "intent://example", "https://example", "")) {
            assertThrows(WireFailure::class.java) { BroadAppRequest.parse("open_app", args().put("app", value)) }
        }
    }
}

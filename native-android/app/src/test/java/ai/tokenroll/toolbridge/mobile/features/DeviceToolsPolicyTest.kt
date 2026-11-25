package ai.tokenroll.toolbridge.mobile

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class DeviceToolsPolicyTest {
    @Test fun webHandoffAcceptsOnlyBrowsableHttpLinks() {
        listOf("https://example.org/a?q=1#s", "http://example.org/中文").forEach {
            assertEquals(it, deviceLink(it).toString())
        }
        for (bad in listOf("intent://x#Intent;end", "file:///etc", "content://provider/row",
            "javascript:alert(1)", "custom:open", "//example.org", "https:example.org",
            "https://name:password@example.org", "https://example.org/\u202e", "https://x/\n")) {
            assertEquals("invalid_argument", assertThrows(WireFailure::class.java) { deviceLink(bad) }.localCode)
        }
    }

    @Test fun timestampMustRoundTripWithMillisecondsAndUtc() {
        val canonical = "2028-02-29T23:59:59.001Z"
        assertEquals(canonical, NativeJson.now(timerInstant(canonical)))
        listOf("2027-02-29T00:00:00.000Z", "2028-02-29T00:00:00Z", "2028-02-29T00:00:00.000+00:00",
            "2028-02-29T24:00:00.000Z", "not a date").forEach {
            assertEquals("invalid_argument", assertThrows(WireFailure::class.java) { timerInstant(it) }.localCode)
        }
    }

    @Test fun timerLeadHasInclusiveBoundaries() {
        val now = 1783200000000L
        checkTimerLead(now + 10000, now)
        checkTimerLead(now + 86400000, now)
        assertEquals("timer_too_soon", assertThrows(WireFailure::class.java) { checkTimerLead(now + 9999, now) }.localCode)
        assertEquals("timer_too_far", assertThrows(WireFailure::class.java) { checkTimerLead(now + 86400001, now) }.localCode)
    }
}

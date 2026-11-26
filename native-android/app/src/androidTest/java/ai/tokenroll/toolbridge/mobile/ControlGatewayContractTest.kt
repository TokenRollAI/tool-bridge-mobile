package ai.tokenroll.toolbridge.mobile

import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.fail
import org.junit.Test

/** Checks the published discovery schemas using the same Android validator as a gateway call. */
class ControlGatewayContractTest {
    private val catalog = CommandCatalog(InstrumentationRegistry.getInstrumentation().targetContext,
        { true }, { JSONObject() })

    private fun validate(tool: String, json: String, output: Boolean = false) =
        catalog.validate(catalog.resolve("control/$tool"), JSONObject(json), output)

    @Test fun legacyAndScopedCallsHaveSeparateShapes() {
        validate("observe", "{}")
        validate("observe", """{"v":2,"region":"r2","since":"s1"}""")
        validate("tap", """{"element":"old"}""")
        validate("tap", """{"accepted":true}""", true)
        validate("tap", """{"v":2,"snapshot":"s1","target":{"ref":"e2","region":"r1"}}""")
        for (args in listOf("""{"v":2,"element":"old"}""",
            """{"v":2,"snapshot":"s1","target":{"ref":"e2"}}""", """{"v":3}""")) {
            try {
                validate("tap", args)
                fail("Accepted invalid scoped tap")
            } catch (error: WireFailure) {
                assertEquals("invalid_argument", error.localCode)
            }
        }
    }

    @Test fun scopedObservationAndReceiptMatchDiscovery() {
        val frame = """{"v":2,"kind":"full","snapshot":"s1","window":{"ref":"w1","app":"a.b","boundsSpace":"window_normalized_1000"},"regions":[{"ref":"r1","position":"right","label":"推荐","bounds":[500,0,1000,1000],"actions":[],"depth":1,"truncated":false}],"items":[{"ref":"e1","region":"r1","role":"button","name":"视频","context":"","bounds":[510,10,900,80],"actions":["tap"],"enabled":true,"selected":false}],"truncated":false}"""
        validate("observe", frame, true)
        validate("tap", """{"v":2,"dispatch":"sent","outcome":"not_verified","changes":$frame}""", true)
        validate("status", """{"v":2,"state":"local_grant_required","serviceConnected":true,"remainingMs":0,"supported":["status"]}""", true)
        validate("status", """{"v":2,"mode":"all_apps_until_stopped","state":"awaiting_selected_app","serviceConnected":true,"remainingMs":null,"supported":["apps","open_app"]}""", true)
        validate("apps", """{"v":2,"limit":3}""")
        validate("open_app", """{"v":2,"session":"local-grant","app":"a.b"}""")
    }
}

package ai.tokenroll.toolbridge.mobile

import org.junit.Assert.*
import org.junit.Test

class GatewayIdentityTest {
    @Test fun identityMatchesTheExpoSeedOnBothPaths() {
        val installation = "installation_01234567-89ab-4cde-8f01-23456789abcd"
        assertEquals("1b2d17a49efc", deriveDefaultDeviceId(installation, "deadbeef"))
        assertEquals("57e9f47be050", deriveDefaultDeviceId(installation, null))
    }

    @Test fun audienceUsesCanonicalHttpsOrigin() {
        assertEquals("https://gw.example", normalizeManualGatewayOrigin(" HTTPS://GW.EXAMPLE:443/ "))
        assertEquals("https://[::1]:8443", normalizeManualGatewayOrigin("https://[::1]:8443/"))
        for (value in listOf("http://gw.example", "https://user:password@gw.example",
                "https://gw.example/path", "https://gw.example?secret=1", "https://gw.example#secret")) {
            val failure = runCatching { normalizeManualGatewayOrigin(value) }.exceptionOrNull()
            assertTrue(failure is IllegalArgumentException)
            assertFalse(failure.toString().contains(value))
        }
    }

    @Test fun diagnosticStringDoesNotRevealSecretsOrIdentifiers() {
        val credential = GatewayCredential("https://gateway.example", "phone", "key-id", "sensitive-key")
        assertEquals("GatewayCredential([REDACTED])", credential.toString())
    }
}

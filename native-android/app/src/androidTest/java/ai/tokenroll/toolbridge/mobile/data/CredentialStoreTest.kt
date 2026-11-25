package ai.tokenroll.toolbridge.mobile

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import java.util.concurrent.Callable
import java.util.concurrent.Executors
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.*
import org.junit.Test

class CredentialStoreTest {
    private val context = StoreTestContext()
    private val prefs = context.getSharedPreferences("SecureStore", Context.MODE_PRIVATE)
    private val installationKey = "tool-bridge-mobile.installation-id.v1"
    private val credentialKey = "tool-bridge-mobile.device-credential.v1"
    private val installation = "installation_01234567-89ab-4cde-8f01-23456789abcd"
    private val origin = "https://gateway.example"
    private val sample = "preview-fixture-key"

    @After fun cleanup() = context.cleanup()

    // Independent producer matching expo-secure-store 57, including its pre-suffix AES reader.
    private fun expoEntry(name: String, plaintext: String, legacy: Boolean = false) {
        val alias = "AES/GCM/NoPadding:key_v1" + if (legacy) "" else ":keystoreUnauthenticated"
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        val key = ks.getKey(alias, null) as? SecretKey ?: KeyGenerator.getInstance("AES", ks.provider).apply {
            init(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setKeySize(256).setBlockModes("GCM").setEncryptionPaddings("NoPadding").build())
        }.generateKey()
        val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, key) }
        val gcm = cipher.parameters.getParameterSpec(GCMParameterSpec::class.java)
        val item = JSONObject().put("scheme", "aes").put("ct", Base64.encodeToString(cipher.doFinal(plaintext.toByteArray()), 2))
            .put("iv", Base64.encodeToString(gcm.iv, 2)).put("tlen", gcm.tLen)
        if (!legacy) item.put("usesKeystoreSuffix", true).put("keystoreAlias", "key_v1").put("requireAuthentication", false)
        assertTrue(prefs.edit().putString(if (legacy) name else "key_v1-$name", item.toString()).commit())
    }

    @Test fun upgradeThenRotateAndClearWithoutChangingIdentity() {
        val envelope = JSONObject().put("version", 1).put("audienceOrigin", origin)
            .put("deviceId", "old-phone").put("keyId", "old-key").put("material", sample)
        expoEntry(installationKey, installation, legacy = true)
        expoEntry(credentialKey, envelope.toString())
        val store = CredentialStore(context)
        assertEquals(installation, store.installationId())
        val original = store.getCredential()!!
        assertEquals(sample, original.material)
        assertEquals("old-phone", original.deviceId)
        val replacement = store.saveManual("HTTPS://Gateway.Example:443/", "new-sample", "new-phone")
        assertEquals(origin, replacement.audienceOrigin)
        assertFalse(replacement.toString().contains("new-sample"))
        assertFalse(prefs.all.values.any { it.toString().contains("new-sample") || it.toString().contains(installation) })
        assertFalse(store.clearCredentialIfMatches(origin, original.deviceId, original.keyId, original.material))
        val reopened = CredentialStore(context)
        val stored = prefs.getString("key_v1-$credentialKey", null)!!
        assertFalse(stored.contains("new-sample"))
        assertFalse(stored.contains(origin))
        assertEquals("new-sample", reopened.getCredential()!!.material)
        assertTrue(store.clearCredentialIfMatches(origin, replacement.deviceId, replacement.keyId, replacement.material))
        assertNull(reopened.getCredential())
        assertEquals(installation, reopened.installationId())
    }

    @Test fun malformedRecordsFailClosedWithoutLeakingOrChangingIdentity() {
        val store = CredentialStore(context)
        expoEntry(credentialKey, "{broken-$sample")
        val error = runCatching { store.getCredential() }.exceptionOrNull()
        assertNotNull(error)
        assertFalse(error.toString().contains(sample))
        assertNull(error!!.cause)
        expoEntry(installationKey, sample)
        val before = prefs.all
        assertTrue(runCatching { store.installationId() }.isFailure)
        assertEquals(before, prefs.all)
        for (value in listOf("http://insecure.example", "https://user:password@gateway.example", "$origin/path", "$origin?q=1", "$origin#x")) {
            assertTrue(runCatching { store.saveManual(value, sample) }.exceptionOrNull() is IllegalArgumentException)
        }
    }

    @Test fun concurrentFirstReadUsesOneInstallationIdentity() {
        val pool = Executors.newFixedThreadPool(4)
        try {
            val calls = (1..8).map { Callable { CredentialStore(context).installationId() } }
            assertEquals(1, pool.invokeAll(calls).map { it.get() }.toSet().size)
        } finally { pool.shutdownNow() }
        val store = CredentialStore(context)
        assertEquals(12, store.defaultDeviceId().length)
        assertEquals(store.defaultDeviceId(), store.saveManual(origin, sample).deviceId)
    }
}

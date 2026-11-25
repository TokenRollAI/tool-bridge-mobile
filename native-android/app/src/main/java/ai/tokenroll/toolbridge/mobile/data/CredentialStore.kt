package ai.tokenroll.toolbridge.mobile

import android.content.Context
import android.provider.Settings
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import java.security.MessageDigest
import java.util.UUID
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import org.json.JSONObject

// A regular class deliberately omits the compiler-generated data-class toString/copy.
class GatewayCredential internal constructor(
    val audienceOrigin: String,
    val deviceId: String,
    val keyId: String,
    val material: String,
) {
    override fun toString(): String = "GatewayCredential([REDACTED])"
}

internal fun normalizeManualGatewayOrigin(input: String): String {
    val url = input.trim().toHttpUrlOrNull()
    require(url != null && url.isHttps && url.username.isEmpty() && url.password.isEmpty() &&
        url.encodedPath == "/" && url.query == null && url.fragment == null) { "网关必须是 HTTPS origin" }
    return url.toString().removeSuffix("/").also { require(it.length <= 2048) { "网关地址过长" } }
}

internal fun deriveDefaultDeviceId(installation: String, androidId: String?): String {
    val seed = if (androidId == null) "installation:$installation" else "android:$androidId"
    val bytes = MessageDigest.getInstance("SHA-256").digest("tool-bridge-mobile.device-id.v1:$seed".toByteArray())
    return bytes.take(6).joinToString("") { "%02x".format(it) }
}

class CredentialStore(context: Context) {
    private val app = context.applicationContext
    private val preferences = app.getSharedPreferences("SecureStore", Context.MODE_PRIVATE)

    fun installationId(): String = synchronized(lock) {
        val stored = read(installationSlot)
        if (stored != null) {
            check(installationPattern.matches(stored)) { "安全存储中的安装身份无效" }
            stored
        } else {
            val id = "installation_" + UUID.randomUUID().toString()
            write(installationSlot, id)
            id
        }
    }

    fun defaultDeviceId(): String {
        val installation = installationId()
        val androidId = try {
            Settings.Secure.getString(app.contentResolver, Settings.Secure.ANDROID_ID)?.takeUnless { it.isBlank() }
        } catch (_: RuntimeException) { null }
        return deriveDefaultDeviceId(installation, androidId)
    }

    fun getCredential(): GatewayCredential? = synchronized(lock) {
        val plaintext = read(credentialSlot) ?: return@synchronized null
        // org.json 的某些解析异常包含原始输入，不能把 cause 送入崩溃报告。
        protectedStorage {
            val envelope = JSONObject(plaintext)
            require(envelope.length() == 5 && envelope.opt("version") == 1)
            val origin = envelope.textField("audienceOrigin")
            val id = envelope.textField("deviceId")
            val key = envelope.textField("keyId")
            val material = envelope.textField("material")
            require(normalizeManualGatewayOrigin(origin) == origin && devicePattern.matches(id))
            require(key.length in 1..256 && !unsafeKey.containsMatchIn(key))
            require(material.length in 1..16384 && '\r' !in material && '\n' !in material)
            GatewayCredential(origin, id, key, material)
        }
    }

    fun saveManual(origin: String, apiKey: String, deviceId: String = ""): GatewayCredential = synchronized(lock) {
        val audience = normalizeManualGatewayOrigin(origin)
        require(apiKey.length in 1..16384 && apiKey.all { it in '!'..'~' }) { "API key 格式无效" }
        val custom = deviceId.trim()
        require(custom.isEmpty() || devicePattern.matches(custom)) { "设备 ID 格式无效" }
        val installation = installationId()
        val id = custom.ifEmpty { defaultDeviceId() }
        val key = "manual_api_key_" + installation.removePrefix("installation_")
        val envelope = JSONObject().put("version", 1).put("audienceOrigin", audience)
            .put("deviceId", id).put("keyId", key).put("material", apiKey)
        write(credentialSlot, envelope.toString())
        GatewayCredential(audience, id, key, apiKey)
    }

    fun clearCredential() = synchronized(lock) {
        check(preferences.edit().remove("$service-$credentialSlot").remove(credentialSlot).commit()) {
            "清除网关凭证失败"
        }
    }

    // 同一次 App 运行中的旧网络请求可能在换钥后才失败。
    fun clearCredentialIfMatches(origin: String, deviceId: String, keyId: String, material: String): Boolean =
        synchronized(lock) {
            val current = getCredential() ?: return@synchronized false
            if (current.audienceOrigin != origin || current.deviceId != deviceId ||
                current.keyId != keyId || current.material != material) return@synchronized false
            clearCredential()
            true
        }

    // 直接沿用已发布预览版 expo-secure-store 57 的 AES envelope，无需跨库复制明文。
    private fun read(slot: String): String? = protectedStorage {
        val encrypted = preferences.getString("$service-$slot", null)
            ?: preferences.getString(slot, null) ?: return@protectedStorage null
        val item = JSONObject(encrypted)
        require(item.textField("scheme") == "aes" && !item.optBoolean("requireAuthentication"))
        require(!item.has("keystoreAlias") || item.textField("keystoreAlias") == service)
        val alias = if (item.optBoolean("usesKeystoreSuffix")) currentAlias else legacyAlias
        val secret = keyStore().getKey(alias, null) as? SecretKey ?: error("密钥不可用")
        val iv = Base64.decode(item.textField("iv"), Base64.DEFAULT)
        val bits = item.getInt("tlen")
        require(bits in 96..128 && bits % 8 == 0 && iv.size == 12)
        val cipher = Cipher.getInstance(cipherName)
        cipher.init(Cipher.DECRYPT_MODE, secret, GCMParameterSpec(bits, iv))
        val decrypted = cipher.doFinal(Base64.decode(item.textField("ct"), Base64.DEFAULT))
        try { String(decrypted, Charsets.UTF_8) } finally { decrypted.fill(0) }
    }

    private fun write(slot: String, plaintext: String) = protectedStorage {
        val key = keyStore().getKey(currentAlias, null) as? SecretKey ?: generateKey()
        val cipher = Cipher.getInstance(cipherName)
        cipher.init(Cipher.ENCRYPT_MODE, key)
        val bytes = plaintext.toByteArray(Charsets.UTF_8)
        val ciphertext = try { cipher.doFinal(bytes) } finally { bytes.fill(0) }
        val spec = cipher.parameters.getParameterSpec(GCMParameterSpec::class.java)
        val item = JSONObject().put("ct", Base64.encodeToString(ciphertext, Base64.NO_WRAP))
            .put("iv", Base64.encodeToString(spec.iv, Base64.NO_WRAP)).put("tlen", spec.tLen)
            .put("scheme", "aes").put("requireAuthentication", false)
            .put("usesKeystoreSuffix", true).put("keystoreAlias", service)
        check(preferences.edit().putString("$service-$slot", item.toString()).remove(slot).commit())
    }

    private fun keyStore() = KeyStore.getInstance(provider).apply { load(null) }

    private fun generateKey(): SecretKey {
        val spec = KeyGenParameterSpec.Builder(currentAlias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
            .setKeySize(256).setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build()
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, provider).apply { init(spec) }.generateKey()
    }

    private inline fun <T> protectedStorage(block: () -> T): T = try {
        block()
    } catch (_: Exception) {
        throw IllegalStateException("设备安全存储无法读取或写入")
    }

    private companion object {
        val lock = Any()
        const val service = "key_v1"
        const val cipherName = "AES/GCM/NoPadding"
        const val provider = "AndroidKeyStore"
        const val legacyAlias = "$cipherName:$service"
        const val currentAlias = "$legacyAlias:keystoreUnauthenticated"
        const val installationSlot = "tool-bridge-mobile.installation-id.v1"
        const val credentialSlot = "tool-bridge-mobile.device-credential.v1"
        val devicePattern = Regex("[A-Za-z0-9._-]{1,64}")
        val installationPattern = Regex("installation_[0-9a-f-]{36}")
        val unsafeKey = Regex("""[\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]""")
    }
}

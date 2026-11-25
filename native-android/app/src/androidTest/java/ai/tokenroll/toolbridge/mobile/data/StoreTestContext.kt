package ai.tokenroll.toolbridge.mobile

import android.content.Context
import android.content.ContextWrapper
import android.content.SharedPreferences
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import java.util.UUID

// Test-only files and preferences: never clear an installed preview's real identity or inbox.
internal class StoreTestContext : ContextWrapper(InstrumentationRegistry.getInstrumentation().targetContext) {
    private val namespace = "data-test-" + UUID.randomUUID()
    private val root = File(baseContext.cacheDir, namespace).apply {
        check(mkdir()) { "无法创建隔离测试目录" }
    }
    override fun getFilesDir(): File = root
    override fun getApplicationContext(): Context = this
    override fun getSharedPreferences(name: String, mode: Int): SharedPreferences =
        baseContext.getSharedPreferences("$namespace-$name", mode)
    fun cleanup() {
        baseContext.deleteSharedPreferences("$namespace-SecureStore")
        root.deleteRecursively()
    }
}

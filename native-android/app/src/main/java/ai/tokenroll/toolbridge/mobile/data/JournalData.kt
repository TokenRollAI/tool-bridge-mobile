package ai.tokenroll.toolbridge.mobile

import android.database.DatabaseUtils
import android.database.sqlite.SQLiteDatabase
import org.json.JSONException
import org.json.JSONObject

internal class JournalData(private val db: SQLiteDatabase) {
    fun get(operationId: String): JSONObject? {
        require(operationId.isNotEmpty())
        val row = db.rows("SELECT * FROM device_operation_journal WHERE operation_id=?", operationId).singleOrNull()
            ?: return null
        val encoded = row.remove("completionJson")
        if (encoded is String) {
            val completion = try { JSONObject(encoded) } catch (_: JSONException) { invalid() }
            row.put("completion", completion)
        }
        validate(row)
        return row
    }

    fun put(entry: JSONObject) {
        validate(entry)
        // REPLACE works on API 24's SQLite, which predates INSERT ... ON CONFLICT DO UPDATE.
        db.execSQL("""INSERT OR REPLACE INTO device_operation_journal
            (operation_id,state,completion_json,expires_at,updated_at) VALUES(?,?,?,?,?)""",
            arrayOf(entry.textField("operationId"), entry.textField("state"), entry.optJSONObject("completion")?.toString(),
                entry.textField("expiresAt"), entry.textField("updatedAt")))
    }

    fun remove(operationId: String) {
        require(operationId.isNotEmpty())
        db.delete("device_operation_journal", "operation_id=?", arrayOf(operationId))
    }

    fun collect(now: String): Int {
        checkTimestamp(now)
        return db.delete("device_operation_journal", "julianday(expires_at)<=julianday(?)", arrayOf(now))
    }

    private fun validate(entry: JSONObject) {
        if (entry.textField("operationId").isEmpty()) invalid()
        checkTimestamp(entry.textField("expiresAt"))
        checkTimestamp(entry.textField("updatedAt"))
        when (entry.textField("state")) {
            "discovered", "executing" -> if (entry.has("completion")) invalid()
            "terminal" -> validateCompletion(entry.optJSONObject("completion") ?: invalid())
            else -> invalid()
        }
    }

    private fun checkTimestamp(value: String) {
        if (!value.matches(isoTime) ||
            DatabaseUtils.longForQuery(db, "SELECT julianday(?) IS NOT NULL", arrayOf(value)) != 1L) invalid()
    }

    private fun validateCompletion(completion: JSONObject) {
        val keys = completion.keys().asSequence().toSet()
        when (completion.textField("outcome")) {
            "succeeded" -> {
                if (keys != setOf("outcome", "result")) invalid()
                return
            }
            "result_unknown" -> if (keys == setOf("outcome")) return
            "failed", "rejected" -> Unit
            else -> invalid()
        }
        if (keys != setOf("outcome", "error")) invalid()
        val error = completion.optJSONObject("error") ?: invalid()
        if (error.keys().asSequence().toSet() != setOf("code", "message", "retryable") ||
            error.opt("retryable") !is Boolean || error.opt("message") !is String ||
            error.opt("code") !in errorCodes) invalid()
    }

    companion object {
        private val errorCodes = setOf("not_found", "permission_denied", "invalid_argument",
            "conflict", "unavailable", "rate_limited", "internal")
        private val isoTime = Regex("""\d{4}-\d\d-\d\d[Tt ]\d\d:\d\d:\d\d(?:\.\d+)?(?:[Zz]|[+-]\d\d:\d\d)""")
        private fun invalid(): Nothing = throw IllegalArgumentException("Mailbox journal 状态无效")
    }
}

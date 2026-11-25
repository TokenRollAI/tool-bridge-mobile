package ai.tokenroll.toolbridge.mobile

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import org.json.JSONObject

/** Reserve a command durably before the handler can produce a side effect. */
internal class CommandHistory(context: Context) {
    private val helper = NativeDatabase(context)
    private val db by lazy {
        helper.writableDatabase.also { database ->
            database.execSQL("""CREATE TABLE IF NOT EXISTS native_command_owners (
                command_id TEXT PRIMARY KEY REFERENCES commands(command_id) ON DELETE CASCADE,
                principal TEXT NOT NULL)""")
        }
    }
    fun claim(c: WireCall, principal: String): JSONObject? {
        return db.atomic {
            val inserted = db.insertWithOnConflict("commands", null, ContentValues().apply {
                put("command_id", c.id); put("path", c.path); put("tool", c.tool)
                put("received_at", NativeJson.now()); put("status", "running")
            }, SQLiteDatabase.CONFLICT_IGNORE)
            if (inserted != -1L) {
                db.execSQL("INSERT INTO native_command_owners(command_id,principal) VALUES(?,?)",arrayOf(c.id,principal))
                return@atomic null
            }
            db.rawQuery("SELECT principal FROM native_command_owners WHERE command_id=?", arrayOf(c.id)).use {
                if (!it.moveToFirst() || it.getString(0) != principal)
                    throw WireFailure("conflict","该操作标识不能在本次调用中复用")
            }
            db.rawQuery("SELECT path,tool,outcome_json FROM commands WHERE command_id=?", arrayOf(c.id)).use { rows ->
                check(rows.moveToFirst())
                if (rows.getString(0) != c.path || rows.getString(1) != c.tool || rows.isNull(2)) {
                    throw WireFailure("result_unknown","操作已提交，未能确认结果")
                }
                val outcome = JSONObject(rows.getString(2))
                if (outcome.optBoolean("ok")) return@atomic outcome.getJSONObject("value")
                val error = outcome.getJSONObject("error")
                throw WireFailure(error.getString("code"), error.getString("message"), error.optBoolean("retryable"))
            }
        }
    }
    fun complete(c: WireCall, result: JSONObject?, error: WireFailure?) {
        val sensitive = c.path == "phone/control" || c.tool == "clipboard_get" || c.tool == "current"
        val outcome = when {
            error != null -> obj("ok" to false, "error" to obj("code" to error.localCode, "message" to error.message, "retryable" to error.retryable))
            sensitive -> JSONObject.NULL
            else -> obj("ok" to true, "value" to result)
        }
        db.atomic {
            db.update("commands", ContentValues().apply {
                put("status", if (error == null) "succeeded" else "failed")
                if (outcome !== JSONObject.NULL) put("outcome_json", outcome.toString())
                put("completed_at", NativeJson.now())
            }, "command_id=? AND status='running'", arrayOf(c.id))
            db.execSQL("""DELETE FROM commands WHERE command_id IN (SELECT command_id FROM commands
                WHERE status <> 'running' AND command_id NOT IN (SELECT source_command_id FROM timers
                WHERE state IN ('preparing','scheduled','cancelling','status_unknown'))
                ORDER BY received_at DESC, command_id DESC LIMIT -1 OFFSET 1000)""")
        }
    }
}

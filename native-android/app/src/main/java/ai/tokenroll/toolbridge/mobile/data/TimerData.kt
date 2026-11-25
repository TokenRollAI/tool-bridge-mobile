package ai.tokenroll.toolbridge.mobile

import android.database.sqlite.SQLiteDatabase
import org.json.JSONObject

internal class TimerData(private val db: SQLiteDatabase) {
    private val activeStates = "('preparing','scheduled','cancelling','status_unknown')"

    fun get(timerId: String, ownerSubjectId: String): JSONObject? =
        db.rows("SELECT * FROM timers WHERE timer_id=? AND owner_subject_id=?", timerId, ownerSubjectId).singleOrNull()

    fun active(): List<JSONObject> = db.rows(
        "SELECT * FROM timers WHERE state IN $activeStates ORDER BY fires_at, timer_id",
    )

    fun forReconciliation(): List<JSONObject> = db.rows(
        """SELECT timers.*, commands.status AS source_command_status FROM timers
            LEFT JOIN commands ON commands.command_id=timers.source_command_id
            WHERE timers.state IN $activeStates ORDER BY timers.fires_at,timers.timer_id""",
    )

    fun reserve(input: JSONObject, maxGlobal: Int, maxPerCaller: Int): JSONObject = db.atomic {
        val timer = input.textField("timerId")
        val owner = input.textField("ownerSubjectId")
        val command = input.textField("sourceCommandId")
        val rows = db.rows("SELECT * FROM timers WHERE timer_id=? OR source_command_id=?", timer, command)
        if (rows.isNotEmpty()) {
            val row = rows.singleOrNull()
            check(row != null && row.textField("timerId") == timer &&
                row.textField("ownerSubjectId") == owner && row.textField("sourceCommandId") == command) {
                "计时器标识冲突"
            }
            return@atomic JSONObject().put("kind", "existing").put("timer", row)
        }
        db.rawQuery("""SELECT COUNT(*), COUNT(CASE WHEN owner_subject_id=? THEN 1 END)
            FROM timers WHERE state IN $activeStates""", arrayOf(owner)).use { counts ->
            counts.moveToFirst()
            if (counts.getInt(1) >= maxPerCaller) return@atomic JSONObject().put("kind", "caller_capacity")
            if (counts.getInt(0) >= maxGlobal) return@atomic JSONObject().put("kind", "global_capacity")
        }
        val now = input.textField("now")
        db.execSQL("""INSERT INTO timers(timer_id,source_command_id,owner_subject_id,notification_id,
            fires_at,state,created_at,updated_at) VALUES(?,?,?,?,?,'preparing',?,?)""",
            arrayOf(timer, command, owner, input.textField("notificationId"), input.textField("firesAt"), now, now))
        JSONObject().put("kind", "reserved").put("timer", checkNotNull(get(timer, owner)))
    }

    fun markState(timerId: String, expected: List<String>, state: String, updatedAt: String): Boolean {
        if (expected.isEmpty()) return false
        val slots = expected.joinToString(",") { "?" }
        return db.compileStatement("""UPDATE timers SET state=?,updated_at=?,
            cancelled_at=CASE WHEN ?='cancelled' THEN ? ELSE cancelled_at END
            WHERE timer_id=? AND state IN ($slots)""").use { update ->
            update.bindAllArgsAsStrings((listOf(state, updatedAt, state, updatedAt, timerId) + expected).toTypedArray())
            update.executeUpdateDelete() == 1
        }
    }

    fun pruneTerminal(retainCount: Int): Int = db.delete("timers",
        """timer_id IN (SELECT timer_id FROM timers WHERE state IN ('cancelled','deadline_elapsed')
            ORDER BY updated_at DESC, timer_id DESC LIMIT -1 OFFSET ?)""",
        arrayOf(retainCount.coerceIn(1, 2000).toString()))
}

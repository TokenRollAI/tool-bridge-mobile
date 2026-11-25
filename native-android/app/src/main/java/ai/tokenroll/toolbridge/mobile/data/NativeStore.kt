package ai.tokenroll.toolbridge.mobile

import android.content.ContentValues
import android.content.Context
import android.database.DatabaseUtils
import android.database.sqlite.SQLiteDatabase
import java.io.Closeable
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import org.json.JSONObject

internal fun storeUtcNow(): String =
    SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply {
        timeZone = TimeZone.getTimeZone("UTC")
    }.format(Date())

// All selected columns are TEXT (or NULL) in the Expo schema.
internal fun SQLiteDatabase.rows(sql: String, vararg args: String): List<JSONObject> =
    rawQuery(sql, args).use { cursor ->
        val fields = cursor.columnNames.map { name ->
            name.split('_').mapIndexed { i, word ->
                if (i == 0) word else word.replaceFirstChar { it.uppercaseChar() }
            }.joinToString("")
        }
        buildList {
            while (cursor.moveToNext()) {
                val row = JSONObject()
                fields.forEachIndexed { i, name ->
                    row.put(name, if (cursor.isNull(i)) JSONObject.NULL else cursor.getString(i))
                }
                add(row)
            }
        }
    }

internal inline fun <T> SQLiteDatabase.atomic(action: () -> T): T {
    beginTransaction()
    try {
        val result = action()
        setTransactionSuccessful()
        return result
    } finally {
        endTransaction()
    }
}

internal fun JSONObject.textField(name: String): String =
    opt(name) as? String ?: throw IllegalArgumentException("缺少文本字段 $name")

private fun JSONObject.optionalText(name: String): String? =
    if (isNull(name)) null else textField(name)

private val inboxOrder = mapOf(
    "received_desc" to "received_at DESC, message_id DESC",
    "received_asc" to "received_at ASC, message_id ASC",
    "sent_desc" to "COALESCE(sent_at,received_at) DESC, message_id DESC",
    "sent_asc" to "COALESCE(sent_at,received_at) ASC, message_id ASC",
    "unread_first" to "(read_at IS NULL) DESC, received_at DESC, message_id DESC",
    "read_first" to "(read_at IS NULL) ASC, received_at DESC, message_id DESC",
)
private val controlModes = setOf("disabled", "ask_every_time", "trusted_session", "direct_call")

class NativeStore(context: Context) : Closeable {
    private val helper = NativeDatabase(context.applicationContext)
    // 不同宿主（界面、前台服务）可能同时冷启动，迁移只允许一个连接先打开。
    private val db by lazy { synchronized(openLock) { helper.writableDatabase } }
    private val timers get() = TimerData(db)
    private val journal get() = JournalData(db)

    private companion object { val openLock = Any() }

    override fun close() = helper.close()

    fun getSetting(key: String): String? =
        db.rows("SELECT value FROM settings WHERE key=?", key).firstOrNull()?.textField("value")

    fun setSetting(key: String, value: String) {
        if (key == "control_mode") require(value in controlModes)
        if (key == "background_runtime_enabled") require(value == "true" || value == "false")
        db.execSQL("INSERT OR REPLACE INTO settings(key,value,updated_at) VALUES(?,?,?)",
            arrayOf(key, value, storeUtcNow()))
    }

    fun controlMode(): String = (getSetting("control_mode") ?: "ask_every_time").also {
        check(it in controlModes) { "数据库中的控制模式无效" }
    }

    fun backgroundRuntimeEnabled(): Boolean = getSetting("background_runtime_enabled") == "true"

    fun addInbox(message: JSONObject): JSONObject = db.atomic {
        val id = message.textField("messageId")
        val command = message.textField("sourceCommandId")
        db.execSQL(
            """INSERT OR IGNORE INTO inbox_messages(message_id,source_command_id,caller_subject_id,
                caller_display_name,category,source_label,title,body,format,urgency,sent_at,received_at,read_at)
                VALUES(?,?,?,?,?,?,?,?,?,?,?,?,NULL)""",
            arrayOf(id, command, message.textField("callerSubjectId"), message.optionalText("callerDisplayName"),
                message.optionalText("category") ?: "message", message.optionalText("sourceLabel"),
                message.textField("title"), message.textField("body"), message.optionalText("format") ?: "markdown",
                message.optionalText("urgency") ?: "normal", message.optionalText("sentAt"), message.textField("receivedAt")),
        )
        val stored = db.rows("SELECT * FROM inbox_messages WHERE source_command_id=?", command).singleOrNull()
        check(stored != null && stored.textField("messageId") == id) { "信箱消息写入冲突" }
        // 保留刚写入的记录，即使调用时间早于目前保留的消息。
        db.execSQL("""DELETE FROM inbox_messages WHERE message_id IN (
            SELECT message_id FROM inbox_messages WHERE message_id<>?
            ORDER BY received_at DESC, message_id DESC LIMIT -1 OFFSET 999)""", arrayOf(id))
        stored
    }

    fun getInbox(messageId: String): JSONObject? =
        db.rows("SELECT * FROM inbox_messages WHERE message_id=?", messageId).singleOrNull()

    fun listInbox(searchQuery: String = "", sort: String = "received_desc", unreadOnly: Boolean = false,
                  limit: Int = 100): List<JSONObject> {
        val query = searchQuery.trim()
        require(query.length <= 120) { "信箱搜索词过长" }
        val order = requireNotNull(inboxOrder[sort]) { "信箱排序方式无效" }
        val filters = mutableListOf<String>()
        val args = mutableListOf<String>()
        if (unreadOnly) filters.add("read_at IS NULL")
        if (query.isNotEmpty()) {
            val pattern = "%" + query.replace("!", "!!").replace("%", "!%").replace("_", "!_") + "%"
            val fields = listOf("title", "body", "source_label", "caller_display_name", "caller_subject_id")
            filters.add(fields.joinToString(" OR ", "(", ")") {
                args.add(pattern)
                "$it LIKE ? ESCAPE '!' COLLATE NOCASE"
            })
        }
        val where = if (filters.isEmpty()) "" else "WHERE " + filters.joinToString(" AND ")
        args.add(limit.coerceIn(1, 200).toString())
        return db.rows("SELECT * FROM inbox_messages $where ORDER BY $order LIMIT ?", *args.toTypedArray())
    }

    fun countUnread(): Int = DatabaseUtils.longForQuery(
        db, "SELECT COUNT(*) FROM inbox_messages WHERE read_at IS NULL", null,
    ).toInt()

    fun markRead(messageId: String, readAt: String = storeUtcNow()): Boolean =
        db.update("inbox_messages", ContentValues().apply { put("read_at", readAt) },
            "message_id=? AND read_at IS NULL", arrayOf(messageId)) == 1

    fun markAllRead(readAt: String = storeUtcNow()): Int =
        db.update("inbox_messages", ContentValues().apply { put("read_at", readAt) }, "read_at IS NULL", null)

    fun clearInbox(): Int = db.delete("inbox_messages", "1", null)

    fun addAudit(record: JSONObject) = db.atomic {
        // 仅绑定公开的元数据列。调用参数、消息正文、原始错误均不序列化。
        db.execSQL("""INSERT INTO audit_records(id,command_id,occurred_at,caller_subject_id,path,tool,
            effect,risk,decision,outcome_code,client_version) VALUES(?,?,?,?,?,?,?,?,?,?,?)""",
            arrayOf("id", "commandId", "occurredAt", "callerSubjectId", "path", "tool", "effect", "risk",
                "decision", "outcomeCode", "clientVersion").map(record::textField).toTypedArray())
        pruneAudit(5000)
        Unit
    }

    fun listAudit(limit: Int = 100): List<JSONObject> =
        db.rows("SELECT * FROM audit_records ORDER BY occurred_at DESC, id DESC LIMIT ?", limit.coerceIn(1, 200).toString())

    fun clearAudit(): Int = db.delete("audit_records", "1", null)

    fun pruneAudit(retainCount: Int): Int = db.delete("audit_records",
        "id IN (SELECT id FROM audit_records ORDER BY occurred_at DESC,id DESC LIMIT -1 OFFSET ?)",
        arrayOf(retainCount.coerceIn(1, 10000).toString()))

    fun reserveTimer(reservation: JSONObject, maxGlobal: Int, maxPerCaller: Int): JSONObject =
        timers.reserve(reservation, maxGlobal, maxPerCaller)
    fun getTimerForOwner(timerId: String, ownerSubjectId: String) = timers.get(timerId, ownerSubjectId)
    fun listActiveTimers() = timers.active()
    fun listTimersForReconciliation() = timers.forReconciliation()
    fun markTimerState(timerId: String, expected: List<String>, state: String, updatedAt: String) =
        timers.markState(timerId, expected, state, updatedAt)
    fun pruneTerminalTimers(retainCount: Int) = timers.pruneTerminal(retainCount)

    fun getJournal(operationId: String) = journal.get(operationId)
    fun putJournal(entry: JSONObject) = journal.put(entry)
    fun removeJournal(operationId: String) = journal.remove(operationId)
    fun garbageCollectJournal(now: String) = journal.collect(now)
}

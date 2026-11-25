package ai.tokenroll.toolbridge.mobile

import android.database.sqlite.SQLiteDatabase
import java.io.File
import java.util.concurrent.Callable
import java.util.concurrent.Executors
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.*
import org.junit.Test

class NativeStoreTest {
    private val context = StoreTestContext()
    private val now = "2026-07-01T01:00:00.000Z"
    private val later = "2026-07-01T02:00:00.000Z"

    @After fun cleanup() = context.cleanup()

    private fun message(id: String, at: String = now) = JSONObject()
        .put("messageId", id).put("sourceCommandId", "command-$id").put("callerSubjectId", "caller")
        .put("title", id).put("body", "body").put("receivedAt", at)

    @Test fun inheritsExpoV3InPlaceAndLeavesFutureVersionIntact() {
        val path = File(context.filesDir, "SQLite/tool-bridge-mobile.db")
        path.parentFile!!.mkdirs()
        SQLiteDatabase.openOrCreateDatabase(path, null).use { db ->
            db.execSQL("""CREATE TABLE inbox_messages(message_id TEXT PRIMARY KEY, source_command_id TEXT UNIQUE,
                caller_subject_id TEXT, caller_display_name TEXT, category TEXT, source_label TEXT, title TEXT,
                body TEXT, received_at TEXT, read_at TEXT)""")
            db.execSQL("INSERT INTO inbox_messages VALUES('legacy','cmd','caller',NULL,'news','feed','title','body',?,?)",
                arrayOf(now, later))
            db.execSQL("CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT,updated_at TEXT)")
            db.execSQL("INSERT INTO settings VALUES('control_mode','trusted_session',?)", arrayOf(now))
            db.version = 3
        }
        NativeStore(context).use { store ->
            val row = store.listInbox().single()
            assertEquals("legacy", row.getString("messageId"))
            assertEquals(later, row.getString("readAt"))
            assertEquals("normal", row.getString("urgency"))
            assertEquals("markdown", row.getString("format"))
            assertTrue(row.isNull("sentAt"))
            assertEquals("trusted_session", store.controlMode())
            assertNull(store.getJournal("missing"))
        }
        SQLiteDatabase.openDatabase(path.path, null, SQLiteDatabase.OPEN_READWRITE).use {
            assertEquals(5, it.version)
            it.version = 6
        }
        NativeStore(context).use { assertTrue(runCatching { it.listInbox() }.isFailure) }
        SQLiteDatabase.openDatabase(path.path, null, SQLiteDatabase.OPEN_READONLY).use {
            assertEquals(6, it.version)
            assertTrue(it.rawQuery("SELECT message_id FROM inbox_messages WHERE message_id='legacy'", null).use { c -> c.moveToFirst() })
        }
    }

    @Test fun inboxReplaySearchSortAndPrune() = NativeStore(context).use { store ->
        assertEquals("ask_every_time", store.controlMode())
        assertFalse(store.backgroundRuntimeEnabled())
        store.setSetting("background_runtime_enabled", "true")
        assertTrue(store.backgroundRuntimeEnabled())
        store.addInbox(message("a").put("sourceLabel", "Feed!_%").put("sentAt", later))
        store.addInbox(message("b", later))
        assertEquals("a", store.listInbox("!_%", limit = 1).single().getString("messageId"))
        assertEquals("b", store.listInbox(sort = "received_desc").first().getString("messageId"))
        assertEquals("a", store.listInbox(sort = "sent_asc").first().getString("messageId"))
        assertTrue(store.markRead("b", now))
        assertFalse(store.markRead("b", later))
        val replay = store.addInbox(message("b").put("title", "replacement"))
        assertEquals("b", replay.getString("title"))
        assertEquals(now, replay.getString("readAt"))
        assertEquals("a", store.listInbox(unreadOnly = true, limit = 1).single().getString("messageId"))
        assertTrue(runCatching { store.addInbox(message("c").put("sourceCommandId", "command-b")) }.isFailure)
        assertEquals(1, store.countUnread())
        assertEquals(1, store.markAllRead())
        assertEquals(0, store.markAllRead())
        // Insert the oldest item last; retention must protect that item.
        repeat(999) { store.addInbox(message("new-$it", later)) }
        store.addInbox(message("old", "2020-01-01T00:00:00.000Z"))
        assertNotNull(store.getInbox("old"))
        assertNull(store.getInbox("a"))
        assertEquals(1000, store.clearInbox())
        assertEquals(0, store.clearInbox())
    }

    private fun timer(id: String, owner: String) = JSONObject().put("timerId", id)
        .put("ownerSubjectId", owner).put("sourceCommandId", "cmd-$id").put("notificationId", "notif-$id")
        .put("firesAt", later).put("now", now)

    @Test fun timerCapacityIsAtomicAcrossConnectionsAndSurvivesReopen() {
        NativeStore(context).use { store ->
            val pool = Executors.newFixedThreadPool(3)
            try {
                val calls = (1..3).map { id -> Callable {
                    NativeStore(context).use { it.reserveTimer(timer("t$id", "me"), 3, 1).getString("kind") }
                } }
                val kinds = pool.invokeAll(calls).map { it.get() }
                assertEquals(1, kinds.count { it == "reserved" })
                assertEquals(2, kinds.count { it == "caller_capacity" })
            } finally { pool.shutdownNow() }
            val id = store.listActiveTimers().single().getString("timerId")
            assertEquals("existing", store.reserveTimer(timer(id, "me"), 1, 1).getString("kind"))
            assertEquals("global_capacity", store.reserveTimer(timer("new", "other"), 1, 1).getString("kind"))
            assertNull(store.getTimerForOwner(id, "other"))
            assertTrue(store.listTimersForReconciliation().single().isNull("sourceCommandStatus"))
            assertFalse(store.markTimerState(id, listOf("scheduled"), "cancelled", later))
            assertTrue(store.markTimerState(id, listOf("preparing"), "cancelled", later))
            assertEquals(later, store.getTimerForOwner(id, "me")!!.getString("cancelledAt"))
        }
        NativeStore(context).use { assertTrue(it.listActiveTimers().isEmpty()) }
    }

    @Test fun journalCompletionIsDurableAndAuditKeepsMetadataOnly() {
        val entry = JSONObject().put("operationId", "op").put("state", "executing")
            .put("expiresAt", later).put("updatedAt", now)
        NativeStore(context).use { store ->
            store.putJournal(entry)
            assertFalse(store.getJournal("op")!!.has("completion"))
            entry.put("state", "terminal").put("completion", JSONObject().put("outcome", "result_unknown"))
            store.putJournal(entry)
            val audit = JSONObject()
            for (key in listOf("id","commandId","callerSubjectId","path","tool","effect","risk","decision","outcomeCode","clientVersion")) {
                audit.put(key, key)
            }
            store.addAudit(audit.put("occurredAt", now).put("body", "private"))
        }
        NativeStore(context).use { store ->
            entry.getJSONObject("completion").put("extra", "private")
            assertTrue(runCatching { store.putJournal(entry) }.isFailure)
            assertEquals("result_unknown", store.getJournal("op")!!.getJSONObject("completion").getString("outcome"))
            assertEquals(0, store.garbageCollectJournal(now))
            assertEquals(1, store.garbageCollectJournal(later))
            store.removeJournal("op")
            assertEquals(11, store.listAudit().single().length())
            assertEquals(1, store.clearAudit())
        }
    }
}

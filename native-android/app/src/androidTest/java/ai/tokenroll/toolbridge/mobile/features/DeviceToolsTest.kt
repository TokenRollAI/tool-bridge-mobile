package ai.tokenroll.toolbridge.mobile

import android.app.Notification
import android.app.NotificationManager
import android.Manifest
import android.content.Context
import android.content.ContextWrapper
import android.content.Intent
import android.content.pm.PackageManager
import android.os.SystemClock
import android.os.Build
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Before
import org.junit.Test
import java.util.UUID

class DeviceToolsTest {
    private val context: Context = InstrumentationRegistry.getInstrumentation().targetContext
    private lateinit var files: StoreTestContext
    private lateinit var store: NativeStore
    private lateinit var tools: DeviceTools
    private val manager get() = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    private var foreground = true

    @Before fun setup() {
        files = StoreTestContext()
        store = NativeStore(files)
        tools = DeviceTools(context, store, { foreground }, {})
    }

    @After fun cleanup() {
        tools.close()
        store.close()
        files.cleanup()
    }

    private fun call(key: String, args: JSONObject = JSONObject(), owner: String = "one", id: String = UUID.randomUUID().toString()) =
        WireCall(id, "phone/" + key.substringBefore('/'), key.substringAfter('/'), args, owner, owner,
            System.currentTimeMillis(), System.currentTimeMillis() + 60000, "realtime", WireSignal(), null)

    private fun expectCode(code: String, block: () -> Unit) {
        try { block(); fail("Expected $code") } catch (e: WireFailure) { assertEquals(code, e.localCode) }
    }

    @Test fun foregroundBoundariesAndUnknownToolsFailBeforeDeviceEffects() {
        foreground = false
        listOf("system/clipboard_get" to JSONObject(), "system/clipboard_set" to obj("text" to "text"),
            "system/open_intent" to obj("url" to "https://example.org/"), "attention/ring" to JSONObject(),
            "productivity/notify" to obj("message" to "text", "purpose" to "test"),
            "productivity/timer_start" to JSONObject()).forEach { (key, args) ->
            expectCode("foreground_required") { tools.execute(call(key, args)) }
        }
        assertNull(tools.attention())
        expectCode("not_found") { tools.execute(call("system/exec_shell")) }
        expectCode("not_found") { tools.execute(call("attention/stop")) }
        assertTrue(tools.execute(call("system/accessibility_status")).get("enabled") is Boolean)
    }

    private fun requireNotifications() {
        assumeTrue("Requires enabled notifications on the test device", manager.areNotificationsEnabled())
        if (Build.VERSION.SDK_INT >= 26)
            assumeTrue(manager.getNotificationChannel(DeviceToolsNotifications.CHANNEL)?.importance != NotificationManager.IMPORTANCE_NONE)
    }

    @Test fun handoffUsesOnlyViewAndNeverPassesCallerControlledIntentFields() {
        var opened: Intent? = null
        val handlerContext = object : ContextWrapper(context) {
            override fun startActivity(intent: Intent) { opened = intent }
        }
        val handler = DeviceTools(handlerContext, store, { true }, {})
        try {
            val url = "https://example.org/index"
            assertEquals("handed_off", handler.execute(call("system/open_intent", obj("url" to url))).getString("status"))
            val intent = checkNotNull(opened)
            assertEquals(Intent.ACTION_VIEW, intent.action)
            assertEquals(url, intent.dataString)
            assertTrue(intent.hasCategory(Intent.CATEGORY_BROWSABLE))
            assertNull(intent.component)
            assertNull(intent.extras)
            assertEquals(Intent.FLAG_ACTIVITY_NEW_TASK, intent.flags)
            opened = null
            expectCode("invalid_argument") { handler.execute(call("system/open_intent", obj("url" to "intent://open"))) }
            assertNull(opened)
        } finally { handler.close() }
    }

    @Test fun missingNotificationPermissionLeavesTimerStoreEmpty() {
        assumeTrue(Build.VERSION.SDK_INT >= 33)
        val denied = object : ContextWrapper(context) {
            override fun checkSelfPermission(permission: String): Int =
                if (permission == Manifest.permission.POST_NOTIFICATIONS) PackageManager.PERMISSION_DENIED
                else super.checkSelfPermission(permission)
        }
        val handler = DeviceTools(denied, store, { true }, {})
        try {
            val args = obj("purpose" to "test", "firesAt" to NativeJson.now(System.currentTimeMillis() + 60000))
            expectCode("timer_unavailable") { handler.execute(call("productivity/timer_start", args)) }
            expectCode("notification_unavailable") {
                handler.execute(call("productivity/notify", obj("purpose" to "test", "message" to "hello")))
            }
            assertEquals("permission_required", handler.notifyInbox("inbox_" + "a".repeat(64)).getString("status"))
            assertTrue(store.listActiveTimers().isEmpty())
        } finally { handler.close() }
    }

    @Test fun timerReplaysWithSameIdAndOnlyOwnerOrLocalUserMayCancel() {
        requireNotifications()
        val start = call("productivity/timer_start", obj("firesAt" to NativeJson.now(System.currentTimeMillis() + 120000),
            "purpose" to "Private purpose"))
        val first = tools.execute(start)
        val id = first.getString("timerId")
        val ref = obj("timerId" to id)
        try {
            assertEquals("timer_" + NativeJson.digest(start.id), id)
            assertEquals(first.toString(), tools.execute(start).toString())
            val row = store.getTimerForOwner(id, "one")!!
            assertFalse(row.toString().contains("Private purpose"))
            assertEquals(1, store.listActiveTimers().size)
            for (tool in listOf("timer_cancel", "timer_status"))
                expectCode("not_found") { tools.execute(call("productivity/$tool", ref, "other")) }
            assertEquals("scheduled", tools.execute(call("productivity/timer_status", ref)).getString("state"))
            tools.localCancelTimer(id)
            assertEquals("cancelled", tools.execute(call("productivity/timer_cancel", ref)).getString("state"))
            assertEquals("not_pending", tools.execute(call("productivity/timer_status", ref)).getString("scheduling"))
            expectCode("timer_schedule_status_unknown") { tools.execute(start) }
        } finally { tools.execute(call("productivity/timer_cancel", ref)) }
    }

    @Test fun ringReturnsARealSessionAndAbortReleasesItsChannels() {
        val request = call("attention/ring", obj("durationSeconds" to 5, "vibrate" to false))
        val started = tools.execute(request)
        assertEquals("requested", started.getJSONObject("channels").getJSONObject("sound").getString("status"))
        assertEquals(started.getString("sessionId"), tools.attention()?.getString("sessionId"))
        expectCode("not_found") { tools.execute(call("attention/stop", obj("sessionId" to "other"))) }
        expectCode("attention_active") { tools.execute(call("attention/ring")) }
        request.signal.cancel()
        assertNull(tools.attention())
        tools.execute(call("attention/ring"))
        tools.localStopAttention()
        assertNull(tools.attention())
    }

    private fun awaitNotification(tag: String): Notification {
        val deadline = SystemClock.elapsedRealtime() + 3000
        do {
            manager.activeNotifications.find { it.tag == tag }?.let { return it.notification }
            SystemClock.sleep(25)
        } while (SystemClock.elapsedRealtime() < deadline)
        throw AssertionError("系统没有可观察到的测试通知")
    }

    @Test fun dueAlarmUsesDurableStateAndCanOnlyPostOnce() {
        requireNotifications()
        // Complete startup recovery before seeding an already-due record.
        tools.close()
        val command = UUID.randomUUID().toString()
        val digest = NativeJson.digest(command)
        val id = "timer_$digest"
        val notice = "tb_local_timer_$digest"
        val past = NativeJson.now(System.currentTimeMillis() - 1000)
        val row = obj("timerId" to id, "sourceCommandId" to command, "ownerSubjectId" to "one",
            "notificationId" to notice, "firesAt" to past, "now" to past)
        store.reserveTimer(row, 32, 8)
        assertTrue(store.markTimerState(id, listOf("preparing"), "scheduled", past))
        NativeDatabase(files).use { helper ->
            helper.writableDatabase.execSQL(
                "INSERT INTO commands(command_id,path,tool,status,received_at) VALUES(?,?,?,'succeeded',?)",
                arrayOf(command, "phone/productivity", "timer_start", past))
        }

        try {
            // Reopen SQLite as a receiver started in a fresh process would.
            NativeStore(files).use { reopened ->
                val timers = DeviceToolsTimers(context, reopened, DeviceToolsNotifications(context))
                timers.receive(id)
                val notification = awaitNotification(notice)
                assertEquals("Agent 计时器已到期", notification.extras.getCharSequence(Notification.EXTRA_TEXT))
                assertEquals("deadline_elapsed", store.getTimerForOwner(id, "one")?.getString("state"))
                timers.control(call("productivity/timer_cancel", obj("timerId" to id)))
                timers.receive(id)
                assertEquals("cancelled", reopened.getTimerForOwner(id, "one")?.getString("state"))
                assertTrue(reopened.listActiveTimers().isEmpty())
            }
        } finally { manager.cancel(notice, 1) }
    }

    @Test fun ordinaryAndInboxNotificationsUseStableTagsAndFixedCopy() {
        requireNotifications()
        val notice = call("productivity/notify", obj("purpose" to "private", "message" to " hello "))
        val digest = NativeJson.digest(notice.id)
        val direct = "tb_local_notify_$digest"
        val inbox = "tb_local_inbox_$digest"
        try {
            assertEquals(direct, tools.execute(notice).getString("notificationId"))
            assertEquals(inbox, tools.notifyInbox("inbox_$digest").getString("notificationId"))
            assertEquals("Agent 通知：hello", awaitNotification(direct).extras.getCharSequence(Notification.EXTRA_TEXT))
            assertEquals("收到一条 Agent 来信，请在 App 内查看。", awaitNotification(inbox).extras.getCharSequence(Notification.EXTRA_TEXT))
        } finally { manager.cancel(direct, 1); manager.cancel(inbox, 1) }
    }
}

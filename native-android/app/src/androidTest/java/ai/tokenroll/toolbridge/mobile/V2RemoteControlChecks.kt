package ai.tokenroll.toolbridge.mobile

import android.accessibilityservice.AccessibilityService
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.os.ResultReceiver
import android.os.SystemClock
import org.json.JSONObject
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.TimeUnit

/** Exercises the wire entry point against the live accessibility service in the isolated AVD. */
internal class V2RemoteControlChecks(
    private val context: Context,
    private val fixturePackage: String,
    private val invoke: (String, JSONObject, String) -> JSONObject,
) {
    private val owner = "notes-tester"
    private val catalog by lazy { CommandCatalog(context, { true }, { JSONObject() }) }

    private fun call(tool: String, args: JSONObject = version()) = invoke(tool, args, owner)
    private fun version() = JSONObject().put("v", 2)
    private fun checkedCall(tool: String, args: JSONObject = version(), caller: String = owner): JSONObject {
        val command = catalog.resolve("control/$tool")
        catalog.validate(command, args)
        return invoke(tool, args, caller).also { catalog.validate(command, it, output = true) }
    }
    private fun full(): JSONObject = call("observe").also {
        check(it.getInt("v") == 2 && it.getString("kind") == "full")
        val window = it.getJSONObject("window")
        check(window.getString("app") == fixturePackage)
        check(window.getString("boundsSpace") == "window_normalized_1000")
    }

    private fun JSONObject.rows(key: String): List<JSONObject> {
        val rows = getJSONArray(key)
        return List(rows.length()) { rows.getJSONObject(it) }
    }

    private fun JSONObject.named(name: String): JSONObject =
        rows("items").singleOrNull { it.getString("name") == name } ?: error("缺少唯一控件：$name；可见项目 " + rows("items").take(30).map { it.optString("role") + "/" + it.optString("name") })

    private fun action(frame: JSONObject, row: JSONObject): JSONObject = version()
        .put("snapshot", frame.getString("snapshot"))
        .put("target", JSONObject().put("ref", row.getString("ref")).put("region", row.getString("region")))

    private fun expectVisible(role: String, name: String) = JSONObject()
        .put("visible", JSONObject().put("role", role).put("name", name))

    private fun receipt(result: JSONObject, dispatch: String, vararg outcomes: String) {
        check(result.getInt("v") == 2 && result.getString("dispatch") == dispatch &&
            result.getString("outcome") in outcomes) {
            "期望 $dispatch / ${outcomes.joinToString()}，收到 ${result.optString("dispatch")} / ${result.optString("outcome")}"
        }
    }

    private fun awaitScreen(name: String): JSONObject {
        val until = SystemClock.elapsedRealtime() + 4000
        var frame = full()
        while (frame.rows("items").none { it.optString("name") == name } && SystemClock.elapsedRealtime() < until) {
            SystemClock.sleep(100)
            frame = full()
        }
        return frame
    }

    fun noteRef(): JSONObject = awaitScreen("保存便签").let { action(it, it.named("保存便签")) }

    private fun reject(tool: String, args: JSONObject, caller: String) {
        try {
            invoke(tool, args, caller)
        } catch (failure: WireFailure) {
            check(failure.localCode == "permission_denied") { "$tool 回报 ${failure.localCode}" }
            return
        }
        error("$tool 应拒绝越权请求")
    }

    fun denied(old: JSONObject? = null, caller: String = owner) {
        reject("observe", version(), caller)
        if (old != null) reject("tap", old, caller)
    }

    private fun openRequest(session: String) = version().put("session", session).put("app", fixturePackage)

    fun rejectOldSession(session: String) = reject("open_app", openRequest(session), owner)

    private fun supported(status: JSONObject): Set<String> = status.getJSONArray("supported").let { tools ->
        (0 until tools.length()).map { tools.getString(it) }.toSet()
    }

    fun appsDenied(state: String, session: String = "no-grant", caller: String = owner) {
        val status = checkedCall("status", caller = caller)
        check(status.getString("state") == state)
        check(supported(status).intersect(setOf("apps", "open_app")).isEmpty())
        if (state == "ready") {
            check(status.getString("mode") == "selected_timed" && status.getLong("remainingMs") > 0)
        } else {
            check(!status.has("app") && !status.has("mode") && status.getLong("remainingMs") == 0L)
        }
        reject("apps", version(), caller)
        reject("open_app", openRequest(session), caller)
    }

    fun openListedNotes(): String {
        val allowed = PhoneControlService.allowedApps(context).keys
        val first = checkedCall("apps")
        val session = first.getString("session")

        val listed = mutableListOf<String>()
        var request = version().put("limit", 1)
        do {
            val page = checkedCall("apps", request)
            check(page.getString("session") == session)
            val row = page.rows("apps").single()
            val app = row.getString("app")
            check(app in allowed && (listed.isEmpty() || listed.last() < app)) { "应用越界、重复或乱序" }
            if (app == fixturePackage) check(row.getString("label") == "远控测试便签")
            listed += app
            val cursor = page.optJSONObject("nextCursor") ?: break
            check(cursor.getString("session") == session && cursor.getString("after") == app)
            request = version().put("limit", 1).put("cursor", cursor)
        } while (true)
        check(fixturePackage in listed && context.packageName !in listed)
        check(first.rows("apps").map { it.getString("app") } == listed.take(16))
        appsDenied("session_in_use", session, "other-caller")
        reject("open_app", openRequest(session).put("app", context.packageName), owner)
        val result = checkedCall("open_app", openRequest(session))
        check(result.getString("app") == fixturePackage && result.getString("dispatch") == "sent")
        return session
    }

    fun unlimitedReady(session: String) {
        check(RemoteSession.active && RemoteSession.unlimited && RemoteSession.expiresAt == null)
        val status = checkedCall("status")
        check(status.getString("state") == "ready" && status.getString("app") == fixturePackage)
        check(supported(status).containsAll(listOf("apps", "open_app")))
        check(status.getString("mode") == "all_apps_until_stopped" && status.get("remainingMs") === JSONObject.NULL)
        check(checkedCall("apps").getString("session") == session)
    }

    fun previousGrant(old: JSONObject) {
        try {
            call("tap", old)
        } catch (failure: WireFailure) {
            check(failure.localCode == "permission_denied") { "跨授权的引用返回 ${failure.localCode}" }
            return
        }
        error("旧授权引用未被拒绝")
    }

    fun lockIsolatedAvd(onMain: (() -> Unit) -> Unit): JSONObject {
        val old = noteRef()
        // The runner restricts this system lock action to its disposable AVD.
        onMain {
            check(checkNotNull(RemoteSession.service).performGlobalAction(AccessibilityService.GLOBAL_ACTION_LOCK_SCREEN)) {
                "模拟器未接受系统锁屏"
            }
        }
        val deadline = SystemClock.elapsedRealtime() + 10_000
        while (RemoteSession.unlocked(context) || RemoteSession.packages.isNotEmpty()) {
            check(SystemClock.elapsedRealtime() < deadline) { "熄屏后未撤销本机授权" }
            SystemClock.sleep(50)
        }
        denied(old)
        return old
    }

    private fun exchange(send: (ResultReceiver) -> Unit): Bundle {
        val replies = ArrayBlockingQueue<Bundle>(1)
        val receiver = object : ResultReceiver(null) {
            override fun onReceiveResult(resultCode: Int, resultData: Bundle) {
                replies.offer(resultData)
            }
        }
        send(V2FeedFixture.transport(receiver))
        return checkNotNull(replies.poll(5, TimeUnit.SECONDS)) { "动态页未确认" }
    }

    fun feed(awaitFixtureWindow: () -> Unit, awaitControlWindow: () -> Unit) {
        val connected = exchange { reply ->
            context.startActivity(Intent().setComponent(ComponentName(fixturePackage, ControlTargetActivity::class.java.name))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_MULTIPLE_TASK)
                .putExtra(V2FeedFixture.CHANNEL, reply))
        }
        val fixture = checkNotNull(connected.getParcelable<ResultReceiver>(V2FeedFixture.CHANNEL))
        fun command(op: String) = exchange { reply ->
            fixture.send(0, Bundle().apply {
                putString("op", op)
                putParcelable(V2FeedFixture.CHANNEL, reply)
            })
        }

        try {
            awaitFixtureWindow()
            checkRepeatedTaps(::command)
            checkAmbiguityAndReuse(::command)
            checkEvidenceAndMedia(::command)
            checkRightScroll(::command)
            checkWindowLoss()
            awaitControlWindow()
            check(command("read").getInt("closeClicks") == 1) { "返回按钮未恰好触发一次" }
        } finally {
            command("finish")
        }
    }

    private fun checkRepeatedTaps(command: (String) -> Bundle) {
        val initial = awaitScreen(V2FeedFixture.TARGET)
        val region = initial.named(V2FeedFixture.TARGET).getString("region")
        val leftRegion = initial.named("关注更新").getString("region")
        check(region != leftRegion) { "左右两栏未分开" }
        val receiptRole = initial.named("已收藏 0").getString("role")
        val scoped = call("observe", version().put("region", region))
        check(scoped.rows("items").all { it.getString("region") == region })
        scoped.named(V2FeedFixture.TARGET)

        var previous = command("read")
        // A new view occupies a different slot after each observation. Never retry an action.
        repeat(20) { round ->
            val frame = full()
            val request = action(frame, frame.named(V2FeedFixture.TARGET))
                .put("expect", expectVisible(receiptRole, "已收藏 ${round + 1}")).put("waitMs", 1800)
            val changed = command("rebuild")
            check(changed.getInt("generation") == previous.getInt("generation") + 1)
            check(changed.getInt("revision") > previous.getInt("revision"))
            previous = changed
            val result = call("tap", request)
            receipt(result, "sent", "verified")
            val state = command("read")
            check(state.getInt("clicks") == round + 1 && state.getInt("otherClicks") == 0) {
                "第 ${round + 1} 次请求的实际点击计数不符"
            }
        }
    }

    private fun checkAmbiguityAndReuse(command: (String) -> Bundle) {
        val before = full()
        val row = before.named(V2FeedFixture.TARGET)
        val region = row.getString("region")
        val leftRegion = before.named("关注更新").getString("region")
        denied(action(before, row), "other-caller")
        val wrongRegion = action(before, row)
        wrongRegion.getJSONObject("target").put("region", leftRegion)
        receipt(call("tap", wrongRegion), "not_sent", "target_missing", "ambiguous_target", "stale_snapshot")

        // A previously unique ref now matches two indistinguishable, reordered cards.
        command("twins")
        receipt(call("tap", action(before, row)), "not_sent", "ambiguous_target")
        val twins = full()
        val copies = twins.rows("items").filter { it.getString("name") == V2FeedFixture.TARGET }
        check(copies.size == 2 && copies.all { it.getString("region") == region })
        val selector = JSONObject().put("region", region).put("role", row.getString("role"))
            .put("name", V2FeedFixture.TARGET)
        command("twins")
        receipt(call("tap", version().put("snapshot", twins.getString("snapshot")).put("target", selector)),
            "not_sent", "ambiguous_target")

        command("rebuild")
        val original = full()
        val oldCard = action(original, original.named(V2FeedFixture.TARGET))
        val oldLater = action(original, original.named("稍后再看"))
        command("rebind")
        receipt(call("tap", oldLater), "not_sent", "target_missing", "ambiguous_target", "stale_snapshot")
        receipt(call("tap", oldCard), "not_sent", "target_missing", "ambiguous_target")
        val delta = call("observe", version().put("since", original.getString("snapshot")))
        check(delta.getString("kind") == "delta" && delta.getString("base") == original.getString("snapshot"))
        check(delta.rows("items").any { it.getString("name") == "收藏 · 新到站的视频" })
        // Pair the removed item's ref with the new snapshot. It must not resolve to the replacement.
        receipt(call("tap", JSONObject(oldCard.toString()).put("snapshot", delta.getString("snapshot"))),
            "not_sent", "stale_snapshot", "target_missing")
        check(command("read").let { it.getInt("clicks") == 20 && it.getInt("otherClicks") == 0 })
    }

    private fun checkEvidenceAndMedia(command: (String) -> Bundle) {
        command("rebuild")
        val unverified = full()
        val receiptRole = unverified.named("已收藏 20").getString("role")
        val impossible = action(unverified, unverified.named(V2FeedFixture.TARGET))
            .put("expect", expectVisible(receiptRole, "不会出现的收藏结果")).put("waitMs", 500)
        receipt(call("tap", impossible), "sent", "not_verified")
        check(command("read").let { it.getInt("clicks") == 21 && it.getInt("otherClicks") == 0 })

        val player = full()
        val play = player.named("播放")
        receipt(call("media", action(player, play).put("operation", "play")
            .put("expect", expectVisible(play.getString("role"), "暂停")).put("waitMs", 1500)), "sent", "verified")
        for (tool in listOf("back", "media")) {
            val wrong = full()
            val request = action(wrong, wrong.named(V2FeedFixture.TARGET))
            if (tool == "media") request.put("operation", "pause")
            receipt(call(tool, request), "not_sent", "unsupported")
        }
    }

    private fun checkRightScroll(command: (String) -> Bundle) {
        val scroll = full()
        val region = scroll.named(V2FeedFixture.TARGET).getString("region")
        val right = scroll.rows("items").single {
            it.getString("region") == region && it.getJSONArray("actions").let { actions ->
                (0 until actions.length()).any { i -> actions.getString(i) == "scroll_forward" }
            }
        }
        val positions = command("read")
        receipt(call("scroll", action(scroll, right).put("direction", "forward")
            .put("expect", JSONObject().put("regionChanged", region)).put("waitMs", 1800)), "sent", "verified")
        val end = SystemClock.elapsedRealtime() + 2500
        while (command("read").getInt("rightY") == positions.getInt("rightY")) {
            check(SystemClock.elapsedRealtime() < end) { "右栏未滚动" }
            SystemClock.sleep(40)
        }
        check(command("read").let { it.getInt("rightY") > positions.getInt("rightY") &&
            it.getInt("leftY") == positions.getInt("leftY") && it.getInt("clicks") == 21 && it.getInt("otherClicks") == 0 })
    }

    private fun checkWindowLoss() {
        val closing = full()
        val receiptRole = closing.named("关注更新").getString("role")
        val result = call("back", action(closing, closing.named(V2FeedFixture.LEAVE))
            .put("expect", expectVisible(receiptRole, "不会出现的返回结果")).put("waitMs", 1800))
        check(result.getString("dispatch") in setOf("sent", "unknown"))
        check(result.getString("outcome") == "result_unknown" && !result.has("changes") && !result.has("evidence")) {
            "返回未授权窗口后仍报告了窗口证据"
        }
    }
}

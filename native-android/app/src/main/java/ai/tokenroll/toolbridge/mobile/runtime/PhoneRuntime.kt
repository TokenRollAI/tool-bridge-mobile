package ai.tokenroll.toolbridge.mobile

import android.app.Activity
import android.app.AlertDialog
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.BatteryManager
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.os.SystemClock
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import org.json.JSONArray
import org.json.JSONObject

class PhoneRuntime(private val ctx: Context) {
    private val main = Handler(Looper.getMainLooper())
    private val worker = Executors.newSingleThreadExecutor()
    private val inboxWorker = Executors.newSingleThreadExecutor()
    val store = NativeStore(ctx)
    private val credentials = CredentialStore(ctx)
    private val history = CommandHistory(ctx)
    @Volatile var activity: Activity? = null
    var refreshed: (() -> Unit)? = null
    @Volatile private var foreground = false
    @Volatile private var background = false
    @Volatile private var ready = false
    @Volatile private var connectedState = GatewayState.SUSPENDED
    @Volatile private var current: GatewayCredential? = null
    @Volatile private var mode = "ask_every_time"
    private var gateway: GatewayConnection? = null
    private var mailbox: GatewayMailbox? = null
    private var generation = 0L
    private val tools = DeviceTools(ctx, store, { foreground }, ::refresh)
    private val sensors = SensorMedia(ctx, { activity }, { mode == "direct_call" }, ::refresh)
    private val catalog = CommandCatalog(ctx, ::supported, ::probe)
    private val active = ConcurrentHashMap<String, WireCall>()
    private val admissions = mutableMapOf<String, ArrayDeque<Pair<String, Long>>>()
    private val promptGate = java.util.concurrent.Semaphore(1)
    @Volatile private var snapshot = obj("phase" to "loading","transportState" to "unconfigured")
    private var search = ""
    private var sort = "received_desc"
    private var unread = false
    @Volatile private var installation = ""
    @Volatile private var defaultDevice = ""

    fun initialize() {
        RemoteSession.onChange = {
            if (RemoteSession.active) ConnectionService.start(ctx)
            else {
                active.values.filter { it.path == "phone/control" }.forEach { it.signal.cancel() }
                ConnectionService.updateIfRunning()
            }
            worker.execute { syncTransport(); refreshNow() }
        }
        worker.execute {
            try {
                installation = credentials.installationId()
                defaultDevice = credentials.defaultDeviceId()
                mode = store.controlMode()
                background = store.backgroundRuntimeEnabled()
                setup()
                ready = true
                refreshNow()
            } catch (_: Exception) {
                snapshot = obj("phase" to "error","error" to "无法读取本机配置或数据库")
                notifyUi()
            }
        }
    }

    private fun supported(key: String): Boolean = when {
        key == "control/screenshot" -> android.os.Build.VERSION.SDK_INT >= 34
        key.startsWith("media/") -> BuildConfig.MEDIA_HOSTS.isNotBlank()
        key.startsWith("apps/") -> BuildConfig.LINK_HOSTS.isNotBlank()
        else -> true
    }
    private fun probe(key: String): JSONObject {
        val unavailable = { reason: String -> obj("status" to "unavailable", "reason" to reason) }
        val required = { perm: String, reason: String -> obj("status" to "permission_required", "permission" to perm, "reason" to reason) }
        return when {
            key == "control/status" -> obj("status" to "available")
            key.startsWith("control/") && RemoteSession.service == null -> required("accessibility", "accessibility_disabled")
            key.startsWith("control/") && !RemoteSession.active -> unavailable("local_session_required")
            key in setOf("control/apps", "control/open_app") && !RemoteSession.unlimited -> unavailable("all_apps_session_required")
            key == "camera/capture_photo" && ctx.checkSelfPermission(android.Manifest.permission.CAMERA) != android.content.pm.PackageManager.PERMISSION_GRANTED ->
                required("camera","camera_permission_required")
            key == "productivity/notify" && !ctx.getSystemService(android.app.NotificationManager::class.java).areNotificationsEnabled() ->
                unavailable("notification_permission_requestable")
            key == "location/current" && ctx.checkSelfPermission(android.Manifest.permission.ACCESS_COARSE_LOCATION) != android.content.pm.PackageManager.PERMISSION_GRANTED ->
                required("location","foreground_location_required")
            (key.startsWith("media/") || key.startsWith("apps/") || key.startsWith("camera/") || key.startsWith("location/")) && !sensors.available(key) ->
                unavailable("platform_unavailable")
            (key.startsWith("attention/") || key.startsWith("productivity/") || key.startsWith("system/")) && !tools.available(key) ->
                unavailable("platform_unavailable")
            else -> obj("status" to "available")
        }
    }
    fun backgroundEnabled() = background && mode != "disabled"
    fun readyForControl() = ready && connectedState == GatewayState.READY && mode != "disabled"
    fun state() = snapshot
    fun message(id: String) = store.getInbox(id)
    fun refresh() { worker.execute { if (ready) refreshNow() } }
    private fun notifyUi() = main.post { refreshed?.invoke() }
    private fun refreshNow() {
        val g = current
        val wire = if (g == null) "unconfigured" else connectedState.name.lowercase()
        val reach = if (wire == "ready") "online" else if (g == null) "unconfigured" else "offline"
        snapshot = obj("phase" to "ready","appState" to if (foreground) "active" else "background",
            "controlMode" to mode, "backgroundRuntimeEnabled" to background, "defaultDeviceId" to defaultDevice,
            "deviceId" to g?.deviceId, "gatewayOrigin" to g?.audienceOrigin, "installationId" to installation,
            "mountPath" to gateway?.mountPath, "transportState" to wire, "reachability" to reach,
            "inboxMessages" to JSONArray(store.listInbox(search,sort,unread)), "inboxUnreadCount" to store.countUnread(),
            "inboxViewOptions" to obj("searchQuery" to search,"sort" to sort,"unreadOnly" to unread),
            "timers" to JSONArray(store.listActiveTimers()), "auditRecords" to JSONArray(store.listAudit()),
            "capabilities" to catalog.snapshots(mode,foreground,true), "attentionSession" to tools.attention(),
            "mediaSession" to sensors.session(), "pendingConfirmations" to JSONArray())
        notifyUi()
    }
    private fun setup() {
        val epoch = ++generation
        gateway?.close(); mailbox?.close()
        gateway = null; mailbox = null; connectedState = GatewayState.SUSPENDED
        val g = credentials.getCredential()
        current = g
        if (g == null) return
        val device = WireDevice(g.audienceOrigin,g.deviceId, {
            credentials.getCredential()?.let { WireCredential(it.audienceOrigin,it.deviceId,it.keyId,it.material) }
        }, catalog::nodes, ::execute, onCredentialInvalid = { rejected ->
            worker.execute {
                if (epoch == generation && credentials.clearCredentialIfMatches(rejected.audienceOrigin,rejected.deviceId,rejected.keyId,rejected.material)) {
                    main.post { RemoteSession.stop() }
                    setup(); refreshNow()
                }
            }
        })
        mailbox = GatewayMailbox(device,WireJournal(store::getJournal,store::putJournal,store::removeJournal))
        gateway = GatewayConnection(device, onState = { state -> worker.execute {
            if (epoch == generation) {
                val lost = connectedState == GatewayState.READY && state != GatewayState.READY
                connectedState = state
                if (lost) main.post { if (RemoteSession.active) RemoteSession.stop() }
                if (state == GatewayState.READY && foreground) drain()
                refreshNow()
            }
        } })
        syncTransport()
    }
    private fun syncTransport() {
        val enabled = mode != "disabled" && (foreground || background || RemoteSession.active)
        gateway?.setEnabled(enabled)
        if (!foreground || !enabled) mailbox?.cancel()
    }
    private fun drain() {
        val m = mailbox ?: return
        inboxWorker.execute { if (m === mailbox && foreground && mode != "disabled") runCatching { m.drain() } }
    }
    fun setForeground(value: Boolean) {
        foreground = value
        if (!value) sensors.pauseSensitive()
        if (value && backgroundEnabled()) ConnectionService.start(ctx)
        worker.execute {
            if (ready) { syncTransport(); if (value && connectedState == GatewayState.READY) drain(); refreshNow() }
        }
    }

    private fun confirm(c: PhoneCommand, call: WireCall) {
        if (!c.prompt(mode,foreground)) return
        val host = activity ?: throw WireFailure("confirmation_required","请在手机前台确认此操作")
        if (!promptGate.tryAcquire()) throw WireFailure("unavailable","手机正在处理另一次确认")
        val latch = CountDownLatch(1)
        var allow = false
        var dialog: AlertDialog? = null
        val sub = call.signal.onCancel { latch.countDown() }
        try {
            main.post {
                if (latch.count == 0L || host !== activity || host.isFinishing || mode == "disabled") {
                    latch.countDown(); return@post
                }
                dialog = AlertDialog.Builder(host).setTitle(c.description)
                    .setMessage("请求来自 " + call.callerDisplayName)
                    .setNegativeButton("拒绝") { _,_ -> latch.countDown() }
                    .setPositiveButton("允许一次") { _,_ -> allow = true; latch.countDown() }
                    .setOnCancelListener { latch.countDown() }.show()
            }
            val approved = latch.await((call.expiresAtMs-System.currentTimeMillis()).coerceIn(0,120000), TimeUnit.MILLISECONDS)
            call.checkActive()
            if (!approved || !allow || !foreground) throw WireFailure("permission_denied","设备没有批准此操作")
        } finally {
            latch.countDown(); main.post { dialog?.dismiss() }; sub.close(); promptGate.release()
        }
    }
    private fun admit(c: PhoneCommand, caller: String) = synchronized(admissions) {
        val now = SystemClock.elapsedRealtime()
        val calls = admissions.getOrPut(c.key) { ArrayDeque() }
        while (calls.isNotEmpty() && now-calls.first().second >= c.windowMs) calls.removeFirst()
        if (calls.size >= c.globalRate || calls.count { it.first == caller } >= c.callerRate)
            throw WireFailure("rate_limited","调用次数过多",true)
        calls.addLast(caller to now)
    }
    private fun execute(call: WireCall): JSONObject {
        call.checkActive()
        if (mode == "disabled") throw WireFailure("disabled","手机已停用远程调用")
        val credential = current ?: throw WireFailure("permission_denied","网关已断开")
        val principal = NativeJson.digest(org.json.JSONArray(listOf(credential.audienceOrigin, credential.keyId, call.callerSubjectId)).toString())
        val key = call.path.removePrefix("phone/") + "/" + call.tool
        val c = catalog.resolve(key)
        if (call.delivery != "realtime" && key != "inbox/deliver") throw WireFailure("permission_denied","仅允许实时操作")
        catalog.validate(c,call.arguments)
        if (active.putIfAbsent(call.id,call) != null) throw WireFailure("result_unknown","命令已在执行")
        var reserved = false
        var result: JSONObject? = null
        var err: WireFailure? = null
        try {
            history.claim(call,principal)?.let { return it }
            reserved = true
            admit(c,call.callerSubjectId)
            confirm(c,call)
            call.checkActive()
            if (mode == "disabled") throw WireFailure("disabled","手机已停用远程调用")
            val out = when {
                key.startsWith("control/") -> RemoteSession.invoke(call)
                key == "status/get" -> phoneStatus()
                key == "inbox/deliver" -> deliver(call)
                key == "runtime/capabilities" -> obj("capabilities" to catalog.snapshots(mode,foreground,false),"observedAt" to NativeJson.now())
                key == "runtime/pending_commands" -> obj("identityScope" to "gateway_credential_principal","commands" to JSONArray(active.values
                    .filter { it.id != call.id && it.callerSubjectId == call.callerSubjectId }.map {
                    obj("commandId" to it.id,"createdAt" to NativeJson.now(it.createdAtMs),"expiresAt" to NativeJson.now(it.expiresAtMs),
                        "path" to it.path,"tool" to it.tool,"state" to "active") }))
                key == "runtime/cancel" -> {
                    val id = call.arguments.getString("commandId")
                    val target = active[id]?.takeIf { it !== call && it.callerSubjectId == call.callerSubjectId }
                    target?.signal?.cancel()
                    obj("commandId" to id,"status" to if (target != null) "cancellation_requested" else "not_active")
                }
                key.startsWith("productivity/") || key.startsWith("attention/") || key.startsWith("system/") -> tools.execute(call)
                else -> sensors.execute(call)
            }
            catalog.validate(c,out,true)
            result = out
            return out
        } catch (e: Exception) {
            err = e.safeFailure(call.signal); throw err
        } finally {
            try {
                if (reserved) {
                    history.complete(call,result,err)
                    store.addAudit(obj("id" to UUID.randomUUID().toString(),"commandId" to call.id,"occurredAt" to NativeJson.now(),
                        "callerSubjectId" to call.callerSubjectId,"path" to call.path,"tool" to call.tool,"effect" to c.effect,"risk" to c.risk,
                        "decision" to if (err == null) "allowed" else "rejected","outcomeCode" to (err?.localCode ?: "ok"),
                        "clientVersion" to BuildConfig.VERSION_NAME))
                    store.pruneAudit(1000)
                }
            } finally { active.remove(call.id,call); refresh() }
        }
    }

    private fun deliver(call: WireCall): JSONObject {
        val args = call.arguments
        val id = "inbox_" + NativeJson.digest(call.id)
        val title = args.getString("title").trim()
        val body = args.getString("body").replace("\r\n","\n").replace('\r','\n').trim()
        val invalidTitle = Regex("[\\p{Cc}\\u202a-\\u202e\\u2066-\\u2069]")
        if (title.isEmpty() || body.isEmpty() || invalidTitle.containsMatchIn(title) ||
            invalidTitle.containsMatchIn(body.replace("\n","")) || invalidTitle.containsMatchIn(args.optString("sourceLabel")))
            throw WireFailure("invalid_argument","消息内容无效")
        val message = obj("messageId" to id,"sourceCommandId" to call.id,"callerSubjectId" to call.callerSubjectId,
            "callerDisplayName" to call.callerDisplayName,"title" to title,"body" to body,"category" to args.optString("category","message"),
            "format" to "markdown","urgency" to args.optString("urgency","normal"),"receivedAt" to NativeJson.now(),
            "sourceLabel" to args.opt("sourceLabel"),"sentAt" to args.opt("sentAt"))
        val saved = store.addInbox(message)
        val notice = if (args.optBoolean("notify")) tools.notifyInbox(id) else obj("status" to "not_requested")
        return obj("messageId" to saved.getString("messageId"),"receivedAt" to saved.getString("receivedAt"),
            "status" to "stored","notification" to notice)
    }

    private fun phoneStatus(): JSONObject {
        val battery = ctx.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
        val level = battery?.getIntExtra(BatteryManager.EXTRA_LEVEL,-1) ?: -1
        val scale = battery?.getIntExtra(BatteryManager.EXTRA_SCALE,0) ?: 0
        val b = if (level >= 0 && scale > 0) obj("availability" to "available","value" to obj("level" to level.toDouble()/scale,
            "charging" to (battery?.getIntExtra(BatteryManager.EXTRA_PLUGGED,0) != 0),
            "lowPowerMode" to ctx.getSystemService(PowerManager::class.java).isPowerSaveMode))
        else obj("availability" to "unavailable","reason" to "battery_level_unavailable")
        val cm = ctx.getSystemService(ConnectivityManager::class.java)
        val network = cm.getNetworkCapabilities(cm.activeNetwork)
        val kind = when { network == null -> "none"; network.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) -> "wifi"
            network.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) -> "cellular"; else -> "other" }
        return obj("appState" to if (foreground) "active" else "background", "battery" to b,
            "controlMode" to mode,"installationId" to installation,"observedAt" to NativeJson.now(),"platform" to "android",
            "reachability" to if (connectedState == GatewayState.READY) "online" else "offline",
            "network" to obj("availability" to "available","value" to obj("type" to kind,
                "internetReachable" to network?.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED))))
    }

    fun action(action: NativeScreenAction, done: (Boolean) -> Unit) {
        worker.execute {
            val ok = runCatching {
                when (action) {
                    is NativeScreenAction.InboxView -> {search = action.searchQuery; sort = action.sort; unread = action.unreadOnly}
                    is NativeScreenAction.MarkRead -> store.markRead(action.messageId)
                    NativeScreenAction.MarkAllRead -> store.markAllRead()
                    NativeScreenAction.ClearInbox -> store.clearInbox()
                    NativeScreenAction.ClearActivity -> store.clearAudit()
                    is NativeScreenAction.SaveConnection -> {
                        endControl(); credentials.saveManual(action.origin,action.apiKey,action.deviceId.orEmpty()); setup()
                    }
                    NativeScreenAction.ClearConnection -> { endControl(); credentials.clearCredential(); setup() }
                    is NativeScreenAction.SetBackground -> {
                        store.setSetting("background_runtime_enabled",action.enabled.toString()); background = action.enabled
                        main.post {
                            if (backgroundEnabled() && foreground) ConnectionService.start(ctx)
                            else ConnectionService.updateIfRunning()
                        }
                        syncTransport()
                    }
                    is NativeScreenAction.SetControlMode -> {
                        require(action.mode in setOf("disabled","ask_every_time","trusted_session","direct_call"))
                        store.setSetting("control_mode",action.mode); mode = action.mode
                        if (mode == "disabled") {
                            endControl()
                            active.values.forEach { it.signal.cancel() }
                            tools.localStopAttention()
                            store.listActiveTimers().forEach { timer -> tools.localCancelTimer(timer.getString("timerId")) }
                            sensors.session()?.optString("sessionId")?.let { runCatching { sensors.localPlayback(it,"stop") } }
                            sensors.pauseSensitive()
                        }
                        syncTransport()
                    }
                    is NativeScreenAction.CancelTimer -> tools.localCancelTimer(action.timerId)
                    NativeScreenAction.StopAttention -> tools.localStopAttention()
                    is NativeScreenAction.ControlMedia -> sensors.localPlayback(action.sessionId,action.playback.name.lowercase())
                    else -> error("Unsupported local action")
                }
                refreshNow()
            }.isSuccess
            main.post { done(ok) }
        }
    }
    private fun endControl() {
        val stopped = CountDownLatch(1)
        main.post { try { RemoteSession.stop() } finally { stopped.countDown() } }
        check(stopped.await(3,TimeUnit.SECONDS))
    }
}

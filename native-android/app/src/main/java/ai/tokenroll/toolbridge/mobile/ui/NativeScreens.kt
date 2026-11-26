package ai.tokenroll.toolbridge.mobile

import android.app.Activity
import android.app.Dialog
import android.app.AlertDialog
import android.graphics.Color
import android.graphics.drawable.ColorDrawable
import android.annotation.TargetApi
import android.os.Bundle
import android.os.Parcelable
import android.os.Build
import android.os.CancellationSignal
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.WindowInsetsController
import android.window.OnBackInvokedCallback
import android.window.OnBackInvokedDispatcher
import android.view.View
import android.view.WindowInsets
import android.view.inputmethod.InputMethodManager
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.Toast
import org.json.JSONObject

internal enum class NativeRoute(val title: String) {
    INBOX("信箱"), DEVICE("设备"), MESSAGE("信箱"), CONNECTION("连接配置"),
    CONTROLS("授权与安全"), CAPABILITIES("能力"), STATUS("设备状态"), MEDIA("媒体"), ACTIVITY("活动")
}

class NativeScreens(private val activity: Activity, internal val actions: NativeScreenActions) {
    private val main = Handler(Looper.getMainLooper())
    // Only restore navigation and scroll. Credentials and article bodies never enter saved state.
    private val root: LinearLayout = object : LinearLayout(activity) {
        override fun onSaveInstanceState(): Parcelable = Bundle().apply {
            putParcelable("parent", super.onSaveInstanceState())
            putInt("listScroll", page?.takeIf { it.route == NativeRoute.INBOX }?.scroll?.scrollY
                ?: positions[NativeRoute.INBOX] ?: 0)
            currentPage?.let {
                putString("route", it.route.name)
                putString("message", it.messageId)
                putInt("scroll", it.scroll.scrollY)
            }
        }
        @Suppress("DEPRECATION")
        override fun onRestoreInstanceState(state: Parcelable?) {
            if (state !is Bundle) { super.onRestoreInstanceState(state); return }
            super.onRestoreInstanceState(state.getParcelable<Parcelable>("parent"))
            val route = NativeRoute.values().firstOrNull { it.name == state.getString("route") } ?: return
            positions[NativeRoute.INBOX] = state.getInt("listScroll")
            navigate(route, state.getString("message"))
            if (reader != null) restoreListPosition()
            currentPage?.scroll?.let { scroll -> scroll.post { scroll.scrollTo(0, state.getInt("scroll")) } }
        }
    }.apply {
        id = R.id.tb_ui_pages
        orientation = LinearLayout.VERTICAL
        gravity = Gravity.CENTER_HORIZONTAL
        isFocusableInTouchMode = true
        setOnApplyWindowInsetsListener { v, insets ->
            if (Build.VERSION.SDK_INT >= 30) {
                val edges = insets.getInsets(WindowInsets.Type.systemBars() or
                    WindowInsets.Type.displayCutout() or WindowInsets.Type.ime())
                v.setPadding(edges.left, edges.top, edges.right, edges.bottom)
            } else {
                @Suppress("DEPRECATION")
                v.setPadding(insets.systemWindowInsetLeft, insets.systemWindowInsetTop,
                    insets.systemWindowInsetRight, insets.systemWindowInsetBottom)
            }
            insets
        }
    }
    val view: View get() = root
    private var page: NativePage? = null
    private var detail: NativePage? = null
    private var reader: FrameLayout? = null
    private val currentPage get() = detail ?: page
    internal val selectedMessageId get() = detail?.messageId
    private var disposed = false
    private var unregisterBack: (() -> Unit)? = null
    private val pending = mutableSetOf<String>()
    private val positions = mutableMapOf<NativeRoute, Int>()
    internal var searchDraft: String? = null

    init {
        root.addOnAttachStateChangeListener(object : View.OnAttachStateChangeListener {
            override fun onViewAttachedToWindow(v: View) {
                val dark = page?.dark == true
                if (Build.VERSION.SDK_INT >= 30) {
                    val bars = WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS or
                        WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS
                    v.windowInsetsController?.setSystemBarsAppearance(if (dark) 0 else bars, bars)
                }
                updateSystemBack()
                v.requestApplyInsets()
            }
            override fun onViewDetachedFromWindow(v: View) {
                unregisterBack?.invoke()
                unregisterBack = null
            }
        })
        navigate(NativeRoute.INBOX)
    }

    fun showDevice() = navigate(NativeRoute.DEVICE)
    fun openMessage(messageId: String) = navigate(NativeRoute.MESSAGE, messageId)

    internal fun navigate(route: NativeRoute, id: String? = null) {
        if (disposed || (currentPage?.route == route && currentPage?.messageId == id)) return
        val paired = activity.resources.getBoolean(R.bool.inbox_two_pane) &&
            (route == NativeRoute.INBOX || route == NativeRoute.MESSAGE)
        if (paired && reader != null) {
            selectInReader(if (route == NativeRoute.MESSAGE) id else null)
            return
        }
        detail?.close()
        detail = null
        reader = null
        page?.let {
            positions[it.route] = it.scroll.scrollY
            it.close()
            if (root.windowToken != null) activity.getSystemService(InputMethodManager::class.java)
                .hideSoftInputFromWindow(root.windowToken, 0)
        }
        root.removeAllViews()
        val next = if (paired) NativePage(activity, this, NativeRoute.INBOX, null)
            else NativePage(activity, this, route, id)
        page = next
        root.setBackgroundColor(next.surface)
        if (paired) {
            val row = LinearLayout(activity)
            val listWidth = (activity.resources.configuration.screenWidthDp / 2.3).toInt().coerceIn(312, 400)
            row.addView(next.shell, LinearLayout.LayoutParams(next.dp(listWidth), FILL))
            row.addView(View(activity).apply { setBackgroundColor(next.border) }, 1, FILL)
            val frame = FrameLayout(activity)
            row.addView(frame, LinearLayout.LayoutParams(0, FILL, 1f))
            reader = frame
            root.addView(row, LinearLayout.LayoutParams(FILL, FILL))
            selectInReader(if (route == NativeRoute.MESSAGE) id else null)
        } else root.addView(next.shell, LinearLayout.LayoutParams(FILL, FILL))
        root.requestFocus()
        updateSystemBack()
        next.refresh(actions.snapshot())
        if (next.route == NativeRoute.INBOX || next.route == NativeRoute.DEVICE) {
            positions[next.route]?.let { position -> next.scroll.post { next.scroll.scrollTo(0, position) } }
        }
    }

    private fun restoreListPosition() {
        val scroll = page?.scroll ?: return
        val y = positions[NativeRoute.INBOX] ?: return
        scroll.post { scroll.scrollTo(0, y) }
    }

    private fun selectInReader(id: String?) {
        val frame = reader ?: return
        val list = page ?: return
        detail?.close()
        frame.removeAllViews()
        detail = id?.let { NativePage(activity, this, NativeRoute.MESSAGE, it, embedded = true) }
        val article = detail
        if (article == null) {
            frame.addView(list.text("选择一封消息以阅读正文", 16, list.muted),
                FrameLayout.LayoutParams(WRAP, WRAP, Gravity.CENTER))
        } else {
            frame.addView(article.shell, FrameLayout.LayoutParams(FILL, FILL, Gravity.CENTER_HORIZONTAL))
            if (root.windowToken != null) activity.getSystemService(InputMethodManager::class.java)
                .hideSoftInputFromWindow(root.windowToken, 0)
        }
        updateSystemBack()
        refresh()
    }

    fun refresh() {
        if (disposed) return
        val snapshot = actions.snapshot()
        page?.refresh(snapshot)
        detail?.refresh(snapshot)
    }

    private fun updateSystemBack() {
        unregisterBack?.invoke()
        unregisterBack = null
        if (Build.VERSION.SDK_INT >= 33 && root.isAttachedToWindow && currentPage?.route != NativeRoute.INBOX) {
            unregisterBack = registerBack()
        }
    }
    @TargetApi(33)
    private fun registerBack(): () -> Unit {
        val dispatcher = activity.onBackInvokedDispatcher
        val callback = OnBackInvokedCallback { onBackPressed() }
        dispatcher.registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT, callback)
        return { dispatcher.unregisterOnBackInvokedCallback(callback) }
    }

    fun onBackPressed(): Boolean {
        when (currentPage?.route) {
            NativeRoute.INBOX, null -> return false
            NativeRoute.MESSAGE, NativeRoute.DEVICE -> navigate(NativeRoute.INBOX)
            else -> showDevice()
        }
        return true
    }

    internal fun busy(key: String) = key in pending

    internal fun submit(origin: NativePage, action: NativeScreenAction, key: String,
                        success: String? = null, failure: String = "操作失败，请重试。",
                        finish: ((Boolean) -> Unit)? = null) {
        if (disposed || (origin !== page && origin !== detail) || !pending.add(key)) return
        val done: (Boolean) -> Unit = { ok ->
            main.post {
                if (!disposed && pending.remove(key)) {
                    if (page === origin || detail === origin) {
                        finish?.invoke(ok)
                        val feedback = if (ok) success else failure
                        if (feedback != null) Toast.makeText(activity, feedback, Toast.LENGTH_SHORT).show()
                    }
                    refresh()
                }
            }
        }
        try { actions.perform(action, done) } catch (_: Exception) { done(false) }
    }

    fun dispose() {
        disposed = true
        unregisterBack?.invoke()
        unregisterBack = null
        detail?.close()
        detail = null
        reader = null
        page?.close()
        page = null
        root.removeAllViews()
        pending.clear()
    }
}

internal class NativePage(activity: Activity, val host: NativeScreens, val route: NativeRoute,
                          val messageId: String?, private val embedded: Boolean = false) : NativeWidgets(activity) {
    val shell = object : LinearLayout(activity) {
        override fun onMeasure(w: Int, h: Int) {
            val width = minOf(MeasureSpec.getSize(w), dp(720))
            super.onMeasure(MeasureSpec.makeMeasureSpec(width, MeasureSpec.EXACTLY), h)
        }
    }.apply { orientation = LinearLayout.VERTICAL }
    val toolbar = column().apply { pad(24, 0) }
    val body = column().apply { pad(24, 20) }
    val scroll = ScrollView(activity).apply {
        isVerticalScrollBarEnabled = false
        addView(body)
    }
    private val tabs = row().apply {
        background = shape(surface, 32, true)
        pad(3)
    }
    val actions get() = host.actions
    private var dialog: Dialog? = null
    private var signature: List<String>? = null
    private var tabUnread = -1
    var markedRead = false
    var inboxTools: InboxToolbar? = null
    var connectionForm: ConnectionForm? = null
    val images = mutableListOf<CancellationSignal>()
    val topLevel = route == NativeRoute.INBOX || route == NativeRoute.DEVICE

    init {
        if (!embedded) shell.item(row().apply {
            pad(24, 10)
            if (!topLevel) {
                val target = if (route == NativeRoute.MESSAGE) "信箱" else "设备"
                addView(iconButton(R.drawable.tb_ui_back, "返回" + target) { host.onBackPressed() },
                    dp(48), dp(48))
            }
            flex(heading(route.title, if (route == NativeRoute.MESSAGE) 17 else 28))
            if (route == NativeRoute.INBOX) addView(iconButton(R.drawable.tb_ui_more, "信箱更多操作") {
                inboxMenu()
            }, dp(48), dp(48))
        })
        shell.item(toolbar)
        shell.addView(scroll, LinearLayout.LayoutParams(FILL, 0, 1f))
        if (topLevel) {
            shell.addView(tabs, LinearLayout.LayoutParams(FILL, WRAP).apply {
                setMargins(dp(24), dp(8), dp(24), dp(12))
            })
            if (Build.VERSION.SDK_INT >= 30) shell.setOnApplyWindowInsetsListener { _, insets ->
                tabs.visibility = if (insets.isVisible(WindowInsets.Type.ime())) View.GONE else View.VISIBLE
                insets
            }
        }
    }

    fun refresh(s: JSONObject) {
        val unread = s.optInt("inboxUnreadCount")
        if (topLevel && tabUnread != unread) {
            tabUnread = unread
            tabs.removeAllViews()
            tab(NativeRoute.INBOX, R.drawable.tb_ui_inbox, unread)
            tab(NativeRoute.DEVICE, R.drawable.tb_ui_device, 0)
        }
        val article = if (route == NativeRoute.MESSAGE) messageId?.let(actions::message) else null
        val values = when (route) {
            NativeRoute.INBOX -> listOf("inboxMessages", "inboxViewOptions", "inboxUnreadCount")
            NativeRoute.DEVICE -> listOf("deviceId", "defaultDeviceId", "gatewayOrigin", "transportState", "controlMode", "capabilities", "mediaSession")
            NativeRoute.CONNECTION -> listOf("controlMode", "transportState", "gatewayOrigin", "defaultDeviceId")
            NativeRoute.CONTROLS -> listOf("controlMode", "backgroundRuntimeEnabled", "capabilities")
            NativeRoute.CAPABILITIES -> listOf("capabilities")
            NativeRoute.ACTIVITY -> listOf("auditRecords")
            NativeRoute.MEDIA -> listOf("mediaSession")
            NativeRoute.STATUS -> listOf("deviceId", "mountPath", "controlMode", "transportIssue", "error",
                "transportState", "reachability", "appState", "attentionSession", "timers", "backgroundRuntimeEnabled")
            NativeRoute.MESSAGE -> emptyList()
        }.map { s.opt(it)?.toString().orEmpty() } + listOf(article?.toString().orEmpty(), if (route == NativeRoute.INBOX) host.selectedMessageId.orEmpty() else "")
        if (signature == values) return
        signature = values
        if (route == NativeRoute.CONNECTION) {
            val form = connectionForm ?: ConnectionForm(this).also { connectionForm = it }
            form.update(s)
            return
        }
        // Marking read changes the envelope, not article content or loaded previews.
        if (route == NativeRoute.MESSAGE && article != null) {
            val content = listOf("messageId", "title", "callerDisplayName", "callerSubjectId", "urgency",
                "category", "receivedAt", "sourceLabel", "body").map { article.uiString(it) }
            if (articleContent == content) return
            articleContent = content
        } else articleContent = null
        cancelImages()
        body.removeAllViews()
        when (route) {
            NativeRoute.INBOX -> inbox(s)
            NativeRoute.DEVICE -> device(s)
            NativeRoute.MESSAGE -> article(article)
            NativeRoute.CONTROLS -> controls(s)
            NativeRoute.CAPABILITIES -> capabilities(s)
            NativeRoute.STATUS -> status(s)
            NativeRoute.MEDIA -> media(s)
            NativeRoute.ACTIVITY -> activityHistory(s)
            NativeRoute.CONNECTION -> Unit
        }
    }
    private var articleContent: List<String>? = null

    private fun tab(target: NativeRoute, iconId: Int, unread: Int) {
        val active = target == route
        val button = row().apply {
            gravity = Gravity.CENTER
            minimumHeight = dp(48)
            background = press(if (active) selected else Color.TRANSPARENT, 28)
            isSelected = active
            contentDescription = target.title + "标签页" + if (unread > 0) "，${unread} 条未读" else ""
            isFocusable = true
            setOnClickListener { host.navigate(target) }
            val glyph = android.widget.FrameLayout(activity)
            glyph.addView(icon(iconId, if (active) ink else muted), dp(20), dp(20))
            if (unread > 0) glyph.addView(View(activity).apply { background = shape(amber, 4) },
                android.widget.FrameLayout.LayoutParams(dp(6), dp(6), Gravity.TOP or Gravity.END))
            addView(glyph)
            addView(text(target.title, 14, if (active) ink else muted, true).apply { pad(7, 0) })
        }
        tabs.flex(button)
    }

    fun menu(title: String, choices: List<String>, selectedIndex: Int = -1, note: String? = null,
             choose: (Int) -> Unit) {
        dialog?.dismiss()
        val sheet = Dialog(activity)
        sheet.requestWindowFeature(android.view.Window.FEATURE_NO_TITLE)
        val content = column().apply {
            pad(20)
            background = shape(surface, 20)
            item(heading(title, 20))
            for ((index, choice) in choices.withIndex()) {
                val active = index == selectedIndex
                item(action(choice, if (active) selected else panel) {
                    sheet.dismiss()
                    choose(index)
                }.apply { isSelected = active }, 8)
            }
            if (note != null) item(text(note, 13, muted), 10)
            item(action("取消", surface) { sheet.dismiss() }, 8)
        }
        sheet.setContentView(content)
        sheet.window?.apply {
            setBackgroundDrawable(ColorDrawable(Color.TRANSPARENT))
            setGravity(Gravity.BOTTOM or Gravity.CENTER_HORIZONTAL)
            setLayout(minOf(shell.width.takeIf { it > 0 } ?: dp(720), dp(720)), WRAP)
        }
        dialog = sheet
        sheet.show()
    }

    fun dialogBuilder() = AlertDialog.Builder(activity, if (dark) android.R.style.Theme_Material_Dialog_Alert
        else android.R.style.Theme_Material_Light_Dialog_Alert)
    fun show(builder: AlertDialog.Builder) {
        dialog?.dismiss()
        dialog = builder.show()
    }
    fun confirm(title: String, detail: String, label: String, run: () -> Unit) =
        show(dialogBuilder().setTitle(title).setMessage(detail)
            .setNegativeButton("取消", null).setPositiveButton(label) { _, _ -> run() })

    private fun cancelImages() {
        images.forEach { it.cancel() }
        images.clear()
    }
    fun close() {
        dialog?.dismiss()
        cancelImages()
        connectionForm?.close()
    }
}

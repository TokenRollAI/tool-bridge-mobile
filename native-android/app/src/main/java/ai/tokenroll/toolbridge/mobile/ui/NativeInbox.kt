package ai.tokenroll.toolbridge.mobile

import android.graphics.Color
import android.text.Editable
import android.text.InputFilter
import android.text.TextWatcher
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputMethodManager
import android.widget.LinearLayout
import android.widget.Button
import android.widget.EditText
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

private val sortLabels = linkedMapOf("received_desc" to "最新", "received_asc" to "最早", "unread_first" to "未读优先")
internal class InboxToolbar(private val p: NativePage) {
    private val search: EditText
    private val clear: View
    private val all: Button
    private val unread: Button
    private val sortButton: Button
    private var sort = "received_desc"
    private var unreadOnly = false
    private var query: String? = null

    init {
        with(p) {
            val bar = row().apply { background = shape(elevated, 8) }
            bar.addView(icon(R.drawable.tb_ui_search).apply { pad(8) }, dp(38), dp(38))
            search = field("搜索消息", "搜索本机信箱").apply {
                filters = arrayOf(InputFilter.LengthFilter(120))
                imeOptions = EditorInfo.IME_ACTION_SEARCH
                setOnEditorActionListener { _, action, key ->
                    if (action == EditorInfo.IME_ACTION_SEARCH ||
                        (key?.keyCode == KeyEvent.KEYCODE_ENTER && key.action == KeyEvent.ACTION_UP)) {
                        activity.getSystemService(InputMethodManager::class.java).hideSoftInputFromWindow(windowToken, 0)
                        applyQuery(text.toString().trim())
                        true
                    } else false
                }
            }
            bar.flex(search)
            clear = iconButton(R.drawable.tb_ui_close, "清除信箱搜索词") {
                search.setText("")
                applyQuery("")
            }
            bar.addView(clear, dp(48), dp(48))
            toolbar.item(bar)
            val filters = row()
            val segment = row().apply { background = shape(elevated, 28) }
            all = action("全部") { options(query.orEmpty(), sort, false) }
            unread = action("未读") { options(query.orEmpty(), sort, true) }
            segment.addView(all)
            segment.addView(unread)
            filters.addView(segment)
            filters.addView(android.widget.Space(activity), LinearLayout.LayoutParams(0, 1, 1f))
            sortButton = action("最新", Color.TRANSPARENT, muted) {
                val keys = sortLabels.keys.toList()
                menu("消息排序", sortLabels.values.toList(), keys.indexOf(sort)) { index ->
                    options(search.text.toString().trim(), keys[index], unreadOnly)
                }
            }
            val glyph = activity.getDrawable(R.drawable.tb_ui_filter)?.mutate()?.apply {
                setTint(muted)
                setBounds(0, 0, dp(16), dp(16))
            }
            sortButton.setCompoundDrawablesRelative(null, null, glyph, null)
            sortButton.compoundDrawablePadding = dp(6)
            sortButton.contentDescription = "选择信箱排序"
            filters.addView(sortButton)
            toolbar.item(filters, 5)
        }
        search.addTextChangedListener(object : TextWatcher {
            override fun afterTextChanged(value: Editable?) {
                p.host.searchDraft = value.toString()
                clear.visibility = if (value.isNullOrEmpty()) View.GONE else View.VISIBLE
            }
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
            override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {}
        })
    }

    private fun applyQuery(value: String) = options(value, sort, unreadOnly)
    private fun options(value: String, ordering: String, onlyUnread: Boolean) {
        if (value == query && ordering == sort && onlyUnread == unreadOnly) return
        p.host.submit(p, NativeScreenAction.InboxView(value, ordering, onlyUnread), "inboxView",
            failure = "更新失败，仍显示上一次的消息列表。")
    }
    fun update(state: JSONObject?, count: Int) = with(p) {
        val applied = state?.uiString("searchQuery").orEmpty()
        if (query == null || (applied != query && search.text.toString() == query)) {
            val draft = if (query == null) host.searchDraft ?: applied else applied
            search.setText(draft)
            search.setSelection(draft.length)
        }
        clear.visibility = if (search.text.isEmpty()) View.GONE else View.VISIBLE
        query = applied
        sort = state?.uiString("sort", "received_desc") ?: "received_desc"
        unreadOnly = state?.optBoolean("unreadOnly") == true
        unread.text = if (count > 0) "未读  $count" else "未读"
        for ((button, active) in listOf(all to !unreadOnly, unread to unreadOnly)) {
            button.isSelected = active
            button.background = press(if (active) selected else Color.TRANSPARENT, 28)
            button.setTextColor(if (active) ink else muted)
        }
        sortButton.text = sortLabels[sort] ?: "最新"
        sortButton.contentDescription = "选择信箱排序，当前" + sortButton.text
    }
}

internal fun NativePage.inboxMenu() {
    val hasUnread = actions.snapshot().optInt("inboxUnreadCount") > 0
    val labels = if (hasUnread) listOf("全部标为已读", "清空本机信箱") else listOf("清空本机信箱")
    menu("信箱操作", labels, note = "操作范围为本机全部消息，包含当前筛选以外的消息。") { index ->
        if (hasUnread && index == 0) host.submit(this, NativeScreenAction.MarkAllRead, "bulkInbox", "已全部标为已读。")
        else confirm("确认清空本机信箱？", "所有本机消息（包括筛选以外的消息）将永久删除。活动记录、设置和凭证会保留。",
            "确认清空") { host.submit(this, NativeScreenAction.ClearInbox, "bulkInbox", "已清空本机信箱。") }
    }
}

internal fun NativePage.inbox(s: JSONObject) {
    val state = s.optJSONObject("inboxViewOptions")
    val bar = inboxTools ?: InboxToolbar(this).also { inboxTools = it }
    bar.update(state, s.optInt("inboxUnreadCount"))
    val query = state?.uiString("searchQuery").orEmpty()
    val unreadOnly = state?.optBoolean("unreadOnly") == true
    if (query.isNotEmpty()) body.item(text("“$query”的" + if (unreadOnly) "未读结果" else "搜索结果", 13, muted))
    val messages = s.uiObjects("inboxMessages").take(100)
    if (messages.isEmpty()) {
        val (title, description) = when {
            query.isNotEmpty() -> (if (unreadOnly) "没有匹配的未读消息。" else "没有匹配的本机信箱消息。") to "试试其他关键词，或清除搜索查看全部消息。"
            unreadOnly -> "未读消息都处理完了。" to "切换到「全部」，可以继续阅读已有消息。"
            else -> "最近还没有 Agent 来信。" to "来自 Agent 的消息，集中留在本机。"
        }
        body.empty(if (unreadOnly) R.drawable.tb_ui_read else R.drawable.tb_ui_inbox, title, description)
        return
    }
    val clock = InboxClock()
    for (message in messages) {
        val unread = message.isNull("readAt")
        val caller = message.uiString("callerDisplayName", message.uiString("callerSubjectId"))
        val title = message.uiString("title")
        val time = clock.relative(message.uiString("receivedAt"))
        val urgency = urgency(message)
        val item = column().apply {
            val paired = activity.resources.getBoolean(R.bool.inbox_two_pane)
            isSelected = host.selectedMessageId == message.uiString("messageId")
            pad(if (paired) 8 else 0, 12)
            background = press(if (isSelected) selected else Color.TRANSPARENT, 6)
            isFocusable = true
            contentDescription = listOf(if (unread) "未读" else "已读", urgency, title, "来自 $caller", time)
                .filter { it.isNotEmpty() }.joinToString("，")
            setOnClickListener { host.openMessage(message.uiString("messageId")) }
        }
        val meta = row()
        meta.addView(View(activity).apply { background = shape(if (unread) amber else Color.TRANSPARENT, 3) }, dp(6), dp(6))
        meta.flex(text(caller, 13, if (unread) ink else muted, unread).apply { pad(8, 0); limit(1) })
        meta.addView(text(time, 12, muted))
        item.item(meta)
        item.item(text(title, 18, ink, unread).apply { limit(2) }, 4)
        val summary = markdownPreview(message.uiString("body"))
        if (summary.isNotBlank()) item.item(text(summary, 14, muted).apply { limit(2) }, 4)
        if (urgency.isNotEmpty()) item.item(urgencyBadge(message), 5, WRAP)
        body.item(item)
        body.line()
    }
}
private fun urgency(m: JSONObject) = when (m.uiString("urgency")) {
    "critical" -> "紧急"
    "high" -> "高"
    else -> ""
}
private fun NativePage.urgencyBadge(m: JSONObject) = text(urgency(m) + "优先级", 12,
    if (m.uiString("urgency") == "critical") danger else amber, true).apply {
    pad(8, 3)
    background = shape(if (m.uiString("urgency") == "critical") dangerSoft else amberSoft, 20)
}

internal fun NativePage.article(m: JSONObject?) {
    if (m == null) {
        body.empty(R.drawable.tb_ui_inbox, "消息不存在", "这条本机信箱消息可能已被清空或不存在。")
        return
    }
    val category = when (m.uiString("category")) {
        "news" -> "新闻"
        "update" -> "更新"
        "subscription" -> "订阅"
        else -> "消息"
    }
    val caller = m.uiString("callerDisplayName", m.uiString("callerSubjectId"))
    body.item(text(category, 12, muted, true))
    body.item(heading(m.uiString("title"), 28), 6)
    body.item(row().apply {
        addView(text(caller.take(1).uppercase(), 15, ink, true).apply {
            gravity = Gravity.CENTER
            background = shape(selected, 18)
        }, dp(36), dp(36))
        flex(column().apply {
            pad(12, 0)
            item(text(caller, 15, ink, true))
            val clock = InboxClock()
            val time = m.uiString("receivedAt")
            item(text(clock.relative(time), 13, muted).apply { contentDescription = "收到时间：" + clock.absolute(time) }, 3)
            if (!m.isNull("sourceLabel")) item(text("内容来源（Agent 提供）：" + m.uiString("sourceLabel"), 13, muted), 4)
        })
    }, 14)
    if (urgency(m).isNotEmpty()) body.item(urgencyBadge(m), 8, WRAP)
    body.item(View(activity).apply { setBackgroundColor(border) }, 16, height = 1)
    renderMarkdown(m.uiString("body"))
    if (m.isNull("readAt") && !markedRead) {
        markedRead = true
        host.submit(this, NativeScreenAction.MarkRead(m.uiString("messageId")), "read/" + m.uiString("messageId"),
            failure = "未能标为已读，可返回信箱后重试。")
    }
}

private class InboxClock {
    private val iso = listOf("yyyy-MM-dd'T'HH:mm:ss.SSSXXX", "yyyy-MM-dd'T'HH:mm:ssXXX").map {
        SimpleDateFormat(it, Locale.US).apply { isLenient = false; timeZone = TimeZone.getTimeZone("UTC") }
    }
    private val local = SimpleDateFormat("yyyy-MM-dd HH:mm", Locale.getDefault())
    private fun parse(raw: String): Date? = iso.firstNotNullOfOrNull { runCatching { it.parse(raw) }.getOrNull() }
    fun absolute(raw: String) = parse(raw)?.let(local::format) ?: raw
    fun relative(raw: String): String {
        val date = parse(raw) ?: return raw
        val minutes = (System.currentTimeMillis() - date.time) / 60_000
        return when {
            minutes < 1 -> "刚刚"
            minutes < 60 -> "$minutes 分钟前"
            minutes < 1440 -> "${minutes / 60} 小时前"
            minutes < 10080 -> "${minutes / 1440} 天前"
            else -> local.format(date)
        }
    }
}

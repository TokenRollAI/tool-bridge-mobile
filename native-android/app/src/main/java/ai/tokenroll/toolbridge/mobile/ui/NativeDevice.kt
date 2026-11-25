package ai.tokenroll.toolbridge.mobile

import android.graphics.Color
import android.graphics.Typeface
import android.view.View
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.Switch
import org.json.JSONObject

private fun modeName(mode: String) = when (mode) {
    "disabled" -> "远程能力已停用"
    "trusted_session" -> "信任会话"
    "direct_call" -> "直接调用"
    "ask_every_time" -> "每次确认"
    else -> "状态未知"
}
internal fun connectionLabel(s: JSONObject) = when (s.uiString("transportState")) {
    "ready" -> "已连接网关"
    "suspended" -> "连接已暂停"
    else -> "网关尚未就绪"
}

internal fun NativePage.device(s: JSONObject) {
    val mode = s.uiString("controlMode")
    val disabled = mode == "disabled"
    val connected = s.uiString("transportState") == "ready"
    body.item(text("本机设备 ID", 12, muted, true))
    body.item(text(s.uiString("deviceId", s.uiString("defaultDeviceId", "设备身份准备中")), 21).apply {
        typeface = Typeface.MONOSPACE
        setTextIsSelectable(true)
    }, 5)
    val connection = row()
    connection.addView(text(connectionLabel(s), 13, if (connected) green else muted, true).apply {
        pad(9, 5)
        background = shape(if (connected) greenSoft else elevated, 20)
    })
    connection.flex(text(s.uiString("gatewayOrigin").removePrefix("https://"), 12, muted).apply {
        typeface = Typeface.MONOSPACE
        pad(8, 0)
    })
    body.item(connection, 8)
    if (disabled || mode == "direct_call") {
        body.item(text(if (disabled) "远程能力已停用。恢复后，每条有副作用的命令都需在本机确认。"
            else "直接调用已开启，包括高风险命令。系统权限与设备限制仍然有效。", 14,
            if (disabled) danger else amber).apply {
                background = shape(if (disabled) dangerSoft else amberSoft, 10)
                pad(12)
            }, 16)
    }
    fun group(label: String): LinearLayout {
        body.item(heading(label), 20)
        return column().apply {
            background = shape(panel, 14)
            clipToOutline = true
            body.item(this, 8)
        }
    }
    fun LinearLayout.link(title: String, description: String, glyph: Int, open: () -> Unit) {
        if (childCount > 0) line()
        item(row().apply {
            minimumHeight = dp(56)
            pad(12, 9)
            isFocusable = true
            contentDescription = "$title，$description"
            background = press(Color.TRANSPARENT, 0)
            setOnClickListener { open() }
            addView(icon(glyph), dp(20), dp(20))
            flex(column().apply {
                pad(12, 0)
                item(text(title, 15, ink, true))
                item(text(description, 12, muted), 3)
            })
            addView(icon(R.drawable.tb_ui_chevron), dp(16), dp(16))
        })
    }
    group("连接与授权").apply {
        link("连接配置", if (disabled) "恢复为每次确认后可编辑" else "网关地址和本机凭证", R.drawable.tb_ui_link) { host.navigate(NativeRoute.CONNECTION) }
        link("授权与安全", modeName(mode), R.drawable.tb_ui_shield) { host.navigate(NativeRoute.CONTROLS) }
        link("远控配置", "管理这台设备的远控设置", R.drawable.tb_ui_remote) { actions.openRemoteControlConfiguration() }
    }
    group("能力与运行").apply {
        link("设备能力", counts(s), R.drawable.tb_ui_caps) { host.navigate(NativeRoute.CAPABILITIES) }
        link("运行详情", "连接状态、设备提示与计时器", R.drawable.tb_ui_pulse) { host.navigate(NativeRoute.STATUS) }
        link("媒体会话", s.optJSONObject("mediaSession")?.uiString("title") ?: "当前没有媒体会话", R.drawable.tb_ui_media) { host.navigate(NativeRoute.MEDIA) }
        link("活动记录", "查看调用记录与本地执行结果", R.drawable.tb_ui_clock) { host.navigate(NativeRoute.ACTIVITY) }
    }
    emergency(disabled)
}
private fun NativePage.emergency(disabled: Boolean) {
    val label = if (disabled) "恢复为每次确认" else "紧急停用远程能力"
    body.item(action(label, if (disabled) ink else danger, if (disabled) surface else dangerSoft) {
        host.submit(this, NativeScreenAction.SetControlMode(if (disabled) "ask_every_time" else "disabled"),
            if (disabled) "setMode" else "emergencyDisable")
    }, 18)
    body.item(text(if (disabled) "恢复后，涉及副作用的命令需逐次确认。" else "立即拒绝新命令，并停止仍可撤销的本地操作。", 12, muted), 8)
}

internal fun NativePage.controls(s: JSONObject) {
    val mode = s.uiString("controlMode")
    body.item(text("每条命令如何执行，始终由本机授权决定。", 14, muted))
    if (mode == "disabled") {
        body.card("远程能力已停用").item(text("新命令会在本机被拒绝。恢复后可以调整其他设置。", 14, muted), 8)
        emergency(true)
        return
    }
    body.item(heading("控制模式"), 18)
    for ((value, label, detail) in listOf(
        Triple("ask_every_time", "每次确认", "每条有副作用的命令都在设备上逐次确认"),
        Triple("trusted_session", "信任会话（非高危直调）", "低、中风险命令可直接执行，高风险仍逐次确认"),
        Triple("direct_call", "允许直接调用（含高危）", "跳过逐次确认。系统权限、用户拒绝与紧急停用仍然有效")
    )) {
        val active = value == mode
        body.item(row().apply {
            minimumHeight = dp(56)
            pad(12)
            isSelected = active
            isFocusable = true
            contentDescription = label + (if (active) "，当前" else "") + "，" + detail
            background = press(if (active) selected else panel, 14)
            setOnClickListener {
                if (!active) host.submit(this@controls, NativeScreenAction.SetControlMode(value), "setMode")
            }
            flex(column().apply {
                item(text(label, 15, ink, true))
                item(text(detail, 13, muted), 4)
            })
            addView(text(if (active) "●" else "○", 20, if (active) ink else muted).apply { pad(6, 0) })
        }, 8)
    }
    if (mode == "direct_call") body.item(text("高特权工具可直接执行，前台相机可在可见预览就绪后自动拍摄并上传。请确认你信任当前网关与 Agent。", 14, amber).apply {
        background = shape(amberSoft, 8)
        pad(12)
    }, 12)
    val background = body.card("后台运行")
    background.item(Switch(activity).apply {
        text = "允许后台运行"
        setTextColor(ink)
        textSize = 15f
        minHeight = dp(48)
        val enabledNow = s.optBoolean("backgroundRuntimeEnabled")
        isChecked = enabledNow
        setOnClickListener {
            isChecked = enabledNow
            host.submit(this@controls, NativeScreenAction.SetBackground(!enabledNow), "background")
        }
    })
    background.item(text("退到后台时保持设备连接。Android 会显示常驻通知，系统省电策略仍可能中断连接。", 13, muted), 4)
    body.item(heading("系统权限"), 18)
    body.item(text("仅在你主动操作时请求。完整授权状态见设备能力。", 13, muted), 5)
    for (cap in s.uiObjects("capabilities")) {
        val descriptor = cap.optJSONObject("descriptor") ?: continue
        val id = descriptor.uiString("path") + "." + descriptor.uiString("tool")
        val availability = cap.optJSONObject("availability") ?: continue
        val pair = availability.uiString("status") to availability.uiString("reason")
        val permission: NativeScreenAction.Permission
        val settings: Boolean
        val label: String
        when (id) {
            "phone/camera.capture_photo" -> {
                permission = NativeScreenAction.Permission.CAMERA
                settings = pair == ("unavailable" to "camera_permission_denied")
                if (!settings && pair != ("permission_required" to "camera_permission_required")) continue
                label = if (settings) "打开相机设置" else "启用前台相机"
            }
            "phone/productivity.notify" -> {
                permission = NativeScreenAction.Permission.NOTIFICATIONS
                settings = pair.first == "unavailable" && pair.second in listOf("notification_permission_denied", "notification_channel_disabled")
                if (!settings && pair != ("unavailable" to "notification_permission_requestable")) continue
                label = if (settings) "打开通知设置" else "启用本地通知"
            }
            else -> continue
        }
        body.item(action(label) {
            host.submit(this, NativeScreenAction.PermissionAction(permission, settings), "permission")
        }, 8)
    }
    emergency(false)
}

private fun counts(s: JSONObject): String {
    val caps = s.uiObjects("capabilities")
    val available = caps.count { it.optJSONObject("availability")?.uiString("status") == "available" }
    return "$available 项可用 · ${caps.size} 项已探测"
}
internal fun NativePage.capabilities(s: JSONObject) {
    val caps = s.uiObjects("capabilities")
    body.item(heading("能力清单"))
    body.item(text(counts(s), 13, muted), 5)
    if (caps.isEmpty()) body.empty(R.drawable.tb_ui_caps, "运行时尚未完成能力探测。", "完成探测后，这里会展示本机支持的能力和授权状态。")
    for (cap in caps) {
        val d = cap.optJSONObject("descriptor") ?: continue
        val a = cap.optJSONObject("availability") ?: continue
        val state = a.uiString("status")
        body.card(d.uiString("path") + "." + d.uiString("tool")).apply {
            val available = state == "available"
            item(text(if (available) "可用" else if (state == "permission_required") "需要授权" else "暂不可用",
                12, if (available) green else amber, true).apply {
                pad(8, 4)
                background = shape(if (available) greenSoft else amberSoft, 18)
            }, 8, WRAP)
            item(text(d.uiString("description"), 14), 8)
            detail("effect / risk", d.uiString("effect") + " / " + d.uiString("risk"))
            detail("确认", d.uiString("confirmation"))
            detail("availability", listOf(state, a.uiString("reason")).filter(String::isNotEmpty).joinToString(" · "))
        }
    }
}

internal fun NativePage.status(s: JSONObject) {
    if (!s.isNull("error")) body.item(text(s.uiString("error"), 14, danger))
    body.card(if (s.uiString("transportState") == "ready") "设备已连接" else "设备尚未就绪").apply {
        detail("连接", s.uiString("reachability"))
        detail("控制模式", modeName(s.uiString("controlMode")))
        detail("后台运行", if (s.optBoolean("backgroundRuntimeEnabled")) "已开启" else "已关闭")
        detail("前后台", s.uiString("appState"))
    }
    if (listOf("deviceId", "mountPath", "transportIssue").any { !s.isNull(it) }) {
        body.card("连接详情").apply {
            detail("SDK deviceId", s.uiString("deviceId"))
            detail("挂载路径", s.uiString("mountPath"))
            detail("连接问题", s.uiString("transportIssue"))
        }
    }
    val timers = s.uiObjects("timers")
    val attention = s.optJSONObject("attentionSession")
    if (attention != null || timers.isNotEmpty()) body.item(heading("正在运行"), 18)
    if (attention != null) body.card("正在提示设备").apply {
        detail("调用方", attention.uiString("callerSubjectId"))
        detail("剩余时间", attention.uiString("remainingSeconds") + " 秒")
        item(action("停止设备提示") { host.submit(this@status, NativeScreenAction.StopAttention, "attention") }, 10)
    }
    for (timer in timers) body.card("App 内计时器").apply {
        detail("调用方", timer.uiString("ownerSubjectId"))
        detail("目标时间", timer.uiString("firesAt"))
        detail("持久状态", timer.uiString("state"))
        item(text("实际通知展示时间由系统决定。", 12, muted), 7)
        val id = timer.uiString("timerId")
        item(action("取消此计时器") { host.submit(this@status, NativeScreenAction.CancelTimer(id), "timer/$id") }, 10)
    }
    body.item(action("返回设备管理") { host.showDevice() }, 18)
}

internal fun NativePage.media(s: JSONObject) {
    val media = s.optJSONObject("mediaSession")
    if (media == null) {
        body.empty(R.drawable.tb_ui_media, "暂无 App 自有媒体会话。", "Agent 发起播放后，你可以在这里暂停、继续或停止。")
        return
    }
    val state = media.uiString("state")
    val duration = media.optDouble("durationSeconds", Double.NaN)
    val current = media.optDouble("currentTimeSeconds", 0.0).toInt()
    body.card(media.uiString("title")).apply {
        detail("状态", state)
        item(ProgressBar(activity, null, android.R.attr.progressBarStyleHorizontal).apply {
            max = 100
            progress = if (duration > 0) (100 * current / duration).toInt().coerceIn(0, 100) else 0
        }, 10)
        detail("进度", "$current / " + (if (duration.isFinite()) duration.toInt().toString() else "未知") + " 秒")
        val id = media.uiString("sessionId")
        fun control(label: String, operation: NativeScreenAction.Playback) {
            item(action(label) { host.submit(this@media, NativeScreenAction.ControlMedia(id, operation), "playback/$id") }, 8)
        }
        when (state) {
            "playing", "loading" -> control("暂停", NativeScreenAction.Playback.PAUSE)
            "paused", "interrupted" -> control("继续", NativeScreenAction.Playback.RESUME)
        }
        if (state != "stopped" && state != "failed") control("停止", NativeScreenAction.Playback.STOP)
        detail("调用方", media.uiString("callerSubjectId"))
        detail("来源", media.uiString("sourceHost"))
    }
}

internal fun NativePage.activityHistory(s: JSONObject) {
    val records = s.uiObjects("auditRecords").take(100)
    body.item(heading("调用记录"))
    body.item(text("最近 ${records.size} 条 · 仅显示调用元数据", 13, muted), 5)
    if (records.isEmpty()) body.empty(R.drawable.tb_ui_clock, "暂无远程调用记录。", "Agent 调用这台设备后，可在这里查看本地决策和执行结果。")
    for (r in records) body.card(r.uiString("path") + "." + r.uiString("tool")).apply {
        item(text(r.uiString("occurredAt"), 13, muted), 8)
        detail("来源", r.uiString("callerSubjectId"))
        detail("决策", r.uiString("decision"))
        detail("结果", r.uiString("outcomeCode"))
        detail("影响", r.uiString("effect"))
        detail("风险", r.uiString("risk"))
        if (r.uiString("decision") == "allowed") {
            val (label, tint) = when (r.uiString("outcomeCode")) {
                "succeeded" -> "执行成功" to green
                "result_unknown" -> "已允许 · 结果未知" to amber
                else -> "已允许 · 执行失败" to danger
            }
            item(text(label, 13, tint, true), 8)
        }
    }
    body.item(action("清除本机活动历史") {
        confirm("确认清除本机活动历史？", "本机全部活动记录将永久删除。其他设备数据会保留，后续调用仍会记录。",
            "确认清除") { host.submit(this, NativeScreenAction.ClearActivity, "clearActivity", "已清除本机活动历史。") }
    }, 18)
}

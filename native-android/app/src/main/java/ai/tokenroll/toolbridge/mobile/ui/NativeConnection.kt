package ai.tokenroll.toolbridge.mobile

import android.os.Build
import android.text.InputFilter
import android.text.InputType
import android.text.method.PasswordTransformationMethod
import android.view.View
import android.view.inputmethod.EditorInfo
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import org.json.JSONObject
import java.net.URI

internal class ConnectionForm(private val p: NativePage) {
    private val controls: LinearLayout
    private val connection: TextView
    private val current: TextView
    private val locked: TextView
    private val origin: EditText
    private val key: EditText
    private val device: EditText
    private val save: Button
    private val clear: Button
    private var lastOrigin: String? = null
    private var busy = false

    init {
        with(p) {
            connection = heading("", 17)
            body.card().item(connection)
            locked = text("远程能力已停用。请返回设备页恢复为每次确认后，再调整连接配置。", 14, muted)
            body.item(locked, 14)
            controls = column()
            body.item(controls)
            current = text("", 14, muted)
            controls.item(current, 12)
            controls.item(text("API key 只保存在系统安全存储中，保存后不会回显。", 14, muted), 8)

            fun labeled(label: String, field: EditText): EditText {
                field.id = View.generateViewId()
                controls.item(text(label, 14, ink, true).apply { labelFor = field.id }, 16)
                controls.item(field, 6)
                return field
            }
            origin = labeled("Gateway HTTPS URL", field("https://gateway.example.com", "Gateway HTTPS URL",
                InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI))
            key = labeled("API key", field("输入 API key", "Tool Bridge API key",
                InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD).apply {
                transformationMethod = PasswordTransformationMethod.getInstance()
                filters = arrayOf(InputFilter.LengthFilter(16384))
                if (Build.VERSION.SDK_INT >= 26) {
                    importantForAutofill = View.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS
                    imeOptions = imeOptions or EditorInfo.IME_FLAG_NO_PERSONALIZED_LEARNING
                }
            })
            device = labeled("设备 ID（可选）", field("留空使用默认设备 ID", "自定义设备 ID").apply {
                filters = arrayOf(InputFilter.LengthFilter(64))
            })
            controls.item(text("可使用字母、数字、点、下划线或短横线，最多 64 个字符。", 13, muted), 5)
            save = action("保存并连接", ink, surface) { save() }
            controls.item(save, 16)
            clear = action("清除网关连接配置") {
                confirm("确认清除本机连接配置？", "将断开连接并删除保存在本机的 API key。已有的消息、计时器与活动记录会保留。",
                    "确认清除") { change(NativeScreenAction.ClearConnection, "已清除本机连接配置。") }
            }
            controls.item(clear, 8)
        }
    }

    fun update(s: JSONObject) {
        connection.text = connectionLabel(s)
        val disabled = s.uiString("controlMode") == "disabled"
        controls.visibility = if (disabled) View.GONE else View.VISIBLE
        locked.visibility = if (disabled) View.VISIBLE else View.GONE
        val stored = s.uiString("gatewayOrigin")
        if (disabled) {
            key.text.clear()
            device.text.clear()
            origin.setText(stored)
        } else if (lastOrigin != stored && origin.text.toString() == lastOrigin.orEmpty()) {
            origin.setText(stored)
        }
        lastOrigin = stored
        current.text = "当前 Gateway  " + stored.ifEmpty { "未配置" }
        clear.visibility = if (stored.isEmpty()) View.GONE else View.VISIBLE
        device.hint = "留空使用默认 " + s.uiString("defaultDeviceId", "设备 ID")
    }

    private fun save() {
        val input = origin.text.toString().trim()
        val parsed = runCatching { URI(input) }.getOrNull()
        if (parsed == null || !parsed.scheme.equals("https", true) || parsed.host.isNullOrEmpty() ||
            parsed.rawUserInfo != null || parsed.rawQuery != null || parsed.rawFragment != null ||
            parsed.rawPath !in listOf("", "/") || parsed.port > 65535) {
            origin.error = "请输入 HTTPS 网关地址，省略路径、参数与用户名。"
            origin.requestFocus()
            return
        }
        val material = key.text.toString()
        if (material.isEmpty() || material.any { it.code !in 33..126 }) {
            key.error = "请输入不含空格的有效 API key。"
            key.requestFocus()
            return
        }
        val id = device.text.toString().trim()
        if (id.isNotEmpty() && !id.matches(Regex("[A-Za-z0-9._-]{1,64}"))) {
            device.error = "设备 ID 只能包含字母、数字、点、下划线和短横线。"
            device.requestFocus()
            return
        }
        change(NativeScreenAction.SaveConnection(input, material, id.ifEmpty { null }), "连接配置已保存。")
    }

    private fun change(action: NativeScreenAction, feedback: String) {
        if (busy || p.host.busy("connection") || p.actions.snapshot().uiString("controlMode") == "disabled") return
        setBusy(true)
        p.host.submit(p, action, "connection", feedback, "无法确认连接配置已更新，请重试。") { ok ->
            setBusy(false)
            if (ok) {
                key.text.clear()
                origin.setText(p.actions.snapshot().uiString("gatewayOrigin"))
            }
        }
    }
    private fun setBusy(value: Boolean) {
        busy = value
        for (v in listOf<View>(save, clear, origin, key, device)) v.isEnabled = !value
        save.text = if (value) "处理中…" else "保存并连接"
    }
    fun close() { key.text.clear() }
}

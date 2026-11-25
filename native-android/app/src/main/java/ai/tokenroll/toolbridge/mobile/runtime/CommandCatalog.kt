package ai.tokenroll.toolbridge.mobile

import android.content.Context
import com.fasterxml.jackson.databind.ObjectMapper
import com.networknt.schema.JsonSchemaFactory
import com.networknt.schema.SpecVersion
import org.json.JSONArray
import org.json.JSONObject

internal data class PhoneCommand(
    val key: String, val description: String, val effect: String, val risk: String,
    val confirmation: String = "never", val globalRate: Int = 60, val callerRate: Int = 30,
    val windowMs: Long = 60000L, val maxResultBytes: Int = 65536,
) {
    val path = "phone/" + key.substringBefore('/')
    val tool = key.substringAfter('/')
    fun prompt(mode: String, active: Boolean) = !key.startsWith("control/") && mode != "direct_call" &&
        (risk == "high" || confirmation == "always" || (confirmation == "when_locked" && !active) ||
            (mode == "ask_every_time" && effect != "read"))
    fun descriptor() = obj("description" to description, "effect" to effect, "risk" to risk,
        "confirmation" to confirmation, "path" to path, "tool" to tool,
        "queuePolicy" to if (key == "inbox/deliver") "enqueue" else "reject_offline")
}

internal class CommandCatalog(ctx: Context, private val exposed: (String) -> Boolean, private val availability: (String) -> JSONObject) {
    private val schemas = JSONObject(ctx.assets.open("contracts.json").bufferedReader().use { it.readText() })
    private val mapper = ObjectMapper()
    private val factory = JsonSchemaFactory.getInstance(SpecVersion.VersionFlag.V202012)
    private val commands = listOf(
        PhoneCommand("status/get","查看电量、网络及设备运行状态","read","low","never",120,60,60000,16384),
        PhoneCommand("inbox/deliver","投递一条 Markdown 信箱消息","write","medium","never",60,30,3600000,2048),
        PhoneCommand("runtime/capabilities","查看手机当前能力和授权","read","low","never",120,60,60000,32768),
        PhoneCommand("runtime/pending_commands","查看本调用者的活动命令","read","low","never",120,60,60000,32768),
        PhoneCommand("runtime/cancel","取消本调用者的活动命令","write","low","never",120,60,60000,2048),
        PhoneCommand("system/accessibility_status","查看远控无障碍服务状态","read","low","never",60,30,60000,1024),
        PhoneCommand("system/clipboard_get","在手机前台读取剪贴板","read","high","never",60,30,60000,69632),
        PhoneCommand("system/clipboard_set","在手机前台写入剪贴板","write","medium","never",60,30,60000,1024),
        PhoneCommand("system/open_intent","由手机前台打开链接","write","high","never",30,20,60000,1024),
        PhoneCommand("productivity/notify","发一条本地通知","write","medium","when_locked",10,5,60000,2048),
        PhoneCommand("productivity/timer_start","创建本地计时器","write","medium","when_locked",10,5,60000,2048),
        PhoneCommand("productivity/timer_cancel","取消自己的计时器","write","low","never",120,60,60000,2048),
        PhoneCommand("productivity/timer_status","读取自己的计时器状态","read","low","never",120,60,60000,2048),
        PhoneCommand("attention/ring","响铃、振动或闪灯查找手机","write","medium","when_locked",6,3,60000,8192),
        PhoneCommand("attention/stop","结束找手机提醒","write","low","never",120,60,60000,4096),
        PhoneCommand("apps/can_open_url","检查已允许的链接是否可打开","read","low","never",60,30,60000,4096),
        PhoneCommand("apps/open_url","在手机上打开已允许的链接","write","medium","when_locked",20,10,60000,4096),
        PhoneCommand("location/current","在手机前台获取一次位置","read","high","always",12,6,60000,4096),
        PhoneCommand("location/open_map","在地图中打开一个地点","write","medium","always",20,10,60000,4096),
        PhoneCommand("camera/capture_photo","在手机前台拍照并返回受保护的引用","write","high","always",4,2,60000,4096),
        PhoneCommand("media/play","播放来自已配置媒体来源的音频","write","medium","when_locked",20,10,60000,8192),
        PhoneCommand("media/pause","暂停当前媒体会话","write","low","never",120,60,60000,8192),
        PhoneCommand("media/resume","继续当前媒体会话","write","low","never",120,60,60000,8192),
        PhoneCommand("media/seek","修改当前播放进度","write","low","never",120,60,60000,8192),
        PhoneCommand("media/stop","停止播放","write","low","never",120,60,60000,8192),
        PhoneCommand("media/status","读取当前媒体会话","read","low","never",120,60,60000,8192),
        PhoneCommand("control/observe","读取本次获准 App 的当前界面元素","read","high","always"),
        PhoneCommand("control/screenshot","获取已授权 App 当前窗口的受保护截图引用","read","high","always",12,8),
        PhoneCommand("control/tap","点击刚观察到的控件","write","high","always"),
        PhoneCommand("control/type","向刚观察到的输入框写入文字","write","high","always"),
        PhoneCommand("control/scroll","滚动刚观察到的可滚动控件","write","high","always"),
    )
    private val byKey = commands.associateBy { it.key }
    private val validators = commands.associate { c ->
        val spec = schemas.getJSONObject(c.key)
        c.key to listOf("inputSchema","outputSchema").map { factory.getSchema(mapper.readTree(spec.getJSONObject(it).toString())) }
    }
    fun resolve(key: String) = byKey[key]?.takeIf { exposed(key) } ?: throw WireFailure("not_found","手机未开放该能力")
    fun validate(c: PhoneCommand, data: JSONObject, output: Boolean = false) {
        if (output && data.toString().toByteArray(Charsets.UTF_8).size > c.maxResultBytes)
            throw WireFailure("resource_exhausted","结果超出本机大小限制")
        val issues = validators.getValue(c.key)[if (output) 1 else 0].validate(mapper.readTree(data.toString()))
        if (issues.isNotEmpty()) throw WireFailure(if (output) "internal" else "invalid_argument",
            if (output) "手机返回的数据格式有误" else "参数格式不正确")
    }
    fun nodes() = JSONArray(commands.groupBy { it.path }.map { (path, all) ->
        val cmds = all.filter { exposed(it.key) }.map { c ->
            val spec = schemas.getJSONObject(c.key)
            obj("name" to c.tool, "description" to c.description, "effect" to c.effect,
                "confirm" to (c.risk == "high" || c.effect != "read" || c.confirmation != "never"),
                "inputSchema" to spec.getJSONObject("inputSchema"), "outputSchema" to spec.getJSONObject("outputSchema"))
                .apply { if (c.key == "inbox/deliver") put("delivery","both") }
        }
        obj("path" to path, "kind" to "tool", "description" to "Tool Bridge Mobile " + path, "cmds" to JSONArray(cmds))
    })
    fun snapshots(mode: String, active: Boolean, ui: Boolean): JSONArray = JSONArray(commands.map { c ->
        val available = if (exposed(c.key)) availability(c.key) else obj("status" to "unavailable", "reason" to "未配置或设备不支持")
        if (ui) obj("descriptor" to c.descriptor(), "availability" to available)
        else c.descriptor().apply {
            remove("queuePolicy"); put("availability", available)
            put("effectiveConfirmation", if (c.prompt(mode,active) || c.key.startsWith("control/")) "required" else "not_required")
        }
    })
}

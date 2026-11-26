package ai.tokenroll.toolbridge.mobile

import android.Manifest
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.provider.Settings
import android.view.View
import android.widget.Button
import android.widget.CheckBox
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast

class ControlActivity : Activity() {
    private val selected = linkedSetOf<String>()
    private lateinit var panel: LinearLayout
    private var clock: TextView? = null
    private val timer = Handler(Looper.getMainLooper())
    private val tick = object : Runnable {
        override fun run() {
            if (clock != null && !RemoteSession.active) render()
            clock?.text = "剩余 %d:%02d".format((remaining() / 60), remaining() % 60)
            timer.postDelayed(this, 500)
        }
    }
    private fun remaining() = ((RemoteSession.expiresAt - SystemClock.elapsedRealtime()).coerceAtLeast(0) / 1000)
    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()
    override fun onCreate(state: Bundle?) {
        super.onCreate(state)
        selected.addAll(state?.getStringArrayList("selection").orEmpty())
        panel = object : LinearLayout(this) {
            override fun onMeasure(widthSpec: Int, heightSpec: Int) {
                val width = minOf(MeasureSpec.getSize(widthSpec), dp(640))
                super.onMeasure(MeasureSpec.makeMeasureSpec(width, MeasureSpec.EXACTLY), heightSpec)
            }
        }.apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(24), dp(20), dp(24), dp(24))
        }
        val scroll = ScrollView(this).apply {
            fitsSystemWindows = true
            addView(panel, android.widget.FrameLayout.LayoutParams(
                android.view.ViewGroup.LayoutParams.MATCH_PARENT,
                android.view.ViewGroup.LayoutParams.WRAP_CONTENT, android.view.Gravity.CENTER_HORIZONTAL))
        }
        setContentView(scroll)
    }
    override fun onSaveInstanceState(out: Bundle) {
        super.onSaveInstanceState(out)
        out.putStringArrayList("selection", ArrayList(selected))
    }
    override fun onResume() { super.onResume(); render(); tick.run() }
    override fun onPause() { timer.removeCallbacks(tick); super.onPause() }
    private fun label(value: String, size: Float) = TextView(this).apply {
        text = value; textSize = size; setPadding(0, dp(8), 0, dp(8))
        panel.addView(this)
    }
    private fun button(value: String, run: () -> Unit) = Button(this).apply {
        text = value; isAllCaps = false; setOnClickListener { run() }; panel.addView(this)
    }
    private fun render() {
        panel.removeAllViews()
        clock = null
        label("远程控制", 28f).accessibilityHeadingCompat()
        val apps = PhoneControlService.allowedApps(this)
        if (RemoteSession.active) {
            clock = label("", 20f)
            label(RemoteSession.packages.joinToString("、") { apps[it] ?: it }, 16f)
            button("结束控制") { RemoteSession.stop(); render() }
            return
        }
        label("只有本次选择的 App 能被读取和操作。控制将在 5 分钟后结束。", 16f)
        if (RemoteSession.service == null) {
            button("前往系统开启无障碍服务") { startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)) }
            return
        }
        if (!ConnectionService.canShowControls(this)) {
            button("允许显示结束控制通知") {
                if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED)
                    requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 41)
                else startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, android.net.Uri.parse("package:" + packageName)))
            }
            return
        }
        val start = button("开始 5 分钟") {
            val runtime = (application as PhoneApp).runtime
            if (!runtime.readyForControl()) {
                Toast.makeText(this, "请先连接网关并启用设备调用", Toast.LENGTH_LONG).show()
            } else {
                runCatching {
                    RemoteSession.begin(this, selected)
                }.onFailure {
                    RemoteSession.stop()
                    Toast.makeText(this, "未能开始远控，请检查设备和通知设置", Toast.LENGTH_LONG).show()
                }
                render()
            }
        }
        selected.retainAll(apps.keys)
        start.isEnabled = selected.isNotEmpty()
        apps.entries.sortedBy { it.value }.forEach { (pkg, name) ->
            panel.addView(CheckBox(this).apply {
                text = "$name\n$pkg"; isChecked = pkg in selected
                setOnCheckedChangeListener { _, enabled ->
                    if (enabled) selected.add(pkg) else selected.remove(pkg)
                    start.isEnabled = selected.isNotEmpty()
                }
            })
        }
    }
    private fun View.accessibilityHeadingCompat() { if (Build.VERSION.SDK_INT >= 28) isAccessibilityHeading = true }
    override fun onRequestPermissionsResult(code: Int, permissions: Array<out String>, results: IntArray) {
        super.onRequestPermissionsResult(code, permissions, results); if (code == 41) render()
    }
}

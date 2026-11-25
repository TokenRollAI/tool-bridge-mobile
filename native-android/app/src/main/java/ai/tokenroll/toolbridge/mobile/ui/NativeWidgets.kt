package ai.tokenroll.toolbridge.mobile

import android.app.Activity
import android.content.res.ColorStateList
import android.content.res.Configuration
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.RippleDrawable
import android.os.Build
import android.text.InputType
import android.text.TextUtils
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.EditText
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import org.json.JSONObject
import kotlin.math.roundToInt

internal const val FILL = ViewGroup.LayoutParams.MATCH_PARENT
internal const val WRAP = ViewGroup.LayoutParams.WRAP_CONTENT
internal fun JSONObject.uiString(key: String, fallback: String = "") =
    if (isNull(key)) fallback else optString(key, fallback)
internal fun JSONObject.uiObjects(key: String): List<JSONObject> {
    val array = optJSONArray(key) ?: return emptyList()
    return (0 until array.length()).mapNotNull { array.optJSONObject(it) }
}

internal open class NativeWidgets(val activity: Activity) {
    val dark = activity.resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK == Configuration.UI_MODE_NIGHT_YES
    private fun color(light: String, night: String) = Color.parseColor(if (dark) night else light)
    val surface = color("#ffffff", "#09090b")
    val panel = color("#f6f6f8", "#101013")
    val elevated = color("#eeeef2", "#1e1e24")
    val border = color("#e4e4e8", "#242429")
    val ink = color("#09090b", "#f4f4f6")
    val muted = color("#52525b", "#b4b4bc")
    val selected = color("#e4e4ea", "#292932")
    val danger = color("#b92534", "#ff9da6")
    val dangerSoft = color("#fff0f2", "#381d23")
    val amber = color("#8a5a00", "#f5c451")
    val amberSoft = color("#fff4d1", "#2a2210")
    val green = color("#146c43", "#6ee7a8")
    val greenSoft = color("#e8f6ee", "#13291e")

    fun dp(value: Int) = (value * activity.resources.displayMetrics.density).roundToInt()
    fun View.pad(x: Int, y: Int = x) = setPadding(dp(x), dp(y), dp(x), dp(y))
    fun shape(fill: Int, radius: Int, line: Boolean = false) = GradientDrawable().apply {
        setColor(fill)
        cornerRadius = dp(radius).toFloat()
        if (line) setStroke(1, border)
    }
    fun press(fill: Int, radius: Int) = RippleDrawable(
        ColorStateList.valueOf(if (dark) 0x22ffffff else 0x16000000), shape(fill, radius), shape(Color.WHITE, radius)
    )
    fun column() = LinearLayout(activity).apply { orientation = LinearLayout.VERTICAL }
    fun row() = LinearLayout(activity).apply { gravity = Gravity.CENTER_VERTICAL }
    fun LinearLayout.item(child: View, top: Int = 0, width: Int = FILL, height: Int = WRAP) {
        addView(child, LinearLayout.LayoutParams(width, height).apply { topMargin = dp(top) })
    }
    fun LinearLayout.flex(child: View) = addView(child, LinearLayout.LayoutParams(0, WRAP, 1f))
    fun text(value: CharSequence, size: Int = 15, color: Int = ink, bold: Boolean = false) =
        TextView(activity).apply {
            text = value
            textSize = size.toFloat()
            setTextColor(color)
            includeFontPadding = false
            setLineSpacing(dp(2).toFloat(), 1f)
            if (bold) typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL)
        }
    fun heading(value: String, size: Int = 18) = text(value, size, ink, true).apply {
        if (Build.VERSION.SDK_INT >= 28) isAccessibilityHeading = true
    }
    fun icon(resource: Int, tint: Int = muted) = ImageView(activity).apply {
        setImageResource(resource)
        imageTintList = ColorStateList.valueOf(tint)
        importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
    }
    fun action(label: String, fill: Int = elevated, tint: Int = ink, click: () -> Unit) =
        Button(activity).apply {
            text = label
            textSize = 15f
            isAllCaps = false
            letterSpacing = 0f
            minHeight = dp(48)
            minimumHeight = dp(48)
            minWidth = dp(48)
            minimumWidth = dp(48)
            pad(12, 8)
            stateListAnimator = null
            setTextColor(tint)
            typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL)
            backgroundTintList = null
            background = press(fill, 10)
            setOnClickListener { click() }
        }
    fun iconButton(resource: Int, label: String, click: () -> Unit) = android.widget.ImageButton(activity).apply {
        setImageResource(resource)
        imageTintList = ColorStateList.valueOf(ink)
        contentDescription = label
        pad(12)
        background = press(Color.TRANSPARENT, 24)
        setOnClickListener { click() }
    }
    fun field(hintText: String, label: String, type: Int = InputType.TYPE_CLASS_TEXT) = EditText(activity).apply {
        inputType = type
        setSingleLine(true)
        hint = hintText
        contentDescription = label
        setHintTextColor(muted)
        setTextColor(ink)
        textSize = 16f
        minHeight = dp(48)
        pad(12, 8)
        background = shape(elevated, 8)
        isSaveEnabled = false
    }
    fun LinearLayout.card(title: String? = null): LinearLayout {
        val card = column().apply {
            pad(14)
            background = shape(panel, 14)
            if (title != null) item(heading(title, 17))
        }
        item(card, if (childCount > 0) 16 else 0)
        return card
    }
    fun LinearLayout.detail(label: String, value: String) {
        if (value.isEmpty()) return
        item(row().apply {
            val key = text(label, 13, muted)
            key.pad(0, 3)
            addView(key, LinearLayout.LayoutParams(0, WRAP, 0.8f))
            addView(text(value, 14).apply { gravity = Gravity.END }, LinearLayout.LayoutParams(0, WRAP, 1.2f))
        }, 7)
    }
    fun LinearLayout.empty(resource: Int, title: String, description: String) {
        item(column().apply {
            gravity = Gravity.CENTER
            pad(22, 42)
            background = shape(panel, 14, true)
            item(icon(resource, ink).apply {
                pad(18)
                background = shape(selected, 20)
            }, width = dp(64), height = dp(64))
            item(heading(title, 16).apply { gravity = Gravity.CENTER }, 18)
            item(text(description, 14, muted).apply { gravity = Gravity.CENTER }, 10)
        }, if (childCount == 0) 0 else 12)
    }
    fun LinearLayout.line() = item(View(activity).apply { setBackgroundColor(border) }, height = 1)
    fun TextView.limit(lines: Int) {
        maxLines = lines
        ellipsize = TextUtils.TruncateAt.END
    }
}

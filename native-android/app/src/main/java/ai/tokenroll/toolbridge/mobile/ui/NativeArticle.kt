package ai.tokenroll.toolbridge.mobile

import android.graphics.Bitmap
import android.graphics.Typeface
import android.os.Build
import android.os.CancellationSignal
import android.text.SpannableStringBuilder
import android.text.Spanned
import android.text.method.LinkMovementMethod
import android.text.style.ClickableSpan
import android.text.style.StrikethroughSpan
import android.text.style.StyleSpan
import android.text.style.TypefaceSpan
import android.view.View
import android.widget.Button
import android.widget.ImageView
import java.net.URI

private val mdLink = Regex("""(!?)\[([^\[\]\n]*)\]\(([^()\s]+)\)""")
private val prefix = Regex("""^(?:#{1,6}\s+|>\s*|[-+*]\s+|\d+\.\s+)""", RegexOption.MULTILINE)
private const val tick = '\u0060'
private val mdInline = Regex(mdLink.pattern + """|(\*\*|__|~~|\*|_|""" + tick + """)(.+?)\4""")
private val labelStyle = Regex("""(\*\*|__|~~|\*|_|""" + tick + """)(.+?)\1""")
private fun inlineStyle(mark: String): Any = when (mark) {
    "**", "__" -> StyleSpan(Typeface.BOLD)
    "*", "_" -> StyleSpan(Typeface.ITALIC)
    "~~" -> StrikethroughSpan()
    else -> TypefaceSpan("monospace")
}
private fun SpannableStringBuilder.appendLabel(label: String) {
    var cursor = 0
    for (match in labelStyle.findAll(label)) {
        append(label.substring(cursor, match.range.first))
        val start = length
        append(match.groupValues[2])
        setSpan(inlineStyle(match.groupValues[1]), start, length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
        cursor = match.range.last + 1
    }
    append(label.substring(cursor))
}

internal fun markdownPreview(value: String): String = mdLink.replace(value.take(2048)) {
    if (it.groupValues[1] == "!") "[图片]" else it.groupValues[2]
}.replace(prefix, "").filterNot { it == '*' || it == '_' || it == '~' || it == tick }
    .replace(Regex("""\s+"""), " ").trim()

internal fun safeArticleUrl(value: String, image: Boolean): URI? {
    if (value.length > 2048) return null
    val url = try { URI(value) } catch (_: Exception) { return null }
    val name = url.host?.trimEnd('.') ?: return null
    if (!url.scheme.equals("https", true) || url.rawUserInfo != null || url.port !in listOf(-1, 443)
        || (image && url.rawFragment != null) || ':' in name || name.isEmpty()) return null
    // URL handlers can interpret integer, octal or hexadecimal labels as numeric IP addresses.
    if (name.split('.').all { it.matches(Regex("""(?i)(?:\d+|0x[0-9a-f]+)""")) }) return null
    return url
}

internal fun NativePage.renderMarkdown(source: String) {
    val lines = source.lines()
    // Bound the view tree for long agent-authored articles. Preserve the complete fallback text.
    if (lines.size > 600 || source.length > 65536 ||
        mdInline.findAll(source).take(601).count() + lines.size > 600) {
        body.item(text(source, 16).apply { setTextIsSelectable(true) }, 16)
        return
    }
    var fence: String? = null
    val code = mutableListOf<String>()
    var imagesSeen = 0
    fun flushCode() {
        body.item(text(code.joinToString("\n"), 14).apply {
            typeface = Typeface.MONOSPACE
            setTextIsSelectable(true)
            background = shape(panel, 8)
            pad(12)
        }, 12)
        code.clear()
    }
    for (line in lines) {
        val left = line.trimStart()
        if (fence != null) {
            if (left.startsWith(fence) && left.trimEnd().trim(fence.first()).isEmpty()) {
                flushCode()
                fence = null
            } else code.add(line)
            continue
        }
        if (left.startsWith(tick.toString().repeat(3)) || left.startsWith("~~~")) {
            fence = left.takeWhile { it == left.first() }
            continue
        }
        if (line.isBlank()) continue
        if (line.startsWith("    ")) {
            code.add(line.removePrefix("    "))
            flushCode()
            continue
        }
        if (left.matches(Regex("""(?:-{3,}|\*{3,}|_{3,})"""))) {
            body.item(View(activity).apply { setBackgroundColor(border) }, 14, height = 1)
            continue
        }
        val heading = left.takeWhile { it == '#' }.length.takeIf { it in 1..6 && left.getOrNull(it) == ' ' } ?: 0
        val quote = left.startsWith('>')
        val raw = when {
            heading > 0 -> left.drop(heading).trimStart()
            quote -> left.drop(1).trimStart()
            left.startsWith("- ") || left.startsWith("* ") || left.startsWith("+ ") -> "•  " + left.drop(2)
            else -> line
        }
        var buffer = SpannableStringBuilder()
        fun flush() {
            if (buffer.isEmpty()) return
            val display = text(buffer, when (heading) { 0 -> 16; 1 -> 24; 2 -> 21; else -> 18 },
                if (quote) muted else ink, heading > 0)
            if (heading > 0 && Build.VERSION.SDK_INT >= 28) display.isAccessibilityHeading = true
            display.setTextIsSelectable(true)
            if (buffer.getSpans(0, buffer.length, ClickableSpan::class.java).isNotEmpty()) {
                display.movementMethod = LinkMovementMethod.getInstance()
                display.setLinkTextColor(ink)
            }
            if (quote) { display.background = shape(panel, 6); display.pad(12, 8) }
            body.item(display, if (heading > 0) 18 else 10)
            buffer = SpannableStringBuilder()
        }
        var next = 0
        for (match in mdInline.findAll(raw)) {
            buffer.append(raw.substring(next, match.range.first))
            val (_, bang, label, url, mark) = match.groupValues
            val styled = match.groupValues[5]
            if (bang == "!") {
                flush()
                imagesSeen++
                if (imagesSeen <= 4) articleImage(label.ifBlank { "Markdown 图片" }, url)
                else if (imagesSeen == 5) body.item(text("其余 Markdown 图片已省略（每条最多 4 张）。", 13, muted), 8)
            } else {
                val start = buffer.length
                if (mark.isEmpty()) buffer.appendLabel(label) else buffer.append(styled)
                val span: Any? = when {
                    mark.isNotEmpty() -> inlineStyle(mark)
                    safeArticleUrl(url, false) == null -> null
                    else -> object : ClickableSpan() {
                        override fun onClick(widget: View) = host.submit(this@renderMarkdown,
                            NativeScreenAction.OpenInboxLink(url), "openInboxLink", failure = "无法打开链接。")
                    }
                }
                if (span != null && start < buffer.length) buffer.setSpan(span, start, buffer.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
            }
            next = match.range.last + 1
        }
        buffer.append(raw.substring(next))
        flush()
    }
    if (fence != null) flushCode()
}

private fun NativePage.articleImage(alt: String, url: String) {
    val source = safeArticleUrl(url, true)
    val card = body.card(alt)
    card.item(text(source?.host?.let { "图片来源：$it" } ?: "图片地址无效", 13, muted), 6)
    lateinit var button: Button
    button = action("加载图片") {
        if (source == null) return@action
        val cancellation = CancellationSignal()
        images.add(cancellation)
        button.isEnabled = false
        button.text = "正在安全加载…"
        val done: (Bitmap?) -> Unit = { bitmap ->
            activity.runOnUiThread {
                if (!cancellation.isCanceled && images.remove(cancellation)) {
                    if (bitmap == null) {
                        button.text = "加载失败，重试"
                        button.isEnabled = true
                    } else {
                        card.removeAllViews()
                        card.item(ImageView(activity).apply {
                            adjustViewBounds = true
                            scaleType = ImageView.ScaleType.FIT_CENTER
                            contentDescription = alt
                            setImageBitmap(bitmap)
                        })
                    }
                }
            }
        }
        try { actions.resolveInboxImage(url, cancellation, done) } catch (_: Exception) { done(null) }
    }
    button.contentDescription = "加载 Markdown 图片：" + alt
    button.isEnabled = source != null
    card.item(button, 10)
}

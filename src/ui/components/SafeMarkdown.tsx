import MarkdownIt, { type Token } from 'markdown-it/browser'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Image, StyleSheet, Text, View } from 'react-native'

import { validateInboxImageSource } from '@/inbox/imagePolicy'
import { AccessibleAction } from '@/ui/components/AccessibleAction'
import { colors, radius, spacing } from '@/ui/theme'

import type { InboxImageSourceResolver, ResolvedInboxImage } from '@/inbox/imageSource'

const MAX_RENDER_TOKENS = 600
const MAX_IMAGES_PER_MESSAGE = 4

const markdownParser = new MarkdownIt({
  breaks: true,
  html: false,
  linkify: false,
  maxNesting: 20,
  typographer: false,
})

type InlineStyle = Readonly<{
  bold: boolean
  code: boolean
  italic: boolean
  strike: boolean
  underlined: boolean
}>

type InlineTextPart = Readonly<{
  key: string
  kind: 'text'
  style: InlineStyle
  text: string
}>

type InlineImagePart = Readonly<{
  alt: string
  key: string
  kind: 'image'
  source: string
}>

type InlinePart = InlineTextPart | InlineImagePart

type SafeMarkdownProps = Readonly<{
  imageResolver: InboxImageSourceResolver
  markdown: string
}>

export function SafeMarkdown({ imageResolver, markdown }: SafeMarkdownProps) {
  const tokens = useMemo(() => markdownParser.parse(markdown, {}), [markdown])
  const tokenCount = tokens.reduce((count, token) => count + 1 + (token.children?.length ?? 0), 0)
  if (tokenCount > MAX_RENDER_TOKENS) {
    return <Text selectable style={styles.paragraph}>{markdown}</Text>
  }

  const rendered: React.ReactNode[] = []
  const listStack: { index: number; ordered: boolean }[] = []
  let blockquoteDepth = 0
  let headingLevel = 0
  let imageCount = 0
  let listPrefix: string | null = null

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]
    if (token === undefined) continue
    if (token.type === 'blockquote_open') blockquoteDepth += 1
    if (token.type === 'blockquote_close') blockquoteDepth = Math.max(0, blockquoteDepth - 1)
    if (token.type === 'heading_open') headingLevel = Number(token.tag.slice(1)) || 1
    if (token.type === 'heading_close') headingLevel = 0
    if (token.type === 'bullet_list_open') listStack.push({ index: 0, ordered: false })
    if (token.type === 'ordered_list_open') {
      const start = Number(token.attrGet('start') ?? 1)
      listStack.push({ index: Number.isSafeInteger(start) ? start - 1 : 0, ordered: true })
    }
    if (token.type === 'bullet_list_close' || token.type === 'ordered_list_close') listStack.pop()
    if (token.type === 'list_item_open') {
      const list = listStack[listStack.length - 1]
      if (list !== undefined) {
        list.index += 1
        listPrefix = list.ordered ? `${list.index}.` : '•'
      }
    }
    if (token.type === 'list_item_close') listPrefix = null

    if (token.type === 'inline') {
      const parts = inlineParts(token.children ?? [], index)
      const content: React.ReactNode[] = []
      let textRun: InlineTextPart[] = []
      const flushText = () => {
        if (textRun.length === 0) return
        content.push(
          <Text key={`text-run-${index}-${content.length}`} selectable style={styles.inlineText}>
            {textRun.map(part => (
              <Text key={part.key} style={inlineTextStyle(part.style)}>{part.text}</Text>
            ))}
          </Text>,
        )
        textRun = []
      }
      for (const part of parts) {
        if (part.kind === 'text') {
          textRun.push(part)
          continue
        }
        flushText()
        imageCount += 1
        content.push(imageCount <= MAX_IMAGES_PER_MESSAGE ? (
          <SafeMarkdownImage
            alt={part.alt}
            imageResolver={imageResolver}
            key={part.key}
            source={part.source}
          />
        ) : (
          <Text key={part.key} style={styles.note}>其余 Markdown 图片已省略（每条最多 4 张）。</Text>
        ))
      }
      flushText()
      rendered.push(
        <View
          key={`inline-${index}`}
          style={[
            styles.block,
            blockquoteDepth > 0 ? styles.blockquote : null,
            listPrefix === null ? null : styles.listItem,
          ]}
        >
          {listPrefix === null ? null : <Text style={styles.listPrefix}>{listPrefix}</Text>}
          <View style={styles.blockContent}>
            {headingLevel === 0 ? content : (
              <Text accessibilityRole="header" style={headingStyle(headingLevel)}>
                {parts.filter((part): part is InlineTextPart => part.kind === 'text').map(part => (
                  <Text key={part.key} style={inlineTextStyle(part.style)}>{part.text}</Text>
                ))}
              </Text>
            )}
          </View>
        </View>,
      )
    }
    if (token.type === 'fence' || token.type === 'code_block') {
      rendered.push(
        <Text key={`code-${index}`} selectable style={styles.codeBlock}>{token.content}</Text>,
      )
    }
    if (token.type === 'hr') rendered.push(<View key={`rule-${index}`} style={styles.rule} />)
  }

  return <View style={styles.root}>{rendered}</View>
}

function inlineParts(tokens: readonly Token[], blockIndex: number): readonly InlinePart[] {
  const parts: InlinePart[] = []
  const style = { bold: false, code: false, italic: false, strike: false, underlined: false }
  const pushText = (text: string, index: number) => {
    if (text === '') return
    parts.push({ key: `inline-${blockIndex}-${index}`, kind: 'text', style: { ...style }, text })
  }
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]
    if (token === undefined) continue
    if (token.type === 'strong_open') style.bold = true
    else if (token.type === 'strong_close') style.bold = false
    else if (token.type === 'em_open') style.italic = true
    else if (token.type === 'em_close') style.italic = false
    else if (token.type === 's_open') style.strike = true
    else if (token.type === 's_close') style.strike = false
    else if (token.type === 'link_open') style.underlined = true
    else if (token.type === 'link_close') style.underlined = false
    else if (token.type === 'code_inline') {
      parts.push({
        key: `inline-${blockIndex}-${index}`,
        kind: 'text',
        style: { ...style, code: true },
        text: token.content,
      })
    } else if (token.type === 'softbreak' || token.type === 'hardbreak') pushText('\n', index)
    else if (token.type === 'image') {
      parts.push({
        alt: token.content.trim() || 'Markdown 图片',
        key: `image-${blockIndex}-${index}`,
        kind: 'image',
        source: String(token.attrGet('src') ?? ''),
      })
    } else if (token.type === 'text' || token.content !== '') pushText(token.content, index)
  }
  return parts
}

function inlineTextStyle(style: InlineStyle) {
  return [
    style.bold ? styles.bold : null,
    style.italic ? styles.italic : null,
    style.strike ? styles.strike : null,
    style.underlined ? styles.underlined : null,
    style.code ? styles.inlineCode : null,
  ]
}

function headingStyle(level: number) {
  if (level <= 1) return styles.heading1
  if (level === 2) return styles.heading2
  return styles.heading3
}

function SafeMarkdownImage({
  alt,
  imageResolver,
  source,
}: Readonly<{
  alt: string
  imageResolver: InboxImageSourceResolver
  source: string
}>) {
  const [failure, setFailure] = useState(false)
  const [loading, setLoading] = useState(false)
  const [resolved, setResolved] = useState<ResolvedInboxImage | null>(null)
  const currentAbort = useRef<AbortController | null>(null)
  const currentResolved = useRef<ResolvedInboxImage | null>(null)
  const mounted = useRef(true)

  const load = async () => {
    if (loading || resolved !== null) return
    setLoading(true)
    setFailure(false)
    const abortController = new AbortController()
    currentAbort.current = abortController
    try {
      const image = await imageResolver.resolve(source, abortController.signal)
      if (abortController.signal.aborted) {
        await image.release()
        return
      }
      currentResolved.current = image
      if (mounted.current) setResolved(image)
    } catch {
      if (mounted.current && !abortController.signal.aborted) setFailure(true)
    } finally {
      if (currentAbort.current === abortController) currentAbort.current = null
      if (mounted.current) setLoading(false)
    }
  }

  useEffect(() => () => {
    mounted.current = false
    currentAbort.current?.abort()
    currentAbort.current = null
    const image = currentResolved.current
    currentResolved.current = null
    void image?.release()
  }, [])
  const host = safeDisplayHost(source)

  if (resolved !== null) {
    return (
      <Image
        accessibilityLabel={alt}
        onError={() => {
          setFailure(true)
          setResolved(null)
          const image = currentResolved.current
          currentResolved.current = null
          void image?.release()
        }}
        resizeMode="contain"
        source={{ uri: resolved.uri }}
        style={[styles.image, { aspectRatio: resolved.width / resolved.height }]}
      />
    )
  }

  return (
    <View style={styles.imagePlaceholder}>
      <Text style={styles.imageAlt}>{alt}</Text>
      <Text style={styles.note}>{host === null ? '图片地址无效' : `图片来源：${host}`}</Text>
      {failure ? <Text style={styles.imageFailure}>图片未通过安全加载或加载失败。</Text> : null}
      <AccessibleAction
        busy={loading}
        disabled={host === null}
        label={`加载 Markdown 图片：${alt}`}
        onPress={() => { void load() }}
        variant="secondary"
        visualLabel={loading ? '正在安全加载…' : failure ? '重试加载图片' : '加载图片'}
      />
    </View>
  )
}

function safeDisplayHost(source: string): string | null {
  try {
    return validateInboxImageSource(source).host
  } catch {
    return null
  }
}

const styles = StyleSheet.create({
  block: { marginBottom: spacing.sm },
  blockContent: { flex: 1, gap: spacing.sm },
  blockquote: {
    borderLeftColor: colors.outline,
    borderLeftWidth: 3,
    paddingLeft: spacing.md,
  },
  bold: { fontWeight: '800' },
  codeBlock: {
    backgroundColor: colors.background,
    borderRadius: radius.sm,
    color: colors.text,
    fontFamily: 'monospace',
    fontSize: 13,
    lineHeight: 19,
    padding: spacing.md,
  },
  heading1: { color: colors.text, fontSize: 22, fontWeight: '800', lineHeight: 29 },
  heading2: { color: colors.text, fontSize: 19, fontWeight: '800', lineHeight: 26 },
  heading3: { color: colors.text, fontSize: 17, fontWeight: '800', lineHeight: 24 },
  image: { borderRadius: radius.sm, maxHeight: 360, width: '100%' },
  imageAlt: { color: colors.text, fontSize: 14, fontWeight: '700' },
  imageFailure: { color: colors.warning, fontSize: 13, lineHeight: 19 },
  imagePlaceholder: {
    backgroundColor: colors.background,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.md,
  },
  inlineCode: { backgroundColor: colors.background, fontFamily: 'monospace' },
  inlineText: { color: colors.text, fontSize: 15, lineHeight: 22 },
  italic: { fontStyle: 'italic' },
  listItem: { flexDirection: 'row' },
  listPrefix: { color: colors.primary, fontSize: 15, lineHeight: 22, minWidth: 24 },
  note: { color: colors.muted, fontSize: 12, lineHeight: 18 },
  paragraph: { color: colors.text, fontSize: 15, lineHeight: 22 },
  root: { gap: spacing.xs },
  rule: { backgroundColor: colors.border, height: 1, marginVertical: spacing.sm },
  strike: { textDecorationLine: 'line-through' },
  underlined: { color: colors.primary, textDecorationLine: 'underline' },
})

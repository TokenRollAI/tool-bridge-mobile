import MarkdownIt, { type Token } from 'markdown-it/browser'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Image, StyleSheet, Text, View } from 'react-native'

import { validateInboxImageSource } from '@/inbox/imagePolicy'
import { validateInboxLink } from '@/inbox/linkOpener'
import { AccessibleAction } from '@/ui/components/AccessibleAction'
import { radius, spacing, useThemedStyles, type ThemeColors } from '@/ui/theme'

import type { InboxImageSourceResolver, ResolvedInboxImage } from '@/inbox/imageSource'
import type { InboxLinkOpener } from '@/inbox/linkOpener'

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
}>

type InlineTextPart = Readonly<{
  href: string | null
  key: string
  kind: 'text'
  linkId: string | null
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
  linkOpener: InboxLinkOpener
  markdown: string
}>

export function SafeMarkdown({ imageResolver, linkOpener, markdown }: SafeMarkdownProps) {
  const styles = useThemedStyles(createStyles)
  const [linkFailure, setLinkFailure] = useState<string | null>(null)
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
            <InlineTextRun
              linkOpener={linkOpener}
              onFailure={setLinkFailure}
              parts={textRun}
            />
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
              <Text accessibilityRole="header" style={headingStyle(headingLevel, styles)}>
                <InlineTextRun
                  linkOpener={linkOpener}
                  onFailure={setLinkFailure}
                  parts={parts.filter((part): part is InlineTextPart => part.kind === 'text')}
                />
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

  return (
    <View style={styles.root}>
      {rendered}
      {linkFailure === null ? null : (
        <Text accessibilityRole="alert" style={styles.linkFailure}>{linkFailure}</Text>
      )}
    </View>
  )
}

function inlineParts(tokens: readonly Token[], blockIndex: number): readonly InlinePart[] {
  const parts: InlinePart[] = []
  const style = { bold: false, code: false, italic: false, strike: false }
  let href: string | null = null
  let linkId: string | null = null
  const pushText = (text: string, index: number) => {
    if (text === '') return
    parts.push({
      href,
      key: `inline-${blockIndex}-${index}`,
      kind: 'text',
      linkId,
      style: { ...style },
      text,
    })
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
    else if (token.type === 'link_open') {
      const rawHref = token.attrGet('href')
      href = rawHref === null ? null : String(rawHref)
      linkId = `link-${blockIndex}-${index}`
    } else if (token.type === 'link_close') {
      href = null
      linkId = null
    } else if (token.type === 'code_inline') {
      parts.push({
        href,
        key: `inline-${blockIndex}-${index}`,
        kind: 'text',
        linkId,
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

function InlineTextRun({
  linkOpener,
  onFailure,
  parts,
}: Readonly<{
  linkOpener: InboxLinkOpener
  onFailure(message: string | null): void
  parts: readonly InlineTextPart[]
}>) {
  const groups: { href: string | null; linkId: string | null; parts: InlineTextPart[] }[] = []
  for (const part of parts) {
    const previous = groups[groups.length - 1]
    if (previous?.linkId === part.linkId) previous.parts.push(part)
    else groups.push({ href: part.href, linkId: part.linkId, parts: [part] })
  }

  return <>{groups.map(group => (
    <InlineTextGroup
      group={group}
      key={group.parts[0]?.key}
      linkOpener={linkOpener}
      onFailure={onFailure}
    />
  ))}</>
}

function InlineTextGroup({
  group,
  linkOpener,
  onFailure,
}: Readonly<{
  group: Readonly<{ href: string | null; linkId: string | null; parts: readonly InlineTextPart[] }>
  linkOpener: InboxLinkOpener
  onFailure(message: string | null): void
}>) {
  const styles = useThemedStyles(createStyles)
  const styledText = group.parts.map(part => (
    <Text key={part.key} style={inlineTextStyle(part.style, styles)}>{part.text}</Text>
  ))
  if (group.href === null) return <Text>{styledText}</Text>

  try {
    validateInboxLink(group.href)
  } catch {
    return <Text style={styles.invalidLink}>{styledText}</Text>
  }

  const href = group.href
  return (
    <Text
      accessibilityHint="将在系统中打开该 HTTPS 链接"
      accessibilityRole="link"
      onPress={() => {
        onFailure(null)
        void linkOpener.open(href).catch(() => {
          onFailure('无法打开链接。')
        })
      }}
      style={styles.underlined}
    >
      {styledText}
    </Text>
  )
}

function inlineTextStyle(style: InlineStyle, styles: ReturnType<typeof createStyles>) {
  return [
    style.bold ? styles.bold : null,
    style.italic ? styles.italic : null,
    style.strike ? styles.strike : null,
    style.code ? styles.inlineCode : null,
  ]
}

function headingStyle(level: number, styles: ReturnType<typeof createStyles>) {
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
  const styles = useThemedStyles(createStyles)
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

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  block: { marginBottom: spacing.md },
  blockContent: { flex: 1, gap: spacing.sm },
  blockquote: {
    backgroundColor: colors.panelElevated,
    borderLeftColor: colors.primary,
    borderLeftWidth: 3,
    paddingLeft: spacing.md,
    paddingRight: spacing.md,
    paddingVertical: spacing.sm,
  },
  bold: { fontWeight: '800' },
  codeBlock: {
    backgroundColor: colors.panelElevated,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    color: colors.text,
    fontFamily: 'monospace',
    fontSize: 13,
    lineHeight: 21,
    padding: spacing.lg,
  },
  heading1: { color: colors.text, fontSize: 25, fontWeight: '800', letterSpacing: -0.5, lineHeight: 34, marginTop: spacing.sm },
  heading2: { color: colors.text, fontSize: 21, fontWeight: '700', letterSpacing: -0.3, lineHeight: 30, marginTop: spacing.sm },
  heading3: { color: colors.text, fontSize: 18, fontWeight: '700', lineHeight: 27, marginTop: spacing.xs },
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
  inlineCode: { backgroundColor: colors.panelElevated, fontFamily: 'monospace', fontSize: 14 },
  inlineText: { color: colors.text, fontSize: 16, lineHeight: 27 },
  italic: { fontStyle: 'italic' },
  invalidLink: { color: colors.muted, textDecorationLine: 'none' },
  listItem: { flexDirection: 'row' },
  listPrefix: { color: colors.primary, fontSize: 16, lineHeight: 27, minWidth: 28 },
  linkFailure: { color: colors.warning, fontSize: 13, lineHeight: 19 },
  note: { color: colors.muted, fontSize: 12, lineHeight: 18 },
  paragraph: { color: colors.text, fontSize: 16, lineHeight: 27 },
  root: { gap: spacing.xs },
  rule: { backgroundColor: colors.border, height: 1, marginVertical: spacing.lg },
  strike: { textDecorationLine: 'line-through' },
  underlined: { color: colors.primary, textDecorationLine: 'underline' },
})

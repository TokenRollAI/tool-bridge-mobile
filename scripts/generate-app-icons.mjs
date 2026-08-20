// 从 assets/icon/brand-mark.svg 这一份矢量源导出全部应用图标位图。
//
// 单一来源：品牌形状只在 brand-mark.svg 里维护，各平台变体的差异仅是画布尺寸、
// 底色、笔画色和标识占比。改完 SVG 跑 `pnpm icons:generate` 重新导出。
//
// 依赖外部命令 rsvg-convert（macOS: `brew install librsvg`）。它只在需要重新
// 导出图标时用到，因此不进 package.json 依赖，也不在 CI 的 verify 链路里执行；
// CI 校验的是已提交的 PNG（scripts/verify-app-icons.mjs）。
import { execFile } from 'node:child_process'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

const root = resolve(import.meta.dirname, '..')
const iconDirectory = join(root, 'assets', 'icon')
const source = join(iconDirectory, 'brand-mark.svg')

// 与 src/ui/theme.ts 的 background / primary 保持一致，图标和应用内视觉同源。
const BACKGROUND = '#08111f'
const PRIMARY = '#66d9c8'

// brand-mark.svg 的 viewBox：标识包围盒在原 1254px 网格中的位置。
const MARK_VIEW_BOX = { height: 480, width: 1048, x: 103, y: 441 }

/**
 * markWidthRatio: 标识宽度占画布边长的比例。两种画布的约束不同：
 *
 * - app-icon（iOS / 通用）只被圆角 squircle 裁切。标识宽扁且水平两端正好在
 *   垂直中线上，离四个圆角最远，所以可以放到 0.86 占满视觉重心。
 * - adaptive-icon（Android 前景层）会被厂商遮罩裁成圆形或 squircle。108dp
 *   画布中系统保证可见的只有居中 66dp 圆，即半径 33/108 ≈ 0.3056 倍边长。
 *   0.548 是把含笔画圆头在内的实际墨迹半对角压进该圆的上限（实测 0.3050），
 *   看着偏小但换来任何遮罩都切不到两端节点。verify:app-icons 会守住这条线。
 * - favicon 只有 48px，放大标识并大幅加粗笔画，否则细线会被抹平。
 */
const variants = [
  {
    background: BACKGROUND,
    file: 'app-icon.png',
    markWidthRatio: 0.86,
    size: 1024,
    stroke: PRIMARY,
    strokeWidth: 30,
  },
  {
    background: null,
    file: 'adaptive-icon.png',
    markWidthRatio: 0.548,
    size: 1024,
    stroke: PRIMARY,
    strokeWidth: 34,
  },
  {
    background: null,
    file: 'monochrome-icon.png',
    markWidthRatio: 0.548,
    size: 1024,
    stroke: '#ffffff',
    strokeWidth: 34,
  },
  {
    background: BACKGROUND,
    file: 'favicon.png',
    markWidthRatio: 0.84,
    size: 48,
    stroke: PRIMARY,
    strokeWidth: 62,
  },
]

const markup = await readFile(source, 'utf8')
const markBody = extractMarkBody(markup)

await mkdir(iconDirectory, { recursive: true })

for (const variant of variants) {
  const composed = composeVariant(variant, markBody)
  const temporary = join(iconDirectory, `.${variant.file}.svg`)
  await writeFile(temporary, composed, 'utf8')
  try {
    await execFileAsync('rsvg-convert', [
      '--width', String(variant.size),
      '--height', String(variant.size),
      '--output', join(iconDirectory, variant.file),
      temporary,
    ])
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error('未找到 rsvg-convert，请先安装 librsvg（macOS: brew install librsvg）')
    }
    throw error
  } finally {
    await rm(temporary, { force: true })
  }
  console.log(`导出 assets/icon/${variant.file}（${variant.size}×${variant.size}）`)
}

console.log('图标导出完成。')

/** 取出 brand-mark.svg 中承载全部形状的 <g> 块，连同其 stroke 属性一起复用。 */
function extractMarkBody(svg) {
  const match = /<g\b[^>]*>([\s\S]*)<\/g>/.exec(svg)
  if (match === null) throw new Error('brand-mark.svg 缺少预期的 <g> 形状分组')
  return match[1].trim()
}

function composeVariant({ background, markWidthRatio, size, stroke, strokeWidth }, body) {
  const markWidth = size * markWidthRatio
  const markHeight = markWidth * (MARK_VIEW_BOX.height / MARK_VIEW_BOX.width)
  const offsetX = (size - markWidth) / 2
  const offsetY = (size - markHeight) / 2
  const backgroundRect = background === null
    ? ''
    : `\n  <rect width="${size}" height="${size}" fill="${background}" />`
  const viewBox = `${MARK_VIEW_BOX.x} ${MARK_VIEW_BOX.y} ${MARK_VIEW_BOX.width} ${MARK_VIEW_BOX.height}`
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${backgroundRect}
  <svg x="${round(offsetX)}" y="${round(offsetY)}" width="${round(markWidth)}" height="${round(markHeight)}" viewBox="${viewBox}" overflow="visible">
    <g fill="none" stroke="${stroke}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round">
      ${body}
    </g>
  </svg>
</svg>
`
}

function round(value) {
  return Math.round(value * 1000) / 1000
}

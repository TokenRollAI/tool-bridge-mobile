// 校验已提交的应用图标资源，避免图标退回 Expo 默认或悄悄破掉平台约束。
//
// 不依赖 rsvg-convert：只读 PNG 头部与像素，因此可以在 CI 里跑。真正的重新导出
// 由 scripts/generate-app-icons.mjs 在本地完成。
import { Buffer } from 'node:buffer'
import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { inflateSync } from 'node:zlib'

const root = resolve(import.meta.dirname, '..')

// Android 自适应图标：108dp 画布里系统保证不被任何厂商遮罩裁掉的只有居中 66dp
// 圆，即半径 33/108 倍边长。前景层墨迹的包围盒半对角必须落在这个圆内。
const ADAPTIVE_SAFE_RADIUS_RATIO = 33 / 108

const expectations = [
  { alpha: false, file: 'assets/icon/app-icon.png', size: 1024 },
  { alpha: true, file: 'assets/icon/adaptive-icon.png', safeZone: true, size: 1024 },
  { alpha: true, file: 'assets/icon/monochrome-icon.png', safeZone: true, size: 1024 },
  { alpha: false, file: 'assets/icon/favicon.png', size: 48 },
]

const appConfig = await readFile(join(root, 'app.config.ts'), 'utf8')
for (const reference of [
  "icon: './assets/icon/app-icon.png'",
  "foregroundImage: './assets/icon/adaptive-icon.png'",
  "monochromeImage: './assets/icon/monochrome-icon.png'",
  "favicon: './assets/icon/favicon.png'",
]) {
  if (!appConfig.includes(reference)) {
    throw new Error(`app.config.ts 未引用图标资源: ${reference}`)
  }
}

for (const expectation of expectations) {
  const png = decodePng(await readFile(join(root, expectation.file)))
  if (png.width !== expectation.size || png.height !== expectation.size) {
    throw new Error(
      `${expectation.file} 必须是 ${expectation.size}×${expectation.size}，`
      + `实际 ${png.width}×${png.height}`,
    )
  }
  let transparent = false
  for (let index = 3; index < png.pixels.length; index += 4) {
    if (png.pixels[index] < 255) {
      transparent = true
      break
    }
  }
  if (expectation.alpha && !transparent) {
    throw new Error(`${expectation.file} 必须保留透明背景`)
  }
  if (!expectation.alpha && transparent) {
    throw new Error(`${expectation.file} 不得含透明像素（iOS 应用图标与 favicon 需不透明）`)
  }
  if (expectation.safeZone === true) {
    const radiusRatio = inkHalfDiagonalRatio(png)
    if (radiusRatio > ADAPTIVE_SAFE_RADIUS_RATIO) {
      throw new Error(
        `${expectation.file} 墨迹半对角 ${radiusRatio.toFixed(4)} 超出 Android 自适应图标安全区 `
        + `${ADAPTIVE_SAFE_RADIUS_RATIO.toFixed(4)}，厂商遮罩会裁掉标识`,
      )
    }
  }
}

console.log(
  '图标资源验证通过：四份图标尺寸与透明通道符合平台要求，'
  + 'Android 自适应前景落在 66dp 安全区内，app.config.ts 引用完整。',
)

/**
 * 最小 PNG 解码器，统一输出 8 位 RGBA。
 *
 * 只需支持 rsvg-convert 的输出形态：8 位、非隔行、colorType 2（RGB）或 6（RGBA）。
 * 其余形态直接报错，而不是猜测——图标资源由本仓库脚本生成，形态是确定的。
 */
function decodePng(buffer) {
  const signature = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])
  if (!buffer.subarray(0, 8).equals(signature)) throw new Error('不是有效的 PNG 文件')

  let header
  const dataParts = []
  for (let offset = 8; offset < buffer.length;) {
    const length = buffer.readUInt32BE(offset)
    const type = buffer.toString('ascii', offset + 4, offset + 8)
    const data = buffer.subarray(offset + 8, offset + 8 + length)
    if (type === 'IHDR') {
      header = {
        bitDepth: data.readUInt8(8),
        colorType: data.readUInt8(9),
        height: data.readUInt32BE(4),
        interlace: data.readUInt8(12),
        width: data.readUInt32BE(0),
      }
    } else if (type === 'IDAT') dataParts.push(data)
    else if (type === 'IEND') break
    offset += 12 + length
  }
  if (header === undefined) throw new Error('PNG 缺少 IHDR')
  if (header.bitDepth !== 8 || header.interlace !== 0) {
    throw new Error('仅支持 8 位非隔行 PNG')
  }
  if (header.colorType !== 2 && header.colorType !== 6) {
    throw new Error(`不支持的 PNG colorType ${header.colorType}`)
  }

  const channels = header.colorType === 6 ? 4 : 3
  const raw = inflateSync(Buffer.concat(dataParts))
  const stride = header.width * channels
  const lines = Buffer.alloc(header.height * stride)

  // 逐行撤销 PNG 的 5 种 filter，得到原始采样值。
  for (let y = 0; y < header.height; y += 1) {
    const filter = raw.readUInt8(y * (stride + 1))
    const source = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride)
    const target = lines.subarray(y * stride, (y + 1) * stride)
    const above = y === 0 ? null : lines.subarray((y - 1) * stride, y * stride)
    for (let index = 0; index < stride; index += 1) {
      const left = index >= channels ? target[index - channels] : 0
      const up = above === null ? 0 : above[index]
      const upLeft = above === null || index < channels ? 0 : above[index - channels]
      let value = source[index]
      if (filter === 1) value += left
      else if (filter === 2) value += up
      else if (filter === 3) value += Math.floor((left + up) / 2)
      else if (filter === 4) value += paeth(left, up, upLeft)
      else if (filter !== 0) throw new Error(`不支持的 PNG filter ${filter}`)
      target[index] = value & 0xFF
    }
  }

  if (channels === 4) return { ...header, pixels: lines }

  const pixels = Buffer.alloc(header.width * header.height * 4, 0xFF)
  for (let index = 0, target = 0; index < lines.length; index += 3, target += 4) {
    pixels[target] = lines[index]
    pixels[target + 1] = lines[index + 1]
    pixels[target + 2] = lines[index + 2]
  }
  return { ...header, pixels }
}

function paeth(left, up, upLeft) {
  const estimate = left + up - upLeft
  const distanceLeft = Math.abs(estimate - left)
  const distanceUp = Math.abs(estimate - up)
  const distanceUpLeft = Math.abs(estimate - upLeft)
  if (distanceLeft <= distanceUp && distanceLeft <= distanceUpLeft) return left
  return distanceUp <= distanceUpLeft ? up : upLeft
}

/** 取墨迹包围盒四角到画布中心的最大距离，归一化为边长的比例。 */
function inkHalfDiagonalRatio({ height, pixels, width }) {
  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (pixels[(y * width + x) * 4 + 3] <= 20) continue
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }
  if (maxX < 0) throw new Error('图标为空：未找到任何不透明像素')
  const centerX = width / 2
  const centerY = height / 2
  const halfDiagonal = Math.max(
    ...[[minX, minY], [maxX, minY], [minX, maxY], [maxX, maxY]].map(
      ([x, y]) => Math.hypot(x - centerX, y - centerY),
    ),
  )
  return halfDiagonal / width
}

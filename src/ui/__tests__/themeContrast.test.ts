import { colors } from '../theme'

function relativeLuminance(color: string): number {
  const channels = color.slice(1).match(/../gu)?.map(channel => Number.parseInt(channel, 16) / 255)
  if (channels === undefined || channels.length !== 3) throw new Error(`无效颜色: ${color}`)
  const [red, green, blue] = channels.map(channel => (
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  ))
  return 0.2126 * (red ?? 0) + 0.7152 * (green ?? 0) + 0.0722 * (blue ?? 0)
}

function contrast(left: string, right: string): number {
  const leftLuminance = relativeLuminance(left)
  const rightLuminance = relativeLuminance(right)
  return (Math.max(leftLuminance, rightLuminance) + 0.05)
    / (Math.min(leftLuminance, rightLuminance) + 0.05)
}

describe('theme contrast regression gate', () => {
  test.each([
    ['text/background', colors.text, colors.background],
    ['muted/background', colors.muted, colors.background],
    ['text/panel', colors.text, colors.panel],
    ['muted/panel', colors.muted, colors.panel],
  ])('%s 普通文字对比不低于 4.5:1', (_name, foreground, background) => {
    expect(contrast(foreground, background)).toBeGreaterThanOrEqual(4.5)
  })

  test.each([
    ['outline/panel', colors.outline, colors.panel],
    ['outline/background', colors.outline, colors.background],
    ['primary action', colors.background, colors.primary],
    ['danger action', colors.background, colors.danger],
  ])('%s 交互边界或控件文字对比不低于 3:1', (_name, foreground, background) => {
    expect(contrast(foreground, background)).toBeGreaterThanOrEqual(3)
  })
})

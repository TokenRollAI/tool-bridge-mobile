import { render } from '@testing-library/react-native'

import { CapabilitiesScreen } from '../CapabilitiesScreen'

import type { CapabilitySnapshot } from '@/capabilities/types'

const capability: CapabilitySnapshot = {
  availability: { status: 'available' },
  descriptor: {
    confirmation: 'never',
    description: '读取本机状态',
    effect: 'read',
    limits: {
      maxResultBytes: 1_024,
      rate: { maxGlobal: 10, maxPerCaller: 5, windowSeconds: 60 },
    },
    path: 'phone/status',
    queuePolicy: 'reject_offline',
    risk: 'low',
    tool: 'get',
  },
}

describe('CapabilitiesScreen', () => {
  test('页面、能力标题和 probe 结果具备关联后的可访问语义', async () => {
    const rendered = await render(
      <CapabilitiesScreen capabilities={[capability]} focused={false} />,
    )

    rendered.getByRole('header', { name: '能力' })
    rendered.getByRole('header', { name: 'phone/status.get' })
    rendered.getByRole('text', { name: 'effect / risk：read / low' })
    rendered.getByRole('text', { name: '确认：never' })
    rendered.getByRole('text', { name: 'availability：available' })
  })

  test('空态仍保留页面 header 和真实 probe 文案', async () => {
    const rendered = await render(<CapabilitiesScreen capabilities={[]} focused={false} />)
    rendered.getByRole('header', { name: '能力' })
    rendered.getByText('运行时尚未完成能力探测。')
  })
})

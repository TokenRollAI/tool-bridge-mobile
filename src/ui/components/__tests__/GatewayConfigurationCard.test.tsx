import { fireEvent, render, waitFor } from '@testing-library/react-native'

import { GatewayConfigurationCard } from '../GatewayConfigurationCard'

describe('GatewayConfigurationCard', () => {
  test('只提交 URL 与遮蔽的 API key，成功后从表单清空 secret', async () => {
    const onSave = jest.fn(async () => undefined)
    const rendered = await render(
      <GatewayConfigurationCard
        currentOrigin={null}
        defaultDeviceId="a1b2c3d4e5f6"
        onClear={jest.fn(async () => undefined)}
        onSave={onSave}
      />,
    )
    const originInput = rendered.getByLabelText('Gateway HTTPS URL')
    const apiKeyInput = rendered.getByLabelText('Tool Bridge API key')
    expect(apiKeyInput.props.secureTextEntry).toBe(true)

    await fireEvent.changeText(originInput, 'https://gateway.example.com/')
    await fireEvent.changeText(apiKeyInput, 'tb_sk_fixture_secret')
    await fireEvent.press(rendered.getByRole('button', {
      name: '保存 Gateway URL 和 API key 并连接',
    }))

    await waitFor(() => expect(onSave).toHaveBeenCalledWith({
      apiKey: 'tb_sk_fixture_secret',
      origin: 'https://gateway.example.com/',
    }))
    await waitFor(() => expect(apiKeyInput.props.value).toBe(''))
    expect(rendered.queryByText('tb_sk_fixture_secret')).toBeNull()
  })

  test('填写自定义设备 ID 时随保存一并提交', async () => {
    const onSave = jest.fn(async () => undefined)
    const rendered = await render(
      <GatewayConfigurationCard
        currentOrigin={null}
        defaultDeviceId="a1b2c3d4e5f6"
        onClear={jest.fn(async () => undefined)}
        onSave={onSave}
      />,
    )
    await fireEvent.changeText(rendered.getByLabelText('Gateway HTTPS URL'), 'https://gateway.example.com')
    await fireEvent.changeText(rendered.getByLabelText('Tool Bridge API key'), 'tb_sk_fixture_secret')
    await fireEvent.changeText(rendered.getByLabelText('自定义设备 ID'), ' my-phone ')
    await fireEvent.press(rendered.getByRole('button', {
      name: '保存 Gateway URL 和 API key 并连接',
    }))

    await waitFor(() => expect(onSave).toHaveBeenCalledWith({
      apiKey: 'tb_sk_fixture_secret',
      deviceId: 'my-phone',
      origin: 'https://gateway.example.com',
    }))
  })

  test('清除前要求二次确认，取消不会触发删除', async () => {
    const onClear = jest.fn(async () => undefined)
    const rendered = await render(
      <GatewayConfigurationCard
        currentOrigin="https://gateway.example.com"
        defaultDeviceId="a1b2c3d4e5f6"
        onClear={onClear}
        onSave={jest.fn(async () => undefined)}
      />,
    )

    await fireEvent.press(rendered.getByRole('button', { name: '清除网关连接配置' }))
    rendered.getByRole('header', { name: '确认清除本机连接配置？' })
    await fireEvent.press(rendered.getByRole('button', { name: '取消清除网关连接配置' }))
    expect(onClear).not.toHaveBeenCalled()

    await fireEvent.press(rendered.getByRole('button', { name: '清除网关连接配置' }))
    await fireEvent.press(rendered.getByRole('button', { name: '确认清除网关连接配置' }))
    await waitFor(() => expect(onClear).toHaveBeenCalledTimes(1))
    rendered.getByText('已停止当前连接并清除本机 API key。')
  })

  test('保存失败时不伪装成功且不把 API key 放进反馈', async () => {
    const rendered = await render(
      <GatewayConfigurationCard
        currentOrigin={null}
        defaultDeviceId="a1b2c3d4e5f6"
        onClear={jest.fn(async () => undefined)}
        onSave={jest.fn(async () => { throw new Error('Gateway URL 必须是有效的 HTTPS origin') })}
      />,
    )
    await fireEvent.changeText(rendered.getByLabelText('Gateway HTTPS URL'), 'not-a-url')
    await fireEvent.changeText(
      rendered.getByLabelText('Tool Bridge API key'),
      'tb_sk_fixture_secret',
    )
    await fireEvent.press(rendered.getByRole('button', {
      name: '保存 Gateway URL 和 API key 并连接',
    }))

    await waitFor(() => rendered.getByText('Gateway URL 必须是有效的 HTTPS origin'))
    expect(rendered.queryByText('tb_sk_fixture_secret')).toBeNull()
  })
})

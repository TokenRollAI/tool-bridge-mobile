import { fireEvent, render, waitFor } from '@testing-library/react-native'

import * as accessibility from '@/ui/accessibility'

import { ActivityScreen } from '../ActivityScreen'

import type { AuditRecord } from '@/audit/types'

const record: AuditRecord = {
  callerSubjectId: 'caller_subject_01',
  clientVersion: '0.1.0',
  commandId: 'command_01',
  decision: 'allowed',
  effect: 'write',
  id: 'audit_01',
  occurredAt: '2026-08-19T00:00:01.000Z',
  outcomeCode: 'succeeded',
  path: 'phone/productivity',
  risk: 'medium',
  tool: 'notify',
}

describe('ActivityScreen', () => {
  test('显示来源、时间、能力边界、决策和结果，但不展示载荷字段', async () => {
    const rendered = await render(
      <ActivityScreen onClearAuditHistory={jest.fn()} records={[record]} />,
    )

    rendered.getByRole('header', { name: '活动' })
    rendered.getByRole('header', { name: 'phone/productivity.notify' })
    rendered.getByLabelText('来源：caller_subject_01')
    rendered.getByLabelText('时间：2026-08-19T00:00:01.000Z')
    rendered.getByLabelText('影响：write')
    rendered.getByLabelText('风险：medium')
    rendered.getByLabelText('决策：allowed')
    rendered.getByLabelText('结果：succeeded')
    rendered.getByText(/最近 100 条/)
    rendered.getByText(/最多保留 5,000 条/)
    expect(rendered.queryByText('command_01')).toBeNull()
  })

  test('清除前明确二次确认；取消不会删除', async () => {
    const focus = jest.spyOn(accessibility, 'focusAccessibilityElement')
      .mockResolvedValue(undefined)
    const onClearAuditHistory = jest.fn(async () => 1)
    const rendered = await render(
      <ActivityScreen focused={false} onClearAuditHistory={onClearAuditHistory} records={[record]} />,
    )

    await fireEvent.press(rendered.getByRole('button', { name: '清除本机活动历史' }))
    rendered.getByRole('header', { name: '确认清除当前活动历史？' })
    expect(focus).toHaveBeenCalledTimes(1)
    rendered.getByText(/不可恢复/)
    rendered.getByText(/不会清除防重放记录、计时器、设置、installation identity 或凭证/)
    expect(onClearAuditHistory).not.toHaveBeenCalled()

    await fireEvent.press(rendered.getByRole('button', { name: '取消清除活动历史' }))
    expect(onClearAuditHistory).not.toHaveBeenCalled()
    expect(rendered.queryByText('确认清除当前活动历史？')).toBeNull()
    expect(focus).toHaveBeenCalledTimes(2)
    focus.mockRestore()
  })

  test('确认后报告删除数量，重复调用由 repository 返回真实数量', async () => {
    const onClearAuditHistory = jest.fn(async () => 1)
    const rendered = await render(
      <ActivityScreen onClearAuditHistory={onClearAuditHistory} records={[record]} />,
    )

    await fireEvent.press(rendered.getByRole('button', { name: '清除本机活动历史' }))
    await fireEvent.press(rendered.getByRole('button', { name: '确认清除活动历史' }))

    await waitFor(() => {
      expect(onClearAuditHistory).toHaveBeenCalledTimes(1)
      rendered.getByText('已清除 1 条本机活动历史；后续调用会继续记录。')
    })
    expect(rendered.queryByText('确认清除当前活动历史？')).toBeNull()
  })

  test('清除失败不显示成功，也不移除已有记录', async () => {
    const rendered = await render(
      <ActivityScreen
        onClearAuditHistory={jest.fn(async () => { throw new Error('sqlite failed') })}
        records={[record]}
      />,
    )

    await fireEvent.press(rendered.getByRole('button', { name: '清除本机活动历史' }))
    await fireEvent.press(rendered.getByRole('button', { name: '确认清除活动历史' }))

    await waitFor(() => rendered.getByText('清除失败；本机活动历史未被确认删除。'))
    rendered.getByRole('header', { name: 'phone/productivity.notify' })
    expect(rendered.queryByText(/已清除/)).toBeNull()
  })

  test('空历史仍可清除当前范围并诚实返回零条', async () => {
    const onClearAuditHistory = jest.fn(async () => 0)
    const rendered = await render(
      <ActivityScreen onClearAuditHistory={onClearAuditHistory} records={[]} />,
    )

    rendered.getByText('暂无远程调用记录。')
    await fireEvent.press(rendered.getByRole('button', { name: '清除本机活动历史' }))
    await fireEvent.press(rendered.getByRole('button', { name: '确认清除活动历史' }))
    await waitFor(() => rendered.getByText('已清除 0 条本机活动历史；后续调用会继续记录。'))
  })

  test('清除 pending 时确认与取消都暴露 busy/disabled state，避免重复提交', async () => {
    let resolveClear!: (deleted: number) => void
    const clearing = new Promise<number>(resolve => { resolveClear = resolve })
    const onClearAuditHistory = jest.fn(() => clearing)
    const rendered = await render(
      <ActivityScreen focused={false} onClearAuditHistory={onClearAuditHistory} records={[record]} />,
    )

    await fireEvent.press(rendered.getByRole('button', { name: '清除本机活动历史' }))
    await fireEvent.press(rendered.getByRole('button', { name: '确认清除活动历史' }))
    await waitFor(() => {
      expect(rendered.getByRole('button', { name: '确认清除活动历史' }).props.accessibilityState)
        .toEqual({ busy: true, disabled: true })
      expect(rendered.getByRole('button', { name: '取消清除活动历史' }).props.accessibilityState)
        .toEqual({ busy: true, disabled: true })
    })
    await fireEvent.press(rendered.getByRole('button', { name: '确认清除活动历史' }))
    expect(onClearAuditHistory).toHaveBeenCalledTimes(1)

    resolveClear(1)
    await waitFor(() => rendered.getByText('已清除 1 条本机活动历史；后续调用会继续记录。'))
  })
})

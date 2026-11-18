/**
 * Minimal reminders: one per new turn, only at or above 20% effective pressure,
 * with used/effective tokens, percentage, and a performance tier.
 *
 * 中文：极简提醒：每个新回合一条，仅有效窗口压力达到 20% 时注入；
 * 只包含已用/有效 token、百分比和性能档位。
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  REMINDER_MIN_RATIO,
  TIER_LONG_CONTEXT_TOKENS,
  TIER_LOW_EFFICIENCY_TOKENS,
  formatTokens,
  reminderTier,
  reminderTierLabel,
  reminderText,
  turnStartReminderDue,
} from '../lib/prompt.js'
import { FakeSession, foldSession } from './helpers.mjs'

const WINDOW = 792_576

test('20% of the effective window is the reminder floor', () => {
  assert.equal(REMINDER_MIN_RATIO, 0.20)
  assert.equal(turnStartReminderDue(true, false, 0.199), false)
  assert.equal(turnStartReminderDue(true, false, 0.20), true)
  assert.equal(turnStartReminderDue(true, false, 0.5), true)
  assert.equal(turnStartReminderDue(false, false, 0.5), false)
  assert.equal(turnStartReminderDue(true, true, 0.5), false)
})

test('tiers are based on used tokens, not the effective-window ratio', () => {
  assert.equal(reminderTier(TIER_LONG_CONTEXT_TOKENS), 'normal')
  assert.equal(reminderTier(TIER_LONG_CONTEXT_TOKENS + 1), 'long')
  assert.equal(reminderTier(TIER_LOW_EFFICIENCY_TOKENS), 'long')
  assert.equal(reminderTier(TIER_LOW_EFFICIENCY_TOKENS + 1), 'low-efficiency')
  assert.equal(reminderTierLabel('normal'), '普通')
  assert.equal(reminderTierLabel('long'), '长上下文')
  assert.equal(reminderTierLabel('low-efficiency'), '低效区')
})

test('the reminder is short, includes the tier, and contains no rule text', () => {
  const text = reminderText({ tokens: 108_000, window: WINDOW, ratio: 108_000 / WINDOW })
  assert.equal(text, '自觉压缩:上下文已用108K/793K(14%)·普通')
  assert.doesNotMatch(text, /来自自觉压缩工具|compress|spans|摘要|锚点|建议|必须|请/)
  assert.equal(
    reminderText({ tokens: 300_000, window: WINDOW, ratio: 300_000 / WINDOW }),
    '自觉压缩:上下文已用300K/793K(38%)·长上下文',
  )
  assert.equal(
    reminderText({ tokens: 520_000, window: WINDOW, ratio: 520_000 / WINDOW }),
    '自觉压缩:上下文已用520K/793K(66%)·低效区',
  )
})

test('token formatting stays compact', () => {
  assert.equal(formatTokens(999), '999')
  assert.equal(formatTokens(1_000), '1K')
  assert.equal(formatTokens(256_000), '256K')
  assert.equal(formatTokens(792_576), '793K')
  assert.equal(formatTokens(1_000_000), '1.0M')
})

test('a folded notice restores the last reminder from the session log', () => {
  const session = new FakeSession()
  session.turnStart()
  session.append('user/message', {
    id: 'notice-1',
    role: 'user',
    content: [{ type: 'text', text: '自觉压缩:上下文已用1K/793K(0%)·普通' }],
    source: { kind: 'context-decay', form: 'notice', atTokens: 1234, ratio: 0.0017 },
  }, { surfaceOp: 'append' })
  const state = foldSession(session)
  assert.equal(state.lastReminderTokens, 1234)
  assert.equal(state.lastReminderTurn, 1)
})

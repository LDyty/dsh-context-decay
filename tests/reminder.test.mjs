/**
 * Minimal reminders: one message per 2.5% of the effective window, with only
 * used/effective tokens and the percentage.
 *
 * 中文：极简提醒：有效窗口每增长 2.5% 一条，只包含已用/有效 token 和百分比。
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  REMINDER_STEP_RATIO,
  decideReminder,
  formatTokens,
  reminderStepTokens,
  reminderText,
  turnStartReminderDue,
} from '../lib/prompt.js'
import { FakeSession, foldSession } from './helpers.mjs'

const WINDOW = 744_000
const STEP = Math.floor(WINDOW * REMINDER_STEP_RATIO)

test('2.5% of the effective window is the reminder step', () => {
  assert.equal(REMINDER_STEP_RATIO, 0.025)
  assert.equal(STEP, 18_600)
  assert.equal(reminderStepTokens(WINDOW), STEP)
  assert.equal(reminderStepTokens(1), 1)
})

test('the first observation is a silent baseline, then each 2.5% growth reminds once', () => {
  const first = decideReminder({ tokens: 50_000, window: WINDOW, lastTokens: 0 })
  assert.deepEqual(first, { plan: null, baseline: true })
  const below = decideReminder({ tokens: 50_000 + STEP - 1, window: WINDOW, lastTokens: 50_000 })
  assert.deepEqual(below, { plan: null, baseline: false })
  const atStep = decideReminder({ tokens: 50_000 + STEP, window: WINDOW, lastTokens: 50_000 })
  assert.deepEqual(atStep, { plan: { atTokens: 68_600 }, baseline: false })
})

test('a compression resets the baseline silently', () => {
  const reset = decideReminder({ tokens: 8_000, window: WINDOW, lastTokens: 43_000 })
  assert.deepEqual(reset, { plan: null, baseline: true })
  const grown = decideReminder({ tokens: 8_000 + STEP, window: WINDOW, lastTokens: 8_000 })
  assert.deepEqual(grown, { plan: { atTokens: 26_600 }, baseline: false })
})

test('a new turn above one third gets exactly one turn-start reminder', () => {
  assert.equal(turnStartReminderDue(0.4, true, false), true)
  assert.equal(turnStartReminderDue(1 / 3, true, false), false)
  assert.equal(turnStartReminderDue(0.2, true, false), false)
  assert.equal(turnStartReminderDue(0.4, false, false), false)
  assert.equal(turnStartReminderDue(0.4, true, true), false)
})

test('the reminder is Chinese, minimal, and contains no rule text', () => {
  const text = reminderText({ tokens: 108_000, window: WINDOW, ratio: 108_000 / WINDOW })
  assert.match(text, /^来自自觉压缩工具的提醒：/)
  assert.match(text, /已用 108K\/744K/)
  assert.match(text, /（15%）/)
  assert.doesNotMatch(text, /compress|spans|from|to|摘要|锚点|建议|必须|请/)
  assert.equal(text, '来自自觉压缩工具的提醒：已用 108K/744K（15%）。')
})

test('token formatting stays compact', () => {
  assert.equal(formatTokens(999), '999')
  assert.equal(formatTokens(1_000), '1K')
  assert.equal(formatTokens(744_000), '744K')
  assert.equal(formatTokens(1_000_000), '1.0M')
})

test('a folded notice restores the reminder baseline from the session log', () => {
  const session = new FakeSession()
  session.turnStart()
  session.append('user/message', {
    id: 'notice-1',
    role: 'user',
    content: [{ type: 'text', text: '来自自觉压缩工具的提醒：已用 1K/744K（0%）。' }],
    source: { kind: 'context-decay', form: 'notice', atTokens: 1234, ratio: 0.0017 },
  }, { surfaceOp: 'append' })
  const state = foldSession(session)
  assert.equal(state.lastReminderTokens, 1234)
  assert.equal(state.lastReminderTurn, 1)
})

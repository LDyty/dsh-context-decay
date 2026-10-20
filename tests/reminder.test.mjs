/**
 * Tiered reminders: one normal reminder per growth step, one warning per
 * pressure threshold crossed upward (the last level is critical).
 *
 * 中文：分级提醒：每增长一步发一条普通提醒，每向上越过一档压力阈值发一条警告（最后一
 * 级是 critical）。
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { decideReminder, reminderText, warningLevel } from '../lib/prompt.js'
import { foldAll } from '../lib/state.js'
import { resolveConfig } from '../lib/config.js'
import { FakeSession } from './helpers.mjs'

const WINDOW = 744_000
const POLICY = { growthTokens: 20_000, warnRatios: [0.70, 0.81, 0.95], cooldownTurns: 1 }

function state(overrides = {}) {
  return {
    tokens: 0,
    window: WINDOW,
    lastTokens: 0,
    lastLevel: 0,
    openTurn: 3,
    lastReminderTurn: null,
    ...overrides,
  }
}

test('warningLevel counts the ascending thresholds that were reached', () => {
  assert.equal(warningLevel(0.0, POLICY.warnRatios), 0)
  assert.equal(warningLevel(0.699, POLICY.warnRatios), 0)
  assert.equal(warningLevel(0.70, POLICY.warnRatios), 1)
  assert.equal(warningLevel(0.809, POLICY.warnRatios), 1)
  assert.equal(warningLevel(0.81, POLICY.warnRatios), 2)
  assert.equal(warningLevel(0.949, POLICY.warnRatios), 2)
  assert.equal(warningLevel(0.95, POLICY.warnRatios), 3)
  assert.equal(warningLevel(1.2, POLICY.warnRatios), 3)
})

test('the first observation is a silent baseline, then growth steps trigger the normal reminder', () => {
  assert.deepEqual(decideReminder(state({ tokens: 50_000 }), POLICY), { plan: null, level: 0, baseline: true })
  assert.equal(decideReminder(state({ tokens: 60_000, lastTokens: 50_000 }), POLICY).plan, null)
  const atStep = decideReminder(state({ tokens: 70_000, lastTokens: 50_000 }), POLICY)
  assert.deepEqual(atStep, { plan: { kind: 'normal', level: 0, growth: 20_000 }, level: 0, baseline: false })
})

test('the normal reminder respects the turn cooldown; warnings bypass it', () => {
  const sameTurn = state({ tokens: 80_000, lastTokens: 50_000, lastReminderTurn: 3, openTurn: 3 })
  assert.equal(decideReminder(sameTurn, POLICY).plan, null)
  const nextTurn = state({ tokens: 80_000, lastTokens: 50_000, lastReminderTurn: 3, openTurn: 4 })
  assert.equal(decideReminder(nextTurn, POLICY).plan.kind, 'normal')

  const warningSameTurn = state({
    tokens: 0.82 * WINDOW,
    lastTokens: 100_000,
    lastLevel: 1,
    lastReminderTurn: 3,
    openTurn: 3,
  })
  assert.deepEqual(
    decideReminder(warningSameTurn, POLICY).plan,
    { kind: 'warning', level: 2, growth: null },
  )
})

test('each warning level fires once, in order, and stays silent until pressure drops', () => {
  const w1 = decideReminder(state({ tokens: 0.70 * WINDOW }), POLICY)
  assert.equal(w1.plan.kind, 'warning')
  assert.equal(w1.plan.level, 1)
  assert.equal(decideReminder(state({ tokens: 0.75 * WINDOW, lastLevel: 1 }), POLICY).plan, null)

  const w2 = decideReminder(state({ tokens: 0.82 * WINDOW, lastLevel: 1 }), POLICY)
  assert.equal(w2.plan.level, 2)
  const w3 = decideReminder(state({ tokens: 0.96 * WINDOW, lastLevel: 2 }), POLICY)
  assert.equal(w3.plan.level, 3)
  assert.equal(decideReminder(state({ tokens: 0.96 * WINDOW, lastLevel: 3 }), POLICY).plan, null)

  const dropped = decideReminder(state({ tokens: 0.50 * WINDOW, lastLevel: 3 }), POLICY)
  assert.deepEqual(dropped, { plan: null, level: 0, baseline: false })
  const again = decideReminder(state({ tokens: 0.82 * WINDOW, lastLevel: 0 }), POLICY)
  assert.equal(again.plan.level, 2)
})

test('a compression drop resets the growth baseline instead of suppressing reminders', () => {
  const afterCompress = decideReminder(state({ tokens: 8_000, lastTokens: 43_000, lastLevel: 1 }), POLICY)
  assert.deepEqual(afterCompress, { plan: null, level: 0, baseline: true })
  const grown = decideReminder(state({ tokens: 30_000, lastTokens: 8_000 }), POLICY)
  assert.equal(grown.plan.kind, 'normal')
  assert.equal(grown.plan.growth, 22_000)
})

test('reminder text distinguishes normal, graded warnings, and the critical level', () => {
  const normal = reminderText({
    kind: 'normal', level: 0, levels: 3, tokens: 50_000, window: WINDOW, ratio: 50_000 / WINDOW,
    growth: 20_000, firstPosition: 4, endPosition: 20,
  })
  assert.match(normal, /Context grew by ~20K tokens since the last reminder/)
  assert.match(normal, /When convenient, compress fully consumed history/)
  assert.doesNotMatch(normal, /immediately|fold/i)
  assert.match(normal, /from:"⟦p4⟧", to:"⟦p20⟧"/)
  assert.doesNotMatch(normal, /integer inside/)

  const warning = reminderText({
    kind: 'warning', level: 1, levels: 3, tokens: 520_000, window: WINDOW, ratio: 520_000 / WINDOW,
    growth: null, firstPosition: 4, endPosition: 20,
  })
  assert.match(warning, /warning 1\/3/)
  assert.match(warning, /Context pressure is 70%/)
  assert.match(warning, /Consider compressing fully consumed history at the next natural break/)
  assert.doesNotMatch(warning, /immediately|fold/i)

  const high = reminderText({
    kind: 'warning', level: 2, levels: 3, tokens: 0.82 * WINDOW, window: WINDOW, ratio: 0.82,
    growth: null, firstPosition: 4, endPosition: 20,
  })
  assert.match(high, /warning 2\/3/)
  assert.match(high, /Plan to compress fully consumed history soon/)
  assert.doesNotMatch(high, /immediately|fold/i)

  const critical = reminderText({
    kind: 'warning', level: 3, levels: 3, tokens: 0.96 * WINDOW, window: WINDOW, ratio: 0.96,
    growth: null, firstPosition: 4, endPosition: 20,
  })
  assert.match(critical, /^CRITICAL: context pressure is 96%/)
  assert.match(critical, /Compress fully consumed history immediately/)
  assert.doesNotMatch(critical, /drop/i)
  assert.doesNotMatch(critical, /Consider compressing|fold/i)
})

test('a folded notice restores the reminder level and baseline from the session log', () => {
  const session = new FakeSession()
  session.turnStart()
  session.append('user/message', {
    id: 'notice-1',
    role: 'user',
    content: [{ type: 'text', text: 'reminder' }],
    source: { kind: 'context-decay', form: 'notice', level: 2, atTokens: 1234, ratio: 0.82 },
  }, { surfaceOp: 'append' })
  const state = foldAll(session.snapshotEvents())
  assert.equal(state.lastReminderLevel, 2)
  assert.equal(state.lastReminderTokens, 1234)
  assert.equal(state.lastReminderTurn, 1)
})

test('configuration resolves the reminder tiers and rejects malformed ratios', () => {
  const defaults = resolveConfig({})
  assert.equal(defaults.growthTokens, 20_000)
  assert.deepEqual(defaults.warnRatios, [0.70, 0.81, 0.95])
  assert.equal(defaults.reminderCooldownTurns, 1)
  assert.deepEqual(resolveConfig({ growthTokens: 2_000, warnRatios: [0.5, 0.9] }).warnRatios, [0.5, 0.9])
  assert.throws(() => resolveConfig({ growthTokens: 0 }), /growthTokens/)
  assert.throws(() => resolveConfig({ warnRatios: [] }), /non-empty/)
  assert.throws(() => resolveConfig({ warnRatios: 'x' }), /non-empty/)
  assert.throws(() => resolveConfig({ warnRatios: [0.8, 0.7] }), /strictly ascending/)
  assert.throws(() => resolveConfig({ warnRatios: [0.7, 0.7] }), /strictly ascending/)
  assert.throws(() => resolveConfig({ warnRatios: [0, 0.5] }), /\(0, 1\]/)
  assert.throws(() => resolveConfig({ warnRatios: [0.5, 1.2] }), /\(0, 1\]/)
  assert.throws(() => resolveConfig({ warnRatios: [1, 2, 3, 4, 5, 6] }), /at most 5/)
})

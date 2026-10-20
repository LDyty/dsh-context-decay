/**
 * P3 projection tests: the host-side `contextDecay` unit is a pure JSON fold
 * whose view matches the replay used by the decorator and tools.
 *
 * 中文：P3 projection 测试：宿主侧 `contextDecay` 单元是纯 JSON fold，其视图与
 * decorator 和 tools 使用的重放一致。
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { compressRange, longConversation } from './helpers.mjs'
import { foldAll } from '../lib/state.js'
import { contextDecayProjection, createContextDecayProjection } from '../lib/projection.js'

function foldProjection(events) {
  let state = contextDecayProjection.init()
  for (const event of events) state = contextDecayProjection.apply(state, event)
  return state
}

test('the projection view matches the replay after appends and a fold', () => {
  const session = longConversation(2)
  let state = foldProjection(session.snapshotEvents())
  let view = contextDecayProjection.wire.view(state)
  let replay = foldAll(session.snapshotEvents())
  assert.deepEqual(view.nodes.map(node => node.left), replay.nodes.filter(node => node.left !== null).map(node => node.left))
  assert.deepEqual(
    view.nodes.map(node => node.seq),
    replay.nodes.filter(node => node.left !== null).map(node => node.seq),
    'the wire order is surface/context order, not anchor-id or log-seq order',
  )
  assert.deepEqual(view.free, replay.free)
  assert.equal(view.nextPosition, replay.nextPosition)
  assert.equal(view.openTurn, replay.openTurn)
  assert.equal(view.nodes.some(node => node.block), false)

  const visible = replay.nodes.filter(node => node.left !== null)
  compressRange(session, visible[0].seq, visible[1].seq, 'A projected summary with enough characters.')
  state = foldProjection(session.snapshotEvents())
  view = contextDecayProjection.wire.view(state)
  replay = foldAll(session.snapshotEvents())
  assert.deepEqual(view.nodes.map(node => node.left), replay.nodes.filter(node => node.left !== null).map(node => node.left))
  assert.deepEqual(view.free, replay.free)
  const block = view.nodes.find(node => node.block)
  assert.equal(block.left, 0)
  assert.equal(block.right, 2)
  assert.equal(block.tier, 1)
})

test('unrelated events keep the state reference; relevant events fork it', () => {
  const state = contextDecayProjection.init()
  assert.equal(contextDecayProjection.apply(state, { type: 'job/registered', seq: 0, time: 0, data: {} }), state)
  assert.equal(contextDecayProjection.apply(state, { type: 'plugin/unknown', seq: 1, time: 0, data: {} }), state)
  const next = contextDecayProjection.apply(state, { type: 'turn/start', seq: 2, time: 0, data: { turn: 4 } })
  assert.notEqual(next, state)
  assert.equal(next.openTurn, 4)
  assert.equal(state.openTurn, null, 'the prior state must stay untouched')
})

test('a corrupt persisted state is rejected so the registry refolds', () => {
  assert.throws(() => contextDecayProjection.stateSchema.parse({ nodes: [] }), /lacks nodes\/free/)
  assert.throws(() => contextDecayProjection.stateSchema.parse(null), /not an object/)
  const parsed = contextDecayProjection.stateSchema.parse(contextDecayProjection.init())
  assert.equal(parsed.nextPosition, 0)
  assert.deepEqual(parsed.free, [])
})

test('the projection merges the host pressure, reminder, and request snapshot', () => {
  const session = longConversation(1)
  const runtime = {
    pressure: {
      tokens: 47_200,
      window: 744_000,
      totalWindow: 1_000_000,
      reservedOutput: 256_000,
      ratio: 0.0634,
      source: 'meter',
      windowSource: 'request',
      reservationSource: 'header',
      level: 0,
      warnRatios: [0.7, 0.81, 0.95],
    },
    reminder: { lastTokens: 40_000, lastLevel: 0, lastTurn: 9, growth: 7_200, nextGrowthAt: 60_000, cooldownTurns: 1 },
    request: {
      sessionIndex: 37,
      processIndex: 12,
      messages: 14,
      anchors: 9,
      first: 0,
      last: 7,
      blocks: 1,
      overheadTokens: 18,
      time: '2026-10-20T02:00:00.000Z',
    },
  }
  const projection = createContextDecayProjection(() => runtime)
  let state = projection.init({ id: 'session-test' })
  for (const event of session.snapshotEvents()) state = projection.apply(state, event)
  const view = projection.wire.view(state)
  assert.equal(view.v, 5)
  assert.deepEqual(view.pressure, runtime.pressure)
  assert.deepEqual(view.reminder, runtime.reminder)
  assert.deepEqual(view.request, runtime.request)
})

test('the projection selects runtime facts by the owning session id', () => {
  const runtimeFor = {
    a: {
      pressure: { tokens: 11, window: 744_000, totalWindow: 1_000_000, reservedOutput: 256_000, ratio: 0.0001, source: 'meter', windowSource: 'request', reservationSource: 'header', level: 0, warnRatios: [0.7, 0.81, 0.95] },
      reminder: null,
      request: null,
    },
    b: {
      pressure: { tokens: 22, window: 744_000, totalWindow: 1_000_000, reservedOutput: 256_000, ratio: 0.0002, source: 'meter', windowSource: 'request', reservationSource: 'header', level: 0, warnRatios: [0.7, 0.81, 0.95] },
      reminder: null,
      request: null,
    },
  }
  const projection = createContextDecayProjection(sessionId => runtimeFor[sessionId])
  const a = projection.init({ id: 'a' })
  const b = projection.init({ id: 'b' })
  assert.equal(projection.wire.view(a).pressure.tokens, 11)
  assert.equal(projection.wire.view(b).pressure.tokens, 22)
  assert.throws(
    () => projection.stateSchema.parse({ ...projection.init({ id: 'a' }), sessionId: 7 }),
    /non-string sessionId/,
  )
})

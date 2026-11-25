/**
 * Anchor-space tests: recycled anchors are reused, survivors keep their
 * handles, block boundaries stay referenced, and replay is deterministic.
 *
 * 中文：锚点空间测试：回收锚点会被复用、存活节点保持自己的句柄、摘要块边界保持引用，
 * 以及重放确定性。
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fakePluginContext, foldSession, longConversation } from './helpers.mjs'
import { StateCache } from '../lib/state.js'
import { resolveConfig } from '../lib/config.js'
import { registerTools } from '../lib/tools.js'

function harness(session, overrides = {}) {
  const ctx = fakePluginContext()
  const cache = new StateCache()
  const config = resolveConfig({ minSummaryChars: 20, maxSummaryChars: 10_000, ...overrides })
  registerTools(ctx, {
    config,
    stateOf: subject => cache.stateOf(subject),
    log: () => {},
  })
  const tools = Object.fromEntries(ctx.registered.map(definition => [definition.name, definition]))
  const exec = { agent: { session }, signal: new AbortController().signal }
  return { call: (name, args) => tools[name].execute(args, exec) }
}

function visibleAnchors(state) {
  return state.nodes.filter(node => node.left !== null).map(node => node.left)
}

function snapshot(state) {
  return JSON.stringify({
    nodes: state.nodes.map(node => ({ seq: node.seq, left: node.left, right: node.right, block: node.block })),
    free: state.free,
    refs: Object.entries(state.refs).sort(([left], [right]) => left.localeCompare(right)),
    allocated: state.allocated,
    anchorPool: state.anchorPool,
    anchorCounter: state.anchorCounter,
    reusedPositions: state.reusedPositions,
  })
}

test('a recycled anchor is reused while survivors keep their anchors', async () => {
  const session = longConversation(2)
  const harnessed = harness(session)
  let state = foldSession(session)
  const anchors = visibleAnchors(state)
  await harnessed.call('compress', {
    from: anchors[0],
    summary: 'The completed history was summarized and its inner anchor was freed.',
  })
  state = foldSession(session)
  assert.ok(state.free.includes(anchors[1]))
  const survivor = anchors.at(-1)
  assert.ok(visibleAnchors(state).includes(survivor))

  session.user('a message that arrives after the fold')
  state = foldSession(session)
  const newest = state.nodes.filter(node => node.left !== null).at(-1)
  assert.equal(newest.left, anchors[1])
  const after = visibleAnchors(state)
  assert.equal(new Set(after).size, after.length)
  assert.equal(state.reusedPositions, 1)
})

test('re-compressing one block keeps its boundary references', async () => {
  const session = longConversation(2)
  const harnessed = harness(session)
  let state = foldSession(session)
  const anchors = visibleAnchors(state)
  await harnessed.call('compress', {
    from: anchors[0],
    summary: 'First summary with enough detail to be accepted.',
  })
  state = foldSession(session)
  const block = state.nodes.find(node => node.block)
  assert.ok(block)
  const freeBefore = [...state.free]
  const refsBefore = { left: state.refs[block.left], right: state.refs[block.right] }
  assert.ok(refsBefore.left >= 1)
  assert.ok(refsBefore.right >= 1)

  await harnessed.call('compress', {
    from: block.left,
    summary: 'The same block, folded again with a shorter summary.',
  })
  state = foldSession(session)
  assert.equal(state.nodes.filter(node => node.block).length, 1)
  assert.equal(state.nodes.find(node => node.block).tier, 2)
  assert.deepEqual(state.free, freeBefore)
  assert.equal(state.refs[block.left], refsBefore.left)
  assert.equal(state.refs[block.right], refsBefore.right)
})

test('replaying the same log twice produces the same anchor space', async () => {
  const session = longConversation(3)
  const harnessed = harness(session)
  let state = foldSession(session)
  const anchors = visibleAnchors(state)
  await harnessed.call('compress', {
    from: anchors[0],
    summary: 'First summary with enough detail to be accepted.',
  })
  session.user('a later message that reuses a released anchor')
  const first = foldSession(session)
  const second = foldSession(session)
  assert.equal(snapshot(first), snapshot(second))
  assert.ok(first.reusedPositions > 0)
  // the incremental cache agrees with a full replay
  // 中文：增量缓存与全量重放结果一致
  const cache = new StateCache()
  const incremental = cache.stateOf(session)
  assert.equal(snapshot(incremental), snapshot(first))
})

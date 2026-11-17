/**
 * Anchor-space tests: recycled anchors are reused, survivors keep their
 * handles, shared boundaries stay refcounted, and replay is deterministic.
 *
 * 中文：锚点空间测试：回收锚点会被复用、存活节点保持自己的句柄、共享边界保持引用计数，
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
  const config = resolveConfig({ minSummaryChars: 20, maxSummaryChars: 8_000, ...overrides })
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
  let anchors = visibleAnchors(state)
  await harnessed.call('compress', {
    spans: [{ from: anchors[0], to: anchors[2], summary: 'The first exchange was summarized and its inner anchor was freed.' }],
  })
  state = foldSession(session)
  assert.deepEqual(state.free, [anchors[1]])
  const survivor = anchors[4]
  assert.ok(visibleAnchors(state).includes(survivor))

  session.user('a message that arrives after the fold')
  state = foldSession(session)
  const newest = state.nodes.filter(node => node.left !== null).at(-1)
  assert.equal(newest.left, anchors[1])
  const after = visibleAnchors(state)
  assert.equal(new Set(after).size, after.length)
  assert.equal(state.reusedPositions, 1)

  // Re-compressing the same pair keeps that pair and frees nothing.
  // 中文：重新压缩同一 pair 会保留该 pair，不释放任何锚点。
  const block = state.nodes.find(node => node.block)
  await harnessed.call('compress', {
    spans: [{ from: block.left, to: block.right, summary: 'The same span, folded again with a shorter summary.' }],
  })
  state = foldSession(session)
  assert.deepEqual(state.free, [])
})

test('a shared boundary stays reserved until both references release it', async () => {
  const session = longConversation(2)
  const harnessed = harness(session)
  let state = foldSession(session)
  const anchors = visibleAnchors(state)
  await harnessed.call('compress', { spans: [{ from: anchors[0], to: anchors[2], summary: 'First summary with enough detail to be accepted.' }] })
  await harnessed.call('compress', { spans: [{ from: anchors[2], to: anchors[4], summary: 'Second summary with enough detail to be accepted.' }] })
  state = foldSession(session)
  assert.deepEqual(state.free, [anchors[1], anchors[3]])
  // anchors[2] is block1's right boundary and block2's left anchor
  // 中文：anchors[2] 既是 block1 的右边界，也是 block2 的左锚点
  assert.equal(state.refs[anchors[2]], 2)

  await harnessed.call('compress', { spans: [{ from: anchors[0], to: anchors[4], summary: 'Merged summary with enough detail to be accepted.' }] })
  state = foldSession(session)
  const blocks = state.nodes.filter(node => node.block)
  assert.equal(blocks.length, 1)
  assert.deepEqual([blocks[0].left, blocks[0].right, blocks[0].tier], [anchors[0], anchors[4], 2])
  assert.deepEqual(state.free, [anchors[1], anchors[2], anchors[3]])
  assert.equal(state.refs[anchors[2]], undefined)
})

test('replaying the same log twice produces the same anchor space', async () => {
  const session = longConversation(3)
  const harnessed = harness(session)
  let state = foldSession(session)
  const anchors = visibleAnchors(state)
  await harnessed.call('compress', { spans: [{ from: anchors[0], to: anchors[2], summary: 'First summary with enough detail to be accepted.' }] })
  await harnessed.call('compress', { spans: [{ from: anchors[2], to: anchors[4], summary: 'Second summary with enough detail to be accepted.' }] })
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

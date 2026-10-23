/**
 * Position-space tests: monotonic allocation, survivor stability, refcounted
 * shared boundaries, release on merge/drop, and deterministic replay.
 *
 * 中文：位置空间测试：单调分配、存活节点稳定性、引用计数共享边界、merge/drop
 * 释放，以及确定性重放。
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fakePluginContext, longConversation, compressRange } from './helpers.mjs'
import { StateCache, foldAll } from '../lib/state.js'
import { resolveConfig } from '../lib/config.js'
import { registerTools } from '../lib/tools.js'

function harness(session, overrides = {}) {
  const ctx = fakePluginContext()
  const cache = new StateCache()
  const config = resolveConfig({ minSummaryChars: 20, maxSummaryChars: 8_000, ...overrides })
  registerTools(ctx, {
    config,
    stateOf: subject => cache.stateOf(subject),
    pressure: () => ({
      tokens: 0,
      window: 60_000,
      ratio: 0,
      totalWindow: 60_000,
      reservedOutput: 0,
      windowSource: 'config',
      reservationSource: 'config',
      source: 'estimate',
    }),
    log: () => {},
  })
  const tools = Object.fromEntries(ctx.registered.map(definition => [definition.name, definition]))
  const exec = { agent: { session }, signal: new AbortController().signal }
  return { call: (name, args) => tools[name].execute(args, exec) }
}

function stateOf(session) {
  return foldAll(session.snapshotEvents())
}

function visibleLeaves(state) {
  return state.nodes.filter(node => node.left !== null).map(node => node.left)
}

function snapshot(state) {
  return JSON.stringify({
    nodes: state.nodes.map(node => ({ seq: node.seq, left: node.left, right: node.right, block: node.block })),
    free: state.free,
    refs: Object.entries(state.refs).map(([position, count]) => [Number(position), count]).sort((left, right) => left[0] - right[0]),
    nextPosition: state.nextPosition,
    reusedPositions: state.reusedPositions,
  })
}

test('legacy summaries keep the old lowest-free allocation for old sessions', async () => {
  const session = longConversation(2)
  const initial = foldAll(session.snapshotEvents())
  const first = initial.nodes.find(node => node.left === 0)
  const second = initial.nodes.find(node => node.left === 1)
  compressRange(session, first.seq, second.seq, 'Legacy summary that must keep the old anchor sequence.', { anchorMode: null })
  let state = foldAll(session.snapshotEvents())
  assert.equal(state.anchorMode, 'legacy')

  session.user('a message that arrives after a legacy fold')
  state = foldAll(session.snapshotEvents())
  // old sessions keep the legacy lowest-free sequence, so the new message takes 1
  // 中文：旧会话保留 legacy 的最小空闲序列，所以新消息拿到 1
  assert.deepEqual(visibleLeaves(state), [0, 2, 3, 4, 1])
  assert.equal(state.reusedPositions, 1)
})

test('released ids are never reused and survivors keep their anchors', async () => {
  const session = longConversation(2)
  const harnessed = harness(session)
  await harnessed.call('compress', {
    spans: [{ from: 0, to: 2, summary: 'The first exchange was summarized and its ids were released.' }],
  })
  let state = stateOf(session)
  assert.deepEqual(visibleLeaves(state), [0, 2, 3, 4])
  assert.deepEqual(state.free, [1])
  const survivor = state.nodes.find(node => node.left === 4)

  session.user('a message that arrives after the fold')
  state = stateOf(session)
  // released ids stay dead: the newest message appends after the high-water mark
  // 中文：释放的 id 保持死亡：最新消息追加到高水位之后
  assert.deepEqual(visibleLeaves(state), [0, 2, 3, 4, 5])
  assert.equal(state.nodes.filter(node => node.left !== null).at(-1).left, 5)
  assert.equal(state.nodes.find(node => node.seq === survivor.seq).left, 4)
  assert.equal(state.reusedPositions, 0)
  assert.equal(new Set(visibleLeaves(state)).size, visibleLeaves(state).length)

  // re-compressing the same pair keeps the pair and does not revive released ids
  // 中文：重新压缩同一 pair 会保留该 pair，不会复活已释放的 id
  await harnessed.call('compress', {
    spans: [{ from: 0, to: 2, summary: 'The same span, folded again with a shorter summary.' }],
  })
  state = stateOf(session)
  assert.deepEqual(state.free, [1])
  assert.deepEqual(visibleLeaves(state), [0, 2, 3, 4, 5])
})

test('a shared boundary stays reserved until both references release it', async () => {
  const session = longConversation(2)
  const harnessed = harness(session)
  await harnessed.call('compress', { spans: [{ from: 0, to: 2, summary: 'First summary with enough detail to be accepted.' }] })
  await harnessed.call('compress', { spans: [{ from: 2, to: 4, summary: 'Second summary with enough detail to be accepted.' }] })
  let state = stateOf(session)
  assert.deepEqual(state.free, [1, 3])
  // 2 is block1's right boundary and block2's left anchor
  // 中文：2 既是 block1 的右边界，也是 block2 的左锚点
  assert.equal(state.refs[2], 2)

  await harnessed.call('drop', { from: 0, to: 2 })
  state = stateOf(session)
  assert.deepEqual(state.free, [0, 1, 3])
  assert.equal(state.refs[2], 1)

  session.user('a message after the first block was dropped')
  state = stateOf(session)
  assert.equal(visibleLeaves(state).at(-1), 5)
  // the surviving block still owns 2
  // 中文：存活块仍然拥有 2
  assert.equal(state.nodes.find(node => node.block).left, 2)
  assert.equal(state.refs[2], 1)

  await harnessed.call('drop', { from: 2, to: 4 })
  state = stateOf(session)
  assert.deepEqual(state.free, [0, 1, 2, 3])
  assert.equal(state.refs[2], undefined)
  session.user('a message after both blocks were dropped')
  state = stateOf(session)
  assert.equal(visibleLeaves(state).at(-1), 6)
})

test('merging adjacent blocks releases the inner boundary', async () => {
  const session = longConversation(2)
  const harnessed = harness(session)
  await harnessed.call('compress', { spans: [{ from: 0, to: 2, summary: 'First summary with enough detail to be accepted.' }] })
  await harnessed.call('compress', { spans: [{ from: 2, to: 4, summary: 'Second summary with enough detail to be accepted.' }] })
  assert.deepEqual(stateOf(session).free, [1, 3])
  await harnessed.call('compress', { spans: [{ from: 0, to: 4, summary: 'Merged summary with enough detail to be accepted.' }] })
  const state = stateOf(session)
  const blocks = state.nodes.filter(node => node.block)
  assert.equal(blocks.length, 1)
  assert.deepEqual([blocks[0].left, blocks[0].right, blocks[0].tier], [0, 4, 2])
  assert.deepEqual(state.free, [1, 2, 3])
  assert.equal(state.refs[2], undefined)
})

test('replaying the same log twice produces the same position space', async () => {
  const session = longConversation(3)
  const harnessed = harness(session)
  await harnessed.call('compress', { spans: [{ from: 0, to: 2, summary: 'First summary with enough detail to be accepted.' }] })
  await harnessed.call('compress', { spans: [{ from: 2, to: 4, summary: 'Second summary with enough detail to be accepted.' }] })
  session.user('a later message that does not reuse a released id')
  await harnessed.call('drop', { from: 0, to: 2 })
  session.user('another later message')
  const first = foldAll(session.snapshotEvents())
  const second = foldAll(session.snapshotEvents())
  assert.equal(snapshot(first), snapshot(second))
  assert.equal(first.reusedPositions, 0)
  // the incremental cache agrees with a full replay
  // 中文：增量缓存与全量重放结果一致
  const cache = new StateCache()
  const incremental = cache.stateOf(session)
  assert.equal(snapshot(incremental), snapshot(first))
})

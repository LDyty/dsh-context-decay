import assert from 'node:assert/strict'
import { test } from 'node:test'
import { compressRange, longConversation, tailSession } from './helpers.mjs'
import { estimateTextTokens, foldAll, observedMessageOf } from '../lib/state.js'

test('appends allocate distinct positions and skip non-addressable nodes', () => {
  const session = longConversation(2)
  const state = foldAll(session.snapshotEvents())
  const visible = state.nodes.filter(node => node.left !== null)
  assert.deepEqual(visible.map(node => node.left), [0, 1, 2, 3, 4])
  // the system prompt and the tool-call-only assistant turn are not addressable
  // 中文：system prompt 和只有 tool-call 的 assistant 回合不可寻址
  assert.equal(state.nodes.filter(node => node.left === null).length, 2)
  assert.deepEqual(visible.map(node => node.role), ['user', 'assistant', 'user', 'assistant', 'user'])
})

test('a summary replacement creates a block with the next visible position as its right boundary', () => {
  const session = longConversation(2)
  let state = foldAll(session.snapshotEvents())
  const first = state.nodes.find(node => node.left === 0)
  const last = state.nodes.find(node => node.left === 1)
  compressRange(session, first.seq, last.seq, 'Summarized early context that no longer matters.')
  state = foldAll(session.snapshotEvents())
  const block = state.nodes.find(node => node.block)
  assert.equal(block.left, 0)
  assert.equal(block.right, 2)
  assert.equal(block.tier, 1)
  assert.equal(block.summaryChars, 'Summarized early context that no longer matters.'.length)
})

test('re-compressing one block keeps its pair and increments the tier', () => {
  const session = longConversation(2)
  let state = foldAll(session.snapshotEvents())
  const first = state.nodes.find(node => node.left === 0)
  const last = state.nodes.find(node => node.left === 1)
  compressRange(session, first.seq, last.seq, 'First summary with enough characters to pass.')
  state = foldAll(session.snapshotEvents())
  const block = state.nodes.find(node => node.block)
  compressRange(session, block.seq, block.seq, 'Shorter second summary with enough characters.')
  state = foldAll(session.snapshotEvents())
  const recompressed = state.nodes.find(node => node.block)
  assert.equal(recompressed.left, block.left)
  assert.equal(recompressed.right, block.right)
  assert.equal(recompressed.tier, 2)
})

test('merging adjacent blocks uses the outer pair and the maximum inner tier plus one', () => {
  const session = longConversation(2)
  let state = foldAll(session.snapshotEvents())
  let node0 = state.nodes.find(node => node.left === 0)
  let node1 = state.nodes.find(node => node.left === 1)
  compressRange(session, node0.seq, node1.seq, 'First block summary with enough characters.')
  state = foldAll(session.snapshotEvents())
  const block1 = state.nodes.find(node => node.block)
  node0 = state.nodes.find(node => node.left === 2)
  node1 = state.nodes.find(node => node.left === 3)
  compressRange(session, node0.seq, node1.seq, 'Second block summary with enough characters.')
  state = foldAll(session.snapshotEvents())
  const blocks = state.nodes.filter(node => node.block)
  assert.equal(blocks.length, 2)
  const merged = compressRange(session, block1.seq, blocks[1].seq, 'Merged outer summary with enough characters.')
  state = foldAll(session.snapshotEvents())
  const only = state.nodes.filter(node => node.block)
  assert.equal(only.length, 1)
  assert.equal(only[0].left, 0)
  assert.equal(only[0].right, 4)
  assert.equal(only[0].tier, 2)
  assert.equal(only[0].messageId, merged.id)
})

test('appending after a tail block closes its right boundary at the reused lowest free id', () => {
  const session = tailSession()
  let state = foldAll(session.snapshotEvents())
  const visible = state.nodes.filter(node => node.left !== null)
  const first = visible[0]
  const last = visible.at(-1)
  compressRange(session, first.seq, last.seq, 'Tail summary covering everything up to the end.')
  state = foldAll(session.snapshotEvents())
  assert.equal(state.nodes.find(node => node.block).right, null)
  assert.deepEqual(state.free, [1, 2, 3])
  session.user('a new question arrives after the tail block')
  state = foldAll(session.snapshotEvents())
  // the freed ids are reused lowest-first, not appended after the high-water mark
  // 中文：释放的 id 按最低优先复用，不会追加到高水位之后
  assert.equal(state.nodes.filter(node => node.left !== null).at(-1).left, 1)
  assert.equal(state.nodes.find(node => node.block).right, 1)
  assert.equal(state.reusedPositions, 1)
})

test('text estimation separates ASCII prose from other scripts', () => {
  assert.equal(estimateTextTokens('abcd'), 1)
  assert.equal(estimateTextTokens('上下文衰减压缩'), 7)
  assert.equal(estimateTextTokens(''), 0)
})

test('observedMessageOf reads user messages directly and wrapped messages from data.message', () => {
  const session = longConversation(1)
  const events = session.snapshotEvents()
  const user = events.find(event => event.type === 'user/message')
  assert.equal(observedMessageOf(user).message.role, 'user')
  const assistant = events.find(event => event.type === 'assistant/message')
  assert.equal(observedMessageOf(assistant).message.role, 'assistant')
  assert.equal(observedMessageOf({ type: 'turn/start', seq: 0, time: 0, data: { turn: 1 } }), null)
})

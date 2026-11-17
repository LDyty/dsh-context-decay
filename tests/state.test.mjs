import assert from 'node:assert/strict'
import { test } from 'node:test'
import { compressRange, foldSession, longConversation, tailSession } from './helpers.mjs'
import { estimateTextTokens, observedMessageOf } from '../lib/state.js'

function visible(state) {
  return state.nodes.filter(node => node.left !== null)
}

test('appends allocate distinct anchors and skip non-addressable nodes', () => {
  const session = longConversation(2)
  const state = foldSession(session)
  const nodes = visible(state)
  assert.equal(nodes.length, 5)
  for (const node of nodes) assert.match(node.left, /^[a-z0-9]{4}$/)
  assert.equal(new Set(nodes.map(node => node.left)).size, nodes.length)
  // the system prompt and the tool-call-only assistant turn are not addressable
  // 中文：system prompt 和只有 tool-call 的 assistant 回合不可寻址
  assert.equal(state.nodes.filter(node => node.left === null).length, 2)
  assert.deepEqual(nodes.map(node => node.role), ['user', 'assistant', 'user', 'assistant', 'user'])
})

test('a summary replacement creates a block with the next visible anchor as its right boundary', () => {
  const session = longConversation(2)
  let state = foldSession(session)
  let nodes = visible(state)
  compressRange(session, nodes[0].seq, nodes[1].seq, 'Summarized early context that no longer matters.')
  state = foldSession(session)
  const block = state.nodes.find(node => node.block)
  assert.equal(block.left, nodes[0].left)
  assert.equal(block.right, nodes[2].left)
  assert.equal(block.tier, 1)
  assert.equal(block.summaryChars, 'Summarized early context that no longer matters.'.length)
})

test('re-compressing one block keeps its pair and increments the tier', () => {
  const session = longConversation(2)
  let state = foldSession(session)
  const nodes = visible(state)
  compressRange(session, nodes[0].seq, nodes[1].seq, 'First summary with enough characters to pass.')
  state = foldSession(session)
  const block = state.nodes.find(node => node.block)
  compressRange(session, block.seq, block.seq, 'Shorter second summary with enough characters.')
  state = foldSession(session)
  const recompressed = state.nodes.find(node => node.block)
  assert.equal(recompressed.left, block.left)
  assert.equal(recompressed.right, block.right)
  assert.equal(recompressed.tier, 2)
})

test('merging adjacent blocks uses the outer pair and the maximum inner tier plus one', () => {
  const session = longConversation(2)
  let state = foldSession(session)
  let nodes = visible(state)
  compressRange(session, nodes[0].seq, nodes[1].seq, 'First block summary with enough characters.')
  state = foldSession(session)
  const block1 = state.nodes.find(node => node.block)
  nodes = visible(state)
  const secondStart = nodes.find(node => !node.block)
  const secondEnd = visible(state).filter(node => !node.block)[1]
  compressRange(session, secondStart.seq, secondEnd.seq, 'Second block summary with enough characters.')
  state = foldSession(session)
  const blocks = state.nodes.filter(node => node.block)
  assert.equal(blocks.length, 2)
  const merged = compressRange(session, block1.seq, blocks[1].seq, 'Merged outer summary with enough characters.')
  state = foldSession(session)
  const only = state.nodes.filter(node => node.block)
  assert.equal(only.length, 1)
  assert.equal(only[0].left, block1.left)
  assert.equal(only[0].right, state.nodes.filter(node => node.left !== null).at(-1).left)
  assert.equal(only[0].tier, 2)
  assert.equal(only[0].messageId, merged.id)
})

test('appending after a tail block closes its right boundary at a recycled anchor', () => {
  const session = tailSession()
  let state = foldSession(session)
  const nodes = visible(state)
  compressRange(session, nodes[0].seq, nodes.at(-1).seq, 'Tail summary covering everything up to the end.')
  state = foldSession(session)
  const block = state.nodes.find(node => node.block)
  assert.equal(block.right, null)
  const recycled = state.free[0]
  assert.ok(recycled)
  session.user('a new question arrives after the tail block')
  state = foldSession(session)
  const appended = state.nodes.filter(node => node.left !== null).at(-1)
  assert.equal(appended.left, recycled)
  assert.equal(state.nodes.find(node => node.block).right, recycled)
  assert.equal(state.reusedPositions, 1)
})

test('text estimation separates ASCII prose from other scripts', () => {
  assert.equal(estimateTextTokens('abcd'), 1)
  assert.equal(estimateTextTokens('上下文自觉压缩'), 7)
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

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { FakeSession, compressRange, dropBlock, longConversation, tailSession } from './helpers.mjs'
import { foldAll, observedMessageOf } from '../lib/state.js'
import { anchorDecorations, applyDecoration, decorationOverheadTokens, mergeDecorations } from '../lib/render.js'

/**
 * Derive the fake session's model-visible messages and their decorations.
 * 中文：派生假 session 的模型可见消息及其装饰。
 */
export function decorate(session) {
  const state = foldAll(session.snapshotEvents())
  const messages = []
  for (const seq of session.surface.nodes) {
    const observed = observedMessageOf(session.snapshotEvents()[seq])
    if (observed === null) continue
    const message = observed.message
    if (message.role === 'system' || message.role === 'developer') continue
    if (message.role === 'assistant' && message.content.length === 0) continue
    messages.push(message)
  }
  const decorations = anchorDecorations(state, messages)
  const rendered = messages.map((message, index) => applyDecoration(message, decorations[index]))
  return {
    state,
    messages,
    decorations,
    rendered,
    texts: rendered.map(message => message.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('')),
  }
}

test('every anchorable message gets a leading position anchor', () => {
  const session = longConversation(2)
  const { texts, decorations } = decorate(session)
  assert.deepEqual(
    texts.slice(0, 5).map(text => text.match(/^⟦p(\d+)⟧/)?.[1]),
    ['0', '1', '2', '3', '4'],
  )
  assert.equal(texts.length, 6)
  // the tool-call-only current-turn assistant has no position and no anchor
  // 中文：只有 tool-call 的当前回合 assistant 没有位置，也没有锚点
  assert.equal(texts.at(-1), '')
  assert.equal(decorations.at(-1), undefined)
})

test('assistant decoration rewrites the existing text block and preserves block count', () => {
  const session = longConversation(1)
  const { messages, rendered } = decorate(session)
  const original = messages.find(message => message.role === 'assistant')
  const decorated = rendered.find(message => message.id === original.id)
  assert.equal(decorated.content.length, original.content.length)
  for (let index = 0; index < original.content.length; index += 1) {
    assert.equal(decorated.content[index].type, original.content[index].type)
  }
  assert.match(decorated.content.find(block => block.type === 'text').text, /^⟦p1⟧ /)
})

test('an assistant message without a text block is never decorated with a new block', () => {
  const session = new FakeSession()
  session.turnStart()
  session.user('question')
  session.assistant({ toolCalls: [{ id: 'call-1', name: 'read' }] })
  const state = foldAll(session.snapshotEvents())
  const messages = []
  for (const seq of session.surface.nodes) {
    const observed = observedMessageOf(session.snapshotEvents()[seq])
    if (observed !== null) messages.push(observed.message)
  }
  const decorations = anchorDecorations(state, messages)
  const assistant = messages.find(message => message.role === 'assistant')
  const decorated = applyDecoration(assistant, decorations[messages.indexOf(assistant)])
  assert.equal(decorated, assistant)
  assert.equal(decorated.content.length, 1)
})

test('a summary block renders prefix plus a suffix only when no visible node owns its right boundary', () => {
  const session = longConversation(2)
  let state = foldAll(session.snapshotEvents())
  compressRange(session, state.nodes.find(node => node.left === 0).seq, state.nodes.find(node => node.left === 1).seq,
    'First summary of the oldest exchange with enough detail.')
  const first = decorate(session)
  assert.match(first.texts[0], /^⟦p0⟧ First summary/)
  assert.doesNotMatch(first.texts[0], /⟦p2⟧/)
  assert.match(first.texts[1], /^⟦p2⟧ /)

  // A second block starts at the first one's right boundary; after the second is dropped,
  // the first must print its own right boundary or it would appear to cover more.
  // 中文：第二个块从第一个块的右边界开始；第二个块被 drop 后，第一个块必须自己打印右边界，
  // 否则会看起来覆盖了更多内容。
  state = first.state
  compressRange(session, state.nodes.find(node => node.left === 2).seq, state.nodes.find(node => node.left === 3).seq,
    'Second summary of the next exchange with enough detail.')
  const adjacent = decorate(session)
  assert.match(adjacent.texts[0], /^⟦p0⟧ First summary/)
  assert.match(adjacent.texts[1], /^⟦p2⟧ Second summary/)

  const secondBlock = foldAll(session.snapshotEvents()).nodes.find(node => node.block && node.left === 2)
  dropBlock(session, secondBlock.seq)
  const afterDrop = decorate(session)
  assert.match(afterDrop.texts[0], /^⟦p0⟧ First summary.* ⟦p2⟧$/)
  assert.match(afterDrop.texts[1], /^⟦p4⟧ /)
})

test('a tail summary has no suffix until new content is appended', () => {
  const session = tailSession()
  const state = foldAll(session.snapshotEvents())
  const visible = state.nodes.filter(node => node.left !== null)
  compressRange(session, visible[0].seq, visible.at(-1).seq, 'Tail summary covering the whole visible history.')
  const folded = decorate(session)
  assert.match(folded.texts[0], /^⟦p0⟧ Tail summary/)
  assert.doesNotMatch(folded.texts[0], /⟦p\d+⟧$/)
})

test('anchor overhead prices every prefix and only the suffixes actually rendered', () => {
  const session = longConversation(1)
  const state = foldAll(session.snapshotEvents())
  // three anchored messages → `⟦p0⟧ `, `⟦p1⟧ `, `⟦p2⟧ ` = 3 tokens each
  // 中文：三条带锚点消息 → `⟦p0⟧ `、`⟦p1⟧ `、`⟦p2⟧ `，各 3 token
  assert.equal(decorationOverheadTokens(state), 9)

  const folded = longConversation(2)
  const before = foldAll(folded.snapshotEvents())
  compressRange(folded, before.nodes.find(node => node.left === 0).seq, before.nodes.find(node => node.left === 1).seq,
    'Summary priced with its prefix but no rendered suffix here.')
  const after = foldAll(folded.snapshotEvents())
  // block prefix + three surviving messages; the block's right boundary is
  // owned by the next visible message, so no suffix tokens are charged
  // 中文：块前缀 + 三条存活消息；块的右边界由下一个可见消息负责，所以不计后缀 token
  assert.equal(decorationOverheadTokens(after), 12)
})

test('leading copied anchors are stripped from assistant replies at the request boundary', () => {
  const message = {
    role: 'assistant',
    content: [{ type: 'text', text: '⟦p99⟧ ⟦p98⟧ Hello' }],
  }
  const decorated = applyDecoration(message, { prefix: '⟦p7⟧ ' })
  assert.equal(decorated.content[0].text, '⟦p7⟧ Hello')

  const plain = {
    role: 'assistant',
    content: [{ type: 'text', text: '[#99] Hello' }],
  }
  assert.equal(applyDecoration(plain, { prefix: '⟦p7⟧ ' }).content[0].text, '⟦p7⟧ [#99] Hello')

  const user = {
    role: 'user',
    content: [{ type: 'text', text: '⟦p99⟧ Hello' }],
  }
  assert.equal(applyDecoration(user, { prefix: '⟦p7⟧ ' }).content[0].text, '⟦p7⟧ ⟦p99⟧ Hello')
})

test('a message without a replayed surface position fails the request loudly', () => {
  const session = longConversation(1)
  const state = foldAll(session.snapshotEvents())
  const { messages } = decorate(session)
  const orphan = { ...messages[0], id: 'not-in-the-log' }
  assert.throws(
    () => anchorDecorations(state, [orphan]),
    /no replayed surface position/,
  )
})

test('multiple decorations concatenate in registration order', () => {
  assert.deepEqual(mergeDecorations(undefined, { prefix: '⟦p1⟧ ' }), { prefix: '⟦p1⟧ ' })
  assert.deepEqual(mergeDecorations({ prefix: 'a', suffix: 'b' }, { prefix: 'c' }), { prefix: 'ac', suffix: 'b' })
})

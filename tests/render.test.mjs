import assert from 'node:assert/strict'
import { test } from 'node:test'
import { FakeSession, compressRange, foldSession, longConversation, tailSession } from './helpers.mjs'
import { observedMessageOf } from '../lib/state.js'
import { anchorDecorations, applyDecoration, decorationOverheadTokens, mergeDecorations } from '../lib/render.js'

/**
 * Derive the fake session's model-visible messages and their decorations.
 * 中文：派生假 session 的模型可见消息及其装饰。
 */
export function decorate(session) {
  const state = foldSession(session)
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

test('every anchorable message gets a distinct leading anchor', () => {
  const session = longConversation(2)
  const { texts, decorations, state } = decorate(session)
  const anchors = texts.slice(0, 5).map(text => text.match(/^⟦#([a-z0-9]{4})⟧/)?.[1])
  assert.equal(anchors.length, 5)
  for (const anchor of anchors) assert.match(anchor, /^[a-z0-9]{4}$/)
  assert.equal(new Set(anchors).size, anchors.length)
  assert.deepEqual(anchors, state.nodes.filter(node => node.left !== null).map(node => node.left))
  assert.equal(texts.length, 6)
  // the tool-call-only current-turn assistant has no anchor
  // 中文：只有 tool-call 的当前回合 assistant 没有锚点
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
  assert.match(decorated.content.find(block => block.type === 'text').text, /^⟦#[a-z0-9]{4}⟧ /)
})

test('an assistant message without a text block is never decorated with a new block', () => {
  const session = new FakeSession()
  session.turnStart()
  session.user('question')
  session.assistant({ toolCalls: [{ id: 'call-1', name: 'read' }] })
  const state = foldSession(session)
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

test('a summary block renders its left anchor and adjacent blocks stay clean', () => {
  const session = longConversation(2)
  let state = foldSession(session)
  const nodes = state.nodes.filter(node => node.left !== null)
  compressRange(session, nodes[0].seq, nodes[1].seq, 'First summary of the oldest exchange with enough detail.')
  const first = decorate(session)
  assert.match(first.texts[0], /^⟦#[a-z0-9]{4}⟧ First summary/)
  assert.doesNotMatch(first.texts[0], /⟦#.*⟧$/)
  assert.match(first.texts[1], /^⟦#[a-z0-9]{4}⟧ /)

  state = foldSession(session)
  const afterFirst = state.nodes.filter(node => node.left !== null)
  const secondStart = afterFirst.find(node => !node.block && node.left !== afterFirst[0].left)
  const secondEnd = afterFirst.filter(node => !node.block)[1]
  compressRange(session, secondStart.seq, secondEnd.seq, 'Second summary of the next exchange with enough detail.')
  const adjacent = decorate(session)
  assert.match(adjacent.texts[0], /^⟦#[a-z0-9]{4}⟧ First summary/)
  assert.match(adjacent.texts[1], /^⟦#[a-z0-9]{4}⟧ Second summary/)
})

test('a tail summary has no suffix until new content is appended', () => {
  const session = tailSession()
  const state = foldSession(session)
  const visible = state.nodes.filter(node => node.left !== null)
  compressRange(session, visible[0].seq, visible.at(-1).seq, 'Tail summary covering the whole visible history.')
  const folded = decorate(session)
  assert.match(folded.texts[0], /^⟦#[a-z0-9]{4}⟧ Tail summary/)
  assert.doesNotMatch(folded.texts[0], /⟦#[a-z0-9]{4}⟧$/)
})

test('anchor overhead prices every prefix', () => {
  const session = longConversation(1)
  const state = foldSession(session)
  // Three anchored messages; `⟦#a8c5⟧ ` has 2 non-ASCII and 6 ASCII chars = 4 tokens each.
  // 中文：三条带锚点消息；`⟦#a8c5⟧ ` 有 2 个非 ASCII、6 个 ASCII 字符 = 各 4 token。
  assert.equal(decorationOverheadTokens(state), 12)

  const folded = longConversation(2)
  const before = foldSession(folded)
  const nodes = before.nodes.filter(node => node.left !== null)
  compressRange(folded, nodes[0].seq, nodes[1].seq, 'Summary priced with its prefix but no rendered suffix here.')
  const after = foldSession(folded)
  // block prefix + three surviving messages; the block's right boundary is
  // owned by the next visible message, so no suffix tokens are charged
  // 中文：块前缀 + 三条存活消息；块的右边界由下一个可见消息负责，所以不计后缀 token
  assert.equal(decorationOverheadTokens(after), 16)
})

test('leading copied anchors are stripped from assistant replies at the request boundary', () => {
  const message = {
    role: 'assistant',
    content: [{ type: 'text', text: '⟦#a8c5⟧ ⟦#c9d1⟧ Hello' }],
  }
  const decorated = applyDecoration(message, { prefix: '⟦#e2f3⟧ ' })
  assert.equal(decorated.content[0].text, '⟦#e2f3⟧ Hello')

  const plain = {
    role: 'assistant',
    content: [{ type: 'text', text: '[#99] Hello' }],
  }
  assert.equal(applyDecoration(plain, { prefix: '⟦#e2f3⟧ ' }).content[0].text, '⟦#e2f3⟧ [#99] Hello')

  const user = {
    role: 'user',
    content: [{ type: 'text', text: '⟦#a8c5⟧ Hello' }],
  }
  assert.equal(applyDecoration(user, { prefix: '⟦#e2f3⟧ ' }).content[0].text, '⟦#e2f3⟧ ⟦#a8c5⟧ Hello')
})

test('a message without a replayed surface anchor fails the request loudly', () => {
  const session = longConversation(1)
  const state = foldSession(session)
  const { messages } = decorate(session)
  const orphan = { ...messages[0], id: 'not-in-the-log' }
  assert.throws(
    () => anchorDecorations(state, [orphan]),
    /没有可重放的 surface 锚点/,
  )
})

test('multiple decorations concatenate in registration order', () => {
  assert.deepEqual(mergeDecorations(undefined, { prefix: '⟦#a8c5⟧ ' }), { prefix: '⟦#a8c5⟧ ' })
  assert.deepEqual(mergeDecorations({ prefix: 'a', suffix: 'b' }, { prefix: 'c' }), { prefix: 'ac', suffix: 'b' })
})

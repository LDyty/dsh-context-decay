import assert from 'node:assert/strict'
import { test } from 'node:test'
import { foldSession, longConversation } from './helpers.mjs'
import { observedMessageOf } from '../lib/state.js'
import { DecorationRegistry } from '../lib/service.js'

function messagesOf(session) {
  const messages = []
  for (const seq of session.surface.nodes) {
    const observed = observedMessageOf(session.snapshotEvents()[seq])
    if (observed === null) continue
    const message = observed.message
    if (message.role === 'system' || message.role === 'developer') continue
    if (message.role === 'assistant' && message.content.length === 0) continue
    messages.push(message)
  }
  return messages
}

function textOf(message) {
  return message.content.filter(block => block.type === 'text').map(block => block.text).join('')
}

test('registered decorators apply in registration order and dispose cleanly', () => {
  const session = longConversation(1)
  const messages = messagesOf(session)
  const registry = new DecorationRegistry(foldSession)
  const disposeA = registry.register({
    id: 'a', version: '1', decorate: () => messages.map(() => ({ prefix: 'A' })),
  })
  registry.register({ id: 'b', version: '1', decorate: () => messages.map(() => ({ suffix: 'B' })) })
  const decorated = registry.decorate(session, messages)
  assert.match(textOf(decorated[0]), /^A.*B$/)
  assert.equal(decorated.length, messages.length)
  assert.deepEqual(registry.identities(), [{ id: 'a', version: '1' }, { id: 'b', version: '1' }])
  disposeA()
  const afterDispose = registry.decorate(session, messages)
  assert.doesNotMatch(textOf(afterDispose[0]), /^A/)
  assert.deepEqual(registry.identities(), [{ id: 'b', version: '1' }])
})

test('a decoration count mismatch fails the request instead of mismatching messages', () => {
  const session = longConversation(1)
  const messages = messagesOf(session)
  const registry = new DecorationRegistry(foldSession)
  registry.register({ id: 'short', version: '1', decorate: () => [] })
  assert.throws(() => registry.decorate(session, messages), /返回 0 个装饰/)
})

test('a throwing decorator propagates (the request fails loudly)', () => {
  const session = longConversation(1)
  const messages = messagesOf(session)
  const registry = new DecorationRegistry(foldSession)
  registry.register({ id: 'boom', version: '1', decorate: () => { throw new Error('anchor rebuild failed') } })
  assert.throws(() => registry.decorate(session, messages), /anchor rebuild failed/)
})

test('the registry prices the anchors it renders and prices nothing when disposed', () => {
  const session = longConversation(1)
  const registry = new DecorationRegistry(foldSession)
  assert.equal(registry.overhead(session), 0)
  const dispose = registry.register({ id: 'anchors', version: '1', decorate: () => [] })
  // three anchored messages × `⟦O#a8c5⟧ ` (4 tokens) = 12
  // 中文：三条带锚点消息 × `⟦O#a8c5⟧ `（4 token）= 12
  assert.equal(registry.overhead(session), 12)
  dispose()
  assert.equal(registry.overhead(session), 0)
})

test('per-request decoration stays silent in the host log', () => {
  const session = longConversation(1)
  const messages = messagesOf(session)
  const logs = []
  const registry = new DecorationRegistry(foldSession, line => logs.push(line))
  registry.register({
    id: 'noop', version: '1', decorate: (_session, derived) => derived.map(() => undefined),
  })
  registry.decorate(session, messages)
  assert.deepEqual(logs, [])
})

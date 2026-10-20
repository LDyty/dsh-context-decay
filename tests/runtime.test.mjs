/**
 * Runtime-routing tests: the sidebar projection must read pressure and request
 * facts from the session that owns the view, including after switching to a
 * restored session that has not run a pre-step in this process.
 *
 * 中文：运行时路由测试：侧栏 projection 必须读取视图所属 session 的压力与请求事实，
 * 包括切换到一个本进程尚未跑过 pre-step 的恢复会话之后。
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { FakeSession } from './helpers.mjs'
import { apply } from '../lib/index.js'

function fakeContext(sessions, measurements) {
  const listeners = new Map()
  let projection
  const ctx = {
    get(name) {
      if (name === 'tools') return { register: () => () => {} }
      if (name === 'systemPrompt') return { section: () => () => {} }
      if (name === 'tokenMeter') {
        return {
          measure(session) {
            return { totalTokens: measurements[session.id] ?? 0, decorationOverheadTokens: 0 }
          },
        }
      }
      if (name === 'sessions') {
        return { get: id => sessions.find(session => session.id === id) }
      }
      if (name === 'sessionProjections') {
        return { register: definition => { projection = definition; return () => {} } }
      }
      return undefined
    },
    provide: () => () => {},
    effect(fn) {
      const disposer = fn()
      return disposer
    },
    on(event, listener) {
      const list = listeners.get(event) ?? []
      list.push(listener)
      listeners.set(event, list)
      return () => {}
    },
  }
  return { ctx, listeners, projection: () => projection }
}

async function preStep(listeners, session) {
  const listener = listeners.get('agent/pre-step')?.[0]
  assert.equal(typeof listener, 'function')
  await listener({ agent: { session } }, async () => ({ kind: 'enter' }))
}

test('each session view keeps its own pressure after switching sessions', async () => {
  const a = new FakeSession({ contextWindow: 60_000 })
  const b = new FakeSession({ contextWindow: 60_000 })
  const measurements = { [a.id]: 100, [b.id]: 200 }
  const { ctx, listeners, projection } = fakeContext([a, b], measurements)
  apply(ctx, {})
  const definition = projection()
  assert.ok(definition)

  await preStep(listeners, a)
  await preStep(listeners, b)

  const viewA = definition.wire.view(definition.init({ id: a.id }))
  const viewB = definition.wire.view(definition.init({ id: b.id }))
  assert.equal(viewA.pressure.tokens, 100)
  assert.equal(viewB.pressure.tokens, 200)
  assert.equal(viewA.pressure.window, 60_000)
  assert.equal(viewB.pressure.window, 60_000)
})

test('a restored session view hydrates its own reading on first read', () => {
  const a = new FakeSession({ contextWindow: 60_000 })
  const restored = new FakeSession({ contextWindow: 200_000 })
  const measurements = { [a.id]: 100, [restored.id]: 300 }
  const { ctx, projection } = fakeContext([a, restored], measurements)
  apply(ctx, {})
  const definition = projection()

  const view = definition.wire.view(definition.init({ id: restored.id }))
  assert.equal(view.pressure.tokens, 300)
  assert.equal(view.pressure.window, 200_000)
})

test('session/created hydration covers a session the store does not expose', () => {
  const restored = new FakeSession({ contextWindow: 200_000 })
  const measurements = { [restored.id]: 300 }
  const { ctx, listeners, projection } = fakeContext([], measurements)
  apply(ctx, {})
  const definition = projection()
  const created = listeners.get('session/created')?.[0]
  assert.equal(typeof created, 'function')
  created(restored)

  const view = definition.wire.view(definition.init({ id: restored.id }))
  assert.equal(view.pressure.tokens, 300)
  assert.equal(view.pressure.window, 200_000)
})

/**
 * On-demand node content: request validation, lookup failures, text rendering,
 * truncation, and registration on the host's `/api` channel.
 *
 * 中文：按需节点内容：请求校验、查找失败、文本渲染、截断，以及注册到宿主的 `/api`
 * 通道。
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { CONTENT_MAX_CHARS, CONTENT_PATH, contentRoute, nodeTextOf, registerContentRoute } from '../lib/content.js'
import { FakeSession } from './helpers.mjs'

/**
 * Route bound to one session lookup that only knows `session`.
 * 中文：绑定到一个只认 `session` 的查找函数的路由。
 */
function routeFor(session) {
  return contentRoute({ sessionById: id => id === session.id ? session : undefined })
}

/**
 * Invoke one route through a plain Fetch request and decode the JSON answer.
 * 中文：用普通 Fetch 请求调用一次路由并解码 JSON 结果。
 */
async function call(route, query) {
  const response = await route.fetch(new Request(`http://panel.invalid${CONTENT_PATH}?${query}`))
  return { status: response.status, headers: response.headers, body: await response.json() }
}

/**
 * One session whose first turn holds a user message, a tool-call assistant
 * message, and its tool result.
 * 中文：一个首回合包含 user 消息、带 tool call 的 assistant 消息及其 tool 结果的 session。
 */
function conversation() {
  const session = new FakeSession()
  session.turnStart()
  session.system('You are a test agent.')
  session.stepStart()
  session.user('read the file please')
  session.assistant({ toolCalls: [{ id: 'call-1', name: 'read' }] })
  session.toolResult('call-1', 'file contents here')
  session.assistant({ text: 'The file says hello.' })
  session.endTurn()
  return session
}

test('nodeTextOf renders text blocks and never leaves a split surrogate', () => {
  assert.deepEqual(
    nodeTextOf({ id: 'm1', role: 'user', content: [{ type: 'text', text: 'alpha' }, { type: 'text', text: 'beta' }], source: {} }),
    { text: 'alpha\n\nbeta', truncated: false },
  )
  assert.deepEqual(
    nodeTextOf({ id: 'm2', role: 'assistant', content: [{ type: 'reasoning', text: 'plan' }], source: {} }),
    { text: 'plan', truncated: false },
  )
  assert.deepEqual(
    nodeTextOf({
      id: 'm3',
      role: 'assistant',
      content: [{ type: 'tool-call', name: 'read' }, { type: 'tool-call', name: 'grep' }],
      source: {},
    }),
    { text: '[tool] read\n[tool] grep', truncated: false },
  )
  assert.deepEqual(nodeTextOf({ id: 'm4', role: 'user', content: [], source: {} }), { text: '', truncated: false })
  const cut = nodeTextOf({ id: 'm5', role: 'user', content: [{ type: 'text', text: '😀😀' }], source: {} }, 3)
  assert.deepEqual(cut, { text: '😀', truncated: true })
  assert.equal(nodeTextOf({ id: 'm6', role: 'user', content: [{ type: 'text', text: 'x'.repeat(40) }], source: {} }, CONTENT_MAX_CHARS).truncated, false)
})

test('the content route answers one message by session id and seq', async () => {
  const session = conversation()
  const route = routeFor(session)
  assert.equal(route.path, CONTENT_PATH)
  assert.deepEqual(route.methods, ['GET'])
  assert.equal(route.requestBody, 'buffered')

  const user = await call(route, `session=${session.id}&seq=3`)
  assert.equal(user.status, 200)
  assert.equal(user.headers.get('content-type'), 'application/json; charset=utf-8')
  assert.equal(user.headers.get('cache-control'), 'no-store')
  assert.deepEqual(user.body, { ok: true, role: 'user', text: 'read the file please', truncated: false })

  const assistant = await call(route, `session=${session.id}&seq=4`)
  assert.deepEqual(assistant.body, { ok: true, role: 'assistant', text: '[tool] read', truncated: false })

  const tool = await call(route, `session=${session.id}&seq=5`)
  assert.deepEqual(tool.body, { ok: true, role: 'tool', text: 'file contents here', truncated: false })
})

test('the content route rejects malformed requests and unknown targets', async () => {
  const session = conversation()
  const route = routeFor(session)
  assert.deepEqual((await call(route, `session=${session.id}`)).body, { ok: false, error: 'bad-request' })
  assert.equal((await call(route, 'seq=2')).status, 400)
  assert.equal((await call(route, `session=${session.id}&seq=-1`)).status, 400)
  assert.equal((await call(route, `session=${session.id}&seq=abc`)).status, 400)
  assert.deepEqual((await call(route, `session=other&seq=2`)).body, { ok: false, error: 'session-not-found' })
  assert.deepEqual((await call(route, `session=${session.id}&seq=999`)).body, { ok: false, error: 'event-not-found' })
  assert.deepEqual((await call(route, `session=${session.id}&seq=0`)).body, { ok: false, error: 'not-a-message' })
  assert.deepEqual((await call(route, `session=${session.id}&seq=2`)).body, { ok: false, error: 'not-a-message' })
})

/** Connection stand-in that records registrations and disposals. */
function recordingConnection(registered, disposed) {
  return {
    fetch: {
      register(route) {
        registered.push(route)
        return async () => { disposed.push(route.path) }
      },
    },
  }
}

test('the content route mounts inside the connection scope when ctx.inject exists', () => {
  const registered = []
  const disposed = []
  const scopes = []
  const effects = []
  const lines = []
  const session = conversation()
  const scope = {
    get: name => name === 'connection' ? recordingConnection(registered, disposed) : undefined,
    effect(fn) { effects.push(fn()) },
  }
  registerContentRoute({
    get: () => undefined,
    effect: () => { throw new Error('direct mount must not run when ctx.inject exists') },
    inject(deps, callback) { scopes.push(deps); callback(scope) },
  }, { sessionById: id => id === session.id ? session : undefined, log: line => { lines.push(line) } })
  assert.deepEqual(scopes, [['connection']])
  assert.equal(registered.length, 1)
  assert.equal(registered[0].path, CONTENT_PATH)
  assert.match(lines[0], /内容路由已挂载/)
  effects[0]()
  assert.deepEqual(disposed, [CONTENT_PATH])
})

test('without ctx.inject the route mounts directly and a missing channel stays silent', () => {
  const registered = []
  const disposed = []
  const effects = []
  registerContentRoute({
    get: name => name === 'connection' ? recordingConnection(registered, disposed) : undefined,
    effect(fn) { effects.push(fn()) },
  }, { sessionById: () => undefined })
  assert.equal(registered.length, 1)
  effects[0]()

  const lines = []
  const silentEffects = []
  registerContentRoute({
    get: () => ({}),
    effect(fn) { silentEffects.push(fn) },
  }, { sessionById: () => undefined, log: line => { lines.push(line) } })
  assert.deepEqual(silentEffects, [])
  assert.deepEqual(lines, ['内容路由跳过：宿主 connection 没有 fetch 通道'])
})

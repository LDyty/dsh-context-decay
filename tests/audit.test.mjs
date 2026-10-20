/**
 * Request-level audit sidecar: one JSONL line per decorated request.
 *
 * The audit records are diagnostics for humans. They must never carry message
 * text, never change the decorated request, and never turn an audit failure
 * into a request failure.
 *
 * 中文：请求级审计 sidecar：每个已装饰请求一行 JSONL。
 * 审计记录是给人看的诊断。它们绝不能携带消息正文、绝不能改变已装饰请求、绝不能把审计
 * 失败变成请求失败。
 */

import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { compressRange, longConversation } from './helpers.mjs'
import { foldAll, observedMessageOf } from '../lib/state.js'
import { DecorationRegistry } from '../lib/service.js'
import { anchorDecorations } from '../lib/render.js'
import { AuditWriter } from '../lib/audit.js'
import { resolveConfig } from '../lib/config.js'

const homes = []

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

function record(overrides = {}) {
  return {
    v: 1,
    time: new Date().toISOString(),
    sessionId: 'session-test',
    requestIndex: 1,
    sessionRequest: 3,
    messages: 3,
    anchors: 2,
    first: 0,
    last: 2,
    blocks: [{ from: 0, to: 2, tier: 1 }],
    overheadTokens: 12,
    decorators: [{ id: 'context-decay/anchors', version: '1' }],
    scope: 'conversation',
    ...overrides,
  }
}

test('the registry writes one audit line per request with no message text', () => {
  const session = longConversation(1)
  compressRange(session, 3, 4, 'SECRET-SUMMARY-TEXT with enough detail for the audit test.')
  const messages = messagesOf(session)
  const stateOf = subject => foldAll(subject.snapshotEvents())
  const records = []
  const registry = new DecorationRegistry(stateOf, undefined, entry => records.push(entry))
  registry.register({
    id: 'context-decay/anchors',
    version: '1',
    decorate: (subject, derived) => anchorDecorations(stateOf(subject), derived),
  })

  const first = registry.decorate(session, messages)
  const second = registry.decorate(session, messages)
  assert.equal(first.length, messages.length)
  assert.equal(second.length, messages.length)
  assert.equal(records.length, 2)

  const [one, two] = records
  assert.equal(one.v, 1)
  assert.equal(one.sessionId, session.id)
  assert.equal(one.requestIndex, 1)
  assert.equal(one.sessionRequest, 3)
  assert.equal(two.requestIndex, 2)
  assert.equal(two.sessionRequest, 3)
  assert.equal(foldAll(session.snapshotEvents()).assistantRequests, 2)
  assert.equal(one.messages, messages.length)
  assert.equal(one.anchors, 2)
  assert.equal(one.first, 0)
  assert.equal(one.last, 2)
  assert.deepEqual(one.blocks, [{ from: 0, to: 2, tier: 1 }])
  assert.ok(one.overheadTokens > 0)
  assert.deepEqual(one.decorators, [{ id: 'context-decay/anchors', version: '1' }])
  assert.equal(one.scope, 'conversation')
  assert.equal(Number.isNaN(Date.parse(one.time)), false)

  // The sidecar is counts and positions only: neither the folded summary nor
  // a live message body may leak into it.
  // 中文：sidecar 只记录计数和位置：被折叠的摘要和 live 消息正文都不能泄漏进去。
  const serialized = JSON.stringify(records)
  assert.doesNotMatch(serialized, /SECRET-SUMMARY-TEXT/)
  assert.doesNotMatch(serialized, /current turn question/)
})

test('a throwing audit sink is logged and never fails the request', () => {
  const session = longConversation(1)
  const messages = messagesOf(session)
  const stateOf = subject => foldAll(subject.snapshotEvents())
  const logs = []
  const registry = new DecorationRegistry(stateOf, line => logs.push(line), () => {
    throw new Error('audit sink failed')
  })
  registry.register({
    id: 'context-decay/anchors',
    version: '1',
    decorate: (subject, derived) => anchorDecorations(stateOf(subject), derived),
  })
  const decorated = registry.decorate(session, messages)
  assert.equal(decorated.length, messages.length)
  assert.ok(logs.some(line => /audit skipped: Error: audit sink failed/.test(line)))
})

test('AuditWriter appends one JSON line per record', () => {
  const home = mkdtempSync(join(tmpdir(), 'context-decay-audit-'))
  homes.push(home)
  const file = join(home, 'nested', 'audit.jsonl')
  const logs = []
  const writer = new AuditWriter(file, line => logs.push(line))
  writer.write(record())
  writer.write(record({ requestIndex: 2, anchors: 1 }))
  const lines = readFileSync(file, 'utf8').trim().split('\n')
  assert.equal(lines.length, 2)
  const [one, two] = lines.map(line => JSON.parse(line))
  assert.deepEqual(one.blocks, [{ from: 0, to: 2, tier: 1 }])
  assert.equal(one.requestIndex, 1)
  assert.equal(two.requestIndex, 2)
  assert.equal(two.anchors, 1)
  assert.deepEqual(logs, [])
})

test('an unwritable audit path is reported and never thrown', () => {
  const home = mkdtempSync(join(tmpdir(), 'context-decay-audit-'))
  homes.push(home)
  const blocker = join(home, 'blocker')
  writeFileSync(blocker, 'not a directory')
  const logs = []
  const writer = new AuditWriter(join(blocker, 'audit.jsonl'), line => logs.push(line))
  assert.doesNotThrow(() => writer.write(record()))
  assert.ok(logs.some(line => /audit write failed/.test(line)))
})

test('configuration accepts audit and rejects non-boolean values', () => {
  assert.equal(resolveConfig({}).audit, false)
  assert.equal(resolveConfig({ audit: true }).audit, true)
  assert.throws(() => resolveConfig({ audit: 'yes' }), /audit/)
})

after(() => {
  for (const path of homes) rmSync(path, { recursive: true, force: true })
})

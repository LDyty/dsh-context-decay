/**
 * Test helpers: an in-memory Session that replays surface ops the same way the
 * harness does (append pushes a node, replace splices the range), without any
 * harness runtime imports.
 *
 * 中文：测试辅助：一个内存 Session，按宿主的方式重放 surface 操作（append 推入节点，
 * replace splice 范围），不 import 任何宿主运行时。
 */

import { randomUUID } from 'node:crypto'

let serial = 0

/**
 * Fresh deterministic id with a role prefix (message ids only need uniqueness).
 * 中文：带角色前缀的确定性新 id（消息 id 只需要唯一）。
 */
export function nextId(prefix = 'm') {
  serial += 1
  return `${prefix}-${serial}`
}

/**
 * Minimal Surface-op-compatible Session.
 * 中文：最小化的、兼容 surface op 的 Session。
 */
export class FakeSession {
  constructor({ contextWindow = 60_000 } = {}) {
    this.id = `session-${nextId('s')}`
    this.events = []
    this.nodes = []
    this.contextWindow = contextWindow
    this.turn = 0
  }

  get seq() {
    return this.events.length
  }

  get surface() {
    return { nodes: this.nodes }
  }

  snapshotEvents() {
    return this.events
  }

  requestContext() {
    return { provider: 'test-provider', model: 'test-model', contextWindow: this.contextWindow }
  }

  append(type, data, opts) {
    const event = {
      type,
      seq: this.events.length,
      time: 1_700_000_000_000 + this.events.length,
      data,
      ...opts?.surfaceOp === undefined ? {} : { surfaceOp: opts.surfaceOp },
      ...opts?.sourceEventSeqs === undefined ? {} : { sourceEventSeqs: opts.sourceEventSeqs },
    }
    if (opts?.surfaceOp === 'append') {
      this.nodes.push(event.seq)
    } else if (opts?.surfaceOp !== undefined) {
      const start = this.nodes.indexOf(opts.surfaceOp.startSeq)
      const end = this.nodes.indexOf(opts.surfaceOp.endSeq)
      if (start < 0 || end < 0 || start > end) throw new Error('fake session: invalid replace range')
      this.nodes.splice(start, end - start + 1, event.seq)
    }
    this.events.push(event)
    return event
  }

  // ---- builders -----------------------------------------------------------
  // 中文：---- 构造器 ---------------------------------------------------------

  turnStart() {
    this.turn += 1
    this.append('turn/start', { turn: this.turn })
    return this.turn
  }

  endTurn() {
    this.append('turn/end', { turn: this.turn, reason: { kind: 'completed' } })
  }

  stepStart(step = 1) {
    this.append('step/start', { turn: this.turn, step })
  }

  system(text) {
    const message = { id: nextId('sys'), role: 'system', content: text === '' ? [] : [{ type: 'text', text }], source: { kind: 'system-prompt' } }
    this.append('system/message', { turn: this.turn, step: 1, message }, { surfaceOp: 'append' })
  }

  user(text, source = { kind: 'user' }) {
    const message = { id: nextId('u'), role: 'user', content: [{ type: 'text', text }], source }
    this.append('user/message', message, { surfaceOp: 'append' })
    return message
  }

  assistant({ text = '', reasoning = '', toolCalls = [], usage = { inputTokens: 1_000, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 10 } } = {}) {
    const content = []
    if (reasoning !== '') content.push({ type: 'reasoning', text: reasoning })
    if (text !== '') content.push({ type: 'text', text })
    for (const call of toolCalls) content.push({ type: 'tool-call', id: call.id, name: call.name, arguments: '{}' })
    const message = {
      id: nextId('a'),
      role: 'assistant',
      content,
      source: { kind: 'model', provider: 'test-provider', model: 'test-model' },
    }
    this.append('assistant/message', {
      turn: this.turn,
      step: 1,
      message,
      stream: [],
      ...usage === null ? {} : { usage },
    }, { surfaceOp: 'append' })
    return message
  }

  toolResult(callId, text) {
    const message = {
      id: nextId('t'),
      role: 'tool',
      content: [{ type: 'text', text }],
      source: { kind: 'tool', callId },
      toolCallId: callId,
    }
    this.append('tool/result', { turn: this.turn, step: 1, message }, { surfaceOp: 'append' })
    return message
  }
}

/**
 * Build one long synthetic conversation with `turns` completed turns plus a current turn.
 * 中文：构造一段长合成对话：`turns` 个已完成回合，再加一个当前回合。
 */
export function longConversation(turns = 4) {
  const session = new FakeSession()
  session.turnStart()
  session.system('You are a test agent.')
  session.stepStart()
  for (let index = 0; index < turns; index += 1) {
    if (index > 0) {
      session.endTurn()
      session.turnStart()
      session.stepStart()
    }
    session.user(`user question ${index}: ${'context '.repeat(40)}`)
    session.assistant({ text: `assistant answer ${index}: ${'detail '.repeat(30)}` })
  }
  session.endTurn()
  session.turnStart()
  session.stepStart()
  session.user('current turn question')
  session.assistant({ toolCalls: [{ id: 'call-compress', name: 'compress' }] })
  return session
}

/**
 * Session whose current turn has not produced a surface node yet (compressible through the tail).
 * 中文：当前回合还没有产生 surface 节点的 Session（可以一直压缩到 tail）。
 */
export function tailSession() {
  const session = new FakeSession()
  session.turnStart()
  session.system('You are a test agent.')
  session.stepStart()
  session.user('first question')
  session.assistant({ text: 'first answer' })
  session.endTurn()
  session.turnStart()
  session.stepStart()
  session.user('second question')
  session.assistant({ text: 'second answer' })
  session.endTurn()
  session.turnStart()
  session.stepStart()
  return session
}

/**
 * Append one context-decay compression transaction over a surface range.
 * Mirrors what the compress tool writes.
 * 中文：在一个 surface 范围上追加一次 context-decay 压缩事务。复刻 compress 工具写入
 * 的内容。
 */
export function compressRange(session, startSeq, endSeq, summary, { tier = 1, source = { kind: 'context-decay', form: 'summary' }, anchorMode = 'monotonic' } = {}) {
  const message = {
    id: nextId('sum'),
    role: 'user',
    content: [{ type: 'text', text: summary }],
    source,
  }
  const summaryEvent = session.append('compaction/summary', {
    compactionId: `c-${message.id}`,
    summary: [{ type: 'text', text: summary }],
    shadowedRange: { start: startSeq, end: endSeq },
    shadowedSeqs: [startSeq, endSeq],
    shadowedTokenCount: 10,
    provider: 'test-provider',
    model: 'test-model',
    rawOutput: [{ type: 'text', text: JSON.stringify({ v: 1, kind: 'context-decay', mode: 'compress', ...(anchorMode === null ? {} : { anchorMode }), tier }) }],
  })
  session.append('user/message', message, {
    surfaceOp: { op: 'replace', startSeq, endSeq },
    sourceEventSeqs: [summaryEvent.seq, startSeq, endSeq],
  })
  return message
}

/**
 * Append one context-decay drop transaction over a summary block node.
 * 中文：在一个摘要块节点上追加一次 context-decay drop 事务。
 */
export function dropBlock(session, blockSeq) {
  const prune = session.append('compaction/prune', {
    shadowedRange: { start: blockSeq, end: blockSeq },
    shadowedSeqs: [blockSeq],
    shadowedTokenCount: 10,
  })
  const message = { id: nextId('drop'), role: 'developer', content: [], source: { kind: 'context-decay', form: 'drop' } }
  session.append('developer/message', { turn: session.turn, step: 1, message }, {
    surfaceOp: { op: 'replace', startSeq: blockSeq, endSeq: blockSeq },
    sourceEventSeqs: [prune.seq, blockSeq],
  })
  return message
}

/**
 * Build the fake plugin context used by registerTools.
 * 中文：构造 registerTools 使用的假插件上下文。
 */
export function fakePluginContext() {
  const registered = []
  const sections = []
  return {
    registered,
    sections,
    get(name) {
      if (name === 'tools') {
        return {
          register(definition) {
            registered.push(definition)
            return () => {}
          },
        }
      }
      if (name === 'systemPrompt') {
        return {
          section(section) {
            sections.push(section)
            return () => {}
          },
        }
      }
      return undefined
    },
    provide() {
      return () => {}
    },
    effect(fn) {
      fn()
    },
    on() {
      return () => {}
    },
  }
}

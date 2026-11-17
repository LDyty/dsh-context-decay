import assert from 'node:assert/strict'
import { test } from 'node:test'
import { FakeSession, fakePluginContext, foldSession, longConversation } from './helpers.mjs'
import { StateCache, observedMessageOf } from '../lib/state.js'
import { resolveConfig } from '../lib/config.js'
import { registerTools } from '../lib/tools.js'
import { formatAnchor } from '../lib/anchor.js'
import { anchorDecorations, applyDecoration } from '../lib/render.js'

function harness(session, overrides = {}, pressure = null) {
  const ctx = fakePluginContext()
  const cache = new StateCache()
  const config = resolveConfig({ minSummaryChars: 20, maxSummaryChars: 8_000, ...overrides })
  registerTools(ctx, {
    config,
    stateOf: subject => cache.stateOf(subject),
    ...(pressure === null ? {} : { pressure: () => pressure }),
    log: () => {},
  })
  const tools = Object.fromEntries(ctx.registered.map(definition => [definition.name, definition]))
  const exec = { agent: { session }, signal: new AbortController().signal }
  return { tools, call: (name, args) => tools[name].execute(args, exec), ctx, cache, config }
}

function anchorsOf(session) {
  return foldSession(session).nodes.filter(node => node.left !== null).map(node => node.left)
}

function render(session) {
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
  return messages.map((message, index) => {
    const decorated = applyDecoration(message, decorations[index])
    return decorated.content.filter(block => block.type === 'text').map(block => block.text).join('')
  })
}

test('compress accepts visible, bare, and raw anchors; drop is not registered', async () => {
  const session = longConversation(2)
  const harnessed = harness(session)
  assert.equal(harnessed.tools.drop, undefined)
  const anchors = anchorsOf(session)
  const compressed = await harnessed.call('compress', {
    spans: [{
      from: formatAnchor(anchors[0]),
      to: `#${anchors[2]}`,
      summary: 'The first exchange was summarized with visible anchor arguments.',
    }],
  })
  assert.equal(compressed.ok, true)
  assert.equal(compressed.applied[0].from, anchors[0])
  assert.equal(compressed.applied[0].to, anchors[2])
})

test('compress folds one span, appends the ledger, and reports the pair', async () => {
  const session = longConversation(2)
  const harnessed = harness(session)
  const anchors = anchorsOf(session)
  const result = await harnessed.call('compress', {
    spans: [{ from: anchors[0], to: anchors[2], summary: 'The first exchange asked about the context and was answered.', topic: 'setup' }],
  })
  assert.equal(result.ok, true)
  assert.equal(result.applied.length, 1)
  assert.equal(result.applied[0].from, anchors[0])
  assert.equal(result.applied[0].to, anchors[2])
  assert.equal(result.applied[0].tier, 1)
  assert.ok(result.estimate.oneTimeMissTokens > 0)

  const state = foldSession(session)
  const blocks = state.nodes.filter(node => node.block)
  assert.equal(blocks.length, 1)
  assert.equal(blocks[0].left, anchors[0])
  assert.equal(blocks[0].right, anchors[2])
  assert.equal(blocks[0].topic, 'setup')
  assert.deepEqual(state.free, [anchors[1]])

  const events = session.snapshotEvents()
  const summaryIndex = events.findIndex(event => event.type === 'compaction/summary')
  assert.equal(events[summaryIndex - 1].type, 'compaction/start')
  assert.equal(events[summaryIndex + 2].type, 'compaction/end')
  const start = events[summaryIndex - 1]
  const end = events[summaryIndex + 2]
  assert.equal(start.data.compactionId, events[summaryIndex].data.compactionId)
  assert.equal(end.data.compactionId, events[summaryIndex].data.compactionId)
  assert.equal(start.data.turn, 3)
  const summaryEvent = events[summaryIndex]
  assert.equal(summaryEvent.data.provider, 'test-provider')
  assert.equal(summaryEvent.data.model, 'test-model')
  assert.equal(summaryEvent.data.shadowedTokenCount > 0, true)
  const ledger = JSON.parse(summaryEvent.data.rawOutput[0].text)
  assert.equal(ledger.kind, 'context-decay')
  assert.equal(ledger.from, anchors[0])
  assert.equal(ledger.to, anchors[2])

  const replacement = events.find(event => event.type === 'user/message' && event.surfaceOp !== 'append')
  assert.deepEqual(replacement.surfaceOp, { op: 'replace', startSeq: summaryEvent.data.shadowedRange.start, endSeq: summaryEvent.data.shadowedRange.end })
  for (const seq of summaryEvent.data.shadowedSeqs) assert.ok(replacement.sourceEventSeqs.includes(seq))
  assert.ok(replacement.sourceEventSeqs.includes(summaryEvent.seq))
  assert.equal(replacement.data.source.form, 'summary')
})

test('re-compressing the same pair keeps it and increments the tier', async () => {
  const session = longConversation(2)
  const harnessed = harness(session)
  let anchors = anchorsOf(session)
  await harnessed.call('compress', { spans: [{ from: anchors[0], to: anchors[2], summary: 'First summary of the oldest exchange with enough detail.' }] })
  const block = foldSession(session).nodes.find(node => node.block)
  const second = await harnessed.call('compress', {
    spans: [{ from: block.left, to: block.right, summary: 'Shorter second summary of the same exchange.' }],
  })
  assert.equal(second.applied[0].tier, 2)
  const state = foldSession(session)
  assert.equal(state.nodes.filter(node => node.block).length, 1)
  assert.equal(state.nodes.find(node => node.block).tier, 2)
})

test('merging two blocks uses the outer pair and reports tier max+1', async () => {
  const session = longConversation(2)
  const harnessed = harness(session)
  let anchors = anchorsOf(session)
  await harnessed.call('compress', { spans: [{ from: anchors[0], to: anchors[2], summary: 'First block summary of the oldest exchange with enough detail.' }] })
  await harnessed.call('compress', { spans: [{ from: anchors[2], to: anchors[4], summary: 'Second block summary of the next exchange with enough detail.' }] })
  const merged = await harnessed.call('compress', {
    spans: [{ from: anchors[0], to: 'end', summary: 'Merged outer summary replacing both blocks with enough detail.' }],
  })
  assert.equal(merged.applied[0].from, anchors[0])
  assert.equal(merged.applied[0].to, anchors[4])
  const state = foldSession(session)
  const blocks = state.nodes.filter(node => node.block)
  assert.equal(blocks.length, 1)
  assert.equal(blocks[0].left, anchors[0])
  assert.equal(blocks[0].right, anchors[4])
})

test('summaries lose anchor text and keep the requested topic', async () => {
  const session = longConversation(2)
  const harnessed = harness(session)
  const anchors = anchorsOf(session)
  const result = await harnessed.call('compress', {
    spans: [{ from: anchors[0], to: anchors[2], summary: `See ${formatAnchor(anchors[4])} and [#3] for details; the first exchange is summarized here anyway.`, topic: 'history' }],
  })
  assert.equal(result.ok, true)
  const texts = render(session)
  assert.doesNotMatch(texts[0], new RegExp(formatAnchor(anchors[4])))
  assert.match(texts[0], /\[#3\]/)
  const state = foldSession(session)
  assert.equal(state.nodes.find(node => node.block).topic, 'history')
})

test('compress rejects unknown, reversed, overlapping, and protected-current-turn spans', async () => {
  const session = longConversation(1)
  // Add a second visible anchor inside the current turn, after its first one.
  // 中文：在当前回合第一条可见锚点之后再追加一个可见锚点。
  session.assistant({ text: 'working inside the protected turn' })
  const harnessed = harness(session)
  const anchors = anchorsOf(session)
  const current = anchors.at(-1)
  const unknown = 'zzzz'
  await assert.rejects(harnessed.call('compress', { spans: [{ from: unknown, to: 'end', summary: 'x'.repeat(40) }] }), /不是可见消息锚点/)
  await assert.rejects(harnessed.call('compress', { spans: [{ from: anchors[1], to: anchors[0], summary: 'x'.repeat(40) }] }), /选不到内容/)
  await assert.rejects(harnessed.call('compress', {
    spans: [
      { from: anchors[0], to: anchors[2], summary: 'x'.repeat(40) },
      { from: anchors[1], to: anchors[2], summary: 'y'.repeat(40) },
    ],
  }), /重叠/)
  await assert.rejects(
    harnessed.call('compress', { spans: [{ from: anchors[0], to: current, summary: 'x'.repeat(40) }] }),
    (error) => {
      assert.match(error.message, /受保护的当前回合/)
      assert.match(error.message, /“end”/)
      return true
    },
  )
})

test('compress skips an unanchored current-turn prefix when to is its first visible anchor', async () => {
  const session = new FakeSession()
  session.turnStart()
  session.system('You are a test agent.')
  session.user('previous question')
  session.assistant({ text: 'previous answer' })
  session.endTurn()
  session.turnStart()
  session.system('runtime context for the protected turn')
  session.user('current question')

  const harnessed = harness(session)
  const anchors = anchorsOf(session)
  const result = await harnessed.call('compress', {
    spans: [{
      from: anchors[0],
      to: anchors[2],
      summary: 'The previous exchange was summarized before the protected current turn.',
    }],
  })
  assert.equal(result.ok, true)
  assert.equal(result.applied[0].to, anchors[2])
  assert.equal(result.applied[0].shadowedMessages, 2)

  const state = foldSession(session)
  const block = state.nodes.find(node => node.block)
  assert.ok(block)
  assert.equal(block.left, anchors[0])
  assert.equal(block.right, anchors[2])
  assert.deepEqual(anchorsOf(session), [block.left, block.right])
})

test('compress rejects a span whose edge splits an assistant tool-call group', async () => {
  const session = new FakeSession()
  session.turnStart()
  session.user('please read the file')
  session.assistant({ toolCalls: [{ id: 'call-1', name: 'read' }] })
  session.toolResult('call-1', 'file contents')
  session.assistant({ text: 'the file says hello' })
  session.endTurn()
  session.turnStart()
  session.user('next question')
  const harnessed = harness(session)
  const anchors = anchorsOf(session)
  const before = session.snapshotEvents().length
  await assert.rejects(
    harnessed.call('compress', { spans: [{ from: anchors[0], to: anchors[1], summary: 'The file was read and reported hello in the first exchange.' }] }),
    /tool-call 组/,
  )
  assert.equal(session.snapshotEvents().length, before)
  assert.equal(session.snapshotEvents().filter(event => event.type === 'compaction/summary').length, 0)
  await assert.rejects(
    harnessed.call('compress', { spans: [{ from: anchors[1], to: anchors[2], summary: 'The file was read and reported hello in the first exchange.' }] }),
    /tool-call 组/,
  )
})

test('one compress call folds two spans that each contain a complete tool call/result pair', async () => {
  const session = new FakeSession()
  session.turnStart()
  session.stepStart()
  session.user('read file A')
  session.assistant({ toolCalls: [{ id: 'call-a', name: 'read' }] })
  session.toolResult('call-a', 'A'.repeat(400))
  session.assistant({ text: 'file A was read and summarized' })
  session.endTurn()
  session.turnStart()
  session.stepStart()
  session.user('read file B')
  session.assistant({ toolCalls: [{ id: 'call-b', name: 'read' }] })
  session.toolResult('call-b', 'B'.repeat(400))
  session.assistant({ text: 'file B was read and summarized' })
  session.endTurn()
  session.turnStart()
  session.stepStart()
  session.user('now fold both read turns')

  const harnessed = harness(session)
  const anchors = anchorsOf(session)
  const result = await harnessed.call('compress', {
    spans: [
      { from: anchors[0], to: anchors[3], summary: 'Turn one: file A was read and summarized, with no follow-up.' },
      { from: anchors[3], to: anchors[6], summary: 'Turn two: file B was read and summarized, with no follow-up.' },
    ],
  })
  assert.equal(result.applied.length, 2)
  const state = foldSession(session)
  const blocks = state.nodes.filter(node => node.block)
  assert.equal(blocks.length, 2)
  assert.deepEqual(blocks.map(block => [block.left, block.right]), [[anchors[0], anchors[3]], [anchors[3], anchors[6]]])
  assert.equal(state.nodes.filter(node => node.role === 'tool').length, 0)

  const summaries = session.snapshotEvents().filter(event => event.type === 'compaction/summary')
  assert.equal(summaries.length, 2)
  for (const summary of summaries) {
    const types = summary.data.shadowedSeqs.map(seq => session.snapshotEvents()[seq].type)
    assert.ok(types.includes('tool/result'), 'each folded span keeps its tool result')
    assert.ok(types.includes('assistant/message'), 'each folded span keeps its assistant call turn')
  }
})

test('above 33% pressure requires a deep sweep ending at the latest safe boundary', async () => {
  const session = longConversation(2)
  const anchors = anchorsOf(session)
  const harnessed = harness(session, {}, { ratio: 0.5 })
  await assert.rejects(
    harnessed.call('compress', {
      spans: [{ from: anchors[0], to: anchors[2], summary: 'A partial fold that leaves a consumed tail above the deep-sweep threshold.' }],
    }),
    /做深扫.*最新安全可压边界/s,
  )
  assert.equal(session.snapshotEvents().filter(event => event.type === 'compaction/summary').length, 0)

  const result = await harnessed.call('compress', {
    spans: [
      { from: anchors[0], to: anchors[2], summary: 'First deep-sweep span from the consumed boundary.' },
      { from: anchors[2], to: 'end', summary: 'Second deep-sweep span through the latest safe boundary.' },
    ],
  })
  assert.equal(result.ok, true)
  assert.equal(result.applied.length, 2)
})

test('above 33% pressure only allows compression at the start of a new turn', async () => {
  const session = longConversation(1)
  const anchors = anchorsOf(session)
  // Put a tool result and a second assistant output into the current turn.
  // 中文：在当前回合放入一个工具结果和第二条 assistant 输出。
  session.toolResult('call-compress', 'tool output from the current turn')
  session.assistant({ toolCalls: [{ id: 'call-compress-2', name: 'compress' }] })
  const harnessed = harness(session, {}, { ratio: 0.5 })
  await assert.rejects(
    harnessed.call('compress', {
      spans: [{ from: anchors[0], to: 'end', summary: 'A deep sweep attempted after work has already happened in this turn.' }],
    }),
    /下一轮开始时再压缩/,
  )
  assert.equal(session.snapshotEvents().filter(event => event.type === 'compaction/summary').length, 0)
})

test('the deep-sweep guard is off below one third of the effective window', async () => {
  const session = longConversation(2)
  const anchors = anchorsOf(session)
  const harnessed = harness(session, {}, { ratio: 0.2 })
  const result = await harnessed.call('compress', {
    spans: [{ from: anchors[0], to: anchors[2], summary: 'A partial fold is allowed below the deep-sweep threshold.' }],
  })
  assert.equal(result.ok, true)
})

test('the miss guard rejects a high first-request miss before appending anything', async () => {
  const session = longConversation(2)
  const anchors = anchorsOf(session)
  const eventsBefore = session.snapshotEvents().length
  const harnessed = harness(session, { maxMissTokens: 1 })
  await assert.rejects(
    harnessed.call('compress', { spans: [{ from: anchors[0], to: anchors[2], summary: 'A summary that the miss guard must reject before writing.' }] }),
    /miss guard.*上限 1/s,
  )
  assert.equal(session.snapshotEvents().length, eventsBefore)
  assert.equal(session.snapshotEvents().filter(event => event.type === 'compaction/summary').length, 0)
})

test('the payback guard rejects a fold that needs more requests than allowed', async () => {
  const session = longConversation(2)
  const anchors = anchorsOf(session)
  const harnessed = harness(session, { maxPaybackRequests: 1 })
  await assert.rejects(
    harnessed.call('compress', { spans: [{ from: anchors[0], to: anchors[2], summary: 'A deliberately long summary that needs several requests to pay back its missed prefix tokens. '.repeat(3) }] }),
    /payback guard/,
  )
  assert.equal(session.snapshotEvents().filter(event => event.type === 'compaction/summary').length, 0)
})

test('configuration rejects unknown keys and invalid values', () => {
  assert.throws(() => resolveConfig({ nope: true }), /未知配置 key/)
  assert.throws(() => resolveConfig({ maxSpansPerCall: 0 }), /maxSpansPerCall/)
  assert.throws(() => resolveConfig({ maxMissTokens: 0 }), /maxMissTokens/)
  assert.throws(() => resolveConfig({ maxPaybackRequests: 'many' }), /maxPaybackRequests/)
  assert.throws(() => resolveConfig({ reservedOutputTokens: 0 }), /reservedOutputTokens/)
  assert.throws(() => resolveConfig({ growthTokens: 1 }), /未知配置 key/)
  const guards = resolveConfig({ maxMissTokens: null, maxPaybackRequests: 12, reservedOutputTokens: 1_000 })
  assert.equal(guards.maxMissTokens, null)
  assert.equal(guards.maxPaybackRequests, 12)
  assert.equal(guards.reservedOutputTokens, 1_000)
})

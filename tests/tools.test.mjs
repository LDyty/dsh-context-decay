import assert from 'node:assert/strict'
import { test } from 'node:test'
import { FakeSession, fakePluginContext, longConversation } from './helpers.mjs'
import { StateCache, foldAll, observedMessageOf } from '../lib/state.js'
import { resolveConfig } from '../lib/config.js'
import { registerTools } from '../lib/tools.js'
import { anchorDecorations, applyDecoration } from '../lib/render.js'

function harness(session, overrides = {}) {
  const ctx = fakePluginContext()
  const cache = new StateCache()
  const config = resolveConfig({ minSummaryChars: 20, maxSummaryChars: 8_000, ...overrides })
  registerTools(ctx, {
    config,
    stateOf: subject => cache.stateOf(subject),
    pressure: () => ({
      tokens: 0,
      window: 60_000,
      ratio: 0,
      totalWindow: 60_000,
      reservedOutput: 0,
      windowSource: 'config',
      reservationSource: 'config',
      source: 'estimate',
    }),
    log: () => {},
  })
  const tools = Object.fromEntries(ctx.registered.map(definition => [definition.name, definition]))
  const exec = { agent: { session }, signal: new AbortController().signal }
  return { tools, call: (name, args) => tools[name].execute(args, exec), ctx, cache, config }
}

function render(session) {
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
  return messages.map((message, index) => {
    const decorated = applyDecoration(message, decorations[index])
    return decorated.content.filter(block => block.type === 'text').map(block => block.text).join('')
  })
}

test('compress and drop accept visible anchor text and bare anchors', async () => {
  const session = longConversation(2)
  const harnessed = harness(session)
  const compressed = await harnessed.call('compress', {
    spans: [{ from: '⟦p0⟧', to: 'p2', summary: 'The first exchange was summarized with visible anchor arguments.' }],
  })
  assert.equal(compressed.ok, true)
  assert.equal(compressed.applied[0].from, 0)
  assert.equal(compressed.applied[0].to, 2)

  const dropped = await harnessed.call('drop', { from: '⟦p0⟧', to: '⟦p2⟧' })
  assert.equal(dropped.ok, true)
  assert.equal(dropped.dropped.from, 0)
  assert.equal(dropped.dropped.to, 2)
})

test('compress folds one span, appends the shadow-price ledger, and reports the pair', async () => {
  const session = longConversation(2)
  const harnessed = harness(session)
  const result = await harnessed.call('compress', {
    spans: [{ from: 0, to: 2, summary: 'The first exchange asked about the context and was answered.', topic: 'setup' }],
  })
  assert.equal(result.ok, true)
  assert.equal(result.applied.length, 1)
  assert.equal(result.applied[0].from, 0)
  assert.equal(result.applied[0].to, 2)
  assert.equal(result.applied[0].tier, 1)
  assert.ok(result.estimate.oneTimeMissTokens > 0)

  const state = foldAll(session.snapshotEvents())
  const blocks = state.nodes.filter(node => node.block)
  assert.equal(blocks.length, 1)
  assert.equal(blocks[0].left, 0)
  assert.equal(blocks[0].right, 2)
  assert.equal(blocks[0].topic, 'setup')

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
  assert.equal(ledger.from, 0)
  assert.equal(ledger.to, 2)

  const replacement = events.find(event => event.type === 'user/message' && event.surfaceOp !== 'append')
  assert.deepEqual(replacement.surfaceOp, { op: 'replace', startSeq: summaryEvent.data.shadowedRange.start, endSeq: summaryEvent.data.shadowedRange.end })
  for (const seq of summaryEvent.data.shadowedSeqs) assert.ok(replacement.sourceEventSeqs.includes(seq))
  assert.ok(replacement.sourceEventSeqs.includes(summaryEvent.seq))
  assert.equal(replacement.data.source.form, 'summary')
})

test('re-compressing the same pair keeps it and increments the tier', async () => {
  const session = longConversation(2)
  const harnessed = harness(session)
  await harnessed.call('compress', { spans: [{ from: 0, to: 2, summary: 'First summary of the oldest exchange with enough detail.' }] })
  const second = await harnessed.call('compress', { spans: [{ from: 0, to: 2, summary: 'Shorter second summary of the same exchange.' }] })
  assert.equal(second.applied[0].tier, 2)
  const state = foldAll(session.snapshotEvents())
  assert.equal(state.nodes.filter(node => node.block).length, 1)
  assert.equal(state.nodes.find(node => node.block).tier, 2)
})

test('merging two blocks uses the outer pair and reports tier max+1', async () => {
  const session = longConversation(2)
  const harnessed = harness(session)
  await harnessed.call('compress', { spans: [{ from: 0, to: 2, summary: 'First block summary of the oldest exchange with enough detail.' }] })
  await harnessed.call('compress', { spans: [{ from: 2, to: 4, summary: 'Second block summary of the next exchange with enough detail.' }] })
  const merged = await harnessed.call('compress', { spans: [{ from: 0, to: 'end', summary: 'Merged outer summary replacing both blocks with enough detail.' }] })
  assert.equal(merged.applied[0].from, 0)
  assert.equal(merged.applied[0].to, 4)
  const state = foldAll(session.snapshotEvents())
  const blocks = state.nodes.filter(node => node.block)
  assert.equal(blocks.length, 1)
  assert.equal(blocks[0].left, 0)
  assert.equal(blocks[0].right, 4)
})

test('drop removes the summary block and its left marker without a tombstone', async () => {
  const session = longConversation(2)
  const harnessed = harness(session)
  await harnessed.call('compress', { spans: [{ from: 0, to: 2, summary: 'A summary that is about to be dropped from the surface.' }] })
  assert.match(render(session)[0], /^⟦p0⟧ A summary/)
  const dropped = await harnessed.call('drop', { from: 0, to: 2 })
  assert.equal(dropped.ok, true)
  const texts = render(session)
  assert.match(texts[0], /^⟦p2⟧ /)
  assert.doesNotMatch(texts.join('\n'), /about to be dropped/)
  const state = foldAll(session.snapshotEvents())
  assert.equal(state.nodes.filter(node => node.block).length, 0)
  assert.ok(session.snapshotEvents().some(event => event.type === 'compaction/prune'))
  // A system replacement would corrupt the token-meter breakdown fold; the
  // drop placeholder must be an empty developer message instead.
  // 中文：system replacement 会破坏 token-meter 的 breakdown fold；drop 占位必须改成空的
  // developer 消息。
  const replacement = session.snapshotEvents().find(event => event.type === 'developer/message' && event.surfaceOp?.op === 'replace')
  assert.equal(replacement.data.message.content.length, 0)
  assert.equal(session.snapshotEvents().filter(event => event.type === 'system/message' && event.surfaceOp?.op === 'replace').length, 0)
})

test('summaries lose anchor text and keep the requested topic', async () => {
  const session = longConversation(2)
  const harnessed = harness(session)
  const result = await harnessed.call('compress', {
    spans: [{ from: 0, to: 2, summary: 'See ⟦p9⟧ and [#3] for details; the first exchange is summarized here anyway.', topic: 'history' }],
  })
  assert.equal(result.ok, true)
  assert.doesNotMatch(render(session)[0], /⟦p9⟧/)
  assert.match(render(session)[0], /\[#3\]/)
  const state = foldAll(session.snapshotEvents())
  assert.equal(state.nodes.find(node => node.block).topic, 'history')
})

test('compress rejects unknown, reversed, overlapping, and current-turn spans', async () => {
  const session = longConversation(1)
  session.assistant({ text: 'working inside the protected turn' })
  const harnessed = harness(session)
  await assert.rejects(harnessed.call('compress', { spans: [{ from: 99, to: 'end', summary: 'x'.repeat(40) }] }), /not a visible message anchor/)
  await assert.rejects(harnessed.call('compress', { spans: [{ from: 1, to: 0, summary: 'x'.repeat(40) }] }), /selects no content/)
  await assert.rejects(harnessed.call('compress', {
    spans: [
      { from: 0, to: 2, summary: 'x'.repeat(40) },
      { from: 1, to: 2, summary: 'y'.repeat(40) },
    ],
  }), /overlap/)
  await assert.rejects(
    harnessed.call('compress', { spans: [{ from: 0, to: 3, summary: 'x'.repeat(40) }] }),
    (error) => {
      assert.match(error.message, /current turn/)
      assert.match(error.message, /Use "end" as "to"/)
      return true
    },
  )
  await assert.rejects(
    harnessed.call('compress', { spans: [{ from: 2, to: 'end', summary: 'x'.repeat(40) }] }),
    /there is no compressible history before the current turn/,
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
  const result = await harnessed.call('compress', {
    spans: [{
      from: '⟦p0⟧',
      to: '⟦p2⟧',
      summary: 'The previous exchange was summarized before the protected current turn.',
    }],
  })
  assert.equal(result.ok, true)
  assert.equal(result.applied[0].to, 2)
  assert.equal(result.applied[0].shadowedMessages, 2)

  const state = foldAll(session.snapshotEvents())
  const block = state.nodes.find(node => node.block)
  assert.ok(block)
  assert.equal(block.left, 0)
  assert.equal(block.right, 2)
  assert.deepEqual(
    state.nodes.filter(node => node.left !== null).map(node => node.left),
    [0, 2],
  )
  assert.equal(state.nodes.filter(node => node.left === null).length, 2)
  assert.equal(state.nodes.find(node => node.left === 2)?.role, 'user')
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
  const before = session.snapshotEvents().length
  await assert.rejects(
    harnessed.call('compress', { spans: [{ from: 0, to: 1, summary: 'The file was read and reported hello in the first exchange.' }] }),
    /tool-call group/,
  )
  assert.equal(session.snapshotEvents().length, before)
  assert.equal(session.snapshotEvents().filter(event => event.type === 'compaction/summary').length, 0)
  await assert.rejects(
    harnessed.call('compress', { spans: [{ from: 1, to: 2, summary: 'The file was read and reported hello in the first exchange.' }] }),
    /tool-call group/,
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
  const result = await harnessed.call('compress', {
    spans: [
      { from: '⟦p0⟧', to: '⟦p3⟧', summary: 'Turn one: file A was read and summarized, with no follow-up.' },
      { from: 'p3', to: 'p6', summary: 'Turn two: file B was read and summarized, with no follow-up.' },
    ],
  })
  assert.equal(result.applied.length, 2)
  const state = foldAll(session.snapshotEvents())
  const blocks = state.nodes.filter(node => node.block)
  assert.equal(blocks.length, 2)
  assert.deepEqual(blocks.map(block => [block.left, block.right]), [[0, 3], [3, 6]])
  assert.equal(state.nodes.filter(node => node.role === 'tool').length, 0)

  const summaries = session.snapshotEvents().filter(event => event.type === 'compaction/summary')
  assert.equal(summaries.length, 2)
  for (const summary of summaries) {
    const types = summary.data.shadowedSeqs.map(seq => session.snapshotEvents()[seq].type)
    assert.ok(types.includes('tool/result'), 'each folded span keeps its tool result')
    assert.ok(types.includes('assistant/message'), 'each folded span keeps its assistant call turn')
  }
})

test('the miss guard rejects a high first-request miss before appending anything', async () => {
  const session = longConversation(2)
  const eventsBefore = session.snapshotEvents().length
  const harnessed = harness(session, { maxMissTokens: 1 })
  await assert.rejects(
    harnessed.call('compress', { spans: [{ from: 0, to: 2, summary: 'A summary that the miss guard must reject before writing.' }] }),
    /miss guard.*limit 1/s,
  )
  assert.equal(session.snapshotEvents().length, eventsBefore)
  assert.equal(session.snapshotEvents().filter(event => event.type === 'compaction/summary').length, 0)
})

test('the payback guard rejects a fold that needs more requests than allowed', async () => {
  const session = longConversation(2)
  const harnessed = harness(session, { maxPaybackRequests: 1 })
  await assert.rejects(
    harnessed.call('compress', { spans: [{ from: 0, to: 2, summary: 'A deliberately long summary that needs several requests to pay back its missed prefix tokens. '.repeat(3) }] }),
    /payback guard/,
  )
  assert.equal(session.snapshotEvents().filter(event => event.type === 'compaction/summary').length, 0)
})

test('the payback guard rejects a fold whose summary is not smaller than the folded content', async () => {
  const session = longConversation(2)
  const harnessed = harness(session, { maxPaybackRequests: 5 })
  await assert.rejects(
    harnessed.call('compress', { spans: [{ from: 0, to: 2, summary: 'x'.repeat(700) }] }),
    /never pays back/,
  )
})

test('configuration rejects unknown keys and invalid values', () => {
  assert.throws(() => resolveConfig({ nope: true }), /unknown config key/)
  assert.throws(() => resolveConfig({ growthTokens: 0 }), /growthTokens/)
  assert.throws(() => resolveConfig({ warnRatios: [0.9, 0.8] }), /strictly ascending/)
  assert.throws(() => resolveConfig({ maxSpansPerCall: 0 }), /maxSpansPerCall/)
  assert.throws(() => resolveConfig({ maxMissTokens: 0 }), /maxMissTokens/)
  assert.throws(() => resolveConfig({ maxPaybackRequests: 'many' }), /maxPaybackRequests/)
  assert.throws(() => resolveConfig({ reservedOutputTokens: 0 }), /reservedOutputTokens/)
  assert.throws(() => resolveConfig({ maxPins: 1 }), /unknown config key/)
  const guards = resolveConfig({ maxMissTokens: null, maxPaybackRequests: 12, reservedOutputTokens: 1_000 })
  assert.equal(guards.maxMissTokens, null)
  assert.equal(guards.maxPaybackRequests, 12)
  assert.equal(guards.reservedOutputTokens, 1_000)
})

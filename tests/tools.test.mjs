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

test('compress accepts a bare anchor and keeps drop unregistered', async () => {
  const session = longConversation(2)
  const harnessed = harness(session)
  assert.equal(harnessed.tools.drop, undefined)
  const anchors = anchorsOf(session)
  const compressed = await harnessed.call('compress', {
    from: `#${anchors[0]}`,
    summary: 'The first exchange was summarized with a bare anchor argument.',
  })
  assert.equal(compressed.ok, true)
  assert.equal(compressed.applied.from, anchors[0])
  assert.equal(compressed.applied.to, anchors.at(-1))
})

test('compress folds from the requested anchor to the safe end and reports one pair', async () => {
  const session = longConversation(2)
  const harnessed = harness(session)
  const anchors = anchorsOf(session)
  const result = await harnessed.call('compress', {
    from: anchors[0],
    summary: 'The first exchange asked about the context and was answered.',
    topic: 'setup',
  })
  assert.equal(result.ok, true)
  assert.equal(result.applied.from, anchors[0])
  assert.equal(result.applied.to, anchors.at(-1))
  assert.equal(result.applied.tier, 1)
  assert.ok(result.estimate.oneTimeMissTokens > 0)

  const state = foldSession(session)
  const blocks = state.nodes.filter(node => node.block)
  assert.equal(blocks.length, 1)
  assert.equal(blocks[0].left, anchors[0])
  assert.equal(blocks[0].right, anchors.at(-1))
  assert.equal(blocks[0].topic, 'setup')
  assert.ok(state.free.includes(anchors[1]))

  const events = session.snapshotEvents()
  const summaryIndex = events.findIndex(event => event.type === 'compaction/summary')
  assert.equal(events[summaryIndex - 1].type, 'compaction/start')
  assert.equal(events[summaryIndex + 2].type, 'compaction/end')
  const start = events[summaryIndex - 1]
  const end = events[summaryIndex + 2]
  assert.equal(start.data.compactionId, events[summaryIndex].data.compactionId)
  assert.equal(end.data.compactionId, events[summaryIndex].data.compactionId)
  const summaryEvent = events[summaryIndex]
  const ledger = JSON.parse(summaryEvent.data.rawOutput[0].text)
  assert.equal(ledger.kind, 'context-decay')
  assert.equal(ledger.from, anchors[0])
  assert.equal(ledger.to, anchors.at(-1))

  const replacement = events.find(event => event.type === 'user/message' && event.surfaceOp !== 'append')
  assert.deepEqual(replacement.surfaceOp, {
    op: 'replace',
    startSeq: summaryEvent.data.shadowedRange.start,
    endSeq: summaryEvent.data.shadowedRange.end,
  })
  for (const seq of summaryEvent.data.shadowedSeqs) assert.ok(replacement.sourceEventSeqs.includes(seq))
  assert.ok(replacement.sourceEventSeqs.includes(summaryEvent.seq))
  assert.equal(replacement.data.source.form, 'summary')
})

test('re-compressing the summary block increments the tier', async () => {
  const session = longConversation(2)
  const harnessed = harness(session)
  const anchors = anchorsOf(session)
  await harnessed.call('compress', {
    from: anchors[0],
    summary: 'First summary of the oldest exchange with enough detail.',
  })
  const block = foldSession(session).nodes.find(node => node.block)
  const second = await harnessed.call('compress', {
    from: block.left,
    summary: 'Shorter second summary of the same exchange.',
  })
  assert.equal(second.applied.tier, 2)
  const state = foldSession(session)
  assert.equal(state.nodes.filter(node => node.block).length, 1)
  assert.equal(state.nodes.find(node => node.block).tier, 2)
})

test('summaries lose anchor text and keep the requested topic', async () => {
  const session = longConversation(2)
  const harnessed = harness(session)
  const anchors = anchorsOf(session)
  const result = await harnessed.call('compress', {
    from: anchors[0],
    summary: `See ${formatAnchor(anchors.at(-1))} and [#3] for details; the first exchange is summarized here anyway.`,
    topic: 'history',
  })
  assert.equal(result.ok, true)
  const texts = render(session)
  assert.doesNotMatch(texts[0], new RegExp(formatAnchor(anchors.at(-1))))
  assert.match(texts[0], /\[#3\]/)
  const state = foldSession(session)
  assert.equal(state.nodes.find(node => node.block).topic, 'history')
})

test('compress rejects unknown or missing anchors and the removed spans/to shape', async () => {
  const session = longConversation(1)
  const harnessed = harness(session)
  const anchors = anchorsOf(session)
  await assert.rejects(
    harnessed.call('compress', { from: 'zzzz', summary: 'x'.repeat(40) }),
    /找不到锚点/,
  )
  await assert.rejects(
    harnessed.call('compress', { from: anchors[0], to: anchors[2], summary: 'x'.repeat(40) }),
    /只接受 from/,
  )
  await assert.rejects(
    harnessed.call('compress', { spans: [{ from: anchors[0], summary: 'x'.repeat(40) }] }),
    /只接受 from/,
  )
  await assert.rejects(
    harnessed.call('compress', { summary: 'x'.repeat(40) }),
    /from 必须是/,
  )
})

test('compress rejects a from anchor inside the protected current turn', async () => {
  const session = longConversation(1)
  session.assistant({ text: 'working inside the protected turn' })
  const harnessed = harness(session)
  const current = anchorsOf(session).at(-1)
  await assert.rejects(
    harnessed.call('compress', { from: current, summary: 'x'.repeat(40) }),
    /当前轮开始前没有可压缩历史/,
  )
})

test('compress rejects a from anchor that splits an assistant tool-call group', async () => {
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
    harnessed.call('compress', {
      from: formatAnchor(anchors[1], 'R'),
      summary: 'The file was read and reported hello in the first exchange.',
    }),
    (error) => {
      assert.match(error.message, new RegExp(formatAnchor(anchors[1], 'R')))
      assert.match(error.message, /tool 结果锚点/)
      assert.match(error.message, /前一个可作起点的锚点/)
      assert.match(error.message, new RegExp(formatAnchor(anchors[0], 'O')))
      assert.doesNotMatch(error.message, new RegExp(formatAnchor(anchors[2], 'O')))
      assert.ok(error.message.length < 200, `error should stay short: ${error.message}`)
      return true
    },
  )
  assert.equal(session.snapshotEvents().length, before)
  assert.equal(session.snapshotEvents().filter(event => event.type === 'compaction/summary').length, 0)
})

test('compress stops before an unanchored current-turn prefix', async () => {
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
    from: anchors[0],
    summary: 'The previous exchange was summarized before the protected current turn.',
  })
  assert.equal(result.ok, true)
  assert.equal(result.applied.to, anchors[2])
  assert.equal(result.applied.shadowedMessages, 2)

  const state = foldSession(session)
  const block = state.nodes.find(node => node.block)
  assert.ok(block)
  assert.equal(block.left, anchors[0])
  assert.equal(block.right, anchors[2])
  assert.deepEqual(anchorsOf(session), [block.left, block.right])
})

test('below the 32.30% deep-sweep threshold allows a later from anchor to the safe end', async () => {
  const session = longConversation(2)
  const anchors = anchorsOf(session)
  const harnessed = harness(session, {}, { ratio: 0.2 })
  const result = await harnessed.call('compress', {
    from: anchors[2],
    summary: 'A suffix compression below the deep-sweep threshold.',
  })
  assert.equal(result.ok, true)
  assert.equal(result.applied.from, anchors[2])
})

test('above the 32.30% deep-sweep threshold requires the oldest visible anchor', async () => {
  const session = longConversation(2)
  const anchors = anchorsOf(session)
  const harnessed = harness(session, {}, { ratio: 0.5 })
  await assert.rejects(
    harnessed.call('compress', {
      from: anchors[1],
      summary: 'A deep sweep that starts too late and leaves the oldest history behind.',
    }),
    (error) => {
      assert.match(error.message, /32\.30%.*第一个锚点/)
      assert.match(error.message, new RegExp(formatAnchor(anchors[0], 'O')))
      return true
    },
  )
  // Simulate the host recording the failed call and the model retrying.
  // 中文：模拟宿主记录失败调用，以及模型再次重试。
  session.toolResult('call-compress', 'compress：这次压缩做深扫，from 必须选第一个锚点开始')
  session.assistant({ toolCalls: [{ id: 'call-compress-2', name: 'compress' }] })
  const result = await harnessed.call('compress', {
    from: anchors[0],
    summary: 'A deep sweep from the oldest visible anchor through the safe end.',
  })
  assert.equal(result.ok, true)
})

test('compression only starts a new turn', async () => {
  const session = longConversation(1)
  const anchors = anchorsOf(session)
  session.toolResult('call-compress', 'tool output from the current turn')
  session.assistant({ toolCalls: [{ id: 'call-compress-2', name: 'compress' }] })
  const harnessed = harness(session, {}, { ratio: 0.5 })
  await assert.rejects(
    harnessed.call('compress', {
      from: anchors[0],
      summary: 'A compression attempted after work has already happened in this turn.',
    }),
    /压缩只在每个新回合开始时进行/,
  )
  assert.equal(session.snapshotEvents().filter(event => event.type === 'compaction/summary').length, 0)
})

test('a failed compression at turn start can be retried in the same turn', async () => {
  const session = longConversation(1)
  const anchors = anchorsOf(session)
  const harnessed = harness(session, {}, { ratio: 0.2 })
  await assert.rejects(
    harnessed.call('compress', {}),
    /from 必须是/,
  )
  // Simulate the host appending the failed call's result and the retry call.
  // 中文：模拟宿主追加失败调用的结果，以及重试的 assistant 调用。
  session.toolResult('call-compress', 'compress：from 必须是类似 ⟦O#a8c5⟧ 的锚点')
  session.assistant({ toolCalls: [{ id: 'call-compress-retry', name: 'compress' }] })
  const result = await harnessed.call('compress', {
    from: anchors[0],
    summary: 'The corrected compression retried at the turn start.',
  })
  assert.equal(result.ok, true)
  assert.equal(session.snapshotEvents().filter(event => event.type === 'compaction/summary').length, 1)
})

test('a non-compress tool result after a failure still rejects the retry', async () => {
  const session = longConversation(1)
  const anchors = anchorsOf(session)
  const harnessed = harness(session, {}, { ratio: 0.2 })
  await assert.rejects(harnessed.call('compress', {}), /from 必须是/)
  session.toolResult('call-compress', 'compress：from 必须是类似 ⟦O#a8c5⟧ 的锚点')
  session.assistant({ toolCalls: [{ id: 'call-other', name: 'query' }] })
  session.toolResult('call-other', 'query output from the current turn')
  session.assistant({ toolCalls: [{ id: 'call-compress-retry', name: 'compress' }] })
  await assert.rejects(
    harnessed.call('compress', {
      from: anchors[0],
      summary: 'A retry after unrelated work must remain blocked.',
    }),
    /压缩只在每个新回合开始时进行/,
  )
  assert.equal(session.snapshotEvents().filter(event => event.type === 'compaction/summary').length, 0)
})

test('the fixed end stops before the protected current turn', async () => {
  const session = longConversation(2)
  const anchors = anchorsOf(session)
  const harnessed = harness(session, {}, { ratio: 0.2 })
  const result = await harnessed.call('compress', {
    from: anchors[0],
    summary: 'The whole consumed history is folded through the safe boundary.',
  })
  assert.equal(result.ok, true)
  assert.ok(render(session).some(text => text.includes('current turn question')))
  const state = foldSession(session)
  const block = state.nodes.find(node => node.block)
  assert.ok(block)
  assert.equal(block.right, anchors.at(-1))
})

test('the miss guard rejects a high first-request miss before appending anything', async () => {
  const session = longConversation(2)
  const anchors = anchorsOf(session)
  const eventsBefore = session.snapshotEvents().length
  const harnessed = harness(session, { maxMissTokens: 1 })
  await assert.rejects(
    harnessed.call('compress', {
      from: anchors[0],
      summary: 'A summary that the miss guard must reject before writing.',
    }),
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
    harnessed.call('compress', {
      from: anchors[2],
      summary: 'x'.repeat(4_000),
    }),
    /payback guard/,
  )
  assert.equal(session.snapshotEvents().filter(event => event.type === 'compaction/summary').length, 0)
})

test('configuration rejects unknown keys and invalid values', () => {
  assert.throws(() => resolveConfig({ nope: true }), /未知配置 key/)
  assert.throws(() => resolveConfig({ maxSpansPerCall: 0 }), /未知配置 key/)
  assert.throws(() => resolveConfig({ maxMissTokens: 0 }), /maxMissTokens/)
  assert.throws(() => resolveConfig({ maxPaybackRequests: 'many' }), /maxPaybackRequests/)
  assert.throws(() => resolveConfig({ reservedOutputTokens: 0 }), /reservedOutputTokens/)
  assert.throws(() => resolveConfig({ growthTokens: 1 }), /未知配置 key/)
  const guards = resolveConfig({ maxMissTokens: null, maxPaybackRequests: 12, reservedOutputTokens: 1_000 })
  assert.equal(guards.maxMissTokens, null)
  assert.equal(guards.maxPaybackRequests, 12)
  assert.equal(guards.reservedOutputTokens, 1_000)
})

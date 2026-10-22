/**
 * Model-facing text consistency: one verb ("compress"), one noun for the
 * handle ("pair"), no leftover pin wording, and explicit anchor/usage rules.
 *
 * 中文：模型可见文案一致性：一个动词（"compress"）、一个 handle 名词（"pair"）、
 * 没有残留的 pin 措辞，以及明确的锚点/用法规则。
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fakePluginContext } from './helpers.mjs'
import { StateCache } from '../lib/state.js'
import { resolveConfig } from '../lib/config.js'
import { registerTools } from '../lib/tools.js'
import { GUIDANCE, reminderText } from '../lib/prompt.js'

function toolDefinitions() {
  const ctx = fakePluginContext()
  registerTools(ctx, {
    config: resolveConfig({}),
    stateOf: session => new StateCache().stateOf(session),
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
  return Object.fromEntries(ctx.registered.map(definition => [definition.name, definition]))
}

test('model-facing guidance and tool text use one vocabulary and explain anchors, pairs, and tool groups', () => {
  const tools = toolDefinitions()
  assert.match(GUIDANCE, /Anchors are presentation, not content/)
  assert.match(GUIDANCE, /do not narrate the compression itself/i)
  assert.match(GUIDANCE, /Only the leading ⟦p<number>⟧ prefix is an anchor/)
  assert.match(GUIDANCE, /⟦p12⟧/)
  assert.match(GUIDANCE, /tool results carry anchors and can be compressed/i)
  assert.match(GUIDANCE, /All results of one assistant tool-call message must stay in the same span/)
  assert.match(GUIDANCE, /span edge inside that group is rejected/)
  assert.match(GUIDANCE, /invalidates the cached prefix from "from" onward/)
  assert.match(GUIDANCE, /If content in the middle must stay live, compress the consumed spans on either side of it separately/)
  assert.match(GUIDANCE, /Pass all consumed spans in one call/)
  assert.match(GUIDANCE, /One span: compress\(\{spans:\[\{from:"⟦p0⟧", to:"⟦p8⟧", summary:"\.\.\."\}\]\}\)/)
  assert.match(GUIDANCE, /Multiple non-overlapping spans: compress\(\{spans:\[\{from:"⟦p0⟧", to:"⟦p8⟧"/)
  assert.match(GUIDANCE, /drop\(\{from:"⟦p0⟧", to:"⟦p8⟧"\}\)/)
  assert.match(GUIDANCE, /Anchor arguments are tool values/)
  assert.doesNotMatch(GUIDANCE, /from: 0/)
  assert.match(GUIDANCE, /Do not compress still-needed recent work just to shorten the tail/)
  assert.match(GUIDANCE, /first visible anchor.*unanchored messages before it are kept/)
  assert.doesNotMatch(GUIDANCE, /context_status/)
  assert.doesNotMatch(GUIDANCE, /\b(pin|unpin)\b/i)
  assert.doesNotMatch(GUIDANCE, /\bfold/i)

  assert.match(tools.compress.description, /Compress fully consumed history/)
  assert.match(tools.compress.description, /one-time miss estimate/)
  assert.match(tools.compress.description, /rejected/)
  assert.match(tools.compress.parameters.properties.spans.items.properties.topic.description, /block ledger/)
  assert.equal(tools.compress.parameters.properties.spans.items.properties.from.type, 'string')
  assert.equal(tools.compress.parameters.properties.spans.items.properties.to.type, 'string')
  assert.match(tools.compress.description, /from:"⟦p0⟧", to:"⟦p8⟧"/)
  assert.match(tools.compress.description, /Multiple non-overlapping spans/)
  assert.equal(tools.drop.parameters.properties.from.type, 'string')
  assert.match(tools.drop.description, /drop\(\{from:"⟦p0⟧", to:"⟦p8⟧"\}\)/)

  assert.match(tools.drop.description, /exact live pair/)
  assert.equal(tools.context_status, undefined)
  for (const name of ['compress', 'drop']) {
    assert.doesNotMatch(tools[name].description, /\b(pin|unpin)\b/i)
  }

  const normal = reminderText({
    kind: 'normal', level: 0, levels: 3, tokens: 50_000, window: 744_000, ratio: 50_000 / 744_000,
    growth: 20_000, firstPosition: 4, endPosition: 20,
  })
  const critical = reminderText({
    kind: 'warning', level: 3, levels: 3, tokens: 720_000, window: 744_000, ratio: 720_000 / 744_000,
    growth: null, firstPosition: 4, endPosition: 20,
  })
  assert.match(normal, /compress fully consumed history/)
  assert.match(normal, /from:"⟦p4⟧", to:"⟦p20⟧"/)
  assert.doesNotMatch(normal, /integer inside/)
  assert.doesNotMatch(normal, /\bfold/i)
  assert.match(critical, /Compress fully consumed history immediately/)
  assert.match(critical, /from:"⟦p4⟧", to:"⟦p20⟧"/)
  assert.doesNotMatch(critical, /\bfold|drop/i)
})

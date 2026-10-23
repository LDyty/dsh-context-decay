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
  assert.match(GUIDANCE, /Summary contract/)
  assert.match(GUIDANCE, /Decisions and their rationale/)
  assert.match(GUIDANCE, /Open questions, risks, TODOs/)
  assert.match(GUIDANCE, /Pressure levels are signals to look for a suitable moment, not deadlines/)
  assert.match(GUIDANCE, /Waiting until pressure is high can be reasonable/)
  assert.match(GUIDANCE, /When compressing existing summaries \(higher tiers\), distill rather than repeat/)
  assert.match(GUIDANCE, /Deep sweep:/)
  assert.match(GUIDANCE, /roughly one-third of the effective window/)
  assert.match(GUIDANCE, /latest safe compressible boundary/)
  assert.match(GUIDANCE, /Leave no consumed content in the tail/)
  assert.match(GUIDANCE, /older spans brief and make newer spans more detailed/)
  assert.match(GUIDANCE, /gap between spans is allowed only for content that is still active/)
  assert.doesNotMatch(GUIDANCE, /repository|compiler|unit test|build log|source code/i)
  assert.match(GUIDANCE, /Only the leading ⟦p<number>⟧ prefix is an anchor/)
  assert.match(GUIDANCE, /ids are monotonic and never reused/)
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
  assert.match(tools.compress.description, /summary contract in the guidance/)
  assert.match(tools.compress.parameters.properties.spans.items.properties.summary.description, /summary contract|state, decisions/)
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
  const warning2 = reminderText({
    kind: 'warning', level: 2, levels: 3, tokens: 640_000, window: 744_000, ratio: 640_000 / 744_000,
    growth: 20_000, firstPosition: 4, endPosition: 20,
  })
  const warning1 = reminderText({
    kind: 'warning', level: 1, levels: 3, tokens: 520_000, window: 744_000, ratio: 520_000 / 744_000,
    growth: 20_000, firstPosition: 4, endPosition: 20,
  })
  const early = reminderText({
    kind: 'normal', level: 0, levels: 3, tokens: 240_000, window: 744_000, ratio: 240_000 / 744_000,
    growth: 20_000, firstPosition: 4, endPosition: 20,
  })
  const deep = reminderText({
    kind: 'normal', level: 0, levels: 3, tokens: 260_000, window: 744_000, ratio: 260_000 / 744_000,
    growth: 20_000, firstPosition: 4, endPosition: 20,
  })
  assert.match(normal, /When a suitable break appears/)
  assert.match(normal, /compress fully consumed history/)
  assert.match(normal, /from:"⟦p4⟧", to:"⟦p20⟧"/)
  assert.doesNotMatch(normal, /integer inside/)
  assert.doesNotMatch(normal, /\bfold/i)
  assert.doesNotMatch(normal, /Deep sweep:/)
  assert.match(warning2, /Deep sweep: end the final span at the latest safe compressible boundary/)
  assert.doesNotMatch(warning2, /oldest/i)
  assert.match(warning2, /if none is near, compress fully consumed history up to the active step/)
  assert.match(warning1, /When a suitable break appears, consider compressing fully consumed history; if pressure is rising faster than expected, act sooner/)
  assert.doesNotMatch(early, /Deep sweep:/)
  assert.match(deep, /Deep sweep:/)
  assert.match(critical, /Compress fully consumed history now, preserving the active step/)
  assert.match(critical, /Deep sweep: end the final span at the latest safe compressible boundary/)
  assert.match(critical, /from:"⟦p4⟧", to:"⟦p20⟧"/)
  assert.doesNotMatch(critical, /\bfold|drop/i)
})

/**
 * Model-facing text consistency: concise Chinese guidance, single-anchor
 * compress, positive wording, and no leftover drop/tier instructions.
 *
 * 中文：模型可见文案一致性：简洁中文 guidance、单锚点 compress、正向描述，
 * 没有残留的 drop/分级说明。
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fakePluginContext } from './helpers.mjs'
import { StateCache } from '../lib/state.js'
import { resolveConfig } from '../lib/config.js'
import { registerTools } from '../lib/tools.js'
import { DEEP_SWEEP_TOKENS, GUIDANCE, TIER_LONG_CONTEXT_TOKENS } from '../lib/prompt.js'

function toolDefinitions() {
  const ctx = fakePluginContext()
  registerTools(ctx, {
    config: resolveConfig({}),
    stateOf: session => new StateCache().stateOf(session),
    log: () => {},
  })
  return Object.fromEntries(ctx.registered.map(definition => [definition.name, definition]))
}

test('guidance is concise and explains anchors, the single from boundary, and the summary contract', () => {
  assert.match(GUIDANCE, /^上下文自觉压缩已启用。/)
  assert.match(GUIDANCE, /带类型前缀（“O#”或“R#”）的四字符锚点/)
  assert.match(GUIDANCE, /⟦O#a8c5⟧ 或 ⟦R#a8c5⟧/)
  assert.match(GUIDANCE, /⟦O#a8c5⟧ 可用作压缩起点 from 参数/)
  assert.match(GUIDANCE, /锚点是定位句柄/)
  assert.match(GUIDANCE, /锚点会回收复用/)
  assert.match(GUIDANCE, /compress\(\{from, summary, topic\?\}\)/)
  assert.match(GUIDANCE, /描述：压缩从 from 锚点到当前轮开始之前的所有历史，生成一个高保真、自包含的摘要/)
  assert.match(GUIDANCE, /from：必须选一个 “O#” 前缀的锚点，例如 “⟦O#a8c5⟧”；也接受 “O#a8c5” 或 “a8c5”。不接受 “R#” 前缀的锚点/)
  assert.match(GUIDANCE, /summary：替换被压缩历史的、唯一保留的自包含摘要。这是 JSON 字符串：优先使用单引号或中文引号；需要双引号时进行转义/)
  assert.match(GUIDANCE, /topic：可选短主题/)
  assert.doesNotMatch(GUIDANCE, /返回：/)
  assert.match(GUIDANCE, /摘要契约/)
  assert.match(GUIDANCE, /开放问题、风险、TODO/)
  assert.match(GUIDANCE, /每开始新的一轮，此轮最开始就是自觉压缩工具调用窗口，你必须考虑是否压缩、压缩多少/)
  assert.match(GUIDANCE, /失败后可连续修正重试/)
  assert.doesNotMatch(GUIDANCE, /其他工具执行后/)
  assert.doesNotMatch(GUIDANCE, /20%/)
  assert.doesNotMatch(GUIDANCE, /32\.30|256K\/793K|384K/)
  assert.doesNotMatch(GUIDANCE, /未超过时可选任意锚点/)
  assert.doesNotMatch(GUIDANCE, /上下文中的锚点|上下文中的消息锚点|可见消息锚点|可见锚点|最老/)
  assert.equal(DEEP_SWEEP_TOKENS, 384_000)
  assert.ok(DEEP_SWEEP_TOKENS > TIER_LONG_CONTEXT_TOKENS)
  assert.match(GUIDANCE, /没有原文时读者还能继续吗/)
  assert.match(GUIDANCE, /摘要本身会被再次压缩/)
  assert.doesNotMatch(GUIDANCE, /已有摘要|更高层级|更高 tier/)
  assert.doesNotMatch(GUIDANCE, /spans/)
  assert.doesNotMatch(GUIDANCE, /\bto\b/)
  assert.doesNotMatch(GUIDANCE, /“end”|end 只/)
  assert.ok(GUIDANCE.length <= 2_500, `GUIDANCE is ${GUIDANCE.length} characters; expected <= 2500`)
})

test('compress is the only registered tool and its schema has one from boundary', () => {
  const tools = toolDefinitions()
  assert.equal(tools.drop, undefined)
  assert.equal(tools.context_status, undefined)
  assert.equal(
    tools.compress.description,
    '压缩从 from 锚点到当前轮开始之前的所有历史，生成一个高保真、自包含的摘要。',
  )
  assert.equal(
    tools.compress.parameters.properties.from.description,
    '必须选一个 “O#” 前缀的锚点，例如 “⟦O#a8c5⟧”；也接受 “O#a8c5” 或 “a8c5”。不接受 “R#” 前缀的锚点。',
  )
  assert.equal(
    tools.compress.parameters.properties.summary.description,
    '替换被压缩历史的、唯一保留的自包含摘要。这是 JSON 字符串：优先使用单引号或中文引号；需要双引号时进行转义。',
  )
  assert.equal(tools.compress.parameters.properties.topic.description, '可选短主题。')
  assert.equal(tools.compress.output.schema.description, undefined)
  assert.doesNotMatch(tools.compress.description, /spans|\bto\b|“end”/)
  assert.equal(tools.compress.parameters.properties.spans, undefined)
  assert.equal(tools.compress.parameters.properties.to, undefined)
  assert.deepEqual(tools.compress.parameters.required, ['from', 'summary'])
  assert.equal(tools.compress.parameters.additionalProperties, false)
})

test('the old English guidance and numbered warning bands are gone', () => {
  assert.doesNotMatch(GUIDANCE, /Context decay is enabled for this session/)
  assert.doesNotMatch(GUIDANCE, /warning level follows the current pressure band/)
  assert.doesNotMatch(GUIDANCE, /CRITICAL:/)
  assert.doesNotMatch(GUIDANCE, /drop\(\{from:/)
})

test('model-facing guidance keeps the affirmative directive style', () => {
  const tools = toolDefinitions()
  for (const text of [GUIDANCE, tools.compress.description]) {
    assert.doesNotMatch(text, /不要|不能|绝不|禁止|避免|不允许|只允许|不重叠/)
  }
})

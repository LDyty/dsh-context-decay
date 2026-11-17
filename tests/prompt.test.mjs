/**
 * Model-facing text consistency: Chinese guidance, new anchors, one compress
 * tool, positive wording, and no leftover drop/tier instructions.
 *
 * 中文：模型可见文案一致性：中文 guidance、新锚点、只有 compress 工具、正向描述，
 * 没有残留的 drop/分级说明。
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fakePluginContext } from './helpers.mjs'
import { StateCache } from '../lib/state.js'
import { resolveConfig } from '../lib/config.js'
import { registerTools } from '../lib/tools.js'
import { GUIDANCE } from '../lib/prompt.js'

function toolDefinitions() {
  const ctx = fakePluginContext()
  registerTools(ctx, {
    config: resolveConfig({}),
    stateOf: session => new StateCache().stateOf(session),
    log: () => {},
  })
  return Object.fromEntries(ctx.registered.map(definition => [definition.name, definition]))
}

test('guidance is Chinese, positive, and explains anchors, pairs, and tool groups', () => {
  const tools = toolDefinitions()
  assert.match(GUIDANCE, /^上下文自觉压缩已启用。/)
  assert.match(GUIDANCE, /四字符锚点/)
  assert.match(GUIDANCE, /⟦#a8c5⟧/)
  assert.match(GUIDANCE, /锚点是定位句柄，不属于消息内容/)
  assert.match(GUIDANCE, /锚点会回收复用/)
  assert.match(GUIDANCE, /摘要会替代原内容/)
  assert.match(GUIDANCE, /一次调用可以传多个不重叠的 span/)
  assert.match(GUIDANCE, /compress\(\{spans:\[\{from:"⟦#a8c5⟧", to:"⟦#c9d1⟧"/)
  assert.match(GUIDANCE, /摘要契约/)
  assert.match(GUIDANCE, /高保真摘要/)
  assert.match(GUIDANCE, /开放问题、风险、TODO/)
  assert.match(GUIDANCE, /当前回合受保护/)
  assert.match(GUIDANCE, /同一条 assistant tool-call 消息的所有结果可以一起压缩/)
  assert.match(GUIDANCE, /优先在开始新的一轮时压缩/)
  assert.match(GUIDANCE, /深扫规则/)
  assert.match(GUIDANCE, /超过有效窗口大约 33%/)
  assert.match(GUIDANCE, /只允许在开始新的一轮时压缩/)
  assert.match(GUIDANCE, /最后一个 span 必须结束于最新安全可压边界/)
  assert.match(GUIDANCE, /当前轮次第一条可见锚点/)
  assert.match(GUIDANCE, /有效窗口的 2\.5%/)
  assert.doesNotMatch(GUIDANCE, /drop|Context decay is enabled|warning 1\/|critical|pin|context_status/i)
  assert.doesNotMatch(GUIDANCE, /⟦p12⟧/)
  assert.doesNotMatch(GUIDANCE, /\bfold\b/i)
})

test('compress is the only registered tool and its text is Chinese', () => {
  const tools = toolDefinitions()
  assert.equal(tools.drop, undefined)
  assert.equal(tools.context_status, undefined)
  assert.match(tools.compress.description, /把已经消费完的历史压缩成自包含的有损摘要/)
  assert.match(tools.compress.description, /⟦#a8c5⟧/)
  assert.match(tools.compress.description, /一次性 miss/)
  assert.match(tools.compress.description, /一次调用可以传多个不重叠 span/)
  assert.match(tools.compress.description, /\{from:"⟦#e2f3⟧", to:"end"/)
  assert.match(tools.compress.description, /有效窗口压力超过约 33%/)
  assert.match(tools.compress.description, /最后一个 span 必须结束于最新安全可压边界/)
  assert.match(tools.compress.parameters.properties.spans.items.properties.from.description, /⟦#a8c5⟧/)
  assert.match(tools.compress.parameters.properties.spans.items.properties.to.description, /“end”/)
  assert.match(tools.compress.parameters.properties.spans.items.properties.topic.description, /摘要块账本/)
  assert.equal(tools.compress.parameters.properties.spans.items.properties.from.type, 'string')
  assert.equal(tools.compress.parameters.properties.spans.items.properties.to.type, 'string')
  assert.doesNotMatch(tools.compress.description, /drop/i)
})

test('the old English guidance and numbered warning bands are gone', () => {
  assert.doesNotMatch(GUIDANCE, /Context decay is enabled for this session/)
  assert.doesNotMatch(GUIDANCE, /warning level follows the current pressure band/)
  assert.doesNotMatch(GUIDANCE, /CRITICAL:/)
  assert.doesNotMatch(GUIDANCE, /drop\(\{from:/)
})

/**
 * Model-facing tool: compress.
 *
 * Every call validates against the replayed surface before writing anything, so
 * a rejected call leaves the Session unchanged and returns one actionable error
 * to the model. Writes reuse the harness's sanitized event vocabulary:
 * `compaction/summary` (shadow price + ledger) immediately followed by the
 * replacement `user/message`.
 *
 * 中文：模型可见工具：compress。
 * 每次调用写任何东西之前都先对重放 surface 校验，因此被拒绝的调用不会改变 Session，
 * 只向模型返回一条可操作的错误。写入复用宿主已消毒的事件词汇：
 * `compaction/summary`（shadow price + ledger）后面紧跟 replacement `user/message`。
 */

import { randomUUID } from 'node:crypto'
import type {
  JsonSchema,
  PluginContextLike,
  SessionLike,
  ToolDefinitionLike,
  ToolRegistryLike,
  ToolRunContextLike,
} from './types.js'
import type { DecayState, NodeRecord } from './state.js'
import {
  DecayError,
  assertDisjointSpans,
  carrierStartIndex,
  compressibleEndIndex,
  resolveSpan,
} from './blocks.js'
import type { ResolvedSpan } from './blocks.js'
import { estimateMiss } from './pricing.js'
import type { MissEstimate } from './pricing.js'
import { parseAnchorArgument, parseAnchorBound, stripAnchors } from './anchor.js'
import { DEEP_SWEEP_RATIO } from './prompt.js'
import type { ResolvedConfig } from './config.js'
import type { ReservationSource, WindowSource } from './window.js'

/**
 * Pressure facts shared by the reminder and the panel.
 * 中文：提醒和面板共享的压力事实。
 */
export interface PressureReading {
  readonly tokens: number
  /**
   * Effective denominator: total window minus the output reservation.
   * 中文：有效分母：总窗口减去输出预留。
   */
  readonly window: number
  readonly ratio: number
  readonly totalWindow: number
  readonly reservedOutput: number
  readonly windowSource: WindowSource
  readonly reservationSource: ReservationSource
  /**
   * Where the token count came from: the patched meter, provider usage, or the local estimate.
   * 中文：token 数的来源：打过补丁的 meter、provider 用量，或本地估算。
   */
  readonly source: 'meter' | 'usage' | 'estimate'
}

/**
 * Runtime dependencies of the tool set.
 * 中文：工具集的运行时依赖。
 */
export interface ToolDeps {
  readonly config: ResolvedConfig
  readonly stateOf: (session: SessionLike) => DecayState
  /**
   * Optional pressure reader used by the deep-sweep guard.
   * 中文：深扫保护使用的可选压力读取器。
   */
  readonly pressure?: (session: SessionLike, state: DecayState) => PressureReading
  readonly log: (line: string) => void
}

/**
 * Per-span outcome reported to the model.
 * 中文：向模型汇报的每个 span 结果。
 */
interface AppliedSpan {
  readonly from: string
  readonly to: string | null
  readonly tier: number
  readonly summaryChars: number
  readonly shadowedMessages: number
  readonly shadowedTokens: number
}

const OUTPUT_SCHEMA: JsonSchema = {
  type: 'object',
  properties: { ok: { type: 'boolean' } },
  additionalProperties: true,
}

/**
 * Register the context-decay tool on the global tool registry.
 * 中文：把 context-decay 的工具注册到全局 tool registry。
 */
export function registerTools(ctx: PluginContextLike, deps: ToolDeps): void {
  const tools = ctx.get('tools') as ToolRegistryLike | undefined
  if (tools === undefined) throw new Error('context-decay：tools 服务不可用')
  const definition = compressTool(deps)
  ctx.effect(() => tools.register(definition))
}

/**
 * Build the `compress` tool.
 * 中文：构造 `compress` 工具。
 */
function compressTool(deps: ToolDeps): ToolDefinitionLike {
  return {
    name: 'compress',
    description:
      '把已经消费完的历史压缩成自包含的有损摘要。一次调用可以传多个不重叠 span，例如 '
      + 'compress({spans:[{from:"⟦#a8c5⟧", to:"⟦#c9d1⟧", summary:"..."}, '
      + '{from:"⟦#e2f3⟧", to:"end", summary:"..."}]})。每个 span 都是可见锚点的半开区间：'
      + '“from” 是第一条被压缩消息（含），“to” 是第一条保留消息（不含），或者可压缩历史末尾的 “end”。'
      + '锚点从消息前缀原样复制，例如 “⟦#a8c5⟧”；也接受裸句柄 “#a8c5” 或 “a8c5”。'
      + '示例锚点只是说明；使用当前会话可见的锚点。当前回合始终保留；如果 “to” 是它的第一条可见锚点，之前的无锚点消息会自动保留。'
      + '会把 assistant tool call 与结果切开的边界会被拒绝：同一条 assistant tool-call 消息的所有结果必须留在同一个 span。'
      + '当有效窗口压力超过约 33% 时，只允许在新一轮开始时做深扫：无论一次传几个 span，第一个 span 从已消费边界开始，'
      + '最后一个 span 必须结束于最新安全可压边界（通常是 “end” 或当前轮次第一条可见锚点），不能留下已消费 tail。'
      + '摘要会替代被压缩内容，请遵循 guidance 中的摘要契约，写全仍然重要的事实。'
      + '结果会报告配对、层级、摘要字符数、被遮蔽 token、保留 tail 和一次性 miss 估算。',
    parameters: {
      type: 'object',
      properties: {
        spans: {
          type: 'array',
          description: '要压缩的已消费区域；span 之间不能重叠。',
          items: {
            type: 'object',
            properties: {
              from: {
                type: 'string',
                description: '闭区间锚点，例如 “⟦#a8c5⟧”（也接受裸 “#a8c5” 或 “a8c5”）。',
              },
              to: {
                type: 'string',
                description: '排他锚点，例如 “⟦#c9d1⟧”，或 “end”。',
              },
              summary: {
                type: 'string',
                description: '替代该 span 的自包含摘要；保留状态、决策、精确事实和开放事项。这是 JSON 字符串：尽量使用单引号或中文引号，避免裸双引号。',
              },
              topic: {
                type: 'string',
                description: '可选短主题，记录到摘要块账本。',
              },
            },
            required: ['from', 'to', 'summary'],
            additionalProperties: false,
          },
        },
      },
      required: ['spans'],
      additionalProperties: false,
    },
    output: { schema: OUTPUT_SCHEMA, render: renderJson },
    execute: async (args, exec) => executeCompress(args, exec, deps),
  }
}

/**
 * Execute one `compress` call.
 * 中文：执行一次 `compress` 调用。
 */
async function executeCompress(args: unknown, exec: ToolRunContextLike, deps: ToolDeps): Promise<unknown> {
  const session = requireSession(exec, 'compress')
  const record = asRecord(args, 'compress')
  const rawSpans = record['spans']
  if (!Array.isArray(rawSpans) || rawSpans.length === 0) {
    throw new DecayError('compress：“spans” 必须是非空数组')
  }
  if (rawSpans.length > deps.config.maxSpansPerCall) {
    throw new DecayError(`compress：每次调用最多 ${deps.config.maxSpansPerCall} 个 span`)
  }
  const requests = rawSpans.map((span, index) => parseSpan(span, index, deps.config))
  const state = deps.stateOf(session)
  const resolved = requests.map(request => resolveSpan(state, request.from, request.to))
  assertDisjointSpans(resolved)
  const pressure = deps.pressure?.(session, state)
  if (pressure !== undefined) assertDeepSweep(state, resolved, pressure)
  const summaries = requests.map(request => request.summary)
  const estimate = estimateMiss(state, resolved, summaries)
  assertCostGuards(deps.config, estimate)
  const ordered = resolved
    .map((span, index) => ({ span, request: requests[index]! }))
    .sort((left, right) => right.span.startIndex - left.span.startIndex)
  const appliedByStart = new Map<number, AppliedSpan>()
  for (const { span, request } of ordered) {
    appliedByStart.set(span.startIndex, applyCompression(session, state, span, request, deps))
  }
  const applied = [...appliedByStart.entries()]
    .sort(([left], [right]) => left - right)
    .map(([, span]) => span)
  const result = { ok: true, applied, estimate }
  // Fold the just-appended transaction so the logged free count is current.
  // 中文：把刚追加的事务也折叠进来，让日志里的 free 计数是最新的。
  const after = deps.stateOf(session)
  deps.log(
    `compress：${applied.length} 个 span，遮蔽 ${estimate.shadowedTokens} tokens，`
    + `摘要 ${estimate.summaryTokens}，保留 tail ${estimate.keptTailTokens}，`
    + `一次性 miss ~${estimate.oneTimeMissTokens}，free ${after.free.length}（复用 ${after.reusedPositions}）`,
  )
  return result
}

/**
 * Enforce the deep-sweep policy once pressure exceeds one third of the
 * effective window.
 *
 * At that pressure a compression may only start a new turn, and the whole call
 * must be a deep sweep: the last span ends on the latest safe compressible
 * boundary, so no consumed tail is left behind. The prompt states the same
 * rule; this guard keeps a model mistake from silently violating it.
 *
 * 中文：当压力超过有效窗口三分之一时执行深扫策略。
 * 此时只允许在新一轮开始时压缩，并且整次调用必须是深扫：最后一个 span 结束于最新安全
 * 可压边界，不能留下已消费 tail。提示词写了同一规则；这个保护防止模型误操作静默违反。
 */
function assertDeepSweep(state: DecayState, spans: readonly ResolvedSpan[], pressure: PressureReading): void {
  if (pressure.ratio <= DEEP_SWEEP_RATIO) return
  const currentStart = carrierStartIndex(state)
  const current = state.nodes.slice(currentStart)
  const priorToolResults = current.filter(node => node.toolResult).length
  const assistantOutputs = current.filter(node => node.appended && node.role === 'assistant').length
  if (priorToolResults > 0 || assistantOutputs > 1) {
    throw new DecayError(
      'compress：当前有效窗口压力已超过约 33%，只允许在开始新的一轮时压缩；'
      + '当前轮次已经产生过工具结果或多次 assistant 输出，请先结束这一轮，在下一轮开始再压缩。',
    )
  }
  const latest = compressibleEndIndex(state)
  const lastEnd = Math.max(...spans.map(span => span.endIndex))
  if (lastEnd !== latest) {
    throw new DecayError(
      'compress：当前有效窗口压力已超过约 33%，必须做深扫：最后一个 span 要结束于最新安全可压边界，'
      + '通常是 “end” 或当前轮次第一条可见锚点，不能留下已消费 tail。'
      + '如果中间仍有活跃内容，可以把它两侧拆成多个不重叠 span，但最后一个 span 必须覆盖到最新安全边界。',
    )
  }
}

/**
 * Enforce the optional cost guards before anything is appended.
 *
 * Rejection explains the measured cost and the actionable alternatives; both
 * guards are off by default because the right threshold is deployment-specific.
 *
 * 中文：在追加任何内容之前执行可选的成本保护。
 * 拒绝时解释实测成本和可操作的替代方案；两个保护默认都关闭，因为合适的阈值取决于
 * 部署环境。
 */
function assertCostGuards(config: ResolvedConfig, estimate: MissEstimate): void {
  const suggestions = '建议：把 “to” 往后放以缩小保留 tail、压缩更大的已消费区域、'
    + '拆成多次调用，或把摘要写得更短。'
  if (config.maxMissTokens !== null && estimate.oneTimeMissTokens > config.maxMissTokens) {
    throw new DecayError(
      `compress：被 miss guard 拒绝：这次压缩后的首次请求预计 miss 约 ${estimate.oneTimeMissTokens} tokens`
      + `（上限 ${config.maxMissTokens}；摘要 ${estimate.summaryTokens}，保留 tail ${estimate.keptTailTokens}，`
      + `锚点 ${estimate.anchorTokens}）。${suggestions}`,
    )
  }
  if (config.maxPaybackRequests === null) return
  if (estimate.paybackRequests === null) {
    throw new DecayError(
      'compress：被 payback guard 拒绝：摘要不比被压缩内容小，这次压缩永远无法回本'
      + `其约 ${estimate.oneTimeMissTokens} tokens 的首次请求 miss（上限 ${config.maxPaybackRequests} 次请求）。`
      + '请压缩更多内容，或写更短的摘要。',
    )
  }
  if (estimate.paybackRequests > config.maxPaybackRequests) {
    throw new DecayError(
      `compress：被 payback guard 拒绝：这次压缩约需 ${estimate.paybackRequests} 次请求才能回本`
      + `其约 ${estimate.oneTimeMissTokens} tokens 的首次请求 miss（上限 ${config.maxPaybackRequests}）。${suggestions}`,
    )
  }
}

/**
 * One parsed span request.
 * 中文：一条已解析的 span 请求。
 */
interface SpanRequest {
  readonly from: string
  readonly to: string | 'end'
  readonly summary: string
  readonly topic: string | null
}

/**
 * Parse and validate one requested span.
 * 中文：解析并校验一条请求的 span。
 */
function parseSpan(value: unknown, index: number, config: ResolvedConfig): SpanRequest {
  const record = asRecord(value, `compress：spans[${index}]`)
  const from = parseAnchorArgument(record['from'])
  const to = parseAnchorBound(record['to'])
  const summary = record['summary']
  const topic = record['topic']
  if (from === null) {
    throw new DecayError(
      `compress：spans[${index}].from 必须是类似 “⟦#a8c5⟧” 的锚点（也接受 “#a8c5” 或 “a8c5”）`,
    )
  }
  if (to === null) {
    throw new DecayError(
      `compress：spans[${index}].to 必须是类似 “⟦#a8c5⟧” 的锚点或 “end”`,
    )
  }
  if (typeof summary !== 'string') {
    throw new DecayError(`compress：spans[${index}].summary 必须是字符串`)
  }
  if (topic !== undefined && typeof topic !== 'string') {
    throw new DecayError(`compress：spans[${index}].topic 存在时必须是字符串`)
  }
  // Anchors are presentation, never summary content.
  // 中文：锚点只是展示，永远不能进入摘要内容。
  const stripped = stripAnchors(summary)
  if (stripped.length < config.minSummaryChars) {
    throw new DecayError(
      `compress：spans[${index}].summary 至少要有 ${config.minSummaryChars} 个字符`
      + `（当前 ${stripped.length}）；摘要是被压缩内容唯一剩下的记录`,
    )
  }
  if (stripped.length > config.maxSummaryChars) {
    throw new DecayError(
      `compress：spans[${index}].summary 有 ${stripped.length} 个字符；上限是 ${config.maxSummaryChars}`,
    )
  }
  return {
    from,
    to,
    summary: stripped,
    topic: typeof topic === 'string' && topic.trim().length > 0 ? topic.trim() : null,
  }
}

/**
 * Append one compression transaction and return its model-facing outcome.
 * 中文：追加一次压缩事务，并返回其模型可见结果。
 */
function applyCompression(
  session: SessionLike,
  state: DecayState,
  span: ResolvedSpan,
  request: SpanRequest,
  deps: ToolDeps,
): AppliedSpan {
  const first = span.shadowed[0]
  const last = span.shadowed[span.shadowed.length - 1]
  if (first === undefined || last === undefined) throw new DecayError('compress：解析出的 span 为空')
  const shadowedSeqs = span.shadowed.map(node => node.seq)
  const tier = blockTierOf(span.shadowed)
  const context = session.requestContext?.()
  const ledger = {
    v: 1,
    kind: 'context-decay',
    mode: 'compress',
    from: span.from,
    to: span.to,
    tier,
    chars: request.summary.length,
    topic: request.topic,
    shadowedTokens: span.shadowedTokens,
  }
  // The session-format reader requires every `compaction/summary` to sit
  // inside one open start/end bracket whose owner turn is the current turn.
  // 中文：session-format reader 要求每个 `compaction/summary` 都位于一对已打开的
  // start/end 括号内，且所属 turn 是当前 turn。
  const compactionId = randomUUID()
  const turn = state.openTurn
  session.append('compaction/start', { compactionId, turn })
  const summaryEvent = session.append('compaction/summary', {
    compactionId,
    summary: [{ type: 'text', text: request.summary }],
    shadowedRange: { start: first.seq, end: last.seq },
    shadowedSeqs,
    shadowedTokenCount: span.shadowedTokens,
    provider: context?.provider ?? 'context-decay',
    model: context?.model ?? 'model-authored',
    rawOutput: [{ type: 'text', text: JSON.stringify(ledger) }],
  })
  const message = {
    id: randomUUID(),
    role: 'user',
    content: [{ type: 'text', text: request.summary }],
    source: {
      kind: 'context-decay',
      form: 'summary',
      ...request.topic === null ? {} : { topic: request.topic },
    },
  }
  session.append('user/message', message, {
    surfaceOp: { op: 'replace', startSeq: first.seq, endSeq: last.seq },
    sourceEventSeqs: [summaryEvent.seq, ...shadowedSeqs],
  })
  session.append('compaction/end', { compactionId, turn })
  return {
    from: span.from,
    to: span.to,
    tier,
    summaryChars: request.summary.length,
    shadowedMessages: span.shadowed.length,
    shadowedTokens: span.shadowedTokens,
  }
}

/**
 * Tier of a summary block produced over the given shadowed nodes.
 * 中文：由给定被遮蔽节点生成的摘要块的层级。
 */
function blockTierOf(shadowed: readonly NodeRecord[]): number {
  const only = shadowed.length === 1 ? shadowed[0] : undefined
  if (only !== undefined && only.block) return only.tier + 1
  return shadowed.reduce((max, node) => node.block ? Math.max(max, node.tier) : max, 0) + 1
}

/**
 * Require an agent session for a tool call.
 * 中文：要求工具调用必须有 agent session。
 */
function requireSession(exec: ToolRunContextLike, tool: string): SessionLike {
  const session = exec.agent?.session
  if (session === undefined) throw new DecayError(`${tool}：本次工具调用没有可用的 agent session`)
  return session
}

/**
 * Narrow tool arguments to a JSON object.
 * 中文：把工具参数收窄为 JSON 对象。
 */
function asRecord(value: unknown, subject: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new DecayError(`${subject}：参数必须是 JSON 对象`)
  }
  return value as Record<string, unknown>
}

/**
 * Render a canonical tool value as one compact text block.
 * 中文：把一个规范工具值渲染成一个紧凑 text 块。
 */
function renderJson(_args: unknown, value: unknown): readonly { type: string; text: string }[] {
  return [{ type: 'text', text: JSON.stringify(value) }]
}

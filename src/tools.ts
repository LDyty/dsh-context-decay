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
import { isSelectableNode } from './state.js'
import type { DecayState, NodeRecord } from './state.js'
import {
  DecayError,
  carrierStartIndex,
  resolveSpan,
} from './blocks.js'
import type { ResolvedSpan } from './blocks.js'
import { estimateMiss } from './pricing.js'
import type { MissEstimate } from './pricing.js'
import { formatAnchor, parseAnchorArgument, stripAnchors } from './anchor.js'
import { DEEP_SWEEP_TOKENS, formatTokens } from './prompt.js'
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
  /**
   * Optional human-readable session name for diagnostics.
   * 中文：诊断用的可选会话名称。
   */
  readonly label?: (session: SessionLike) => string
  readonly log: (line: string) => void
}

/**
 * Per-span outcome reported to the model.
 * 中文：向模型汇报的每个 span 结果。
 */
interface AppliedSpan {
  readonly from: string
  readonly to: string | null
  readonly summaryChars: number
  readonly shadowedMessages: number
  readonly shadowedTokens: number
}

/**
 * Failed compression attempts at the current turn start.
 * 中文：当前回合开始时失败的压缩尝试。
 */
interface CompressRetry {
  readonly turnStartSeq: number
  readonly attempts: number
}

const OUTPUT_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    '成功': { type: 'boolean' },
    '压缩': { type: 'object' },
    '估算': { type: 'object' },
  },
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
  const retries = new WeakMap<object, CompressRetry>()
  return {
    name: 'compress',
    description: '压缩从 from 锚点到当前轮开始之前的所有历史，生成一个高保真、自包含的摘要。',
    parameters: {
      type: 'object',
      properties: {
        from: {
          type: 'string',
          description: '必须选一个 “O#” 前缀的锚点，例如 “⟦O#a8c5⟧”；也接受 “O#a8c5” 或 “a8c5”。不接受 “R#” 前缀的锚点。',
        },
        summary: {
          type: 'string',
          description: '替换被压缩历史的、唯一保留的自包含摘要。这是 JSON 字符串：优先使用单引号或中文引号；需要双引号时进行转义。',
        },
        topic: {
          type: 'string',
          description: '可选短主题。',
        },
      },
      required: ['from', 'summary'],
      additionalProperties: false,
    },
    output: { schema: OUTPUT_SCHEMA, render: renderJson },
    execute: async (args, exec) => executeCompress(args, exec, deps, retries),
  }
}

/**
 * Execute one `compress` call, allowing a retry after a failed attempt at turn start.
 * 中文：执行一次 `compress` 调用；回合开始时的失败允许在同一回合内重试。
 */
async function executeCompress(
  args: unknown,
  exec: ToolRunContextLike,
  deps: ToolDeps,
  retries: WeakMap<object, CompressRetry>,
): Promise<unknown> {
  const session = requireSession(exec, 'compress')
  const state = deps.stateOf(session)
  const retry = retryStateOf(session, state, retries)
  const atStart = isTurnStart(state, retry)
  let wrote = false
  try {
    const result = await executeCompressInner(args, exec, deps, retries, () => {
      wrote = true
    })
    retries.delete(session)
    return result
  } catch (error) {
    if (wrote) {
      // A failed write may have left partial state; do not invite a retry.
      // 中文：写入失败可能留下部分状态，不再允许重试。
      retries.delete(session)
    } else if (atStart) {
      recordCompressFailure(session, state, retries)
    }
    throw error
  }
}

/**
 * One compression attempt; the retry wrapper above owns failure tracking.
 * 中文：一次压缩尝试；上层的重试包装负责失败记录。
 */
async function executeCompressInner(
  args: unknown,
  exec: ToolRunContextLike,
  deps: ToolDeps,
  retries: WeakMap<object, CompressRetry>,
  markWrite: () => void,
): Promise<unknown> {
  const session = requireSession(exec, 'compress')
  const record = asRecord(args, 'compress')
  if (record['spans'] !== undefined || record['to'] !== undefined) {
    throw new DecayError('compress：只接受 from、summary、topic；不再支持 spans 或 to。')
  }
  const request = parseRequest(record, deps.config)
  const state = deps.stateOf(session)
  const span = resolveSpan(state, request.from)
  assertTurnStart(state, retryStateOf(session, state, retries))
  const pressure = deps.pressure?.(session, state)
  if (pressure !== undefined) {
    // Match the reminder the model is acting on. The tool call's own assistant
    // message can push the live measurement across the threshold after the
    // reminder was written; using that later reading would reject a call the
    // model was told was ordinary. The next turn's reminder re-evaluates.
    // 中文：沿用模型正在执行的提醒读数。工具调用自身的 assistant 消息可能让实时读数在
    // 提醒之后越过阈值；沿用更晚的读数会拒绝一条模型被告知是普通的调用。下一轮提醒会
    // 重新评估。
    const remindedTokens = state.lastReminderTurn !== null
      && state.lastReminderTurn === state.openTurn
      && state.lastReminderTokens > 0
      ? state.lastReminderTokens
      : null
    assertDeepSweep(state, span, remindedTokens ?? pressure.tokens)
  }
  const estimate = estimateMiss(state, [span], [request.summary])
  assertCostGuards(deps.config, estimate)
  markWrite()
  const applied = applyCompression(session, state, span, request, deps)
  const result = {
    '成功': true,
    '压缩': {
      '起点锚点': applied.from,
      '终点锚点': applied.to,
      '摘要字符数': applied.summaryChars,
      '压缩消息数': applied.shadowedMessages,
      '压缩token数': applied.shadowedTokens,
    },
    '估算': {
      '摘要token数': estimate.summaryTokens,
      '保留消息数': estimate.keptTailMessages,
      '保留token数': estimate.keptTailTokens,
      '锚点token数': estimate.anchorTokens,
      '首次请求miss': estimate.oneTimeMissTokens,
      '回本次数': estimate.paybackRequests,
    },
  }
  // Fold the just-appended transaction so the logged free count is current.
  // 中文：把刚追加的事务也折叠进来，让日志里的 free 计数是最新的。
  const after = deps.stateOf(session)
  deps.log(
    `[${deps.label?.(session) ?? '未命名会话'}] 压缩：遮蔽 ${estimate.shadowedTokens} tokens，摘要 ${estimate.summaryTokens}，`
    + `保留 tail ${estimate.keptTailTokens}，一次性 miss ~${estimate.oneTimeMissTokens}，`
    + `free ${after.free.length}（复用 ${after.reusedPositions}）`,
  )
  return result
}

/**
 * Whether this call is still at the turn start.
 *
 * A normal call starts at the turn boundary. A retry is allowed only after
 * failed compression attempts, and only while the current turn contains exactly
 * those attempts' assistant outputs and tool results.
 *
 * 中文：这次调用是否仍处于回合开始处。
 * 普通调用只能在回合边界开始；只有压缩失败后的重试才放宽，且当前回合只能包含这些失败
 * 尝试的 assistant 输出与工具结果。
 */
function isTurnStart(state: DecayState, retry?: CompressRetry): boolean {
  const currentStart = carrierStartIndex(state)
  const current = state.nodes.slice(currentStart)
  const priorToolResults = current.filter(node => node.toolResult).length
  const assistantOutputs = current.filter(node => node.appended && node.role === 'assistant').length
  if (retry !== undefined) {
    return priorToolResults === retry.attempts && assistantOutputs === retry.attempts + 1
  }
  return priorToolResults === 0 && assistantOutputs <= 1
}

/**
 * Remember one failed compression attempt for the current turn.
 * 中文：记录当前回合的一次压缩失败尝试。
 */
function recordCompressFailure(session: SessionLike, state: DecayState, retries: WeakMap<object, CompressRetry>): void {
  const retry = retryStateOf(session, state, retries)
  retries.set(session, {
    turnStartSeq: state.turnStartSeq,
    attempts: (retry?.attempts ?? 0) + 1,
  })
}

/**
 * Look up failed attempts only when they belong to the current turn.
 * 中文：只取属于当前回合的失败尝试记录。
 */
function retryStateOf(
  session: SessionLike,
  state: DecayState,
  retries: WeakMap<object, CompressRetry>,
): CompressRetry | undefined {
  const retry = retries.get(session)
  return retry !== undefined && retry.turnStartSeq === state.turnStartSeq ? retry : undefined
}

/**
 * Compression is only accepted at the start of a new turn.
 *
 * At any pressure, a compression may only start a new turn. Once the current
 * turn has produced a tool result or more than one assistant output, the write
 * is rejected; the model retries at the next turn start. A failed compression
 * attempt at the turn start is the one exception: the model may correct the
 * arguments and retry in the same turn. This guard keeps a model mistake from
 * silently compressing mid-turn while still giving a failed attempt a fallback.
 *
 * 中文：压缩只在每个新回合开始时接受。
 * 任何压力下，压缩都必须在新回合开始时进行；当前轮次已经产生工具结果或多次 assistant
 * 输出后，写入会被拒绝，模型在下一回合开始时再压缩。回合开始处的压缩失败是唯一例外：
 * 可以修正参数后在同一回合重试。这个保护防止模型误操作在回合中途压缩，同时给失败尝试
 * 留出兜底机会。
 */
function assertTurnStart(state: DecayState, retry?: CompressRetry): void {
  if (isTurnStart(state, retry)) return
  throw new DecayError(
    'compress：压缩只在每个新回合开始时进行。当前回合已经产生过工具结果或多次 assistant 输出，请在下一回合开始再压缩。',
  )
}

/**
 * Enforce the deep-sweep policy once the used-token reading exceeds 384K.
 *
 * This guard is deliberately decoupled from the 256K long-context performance
 * tier: the tier hint still starts at 256K, but a compression only has to sweep
 * from the first selectable anchor above 384K.
 *
 * 中文：已用 token 超过 384K 时执行深扫策略。
 * 这个保护故意与 256K 的长上下文性能档位解耦：性能提示仍在 256K 开始，
 * 但只有超过 384K 时压缩才必须从第一个可选锚点开始。
 */
function assertDeepSweep(state: DecayState, span: ResolvedSpan, tokens: number): void {
  if (tokens <= DEEP_SWEEP_TOKENS) return
  const required = state.nodes.findIndex(node => node.left !== null && isSelectableNode(node))
  if (required >= 0 && span.startIndex !== required) {
    const requiredHandle = state.nodes[required]!.left!
    throw new DecayError(
      `compress：上下文已用超过 ${formatTokens(DEEP_SWEEP_TOKENS)}，这次压缩做深扫：from 必须选第一个锚点 ${formatAnchor(requiredHandle, 'O')}。`,
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
  const suggestions = '建议：把 from 往前移到更早的锚点、压缩更多已消费内容、'
    + '或把摘要写得更短。'
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
 * One parsed compression request.
 * 中文：一条已解析的压缩请求。
 */
interface CompressRequest {
  readonly from: string
  readonly summary: string
  readonly topic: string | null
}

/**
 * Parse and validate one compression request.
 * 中文：解析并校验一条压缩请求。
 */
function parseRequest(record: Record<string, unknown>, config: ResolvedConfig): CompressRequest {
  const from = parseAnchorArgument(record['from'])
  const summary = record['summary']
  const topic = record['topic']
  if (from === null) {
    throw new DecayError(
      'compress：from 必须是类似 “⟦O#a8c5⟧” 的锚点（也接受 “O#a8c5” 或 “a8c5”）',
    )
  }
  if (typeof summary !== 'string') {
    throw new DecayError('compress：summary 必须是字符串')
  }
  if (topic !== undefined && typeof topic !== 'string') {
    throw new DecayError('compress：topic 存在时必须是字符串')
  }
  // Anchors are presentation, never summary content.
  // 中文：锚点只是展示，永远不能进入摘要内容。
  const stripped = stripAnchors(summary)
  if (stripped.length < config.minSummaryChars) {
    throw new DecayError(
      `compress：summary 至少要有 ${config.minSummaryChars} 个字符`
      + `（当前 ${stripped.length}）；摘要是被压缩内容唯一剩下的记录`,
    )
  }
  if (stripped.length > config.maxSummaryChars) {
    throw new DecayError(
      `compress：summary 有 ${stripped.length} 个字符；上限是 ${config.maxSummaryChars}`,
    )
  }
  return {
    from,
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
  request: CompressRequest,
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

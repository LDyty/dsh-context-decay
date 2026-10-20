/**
 * Model-facing tools: compress, drop.
 *
 * Every tool validates against the replayed surface before writing anything, so
 * a rejected call leaves the Session unchanged and returns one actionable error
 * to the model. Writes reuse the harness's sanitized event vocabulary:
 * `compaction/summary` (shadow price + ledger) immediately followed by the
 * replacement `user/message`, and `compaction/prune` immediately followed by an
 * empty `developer/message` for a drop.
 *
 * 中文：模型可见工具：compress、drop。
 * 每个工具写任何东西之前都先对重放 surface 校验，因此被拒绝的调用不会改变 Session，
 * 只向模型返回一条可操作的错误。写入复用宿主已消毒的事件词汇：
 * `compaction/summary`（shadow price + ledger）后面紧跟 replacement `user/message`；
 * drop 则是 `compaction/prune` 后面紧跟空的 `developer/message`。
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
  findBlock,
  resolveSpan,
} from './blocks.js'
import type { ResolvedSpan } from './blocks.js'
import { estimateMiss } from './pricing.js'
import type { MissEstimate } from './pricing.js'
import { formatAnchor, parseAnchorArgument, parseAnchorBound, stripAnchors } from './anchor.js'
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
  readonly log: (line: string) => void
}

/**
 * Per-span outcome reported to the model.
 * 中文：向模型汇报的每个 span 结果。
 */
interface AppliedSpan {
  readonly from: number
  readonly to: number | null
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
 * Register every context-decay tool on the global tool registry.
 * 中文：把 context-decay 的所有工具注册到全局 tool registry。
 */
export function registerTools(ctx: PluginContextLike, deps: ToolDeps): void {
  const tools = ctx.get('tools') as ToolRegistryLike | undefined
  if (tools === undefined) throw new Error('context-decay: the tools service is unavailable')
  for (const definition of [
    compressTool(deps),
    dropTool(deps),
  ]) {
    ctx.effect(() => tools.register(definition))
  }
}

/**
 * Build the `compress` tool.
 * 中文：构造 `compress` 工具。
 */
function compressTool(deps: ToolDeps): ToolDefinitionLike {
  return {
    name: 'compress',
    description:
      'Compress fully consumed history into self-contained, lossy summaries. Each span is a half-open range of visible '
      + 'anchors: "from" is the first compressed message (inclusive); "to" is the first kept message (exclusive) or '
      + '"end" for the end of compressible history. Pass the anchor text exactly as shown, e.g. "⟦p12⟧"; bare "p12" '
      + 'and integer 12 are also accepted. One span: compress({spans:[{from:"⟦p0⟧", to:"⟦p8⟧", summary:"..."}]}). '
      + 'Multiple non-overlapping spans: compress({spans:[{from:"⟦p0⟧", to:"⟦p8⟧", summary:"..."}, '
      + '{from:"⟦p20⟧", to:"end", summary:"..."}]}). Examples use illustrative ids; use anchors visible in the current '
      + 'session. The current turn is always kept; if "to" is its first visible anchor, unanchored messages before it are kept automatically. A span edge that would split an assistant tool call from its results '
      + 'is rejected: all results of one assistant tool-call message must stay in the same span. Compressed content '
      + 'cannot be recovered: the summary must carry every fact that still matters. The result reports the pair, tier, '
      + 'summary size, shadowed tokens, kept tail, and the one-time miss estimate.',
    parameters: {
      type: 'object',
      properties: {
        spans: {
          type: 'array',
          description: 'Consumed regions to compress, in any order; spans must not overlap.',
          items: {
            type: 'object',
            properties: {
              from: {
                type: 'string',
                description: 'Inclusive anchor text, e.g. "⟦p12⟧" (bare "p12" and integer 12 are also accepted).',
              },
              to: {
                type: 'string',
                description: 'Exclusive anchor text, e.g. "⟦p20⟧", or "end" (bare "p20" and integer 20 are also accepted).',
              },
              summary: { type: 'string', description: 'Self-contained summary replacing the span; anchors are stripped.' },
              topic: { type: 'string', description: 'Optional short topic stored in the block ledger.' },
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
 * Build the `drop` tool.
 * 中文：构造 `drop` 工具。
 */
function dropTool(deps: ToolDeps): ToolDefinitionLike {
  return {
    name: 'drop',
    description:
      'Remove one live summary block completely: the summary and its left anchor disappear with no tombstone and '
      + 'nothing is retained. Requires the block\'s exact live pair [from, to); "to" is the block\'s right anchor or '
      + '"end". Pass the displayed anchors, e.g. drop({from:"⟦p0⟧", to:"⟦p8⟧"}); bare "p0" and integer 0 are also '
      + 'accepted. Use compress to shrink content instead of deleting a summary.',
    parameters: {
      type: 'object',
      properties: {
        from: {
          type: 'string',
          description: 'Left anchor text of the live summary block, e.g. "⟦p0⟧" (bare "p0" and integer 0 also accepted).',
        },
        to: {
          type: 'string',
          description: 'Right anchor text, e.g. "⟦p8⟧", or "end" (bare "p8" and integer 8 also accepted).',
        },
      },
      required: ['from', 'to'],
      additionalProperties: false,
    },
    output: { schema: OUTPUT_SCHEMA, render: renderJson },
    execute: async (args, exec) => executeDrop(args, exec, deps),
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
    throw new DecayError('compress: "spans" must be a non-empty array')
  }
  if (rawSpans.length > deps.config.maxSpansPerCall) {
    throw new DecayError(`compress: at most ${deps.config.maxSpansPerCall} spans per call`)
  }
  const requests = rawSpans.map((span, index) => parseSpan(span, index, deps.config))
  const state = deps.stateOf(session)
  const resolved = requests.map(request => resolveSpan(state, request.from, request.to))
  assertDisjointSpans(resolved)
  const summaries = requests.map(request => request.summary)
  const estimate = estimateMiss(state, resolved, summaries)
  assertCostGuards(deps.config, estimate)
  const ordered = resolved
    .map((span, index) => ({ span, request: requests[index]! }))
    .sort((left, right) => right.span.startIndex - left.span.startIndex)
  const applied: AppliedSpan[] = []
  for (const { span, request } of ordered) {
    applied.push(applyCompression(session, state, span, request, deps))
  }
  applied.sort((left, right) => left.from - right.from)
  const result = { ok: true, applied, estimate }
  // Fold the just-appended transaction so the logged free count is current.
  // 中文：把刚追加的事务也折叠进来，让日志里的 free 计数是最新的。
  const after = deps.stateOf(session)
  deps.log(
    `compress: ${applied.length} span(s), shadowed ${estimate.shadowedTokens} tokens, `
    + `summary ${estimate.summaryTokens}, kept tail ${estimate.keptTailTokens}, miss ~${estimate.oneTimeMissTokens}, `
    + `free ${after.free.length} (reused ${after.reusedPositions})`,
  )
  return result
}

/**
 * Enforce the optional cost guards before anything is appended.
 *
 * Rejection explains the measured cost and the actionable alternatives; both
 * guards are off by default because the right threshold is deployment-specific.
 *
 * 中文：在追加任何内容之前执行可选的成本保护。
 * 拒绝时会解释实测成本和可操作的替代方案；两个保护默认都关闭，因为合适的阈值取决于
 * 部署环境。
 */
function assertCostGuards(config: ResolvedConfig, estimate: MissEstimate): void {
  const suggestions = 'Suggestions: move "to" later so the kept tail is smaller, compress a larger consumed region, '
    + 'split the work into several calls, or drop a live block first.'
  if (config.maxMissTokens !== null && estimate.oneTimeMissTokens > config.maxMissTokens) {
    throw new DecayError(
      `compress: rejected by the miss guard: the first request after this compression would miss about `
      + `${estimate.oneTimeMissTokens} tokens (limit ${config.maxMissTokens}; summary ${estimate.summaryTokens}, `
      + `kept tail ${estimate.keptTailTokens}, anchors ${estimate.anchorTokens}). ${suggestions}`,
    )
  }
  if (config.maxPaybackRequests === null) return
  if (estimate.paybackRequests === null) {
    throw new DecayError(
      `compress: rejected by the payback guard: the summary is not smaller than the compressed content, so the `
      + `compression never pays back its ~${estimate.oneTimeMissTokens}-token first-request miss (limit `
      + `${config.maxPaybackRequests} requests). Compress more content or write a shorter summary.`,
    )
  }
  if (estimate.paybackRequests > config.maxPaybackRequests) {
    throw new DecayError(
      `compress: rejected by the payback guard: the compression would take about ${estimate.paybackRequests} requests to `
      + `pay back its ~${estimate.oneTimeMissTokens}-token first-request miss (limit `
      + `${config.maxPaybackRequests}). ${suggestions}`,
    )
  }
}

/**
 * One parsed span request.
 * 中文：一条已解析的 span 请求。
 */
interface SpanRequest {
  readonly from: number
  readonly to: number | 'end'
  readonly summary: string
  readonly topic: string | null
}

/**
 * Parse and validate one requested span.
 * 中文：解析并校验一条请求的 span。
 */
function parseSpan(value: unknown, index: number, config: ResolvedConfig): SpanRequest {
  const record = asRecord(value, `compress: spans[${index}]`)
  const from = parseAnchorArgument(record['from'])
  const to = parseAnchorBound(record['to'])
  const summary = record['summary']
  const topic = record['topic']
  if (from === null) {
    throw new DecayError(
      `compress: spans[${index}].from must be an anchor like "⟦p12⟧" (bare "p12" and integer 12 are also accepted)`,
    )
  }
  if (to === null) {
    throw new DecayError(
      `compress: spans[${index}].to must be an anchor like "⟦p12⟧" or "end" (bare "p12" and integer 12 are also accepted)`,
    )
  }
  if (typeof summary !== 'string') {
    throw new DecayError(`compress: spans[${index}].summary must be a string`)
  }
  if (topic !== undefined && typeof topic !== 'string') {
    throw new DecayError(`compress: spans[${index}].topic must be a string when present`)
  }
  // Anchors are presentation, never summary content (design §6.3).
  // 中文：锚点只是展示，永远不能进入摘要内容（设计 §6.3）。
  const stripped = stripAnchors(summary)
  if (stripped.length < config.minSummaryChars) {
    throw new DecayError(
      `compress: spans[${index}].summary must be at least ${config.minSummaryChars} characters `
      + `(got ${stripped.length}); the summary is the only surviving record of the compressed content`,
    )
  }
  if (stripped.length > config.maxSummaryChars) {
    throw new DecayError(
      `compress: spans[${index}].summary is ${stripped.length} characters; the limit is ${config.maxSummaryChars}`,
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
  if (first === undefined || last === undefined) throw new DecayError('compress: resolved span is empty')
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
 * Execute one `drop` call.
 * 中文：执行一次 `drop` 调用。
 */
async function executeDrop(args: unknown, exec: ToolRunContextLike, deps: ToolDeps): Promise<unknown> {
  const session = requireSession(exec, 'drop')
  const record = asRecord(args, 'drop')
  const from = parseAnchorArgument(record['from'])
  const to = parseAnchorBound(record['to'])
  if (from === null) {
    throw new DecayError('drop: "from" must be an anchor like "⟦p12⟧" (bare "p12" and integer 12 are also accepted)')
  }
  if (to === null) {
    throw new DecayError('drop: "to" must be an anchor like "⟦p12⟧" or "end" (bare "p12" and integer 12 are also accepted)')
  }
  const state = deps.stateOf(session)
  const block = findBlock(state, from, to)
  const turn = state.openTurn ?? 0
  const step = state.step
  const prune = session.append('compaction/prune', {
    shadowedRange: { start: block.node.seq, end: block.node.seq },
    shadowedSeqs: [block.node.seq],
    shadowedTokenCount: block.node.tokens,
  })
  const message = {
    id: randomUUID(),
    role: 'developer',
    content: [],
    source: { kind: 'context-decay', form: 'drop' },
  }
  // An empty developer node derives no message, while a system/message
  // replacement would corrupt the token-meter context-breakdown fold (it
  // rejects a system node claiming a metered range).
  // 中文：空的 developer 节点不会派生消息；而用 system/message 做 replacement 会破坏
  // token-meter 的 context-breakdown fold（它会拒绝一个声称占用计量范围的 system 节点）。
  session.append('developer/message', { turn, step, message }, {
    surfaceOp: { op: 'replace', startSeq: block.node.seq, endSeq: block.node.seq },
    sourceEventSeqs: [prune.seq, block.node.seq],
  })
  deps.log(`drop: block ${formatAnchor(block.node.left!)}, ${block.node.right === null ? 'end' : formatAnchor(block.node.right)} removed`)
  return {
    ok: true,
    dropped: { from: block.node.left, to: block.node.right, tokens: block.node.tokens },
  }
}

/**
 * Require an agent session for a tool call.
 * 中文：要求工具调用必须有 agent session。
 */
function requireSession(exec: ToolRunContextLike, tool: string): SessionLike {
  const session = exec.agent?.session
  if (session === undefined) throw new DecayError(`${tool}: no agent session is available for this tool call`)
  return session
}

/**
 * Narrow tool arguments to a JSON object.
 * 中文：把工具参数收窄为 JSON 对象。
 */
function asRecord(value: unknown, subject: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new DecayError(`${subject}: arguments must be a JSON object`)
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

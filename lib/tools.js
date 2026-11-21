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
import { randomUUID } from 'node:crypto';
import { DecayError, carrierStartIndex, resolveSpan, } from './blocks.js';
import { estimateMiss } from './pricing.js';
import { formatAnchor, parseAnchorArgument, stripAnchors } from './anchor.js';
import { DEEP_SWEEP_RATIO } from './prompt.js';
const OUTPUT_SCHEMA = {
    type: 'object',
    properties: { ok: { type: 'boolean' } },
    additionalProperties: true,
};
/**
 * Register the context-decay tool on the global tool registry.
 * 中文：把 context-decay 的工具注册到全局 tool registry。
 */
export function registerTools(ctx, deps) {
    const tools = ctx.get('tools');
    if (tools === undefined)
        throw new Error('context-decay：tools 服务不可用');
    const definition = compressTool(deps);
    ctx.effect(() => tools.register(definition));
}
/**
 * Build the `compress` tool.
 * 中文：构造 `compress` 工具。
 */
function compressTool(deps) {
    const retries = new WeakMap();
    return {
        name: 'compress',
        description: '把从 from 锚点所在的历史消息开始、到当前轮的第一条可见锚点之前的所有历史，压缩为一个高保真、自包含的摘要。'
            + 'from 是第一条要压缩的历史消息的可见锚点；当前轮不会进入压缩范围。'
            + '一次调用只传 from、summary 和可选 topic。'
            + '锚点从消息前缀原样复制，例如 “⟦#a8c5⟧”；也接受裸句柄 “#a8c5” 或 “a8c5”。'
            + '摘要要保留继续工作所需的状态、决策、精确事实和开放事项。'
            + '结果会报告压缩范围、层级、摘要字符数、被压缩 token 和首次请求 miss 估算。',
        parameters: {
            type: 'object',
            properties: {
                from: {
                    type: 'string',
                    description: '第一条要被压缩的历史消息的锚点，例如 “⟦#a8c5⟧”（也接受裸 “#a8c5” 或 “a8c5”）。',
                },
                summary: {
                    type: 'string',
                    description: '压缩后唯一保留的自包含摘要；保留状态、决策、精确事实和开放事项。这是 JSON 字符串：优先使用单引号或中文引号；需要双引号时进行转义。',
                },
                topic: {
                    type: 'string',
                    description: '可选短主题，记录到摘要块账本。',
                },
            },
            required: ['from', 'summary'],
            additionalProperties: false,
        },
        output: { schema: OUTPUT_SCHEMA, render: renderJson },
        execute: async (args, exec) => executeCompress(args, exec, deps, retries),
    };
}
/**
 * Execute one `compress` call, allowing a retry after a failed attempt at turn start.
 * 中文：执行一次 `compress` 调用；回合开始时的失败允许在同一回合内重试。
 */
async function executeCompress(args, exec, deps, retries) {
    const session = requireSession(exec, 'compress');
    const state = deps.stateOf(session);
    const retry = retryStateOf(session, state, retries);
    const atStart = isTurnStart(state, retry);
    let wrote = false;
    try {
        const result = await executeCompressInner(args, exec, deps, retries, () => {
            wrote = true;
        });
        retries.delete(session);
        return result;
    }
    catch (error) {
        if (wrote) {
            // A failed write may have left partial state; do not invite a retry.
            // 中文：写入失败可能留下部分状态，不再允许重试。
            retries.delete(session);
        }
        else if (atStart) {
            recordCompressFailure(session, state, retries);
        }
        throw error;
    }
}
/**
 * One compression attempt; the retry wrapper above owns failure tracking.
 * 中文：一次压缩尝试；上层的重试包装负责失败记录。
 */
async function executeCompressInner(args, exec, deps, retries, markWrite) {
    const session = requireSession(exec, 'compress');
    const record = asRecord(args, 'compress');
    if (record['spans'] !== undefined || record['to'] !== undefined) {
        throw new DecayError('compress：只接受 from、summary、topic；不再支持 spans 或 to。');
    }
    const request = parseRequest(record, deps.config);
    const state = deps.stateOf(session);
    const span = resolveSpan(state, request.from);
    assertTurnStart(state, retryStateOf(session, state, retries));
    const pressure = deps.pressure?.(session, state);
    if (pressure !== undefined)
        assertDeepSweep(state, span, pressure);
    const estimate = estimateMiss(state, [span], [request.summary]);
    assertCostGuards(deps.config, estimate);
    markWrite();
    const applied = applyCompression(session, state, span, request, deps);
    const result = { ok: true, applied, estimate };
    // Fold the just-appended transaction so the logged free count is current.
    // 中文：把刚追加的事务也折叠进来，让日志里的 free 计数是最新的。
    const after = deps.stateOf(session);
    deps.log(`compress：遮蔽 ${estimate.shadowedTokens} tokens，摘要 ${estimate.summaryTokens}，`
        + `保留 tail ${estimate.keptTailTokens}，一次性 miss ~${estimate.oneTimeMissTokens}，`
        + `free ${after.free.length}（复用 ${after.reusedPositions}）`);
    return result;
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
function isTurnStart(state, retry) {
    const currentStart = carrierStartIndex(state);
    const current = state.nodes.slice(currentStart);
    const priorToolResults = current.filter(node => node.toolResult).length;
    const assistantOutputs = current.filter(node => node.appended && node.role === 'assistant').length;
    if (retry !== undefined) {
        return priorToolResults === retry.attempts && assistantOutputs === retry.attempts + 1;
    }
    return priorToolResults === 0 && assistantOutputs <= 1;
}
/**
 * Remember one failed compression attempt for the current turn.
 * 中文：记录当前回合的一次压缩失败尝试。
 */
function recordCompressFailure(session, state, retries) {
    const retry = retryStateOf(session, state, retries);
    retries.set(session, {
        turnStartSeq: state.turnStartSeq,
        attempts: (retry?.attempts ?? 0) + 1,
    });
}
/**
 * Look up failed attempts only when they belong to the current turn.
 * 中文：只取属于当前回合的失败尝试记录。
 */
function retryStateOf(session, state, retries) {
    const retry = retries.get(session);
    return retry !== undefined && retry.turnStartSeq === state.turnStartSeq ? retry : undefined;
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
function assertTurnStart(state, retry) {
    if (isTurnStart(state, retry))
        return;
    throw new DecayError('compress：压缩只在每个新回合开始时进行。当前回合已经产生过工具结果或多次 assistant 输出，请在下一回合开始再压缩。');
}
/**
 * Enforce the deep-sweep policy once pressure exceeds the long-context tier
 * boundary (256K / 792,576 = 32.30%).
 *
 * At that pressure the whole call must be a deep sweep: the last span ends on
 * the latest safe compressible boundary, so no consumed tail is left behind.
 * The prompt states the same rule; this guard keeps a model mistake from
 * silently violating it.
 *
 * 中文：当有效窗口压力超过长上下文档位边界（256K / 792,576 = 32.30%）时执行深扫策略。
 * 此时整次调用必须是深扫：最后一个 span 结束于最新安全可压边界，不能留下已消费 tail。
 * 提示词写了同一规则；这个保护防止模型误操作静默违反。
 */
function assertDeepSweep(state, span, pressure) {
    if (pressure.ratio <= DEEP_SWEEP_RATIO)
        return;
    const oldestVisible = state.nodes.findIndex(node => node.left !== null);
    if (oldestVisible >= 0 && span.startIndex !== oldestVisible) {
        const oldestHandle = state.nodes[oldestVisible]?.left ?? null;
        const oldestLabel = oldestHandle === null ? '最老的可见锚点' : formatAnchor(oldestHandle);
        throw new DecayError(`compress：有效窗口压力超过约 32.30%（256K/793K），这次压缩做深扫：from 必须从最老的可见锚点 ${oldestLabel} 开始；`
            + '如果最老可见锚点是之前的摘要块，也从它开始。当前轮的第一条可见锚点之前的所有历史都会被压缩。');
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
function assertCostGuards(config, estimate) {
    const suggestions = '建议：把 from 往前移到更老的可见锚点、压缩更多已消费内容、'
        + '或把摘要写得更短。';
    if (config.maxMissTokens !== null && estimate.oneTimeMissTokens > config.maxMissTokens) {
        throw new DecayError(`compress：被 miss guard 拒绝：这次压缩后的首次请求预计 miss 约 ${estimate.oneTimeMissTokens} tokens`
            + `（上限 ${config.maxMissTokens}；摘要 ${estimate.summaryTokens}，保留 tail ${estimate.keptTailTokens}，`
            + `锚点 ${estimate.anchorTokens}）。${suggestions}`);
    }
    if (config.maxPaybackRequests === null)
        return;
    if (estimate.paybackRequests === null) {
        throw new DecayError('compress：被 payback guard 拒绝：摘要不比被压缩内容小，这次压缩永远无法回本'
            + `其约 ${estimate.oneTimeMissTokens} tokens 的首次请求 miss（上限 ${config.maxPaybackRequests} 次请求）。`
            + '请压缩更多内容，或写更短的摘要。');
    }
    if (estimate.paybackRequests > config.maxPaybackRequests) {
        throw new DecayError(`compress：被 payback guard 拒绝：这次压缩约需 ${estimate.paybackRequests} 次请求才能回本`
            + `其约 ${estimate.oneTimeMissTokens} tokens 的首次请求 miss（上限 ${config.maxPaybackRequests}）。${suggestions}`);
    }
}
/**
 * Parse and validate one compression request.
 * 中文：解析并校验一条压缩请求。
 */
function parseRequest(record, config) {
    const from = parseAnchorArgument(record['from']);
    const summary = record['summary'];
    const topic = record['topic'];
    if (from === null) {
        throw new DecayError('compress：from 必须是类似 “⟦#a8c5⟧” 的锚点（也接受 “#a8c5” 或 “a8c5”）');
    }
    if (typeof summary !== 'string') {
        throw new DecayError('compress：summary 必须是字符串');
    }
    if (topic !== undefined && typeof topic !== 'string') {
        throw new DecayError('compress：topic 存在时必须是字符串');
    }
    // Anchors are presentation, never summary content.
    // 中文：锚点只是展示，永远不能进入摘要内容。
    const stripped = stripAnchors(summary);
    if (stripped.length < config.minSummaryChars) {
        throw new DecayError(`compress：summary 至少要有 ${config.minSummaryChars} 个字符`
            + `（当前 ${stripped.length}）；摘要是被压缩内容唯一剩下的记录`);
    }
    if (stripped.length > config.maxSummaryChars) {
        throw new DecayError(`compress：summary 有 ${stripped.length} 个字符；上限是 ${config.maxSummaryChars}`);
    }
    return {
        from,
        summary: stripped,
        topic: typeof topic === 'string' && topic.trim().length > 0 ? topic.trim() : null,
    };
}
/**
 * Append one compression transaction and return its model-facing outcome.
 * 中文：追加一次压缩事务，并返回其模型可见结果。
 */
function applyCompression(session, state, span, request, deps) {
    const first = span.shadowed[0];
    const last = span.shadowed[span.shadowed.length - 1];
    if (first === undefined || last === undefined)
        throw new DecayError('compress：解析出的 span 为空');
    const shadowedSeqs = span.shadowed.map(node => node.seq);
    const tier = blockTierOf(span.shadowed);
    const context = session.requestContext?.();
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
    };
    // The session-format reader requires every `compaction/summary` to sit
    // inside one open start/end bracket whose owner turn is the current turn.
    // 中文：session-format reader 要求每个 `compaction/summary` 都位于一对已打开的
    // start/end 括号内，且所属 turn 是当前 turn。
    const compactionId = randomUUID();
    const turn = state.openTurn;
    session.append('compaction/start', { compactionId, turn });
    const summaryEvent = session.append('compaction/summary', {
        compactionId,
        summary: [{ type: 'text', text: request.summary }],
        shadowedRange: { start: first.seq, end: last.seq },
        shadowedSeqs,
        shadowedTokenCount: span.shadowedTokens,
        provider: context?.provider ?? 'context-decay',
        model: context?.model ?? 'model-authored',
        rawOutput: [{ type: 'text', text: JSON.stringify(ledger) }],
    });
    const message = {
        id: randomUUID(),
        role: 'user',
        content: [{ type: 'text', text: request.summary }],
        source: {
            kind: 'context-decay',
            form: 'summary',
            ...request.topic === null ? {} : { topic: request.topic },
        },
    };
    session.append('user/message', message, {
        surfaceOp: { op: 'replace', startSeq: first.seq, endSeq: last.seq },
        sourceEventSeqs: [summaryEvent.seq, ...shadowedSeqs],
    });
    session.append('compaction/end', { compactionId, turn });
    return {
        from: span.from,
        to: span.to,
        tier,
        summaryChars: request.summary.length,
        shadowedMessages: span.shadowed.length,
        shadowedTokens: span.shadowedTokens,
    };
}
/**
 * Tier of a summary block produced over the given shadowed nodes.
 * 中文：由给定被遮蔽节点生成的摘要块的层级。
 */
function blockTierOf(shadowed) {
    const only = shadowed.length === 1 ? shadowed[0] : undefined;
    if (only !== undefined && only.block)
        return only.tier + 1;
    return shadowed.reduce((max, node) => node.block ? Math.max(max, node.tier) : max, 0) + 1;
}
/**
 * Require an agent session for a tool call.
 * 中文：要求工具调用必须有 agent session。
 */
function requireSession(exec, tool) {
    const session = exec.agent?.session;
    if (session === undefined)
        throw new DecayError(`${tool}：本次工具调用没有可用的 agent session`);
    return session;
}
/**
 * Narrow tool arguments to a JSON object.
 * 中文：把工具参数收窄为 JSON 对象。
 */
function asRecord(value, subject) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new DecayError(`${subject}：参数必须是 JSON 对象`);
    }
    return value;
}
/**
 * Render a canonical tool value as one compact text block.
 * 中文：把一个规范工具值渲染成一个紧凑 text 块。
 */
function renderJson(_args, value) {
    return [{ type: 'text', text: JSON.stringify(value) }];
}

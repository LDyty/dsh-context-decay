/**
 * dsh-context-decay plugin entry.
 *
 * Provides the `modelMessageDecoration` service consumed by the local harness
 * patch, registers the compression tools, contributes the model-facing
 * guidance to the system prompt, injects at most one pressure reminder per
 * step, and feeds the sidebar panel the same pressure reading the reminder
 * uses (effective window = total capacity - output reservation).
 *
 * Default OFF at the profile level: nothing is inserted unless the profile
 * overlay mounts this plugin. When mounted, the overlay must also disable
 * `compaction-basic` (and the in-place surface rewriters) so two context
 * reducers never run at once.
 *
 * 中文：dsh-context-decay 插件入口。
 * 提供本地宿主补丁消费的 `modelMessageDecoration` 服务，注册压缩工具，向 system prompt
 * 贡献模型可见 guidance，每个 step 最多注入一条压力提醒，并把提醒使用的同一份压力读数
 * 提供给侧栏面板（有效窗口 = 总容量 - 输出预留）。
 * 在 profile 层默认关闭：除非 profile overlay 挂载本插件，否则不插入任何东西。挂载时，
 * overlay 还必须停用 `compaction-basic`（以及原地 surface 改写器），避免两个上下文缩减器
 * 同时运行。
 */
import { randomUUID } from 'node:crypto';
import { AuditWriter, auditPath } from './audit.js';
import { compressibleEndIndex, visibleNodes } from './blocks.js';
import { resolveConfig } from './config.js';
import { GUIDANCE, decideReminder, reminderText, warningLevel } from './prompt.js';
import { createContextDecayProjection } from './projection.js';
import { anchorDecorations, decorationOverheadTokens } from './render.js';
import { DecorationRegistry } from './service.js';
import { StateCache } from './state.js';
import { registerTools } from './tools.js';
import { planWindow, reservedOutputTokensOf } from './window.js';
export const name = 'context-decay';
export const inject = ['tools', 'systemPrompt'];
/**
 * Mount one context-decay instance.
 * 中文：挂载一个 context-decay 实例。
 */
export function apply(ctx, config) {
    const resolved = resolveConfig(config);
    if (!resolved.enabled)
        return;
    const log = resolved.debug
        ? (line) => { console.log(`[context-decay] ${line}`); }
        : () => { };
    const cache = new StateCache();
    const stateOf = (session) => cache.stateOf(session);
    /**
     * Host-side facts per live session, merged into that session's sidebar view
     * and never persisted. The map is keyed by durable session id so switching
     * sessions cannot leak the previous session's pressure or request.
     * 中文：每个 live session 的宿主侧事实，只合并进该 session 的侧栏视图，从不持久化。
     * 以持久 session id 为 key，切换 session 时不会串用上一个 session 的压力或请求。
     */
    const runtimes = new Map();
    const liveSessions = new Map();
    const sessionById = (sessionId) => liveSessions.get(sessionId) ?? ctx.get('sessions')?.get(sessionId);
    /**
     * Resolve total capacity, output reservation, and the effective denominator for one session.
     * 中文：为一个 session 解析总容量、输出预留和有效分母。
     */
    const windowFor = (session) => planWindow({
        configTotal: resolved.contextWindowTokens,
        configReserved: resolved.reservedOutputTokens,
        requestTotal: session.requestContext?.()?.contextWindow,
        headerReserved: reservedOutputTokensOf(session),
        fallbackTotal: resolved.defaultContextWindowTokens,
    });
    const pressureFor = (session, state) => readPressure(ctx, windowFor(session), session, state, log);
    const pressureSnapshot = (reading) => ({
        tokens: Math.round(reading.tokens),
        window: reading.window,
        totalWindow: reading.totalWindow,
        reservedOutput: reading.reservedOutput,
        ratio: Number(reading.ratio.toFixed(4)),
        source: reading.source,
        windowSource: reading.windowSource,
        reservationSource: reading.reservationSource,
        level: warningLevel(reading.ratio, resolved.warnRatios),
        warnRatios: [...resolved.warnRatios],
    });
    const refreshRuntime = (session, runtime) => {
        const state = stateOf(session);
        const reading = pressureFor(session, state);
        runtime.pressure = pressureSnapshot(reading);
        runtime.reminder = state.lastReminderTurn === null && state.lastReminderTokens === 0
            ? null
            : reminderSnapshot(state, reading.tokens, warningLevel(reading.ratio, resolved.warnRatios), resolved);
    };
    const runtimeFor = (sessionId) => {
        const existing = runtimes.get(sessionId);
        if (existing !== undefined)
            return existing;
        const runtime = { pressure: null, reminder: null, request: null };
        runtimes.set(sessionId, runtime);
        const session = sessionById(sessionId);
        if (session !== undefined) {
            try {
                refreshRuntime(session, runtime);
            }
            catch (error) {
                log(`runtime hydrate skipped for ${sessionId}: ${String(error)}`);
            }
        }
        return runtime;
    };
    const auditFile = auditPath();
    const auditWriter = resolved.audit ? new AuditWriter(auditFile, log) : undefined;
    if (auditWriter !== undefined)
        log(`request audit enabled: ${auditFile}`);
    const onRequest = (record) => {
        const runtime = runtimeFor(record.sessionId);
        runtime.request = {
            sessionIndex: record.sessionRequest,
            processIndex: record.requestIndex,
            messages: record.messages,
            anchors: record.anchors,
            first: record.first,
            last: record.last,
            blocks: record.blocks.length,
            overheadTokens: record.overheadTokens,
            time: record.time,
        };
        auditWriter?.write(record);
    };
    // The projection can be materialized from a restored log while the session
    // store's `sessions.get` does not expose that detached object. Keep the
    // session/created objects the host announces so the first panel read can
    // hydrate the correct pressure instead of waiting for another turn.
    // 中文：恢复会话的 projection 可能在其 session 对象未由 sessions.get 暴露时
    // 就被读取。缓存宿主 session/created 对象，让面板首次读取就能补齐正确压力，
    // 而不是等到下一回合。
    ctx.on('session/created', (session) => {
        liveSessions.set(session.id, session);
        try {
            refreshRuntime(session, runtimeFor(session.id));
        }
        catch (error) {
            log(`runtime hydrate skipped for ${session.id}: ${String(error)}`);
        }
    });
    ctx.on('session/disposed', (session) => {
        liveSessions.delete(session.id);
        runtimes.delete(session.id);
    });
    const registry = new DecorationRegistry(stateOf, resolved.debug ? log : undefined, onRequest);
    ctx.provide('modelMessageDecoration', {
        decorate: (session, messages) => registry.decorate(session, messages),
        tokenOverhead: (session) => registry.overhead(session),
        sanitizeAssistantMessage: (session, message) => registry.sanitizeAssistantMessage(session, message),
    });
    // The sidebar visualizer reads this projection; it is a pure replay fold plus
    // the host runtime snapshot, so it costs nothing when no client is attached.
    // 中文：侧栏可视化器读取这个 projection；它只是纯重放 fold 加宿主运行时快照，没有
    // 客户端连接时没有成本。
    const projections = ctx.get('sessionProjections');
    if (projections !== undefined) {
        ctx.effect(() => projections.register(createContextDecayProjection(sessionId => runtimeFor(sessionId))), 'context-decay: projection');
    }
    // Settled requests and compactions change the current pressure; refresh only
    // the affected session so a panel opened later shows that session's reading.
    // 中文：请求结算和压缩会改变当前压力；只刷新受影响的 session，稍后打开的面板
    // 才能显示该 session 自己的读数。
    ctx.on('session/event', (session, event) => {
        if (event?.type !== 'assistant/message' && event?.type !== 'compaction/end' && event?.type !== 'turn/end') {
            return;
        }
        try {
            refreshRuntime(session, runtimeFor(session.id));
        }
        catch (error) {
            log(`runtime refresh skipped for ${session.id}: ${String(error)}`);
        }
    });
    ctx.effect(() => registry.register({
        id: `${name}/anchors`,
        version: '1',
        scope: 'conversation',
        decorate: (session, messages) => anchorDecorations(stateOf(session), messages),
    }));
    registerTools(ctx, { config: resolved, stateOf, log });
    const systemPrompt = ctx.get('systemPrompt');
    if (systemPrompt === undefined)
        throw new Error('context-decay: the systemPrompt service is unavailable');
    ctx.effect(() => systemPrompt.section({ name: 'context-decay:guidance', order: 450, text: GUIDANCE }));
    ctx.on('agent/pre-step', async (payload, next) => {
        const decision = await next();
        if (decision.kind !== 'enter')
            return decision;
        try {
            const agent = payload.agent;
            if (agent === undefined)
                return decision;
            const session = agent.session;
            const state = stateOf(session);
            const runtime = runtimeFor(session.id);
            const reading = pressureFor(session, state);
            runtime.pressure = pressureSnapshot(reading);
            const reminder = decideReminder({
                tokens: reading.tokens,
                window: reading.window,
                lastTokens: state.lastReminderTokens,
                lastLevel: state.lastReminderLevel,
                openTurn: state.openTurn,
                lastReminderTurn: state.lastReminderTurn,
            }, {
                growthTokens: resolved.growthTokens,
                criticalGrowthTokens: resolved.criticalGrowthTokens,
                warnRatios: resolved.warnRatios,
                cooldownTurns: resolved.reminderCooldownTurns,
            });
            if (reminder.plan === null) {
                log(`reminder check: tokens=${Math.round(reading.tokens)} `
                    + `window=${reading.window}/${reading.totalWindow} (reserve=${reading.reservedOutput}, `
                    + `source=${reading.windowSource}/${reading.reservationSource}) last=${state.lastReminderTokens} `
                    + `level=${reminder.level} lastLevel=${state.lastReminderLevel} plan=none`
                    + `${reminder.baseline ? ' (baseline)' : ''}`);
                // Re-arm after a compression and take the silent growth baseline.
                // 中文：压缩后重新武装，并记录静默增长基线。
                state.lastReminderLevel = reminder.level;
                if (reminder.baseline)
                    state.lastReminderTokens = Math.round(reading.tokens);
                runtime.reminder = reminderSnapshot(state, reading.tokens, reminder.level, resolved);
                return decision;
            }
            const plan = reminder.plan;
            const visible = visibleNodes(state);
            let endPosition = null;
            for (let index = compressibleEndIndex(state); index >= 0; index -= 1) {
                const left = state.nodes[index]?.left;
                if (left !== undefined && left !== null) {
                    endPosition = left;
                    break;
                }
            }
            const message = {
                id: randomUUID(),
                role: 'user',
                content: [{
                        type: 'text',
                        text: reminderText({
                            kind: plan.kind,
                            level: plan.level,
                            levels: resolved.warnRatios.length,
                            tokens: reading.tokens,
                            window: reading.window,
                            ratio: reading.ratio,
                            growth: plan.growth,
                            firstPosition: visible[0]?.position ?? null,
                            endPosition,
                        }),
                    }],
                source: {
                    kind: 'context-decay',
                    form: 'notice',
                    reason: plan.kind,
                    level: plan.level,
                    atTokens: Math.round(reading.tokens),
                    ratio: Number(reading.ratio.toFixed(4)),
                },
            };
            state.lastReminderTokens = Math.round(reading.tokens);
            state.lastReminderLevel = plan.level;
            state.lastReminderTurn = state.openTurn;
            runtime.reminder = reminderSnapshot(state, reading.tokens, plan.level, resolved);
            log(`reminder injected: ${plan.kind} level=${plan.level}/${resolved.warnRatios.length} at `
                + `${(reading.ratio * 100).toFixed(1)}% (source=${reading.source}, `
                + `${Math.round(reading.tokens)}/${reading.window} of ${reading.totalWindow} `
                + `[reserve ${reading.reservedOutput}], growth=${plan.growth ?? '-'})`);
            return { ...decision, messages: [...(decision.messages ?? []), message] };
        }
        catch (error) {
            // A pressure-reading failure must not fail the turn; decoration failures still do.
            // 中文：压力读取失败不能让回合失败；装饰失败仍然会让回合失败。
            log(`reminder skipped: ${String(error)}`);
            return decision;
        }
    });
}
/**
 * Snapshot the reminder bookkeeping for the sidebar.
 * 中文：为侧栏生成提醒记账快照。
 */
function reminderSnapshot(state, tokens, level, config) {
    const critical = level > 0 && level === config.warnRatios.length;
    const step = critical ? config.criticalGrowthTokens : config.growthTokens;
    return {
        lastTokens: state.lastReminderTokens,
        lastLevel: state.lastReminderLevel,
        lastTurn: state.lastReminderTurn,
        growth: Math.round(tokens - state.lastReminderTokens),
        nextGrowthAt: state.lastReminderTokens + step,
        cooldownTurns: config.reminderCooldownTurns,
    };
}
/**
 * Read one pressure reading, preferring the token meter.
 *
 * A patched meter reports `decorationOverheadTokens` (itself 0 when the
 * provider usage baseline already contains the anchors); an unpatched meter
 * omits the field, so the plugin adds its own anchor estimate for estimated
 * baselines. Provider usage is the fallback, then a pure local estimate.
 * `window.effective` is the denominator for the model-facing percentage.
 *
 * 中文：读取一份压力读数，优先使用 token meter。
 * 打过补丁的 meter 会报告 `decorationOverheadTokens`（当 provider usage 基线已经包含
 * 锚点时该值本身为 0）；未打补丁的 meter 没有该字段，所以插件为估算基线加上自己的
 * 锚点估算。provider usage 是后备，最后才是纯本地估算。
 * `window.effective` 是模型可见百分比的 denominator。
 */
function readPressure(ctx, window, session, state, log) {
    const reading = (tokens, source) => ({
        tokens,
        window: window.effective,
        ratio: window.effective > 0 ? tokens / window.effective : 0,
        totalWindow: window.total,
        reservedOutput: window.reserved,
        windowSource: window.source,
        reservationSource: window.reservationSource,
        source,
    });
    const overhead = decorationOverheadTokens(state);
    const meter = ctx.get('tokenMeter');
    if (meter !== undefined) {
        try {
            const measurement = meter.measure(session);
            const measured = measurement.totalTokens ?? measurement.surfaceTokens ?? null;
            if (measured !== null) {
                const anchorsPriced = measurement.decorationOverheadTokens !== undefined
                    || measurement.baseline?.kind === 'usage';
                return reading(measured + (anchorsPriced ? 0 : overhead), 'meter');
            }
        }
        catch (error) {
            log(`tokenMeter measurement failed: ${String(error)}`);
        }
    }
    if (state.usage !== null) {
        // Provider prompt tokens already include the anchor text and the system prompt.
        // 中文：provider 的 prompt token 已经包含锚点文本和 system prompt。
        return reading(state.usage.inputTokens + state.usage.cacheReadTokens + state.usage.cacheWriteTokens, 'usage');
    }
    return reading(state.nodes.reduce((sum, node) => node.left !== null ? sum + node.tokens : sum, 0) + overhead, 'estimate');
}

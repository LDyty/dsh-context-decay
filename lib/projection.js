/**
 * Host-side session projection for the sidebar visualizer.
 *
 * The projection is a pure fold over committed session events: the same
 * deterministic position replay the decorator and tools use, exposed as a
 * compact JSON view. The projection registry drives it on every event and
 * ships the wire view to the browser, where `useProjection('contextDecay')`
 * reads it.
 *
 * The state must be plain JSON (the projection cache persists and replays it),
 * so `DecayState.refs` is a plain record rather than a Map.
 *
 * 中文：侧栏可视化用的宿主侧 session projection。
 * projection 是对已提交 session 事件的纯 fold：与 decorator 和 tools 使用同一套确定性
 * 位置重放，只是暴露成紧凑 JSON 视图。projection registry 在每次事件时驱动它，并把
 * wire view 送到浏览器，由 `useProjection('contextDecay')` 读取。
 * 状态必须是普通 JSON（projection cache 会持久化并重放它），所以
 * `DecayState.refs` 用普通 record 而不是 Map。
 */
import { carrierStartIndex, compressibleEndIndex } from './blocks.js';
import { createState, foldEvent } from './state.js';
/**
 * Bump when the fold semantics or the wire fields change.
 * 中文：fold 语义或 wire 字段变化时递增。
 */
export const DECAY_PROJECTION_VERSION = 5;
/**
 * Events the replay fold consumes; everything else keeps the state reference.
 * 中文：replay fold 消费的事件；其他事件保持原状态引用不变。
 */
function isRelevant(event) {
    return event.surfaceOp !== undefined
        || event.type === 'turn/start'
        || event.type === 'turn/end'
        || event.type === 'step/start'
        || event.type === 'assistant/message';
}
/**
 * Copy the mutable parts of one state so the projection's apply stays pure.
 * 中文：复制状态里的可变部分，让 projection 的 apply 保持纯函数。
 */
function forkState(state) {
    return {
        ...state,
        nodes: [...state.nodes],
        free: [...state.free],
        refs: { ...state.refs },
    };
}
/**
 * Validate one persisted checkpoint state before it seeds a fold.
 * 中文：在持久 checkpoint 状态用于 seed fold 之前校验它。
 */
function parseState(value) {
    if (typeof value !== 'object' || value === null)
        throw new TypeError('context-decay projection: state is not an object');
    const record = value;
    if (!Array.isArray(record['nodes']) || !Array.isArray(record['free'])) {
        throw new TypeError('context-decay projection: state lacks nodes/free');
    }
    if (typeof record['nextPosition'] !== 'number' || typeof record['refs'] !== 'object' || record['refs'] === null) {
        throw new TypeError('context-decay projection: state lacks nextPosition/refs');
    }
    if (record['sessionId'] !== undefined && typeof record['sessionId'] !== 'string') {
        throw new TypeError('context-decay projection: state has a non-string sessionId');
    }
    return value;
}
/**
 * Validate the wire view before it leaves the host.
 * 中文：wire view 离开宿主前校验它。
 */
function parseView(value) {
    if (typeof value !== 'object' || value === null)
        throw new TypeError('context-decay projection: view is not an object');
    const record = value;
    if (!Array.isArray(record['nodes']) || !Array.isArray(record['free'])) {
        throw new TypeError('context-decay projection: view lacks nodes/free');
    }
    return value;
}
/**
 * Build the client view from one replayed state plus the host runtime snapshot.
 * 中文：把一份重放状态和宿主运行时快照构造成客户端视图。
 */
function viewOf(state, runtime) {
    const nodes = state.nodes
        .filter((node) => node.left !== null)
        .map(node => ({
        seq: node.seq,
        left: node.left,
        right: node.right,
        block: node.block,
        tier: node.tier,
        role: node.role,
        tokens: node.tokens,
        topic: node.topic,
        createdAtTurn: node.createdAtTurn,
        appended: node.appended,
        summaryChars: node.summaryChars,
    }));
    const carrierStart = carrierStartIndex(state);
    const compressibleEnd = compressibleEndIndex(state);
    const carrierSeq = carrierStart < state.nodes.length ? state.nodes[carrierStart]?.seq ?? null : null;
    let compressibleEndSeq = null;
    let compressibleEndPosition = null;
    for (let index = compressibleEnd; index >= 0; index -= 1) {
        const left = state.nodes[index]?.left;
        if (left !== undefined && left !== null) {
            compressibleEndSeq = state.nodes[index]?.seq ?? null;
            compressibleEndPosition = left;
            break;
        }
    }
    return {
        v: DECAY_PROJECTION_VERSION,
        nodes,
        nextPosition: state.nextPosition,
        free: [...state.free],
        reusedPositions: state.reusedPositions,
        blocksCreated: state.blocksCreated,
        openTurn: state.openTurn,
        turnStartSeq: state.turnStartSeq,
        carrierSeq,
        compressibleEndSeq,
        compressibleEndPosition,
        pressure: runtime.pressure,
        reminder: runtime.reminder,
        request: runtime.request,
    };
}
const EMPTY_RUNTIME = { pressure: null, reminder: null, request: null };
/**
 * Build the `contextDecay` projection registration.
 *
 * 中文：构造 `contextDecay` projection 注册。
 *
 * @param getRuntime - reads the host-side pressure/reminder/request snapshot for one session id.
 * 中文：读取某个 session id 的宿主侧压力/提醒/请求快照。
 * @returns the projection definition for `ctx.sessionProjections.register`.
 * 中文：返回给 `ctx.sessionProjections.register` 的 projection 定义。
 */
export function createContextDecayProjection(getRuntime) {
    return {
        key: 'contextDecay',
        stateVersion: DECAY_PROJECTION_VERSION,
        stateSchema: { parse: parseState },
        init: (header) => createState(header === undefined ? undefined : String(header.id)),
        apply: (state, event) => {
            if (!isRelevant(event))
                return state;
            const next = forkState(state);
            foldEvent(next, event);
            return next;
        },
        wire: {
            viewSchema: { parse: parseView },
            view: (state) => viewOf(state, state.sessionId === undefined ? EMPTY_RUNTIME : getRuntime(state.sessionId)),
        },
    };
}
/**
 * Default projection with no runtime snapshot (tests and headless registrations).
 * 中文：不带运行时快照的默认 projection（测试和无头注册用）。
 */
export const contextDecayProjection = createContextDecayProjection(() => EMPTY_RUNTIME);

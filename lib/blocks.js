/**
 * Surface-range resolution and guards for the compression tool.
 *
 * Anchors are handles, not surface indices: a compressed region's interior
 * handles are recycled, so a later message may carry a handle that appeared
 * earlier. A span is resolved in surface order:
 *  - `from` must be the left handle of a visible node;
 *  - `to` is either the left handle of a visible node (exclusive) or a live
 *    summary block's right boundary (the block itself is folded);
 *  - `end` folds through the last compressible node.
 * The guards enforce the invariants the provider and the design require:
 *  - the current turn is a carrier and is never folded;
 *  - a span edge that would split an assistant tool call from its results is
 *    rejected (all results of one assistant tool-call message stay together).
 *
 * 中文：压缩工具的 surface 范围解析与保护。
 * 锚点是句柄，不是 surface 下标：被压缩区间内部的句柄会回收，所以较新的消息可能携带
 * 以前出现过的句柄。span 按 surface 顺序解析：
 *  - `from` 必须是某个可见节点的左句柄；
 *  - `to` 要么是某个可见节点的左句柄（排他），要么是 live 摘要块的右边界（该块本身
 *    被折叠）；
 *  - `end` 一直折叠到最后一个可压缩节点。
 * 这里的保护执行 provider 和设计要求的不变量：
 *  - 当前回合是 carrier，绝不被折叠；
 *  - 会把 assistant tool call 和它的结果切开的 span 边界会被拒绝（同一条 assistant
 *    tool-call 消息的所有结果必须留在同一个 span）。
 */
import { formatAnchor } from './anchor.js';
/**
 * Actionable error surfaced to the model through the tool result.
 * 中文：通过 tool result 返回给模型的可操作错误。
 */
export class DecayError extends Error {
    constructor(message) {
        super(message);
        this.name = 'DecayError';
    }
}
/**
 * All model-addressable nodes with their anchors, in surface order.
 * 中文：所有可被模型寻址的节点及其锚点，按 surface 顺序排列。
 */
export function visibleNodes(state) {
    const visible = [];
    for (let index = 0; index < state.nodes.length; index += 1) {
        const node = state.nodes[index];
        if (node.left !== null)
            visible.push({ index, node, anchor: node.left });
    }
    return visible;
}
/**
 * Legal `to` positions: every visible anchor plus every rendered summary right boundary, in surface order.
 * 中文：合法的 `to` 位置：所有可见锚点，加上所有已渲染摘要块的右边界，按 surface 顺序。
 */
export function legalToPositions(state) {
    const positions = [];
    const seen = new Set();
    for (const node of state.nodes) {
        if (node.left !== null && !seen.has(node.left)) {
            seen.add(node.left);
            positions.push(node.left);
        }
        if (node.block && node.right !== null && !seen.has(node.right)) {
            seen.add(node.right);
            positions.push(node.right);
        }
    }
    return positions;
}
/**
 * Human-readable visible anchors, in message order, for an unknown input anchor.
 * 中文：输入锚点无法识别时，按消息顺序列出可读的可见锚点。
 */
export function describePositions(state) {
    const positions = legalToPositions(state);
    if (positions.length === 0)
        return '当前还没有任何锚点';
    return `可见消息锚点（按消息顺序）：${positions.map(formatAnchor).join('、')}`;
}
/**
 * Index of the first surface node appended during the current (protected) turn.
 * 中文：当前（受保护）回合里第一个新追加 surface 节点的下标。
 */
export function carrierStartIndex(state) {
    if (state.openTurn === null)
        return state.nodes.length;
    for (let index = 0; index < state.nodes.length; index += 1) {
        const node = state.nodes[index];
        // Replacement nodes (summary blocks) keep older anchors and are foldable;
        // only nodes appended in this turn are the live carrier.
        // 中文：replacement 节点（摘要块）保留较旧的锚点，可以继续被折叠；只有本回合新
        // 追加的节点才是 live carrier。
        if (node.appended && node.createdAtTurn === state.openTurn)
            return index;
    }
    return state.nodes.length;
}
/**
 * Last surface index that may be folded in this request.
 * 中文：本次请求中最后一个允许折叠的 surface 下标。
 */
export function compressibleEndIndex(state) {
    return carrierStartIndex(state) - 1;
}
/**
 * Whether an assistant tool call/result pairing cut is balanced before every node and after the tail.
 * 中文：每个节点之前和整个 tail 之后，assistant tool call/result 配对切点是否平衡。
 */
export function balancedCuts(state) {
    const cuts = new Array(state.nodes.length + 1).fill(true);
    let pending = 0;
    for (let index = 0; index < state.nodes.length; index += 1) {
        const node = state.nodes[index];
        pending += node.toolCalls;
        if (node.toolResult)
            pending -= 1;
        cuts[index + 1] = pending === 0;
        if (pending < 0) {
            throw new DecayError(`context-decay：surface 第 ${index} 个位置的 tool/result 没有匹配的 tool call；`
                + '重放 surface 不一致，无法压缩');
        }
    }
    return cuts;
}
/**
 * Resolve one requested span against the current replay state.
 * 中文：针对当前重放状态解析一条请求的 span。
 */
export function resolveSpan(state, requestedFrom, requestedTo) {
    let startIndex = state.nodes.findIndex(node => node.left === requestedFrom);
    if (startIndex < 0) {
        throw new DecayError(`compress：${formatAnchor(requestedFrom)} 不是可见消息锚点。${describePositions(state)}`);
    }
    const compressibleEnd = compressibleEndIndex(state);
    if (compressibleEnd < 0) {
        throw new DecayError('compress：当前还没有可压缩的历史（当前回合受保护）');
    }
    let endIndex;
    if (requestedTo === 'end') {
        endIndex = compressibleEnd;
    }
    else {
        // `to` is a handle, not a threshold: resolve it by node identity, never by
        // numeric ordering.
        // 中文：`to` 是句柄，不是阈值：按节点身份解析，绝不按数值顺序。
        const owner = state.nodes.findIndex(node => node.left === requestedTo);
        if (owner >= 0) {
            endIndex = owner - 1;
        }
        else {
            const block = state.nodes.findIndex(node => node.block && node.right === requestedTo);
            if (block < 0) {
                throw new DecayError(`compress：锚点 ${formatAnchor(requestedTo)} 不是可见消息锚点。${describePositions(state)}`);
            }
            endIndex = block;
        }
        if (endIndex > compressibleEnd) {
            const firstVisible = currentCarrierAnchor(state);
            if (requestedTo !== firstVisible || owner < 0 || !state.nodes[owner].appended) {
                throw currentTurnSpanError(state, firstVisible);
            }
            // `to` is the current turn's first visible anchor, but the turn starts
            // with unanchored carrier nodes (runtime context, system notices,
            // tool-call-only assistant messages). Keep those nodes and end the span
            // at the last compressible node; the requested visible anchor is still
            // the first kept message.
            // 中文：`to` 是当前回合第一条可见锚点，但回合开头还有无锚点 carrier 节点
            //（运行时上下文、system 提示、只有 tool-call 的 assistant 消息）。保留这些
            // 节点，把 span 收到最后一个可压缩节点；请求的可见锚点仍是第一条保留消息。
            endIndex = compressibleEnd;
        }
    }
    if (startIndex > compressibleEnd) {
        throw new DecayError('compress：当前回合之前没有可压缩历史；等当前回合结束再压缩。');
    }
    if (endIndex < startIndex) {
        throw new DecayError(`compress：[${formatAnchor(requestedFrom)}, ${requestedTo === 'end' ? 'end' : formatAnchor(requestedTo)}) 选不到内容：`
            + '在消息顺序里 “to” 位于 “from” 之前。锚点是句柄，不是递增数字；请使用消息上打印的锚点。');
    }
    const cuts = balancedCuts(state);
    if (!cuts[startIndex]) {
        throw new DecayError(`compress：“from” ${formatAnchor(requestedFrom)} 落在 assistant tool-call 组内部。同一条 assistant `
            + 'tool-call 消息的所有结果必须留在同一个 span；请在调用之前或最后一个结果之后选锚点。'
            + describePositions(state));
    }
    if (!cuts[endIndex + 1]) {
        const edge = requestedTo === 'end' ? '“end”' : `“to” ${formatAnchor(requestedTo)}`;
        throw new DecayError(`compress：${edge} 落在 assistant tool-call 组内部。同一条 assistant tool-call 消息的所有结果 `
            + '必须留在同一个 span；请在组最后一个结果之后、或调用之前选边界。'
            + (requestedTo === 'end'
                ? '如果该组在当前回合仍未结束，请等待结果，或在调用前显式选一个 “to”。'
                : '')
            + describePositions(state));
    }
    const shadowed = state.nodes.slice(startIndex, endIndex + 1);
    const firstVisible = shadowed.find(node => node.left !== null);
    if (firstVisible === undefined || firstVisible.left === null) {
        throw new DecayError('compress：span 中没有可被模型寻址的内容');
    }
    const last = shadowed[shadowed.length - 1];
    const right = last.block ? last.right : nextVisibleLeft(state, endIndex + 1);
    return {
        startIndex,
        endIndex,
        from: firstVisible.left,
        to: right,
        shadowed,
        shadowedTokens: shadowed.reduce((sum, node) => sum + node.tokens, 0),
    };
}
/**
 * Anchor of the first protected carrier node, for diagnostics.
 * 中文：第一个受保护 carrier 节点的锚点，仅用于诊断。
 */
function currentCarrierAnchor(state) {
    const index = carrierStartIndex(state);
    for (let cursor = index; cursor < state.nodes.length; cursor += 1) {
        const left = state.nodes[cursor]?.left;
        if (left !== undefined && left !== null)
            return left;
    }
    return null;
}
/**
 * Explain why a boundary inside the current turn was refused.
 * 中文：解释当前回合内的边界为什么被拒绝。
 */
function currentTurnSpanError(state, firstVisible) {
    const carrierStart = carrierStartIndex(state);
    const startsUnanchored = carrierStart < state.nodes.length && state.nodes[carrierStart].left === null;
    const firstVisibleText = firstVisible === null ? null : formatAnchor(firstVisible);
    const detail = firstVisibleText === null
        ? '当前回合还没有可见锚点。'
        : startsUnanchored
            ? `当前回合在 ${firstVisibleText} 之前还有无锚点消息。`
            : `当前回合从 ${firstVisibleText} 开始。`;
    return new DecayError(`compress：span 包含受保护的当前回合。${detail} `
        + '请用 “end” 作为 “to” 压缩当前回合之前的全部历史，或在当前回合之前选边界。');
}
/**
 * Left anchor of the next surface node at or after `fromIndex`.
 * 中文：`fromIndex` 及其之后第一个 surface 节点的左锚点。
 */
function nextVisibleLeft(state, fromIndex) {
    for (let index = fromIndex; index < state.nodes.length; index += 1) {
        const node = state.nodes[index];
        if (node.left !== null)
            return node.left;
    }
    return null;
}
/**
 * Reject overlapping spans; adjacent spans are allowed.
 * 中文：拒绝相互重叠的 span；相邻 span 允许。
 */
export function assertDisjointSpans(spans) {
    const ordered = [...spans].sort((a, b) => a.startIndex - b.startIndex);
    for (let index = 1; index < ordered.length; index += 1) {
        const previous = ordered[index - 1];
        const current = ordered[index];
        if (current.startIndex <= previous.endIndex) {
            throw new DecayError('compress：span 重叠。一次调用中每个已消费区域最多压缩一次（允许相邻，不允许重叠）。');
        }
    }
}

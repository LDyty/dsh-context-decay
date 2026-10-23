/**
 * Surface-range resolution and guards for the compression tools.
 *
 * Positions are monotonic ids, never reused; anchors use numeric `⟦pN⟧` text.
 * A span is resolved in surface order:
 *  - `from` must be the left anchor of a visible node;
 *  - `to` is either the left anchor of a visible node (exclusive) or a live
 *    summary block's right boundary (the block itself is folded);
 *  - `end` folds through the last compressible node.
 * The guards here enforce three invariants the provider and the design require:
 *  - the current turn is a carrier and is never folded;
 *  - a span edge that would split an assistant tool call from its results is
 *    rejected (all results of one assistant tool-call message stay together);
 *  - a drop names exactly one live summary block.
 *
 * 中文：压缩工具使用的 surface 范围解析与保护。
 * 位置是 id，不是 surface 下标：范围折叠后最小的空闲 id 会被复用，所以数值更大的锚点
 * 可能排在数值更小的锚点前面。span 按 surface 顺序解析：
 *  - `from` 必须是某个可见节点的左锚点；
 *  - `to` 要么是某个可见节点的左锚点（排他），要么是 live 摘要块的右边界（该块本身
 *    被折叠）；
 *  - `end` 一直折叠到最后一个可压缩节点。
 * 这里的保护执行 provider 和设计要求的三个不变量：
 *  - 当前回合是 carrier，绝不被折叠；
 *  - 会把 assistant tool call 和它的结果切开的 span 边界会被拒绝（同一条 assistant
 *    tool-call 消息的所有结果必须留在同一个 span）；
 *  - drop 必须精确匹配一个 live 摘要块。
 */
import type { DecayState, NodeRecord } from './state.js';
/**
 * One model-addressable surface node.
 * 中文：一个可被模型寻址的 surface 节点。
 */
export interface VisibleNode {
    readonly index: number;
    readonly node: NodeRecord;
    readonly position: number;
}
/**
 * A resolved span ready to be applied.
 * 中文：一条已解析、可直接应用的 span。
 */
export interface ResolvedSpan {
    /**
     * Inclusive surface indices of the compressed slice.
     * 中文：被压缩切片在 surface 上的闭区间下标。
     */
    readonly startIndex: number;
    readonly endIndex: number;
    /**
     * Pair: left anchor of the first compressed message, right boundary or null.
     * 中文：配对：第一条被压缩消息的左锚点，以及右边界或 null。
     */
    readonly from: number;
    readonly to: number | null;
    readonly shadowed: readonly NodeRecord[];
    readonly shadowedTokens: number;
}
/**
 * Actionable error surfaced to the model through the tool result.
 * 中文：通过 tool result 返回给模型的可操作错误。
 */
export declare class DecayError extends Error {
    constructor(message: string);
}
/**
 * All model-addressable nodes with their positions, in surface order.
 * 中文：所有可被模型寻址的节点及其位置，按 surface 顺序排列。
 */
export declare function visibleNodes(state: DecayState): VisibleNode[];
/**
 * Legal `to` positions: every visible anchor plus every rendered summary right boundary, in surface order.
 * 中文：合法的 `to` 位置：所有可见锚点，加上所有已渲染摘要块的右边界，按 surface 顺序。
 */
export declare function legalToPositions(state: DecayState): number[];
/**
 * Human-readable visible positions, in message order, for an unknown input position.
 * 中文：输入位置无法识别时，按消息顺序列出可读的可见位置。
 */
export declare function describePositions(state: DecayState): string;
/**
 * Index of the first surface node appended during the current (protected) turn.
 * 中文：当前（受保护）回合里第一个新追加 surface 节点的下标。
 */
export declare function carrierStartIndex(state: DecayState): number;
/**
 * Last surface index that may be folded in this request.
 * 中文：本次请求中最后一个允许折叠的 surface 下标。
 */
export declare function compressibleEndIndex(state: DecayState): number;
/**
 * Whether an assistant tool call/result pairing cut is balanced before every node and after the tail.
 * 中文：每个节点之前和整个 tail 之后，assistant tool call/result 配对切点是否平衡。
 */
export declare function balancedCuts(state: DecayState): boolean[];
/**
 * Resolve one requested span against the current replay state.
 * 中文：针对当前重放状态解析一条请求的 span。
 */
export declare function resolveSpan(state: DecayState, requestedFrom: number, requestedTo: number | 'end'): ResolvedSpan;
/**
 * Find exactly one live summary block matching a pair.
 * 中文：查找与一对锚点精确匹配的唯一 live 摘要块。
 */
export declare function findBlock(state: DecayState, from: number, to: number | 'end'): {
    index: number;
    node: NodeRecord;
};
/**
 * Reject overlapping spans; adjacent spans are allowed.
 * 中文：拒绝相互重叠的 span；相邻 span 允许。
 */
export declare function assertDisjointSpans(spans: readonly ResolvedSpan[]): void;

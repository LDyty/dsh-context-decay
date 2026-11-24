/**
 * Surface-range resolution and guards for the compression tool.
 *
 * Anchors are handles, not surface indices: a compressed region's interior
 * handles are recycled, so a later message may carry a handle that appeared
 * earlier. A compression range is resolved in surface order:
 *  - `from` must be the left handle of a visible node;
 *  - the end is fixed to the last compressible node before the protected
 *    current turn.
 * The guards enforce the invariants the provider and the design require:
 *  - the current turn is a carrier and is never folded;
 *  - a `from` edge that would split an assistant tool call from its results is
 *    rejected (all results of one assistant tool-call message stay together).
 *
 * 中文：压缩工具的 surface 范围解析与保护。
 * 锚点是句柄，不是 surface 下标：被压缩区间内部的句柄会回收，所以较新的消息可能携带
 * 以前出现过的句柄。压缩范围按 surface 顺序解析：
 *  - `from` 必须是某个可见节点的左句柄；
 *  - 终点固定为受保护当前回合之前的最后一个可压缩节点。
 * 这里的保护执行 provider 和设计要求的不变量：
 *  - 当前回合是 carrier，绝不被折叠；
 *  - 会把 assistant tool call 和它的结果切开的 `from` 会被拒绝（同一条 assistant
 *    tool-call 消息的所有结果必须留在同一段）。
 */
import type { DecayState, NodeRecord } from './state.js';
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
     * Pair: left handle of the first compressed message, right boundary or null.
     * 中文：配对：第一条被压缩消息的左句柄，以及右边界或 null。
     */
    readonly from: string;
    readonly to: string | null;
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
 * Resolve one compression start against the current replay state. The end is
 * always the last compressible node before the protected current turn.
 * 中文：针对当前重放状态解析一个压缩起点；终点始终是受保护当前回合之前的最后一个可压缩节点。
 */
export declare function resolveSpan(state: DecayState, requestedFrom: string): ResolvedSpan;

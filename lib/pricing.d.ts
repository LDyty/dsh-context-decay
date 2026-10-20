/**
 * Fixed-heuristic cost accounting for one compression call.
 *
 * The estimate is model-visible in the tool result so the model can see the
 * "kept tail is the cost" rule the design records. It is also written into the
 * `compaction/summary` ledger as an audit fact.
 *
 * 中文：一次压缩调用的固定启发式成本核算。
 * 估算结果在 tool result 里对模型可见，让模型看到设计记录的“保留的 tail 就是成本”
 * 规则；它也会写进 `compaction/summary` ledger 作为审计事实。
 */
import type { DecayState } from './state.js';
import type { ResolvedSpan } from './blocks.js';
/**
 * Estimated one-time cache miss and payback of one compression call.
 * 中文：一次压缩调用估算的一次性 cache miss 和回本请求数。
 */
export interface MissEstimate {
    readonly summaryTokens: number;
    readonly keptTailMessages: number;
    readonly keptTailTokens: number;
    readonly anchorTokens: number;
    readonly oneTimeMissTokens: number;
    readonly shadowedTokens: number;
    readonly paybackRequests: number | null;
}
/**
 * Estimate the first-request miss of folding `spans` into `summaries`.
 * 中文：估算把 `spans` 折叠成 `summaries` 后的首次请求 miss。
 */
export declare function estimateMiss(state: DecayState, spans: readonly ResolvedSpan[], summaries: readonly string[]): MissEstimate;

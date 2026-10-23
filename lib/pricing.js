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
import { estimateTextTokens } from './state.js';
/**
 * Estimate the first-request miss of folding `spans` into `summaries`.
 * 中文：估算把 `spans` 折叠成 `summaries` 后的首次请求 miss。
 */
export function estimateMiss(state, spans, summaries) {
    if (spans.length === 0) {
        return {
            summaryTokens: 0,
            keptTailMessages: 0,
            keptTailTokens: 0,
            anchorTokens: 0,
            oneTimeMissTokens: 0,
            shadowedTokens: 0,
            paybackRequests: null,
        };
    }
    const shadowedSeqs = new Set();
    for (const span of spans)
        for (const node of span.shadowed)
            shadowedSeqs.add(node.seq);
    // Internal positions are monotonic and never reused; the kept tail
    // starts at the earliest shadowed surface index.
    // 中文：内部位置单调递增、永不复用；保留的 tail 从最早的被遮蔽
    // surface 下标开始。
    const earliestIndex = Math.min(...spans.map(span => span.startIndex));
    let keptTailMessages = 0;
    let keptTailTokens = 0;
    for (let index = earliestIndex; index < state.nodes.length; index += 1) {
        const node = state.nodes[index];
        if (node.left === null)
            continue;
        if (shadowedSeqs.has(node.seq))
            continue;
        keptTailMessages += 1;
        keptTailTokens += node.tokens;
    }
    // New summary blocks replace folded anchors; surviving messages keep theirs.
    // 中文：新的摘要块替换被折叠的锚点；保留下来的消息继续用自己的锚点。
    const anchoredKept = keptTailMessages + spans.length;
    const anchorTokens = anchoredKept * 3;
    const summaryTokens = summaries.reduce((sum, summary) => sum + estimateTextTokens(summary), 0);
    const oneTimeMissTokens = summaryTokens + keptTailTokens + anchorTokens;
    const shadowedTokens = spans.reduce((sum, span) => sum + span.shadowedTokens, 0);
    const savedPerRequest = shadowedTokens - summaryTokens;
    return {
        summaryTokens,
        keptTailMessages,
        keptTailTokens,
        anchorTokens,
        oneTimeMissTokens,
        shadowedTokens,
        paybackRequests: savedPerRequest > 0 ? Math.ceil(oneTimeMissTokens / savedPerRequest) : null,
    };
}

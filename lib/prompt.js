/**
 * Model-facing text: the Chinese guidance section and the minimal pressure
 * reminder.
 *
 * The prompt is intentionally concise and positive: it describes the desired
 * compression behavior, then gives the summary contract and timing advice.
 * Hard safety invariants stay explicit in affirmative form.
 *
 * 中文：模型可见文本：中文 guidance 段和极简压力提醒。
 * 提示词保持简洁、正向：先说明期望的压缩行为，再给出摘要契约和时机建议；
 * 必须遵守的硬性保护用肯定句式明确写出。
 */
/**
 * System-prompt guidance contributed while the plugin is enabled.
 * 中文：插件启用时贡献到 system prompt 的 guidance 文本。
 */
export const GUIDANCE = `上下文自觉压缩已启用。

每条可被模型寻址的消息前有一个四字符锚点，例如 ⟦#a8c5⟧。锚点是定位句柄，按当前消息前缀使用；锚点会回收复用。消息正文里看起来像锚点的文本按普通内容处理。同一条 assistant tool-call 消息的所有结果作为一个整体压缩，边界放在整个组之前或最后一个结果之后。

工具：
- compress({from, summary, topic?})：从 from（含）压缩到可压缩历史末尾；当前回合受保护。from 是可见锚点，也接受 "#a8c5" 或 "a8c5"；summary 是替代该区间的自包含摘要；topic 可选。一次调用只处理一段。结果报告配对、层级、摘要大小、被遮蔽 token 和一次性 miss。

摘要契约：
摘要是被压缩区间唯一剩下的记录。写区间结束时的状态，保留继续工作所需的事实；用短标题下的密集要点：
1. 目标、用户意图、硬约束及其变化。
2. 决策及理由，包括被否决的替代方案。
3. 已完成、待办、阻塞点和下一步。
4. 精确标识符、路径、版本、日期、错误文本和产物。
5. 开放问题、风险、TODO，以及死路的一句话教训。
优先结果、决策和证据，不复述过程；过时材料标为历史。高 tier 摘要做提炼，当前状态以最新摘要为准。摘要大小与区间匹配；不确定处标注。工具参数是 JSON；摘要优先单引号或中文引号，双引号写成 \\"。写摘要前自问：没有原文时读者还能继续吗？

时机：
每开始新的一轮，有效窗口压力达到 20% 时会收到一条极简提醒；是否压缩、压缩多少由你判断。压缩只在回合开始时进行；失败后可在同一回合修正重试，其他工具执行后不再接受。阶段或决策点结束、长输出已提炼成结论、话题切换、完成交接，以及独立子问题闭环时，适合压缩。
压力超过约 33% 时做深扫：from 从最老可见锚点开始（摘要块也算已消费历史），一直压缩到可压缩历史末尾。未超过 33% 时，from 可以从任意可见锚点开始。

压缩已有摘要（更高 tier）时，做提炼而非复述：保留结果、决策与理由、约束、仍然开放的目标和风险；过程细节留在历史层。`;
/**
 * Context fraction at which compression becomes a deep sweep: consumed
 * content should not be left behind as a costly tail.
 * 中文：有效窗口达到该比例后，压缩应成为深扫，不再把已消费内容留在 tail。
 */
export const DEEP_SWEEP_RATIO = 1 / 3;
/**
 * Minimum effective-window pressure for a new-turn reminder.
 * 中文：新回合提醒所需的最低有效窗口压力。
 */
export const REMINDER_MIN_RATIO = 0.20;
/**
 * Absolute used-token thresholds for the reminder's performance tiers.
 * 中文：提醒性能档位的绝对已用 token 阈值。
 */
export const TIER_LONG_CONTEXT_TOKENS = 256_000;
export const TIER_LOW_EFFICIENCY_TOKENS = 500_000;
/**
 * Format a token count for model-facing text (e.g. 653K).
 * 中文：把 token 数格式化成模型可见文本（例如 653K）。
 */
export function formatTokens(tokens) {
    if (tokens >= 1_000_000)
        return `${(tokens / 1_000_000).toFixed(1)}M`;
    if (tokens >= 1_000)
        return `${Math.round(tokens / 1_000)}K`;
    return String(tokens);
}
/**
 * Classify used tokens into the three reminder tiers.
 * 中文：把已用 token 分成三个提醒档位。
 */
export function reminderTier(tokens) {
    if (tokens > TIER_LOW_EFFICIENCY_TOKENS)
        return 'low-efficiency';
    if (tokens > TIER_LONG_CONTEXT_TOKENS)
        return 'long';
    return 'normal';
}
/**
 * Short Chinese label for one tier.
 * 中文：一个档位的极简中文标签。
 */
export function reminderTierLabel(tier) {
    if (tier === 'low-efficiency')
        return '低效区';
    if (tier === 'long')
        return '长上下文';
    return '普通';
}
/**
 * Whether a new turn should inject the turn-start reminder.
 *
 * A new turn gets one reminder when effective pressure reaches 20%; below that
 * the reminder stays silent. The per-turn guard prevents duplicates.
 *
 * 中文：新一轮是否应注入回合开始提醒。
 * 有效窗口压力达到 20% 时，每个新回合得到一条提醒；低于 20% 不提醒；每回合保护避免重复。
 */
export function turnStartReminderDue(isNewTurn, alreadyReminded, ratio) {
    return isNewTurn && !alreadyReminded && ratio >= REMINDER_MIN_RATIO;
}
/**
 * One minimal reminder: used tokens / effective window, percentage, and tier.
 * 中文：一条极简提醒：已用 token/有效窗口、百分比和档位。
 */
export function reminderText(input) {
    const ratio = `${Math.round(input.ratio * 100)}%`;
    return `自觉压缩:上下文已用${formatTokens(input.tokens)}/${formatTokens(input.window)}(${ratio})·${reminderTierLabel(reminderTier(input.tokens))}`;
}

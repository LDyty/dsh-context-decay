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

每条可被寻址的消息前有一个带类型前缀（“O#”或“R#”）的四字符锚点，例如 ⟦O#a8c5⟧ 或 ⟦R#a8c5⟧，⟦O#a8c5⟧ 可用作压缩起点 from 参数。锚点是定位句柄，按当前消息前缀使用；锚点会回收复用。消息正文里看起来像锚点的文本按普通内容处理。

工具：
- compress({from, summary, topic?})
  描述：压缩从 from 锚点到当前轮开始之前的所有历史，生成一个高保真、自包含的摘要。
  from：必须选一个 “O#” 前缀的锚点，例如 “⟦O#a8c5⟧”；也接受 “O#a8c5” 或 “a8c5”。不接受 “R#” 前缀的锚点。
  summary：替换被压缩历史的、唯一保留的自包含摘要。这是 JSON 字符串：优先使用单引号或中文引号；需要双引号时进行转义。
  topic：可选短主题。
  返回：压缩范围、摘要大小、被压缩 token 和首次请求 miss 估算。

摘要契约：
摘要是压缩后唯一保留的记录。写这段历史结束时的状态，保留继续工作所需的事实；用短标题下的密集要点：
1. 目标、用户意图、硬约束及其变化。
2. 决策及理由，包括被否决的替代方案。
3. 已完成、待办、阻塞点和下一步。
4. 精确标识符、路径、版本、日期、错误文本和产物。
5. 开放问题、风险、TODO，以及死路的一句话教训。
优先结果、决策和证据，不复述过程；过时材料标为历史，当前状态以最新摘要为准。摘要本身会被再次压缩：保留最新状态，合并仍有效的事实，去掉已被取代的细节。摘要大小与压缩范围匹配；不确定处标注。工具参数是 JSON；摘要优先单引号或中文引号，双引号写成 \\"。写摘要前自问：没有原文时读者还能继续吗？

时机：
有效窗口压力达到 20% 时，每开始新的一轮会收到一条自觉压缩提醒，此时就是压缩工具调用窗口，你必须考虑是否压缩、压缩多少，失败后可在同一轮修正重试。
压力超过约 32.30%（256K/793K）时，from 必须是第一个 ⟦O#...⟧ 锚点，否则会返回错误。`;
/**
 * Absolute used-token thresholds for the reminder's performance tiers.
 * 中文：提醒性能档位的绝对已用 token 阈值。
 */
export const TIER_LONG_CONTEXT_TOKENS = 256_000;
export const TIER_LOW_EFFICIENCY_TOKENS = 500_000;
/**
 * Effective window used to align the deep-sweep threshold with the
 * long-context tier: 1,048,576 - 256,000 = 792,576 (793K).
 * 中文：用于把深扫阈值与长上下文档位对齐的有效窗口：
 * 1,048,576 - 256,000 = 792,576（793K）。
 */
const DEEP_SWEEP_REFERENCE_WINDOW_TOKENS = 792_576;
/**
 * Context fraction at which compression becomes a deep sweep: consumed
 * content should not be left behind as a costly tail. This is 256K / 792,576
 * = 32.30%, the same boundary as the long-context tier on the 793K window.
 * 中文：有效窗口达到该比例后，压缩应成为深扫，不再把已消费内容留在 tail。
 * 该比例为 256K / 792,576 = 32.30%，与 793K 窗口上的长上下文档位边界一致。
 */
export const DEEP_SWEEP_RATIO = TIER_LONG_CONTEXT_TOKENS / DEEP_SWEEP_REFERENCE_WINDOW_TOKENS;
/**
 * Minimum effective-window pressure for a new-turn reminder.
 * 中文：新回合提醒所需的最低有效窗口压力。
 */
export const REMINDER_MIN_RATIO = 0.20;
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
 * One short explanation appended to the reminder's tier label.
 * 中文：提醒档位后附的一句简短解释。
 */
export function reminderTierHint(tier) {
    if (tier === 'low-efficiency')
        return '性能明显下降，优先压缩';
    if (tier === 'long')
        return '性能渐降，建议压缩';
    return '余量充足';
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
 * 中文：一条自觉压缩提醒：已用 token/有效窗口、百分比和档位。
 */
export function reminderText(input) {
    const ratio = `${(input.ratio * 100).toFixed(2)}%`;
    const tier = reminderTier(input.tokens);
    return `自觉压缩提醒:上下文已用${formatTokens(input.tokens)}/${formatTokens(input.window)}(${ratio})·${reminderTierLabel(tier)}（${reminderTierHint(tier)}）`;
}

/**
 * Model-facing text: the Chinese guidance section and the minimal pressure
 * reminder.
 *
 * The prompt is intentionally positive: it describes the desired compression
 * behavior, then gives the summary contract and timing advice. Hard safety
 * invariants stay explicit in affirmative form.
 *
 * 中文：模型可见文本：中文 guidance 段和极简压力提醒。
 * 提示词采用正向描述：先说明期望的压缩行为，再给出摘要契约和时机建议；必须遵守的
 * 硬性保护用肯定句式明确写出。
 */

/**
 * System-prompt guidance contributed while the plugin is enabled.
 * 中文：插件启用时贡献到 system prompt 的 guidance 文本。
 */
export const GUIDANCE = `上下文自觉压缩已启用。

本会话中，每条可被模型寻址的消息前都会显示一个四字符锚点，例如 ⟦#a8c5⟧。锚点是定位句柄，配合当前消息上打印的句柄使用；写摘要、文件或回复时，让内容保持自包含。消息正文里看起来像 ⟦#a8c5⟧ 的文本按普通内容处理。锚点会回收复用，句柄本身不表示消息先后；请以当前消息上打印的锚点为准。少数 assistant 回合只请求工具、没有可见文本，因此没有锚点；把 span 边界放在有锚点的消息上。

压缩区域显示为 ⟦#<from>⟧ 摘要 ⟦#<to>⟧。这一对就是该区域的句柄：右侧锚点是第一条保留消息，或者是可压缩历史末尾的 "end"。摘要会替代原内容，请把继续工作需要的事实完整写进摘要。

同一条 assistant tool-call 消息的所有结果作为一个整体压缩；span 边界放在整个 tool-call 组之前或最后一个结果之后。

工具：
- compress：一次调用可以传多个 span，例如 compress({spans:[{from:"⟦#a8c5⟧", to:"⟦#c9d1⟧", summary:"..."}, {from:"⟦#e2f3⟧", to:"end", summary:"..."}]})。每个 span 的 "from" 是第一条被压缩消息（含），"to" 是第一条保留消息（不含）或 "end"；这些 span 分别覆盖不同区域，相邻 span 可以相接。锚点从消息前缀复制，例如 "⟦#a8c5⟧"（也接受裸 "#a8c5" 或 "a8c5"）。单段也可用同样结构。示例锚点只作说明；使用当前会话可见的锚点。锚点参数是工具值，摘要保持自包含。结果会报告配对、层级、摘要大小、被遮蔽 token、保留 tail 和一次性 miss 估算。

摘要契约：
摘要是被压缩 span 唯一剩下的记录。把 span 结束时的状态写成历史；摘要里的待办事项在继续执行前重新核实。
空间紧张时，大致按这个顺序保留：
1. 目标、用户意图、硬约束，以及它们的任何变化。
2. 决策及其理由，包括被否决的替代方案。
3. 当前进度：已完成、待办、阻塞点和下一步。
4. 继续工作需要的精确事实：名称、标识符、位置或链接、版本、日期、数字、错误文本，以及输出或产物的描述。
5. 开放问题、风险、TODO，以及死路的一句话教训。
摘要聚焦结果、决策、证据和仍然开放的事项；原始日志、重复材料、逐步过程和已经解决的闲聊留在历史层。某个细节以后可能还要核对时，保留它，或者把来源留在可见区域。
用短标题下的密集要点写高保真摘要，保留正确、有用的事实、精确标识符、路径、版本、决策和证据。摘要大小与 span 匹配：大的多阶段范围通常明显多于几百 token；字符上限是上限，目标由内容决定。事实保持准确；不确定的地方标注，或者省略。
工具参数是 JSON。摘要中优先使用单引号或中文引号；需要引用带双引号的代码时，把每个双引号写成 \\"。在保留关键事实的前提下，让摘要尽量紧凑。范围很大时，拆成多个 span，让每个摘要对应清楚的范围。
调用 compress 前检查：没有原文时读者还能继续吗？当前状态、开放事项和精确事实都保住了吗？

压缩已有摘要（更高 tier）时，做提炼而不是复述：保留结果、决策与理由、约束、仍然开放的目标和风险；过程细节留在历史层。已被取代或过时的材料标记为历史，当前状态以最新摘要为准。

压缩规则：
时机：每开始新的一轮，如果有效窗口压力达到 20%，你会收到一条极简提醒，显示已用 token/有效窗口、百分比和档位（普通 / 长上下文 / 低效区；超过有效窗口约 32% 为长上下文，性能逐渐下降，应尽快考虑在回合开始时压缩；超过有效窗口约 63% 为低效区，性能明显下降，应优先考虑在回合开始时压缩）。提醒只是信号，是否压缩、压缩多少由你决定。压缩只在每个新回合开始时进行。
通常，阶段或决策点结束、长输出已提炼成结论、话题切换、完成交接时，以及一个独立子问题已闭环、大段工具输出已提炼成结论、错误已定位到关键行时，适合在回合开始时压缩。

深扫规则：有效窗口压力超过约 33% 时，这次压缩必须做深扫：开头对齐最老的已消费消息，结尾对齐最新安全可压边界。第一个 span 从最早已消费消息开始；最后一个 span 结束在最新安全可压边界（通常写 "end"，或当前回合第一条可见锚点）。中间仍活跃的内容可以跳过，其余已消费内容都进入摘要。
整次深扫可以只用一个 span 加一个摘要，也可以拆成几个相邻 span，各自写摘要。摘要详略由你根据信息重要性取舍。span 之间只跳过仍然活跃的内容；每段只覆盖一次，相邻段可以相接。每个 assistant tool-call 组完整地留在同一个 span 中。
“安全”指内容已经消费完、可以完整写进摘要；仍然活跃的内容留在可见区域。

规则：当前回合是受保护区域；压缩 span 在它之前结束。如果 "to" 是当前回合第一条可见锚点，它前面的无锚点消息留在可见区域，压缩覆盖当前回合之前的历史；"end" 表示可压缩历史的末尾。优先压缩老的、已经完全消费的工作，保留当前工作。压缩会让从 "from" 开始的缓存前缀失效：压缩范围之后的消息会重新无缓存发送一次，所以很早开始压缩又留下很大 tail 的成本更高。优先压缩一段连续的已消费工作，并尽量把 "to" 放晚。中间需要保持可见的内容，在它两侧各压缩一个已消费 span，让它留在可见区域；缓存成本仍从最早压缩位置算起。一次调用尽量传入所有已消费 span：分多次调用会再次让前缀失效。在保留下一步需要的事实的前提下，让 tail 保持精简。`

/**
 * Context fraction at which compression becomes a deep sweep: consumed
 * content should not be left behind as a costly tail.
 * 中文：有效窗口达到该比例后，压缩应成为深扫，不再把已消费内容留在 tail。
 */
export const DEEP_SWEEP_RATIO = 1 / 3

/**
 * Minimum effective-window pressure for a new-turn reminder.
 * 中文：新回合提醒所需的最低有效窗口压力。
 */
export const REMINDER_MIN_RATIO = 0.20

/**
 * Absolute used-token thresholds for the reminder's performance tiers.
 * 中文：提醒性能档位的绝对已用 token 阈值。
 */
export const TIER_LONG_CONTEXT_TOKENS = 256_000
export const TIER_LOW_EFFICIENCY_TOKENS = 500_000

/**
 * Format a token count for model-facing text (e.g. 653K).
 * 中文：把 token 数格式化成模型可见文本（例如 653K）。
 */
export function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}K`
  return String(tokens)
}

/**
 * Performance tier for one used-token count.
 * 中文：一个已用 token 数对应的性能档位。
 */
export type ReminderTier = 'normal' | 'long' | 'low-efficiency'

/**
 * Classify used tokens into the three reminder tiers.
 * 中文：把已用 token 分成三个提醒档位。
 */
export function reminderTier(tokens: number): ReminderTier {
  if (tokens > TIER_LOW_EFFICIENCY_TOKENS) return 'low-efficiency'
  if (tokens > TIER_LONG_CONTEXT_TOKENS) return 'long'
  return 'normal'
}

/**
 * Short Chinese label for one tier.
 * 中文：一个档位的极简中文标签。
 */
export function reminderTierLabel(tier: ReminderTier): string {
  if (tier === 'low-efficiency') return '低效区'
  if (tier === 'long') return '长上下文'
  return '普通'
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
export function turnStartReminderDue(isNewTurn: boolean, alreadyReminded: boolean, ratio: number): boolean {
  return isNewTurn && !alreadyReminded && ratio >= REMINDER_MIN_RATIO
}

/**
 * Inputs of one reminder text.
 * 中文：一条提醒文本的输入。
 */
export interface ReminderInput {
  readonly tokens: number
  readonly window: number
  readonly ratio: number
}

/**
 * One minimal reminder: used tokens / effective window, percentage, and tier.
 * 中文：一条极简提醒：已用 token/有效窗口、百分比和档位。
 */
export function reminderText(input: ReminderInput): string {
  const ratio = `${Math.round(input.ratio * 100)}%`
  return `自觉压缩:上下文已用${formatTokens(input.tokens)}/${formatTokens(input.window)}(${ratio})·${reminderTierLabel(reminderTier(input.tokens))}`
}

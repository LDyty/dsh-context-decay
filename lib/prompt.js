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

时机：
优先在开始新的一轮时压缩上一轮或更早的已消费历史，这样当前轮次的工作保持完整。也适合在阶段或决策点结束、长输出已提炼成结论、话题切换、完成交接时压缩。
检查做到一半、结论还没记录、当前步骤仍依赖精确细节时，把压缩安排在阶段结束之后；仍然需要的近期工作留在可见区域。
压力提醒是寻找时机的信号；把它当作时机参考，压缩时机由你决定。当前工作确实需要上下文时，先完成这一轮，在下一轮开始时压缩。

深扫规则：
有效窗口压力超过大约 33% 时，把压缩安排在开始新的一轮；当前轮次已经调用过其他工具或产生了需要保留的工作时，先完成当前轮次，下一轮开始再压缩。
无论一次压缩几个 span，第一个 span 从已消费边界开始，最后一个 span 结束于最新安全可压边界，通常是 "end" 或当前轮次第一条可见锚点；已消费内容都进入摘要，tail 保留仍然活跃的内容。
可以把整次深扫写成一个 span 加一个摘要，也可以写成几个连续 span 加各自摘要。细节需求不同时，老 span 简短些，新 span 详细些。只有仍然活跃的内容之间才保留 gap；各 span 分别覆盖不同区域，相邻 span 可以相接；每个 assistant tool-call 组完整地留在同一个 span 中。
“安全”指内容已经消费完、可以完整写进摘要的位置；活跃内容留在可见区域。

规则：当前回合是受保护区域；压缩 span 在它之前结束。如果 "to" 是当前回合第一条可见锚点，它前面的无锚点消息留在可见区域，压缩覆盖当前回合之前的历史；"end" 表示可压缩历史的末尾。优先压缩老的、已经完全消费的工作，保留当前工作。压缩会让从 "from" 开始的缓存前缀失效：压缩范围之后的消息会重新无缓存发送一次，所以很早开始压缩又留下很大 tail 的成本更高。优先压缩一段连续的已消费工作，并尽量把 "to" 放晚。中间需要保持可见的内容，在它两侧各压缩一个已消费 span，让它留在可见区域；缓存成本仍从最早压缩位置算起。一次调用尽量传入所有已消费 span：分多次调用会再次让前缀失效。在保留下一步需要的事实的前提下，让 tail 保持精简。
每用掉有效窗口的 10%，你会收到一条极简提醒，只显示已用 token/有效窗口和百分比。每开始新的一轮，你也会收到一条同类极简提醒。提醒只是帮你选择压缩时机，压缩仍然由你决定。`;
/**
 * Context fraction at which compression becomes a deep sweep: consumed
 * content should not be left behind as a costly tail.
 * 中文：上下文达到该比例后，压缩应成为深扫，不再把已消费内容留在 tail。
 */
export const DEEP_SWEEP_RATIO = 1 / 3;
/**
 * Reminder interval as a fraction of the effective window.
 * 中文：提醒间隔占有效窗口的比例。
 */
export const REMINDER_STEP_RATIO = 0.10;
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
 * Absolute token step of one 10% reminder interval.
 * 中文：一个 10% 提醒间隔的绝对 token 步长。
 */
export function reminderStepTokens(window) {
    return Math.max(1, Math.floor(window * REMINDER_STEP_RATIO));
}
/**
 * Choose the next reminder: one reminder per 10% of the effective window.
 *
 * The first observation is a silent baseline. A compression that lowers the
 * surface below the last reminder also resets the baseline silently, so the
 * next reminder measures growth from the new pressure.
 *
 * 中文：选择下一条提醒：有效窗口每增长 10% 提醒一次。
 * 第一次观察只建立静默基线。压缩把 surface 降到上次提醒以下时也静默重置基线，下一条
 * 提醒从新压力开始测量增长。
 */
export function decideReminder(state) {
    if (state.window <= 0)
        return { plan: null, baseline: false };
    // A compression lowers the surface below the last reminder: measure growth
    // from the new level instead of the stale pre-compression baseline.
    // 中文：压缩会把 surface 降到上次提醒以下：从新水平重新测量增长，使用新基线。
    if (state.tokens < state.lastTokens)
        return { plan: null, baseline: true };
    if (state.lastTokens === 0)
        return { plan: null, baseline: true };
    const step = reminderStepTokens(state.window);
    if (state.tokens - state.lastTokens < step)
        return { plan: null, baseline: false };
    return { plan: { atTokens: Math.round(state.tokens) }, baseline: false };
}
/**
 * Whether a new turn should inject the turn-start reminder.
 *
 * Every new turn gets one minimal reminder, independent of pressure and the
 * 10% growth step. The per-turn guard prevents duplicates.
 *
 * 中文：新一轮是否应注入回合开始提醒。
 * 每个新回合都会得到一条极简提醒，不依赖压力和 10% 增长步长；每回合保护避免重复注入。
 */
export function turnStartReminderDue(isNewTurn, alreadyReminded) {
    return isNewTurn && !alreadyReminded;
}
/**
 * One minimal reminder: only used tokens / effective window and percentage.
 * 中文：一条极简提醒：只保留已用 token/有效窗口和百分比。
 */
export function reminderText(input) {
    const ratio = `${Math.round(input.ratio * 100)}%`;
    return `来自自觉压缩工具的提醒：已用 ${formatTokens(input.tokens)}/${formatTokens(input.window)}（${ratio}）。`;
}

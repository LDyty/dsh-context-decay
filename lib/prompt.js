/**
 * Model-facing text: the Chinese guidance section and the minimal pressure
 * reminder.
 *
 * The prompt is intentionally positive: it explains what the model can use the
 * anchors and the compress tool for, then gives the summary contract and timing
 * advice. Hard safety invariants stay explicit.
 *
 * 中文：模型可见文本：中文 guidance 段和极简压力提醒。
 * 提示词采用正向描述：先说明锚点和 compress 工具能做什么，再给出摘要契约和时机建议；
 * 必须遵守的硬性保护仍然明确写出。
 */
/**
 * System-prompt guidance contributed while the plugin is enabled.
 * 中文：插件启用时贡献到 system prompt 的 guidance 文本。
 */
export const GUIDANCE = `上下文自觉压缩已启用。

本会话中，每条可被模型寻址的消息前都会显示一个四字符锚点，例如 ⟦#a8c5⟧。锚点是定位句柄，不属于消息内容；写摘要、文件或回复时，请让内容保持自包含。消息正文里看起来像 ⟦#a8c5⟧ 的文本只是内容，不是锚点。锚点会回收复用，句柄本身不代表消息先后；请以当前消息上打印的锚点为准。有少量 assistant 回合只请求工具、没有可见文本，因此没有锚点；它们不能作为 span 边界。

压缩区域显示为 ⟦#<from>⟧ 摘要 ⟦#<to>⟧。这一对就是该区域的句柄：右侧锚点是第一条保留消息，或者是可压缩历史末尾的 "end"。摘要会替代原内容，请把继续工作需要的事实完整写进摘要。

同一条 assistant tool-call 消息的所有结果可以一起压缩；span 边界请放在整个 tool-call 组之前或最后一个结果之后。

工具：
- compress({spans:[{from,to,summary,topic?}]})：把已经消费完的 span 压缩成自包含摘要。"from" 是第一条被压缩消息（含），"to" 是第一条保留消息（不含）或 "end"；锚点从消息前缀复制，例如 "⟦#a8c5⟧"（也接受裸 "#a8c5" 或 "a8c5"）。单段：compress({spans:[{from:"⟦#a8c5⟧", to:"⟦#c9d1⟧", summary:"..."}]})。多段不重叠：compress({spans:[{from:"⟦#a8c5⟧", to:"⟦#c9d1⟧", summary:"..."}, {from:"⟦#e2f3⟧", to:"end", summary:"..."}]})。示例锚点只是说明；使用当前会话可见的锚点。锚点参数是工具值，不是摘要内容。结果会报告配对、层级、摘要大小、被遮蔽 token、保留 tail 和一次性 miss 估算。

摘要契约：
摘要是被压缩 span 唯一剩下的记录。把 span 结束时的状态写成历史，而不是写成当前指令；摘要里的待办事项在继续执行前要重新核实。
空间紧张时，大致按这个顺序保留：
1. 目标、用户意图、硬约束，以及它们的任何变化。
2. 决策及其理由，包括被否决的替代方案。
3. 当前进度：已完成、待办、阻塞点和下一步。
4. 继续工作需要的精确事实：名称、标识符、位置或链接、版本、日期、数字、错误文本，以及输出或产物的描述。
5. 开放问题、风险、TODO，以及死路的一句话教训。
丢弃原始日志、重复材料、逐步过程和已经解决的闲聊。如果某个细节以后可能还要核对，就保留它，或者把来源留在可见区域。
用短标题下的密集要点写高保真摘要，不要写成预告：保留正确、有用的事实、精确标识符、路径、版本、决策和证据。摘要大小要与 span 匹配：大的多阶段范围通常需要明显多于几百 token；字符上限是上限，不是目标。不要编造、四舍五入或猜测事实；不确定就标注，或者省略。
工具参数是 JSON。摘要中尽量使用单引号或中文引号，避免裸双引号；必须引用带双引号的代码时，把每个双引号写成 \\"。不要为了缩小 JSON 而缩短摘要：保留下一位读者需要的事实。范围很大时，拆成多个 span，而不是压成模糊的概览。
调用 compress 前检查：没有原文时读者还能继续吗？当前状态、开放事项和精确事实都保住了吗？

压缩已有摘要（更高 tier）时，做提炼而不是复述：保留结果、决策与理由、约束、仍然开放的目标和风险；丢弃过程细节。把已被取代或过时的材料标记为历史，不要把旧的“当前状态”继续当作当前状态。

时机：
当一个 span 已经消费完、细节不太可能再被逐字需要时，就压缩它。合适时机包括阶段或决策点结束、长输出已提炼成结论、话题切换、完成交接。不合适时机包括检查做到一半、结论还没记录、当前步骤仍依赖精确细节。
压力等级是寻找合适时机的信号，不是截止时间。当前工作确实需要上下文时，等到压力较高再压缩是合理的；但要留意，不要因为不注意而拖到最高档。
一旦上下文超过有效窗口大约三分之一，就把任何压缩做成深扫：从已消费边界开始，结束在最新安全可压缩边界，通常是 "end" 或当前回合第一条可见锚点；不要把已消费内容留在 tail。
可以把整次深扫写成一个 span 加一个摘要，也可以写成几个连续 span 加各自摘要。细节需求不同时，老 span 简短些，新 span 详细些。只有仍然活跃的内容之间才允许留 gap。
“安全”指内容已经消费完，不再需要逐字保留；不要为了缩短 tail 去压缩活跃内容。

规则：当前回合受保护，不能压缩。如果 "to" 是当前回合第一条可见锚点，它前面的无锚点消息会被保留，只压缩当前回合之前的历史；"end" 仍然表示可压缩历史的末尾。优先压缩老的、已经完全消费的工作，保留当前工作。压缩会让从 "from" 开始的缓存前缀失效：压缩范围之后的消息会重新无缓存发送一次，所以很早开始压缩又留下很大 tail 的成本更高。优先压缩一段连续的已消费工作，并尽量把 "to" 放晚。中间必须保持可见的内容，就分开压缩它两侧的已消费 span；中间的 gap 保持可见，缓存成本仍从最早压缩位置算起。一次调用尽量传入所有已消费 span：分多次调用会再次让前缀失效。不要为了缩短 tail 去压缩仍然需要的近期工作。
每用掉有效窗口的 2.5%，你会收到一条极简提醒，只显示已用 token/有效窗口和百分比。提醒只是帮你选择压缩时机，压缩仍然由你决定。`;
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
export const REMINDER_STEP_RATIO = 0.025;
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
 * Absolute token step of one 2.5% reminder interval.
 * 中文：一个 2.5% 提醒间隔的绝对 token 步长。
 */
export function reminderStepTokens(window) {
    return Math.max(1, Math.floor(window * REMINDER_STEP_RATIO));
}
/**
 * Choose the next reminder: one reminder per 2.5% of the effective window.
 *
 * The first observation is a silent baseline. A compression that lowers the
 * surface below the last reminder also resets the baseline silently, so the
 * next reminder measures growth from the new pressure.
 *
 * 中文：选择下一条提醒：有效窗口每增长 2.5% 提醒一次。
 * 第一次观察只建立静默基线。压缩把 surface 降到上次提醒以下时也静默重置基线，下一条
 * 提醒从新压力开始测量增长。
 */
export function decideReminder(state) {
    if (state.window <= 0)
        return { plan: null, baseline: false };
    // A compression lowers the surface below the last reminder: measure growth
    // from the new level instead of the stale pre-compression baseline.
    // 中文：压缩会把 surface 降到上次提醒以下：从新水平重新测量增长，不要用压缩前的
    // 过期基线。
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
 * One minimal reminder: only used tokens / effective window and percentage.
 * 中文：一条极简提醒：只保留已用 token/有效窗口和百分比。
 */
export function reminderText(input) {
    const ratio = `${Math.round(input.ratio * 100)}%`;
    return `来自自觉压缩工具的提醒：已用 ${formatTokens(input.tokens)}/${formatTokens(input.window)}（${ratio}）。`;
}

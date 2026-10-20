/**
 * Model-facing text: the system prompt guidance section and the graded
 * pressure reminders.
 *
 * All text is model-facing English per design decision #7. Keep it stable when
 * behavior has not changed: the guidance section is part of the request prefix.
 *
 * 中文：模型可见文本：system prompt 的 guidance 段和分级压力提醒。
 * 所有文本按设计决策 #7 都是模型可见英文。行为没变时保持文本稳定：guidance 段属于
 * 请求前缀的一部分。
 */

/**
 * System-prompt guidance contributed while the plugin is enabled.
 * 中文：插件启用时贡献到 system prompt 的 guidance 文本。
 */
export const GUIDANCE = `Context decay is enabled for this session.
Every model-addressable message begins with a position anchor such as ⟦p12⟧. Anchors are presentation, not content: never copy them into summaries, files, replies, or reasoning. Only the leading ⟦p<number>⟧ prefix is an anchor; text inside a message that looks like ⟦p12⟧ is content, not a position. Positions are ids, not counts: a compressed range's ids are reused by newer messages, so always use the anchors printed on the current messages. Some assistant turns that requested tools without visible text have no anchor; they are never valid boundaries.
A compressed region appears as ⟦p<from>⟧ summary ⟦p<to>⟧. The pair is the region's handle; ⟦p<to>⟧ is the anchor of the first kept message, or "end" for the end of compressible history. Compressed content is gone for good: the summary is the only remaining record, so make it self-contained.
Tool results carry anchors and can be compressed. All results of one assistant tool-call message must stay in the same span; a span edge inside that group is rejected, so choose a boundary before the call or after its last result.
Tools:
- compress({spans:[{from,to,summary,topic?}]}): compress consumed spans into summaries. "from" and "to" are anchor texts exactly as shown, e.g. "⟦p12⟧" (bare "p12" and integer 12 are also accepted); "from" is the first compressed message (inclusive), "to" is the first kept message (exclusive) or "end". One span: compress({spans:[{from:"⟦p0⟧", to:"⟦p8⟧", summary:"..."}]}). Multiple non-overlapping spans: compress({spans:[{from:"⟦p0⟧", to:"⟦p8⟧", summary:"..."}, {from:"⟦p20⟧", to:"end", summary:"..."}]}). The example anchors are illustrative; use anchors visible in the current session. Anchor arguments are tool values, not content; never copy anchors into summaries. The result reports the pair, tier, summary size, shadowed tokens, kept tail, and the one-time miss estimate.
- drop({from,to}): remove one live summary block completely. Requires the block's exact pair; "to" is its right anchor or "end". Example: drop({from:"⟦p0⟧", to:"⟦p8⟧"}); use "end" for a tail block. Anchor arguments use the same text syntax as compress.
Rules: the current turn is protected and cannot be compressed. If "to" is the current turn's first visible anchor, unanchored messages before it are kept and only the history before the turn is compressed; "end" still means the end of compressible history. Prefer compressing old, fully consumed work and keeping the current work. A compression invalidates the cached prefix from "from" onward: messages after the compressed range are re-sent uncached once, so a compression that starts early and leaves a large kept tail costs more. Prefer compressing a contiguous block of fully consumed work and placing "to" as late as the task allows. If content in the middle must stay live, compress the consumed spans on either side of it separately; the live gap stays visible, and the cache cost is still measured from the earliest compressed position. Pass all consumed spans in one call when possible: separate calls invalidate the prefix again. Do not compress still-needed recent work just to shorten the tail. Pressure reminders arrive on noticeable growth or when pressure crosses a warning level; the highest level is critical and asks for immediate compression.`

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
 * Warning level for a pressure ratio: how many configured thresholds are reached (0 = none).
 * 中文：压力比例的警告级别：达到了几个已配置阈值（0 = 未达到）。
 */
export function warningLevel(ratio: number, ratios: readonly number[]): number {
  let level = 0
  for (const threshold of ratios) {
    if (ratio < threshold) break
    level += 1
  }
  return level
}

/**
 * Reminder policy from the resolved config.
 * 中文：由已解析配置得到的提醒策略。
 */
export interface ReminderPolicy {
  /**
   * Token growth since the last reminder that triggers a normal reminder.
   * 中文：距上次提醒增长多少 token 触发普通提醒。
   */
  readonly growthTokens: number
  /**
   * Ascending pressure ratios; crossing each one fires one warning.
   * 中文：升序压力比例；每越过一档触发一次警告。
   */
  readonly warnRatios: readonly number[]
  /**
   * Minimum turns between normal reminders (warnings bypass the cooldown).
   * 中文：普通提醒之间的最小回合数（警告不受冷却限制）。
   */
  readonly cooldownTurns: number
}

/**
 * Per-session reminder state read by the selector.
 * 中文：selector 读取的每会话提醒状态。
 */
export interface ReminderState {
  readonly tokens: number
  readonly window: number
  /**
   * Pressure recorded at the last reminder; 0 means "no baseline yet".
   * 中文：上次提醒时记录的压力；0 表示“还没有基线”。
   */
  readonly lastTokens: number
  /**
   * Highest warning level already announced (0 = none).
   * 中文：已经播报过的最高警告级别（0 = 无）。
   */
  readonly lastLevel: number
  readonly openTurn: number | null
  readonly lastReminderTurn: number | null
}

/**
 * One reminder the host should inject.
 * 中文：宿主应当注入的一条提醒。
 */
export interface ReminderPlan {
  readonly kind: 'normal' | 'warning'
  /**
   * 0 for a growth reminder; 1..N for a pressure-warning level.
   * 中文：增长提醒为 0；压力警告为 1..N 级。
   */
  readonly level: number
  /**
   * Token growth since the last reminder, for a normal reminder.
   * 中文：普通提醒对应的“距上次提醒增长” token 数。
   */
  readonly growth: number | null
}

/**
 * Selector result: the plan (if any) plus the level/baseline to store.
 * 中文：selector 结果：提醒计划（可能为空），以及要保存的级别/基线。
 */
export interface ReminderDecision {
  readonly plan: ReminderPlan | null
  /**
   * Warning level after this check; store it even when no reminder fires (re-arms on a drop).
   * 中文：本次检查后的警告级别；即使没有触发提醒也要保存（压力下降后重新武装）。
   */
  readonly level: number
  /**
   * True when the caller must record `tokens` as the growth baseline without reminding.
   * 中文：调用方必须把 `tokens` 记为增长基线、但不发提醒时为 true。
   */
  readonly baseline: boolean
}

/**
 * Choose the next reminder: one normal reminder per `growthTokens` of growth,
 * and one warning per pressure threshold crossed upward.
 *
 * Warnings take precedence over growth reminders and ignore the turn cooldown;
 * a level that was already announced stays silent until pressure drops back
 * below it and is crossed again.
 *
 * 中文：选择下一条提醒：每增长 `growthTokens` 发一条普通提醒，每向上越过一档压力
 * 阈值发一条警告。
 * 警告优先于增长提醒，且忽略回合冷却；已经播报过的级别保持沉默，直到压力降回该级别
 * 以下并再次越过。
 *
 * @param state - current pressure and the last reminder state.
 * 中文：当前压力和上次提醒状态。
 * @param policy - growth step, warning ratios, and normal-reminder cooldown.
 * 中文：增长步长、警告比例和普通提醒冷却。
 * @returns the plan, the level to store, and whether to set a silent baseline.
 * 中文：返回提醒计划、要保存的级别，以及是否设置静默基线。
 */
export function decideReminder(state: ReminderState, policy: ReminderPolicy): ReminderDecision {
  const ratio = state.window > 0 ? state.tokens / state.window : 0
  const level = warningLevel(ratio, policy.warnRatios)
  if (level > state.lastLevel) {
    return { plan: { kind: 'warning', level, growth: null }, level, baseline: false }
  }
  // A compression lowers the surface below the last reminder: measure growth
  // from the new level instead of the stale pre-compression baseline.
  // 中文：压缩会把 surface 降到上次提醒以下：从新水平重新测量增长，不要用压缩前的
  // 过期基线。
  if (state.tokens < state.lastTokens) return { plan: null, level, baseline: true }
  if (level < state.lastLevel) return { plan: null, level, baseline: false }
  if (level > 0) return { plan: null, level, baseline: false }
  if (state.lastTokens === 0) return { plan: null, level: 0, baseline: true }
  const growth = state.tokens - state.lastTokens
  if (growth < policy.growthTokens) return { plan: null, level: 0, baseline: false }
  if (state.lastReminderTurn !== null && state.openTurn !== null
    && state.openTurn - state.lastReminderTurn < policy.cooldownTurns) {
    return { plan: null, level: 0, baseline: false }
  }
  return { plan: { kind: 'normal', level: 0, growth }, level: 0, baseline: false }
}

/**
 * Inputs of one reminder text.
 * 中文：一条提醒文本的输入。
 */
export interface ReminderInput {
  readonly kind: 'normal' | 'warning'
  readonly level: number
  /**
   * Number of configured warning levels (the last one is critical).
   * 中文：已配置的警告级别数（最后一级为 critical）。
   */
  readonly levels: number
  readonly tokens: number
  readonly window: number
  readonly ratio: number
  /**
   * Token growth since the last reminder, for a normal reminder.
   * 中文：普通提醒对应的“距上次提醒增长” token 数。
   */
  readonly growth: number | null
  readonly firstPosition: number | null
  readonly endPosition: number | null
}

/**
 * One reminder text: normal growth note, graded warning, or critical warning.
 * 中文：一条提醒文本：普通增长提示、分级警告或 critical 警告。
 */
export function reminderText(input: ReminderInput): string {
  const ratio = `${Math.round(input.ratio * 100)}%`
  const pressure = `${formatTokens(input.tokens)}/${formatTokens(input.window)}`
  const example = input.firstPosition !== null
    ? `compress({spans:[{from:"⟦p${input.firstPosition}⟧", to:${input.endPosition === null ? '"end"' : `"⟦p${input.endPosition}⟧"`}, summary:"..."}]})`
    : 'compress({spans:[{from, to, summary}]})'
  const tail = 'from/to are anchor texts copied from the visible ⟦pN⟧ prefixes (for example "⟦p12⟧"); '
    + '"end" means the end of compressible history. Multiple non-overlapping spans use the same syntax in one call. '
    + 'The current turn is protected; summaries are lossy — keep anything that must survive inside the summary.'
  if (input.kind === 'normal') {
    const growth = input.growth === null ? 'enough' : `~${formatTokens(input.growth)} tokens`
    return `Context grew by ${growth} since the last reminder (${pressure}, ${ratio}). `
      + `When convenient, compress fully consumed history: ${example}. ${tail}`
  }
  if (input.level >= input.levels) {
    return `CRITICAL: context pressure is ${ratio} (${pressure}). The next request may exceed the window. `
      + `Compress fully consumed history immediately: ${example}. ${tail}`
  }
  if (input.level === 1) {
    return `Context pressure is ${ratio} (${pressure}) — warning 1/${input.levels}. `
      + `Consider compressing fully consumed history at the next natural break: ${example}. ${tail}`
  }
  return `Context pressure is ${ratio} (${pressure}) — warning ${input.level}/${input.levels}. `
    + `Plan to compress fully consumed history soon: ${example}. ${tail}`
}

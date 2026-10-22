/**
 * Plugin configuration: deployment-varying choices only.
 *
 * Every field is validated and unknown keys fail loud, matching the harness
 * rule that plugins expose their tunables through configuration instead of
 * hidden constants. Protocol-shaped values (position syntax, event types) are
 * fixed and deliberately not configurable.
 *
 * 中文：插件配置：只放随部署变化的选择。
 * 每个字段都校验，未知 key 响亮失败，符合宿主规则：插件通过配置暴露可调项，而不是
 * 藏常量。协议形态的值（位置语法、事件类型）固定，故意不可配置。
 */

/**
 * Resolved plugin configuration.
 * 中文：已解析的插件配置。
 */
export interface ResolvedConfig {
  readonly enabled: boolean
  /**
   * Fixed window used for pressure when neither config nor the route supplies one.
   * 中文：配置和路由都没有提供窗口时用于压力的固定窗口。
   */
  readonly contextWindowTokens: number | null
  /**
   * Output tokens reserved from the window; null reads `request/header.config.maxTokens`.
   * 中文：从窗口预留的输出 token；null 表示读取 `request/header.config.maxTokens`。
   */
  readonly reservedOutputTokens: number | null
  readonly defaultContextWindowTokens: number
  /**
   * Normal reminder after this much token growth since the last reminder.
   * 中文：距上次提醒增长这么多 token 后发普通提醒。
   */
  readonly growthTokens: number
  /**
   * Growth step while at the highest warning level; kept shorter so critical
   * pressure repeats before the window runs out.
   * 中文：最高警告级别使用的增长步长；保持更短，避免 critical 后长时间静默。
   */
  readonly criticalGrowthTokens: number
  /**
   * Ascending pressure ratios; the reminder level follows the current band.
   * 中文：升序压力比例；提醒级别跟随当前所在档位。
   */
  readonly warnRatios: readonly number[]
  /**
   * Minimum turns between normal growth reminders; warnings are never delayed.
   * 中文：普通增长提醒之间的最小回合数；警告从不延迟。
   */
  readonly reminderCooldownTurns: number
  readonly maxSpansPerCall: number
  readonly minSummaryChars: number
  readonly maxSummaryChars: number
  /**
   * Reject a fold whose first-request miss exceeds this estimate; null disables the guard.
   * 中文：首次请求 miss 超过该估算时拒绝折叠；null 关闭该保护。
   */
  readonly maxMissTokens: number | null
  /**
   * Reject a fold whose estimated payback requests exceed this; null disables the guard.
   * 中文：估算回本请求数超过该值时拒绝折叠；null 关闭该保护。
   */
  readonly maxPaybackRequests: number | null
  /**
   * Write one request-level audit line per decorated request (human audit sidecar).
   * 中文：每个已装饰请求写一行请求级审计（人类审计 sidecar）。
   */
  readonly audit: boolean
  readonly debug: boolean
}

const DEFAULTS: ResolvedConfig = {
  enabled: true,
  contextWindowTokens: null,
  reservedOutputTokens: null,
  defaultContextWindowTokens: 200_000,
  growthTokens: 20_000,
  criticalGrowthTokens: 10_000,
  warnRatios: [0.70, 0.81, 0.95],
  reminderCooldownTurns: 1,
  maxSpansPerCall: 8,
  minSummaryChars: 20,
  maxSummaryChars: 8_000,
  maxMissTokens: null,
  maxPaybackRequests: null,
  audit: false,
  debug: false,
}

/**
 * Validate and resolve raw loader configuration.
 * 中文：校验并解析 loader 原始配置。
 */
export function resolveConfig(input: unknown): ResolvedConfig {
  if (input === undefined || input === null) return DEFAULTS
  if (typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('context-decay: config must be an object')
  }
  const raw = input as Record<string, unknown>
  for (const key of Object.keys(raw)) {
    if (!(key in DEFAULTS)) throw new TypeError(`context-decay: unknown config key "${key}"`)
  }
  const integer = (key: keyof ResolvedConfig, minimum: number): number => {
    const value = raw[key as string]
    if (value === undefined) return DEFAULTS[key] as number
    if (!Number.isSafeInteger(value) || (value as number) < minimum) {
      throw new TypeError(`context-decay: ${key} must be an integer >= ${minimum}`)
    }
    return value as number
  }
  const boolean = (key: keyof ResolvedConfig): boolean => {
    const value = raw[key as string]
    if (value === undefined) return DEFAULTS[key] as boolean
    if (typeof value !== 'boolean') throw new TypeError(`context-decay: ${key} must be a boolean`)
    return value
  }
  const contextWindow = raw['contextWindowTokens']
  if (contextWindow !== undefined && contextWindow !== null
    && (!Number.isSafeInteger(contextWindow) || (contextWindow as number) <= 0)) {
    throw new TypeError('context-decay: contextWindowTokens must be null or a positive integer')
  }
  const reservedOutput = raw['reservedOutputTokens']
  if (reservedOutput !== undefined && reservedOutput !== null
    && (!Number.isSafeInteger(reservedOutput) || (reservedOutput as number) <= 0)) {
    throw new TypeError('context-decay: reservedOutputTokens must be null or a positive integer')
  }
  const warnRatios = (): number[] => {
    const value = raw['warnRatios']
    if (value === undefined) return [...DEFAULTS.warnRatios]
    if (!Array.isArray(value) || value.length === 0) {
      throw new TypeError('context-decay: warnRatios must be a non-empty array of ascending ratios')
    }
    if (value.length > 5) throw new TypeError('context-decay: warnRatios supports at most 5 levels')
    const ratios: number[] = []
    for (const [index, entry] of value.entries()) {
      if (typeof entry !== 'number' || !Number.isFinite(entry) || entry <= 0 || entry > 1) {
        throw new TypeError(`context-decay: warnRatios[${index}] must be a number in (0, 1]`)
      }
      const previous = ratios[ratios.length - 1]
      if (previous !== undefined && entry <= previous) {
        throw new TypeError('context-decay: warnRatios must be strictly ascending')
      }
      ratios.push(entry)
    }
    return ratios
  }
  const optionalLimit = (key: 'maxMissTokens' | 'maxPaybackRequests'): number | null => {
    const value = raw[key]
    if (value === undefined || value === null) return null
    if (!Number.isSafeInteger(value) || (value as number) < 1) {
      throw new TypeError(`context-decay: ${key} must be null or a positive integer`)
    }
    return value as number
  }
  const config: ResolvedConfig = {
    enabled: boolean('enabled'),
    contextWindowTokens: contextWindow === null || contextWindow === undefined ? null : contextWindow as number,
    reservedOutputTokens: reservedOutput === null || reservedOutput === undefined ? null : reservedOutput as number,
    defaultContextWindowTokens: integer('defaultContextWindowTokens', 1024),
    growthTokens: integer('growthTokens', 1),
    criticalGrowthTokens: integer('criticalGrowthTokens', 1),
    warnRatios: warnRatios(),
    reminderCooldownTurns: integer('reminderCooldownTurns', 1),
    maxSpansPerCall: integer('maxSpansPerCall', 1),
    minSummaryChars: integer('minSummaryChars', 1),
    maxSummaryChars: integer('maxSummaryChars', 16),
    maxMissTokens: optionalLimit('maxMissTokens'),
    maxPaybackRequests: optionalLimit('maxPaybackRequests'),
    audit: boolean('audit'),
    debug: boolean('debug'),
  }
  if (config.minSummaryChars > config.maxSummaryChars) {
    throw new TypeError('context-decay: minSummaryChars must not exceed maxSummaryChars')
  }
  return config
}

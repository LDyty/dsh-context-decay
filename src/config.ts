/**
 * Plugin configuration: deployment-varying choices only.
 *
 * Every field is validated and unknown keys fail loud, matching the harness
 * rule that plugins expose their tunables through configuration instead of
 * hidden constants. Protocol-shaped values (anchor syntax, event types) are
 * fixed and deliberately not configurable.
 *
 * 中文：插件配置：只放随部署变化的选择。
 * 每个字段都校验，未知 key 响亮失败，符合宿主规则：插件通过配置暴露可调项，而不是
 * 藏常量。协议形态的值（锚点语法、事件类型）固定，故意不可配置。
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
    throw new TypeError('context-decay：config 必须是对象')
  }
  const raw = input as Record<string, unknown>
  for (const key of Object.keys(raw)) {
    if (!(key in DEFAULTS)) throw new TypeError(`context-decay：未知配置 key "${key}"`)
  }
  const integer = (key: keyof ResolvedConfig, minimum: number): number => {
    const value = raw[key as string]
    if (value === undefined) return DEFAULTS[key] as number
    if (!Number.isSafeInteger(value) || (value as number) < minimum) {
      throw new TypeError(`context-decay：${key} 必须是 >= ${minimum} 的整数`)
    }
    return value as number
  }
  const boolean = (key: keyof ResolvedConfig): boolean => {
    const value = raw[key as string]
    if (value === undefined) return DEFAULTS[key] as boolean
    if (typeof value !== 'boolean') throw new TypeError(`context-decay：${key} 必须是布尔值`)
    return value
  }
  const contextWindow = raw['contextWindowTokens']
  if (contextWindow !== undefined && contextWindow !== null
    && (!Number.isSafeInteger(contextWindow) || (contextWindow as number) <= 0)) {
    throw new TypeError('context-decay：contextWindowTokens 必须是 null 或正整数')
  }
  const reservedOutput = raw['reservedOutputTokens']
  if (reservedOutput !== undefined && reservedOutput !== null
    && (!Number.isSafeInteger(reservedOutput) || (reservedOutput as number) <= 0)) {
    throw new TypeError('context-decay：reservedOutputTokens 必须是 null 或正整数')
  }
  const optionalLimit = (key: 'maxMissTokens' | 'maxPaybackRequests'): number | null => {
    const value = raw[key]
    if (value === undefined || value === null) return null
    if (!Number.isSafeInteger(value) || (value as number) < 1) {
      throw new TypeError(`context-decay：${key} 必须是 null 或正整数`)
    }
    return value as number
  }
  const config: ResolvedConfig = {
    enabled: boolean('enabled'),
    contextWindowTokens: contextWindow === null || contextWindow === undefined ? null : contextWindow as number,
    reservedOutputTokens: reservedOutput === null || reservedOutput === undefined ? null : reservedOutput as number,
    defaultContextWindowTokens: integer('defaultContextWindowTokens', 1024),
    minSummaryChars: integer('minSummaryChars', 1),
    maxSummaryChars: integer('maxSummaryChars', 16),
    maxMissTokens: optionalLimit('maxMissTokens'),
    maxPaybackRequests: optionalLimit('maxPaybackRequests'),
    audit: boolean('audit'),
    debug: boolean('debug'),
  }
  if (config.minSummaryChars > config.maxSummaryChars) {
    throw new TypeError('context-decay：minSummaryChars 不能大于 maxSummaryChars')
  }
  return config
}

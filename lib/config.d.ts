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
    readonly enabled: boolean;
    /**
     * Fixed window used for pressure when neither config nor the route supplies one.
     * 中文：配置和路由都没有提供窗口时用于压力的固定窗口。
     */
    readonly contextWindowTokens: number | null;
    /**
     * Output tokens reserved from the window; null reads `request/header.config.maxTokens`.
     * 中文：从窗口预留的输出 token；null 表示读取 `request/header.config.maxTokens`。
     */
    readonly reservedOutputTokens: number | null;
    readonly defaultContextWindowTokens: number;
    /**
     * Normal reminder after this much token growth since the last reminder.
     * 中文：距上次提醒增长这么多 token 后发普通提醒。
     */
    readonly growthTokens: number;
    /**
     * Ascending pressure ratios; each crossed level warns once (e.g. 0.70/0.81/0.95).
     * 中文：升序压力比例；每越过一档警告一次（例如 0.70/0.81/0.95）。
     */
    readonly warnRatios: readonly number[];
    /**
     * Minimum turns between normal growth reminders; warnings are never delayed.
     * 中文：普通增长提醒之间的最小回合数；警告从不延迟。
     */
    readonly reminderCooldownTurns: number;
    readonly maxSpansPerCall: number;
    readonly minSummaryChars: number;
    readonly maxSummaryChars: number;
    /**
     * Reject a fold whose first-request miss exceeds this estimate; null disables the guard.
     * 中文：首次请求 miss 超过该估算时拒绝折叠；null 关闭该保护。
     */
    readonly maxMissTokens: number | null;
    /**
     * Reject a fold whose estimated payback requests exceed this; null disables the guard.
     * 中文：估算回本请求数超过该值时拒绝折叠；null 关闭该保护。
     */
    readonly maxPaybackRequests: number | null;
    /**
     * Write one request-level audit line per decorated request (human audit sidecar).
     * 中文：每个已装饰请求写一行请求级审计（人类审计 sidecar）。
     */
    readonly audit: boolean;
    readonly debug: boolean;
}
/**
 * Validate and resolve raw loader configuration.
 * 中文：校验并解析 loader 原始配置。
 */
export declare function resolveConfig(input: unknown): ResolvedConfig;

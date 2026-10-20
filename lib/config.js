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
const DEFAULTS = {
    enabled: true,
    contextWindowTokens: null,
    reservedOutputTokens: null,
    defaultContextWindowTokens: 200_000,
    growthTokens: 20_000,
    warnRatios: [0.70, 0.81, 0.95],
    reminderCooldownTurns: 1,
    maxSpansPerCall: 8,
    minSummaryChars: 20,
    maxSummaryChars: 8_000,
    maxMissTokens: null,
    maxPaybackRequests: null,
    audit: false,
    debug: false,
};
/**
 * Validate and resolve raw loader configuration.
 * 中文：校验并解析 loader 原始配置。
 */
export function resolveConfig(input) {
    if (input === undefined || input === null)
        return DEFAULTS;
    if (typeof input !== 'object' || Array.isArray(input)) {
        throw new TypeError('context-decay: config must be an object');
    }
    const raw = input;
    for (const key of Object.keys(raw)) {
        if (!(key in DEFAULTS))
            throw new TypeError(`context-decay: unknown config key "${key}"`);
    }
    const integer = (key, minimum) => {
        const value = raw[key];
        if (value === undefined)
            return DEFAULTS[key];
        if (!Number.isSafeInteger(value) || value < minimum) {
            throw new TypeError(`context-decay: ${key} must be an integer >= ${minimum}`);
        }
        return value;
    };
    const boolean = (key) => {
        const value = raw[key];
        if (value === undefined)
            return DEFAULTS[key];
        if (typeof value !== 'boolean')
            throw new TypeError(`context-decay: ${key} must be a boolean`);
        return value;
    };
    const contextWindow = raw['contextWindowTokens'];
    if (contextWindow !== undefined && contextWindow !== null
        && (!Number.isSafeInteger(contextWindow) || contextWindow <= 0)) {
        throw new TypeError('context-decay: contextWindowTokens must be null or a positive integer');
    }
    const reservedOutput = raw['reservedOutputTokens'];
    if (reservedOutput !== undefined && reservedOutput !== null
        && (!Number.isSafeInteger(reservedOutput) || reservedOutput <= 0)) {
        throw new TypeError('context-decay: reservedOutputTokens must be null or a positive integer');
    }
    const warnRatios = () => {
        const value = raw['warnRatios'];
        if (value === undefined)
            return [...DEFAULTS.warnRatios];
        if (!Array.isArray(value) || value.length === 0) {
            throw new TypeError('context-decay: warnRatios must be a non-empty array of ascending ratios');
        }
        if (value.length > 5)
            throw new TypeError('context-decay: warnRatios supports at most 5 levels');
        const ratios = [];
        for (const [index, entry] of value.entries()) {
            if (typeof entry !== 'number' || !Number.isFinite(entry) || entry <= 0 || entry > 1) {
                throw new TypeError(`context-decay: warnRatios[${index}] must be a number in (0, 1]`);
            }
            const previous = ratios[ratios.length - 1];
            if (previous !== undefined && entry <= previous) {
                throw new TypeError('context-decay: warnRatios must be strictly ascending');
            }
            ratios.push(entry);
        }
        return ratios;
    };
    const optionalLimit = (key) => {
        const value = raw[key];
        if (value === undefined || value === null)
            return null;
        if (!Number.isSafeInteger(value) || value < 1) {
            throw new TypeError(`context-decay: ${key} must be null or a positive integer`);
        }
        return value;
    };
    const config = {
        enabled: boolean('enabled'),
        contextWindowTokens: contextWindow === null || contextWindow === undefined ? null : contextWindow,
        reservedOutputTokens: reservedOutput === null || reservedOutput === undefined ? null : reservedOutput,
        defaultContextWindowTokens: integer('defaultContextWindowTokens', 1024),
        growthTokens: integer('growthTokens', 1),
        warnRatios: warnRatios(),
        reminderCooldownTurns: integer('reminderCooldownTurns', 1),
        maxSpansPerCall: integer('maxSpansPerCall', 1),
        minSummaryChars: integer('minSummaryChars', 1),
        maxSummaryChars: integer('maxSummaryChars', 16),
        maxMissTokens: optionalLimit('maxMissTokens'),
        maxPaybackRequests: optionalLimit('maxPaybackRequests'),
        audit: boolean('audit'),
        debug: boolean('debug'),
    };
    if (config.minSummaryChars > config.maxSummaryChars) {
        throw new TypeError('context-decay: minSummaryChars must not exceed maxSummaryChars');
    }
    return config;
}

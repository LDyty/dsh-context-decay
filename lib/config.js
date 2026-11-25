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
const DEFAULTS = {
    enabled: true,
    contextWindowTokens: null,
    reservedOutputTokens: null,
    defaultContextWindowTokens: 200_000,
    minSummaryChars: 20,
    maxSummaryChars: 10_000,
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
        throw new TypeError('context-decay：config 必须是对象');
    }
    const raw = input;
    for (const key of Object.keys(raw)) {
        if (!(key in DEFAULTS))
            throw new TypeError(`context-decay：未知配置 key "${key}"`);
    }
    const integer = (key, minimum) => {
        const value = raw[key];
        if (value === undefined)
            return DEFAULTS[key];
        if (!Number.isSafeInteger(value) || value < minimum) {
            throw new TypeError(`context-decay：${key} 必须是 >= ${minimum} 的整数`);
        }
        return value;
    };
    const boolean = (key) => {
        const value = raw[key];
        if (value === undefined)
            return DEFAULTS[key];
        if (typeof value !== 'boolean')
            throw new TypeError(`context-decay：${key} 必须是布尔值`);
        return value;
    };
    const contextWindow = raw['contextWindowTokens'];
    if (contextWindow !== undefined && contextWindow !== null
        && (!Number.isSafeInteger(contextWindow) || contextWindow <= 0)) {
        throw new TypeError('context-decay：contextWindowTokens 必须是 null 或正整数');
    }
    const reservedOutput = raw['reservedOutputTokens'];
    if (reservedOutput !== undefined && reservedOutput !== null
        && (!Number.isSafeInteger(reservedOutput) || reservedOutput <= 0)) {
        throw new TypeError('context-decay：reservedOutputTokens 必须是 null 或正整数');
    }
    const optionalLimit = (key) => {
        const value = raw[key];
        if (value === undefined || value === null)
            return null;
        if (!Number.isSafeInteger(value) || value < 1) {
            throw new TypeError(`context-decay：${key} 必须是 null 或正整数`);
        }
        return value;
    };
    const config = {
        enabled: boolean('enabled'),
        contextWindowTokens: contextWindow === null || contextWindow === undefined ? null : contextWindow,
        reservedOutputTokens: reservedOutput === null || reservedOutput === undefined ? null : reservedOutput,
        defaultContextWindowTokens: integer('defaultContextWindowTokens', 1024),
        minSummaryChars: integer('minSummaryChars', 1),
        maxSummaryChars: integer('maxSummaryChars', 16),
        maxMissTokens: optionalLimit('maxMissTokens'),
        maxPaybackRequests: optionalLimit('maxPaybackRequests'),
        audit: boolean('audit'),
        debug: boolean('debug'),
    };
    if (config.minSummaryChars > config.maxSummaryChars) {
        throw new TypeError('context-decay：minSummaryChars 不能大于 maxSummaryChars');
    }
    return config;
}

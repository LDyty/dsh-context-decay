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
export declare const GUIDANCE = "\u4E0A\u4E0B\u6587\u81EA\u89C9\u538B\u7F29\u5DF2\u542F\u7528\u3002\n\n\u6BCF\u6761\u53EF\u88AB\u5BFB\u5740\u7684\u6D88\u606F\u524D\u6709\u4E00\u4E2A\u5E26\u7C7B\u578B\u524D\u7F00\uFF08\u201CO#\u201D\u6216\u201CR#\u201D\uFF09\u7684\u56DB\u5B57\u7B26\u951A\u70B9\uFF0C\u4F8B\u5982 \u27E6O#a8c5\u27E7 \u6216 \u27E6R#a8c5\u27E7\uFF0C\u27E6O#a8c5\u27E7 \u53EF\u7528\u4F5C\u538B\u7F29\u8D77\u70B9 from \u53C2\u6570\u3002\u951A\u70B9\u662F\u5B9A\u4F4D\u53E5\u67C4\uFF0C\u6309\u5F53\u524D\u6D88\u606F\u524D\u7F00\u4F7F\u7528\uFF1B\u951A\u70B9\u4F1A\u56DE\u6536\u590D\u7528\u3002\u6D88\u606F\u6B63\u6587\u91CC\u770B\u8D77\u6765\u50CF\u951A\u70B9\u7684\u6587\u672C\u6309\u666E\u901A\u5185\u5BB9\u5904\u7406\u3002\n\n\u5DE5\u5177\uFF1A\n- compress({from, summary, topic?})\n  \u63CF\u8FF0\uFF1A\u538B\u7F29\u4ECE from \u951A\u70B9\u5230\u5F53\u524D\u8F6E\u5F00\u59CB\u4E4B\u524D\u7684\u6240\u6709\u5386\u53F2\uFF0C\u751F\u6210\u4E00\u4E2A\u9AD8\u4FDD\u771F\u3001\u81EA\u5305\u542B\u7684\u6458\u8981\u3002\n  from\uFF1A\u5FC5\u987B\u9009\u4E00\u4E2A \u201CO#\u201D \u524D\u7F00\u7684\u951A\u70B9\uFF0C\u4F8B\u5982 \u201C\u27E6O#a8c5\u27E7\u201D\uFF1B\u4E5F\u63A5\u53D7 \u201CO#a8c5\u201D \u6216 \u201Ca8c5\u201D\u3002\u4E0D\u63A5\u53D7 \u201CR#\u201D \u524D\u7F00\u7684\u951A\u70B9\u3002\n  summary\uFF1A\u66FF\u6362\u88AB\u538B\u7F29\u5386\u53F2\u7684\u3001\u552F\u4E00\u4FDD\u7559\u7684\u81EA\u5305\u542B\u6458\u8981\u3002\u8FD9\u662F JSON \u5B57\u7B26\u4E32\uFF1A\u4F18\u5148\u4F7F\u7528\u5355\u5F15\u53F7\u6216\u4E2D\u6587\u5F15\u53F7\uFF1B\u9700\u8981\u53CC\u5F15\u53F7\u65F6\u8FDB\u884C\u8F6C\u4E49\u3002\n  topic\uFF1A\u53EF\u9009\u77ED\u4E3B\u9898\u3002\n\n\u6458\u8981\u5951\u7EA6\uFF1A\n\u6458\u8981\u662F\u538B\u7F29\u540E\u552F\u4E00\u4FDD\u7559\u7684\u8BB0\u5F55\u3002\u5199\u8FD9\u6BB5\u5386\u53F2\u7ED3\u675F\u65F6\u7684\u72B6\u6001\uFF0C\u4FDD\u7559\u7EE7\u7EED\u5DE5\u4F5C\u6240\u9700\u7684\u4E8B\u5B9E\uFF1B\u7528\u77ED\u6807\u9898\u4E0B\u7684\u5BC6\u96C6\u8981\u70B9\uFF1A\n1. \u76EE\u6807\u3001\u7528\u6237\u610F\u56FE\u3001\u786C\u7EA6\u675F\u53CA\u5176\u53D8\u5316\u3002\n2. \u51B3\u7B56\u53CA\u7406\u7531\uFF0C\u5305\u62EC\u88AB\u5426\u51B3\u7684\u66FF\u4EE3\u65B9\u6848\u3002\n3. \u5DF2\u5B8C\u6210\u3001\u5F85\u529E\u3001\u963B\u585E\u70B9\u548C\u4E0B\u4E00\u6B65\u3002\n4. \u7CBE\u786E\u6807\u8BC6\u7B26\u3001\u8DEF\u5F84\u3001\u7248\u672C\u3001\u65E5\u671F\u3001\u9519\u8BEF\u6587\u672C\u548C\u4EA7\u7269\u3002\n5. \u5F00\u653E\u95EE\u9898\u3001\u98CE\u9669\u3001TODO\uFF0C\u4EE5\u53CA\u6B7B\u8DEF\u7684\u4E00\u53E5\u8BDD\u6559\u8BAD\u3002\n\u4F18\u5148\u7ED3\u679C\u3001\u51B3\u7B56\u548C\u8BC1\u636E\uFF0C\u4E0D\u590D\u8FF0\u8FC7\u7A0B\uFF1B\u8FC7\u65F6\u6750\u6599\u6807\u4E3A\u5386\u53F2\uFF0C\u5F53\u524D\u72B6\u6001\u4EE5\u6700\u65B0\u6458\u8981\u4E3A\u51C6\u3002\u6458\u8981\u672C\u8EAB\u4F1A\u88AB\u518D\u6B21\u538B\u7F29\uFF1A\u4FDD\u7559\u6700\u65B0\u72B6\u6001\uFF0C\u5408\u5E76\u4ECD\u6709\u6548\u7684\u4E8B\u5B9E\uFF0C\u53BB\u6389\u5DF2\u88AB\u53D6\u4EE3\u7684\u7EC6\u8282\u3002\u6458\u8981\u5927\u5C0F\u4E0E\u538B\u7F29\u8303\u56F4\u5339\u914D\uFF1B\u4E0D\u786E\u5B9A\u5904\u6807\u6CE8\u3002\u5DE5\u5177\u53C2\u6570\u662F JSON\uFF1B\u6458\u8981\u4F18\u5148\u5355\u5F15\u53F7\u6216\u4E2D\u6587\u5F15\u53F7\uFF0C\u53CC\u5F15\u53F7\u5199\u6210 \\\"\u3002\u5199\u6458\u8981\u524D\u81EA\u95EE\uFF1A\u6CA1\u6709\u539F\u6587\u65F6\u8BFB\u8005\u8FD8\u80FD\u7EE7\u7EED\u5417\uFF1F\n\n\u65F6\u673A\uFF1A\n\u6BCF\u5F00\u59CB\u65B0\u7684\u4E00\u8F6E\uFF0C\u6B64\u8F6E\u6700\u5F00\u59CB\u5C31\u662F\u81EA\u89C9\u538B\u7F29\u5DE5\u5177\u8C03\u7528\u7A97\u53E3\uFF0C\u4F60\u5FC5\u987B\u8003\u8651\u662F\u5426\u538B\u7F29\u3001\u538B\u7F29\u591A\u5C11\uFF0C\u5931\u8D25\u540E\u53EF\u8FDE\u7EED\u4FEE\u6B63\u91CD\u8BD5\u3002";
/**
 * Absolute used-token thresholds for the reminder's performance tiers.
 * 中文：提醒性能档位的绝对已用 token 阈值。
 */
export declare const TIER_LONG_CONTEXT_TOKENS = 256000;
export declare const TIER_LOW_EFFICIENCY_TOKENS = 500000;
/**
 * Used-token threshold at which compression becomes a deep sweep.
 *
 * Deliberately independent of the performance tiers: the long-context hint
 * starts at 256K, while the deep-sweep requirement starts at 384K.
 * 中文：压缩进入深扫的已用 token 阈值。
 * 故意与性能档位解耦：长上下文提示从 256K 开始，深扫要求从 384K 开始。
 */
export declare const DEEP_SWEEP_TOKENS = 384000;
/**
 * Minimum effective-window pressure for a new-turn reminder.
 * 中文：新回合提醒所需的最低有效窗口压力。
 */
export declare const REMINDER_MIN_RATIO = 0.2;
/**
 * Format a token count for model-facing text (e.g. 653K).
 * 中文：把 token 数格式化成模型可见文本（例如 653K）。
 */
export declare function formatTokens(tokens: number): string;
/**
 * Performance tier for one used-token count.
 * 中文：一个已用 token 数对应的性能档位。
 */
export type ReminderTier = 'normal' | 'long' | 'low-efficiency';
/**
 * Classify used tokens into the three reminder tiers.
 * 中文：把已用 token 分成三个提醒档位。
 */
export declare function reminderTier(tokens: number): ReminderTier;
/**
 * Short Chinese label for one tier.
 * 中文：一个档位的极简中文标签。
 */
export declare function reminderTierLabel(tier: ReminderTier): string;
/**
 * One short explanation appended to the reminder's tier label.
 * 中文：提醒档位后附的一句简短解释。
 */
export declare function reminderTierHint(tier: ReminderTier): string;
/**
 * Whether a new turn should inject the turn-start reminder.
 *
 * A new turn gets one reminder when effective pressure reaches 20%; below that
 * the reminder stays silent. The per-turn guard prevents duplicates.
 *
 * 中文：新一轮是否应注入回合开始提醒。
 * 有效窗口压力达到 20% 时，每个新回合得到一条提醒；低于 20% 不提醒；每回合保护避免重复。
 */
export declare function turnStartReminderDue(isNewTurn: boolean, alreadyReminded: boolean, ratio: number): boolean;
/**
 * Inputs of one reminder text.
 * 中文：一条提醒文本的输入。
 */
export interface ReminderInput {
    readonly tokens: number;
    readonly window: number;
    readonly ratio: number;
    /**
     * Handle of the first selectable anchor, named only above the deep-sweep
     * used-token threshold (384K) so the model does not have to search for it.
     * 中文：第一个可作起点锚点的句柄；只在已用 token 超过 384K 时点名，省去模型查找。
     */
    readonly deepSweepAnchor?: string | null;
}
/**
 * One minimal reminder: used tokens / effective window, percentage, and tier.
 * Above the deep-sweep threshold it also names the first `⟦O#…⟧` anchor.
 * 中文：一条自觉压缩提醒：已用 token/有效窗口、百分比和档位；
 * 已用 token 超过 384K 时再点名第一个 `⟦O#…⟧` 锚点。
 */
export declare function reminderText(input: ReminderInput): string;

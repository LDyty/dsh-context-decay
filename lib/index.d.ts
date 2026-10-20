/**
 * dsh-context-decay plugin entry.
 *
 * Provides the `modelMessageDecoration` service consumed by the local harness
 * patch, registers the compression tools, contributes the model-facing
 * guidance to the system prompt, injects at most one pressure reminder per
 * step, and feeds the sidebar panel the same pressure reading the reminder
 * uses (effective window = total capacity - output reservation).
 *
 * Default OFF at the profile level: nothing is inserted unless the profile
 * overlay mounts this plugin. When mounted, the overlay must also disable
 * `compaction-basic` (and the in-place surface rewriters) so two context
 * reducers never run at once.
 *
 * 中文：dsh-context-decay 插件入口。
 * 提供本地宿主补丁消费的 `modelMessageDecoration` 服务，注册压缩工具，向 system prompt
 * 贡献模型可见 guidance，每个 step 最多注入一条压力提醒，并把提醒使用的同一份压力读数
 * 提供给侧栏面板（有效窗口 = 总容量 - 输出预留）。
 * 在 profile 层默认关闭：除非 profile overlay 挂载本插件，否则不插入任何东西。挂载时，
 * overlay 还必须停用 `compaction-basic`（以及原地 surface 改写器），避免两个上下文缩减器
 * 同时运行。
 */
import type { PluginContextLike } from './types.js';
export declare const name = "context-decay";
export declare const inject: string[];
/**
 * Mount one context-decay instance.
 * 中文：挂载一个 context-decay 实例。
 */
export declare function apply(ctx: PluginContextLike, config: unknown): void;

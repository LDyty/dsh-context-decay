/**
 * Model-facing tools: compress, drop.
 *
 * Every tool validates against the replayed surface before writing anything, so
 * a rejected call leaves the Session unchanged and returns one actionable error
 * to the model. Writes reuse the harness's sanitized event vocabulary:
 * `compaction/summary` (shadow price + ledger) immediately followed by the
 * replacement `user/message`, and `compaction/prune` immediately followed by an
 * empty `developer/message` for a drop.
 *
 * 中文：模型可见工具：compress、drop。
 * 每个工具写任何东西之前都先对重放 surface 校验，因此被拒绝的调用不会改变 Session，
 * 只向模型返回一条可操作的错误。写入复用宿主已消毒的事件词汇：
 * `compaction/summary`（shadow price + ledger）后面紧跟 replacement `user/message`；
 * drop 则是 `compaction/prune` 后面紧跟空的 `developer/message`。
 */
import type { PluginContextLike, SessionLike } from './types.js';
import type { DecayState } from './state.js';
import type { ResolvedConfig } from './config.js';
import type { ReservationSource, WindowSource } from './window.js';
/**
 * Pressure facts shared by the reminder and the panel.
 * 中文：提醒和面板共享的压力事实。
 */
export interface PressureReading {
    readonly tokens: number;
    /**
     * Effective denominator: total window minus the output reservation.
     * 中文：有效分母：总窗口减去输出预留。
     */
    readonly window: number;
    readonly ratio: number;
    readonly totalWindow: number;
    readonly reservedOutput: number;
    readonly windowSource: WindowSource;
    readonly reservationSource: ReservationSource;
    /**
     * Where the token count came from: the patched meter, provider usage, or the local estimate.
     * 中文：token 数的来源：打过补丁的 meter、provider 用量，或本地估算。
     */
    readonly source: 'meter' | 'usage' | 'estimate';
}
/**
 * Runtime dependencies of the tool set.
 * 中文：工具集的运行时依赖。
 */
export interface ToolDeps {
    readonly config: ResolvedConfig;
    readonly stateOf: (session: SessionLike) => DecayState;
    readonly log: (line: string) => void;
}
/**
 * Register every context-decay tool on the global tool registry.
 * 中文：把 context-decay 的所有工具注册到全局 tool registry。
 */
export declare function registerTools(ctx: PluginContextLike, deps: ToolDeps): void;

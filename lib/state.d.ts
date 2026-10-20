/**
 * Deterministic replay of the Session surface into position anchors and summary
 * blocks.
 *
 * The presentation layer never stores positions in the session format: every
 * position here is a pure function of the committed surface operations
 * (append / replace). Positions are ids, not surface indices: an append takes
 * the lowest free id (released when a replacement stops referencing it), so
 * ids can reappear on newer messages. A position stays reserved while any live
 * node references it as a left anchor or as a summary block's right boundary
 * (shared boundaries are refcounted).
 *
 * 中文：把 Session surface 确定性重放成位置锚点和摘要块。
 * 展示层从不把位置写进 session 格式：这里每个位置都是已提交 surface 操作
 * （append / replace）的纯函数。位置是 id，不是 surface 下标：append 取最小的空闲 id
 * （replacement 不再引用它时释放），所以 id 可能重新出现在更新的消息上。任何 live
 * 节点把它当左锚点或摘要块右边界引用时，位置保持 reserved（共享边界按引用计数）。
 */
import type { ContentBlock, MessageLike, SessionEventLike, SessionLike } from './types.js';
/**
 * One derived message observed at replay time.
 * 中文：重放时观察到的一条派生消息。
 */
export interface ObservedMessage {
    readonly message: MessageLike;
    readonly source: Readonly<Record<string, unknown>>;
}
/**
 * One event that produced a derived message.
 * 中文：产生一条派生消息的事件。
 */
export declare function observedMessageOf(event: SessionEventLike): ObservedMessage | null;
/**
 * Whether a message can carry a `⟦p12⟧` anchor without breaking durable replay metadata.
 * 中文：一条消息能否携带 `⟦p12⟧` 锚点而不破坏持久 replay 元数据。
 */
export declare function isAnchorable(message: MessageLike): boolean;
/**
 * One node of the replayed surface.
 * 中文：重放 surface 的一个节点。
 */
export interface NodeRecord {
    readonly seq: number;
    /**
     * Left anchor position, or null when the node is not model-addressable.
     * 中文：左锚点位置；节点不可被模型寻址时为 null。
     */
    readonly left: number | null;
    readonly messageId: string | null;
    readonly role: string | null;
    /**
     * Whether this node is a context-decay summary block.
     * 中文：这个节点是否是 context-decay 摘要块。
     */
    readonly block: boolean;
    /**
     * Exclusive right boundary of a block; null while the block reaches the end.
     * 中文：摘要块的排他右边界；摘要块一直延伸到末尾时为 null。
     */
    readonly right: number | null;
    readonly tier: number;
    readonly createdAtTurn: number | null;
    readonly tokens: number;
    readonly summaryChars: number;
    readonly topic: string | null;
    readonly toolCalls: number;
    readonly toolResult: boolean;
    /**
     * True when the event appended a new surface node (never a replacement).
     * 中文：事件新增了 surface 节点（不是 replacement）时为 true。
     */
    readonly appended: boolean;
}
/**
 * Provider usage of the latest assistant message.
 * 中文：最新 assistant 消息的 provider 用量。
 */
export interface UsageSnapshot {
    readonly inputTokens: number;
    readonly cacheReadTokens: number;
    readonly cacheWriteTokens: number;
    readonly outputTokens: number;
}
/**
 * Replayed state for one Session.
 * 中文：一个 Session 的重放状态。
 */
export interface DecayState {
    /**
     * Owning session id when the state is used as a projection checkpoint.
     * Tool/decorator caches omit it; projection views use it to select runtime facts.
     * 中文：状态作为 projection checkpoint 时所属的 session id；工具/装饰缓存不填，
     * projection 视图靠它选择运行时事实。
     */
    readonly sessionId?: string;
    /**
     * Number of log events already folded.
     * 中文：已经折叠的日志事件数。
     */
    applied: number;
    /**
     * High-water mark: ids `0..nextPosition-1` have been allocated at least once.
     * 中文：高水位线：`0..nextPosition-1` 这些 id 至少被分配过一次。
     */
    nextPosition: number;
    /**
     * Released ids, ascending; the next append takes the first one.
     * 中文：已释放的 id，升序排列；下一次 append 取第一个。
     */
    free: number[];
    /**
     * Live references per position: left anchors and rendered right boundaries.
     * Plain JSON for projection checkpoints.
     * 中文：每个位置的 live 引用数：左锚点和渲染出的右边界。用普通 JSON 存储，供
     * projection checkpoint 使用。
     */
    refs: Record<number, number>;
    nodes: NodeRecord[];
    openTurn: number | null;
    step: number;
    /**
     * Seq of the latest `turn/start` event.
     * 中文：最新 `turn/start` 事件的 seq。
     */
    turnStartSeq: number;
    lastReminderTurn: number | null;
    lastReminderTokens: number;
    /**
     * Highest warning level already announced (0 = none); re-arms when pressure drops below it.
     * 中文：已经播报过的最高警告级别（0 = 无）；压力降到该级别以下时重新武装。
     */
    lastReminderLevel: number;
    usage: UsageSnapshot | null;
    blocksCreated: number;
    /**
     * Model responses (assistant/message events) seen in this session so far.
     * 中文：本会话到目前为止看到的模型回复数（assistant/message 事件）。
     */
    assistantRequests: number;
    /**
     * Number of appends that reused a released id (diagnostics only).
     * 中文：复用了已释放 id 的 append 次数（仅诊断用）。
     */
    reusedPositions: number;
}
/**
 * A fresh state before any event is folded.
 * 中文：尚未折叠任何事件时的初始状态。
 */
export declare function createState(sessionId?: string): DecayState;
/**
 * Heap-stable in-memory replay cache keyed by the live Session object.
 * 中文：以 live Session 对象为 key 的堆稳定内存重放缓存。
 */
export declare class StateCache {
    private readonly states;
    /**
     * Fold the session's committed tail into its cached state.
     * 中文：把 session 已提交的尾部事件折叠进缓存状态。
     */
    stateOf(session: SessionLike): DecayState;
}
/**
 * Fold the whole event array (tests and one-shot reconstruction).
 * 中文：折叠整个事件数组（测试和一次性重建用）。
 */
export declare function foldAll(events: readonly SessionEventLike[]): DecayState;
/**
 * Apply one committed event to the replay state in place.
 * 中文：把一个已提交事件原地应用到重放状态。
 */
export declare function foldEvent(state: DecayState, event: SessionEventLike): void;
/**
 * Estimate model-visible tokens of one message (mirrors the harness token meter's fixed heuristic).
 * 中文：估算一条消息的模型可见 token 数（复刻宿主 token meter 的固定启发式）。
 */
export declare function estimateMessageTokens(message: MessageLike): number;
/**
 * Estimate tokens of one content block (same fixed heuristic as the harness token meter).
 * 中文：估算一个 content 块的 token 数（与宿主 token meter 相同的固定启发式）。
 */
export declare function estimateBlockTokens(block: ContentBlock): number;
/**
 * Estimate tokens of plain text: ASCII prose ≈ 4 chars/token, other scripts ≈ 1 char/token.
 * 中文：估算纯文本 token 数：ASCII 文本约 4 字符/token，其他文字约 1 字符/token。
 */
export declare function estimateTextTokens(text: string): number;
/**
 * Narrow an unknown value to a plain JSON object.
 * 中文：把 unknown 收窄为普通 JSON 对象。
 */
export declare function isRecord(value: unknown): value is Record<string, unknown>;

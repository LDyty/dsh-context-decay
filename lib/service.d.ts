/**
 * `modelMessageDecoration` service: the request-message decoration registry the
 * local harness patch consumes.
 *
 * The service is intentionally owned by this plugin (the host patch only calls
 * an optional service). Registration order is decoration order; disposing a
 * registration removes it; a throwing decorator fails the request loudly.
 *
 * 中文：`modelMessageDecoration` 服务：本地宿主补丁消费的请求消息装饰注册表。
 * 这个服务有意由本插件拥有（宿主补丁只调用一个可选服务）。注册顺序就是装饰顺序；
 * dispose 注册会移除它；decorator 抛错会让请求响亮失败。
 */
import type { MessageLike, SessionLike } from './types.js';
import type { DecayState } from './state.js';
import type { AuditRecord } from './audit.js';
import type { Decoration } from './render.js';
/**
 * One decorator definition.
 * 中文：一个 decorator 定义。
 */
export interface MessageDecorator {
    /**
     * Stable identity recorded by callers for diagnostics.
     * 中文：调用方记录用于诊断的稳定身份。
     */
    readonly id: string;
    /**
     * Rule version; changing decoration rules must change it.
     * 中文：规则版本；改变装饰规则时必须同步修改。
     */
    readonly version: string;
    /**
     * Only conversation requests are decorated (the agent loop's request assembly).
     * 中文：只装饰会话请求（agent loop 的请求组装）。
     */
    readonly scope?: 'conversation';
    /**
     * Return prefix/suffix decorations aligned to `messages`.
     * 中文：返回与 `messages` 对齐的前缀/后缀装饰。
     * @param session - session whose surface produced the messages.
     * 中文：产生这些消息的 surface 所属 session。
     * @param messages - derived messages in request order.
     * 中文：按请求顺序排列的派生消息。
     * @returns one decoration (or undefined) per message, in the same order.
     * 中文：每条消息一个装饰（或 undefined），顺序一致。
     */
    decorate(session: SessionLike, messages: readonly MessageLike[]): readonly (Decoration | undefined)[];
}
/**
 * The service value provided as `modelMessageDecoration`.
 * 中文：作为 `modelMessageDecoration` 提供的服务值。
 */
export interface ModelMessageDecorationService {
    decorate(session: SessionLike, messages: readonly MessageLike[]): readonly MessageLike[];
    /**
     * Estimated request tokens the decoration adds; consumed by the patched token meter.
     * 中文：装饰给请求增加的估算 token 数；由打过补丁的 token meter 消费。
     */
    tokenOverhead(session: SessionLike): number;
    /**
     * Strip anchors the model copied into its own reply before the message is committed.
     * 中文：消息落盘前，剥掉模型复制进自己回复开头的锚点。
     */
    sanitizeAssistantMessage(session: SessionLike, message: MessageLike): MessageLike;
}
/**
 * Diagnostics sink used when `debug` is enabled.
 * 中文：启用 `debug` 时使用的诊断输出。
 */
export type DecorationLog = (line: string) => void;
/**
 * Registry behind the provided service.
 * 中文：所提供服务背后的注册表。
 */
export declare class DecorationRegistry {
    private readonly stateOf;
    private readonly log;
    private readonly audit?;
    private readonly decorators;
    /**
     * 1-based decorated-request counter per live session object.
     * 中文：每个 live session 对象从 1 开始的已装饰请求计数。
     */
    private readonly requestCounts;
    constructor(stateOf: (session: SessionLike) => DecayState, log: DecorationLog | undefined, audit?: ((record: AuditRecord) => void) | undefined);
    /**
     * Register one decorator; the returned disposer removes it.
     * 中文：注册一个 decorator；返回的 disposer 会移除它。
     */
    register(decorator: MessageDecorator): () => void;
    /**
     * Registered decorator identities, for diagnostics and audit.
     * 中文：已注册 decorator 的身份，用于诊断和审计。
     */
    identities(): {
        id: string;
        version: string;
    }[];
    /**
     * Estimated tokens this registry's decoration adds to one request.
     * 中文：本注册表的装饰给一次请求增加的估算 token 数。
     * @param session - session whose replayed anchors are priced.
     * 中文：要为其重放锚点计价的 session。
     * @returns the anchor prefix/suffix text price under the fixed heuristic.
     * 中文：固定启发式下锚点前缀/后缀文本的价格。
     */
    overhead(session: SessionLike): number;
    /**
     * Strip a leading run of anchors the model copied into an assistant reply.
     * 中文：剥掉模型复制进 assistant 回复开头的一串锚点。
     */
    sanitizeAssistantMessage(_session: SessionLike, message: MessageLike): MessageLike;
    /**
   * Decorate one model request; throws when a decoration cannot be rebuilt.
   * 中文：装饰一次模型请求；装饰无法重建时抛错。
   */
    decorate(session: SessionLike, messages: readonly MessageLike[]): readonly MessageLike[];
    /**
     * Record one request-level audit line; diagnostics never fail the request.
     * 中文：记录一条请求级审计行；诊断永远不让请求失败。
     */
    private writeAudit;
}

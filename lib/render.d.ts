/**
 * Presentation of positions on model-visible messages.
 *
 * Every model-addressable message is preceded by `⟦p12⟧ `. A summary
 * block is preceded by its left marker and, only while no visible node owns its
 * right boundary, followed by the right marker. Rendering never mutates durable
 * content: it copies the one text block it decorates.
 *
 * Copied leading anchors on assistant replies are stripped at this request
 * boundary before the real prefix is added.
 *
 * Wrapping rule (load-bearing): assistant replay metadata is index-aligned per
 * content block, so an assistant message is decorated ONLY by rewriting an
 * existing text block. If it has none (tool-call-only turn), it stays
 * unanchored rather than risking a native thinking-signature mismatch.
 *
 * 中文：模型可见消息的位置展示。
 * 每条可寻址消息前加 `⟦p12⟧ `；摘要块加左标记，只有在没有可见节点负责右边界时
 * 才加右标记。渲染不改写持久内容，只复制它装饰的那一个 text 块。
 * assistant 回复开头复制的锚点会在请求边界先被剥离。
 * 包装规则（关键）：assistant 的 replay 元数据按 content 块索引对齐，所以 assistant
 * 消息只能通过改写已有 text 块来加锚点；没有 text 块（纯 tool-call 回合）就保持
 * 无锚点，避免原生 thinking 签名错位。
 */
import type { MessageLike } from './types.js';
import type { DecayState } from './state.js';
/**
 * Prefix/suffix text added around one message.
 * 中文：加到一条消息前后的前缀/后缀文本。
 */
export interface Decoration {
    readonly prefix?: string;
    readonly suffix?: string;
}
/**
 * Estimated request tokens added by the anchor prefix/suffix text (for the token-meter seam).
 * 中文：锚点前缀/后缀给请求增加的估算 token 数（供 token meter 使用）。
 */
export declare function decorationOverheadTokens(state: DecayState): number;
/**
 * Compute the anchor decoration of every message, aligned to the input array.
 * 中文：按输入数组顺序计算每条消息的锚点装饰。
 */
export declare function anchorDecorations(state: DecayState, messages: readonly MessageLike[]): Array<Decoration | undefined>;
/**
 * Apply one decoration to one message, preserving durable identity and replay metadata.
 * 中文：给一条消息应用装饰，同时保留持久身份和 replay 元数据。
 */
export declare function applyDecoration(message: MessageLike, decoration: Decoration | undefined): MessageLike;
/**
 * Concatenate decorations from multiple registered decorators in registration order.
 * 中文：按注册顺序拼接多个装饰器的前缀/后缀。
 */
export declare function mergeDecorations(left: Decoration | undefined, right: Decoration | undefined): Decoration | undefined;

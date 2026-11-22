/**
 * On-demand message content for the sidebar's anchor space.
 *
 * The projection carries one row per model-addressable message but never its
 * text: every event would otherwise push the whole conversation through the
 * wire and into the projection cache. Clicking a row instead asks this route for
 * that one message, addressed by the durable session id and the event seq the
 * row already shows.
 *
 * The route rides the host connection's exact Fetch channel, so authentication
 * is the channel's: only an owner Peer reaches it.
 *
 * 中文：侧栏锚点空间的按需消息内容。
 * projection 只为每条可寻址消息带一行元数据，从不带正文：否则每次事件都会把整段对话
 * 推过 wire 并写进 projection 缓存。点击某一行时，才用该行已有的持久 session id 和事件
 * seq 向这个路由要那一条消息。
 * 路由挂在宿主 connection 的精确 Fetch 通道上，认证由通道负责：只有 owner Peer 能到达。
 */
import type { HostFetchRouteLike, MessageLike, PluginContextLike, SessionLike } from './types.js';
/**
 * Exact path of the content route, below the shared `/api` channel.
 * 中文：内容路由在共享 `/api` 通道下的精确路径。
 */
export declare const CONTENT_PATH = "/api/context-decay.node";
/**
 * Hard cap on the text one response carries, in UTF-16 code units.
 * 中文：单次响应携带文本的硬上限（UTF-16 码元）。
 */
export declare const CONTENT_MAX_CHARS = 40000;
/**
 * Host facts the content route reads.
 * 中文：内容路由读取的宿主事实。
 */
export interface ContentRouteDeps {
    readonly sessionById: (sessionId: string) => SessionLike | undefined;
    /** Debug logger; the plugin passes its own when `config.debug` is on. */
    readonly log?: (line: string) => void;
}
/**
 * Render the model-visible text of one message.
 *
 * Text blocks carry the message; reasoning appears only when the message has no
 * text block; tool calls are summarized as one line each. Images and other
 * blocks contribute nothing, so the view stays plain text.
 * 中文：渲染一条消息的模型可见文本。
 * 正文来自 text 块；只有整条消息没有 text 块时才用 reasoning；tool call 每行一条摘要。
 * 图片与其他块不贡献文本，视图保持纯文本。
 *
 * @param message - one derived session message.
 * @param maxChars - inclusive cap on the rendered text.
 * @returns the rendered text and whether the cap cut it.
 */
export declare function nodeTextOf(message: MessageLike, maxChars?: number): {
    readonly text: string;
    readonly truncated: boolean;
};
/**
 * Build the exact Fetch route serving one node's content.
 * 中文：构造返回单个节点内容的精确 Fetch 路由。
 *
 * @param deps - session lookup by durable id.
 * @returns the route for `connection.fetch.register`.
 */
export declare function contentRoute(deps: ContentRouteDeps): HostFetchRouteLike;
/**
 * Register the content route on the host's authenticated `/api` channel.
 *
 * The connection service is an optional dependency: a headless composition has
 * no HTTP channel, and a web composition may not have registered it yet when
 * this plugin applies (plugin application order follows declared `inject`
 * services only). The registration therefore runs inside `ctx.inject(['connection'])`,
 * which activates once the service exists and stays pending otherwise.
 * 中文：在宿主已认证的 `/api` 通道上注册内容路由。
 * connection 是可选依赖：无头组合没有 HTTP 通道；Web 组合里插件 apply 时它也可能尚未
 * 就绪（插件应用顺序只跟随已声明的 `inject` 服务）。因此注册放在
 * `ctx.inject(['connection'])` 里，服务就绪后激活，否则保持 pending。
 *
 * @param ctx - plugin context; `inject` scopes the registration when available.
 * @param deps - session lookup by durable id, plus the debug logger.
 */
export declare function registerContentRoute(ctx: PluginContextLike, deps: ContentRouteDeps): void;

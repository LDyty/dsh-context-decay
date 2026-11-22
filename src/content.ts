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

import { observedMessageOf } from './state.js'
import type {
  HostConnectionLike,
  HostFetchRouteLike,
  MessageLike,
  PluginContextLike,
  SessionLike,
} from './types.js'

/**
 * Exact path of the content route, below the shared `/api` channel.
 * 中文：内容路由在共享 `/api` 通道下的精确路径。
 */
export const CONTENT_PATH = '/api/context-decay.node'

/**
 * Hard cap on the text one response carries, in UTF-16 code units.
 * 中文：单次响应携带文本的硬上限（UTF-16 码元）。
 */
export const CONTENT_MAX_CHARS = 40_000

/**
 * Host facts the content route reads.
 * 中文：内容路由读取的宿主事实。
 */
export interface ContentRouteDeps {
  readonly sessionById: (sessionId: string) => SessionLike | undefined
  /** Debug logger; the plugin passes its own when `config.debug` is on. */
  readonly log?: (line: string) => void
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
export function nodeTextOf(
  message: MessageLike,
  maxChars: number = CONTENT_MAX_CHARS,
): { readonly text: string; readonly truncated: boolean } {
  const textBlocks: string[] = []
  const reasoningBlocks: string[] = []
  const calls: string[] = []
  for (const block of message.content) {
    if (block.type === 'text' && typeof block.text === 'string' && block.text.length > 0) {
      textBlocks.push(block.text)
      continue
    }
    if (block.type === 'reasoning' && typeof block.text === 'string' && block.text.length > 0) {
      reasoningBlocks.push(block.text)
      continue
    }
    if (block.type === 'tool-call') {
      const tool = typeof block.name === 'string' && block.name.length > 0 ? block.name : 'tool'
      calls.push(`[tool] ${tool}`)
    }
  }
  const parts = textBlocks.length > 0 ? textBlocks : reasoningBlocks
  if (calls.length > 0) parts.push(calls.join('\n'))
  const full = parts.join('\n\n').trim()
  if (full.length <= maxChars) return { text: full, truncated: false }
  const cut = full.slice(0, maxChars)
  // Never leave a dangling high surrogate on the cut edge.
  // 中文：截断边缘不能留下孤立的高位代理项。
  const text = /[\uD800-\uDBFF]$/.test(cut) ? cut.slice(0, -1) : cut
  return { text, truncated: true }
}

/**
 * Build one JSON response with the headers a token-authenticated channel needs.
 * 中文：构造一条带认证通道所需头部的 JSON 响应。
 */
function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  })
}

/**
 * Build the exact Fetch route serving one node's content.
 * 中文：构造返回单个节点内容的精确 Fetch 路由。
 *
 * @param deps - session lookup by durable id.
 * @returns the route for `connection.fetch.register`.
 */
export function contentRoute(deps: ContentRouteDeps): HostFetchRouteLike {
  return {
    path: CONTENT_PATH,
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: async (request: Request): Promise<Response> => {
      const url = new URL(request.url)
      const sessionId = url.searchParams.get('session')
      const rawSeq = url.searchParams.get('seq')
      const seq = rawSeq === null ? Number.NaN : Number(rawSeq)
      const fail = (status: number, error: string): Response => {
        deps.log?.(`content route ${status}: ${error} (session ${String(sessionId)}, seq ${String(rawSeq)})`)
        return jsonResponse({ ok: false, error }, status)
      }
      if (sessionId === null || sessionId.length === 0 || !Number.isInteger(seq) || seq < 0) {
        return fail(400, 'bad-request')
      }
      const session = deps.sessionById(sessionId)
      if (session === undefined) return fail(404, 'session-not-found')
      const event = session.snapshotEvents()[seq]
      if (event === undefined || event.seq !== seq) return fail(404, 'event-not-found')
      const observed = observedMessageOf(event)
      if (observed === null) return fail(404, 'not-a-message')
      const rendered = nodeTextOf(observed.message)
      return jsonResponse({ ok: true, role: observed.message.role, ...rendered }, 200)
    },
  }
}

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
export function registerContentRoute(ctx: PluginContextLike, deps: ContentRouteDeps): void {
  const mount = (scope: PluginContextLike): void => {
    const connection = scope.get('connection') as HostConnectionLike | undefined
    const channel = connection?.fetch
    if (channel === undefined || typeof channel.register !== 'function') {
      deps.log?.('content route skipped: host connection has no fetch channel')
      return
    }
    scope.effect(() => {
      const dispose = channel.register(contentRoute(deps))
      deps.log?.(`content route mounted at ${CONTENT_PATH}`)
      return () => { void dispose() }
    }, 'context-decay: node content route')
  }
  if (typeof ctx.inject === 'function') ctx.inject(['connection'], mount)
  else mount(ctx)
}

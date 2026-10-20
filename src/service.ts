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

import type { MessageLike, SessionLike } from './types.js'
import type { DecayState } from './state.js'
import type { AuditRecord } from './audit.js'
import { applyDecoration, decorationOverheadTokens, mergeDecorations } from './render.js'
import type { Decoration } from './render.js'
import { parseAnchor, stripLeadingAnchors } from './anchor.js'

/**
 * One decorator definition.
 * 中文：一个 decorator 定义。
 */
export interface MessageDecorator {
  /**
   * Stable identity recorded by callers for diagnostics.
   * 中文：调用方记录用于诊断的稳定身份。
   */
  readonly id: string
  /**
   * Rule version; changing decoration rules must change it.
   * 中文：规则版本；改变装饰规则时必须同步修改。
   */
  readonly version: string
  /**
   * Only conversation requests are decorated (the agent loop's request assembly).
   * 中文：只装饰会话请求（agent loop 的请求组装）。
   */
  readonly scope?: 'conversation'
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
  decorate(session: SessionLike, messages: readonly MessageLike[]): readonly (Decoration | undefined)[]
}

/**
 * The service value provided as `modelMessageDecoration`.
 * 中文：作为 `modelMessageDecoration` 提供的服务值。
 */
export interface ModelMessageDecorationService {
  decorate(session: SessionLike, messages: readonly MessageLike[]): readonly MessageLike[]
  /**
   * Estimated request tokens the decoration adds; consumed by the patched token meter.
   * 中文：装饰给请求增加的估算 token 数；由打过补丁的 token meter 消费。
   */
  tokenOverhead(session: SessionLike): number
  /**
   * Strip anchors the model copied into its own reply before the message is committed.
   * 中文：消息落盘前，剥掉模型复制进自己回复开头的锚点。
   */
  sanitizeAssistantMessage(session: SessionLike, message: MessageLike): MessageLike
}

/**
 * Diagnostics sink used when `debug` is enabled.
 * 中文：启用 `debug` 时使用的诊断输出。
 */
export type DecorationLog = (line: string) => void

/**
 * Registry behind the provided service.
 * 中文：所提供服务背后的注册表。
 */
export class DecorationRegistry {
  private readonly decorators: MessageDecorator[] = []
  /**
   * 1-based decorated-request counter per live session object.
   * 中文：每个 live session 对象从 1 开始的已装饰请求计数。
   */
  private readonly requestCounts = new WeakMap<object, number>()

  constructor(
    private readonly stateOf: (session: SessionLike) => DecayState,
    private readonly log: DecorationLog | undefined,
    private readonly audit?: (record: AuditRecord) => void,
  ) {}

  /**
   * Register one decorator; the returned disposer removes it.
   * 中文：注册一个 decorator；返回的 disposer 会移除它。
   */
  register(decorator: MessageDecorator): () => void {
    this.decorators.push(decorator)
    return () => {
      const index = this.decorators.indexOf(decorator)
      if (index >= 0) this.decorators.splice(index, 1)
    }
  }

  /**
   * Registered decorator identities, for diagnostics and audit.
   * 中文：已注册 decorator 的身份，用于诊断和审计。
   */
  identities(): { id: string; version: string }[] {
    return this.decorators.map(decorator => ({ id: decorator.id, version: decorator.version }))
  }

  /**
   * Estimated tokens this registry's decoration adds to one request.
   * 中文：本注册表的装饰给一次请求增加的估算 token 数。
   * @param session - session whose replayed anchors are priced.
   * 中文：要为其重放锚点计价的 session。
   * @returns the anchor prefix/suffix text price under the fixed heuristic.
   * 中文：固定启发式下锚点前缀/后缀文本的价格。
   */
  overhead(session: SessionLike): number {
    return this.decorators.length === 0 ? 0 : decorationOverheadTokens(this.stateOf(session))
  }

  /**
   * Strip a leading run of anchors the model copied into an assistant reply.
   * 中文：剥掉模型复制进 assistant 回复开头的一串锚点。
   */
  sanitizeAssistantMessage(_session: SessionLike, message: MessageLike): MessageLike {
    if (this.decorators.length === 0 || message.role !== 'assistant') return message
    const index = message.content.findIndex(block => block.type === 'text')
    if (index < 0) return message
    const block = message.content[index]!
    const text = block.text ?? ''
    const cleaned = stripLeadingAnchors(text)
    if (cleaned === text) return message
    const content = [...message.content]
    content[index] = { ...block, text: cleaned }
    return { ...message, content }
  }

    /**
   * Decorate one model request; throws when a decoration cannot be rebuilt.
   * 中文：装饰一次模型请求；装饰无法重建时抛错。
   */
  decorate(session: SessionLike, messages: readonly MessageLike[]): readonly MessageLike[] {
    const state = this.stateOf(session)
    const active = [...this.decorators]
    if (active.length === 0) return messages
    const merged = new Array<Decoration | undefined>(messages.length).fill(undefined)
    for (const decorator of active) {
      const decorations = decorator.decorate(session, messages)
      if (decorations.length !== messages.length) {
        throw new Error(
          `context-decay: decorator "${decorator.id}" returned ${decorations.length} decorations `
          + `for ${messages.length} messages`,
        )
      }
      for (let index = 0; index < decorations.length; index += 1) {
        merged[index] = mergeDecorations(merged[index], decorations[index])
      }
    }
    let anchored = 0
    let first = ''
    let last = ''
    const decorated = messages.map((message, index) => {
      const decoration = merged[index]
      if (decoration?.prefix !== undefined) {
        anchored += 1
        const position = parseAnchor(decoration.prefix)
        if (position !== null) {
          if (first === '') first = String(position)
          last = String(position)
        }
      }
      return applyDecoration(message, decoration)
    })
    if (this.log !== undefined) {
      this.log(
        `decorated request: ${messages.length} messages, ${anchored} anchors, `
        + `first=#${first || '-'} last=#${last || '-'} `
        + `(${state.nextPosition} positions allocated, ${state.free.length} free, ${state.reusedPositions} reused)`,
      )
    }
    this.writeAudit(session, state, messages.length, anchored, first, last)
    return Object.freeze(decorated)
  }

  /**
   * Record one request-level audit line; diagnostics never fail the request.
   * 中文：记录一条请求级审计行；诊断永远不让请求失败。
   */
  private writeAudit(
    session: SessionLike,
    state: DecayState,
    messages: number,
    anchors: number,
    first: string,
    last: string,
  ): void {
    if (this.audit === undefined) return
    try {
      const requestIndex = (this.requestCounts.get(session) ?? 0) + 1
      this.requestCounts.set(session, requestIndex)
      this.audit({
        v: 1,
        time: new Date().toISOString(),
        sessionId: session.id,
        requestIndex,
        sessionRequest: state.assistantRequests + 1,
        messages,
        anchors,
        first: first === '' ? null : Number(first),
        last: last === '' ? null : Number(last),
        blocks: state.nodes
          .filter(node => node.block && node.left !== null)
          .map(node => ({ from: node.left as number, to: node.right, tier: node.tier })),
        overheadTokens: decorationOverheadTokens(state),
        decorators: this.identities(),
        scope: 'conversation',
      })
    } catch (error) {
      this.log?.(`audit skipped: ${String(error)}`)
    }
  }
}

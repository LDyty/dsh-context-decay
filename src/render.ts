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

import type { ContentBlock, MessageLike } from './types.js'
import { estimateTextTokens } from './state.js'
import type { DecayState } from './state.js'
import { formatAnchor, stripLeadingAnchors } from './anchor.js'

/**
 * Prefix/suffix text added around one message.
 * 中文：加到一条消息前后的前缀/后缀文本。
 */
export interface Decoration {
  readonly prefix?: string
  readonly suffix?: string
}

/**
 * Seqs of blocks whose right boundary must be rendered as their own suffix.
 * 中文：需要自己打印右边界后缀的摘要块 seq。
 */
function suffixRenderedSeqs(state: DecayState): Set<number> {
  const rendered = new Set<number>()
  for (let index = 0; index < state.nodes.length; index += 1) {
    const node = state.nodes[index]!
    if (!node.block || node.right === null) continue
    let nextLeft: number | null = null
    for (let cursor = index + 1; cursor < state.nodes.length; cursor += 1) {
      const left = state.nodes[cursor]!.left
      if (left !== null) {
        nextLeft = left
        break
      }
    }
    // The next anchor (if it owns this boundary) already prints the same position.
    // 中文：下一个锚点如果负责这个边界，已经会打印同一位置，不需要重复后缀。
    if (nextLeft !== node.right) rendered.add(node.seq)
  }
  return rendered
}

/**
 * Estimated request tokens added by the anchor prefix/suffix text (for the token-meter seam).
 * 中文：锚点前缀/后缀给请求增加的估算 token 数（供 token meter 使用）。
 */
export function decorationOverheadTokens(state: DecayState): number {
  const rendered = suffixRenderedSeqs(state)
  let tokens = 0
  for (const node of state.nodes) {
    if (node.left === null) continue
    tokens += estimateTextTokens(`${formatAnchor(node.left)} `)
    if (node.block && node.right !== null && rendered.has(node.seq)) {
      tokens += estimateTextTokens(` ${formatAnchor(node.right)}`)
    }
  }
  return tokens
}

/**
 * Compute the anchor decoration of every message, aligned to the input array.
 * 中文：按输入数组顺序计算每条消息的锚点装饰。
 */
export function anchorDecorations(state: DecayState, messages: readonly MessageLike[]): Array<Decoration | undefined> {
  const byId = new Map<string, { node: DecayState['nodes'][number] }>()
  for (const node of state.nodes) {
    if (node.messageId !== null) byId.set(node.messageId, { node })
  }
  const renderedSuffix = suffixRenderedSeqs(state)
  return messages.map(message => {
    if (message.role === 'system' || message.role === 'developer') return undefined
    const entry = byId.get(message.id)
    if (entry === undefined) {
      if (message.role === 'user' || message.role === 'assistant' || message.role === 'tool') {
        throw new Error(
          `context-decay: ${message.role} message ${message.id} has no replayed surface position. `
          + 'The presentation layer refuses to send a model request whose anchors cannot be rebuilt from the log.',
        )
      }
      return undefined
    }
    const node = entry.node
    if (node.left === null) return undefined
    const prefix = `${formatAnchor(node.left)} `
    if (!node.block) return { prefix }
    return {
      prefix,
      ...renderedSuffix.has(node.seq) && node.right !== null ? { suffix: ` ${formatAnchor(node.right)}` } : {},
    }
  })
}

/**
 * Apply one decoration to one message, preserving durable identity and replay metadata.
 * 中文：给一条消息应用装饰，同时保留持久身份和 replay 元数据。
 */
export function applyDecoration(message: MessageLike, decoration: Decoration | undefined): MessageLike {
  if (decoration === undefined) return message
  const prefix = decoration.prefix ?? ''
  const suffix = decoration.suffix ?? ''
  if (prefix.length === 0 && suffix.length === 0) return message
  const textIndex = message.content.findIndex(block => block.type === 'text')
  if (textIndex >= 0) {
    const content = [...message.content]
    const block = content[textIndex]!
    const text = message.role === 'assistant' ? stripLeadingAnchors(block.text ?? '') : block.text ?? ''
    content[textIndex] = { ...block, text: `${prefix}${text}${suffix}` }
    return { ...message, content }
  }
  // Adding a block would shift native replay metadata for assistant history.
  // 中文：给 assistant 历史临时加块会让原生 replay 元数据错位。
  if (message.role === 'assistant') return message
  const anchor: ContentBlock = { type: 'text', text: `${prefix}${suffix}` }
  return { ...message, content: [anchor, ...message.content] }
}

/**
 * Concatenate decorations from multiple registered decorators in registration order.
 * 中文：按注册顺序拼接多个装饰器的前缀/后缀。
 */
export function mergeDecorations(left: Decoration | undefined, right: Decoration | undefined): Decoration | undefined {
  if (left === undefined) return right
  if (right === undefined) return left
  return {
    ...left.prefix !== undefined || right.prefix !== undefined
      ? { prefix: `${left.prefix ?? ''}${right.prefix ?? ''}` }
      : {},
    ...left.suffix !== undefined || right.suffix !== undefined
      ? { suffix: `${left.suffix ?? ''}${right.suffix ?? ''}` }
      : {},
  }
}

/**
 * Surface-range resolution and guards for the compression tools.
 *
 * Positions are monotonic ids, never reused; anchors use numeric `⟦pN⟧` text.
 * A span is resolved in surface order:
 *  - `from` must be the left anchor of a visible node;
 *  - `to` is either the left anchor of a visible node (exclusive) or a live
 *    summary block's right boundary (the block itself is folded);
 *  - `end` folds through the last compressible node.
 * The guards here enforce three invariants the provider and the design require:
 *  - the current turn is a carrier and is never folded;
 *  - a span edge that would split an assistant tool call from its results is
 *    rejected (all results of one assistant tool-call message stay together);
 *  - a drop names exactly one live summary block.
 *
 * 中文：压缩工具使用的 surface 范围解析与保护。
 * 位置是 id，不是 surface 下标：范围折叠后最小的空闲 id 会被复用，所以数值更大的锚点
 * 可能排在数值更小的锚点前面。span 按 surface 顺序解析：
 *  - `from` 必须是某个可见节点的左锚点；
 *  - `to` 要么是某个可见节点的左锚点（排他），要么是 live 摘要块的右边界（该块本身
 *    被折叠）；
 *  - `end` 一直折叠到最后一个可压缩节点。
 * 这里的保护执行 provider 和设计要求的三个不变量：
 *  - 当前回合是 carrier，绝不被折叠；
 *  - 会把 assistant tool call 和它的结果切开的 span 边界会被拒绝（同一条 assistant
 *    tool-call 消息的所有结果必须留在同一个 span）；
 *  - drop 必须精确匹配一个 live 摘要块。
 */

import type { DecayState, NodeRecord } from './state.js'
import { formatAnchor } from './anchor.js'

/**
 * One model-addressable surface node.
 * 中文：一个可被模型寻址的 surface 节点。
 */
export interface VisibleNode {
  readonly index: number
  readonly node: NodeRecord
  readonly position: number
}

/**
 * A resolved span ready to be applied.
 * 中文：一条已解析、可直接应用的 span。
 */
export interface ResolvedSpan {
  /**
   * Inclusive surface indices of the compressed slice.
   * 中文：被压缩切片在 surface 上的闭区间下标。
   */
  readonly startIndex: number
  readonly endIndex: number
  /**
   * Pair: left anchor of the first compressed message, right boundary or null.
   * 中文：配对：第一条被压缩消息的左锚点，以及右边界或 null。
   */
  readonly from: number
  readonly to: number | null
  readonly shadowed: readonly NodeRecord[]
  readonly shadowedTokens: number
}

/**
 * Actionable error surfaced to the model through the tool result.
 * 中文：通过 tool result 返回给模型的可操作错误。
 */
export class DecayError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DecayError'
  }
}

/**
 * All model-addressable nodes with their positions, in surface order.
 * 中文：所有可被模型寻址的节点及其位置，按 surface 顺序排列。
 */
export function visibleNodes(state: DecayState): VisibleNode[] {
  const visible: VisibleNode[] = []
  for (let index = 0; index < state.nodes.length; index += 1) {
    const node = state.nodes[index]!
    if (node.left !== null) visible.push({ index, node, position: node.left })
  }
  return visible
}

/**
 * Legal `to` positions: every visible anchor plus every rendered summary right boundary, in surface order.
 * 中文：合法的 `to` 位置：所有可见锚点，加上所有已渲染摘要块的右边界，按 surface 顺序。
 */
export function legalToPositions(state: DecayState): number[] {
  const positions: number[] = []
  const seen = new Set<number>()
  for (const node of state.nodes) {
    if (node.left !== null && !seen.has(node.left)) {
      seen.add(node.left)
      positions.push(node.left)
    }
    if (node.block && node.right !== null && !seen.has(node.right)) {
      seen.add(node.right)
      positions.push(node.right)
    }
  }
  return positions
}

/**
 * Human-readable visible positions, in message order, for an unknown input position.
 * 中文：输入位置无法识别时，按消息顺序列出可读的可见位置。
 */
export function describePositions(state: DecayState): string {
  const positions = legalToPositions(state)
  if (positions.length === 0) return 'no positions exist yet'
  return `visible message anchors (message order): ${positions.map(formatAnchor).join(', ')}`
}

/**
 * Index of the first surface node appended during the current (protected) turn.
 * 中文：当前（受保护）回合里第一个新追加 surface 节点的下标。
 */
export function carrierStartIndex(state: DecayState): number {
  if (state.openTurn === null) return state.nodes.length
  for (let index = 0; index < state.nodes.length; index += 1) {
    const node = state.nodes[index]!
    // Replacement nodes (summary blocks) keep older positions and are foldable;
    // only nodes appended in this turn are the live carrier.
    // 中文：replacement 节点（摘要块）保留较旧的位置，可以继续被折叠；只有本回合新
    // 追加的节点才是 live carrier。
    if (node.appended && node.createdAtTurn === state.openTurn) return index
  }
  return state.nodes.length
}

/**
 * Last surface index that may be folded in this request.
 * 中文：本次请求中最后一个允许折叠的 surface 下标。
 */
export function compressibleEndIndex(state: DecayState): number {
  return carrierStartIndex(state) - 1
}

/**
 * Whether an assistant tool call/result pairing cut is balanced before every node and after the tail.
 * 中文：每个节点之前和整个 tail 之后，assistant tool call/result 配对切点是否平衡。
 */
export function balancedCuts(state: DecayState): boolean[] {
  const cuts = new Array<boolean>(state.nodes.length + 1).fill(true)
  let pending = 0
  for (let index = 0; index < state.nodes.length; index += 1) {
    const node = state.nodes[index]!
    pending += node.toolCalls
    if (node.toolResult) pending -= 1
    cuts[index + 1] = pending === 0
    if (pending < 0) {
      throw new DecayError(
        `context-decay: tool/result at surface position ${index} has no matching tool call; `
        + 'the replayed surface is inconsistent and cannot be compressed',
      )
    }
  }
  return cuts
}

/**
 * Resolve one requested span against the current replay state.
 * 中文：针对当前重放状态解析一条请求的 span。
 */
export function resolveSpan(state: DecayState, requestedFrom: number, requestedTo: number | 'end'): ResolvedSpan {
  if (!Number.isSafeInteger(requestedFrom)) {
    throw new DecayError(`compress: "from" must resolve to a valid position anchor, got ${JSON.stringify(requestedFrom)}`)
  }
  if (requestedTo !== 'end' && !Number.isSafeInteger(requestedTo)) {
    throw new DecayError(`compress: "to" must resolve to a valid position anchor or "end", got ${JSON.stringify(requestedTo)}`)
  }
  let startIndex = state.nodes.findIndex(node => node.left === requestedFrom)
  if (startIndex < 0) {
    throw new DecayError(
      `compress: ${formatAnchor(requestedFrom)} is not a visible message anchor. ${describePositions(state)}`,
    )
  }
  const compressibleEnd = compressibleEndIndex(state)
  if (compressibleEnd < 0) {
    throw new DecayError('compress: there is no compactable history yet (the current turn is protected)')
  }
  let endIndex: number
  if (requestedTo === 'end') {
    endIndex = compressibleEnd
  } else {
    // `to` is an id, not a threshold: resolve it by node identity, never by
    // numeric ordering (ids are monotonic but not a substitution for surface order).
    // 中文：`to` 是 id，不是阈值：按节点身份解析，绝不按数值顺序（id 单调递增，
    // 但不能替代 surface 顺序）。
    const owner = state.nodes.findIndex(node => node.left === requestedTo)
    if (owner >= 0) {
      endIndex = owner - 1
    } else {
      const block = state.nodes.findIndex(node => node.block && node.right === requestedTo)
      if (block < 0) {
        throw new DecayError(
          `compress: anchor ${formatAnchor(requestedTo)} is not a visible message anchor. ${describePositions(state)}`,
        )
      }
      endIndex = block
    }
    if (endIndex > compressibleEnd) {
      const firstVisible = currentCarrierPosition(state)
      if (requestedTo !== firstVisible || owner < 0 || !state.nodes[owner]!.appended) {
        throw currentTurnSpanError(state, firstVisible)
      }
      // `to` is the current turn's first visible anchor, but the turn starts
      // with unanchored carrier nodes (runtime context, system notices,
      // tool-call-only assistant messages). Keep those nodes and end the span
      // at the last compressible node; the requested visible anchor is still
      // the first kept message.
      // 中文：`to` 是当前回合第一条可见锚点，但回合开头还有无锚点 carrier 节点
      //（运行时上下文、system 提示、只有 tool-call 的 assistant 消息）。保留这些
      // 节点，把 span 收到最后一个可压缩节点；请求的可见锚点仍是第一条保留消息。
      endIndex = compressibleEnd
    }
  }
  if (startIndex > compressibleEnd) {
    throw new DecayError(
      'compress: there is no compressible history before the current turn; wait until the turn ends.',
    )
  }
  if (endIndex < startIndex) {
    throw new DecayError(
      `compress: [${formatAnchor(requestedFrom)}, ${requestedTo === 'end' ? 'end' : formatAnchor(requestedTo)}) selects no content: "to" precedes "from" in message order. `
      + 'Positions are ids, not increasing numbers; use the anchors printed on the messages.',
    )
  }
  const cuts = balancedCuts(state)
  if (!cuts[startIndex]) {
    throw new DecayError(
      `compress: "from" ${formatAnchor(requestedFrom)} is inside an assistant tool-call group. All results of one assistant `
      + 'tool-call message must stay in the same span; choose an anchor before the call or after its last result. '
      + describePositions(state),
    )
  }
  if (!cuts[endIndex + 1]) {
    const edge = requestedTo === 'end' ? '"end"' : `"to" ${formatAnchor(requestedTo)}`
    throw new DecayError(
      `compress: ${edge} is inside an assistant tool-call group. All results of one assistant tool-call message `
      + 'must stay in the same span; choose a boundary after the group\'s last result, or before the call. '
      + (requestedTo === 'end'
        ? 'If the group is still open in the current turn, wait for its results or choose an explicit "to" before the call. '
        : '')
      + describePositions(state),
    )
  }
  const shadowed = state.nodes.slice(startIndex, endIndex + 1)
  const firstVisible = shadowed.find(node => node.left !== null)
  if (firstVisible === undefined || firstVisible.left === null) {
    throw new DecayError('compress: the span contains no model-addressable content')
  }
  const last = shadowed[shadowed.length - 1]!
  const right = last.block ? last.right : nextVisibleLeft(state, endIndex + 1)
  return {
    startIndex,
    endIndex,
    from: firstVisible.left,
    to: right,
    shadowed,
    shadowedTokens: shadowed.reduce((sum, node) => sum + node.tokens, 0),
  }
}

/**
 * Position of the first protected carrier node, for diagnostics.
 * 中文：第一个受保护 carrier 节点的位置，仅用于诊断。
 */
function currentCarrierPosition(state: DecayState): number {
  const index = carrierStartIndex(state)
  for (let cursor = index; cursor < state.nodes.length; cursor += 1) {
    const left = state.nodes[cursor]?.left
    if (left !== undefined && left !== null) return left
  }
  return -1
}

/**
 * Explain why a boundary inside the current turn was refused.
 * 中文：解释当前回合内的边界为什么被拒绝。
 */
function currentTurnSpanError(state: DecayState, firstVisible: number): DecayError {
  const carrierStart = carrierStartIndex(state)
  const startsUnanchored = carrierStart < state.nodes.length && state.nodes[carrierStart]!.left === null
  const firstVisibleText = firstVisible >= 0 ? formatAnchor(firstVisible) : null
  const detail = firstVisibleText === null
    ? 'The current turn has no visible anchor yet.'
    : startsUnanchored
      ? `The current turn begins with unanchored messages before ${firstVisibleText}.`
      : `The current turn starts at ${firstVisibleText}.`
  return new DecayError(
    `compress: the span includes the current turn, which is protected. ${detail} `
    + 'Use "end" as "to" to compress all history before the current turn, or choose a boundary before the current turn.',
  )
}

/**
 * Left position of the next surface node at or after `fromIndex`.
 * 中文：`fromIndex` 及其之后第一个 surface 节点的左位置。
 */
function nextVisibleLeft(state: DecayState, fromIndex: number): number | null {
  for (let index = fromIndex; index < state.nodes.length; index += 1) {
    const node = state.nodes[index]!
    if (node.left !== null) return node.left
  }
  return null
}

/**
 * Find exactly one live summary block matching a pair.
 * 中文：查找与一对锚点精确匹配的唯一 live 摘要块。
 */
export function findBlock(state: DecayState, from: number, to: number | 'end'): { index: number; node: NodeRecord } {
  const blocks = state.nodes
    .map((node, index) => ({ node, index }))
    .filter(entry => entry.node.block && entry.node.left === from)
  const match = blocks.find(entry => to === 'end' ? entry.node.right === null : entry.node.right === to)
  if (match === undefined) {
    const known = blocks
      .map(entry => `[${formatAnchor(entry.node.left!)}, ${entry.node.right === null ? 'end' : formatAnchor(entry.node.right)})`)
      .join(', ') || 'none'
    throw new DecayError(
      `drop: no live summary block matches [${formatAnchor(from)}, ${to === 'end' ? 'end' : formatAnchor(to)}). `
      + `Known blocks: ${known}. Use the pair printed around the live summary block.`,
    )
  }
  return match
}

/**
 * Reject overlapping spans; adjacent spans are allowed.
 * 中文：拒绝相互重叠的 span；相邻 span 允许。
 */
export function assertDisjointSpans(spans: readonly ResolvedSpan[]): void {
  const ordered = [...spans].sort((a, b) => a.startIndex - b.startIndex)
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1]!
    const current = ordered[index]!
    if (current.startIndex <= previous.endIndex) {
      throw new DecayError(
        'compress: spans overlap. Compress each consumed region at most once per call '
        + '(adjacent spans are allowed; overlapping spans are not).',
      )
    }
  }
}

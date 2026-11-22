/**
 * Surface-range resolution and guards for the compression tool.
 *
 * Anchors are handles, not surface indices: a compressed region's interior
 * handles are recycled, so a later message may carry a handle that appeared
 * earlier. A compression range is resolved in surface order:
 *  - `from` must be the left handle of a visible node;
 *  - the end is fixed to the last compressible node before the protected
 *    current turn.
 * The guards enforce the invariants the provider and the design require:
 *  - the current turn is a carrier and is never folded;
 *  - a `from` edge that would split an assistant tool call from its results is
 *    rejected (all results of one assistant tool-call message stay together).
 *
 * 中文：压缩工具的 surface 范围解析与保护。
 * 锚点是句柄，不是 surface 下标：被压缩区间内部的句柄会回收，所以较新的消息可能携带
 * 以前出现过的句柄。压缩范围按 surface 顺序解析：
 *  - `from` 必须是某个可见节点的左句柄；
 *  - 终点固定为受保护当前回合之前的最后一个可压缩节点。
 * 这里的保护执行 provider 和设计要求的不变量：
 *  - 当前回合是 carrier，绝不被折叠；
 *  - 会把 assistant tool call 和它的结果切开的 `from` 会被拒绝（同一条 assistant
 *    tool-call 消息的所有结果必须留在同一段）。
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
  readonly anchor: string
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
   * Pair: left handle of the first compressed message, right boundary or null.
   * 中文：配对：第一条被压缩消息的左句柄，以及右边界或 null。
   */
  readonly from: string
  readonly to: string | null
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
 * All model-addressable nodes with their anchors, in surface order.
 * 中文：所有可被模型寻址的节点及其锚点，按 surface 顺序排列。
 */
export function visibleNodes(state: DecayState): VisibleNode[] {
  const visible: VisibleNode[] = []
  for (let index = 0; index < state.nodes.length; index += 1) {
    const node = state.nodes[index]!
    if (node.left !== null) visible.push({ index, node, anchor: node.left })
  }
  return visible
}

/**
 * Human-readable visible anchors, in message order, for an unknown input anchor.
 * 中文：输入锚点无法识别时，按消息顺序列出 user / assistant / 摘要块的锚点。
 */
export function describePositions(state: DecayState): string {
  const positions = visibleNodes(state).map(node => node.anchor)
  if (positions.length === 0) return '当前还没有任何锚点'
  return `user / assistant / 摘要块的锚点（按消息顺序）：${positions.map(formatAnchor).join('、')}`
}

/**
 * Index of the first surface node appended during the current (protected) turn.
 * 中文：当前（受保护）回合里第一个新追加 surface 节点的下标。
 */
export function carrierStartIndex(state: DecayState): number {
  if (state.openTurn === null) return state.nodes.length
  for (let index = 0; index < state.nodes.length; index += 1) {
    const node = state.nodes[index]!
    // Replacement nodes (summary blocks) keep older anchors and are foldable;
    // only nodes appended in this turn are the live carrier.
    // 中文：replacement 节点（摘要块）保留较旧的锚点，可以继续被折叠；只有本回合新
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
        `context-decay：surface 第 ${index} 个位置的 tool/result 没有匹配的 tool call；`
        + '重放 surface 不一致，无法压缩',
      )
    }
  }
  return cuts
}

/**
 * Resolve one compression start against the current replay state. The end is
 * always the last compressible node before the protected current turn.
 * 中文：针对当前重放状态解析一个压缩起点；终点始终是受保护当前回合之前的最后一个可压缩节点。
 */
export function resolveSpan(state: DecayState, requestedFrom: string): ResolvedSpan {
  const startIndex = state.nodes.findIndex(node => node.left === requestedFrom)
  if (startIndex < 0) {
    throw new DecayError(
      `compress：${formatAnchor(requestedFrom)} 不在 user / assistant / 摘要块的锚点中。${describePositions(state)}`,
    )
  }
  const compressibleEnd = compressibleEndIndex(state)
  if (compressibleEnd < 0) {
    throw new DecayError('compress：当前还没有可压缩的历史（当前轮受保护）')
  }
  if (startIndex > compressibleEnd) {
    throw new DecayError('compress：当前轮开始前没有可压缩历史；等当前轮结束再压缩。')
  }
  const cuts = balancedCuts(state)
  if (!cuts[startIndex]) {
    throw new DecayError(
      `compress：“from” ${formatAnchor(requestedFrom)} 是 tool 结果锚点，不能作起点；`
      + '请改选它之前的 user / assistant 锚点，或它之后的锚点。'
      + describePositions(state),
    )
  }
  if (!cuts[compressibleEnd + 1]) {
    throw new DecayError(
      'compress：压缩终点之后还有未到齐的 tool 结果；请等这些结果到齐后再压缩。'
      + describePositions(state),
    )
  }
  const endIndex = compressibleEnd
  const shadowed = state.nodes.slice(startIndex, endIndex + 1)
  const firstVisible = shadowed.find(node => node.left !== null)
  if (firstVisible === undefined || firstVisible.left === null) {
    throw new DecayError('compress：压缩区间中没有可被模型寻址的内容')
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
 * Left anchor of the next surface node at or after `fromIndex`.
 * 中文：`fromIndex` 及其之后第一个 surface 节点的左锚点。
 */
function nextVisibleLeft(state: DecayState, fromIndex: number): string | null {
  for (let index = fromIndex; index < state.nodes.length; index += 1) {
    const node = state.nodes[index]!
    if (node.left !== null) return node.left
  }
  return null
}

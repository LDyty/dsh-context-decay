/**
 * Deterministic replay of the Session surface into position anchors and summary
 * blocks.
 *
 * The presentation layer never stores positions in the session format: every
 * position here is a pure function of the committed surface operations
 * (append / replace). Positions are monotonic ids, never reused in new sessions:
 * an append takes the next id, so newer messages always have larger ids. Old
 * sessions with legacy summaries replay with the old lowest-free allocator so
 * their existing anchors stay valid. A position stays reserved while any live
 * node references it as a left anchor or as a summary block's right boundary
 * (shared boundaries are refcounted).
 *
 * 中文：把 Session surface 确定性重放成位置锚点和摘要块。
 * 展示层从不把位置写进 session 格式：这里每个位置都是已提交 surface 操作
 * （append / replace）的纯函数。新会话的位置单调递增、永不复用：append 取下一个 id，
 * 所以新消息的 id 总是更大。已有旧摘要的旧会话会用旧的“最小空闲”分配器重放，
 * 保证旧锚点仍然有效。任何 live 节点把它当左锚点或摘要块右边界引用时，
 * 位置保持 reserved（共享边界按引用计数）。
 */

import type { ContentBlock, MessageLike, SessionEventLike, SessionLike } from './types.js'

/**
 * One derived message observed at replay time.
 * 中文：重放时观察到的一条派生消息。
 */
export interface ObservedMessage {
  readonly message: MessageLike
  readonly source: Readonly<Record<string, unknown>>
}

/**
 * One event that produced a derived message.
 * 中文：产生一条派生消息的事件。
 */
export function observedMessageOf(event: SessionEventLike): ObservedMessage | null {
  if (!isRecord(event.data)) return null
  const raw = event.type === 'user/message' ? event.data : event.data['message']
  if (!isRecord(raw)) return null
  const message = raw as unknown as MessageLike
  if (typeof message.id !== 'string' || typeof message.role !== 'string' || !Array.isArray(message.content)) return null
  return { message, source: isRecord(message.source) ? message.source as Readonly<Record<string, unknown>> : {} }
}

/**
 * Whether a message can carry a `⟦p12⟧` anchor without breaking durable replay metadata.
 * 中文：一条消息能否携带 `⟦p12⟧` 锚点而不破坏持久 replay 元数据。
 */
export function isAnchorable(message: MessageLike): boolean {
  if (message.role === 'user' || message.role === 'tool') return true
  // Assistant replay metadata (thinking signatures) is index-aligned per content
  // block, so an assistant message may only be decorated when it already has a
  // text block whose text can be rewritten in place.
  // 中文：assistant 的 replay 元数据（thinking 签名）按 content 块索引对齐，所以只有
  // 已经存在可原地改写 text 块时，才能给 assistant 消息加锚点。
  return message.role === 'assistant' && message.content.some(block => block.type === 'text')
}

/**
 * Whether a surface event derives a model-visible message.
 * 中文：一个 surface 事件是否派生模型可见消息。
 */
function derivesMessage(message: MessageLike): boolean {
  if (message.role === 'user' || message.role === 'tool') return true
  return message.role === 'assistant' && message.content.length > 0
}

/**
 * One node of the replayed surface.
 * 中文：重放 surface 的一个节点。
 */
export interface NodeRecord {
  readonly seq: number
  /**
   * Left anchor position, or null when the node is not model-addressable.
   * 中文：左锚点位置；节点不可被模型寻址时为 null。
   */
  readonly left: number | null
  readonly messageId: string | null
  readonly role: string | null
  /**
   * Whether this node is a context-decay summary block.
   * 中文：这个节点是否是 context-decay 摘要块。
   */
  readonly block: boolean
  /**
   * Exclusive right boundary of a block; null while the block reaches the end.
   * 中文：摘要块的排他右边界；摘要块一直延伸到末尾时为 null。
   */
  readonly right: number | null
  readonly tier: number
  readonly createdAtTurn: number | null
  readonly tokens: number
  readonly summaryChars: number
  readonly topic: string | null
  readonly toolCalls: number
  readonly toolResult: boolean
  /**
   * True when the event appended a new surface node (never a replacement).
   * 中文：事件新增了 surface 节点（不是 replacement）时为 true。
   */
  readonly appended: boolean
}

/**
 * Provider usage of the latest assistant message.
 * 中文：最新 assistant 消息的 provider 用量。
 */
export interface UsageSnapshot {
  readonly inputTokens: number
  readonly cacheReadTokens: number
  readonly cacheWriteTokens: number
  readonly outputTokens: number
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
  readonly sessionId?: string
  /**
   * Number of log events already folded.
   * 中文：已经折叠的日志事件数。
   */
  applied: number
  /**
   * High-water mark: ids `0..nextPosition-1` have been allocated at least once.
   * 中文：高水位线：`0..nextPosition-1` 这些 id 至少被分配过一次。
   */
  nextPosition: number
  /**
   * Released ids, ascending; the next append takes the first one.
   * 中文：已释放的 id，升序排列；下一次 append 取第一个。
   */
  free: number[]
  /**
   * Live references per position: left anchors and rendered right boundaries.
   * Plain JSON for projection checkpoints.
   * 中文：每个位置的 live 引用数：左锚点和渲染出的右边界。用普通 JSON 存储，供
   * projection checkpoint 使用。
   */
  refs: Record<number, number>
  nodes: NodeRecord[]
  openTurn: number | null
  step: number
  /**
   * Seq of the latest `turn/start` event.
   * 中文：最新 `turn/start` 事件的 seq。
   */
  turnStartSeq: number
  lastReminderTurn: number | null
  lastReminderTokens: number
  /**
   * Highest warning level already announced (0 = none); re-arms when pressure drops below it.
   * 中文：已经播报过的最高警告级别（0 = 无）；压力降到该级别以下时重新武装。
   */
  lastReminderLevel: number
  usage: UsageSnapshot | null
  blocksCreated: number
  /**
   * Model responses (assistant/message events) seen in this session so far.
   * 中文：本会话到目前为止看到的模型回复数（assistant/message 事件）。
   */
  assistantRequests: number
  /**
   * Anchor allocation mode for this session.
   * - `legacy`: old sessions may already contain reused numeric ids; replay and
   *   continue with the old lowest-free allocator so existing anchors stay valid.
   * - `monotonic`: new sessions append fresh ids and never reuse a released one.
   * 中文：本会话的锚点分配模式。
   * - `legacy`：旧会话可能已有复用数字 id；重放和后续分配继续使用旧的“最小空闲”
   *   分配器，保证已有锚点仍然有效。
   * - `monotonic`：新会话只追加新 id，永不复用已释放的 id。
   */
  anchorMode: 'legacy' | 'monotonic'
  /**
   * Number of appends that reused a released id (legacy mode diagnostics).
   * 中文：复用已释放 id 的 append 次数（legacy 模式诊断用）。
   */
  reusedPositions: number
}

/**
 * A fresh state before any event is folded.
 * 中文：尚未折叠任何事件时的初始状态。
 */
export function createState(sessionId?: string): DecayState {
  return {
    ...(sessionId === undefined ? {} : { sessionId }),
    applied: 0,
    nextPosition: 0,
    free: [],
    refs: {},
    nodes: [],
    openTurn: null,
    step: 0,
    turnStartSeq: -1,
    lastReminderTurn: null,
    lastReminderTokens: 0,
    lastReminderLevel: 0,
    usage: null,
    blocksCreated: 0,
    assistantRequests: 0,
    anchorMode: 'monotonic',
    reusedPositions: 0,
  }
}

/**
 * Heap-stable in-memory replay cache keyed by the live Session object.
 * 中文：以 live Session 对象为 key 的堆稳定内存重放缓存。
 */
export class StateCache {
  private readonly states = new WeakMap<object, DecayState>()

  /**
   * Fold the session's committed tail into its cached state.
   * 中文：把 session 已提交的尾部事件折叠进缓存状态。
   */
  stateOf(session: SessionLike): DecayState {
    const events = session.snapshotEvents()
    const state = this.states.get(session) ?? createState()
    for (let index = state.applied; index < events.length; index += 1) {
      foldEvent(state, events[index]!)
    }
    state.applied = events.length
    this.states.set(session, state)
    return state
  }
}

/**
 * Fold the whole event array (tests and one-shot reconstruction).
 * 中文：折叠整个事件数组（测试和一次性重建用）。
 */
export function foldAll(events: readonly SessionEventLike[]): DecayState {
  const state = createState()
  for (const event of events) foldEvent(state, event)
  state.applied = events.length
  return state
}

/**
 * Read the anchor-allocation mode recorded by a compaction summary.
 * Old summaries have no field and default to legacy compatibility.
 * 中文：读取 compaction summary 记录的锚点分配模式。
 * 旧摘要没有该字段，默认使用 legacy 兼容模式。
 */
function anchorModeOfSummary(event: SessionEventLike): 'legacy' | 'monotonic' {
  const data = event.data as { rawOutput?: unknown } | undefined
  const raw = data?.rawOutput
  let text = ''
  if (typeof raw === 'string') {
    text = raw
  } else if (Array.isArray(raw)) {
    text = raw.map(part => (typeof part === 'object' && part !== null && 'text' in part ? String((part as { text?: unknown }).text ?? '') : '')).join('')
  }
  if (text === '') return 'legacy'
  try {
    const ledger = JSON.parse(text) as { anchorMode?: unknown }
    return ledger.anchorMode === 'monotonic' ? 'monotonic' : 'legacy'
  } catch {
    return 'legacy'
  }
}

/**
 * Apply one committed event to the replay state in place.
 * 中文：把一个已提交事件原地应用到重放状态。
 */
export function foldEvent(state: DecayState, event: SessionEventLike): void {
  if (event.type === 'compaction/summary') {
    const mode = anchorModeOfSummary(event)
    if (mode === 'legacy') state.anchorMode = 'legacy'
    else if (state.anchorMode !== 'legacy') state.anchorMode = 'monotonic'
  }
  if (event.type === 'turn/start') {
    state.openTurn = turnOf(event) ?? null
    state.turnStartSeq = event.seq
    state.step = 0
    return
  }
  if (event.type === 'turn/end') {
    state.openTurn = null
    return
  }
  if (event.type === 'step/start') {
    state.step = stepOf(event) ?? state.step
    return
  }
  if (event.type === 'assistant/message') {
    state.assistantRequests += 1
    recordUsage(state, event)
  }
  const observed = observedMessageOf(event)
  if (observed !== null) {
    const source = observed.source
    if (source['kind'] === 'context-decay' && source['form'] === 'notice') {
      state.lastReminderTurn = state.openTurn
      state.lastReminderTokens = typeof source['atTokens'] === 'number' ? source['atTokens'] : 0
      state.lastReminderLevel = typeof source['level'] === 'number' ? source['level'] : 0
    }
  }
  const op = event.surfaceOp
  if (op === undefined || observed === null) return
  const message = observed.message
  if (op === 'append') {
    appendNode(state, event, message)
    return
  }
  replaceNode(state, event, message, op.startSeq, op.endSeq)
}

/**
 * Append one surface node, allocating the next monotonic position when addressable.
 * 中文：追加一个 surface 节点；可寻址时分配下一个单调位置。
 */
function appendNode(state: DecayState, event: SessionEventLike, message: MessageLike): void {
  if (!derivesMessage(message)) {
    state.nodes.push(invisibleNode(state, event, message, true))
    return
  }
  const anchorable = isAnchorable(message)
  const left = anchorable ? allocatePosition(state) : null
  if (left !== null) closeTailBlocks(state, left)
  state.nodes.push(nodeOf(state, event, message, left, false, null, 0, true))
}

/**
 * Append a fresh monotonic position; released positions are never reused.
 * 中文：追加一个单调递增的新位置；已释放的位置永不复用。
 */
function allocatePosition(state: DecayState): number {
  if (state.anchorMode === 'legacy') {
    const reused = state.free.shift()
    const left = reused ?? state.nextPosition++
    if (reused !== undefined) state.reusedPositions += 1
    bumpRef(state, left)
    return left
  }
  if (state.nextPosition >= 0x1_0000_0000) {
    throw new Error('context-decay: anchor space exhausted (32-bit positions)')
  }
  const left = state.nextPosition
  state.nextPosition += 1
  bumpRef(state, left)
  return left
}

/**
 * Reserve one reference to a position.
 * 中文：给一个位置预留一个引用。
 */
function bumpRef(state: DecayState, position: number): void {
  state.refs[position] = (state.refs[position] ?? 0) + 1
}

/**
 * Replay one recorded surface replacement.
 * 中文：重放一次已记录的 surface replacement。
 */
function replaceNode(
  state: DecayState,
  event: SessionEventLike,
  message: MessageLike,
  startSeq: number,
  endSeq: number,
): void {
  const startIdx = state.nodes.findIndex(node => node.seq === startSeq)
  const endIdx = state.nodes.findIndex(node => node.seq === endSeq)
  if (startIdx < 0 || endIdx < 0 || startIdx > endIdx) {
    throw new Error(
      `context-decay: surface replace at log seq ${event.seq} names range ${startSeq}..${endSeq}, `
      + 'which the replayed surface does not contain (corrupt or foreign surface operation)',
    )
  }
  const shadowed = state.nodes.slice(startIdx, endIdx + 1)
  const source = isRecord(message.source) ? message.source : {}
  const summary = source['kind'] === 'context-decay' && source['form'] === 'summary'
  const anchorable = derivesMessage(message) && isAnchorable(message)
  const firstAnchorable = shadowed.find(node => node.left !== null)
  const firstLeft = firstAnchorable?.left ?? null
  let replacement: NodeRecord
  if (summary && anchorable && firstLeft !== null) {
    const last = shadowed[shadowed.length - 1]
    const right = last !== undefined && last.block ? last.right : nextAnchorableLeft(state.nodes, endIdx + 1)
    const innerTier = shadowed.reduce((max, node) => node.block ? Math.max(max, node.tier) : max, 0)
    replacement = nodeOf(state, event, message, firstLeft, true, right, innerTier + 1, false)
    state.blocksCreated += 1
    closeTailBlocksBefore(state, startIdx, firstLeft)
  } else if (anchorable && firstLeft !== null) {
    // In-place content rewrite (tool-result pruning, image offload, …): keep the slot.
    // 中文：原地改写内容（tool result 裁剪、图片 offload 等）：保留原来的位置槽。
    const only = shadowed.length === 1 ? shadowed[0] : undefined
    if (only !== undefined && only.block) {
      replacement = {
        ...nodeOf(state, event, message, firstLeft, true, only.right, only.tier, false),
        createdAtTurn: only.createdAtTurn,
      }
    } else {
      replacement = nodeOf(state, event, message, firstLeft, false, null, 0, false)
    }
  } else {
    replacement = invisibleNode(state, event, message, false)
  }
  state.nodes.splice(startIdx, endIdx - startIdx + 1, replacement)
  recomputeReferences(state)
}

/**
 * Rebuild the reference counts and the free list from the current nodes.
 *
 * Replacements are rare (compressions, drops, in-place rewrites), so a full
 * rebuild keeps the invariant obvious: a position is free exactly when no live
 * node uses it as a left anchor or as a summary block's right boundary.
 *
 * 中文：根据当前节点重建引用计数和空闲列表。
 * replacement 很少（压缩、drop、原地改写），所以全量重建能让不变量保持直观：
 * 一个位置空闲，当且仅当没有任何 live 节点把它当左锚点或摘要块右边界。
 */
function recomputeReferences(state: DecayState): void {
  const refs: Record<number, number> = {}
  const bump = (position: number): void => {
    refs[position] = (refs[position] ?? 0) + 1
  }
  for (const node of state.nodes) {
    if (node.left !== null) bump(node.left)
    if (node.block && node.right !== null) bump(node.right)
  }
  const free: number[] = []
  for (let position = 0; position < state.nextPosition; position += 1) {
    if (refs[position] === undefined) free.push(position)
  }
  state.refs = refs
  state.free = free
}

/**
 * Close every trailing end-block before newly appended content starts at `left`.
 * 中文：新追加内容从 `left` 开始时，关闭所有尾部未闭合块。
 */
function closeTailBlocks(state: DecayState, left: number): void {
  closeTailBlocksBefore(state, state.nodes.length, left)
}

/**
 * Close trailing end-blocks strictly before `beforeIdx`.
 * 中文：关闭严格位于 `beforeIdx` 之前的尾部未闭合块。
 */
function closeTailBlocksBefore(state: DecayState, beforeIdx: number, left: number): void {
  for (let index = beforeIdx - 1; index >= 0; index -= 1) {
    const node = state.nodes[index]!
    if (node.left === null) continue
    if (node.block && node.right === null) {
      state.nodes[index] = { ...node, right: left }
      // Appends rely on the incremental count; replacements rebuild it after the splice.
      // 中文：append 路径依赖这里的增量计数；replacement 会在 splice 之后全量重建。
      bumpRef(state, left)
    }
    return
  }
}

/**
 * First anchorable position at or after `fromIdx`, or null at the end.
 * 中文：`fromIdx` 起第一个可锚定位置；到末尾仍没有则为 null。
 */
function nextAnchorableLeft(nodes: readonly NodeRecord[], fromIdx: number): number | null {
  for (let index = fromIdx; index < nodes.length; index += 1) {
    const left = nodes[index]?.left
    if (left !== undefined && left !== null) return left
  }
  return null
}

/**
 * Build a node record for one surface event.
 * 中文：为一个 surface 事件构造节点记录。
 */
function nodeOf(
  state: DecayState,
  event: SessionEventLike,
  message: MessageLike,
  left: number | null,
  block: boolean,
  right: number | null,
  tier: number,
  appended: boolean,
): NodeRecord {
  const source = isRecord(message.source) ? message.source : {}
  return {
    seq: event.seq,
    left,
    messageId: message.id,
    role: message.role,
    block,
    right,
    tier,
    createdAtTurn: state.openTurn,
    tokens: estimateMessageTokens(message),
    summaryChars: block ? textLength(message.content) : 0,
    topic: typeof source['topic'] === 'string' ? source['topic'] : null,
    toolCalls: message.content.reduce((count, item) => item.type === 'tool-call' ? count + 1 : count, 0),
    toolResult: message.role === 'tool',
    appended,
  }
}

/**
 * Build a node that projects no model-visible message.
 * 中文：构造一个不投影模型可见消息的节点。
 */
function invisibleNode(state: DecayState, event: SessionEventLike, message: MessageLike, appended: boolean): NodeRecord {
  return nodeOf(state, event, message, null, false, null, 0, appended)
}

/**
 * Estimate model-visible tokens of one message (mirrors the harness token meter's fixed heuristic).
 * 中文：估算一条消息的模型可见 token 数（复刻宿主 token meter 的固定启发式）。
 */
export function estimateMessageTokens(message: MessageLike): number {
  if (message.role === 'system') {
    if (message.content.length === 0) return 0
    let characters = 0
    for (const block of message.content) {
      characters += block.type === 'text' && typeof block.text === 'string' ? block.text.length : JSON.stringify(block).length
    }
    return Math.ceil(characters / 4) + 4
  }
  return 4 + message.content.reduce((sum, block) => sum + estimateBlockTokens(block), 0)
}

/**
 * Estimate tokens of one content block (same fixed heuristic as the harness token meter).
 * 中文：估算一个 content 块的 token 数（与宿主 token meter 相同的固定启发式）。
 */
export function estimateBlockTokens(block: ContentBlock): number {
  switch (block.type) {
    case 'text':
    case 'reasoning':
      return Math.ceil((typeof block.text === 'string' ? block.text.length : 0) / 4) + 4
    case 'tool-call': {
      const name = typeof block.name === 'string' ? block.name : ''
      const args = typeof block.arguments === 'string' ? block.arguments : JSON.stringify(block.arguments ?? '')
      return Math.ceil(name.length / 4) + Math.ceil(args.length / 4) + 4
    }
    default:
      return 4 + Math.ceil(JSON.stringify(block).length / 4)
  }
}

/**
 * Estimate tokens of plain text: ASCII prose ≈ 4 chars/token, other scripts ≈ 1 char/token.
 * 中文：估算纯文本 token 数：ASCII 文本约 4 字符/token，其他文字约 1 字符/token。
 */
export function estimateTextTokens(text: string): number {
  if (text.length === 0) return 0
  let ascii = 0
  let other = 0
  for (const char of text) {
    if (char.charCodeAt(0) < 0x80) ascii += 1
    else other += 1
  }
  return Math.ceil(ascii / 4) + other
}

/**
 * Sum of visible text characters in a block list.
 * 中文：一个块列表里可见文本字符的总数。
 */
function textLength(content: readonly ContentBlock[]): number {
  return content.reduce((sum, block) => sum + (block.type === 'text' && typeof block.text === 'string' ? block.text.length : 0), 0)
}

/**
 * Record the latest assistant usage snapshot.
 * 中文：记录最新 assistant 的用量快照。
 */
function recordUsage(state: DecayState, event: SessionEventLike): void {
  if (!isRecord(event.data) || !isRecord(event.data['usage'])) return
  const usage = event.data['usage']
  const read = (key: string): number => typeof usage[key] === 'number' ? usage[key] as number : 0
  state.usage = {
    inputTokens: read('inputTokens'),
    cacheReadTokens: read('cacheReadTokens'),
    cacheWriteTokens: read('cacheWriteTokens'),
    outputTokens: read('outputTokens'),
  }
}

/**
 * Turn number of a `turn/*` event.
 * 中文：`turn/*` 事件的回合号。
 */
function turnOf(event: SessionEventLike): number | undefined {
  if (!isRecord(event.data)) return undefined
  return typeof event.data['turn'] === 'number' ? event.data['turn'] as number : undefined
}

/**
 * Step number of a `step/*` event.
 * 中文：`step/*` 事件的步骤号。
 */
function stepOf(event: SessionEventLike): number | undefined {
  if (!isRecord(event.data)) return undefined
  return typeof event.data['step'] === 'number' ? event.data['step'] as number : undefined
}

/**
 * Narrow an unknown value to a plain JSON object.
 * 中文：把 unknown 收窄为普通 JSON 对象。
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

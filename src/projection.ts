/**
 * Host-side session projection for the sidebar visualizer.
 *
 * The projection is a pure fold over committed session events: the same
 * deterministic anchor replay the decorator and tool use, exposed as a compact
 * JSON view. The projection registry drives it on every event and ships the
 * wire view to the browser, where `useProjection('contextDecay')` reads it.
 *
 * The state must be plain JSON (the projection cache persists and replays it),
 * so every collection in `DecayState` is a plain array or record.
 *
 * 中文：侧栏可视化用的宿主侧 session projection。
 * projection 是对已提交 session 事件的纯 fold：与 decorator 和 tool 使用同一套
 * 确定性锚点重放，只是暴露成紧凑 JSON 视图。projection registry 在每次事件时驱动它，
 * 并把 wire view 送到浏览器，由 `useProjection('contextDecay')` 读取。
 * 状态必须是普通 JSON（projection cache 会持久化并重放它），所以 `DecayState` 里的
 * 集合都是普通数组或 record。
 */

import { carrierStartIndex, compressibleEndIndex } from './blocks.js'
import { createState, foldEvent } from './state.js'
import type { DecayState, NodeRecord } from './state.js'
import type { SessionEventLike } from './types.js'

/**
 * Bump when the fold semantics or the wire fields change.
 * 中文：fold 语义或 wire 字段变化时递增。
 */
export const DECAY_PROJECTION_VERSION = 7

/**
 * Host-side pressure snapshot shown beside the model-facing reminder.
 * 中文：显示在模型侧提醒旁边的宿主侧压力快照。
 */
export interface PanelPressure {
  readonly tokens: number
  /**
   * Effective denominator: total window minus the output reservation.
   * 中文：有效分母：总窗口减去输出预留。
   */
  readonly window: number
  readonly totalWindow: number
  readonly reservedOutput: number
  readonly ratio: number
  readonly source: 'meter' | 'usage' | 'estimate'
  readonly windowSource: 'config' | 'request' | 'default'
  readonly reservationSource: 'config' | 'header' | 'none'
}

/**
 * Reminder state derived from the last notice.
 * 中文：根据最近一次提醒推导出的提醒状态。
 */
export interface PanelReminder {
  readonly lastTokens: number
  readonly lastTurn: number | null
}

/**
 * Facts of the most recent decorated request (from the audit record).
 * 中文：最近一次被装饰请求的事实（来自 audit 记录）。
 */
export interface PanelRequest {
  /**
   * Durable 1-based model-request ordinal in this session.
   * 中文：本会话内从 1 开始的持久模型请求序号。
   */
  readonly sessionIndex: number
  /**
   * 1-based decorated-request ordinal since the process started.
   * 中文：进程启动以来从 1 开始的已装饰请求序号。
   */
  readonly processIndex: number
  readonly messages: number
  readonly anchors: number
  readonly first: string | null
  readonly last: string | null
  readonly blocks: number
  readonly overheadTokens: number
  readonly time: string
}

/**
 * Host-side runtime facts merged into the projection view; not part of the persisted state.
 * 中文：合并进 projection 视图的宿主侧运行时事实；不属于持久状态。
 */
export interface PanelRuntime {
  pressure: PanelPressure | null
  reminder: PanelReminder | null
  request: PanelRequest | null
}

/**
 * One model-visible node as the visualizer draws it.
 * 中文：可视化器绘制的一个模型可见节点。
 */
export interface ContextDecayNodeView {
  readonly seq: number
  readonly left: string
  readonly right: string | null
  readonly block: boolean
  readonly tier: number
  readonly role: string | null
  readonly tokens: number
  readonly topic: string | null
  readonly createdAtTurn: number | null
  readonly appended: boolean
  readonly summaryChars: number
}

/**
 * Client-visible state of the anchor space and its blocks.
 * 中文：客户端可见的锚点空间及其摘要块状态。
 */
export interface ContextDecayView {
  readonly v: number
  readonly nodes: readonly ContextDecayNodeView[]
  /**
   * Number of anchors allocated in this session; recycled allocations count.
   * 中文：本会话已分配锚点次数；复用回收锚点也计数。
   */
  readonly allocated: number
  /**
   * Recycled anchors available for reuse.
   * 中文：可复用的回收锚点。
   */
  readonly free: readonly string[]
  /**
   * Pre-generated anchors not yet issued.
   * 中文：已预生成、尚未发放的锚点数量。
   */
  readonly anchorPool: number
  readonly reusedPositions: number
  readonly blocksCreated: number
  readonly openTurn: number | null
  readonly turnStartSeq: number
  /**
   * Seq of the first node appended in the protected current turn, or null.
   * 中文：受保护的当前回合里第一个新追加节点的 seq；没有则为 null。
   */
  readonly carrierSeq: number | null
  /**
   * Seq of the last foldable node, or null when nothing is foldable.
   * 中文：最后一个可压缩节点的 seq；没有可压缩节点时为 null。
   */
  readonly compressibleEndSeq: number | null
  /**
   * Anchor of the last foldable node, or null when nothing is foldable.
   * 中文：最后一个可压缩节点的锚点；没有可压缩节点时为 null。
   */
  readonly compressibleEndPosition: string | null
  /**
   * Same effective-window pressure the reminder uses; null until the first step reads it.
   * 中文：与提醒使用同一个有效窗口压力；首次 step 读取前为 null。
   */
  readonly pressure: PanelPressure | null
  /**
   * Reminder bookkeeping (last reminder, last turn).
   * 中文：提醒记账状态（上次提醒、上次提醒所在回合）。
   */
  readonly reminder: PanelReminder | null
  /**
   * Most recent decorated request; null until the first request is audited.
   * 中文：最近一次已装饰请求；首次请求审计前为 null。
   */
  readonly request: PanelRequest | null
}

/**
 * Structural registry face consumed by `apply` (the harness service shape).
 * 中文：`apply` 消费的结构化 registry 接口（宿主服务形态）。
 */
export interface SessionProjectionsLike {
  register(definition: unknown): () => void
}

/**
 * Events the replay fold consumes; everything else keeps the state reference.
 * 中文：replay fold 消费的事件；其他事件保持原状态引用不变。
 */
function isRelevant(event: SessionEventLike): boolean {
  return event.surfaceOp !== undefined
    || event.type === 'turn/start'
    || event.type === 'turn/end'
    || event.type === 'step/start'
    || event.type === 'assistant/message'
}

/**
 * Copy the mutable parts of one state so the projection's apply stays pure.
 * 中文：复制状态里的可变部分，让 projection 的 apply 保持纯函数。
 */
function forkState(state: DecayState): DecayState {
  return {
    ...state,
    nodes: [...state.nodes],
    free: [...state.free],
    issued: [...state.issued],
    anchorPool: [...state.anchorPool],
    refs: { ...state.refs },
  }
}

/**
 * Validate one persisted checkpoint state before it seeds a fold.
 * 中文：在持久 checkpoint 状态用于 seed fold 之前校验它。
 */
function parseState(value: unknown): DecayState {
  if (typeof value !== 'object' || value === null) throw new TypeError('context-decay projection：state 不是对象')
  const record = value as Record<string, unknown>
  if (!Array.isArray(record['nodes']) || !Array.isArray(record['free'])) {
    throw new TypeError('context-decay projection：state 缺少 nodes/free')
  }
  if (!Array.isArray(record['issued']) || !Array.isArray(record['anchorPool'])) {
    throw new TypeError('context-decay projection：state 缺少 issued/anchorPool')
  }
  if (typeof record['allocated'] !== 'number'
    || typeof record['anchorCounter'] !== 'number'
    || typeof record['anchorSeed'] !== 'string'
    || typeof record['refs'] !== 'object' || record['refs'] === null) {
    throw new TypeError('context-decay projection：state 缺少 allocated/anchorCounter/anchorSeed/refs')
  }
  if (record['sessionId'] !== undefined && typeof record['sessionId'] !== 'string') {
    throw new TypeError('context-decay projection：state 的 sessionId 不是字符串')
  }
  return value as DecayState
}

/**
 * Validate the wire view before it leaves the host.
 * 中文：wire view 离开宿主前校验它。
 */
function parseView(value: unknown): ContextDecayView {
  if (typeof value !== 'object' || value === null) throw new TypeError('context-decay projection：view 不是对象')
  const record = value as Record<string, unknown>
  if (!Array.isArray(record['nodes']) || !Array.isArray(record['free'])) {
    throw new TypeError('context-decay projection：view 缺少 nodes/free')
  }
  return value as ContextDecayView
}

/**
 * Build the client view from one replayed state plus the host runtime snapshot.
 * 中文：把一份重放状态和宿主运行时快照构造成客户端视图。
 */
function viewOf(state: DecayState, runtime: PanelRuntime): ContextDecayView {
  const nodes = state.nodes
    .filter((node): node is NodeRecord & { left: string } => node.left !== null)
    .map(node => ({
      seq: node.seq,
      left: node.left,
      right: node.right,
      block: node.block,
      tier: node.tier,
      role: node.role,
      tokens: node.tokens,
      topic: node.topic,
      createdAtTurn: node.createdAtTurn,
      appended: node.appended,
      summaryChars: node.summaryChars,
    }))
  const carrierStart = carrierStartIndex(state)
  const compressibleEnd = compressibleEndIndex(state)
  const carrierSeq = carrierStart < state.nodes.length ? state.nodes[carrierStart]?.seq ?? null : null
  let compressibleEndSeq: number | null = null
  let compressibleEndPosition: string | null = null
  for (let index = compressibleEnd; index >= 0; index -= 1) {
    const left = state.nodes[index]?.left
    if (left !== undefined && left !== null) {
      compressibleEndSeq = state.nodes[index]?.seq ?? null
      compressibleEndPosition = left
      break
    }
  }
  return {
    v: DECAY_PROJECTION_VERSION,
    nodes,
    allocated: state.allocated,
    free: [...state.free],
    anchorPool: state.anchorPool.length,
    reusedPositions: state.reusedPositions,
    blocksCreated: state.blocksCreated,
    openTurn: state.openTurn,
    turnStartSeq: state.turnStartSeq,
    carrierSeq,
    compressibleEndSeq,
    compressibleEndPosition,
    pressure: runtime.pressure,
    reminder: runtime.reminder,
    request: runtime.request,
  }
}

const EMPTY_RUNTIME: PanelRuntime = { pressure: null, reminder: null, request: null }

/**
 * Build the `contextDecay` projection registration.
 *
 * 中文：构造 `contextDecay` projection 注册。
 *
 * @param getRuntime - reads the host-side pressure/reminder/request snapshot for one session id.
 * 中文：读取某个 session id 的宿主侧压力/提醒/请求快照。
 * @returns the projection definition for `ctx.sessionProjections.register`.
 * 中文：返回给 `ctx.sessionProjections.register` 的 projection 定义。
 */
export function createContextDecayProjection(getRuntime: (sessionId: string) => PanelRuntime) {
  return {
    key: 'contextDecay',
    stateVersion: DECAY_PROJECTION_VERSION,
    stateSchema: { parse: parseState },
    init: (header?: { readonly id: string }) => createState(header === undefined ? undefined : String(header.id)),
    apply: (state: DecayState, event: SessionEventLike): DecayState => {
      if (!isRelevant(event)) return state
      const next = forkState(state)
      foldEvent(next, event)
      return next
    },
    wire: {
      viewSchema: { parse: parseView },
      view: (state: DecayState): ContextDecayView => viewOf(
        state,
        state.sessionId === undefined ? EMPTY_RUNTIME : getRuntime(state.sessionId),
      ),
    },
  }
}

/**
 * Default projection with no runtime snapshot (tests and headless registrations).
 * 中文：不带运行时快照的默认 projection（测试和无头注册用）。
 */
export const contextDecayProjection = createContextDecayProjection(() => EMPTY_RUNTIME)

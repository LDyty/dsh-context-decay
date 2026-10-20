/**
 * Effective context window: the route's total capacity minus the output
 * reservation the loop requested for this request.
 *
 * The model and the sidebar both use this effective window, so a 1M route with
 * a 256K output reservation reports 744K. The total and the reservation stay
 * visible for humans. The reservation is read from the latest `request/header`
 * snapshot (`header.config.maxTokens`), which is the cap the loop actually used
 * for the request; no extra LLM lookup is needed.
 *
 * 中文：有效上下文窗口：路由总容量减去本请求中循环申请的输出预留。
 * 模型和侧栏都使用这个有效窗口，所以 1M 路由 + 256K 输出预留会报告 744K。总容量和
 * 预留仍然对人类可见。预读取自最新 `request/header` 快照（`header.config.maxTokens`），
 * 也就是循环本请求实际使用的上限；不需要额外查询 LLM。
 */

import { isRecord } from './state.js'
import type { SessionLike } from './types.js'

/**
 * Where the total capacity came from.
 * 中文：总容量的来源。
 */
export type WindowSource = 'config' | 'request' | 'default'

/**
 * Where the output reservation came from.
 * 中文：输出预留的来源。
 */
export type ReservationSource = 'config' | 'header' | 'none'

/**
 * One resolved window plan.
 * 中文：一份已解析的窗口计划。
 */
export interface WindowPlan {
  /**
   * Route total capacity in tokens.
   * 中文：路由总容量（token）。
   */
  readonly total: number
  /**
   * Output tokens reserved out of `total`.
   * 中文：从 `total` 中预留的输出 token 数。
   */
  readonly reserved: number
  /**
   * `total - reserved`, at least 1: the denominator for pressure and reminders.
   * 中文：`total - reserved`，至少为 1：压力和提醒的 denominator。
   */
  readonly effective: number
  readonly source: WindowSource
  readonly reservationSource: ReservationSource
}

/**
 * Inputs of {@link planWindow}.
 * 中文：{@link planWindow} 的输入。
 */
export interface WindowInputs {
  /**
   * `contextWindowTokens` config override (total, not effective).
   * 中文：`contextWindowTokens` 配置覆盖（总容量，不是有效容量）。
   */
  readonly configTotal: number | null
  /**
   * `reservedOutputTokens` config override.
   * 中文：`reservedOutputTokens` 配置覆盖。
   */
  readonly configReserved: number | null
  /**
   * `request/context.contextWindow` recorded by the harness.
   * 中文：宿主记录的 `request/context.contextWindow`。
   */
  readonly requestTotal: number | undefined
  /**
   * Latest `request/header.config.maxTokens`.
   * 中文：最新 `request/header.config.maxTokens`。
   */
  readonly headerReserved: number | null
  /**
   * Fallback total when neither config nor the route supplies one.
   * 中文：配置和路由都没有提供总容量时的后备值。
   */
  readonly fallbackTotal: number
}

/**
 * Resolve the effective window from config, the route, and the request header.
 * 中文：从配置、路由和请求 header 解析有效窗口。
 */
export function planWindow(inputs: WindowInputs): WindowPlan {
  const total = inputs.configTotal ?? inputs.requestTotal ?? inputs.fallbackTotal
  const reservation = inputs.configReserved ?? inputs.headerReserved ?? 0
  const reserved = Math.min(Math.max(0, reservation), Math.max(0, total - 1))
  const source: WindowSource = inputs.configTotal !== null
    ? 'config'
    : inputs.requestTotal !== undefined ? 'request' : 'default'
  const reservationSource: ReservationSource = inputs.configReserved !== null
    ? 'config'
    : inputs.headerReserved !== null ? 'header' : 'none'
  return { total, reserved, effective: Math.max(1, total - reserved), source, reservationSource }
}

/**
 * Read the output reservation from the latest `request/header` snapshot.
 *
 * 中文：从最新 `request/header` 快照读取输出预留。
 *
 * @param session - session whose committed events contain the header.
 * 中文：已提交事件中包含 header 的 session。
 * @returns `header.config.maxTokens` when a header carries a positive integer, else null.
 * 中文：header 携带正整数时返回 `header.config.maxTokens`，否则返回 null。
 */
export function reservedOutputTokensOf(session: SessionLike): number | null {
  const events = session.snapshotEvents()
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]!
    if (event.type !== 'request/header') continue
    if (!isRecord(event.data)) return null
    const header = event.data['header']
    if (!isRecord(header)) return null
    const config = header['config']
    if (!isRecord(config)) return null
    const maxTokens = config['maxTokens']
    if (typeof maxTokens === 'number' && Number.isSafeInteger(maxTokens) && maxTokens > 0) return maxTokens
    return null
  }
  return null
}

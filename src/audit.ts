/**
 * Request-level audit sidecar.
 *
 * One JSONL line per decorated conversation request under
 * `$DSH_HOME/context-decay/audit.jsonl`. Each line records what the decoration
 * layer added to that request (message/anchor counts, first/last position, live
 * block pairs, estimated anchor cost, decorator identities) — never message
 * text. The session log plus the rule version remains the source of truth; the
 * sidecar makes the per-request result auditable without re-running rules that
 * may have changed since (DESIGN.md appendix D.3 option B).
 *
 * Audit writes are diagnostics: a failed write must never fail a model
 * request, so `write` swallows and reports errors to the debug log.
 *
 * 中文：请求级审计 sidecar。
 * `$DSH_HOME/context-decay/audit.jsonl` 下每个已装饰会话请求一行 JSONL。每行记录装饰层
 * 给该请求加了什么（消息/锚点数量、首末位置、live 块配对、锚点成本估算、decorator 身份），
 * 从不记录消息正文。session 日志加规则版本仍是事实来源；sidecar 让每次请求的结果可审计，
 * 不必重跑可能已经变化的规则（DESIGN.md 附录 D.3 方案 B）。
 * 审计写入是诊断：写入失败绝不能导致模型请求失败，所以 `write` 吞掉错误并报告到
 * debug 日志。
 */

import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

/**
 * One live summary block as seen by the request that was audited.
 * 中文：被审计请求看到的一个 live 摘要块。
 */
export interface AuditBlock {
  readonly from: number
  readonly to: number | null
  readonly tier: number
}

/**
 * One decorator identity recorded on every audit line.
 * 中文：每行审计都记录的一个 decorator 身份。
 */
export interface AuditDecorator {
  readonly id: string
  readonly version: string
}

/**
 * One audit line (schema version 1).
 * 中文：一行审计（schema 版本 1）。
 */
export interface AuditRecord {
  readonly v: 1
  readonly time: string
  readonly sessionId: string
  /**
   * 1-based request counter per session, reset when the session object is recreated.
   * 中文：每个 session 从 1 开始的请求计数；session 对象重建时重置。
   */
  readonly requestIndex: number
  /**
   * 1-based model-response ordinal in this session; durable across process restarts.
   * 中文：本会话内从 1 开始的模型回复序号；跨进程重启持久。
   */
  readonly sessionRequest: number
  readonly messages: number
  readonly anchors: number
  readonly first: number | null
  readonly last: number | null
  readonly blocks: readonly AuditBlock[]
  readonly overheadTokens: number
  readonly decorators: readonly AuditDecorator[]
  readonly scope: 'conversation'
}

/**
 * Rotate the audit file once it reaches this size (one previous generation is kept).
 * 中文：审计文件达到该大小时轮转（保留上一代）。
 */
export const AUDIT_MAX_BYTES = 8 * 1024 * 1024

/**
 * Default path of the request audit document.
 * 中文：请求审计文档的默认路径。
 */
export function auditPath(): string {
  const home = process.env['DSH_HOME']?.trim()
  const base = home !== undefined && home.length > 0 ? home : join(homedir(), '.dsh')
  return join(base, 'context-decay', 'audit.jsonl')
}

/**
 * Append-only JSONL audit writer.
 * 中文：只追加的 JSONL 审计写入器。
 */
export class AuditWriter {
  constructor(
    private readonly file: string = auditPath(),
    private readonly log: (line: string) => void = () => {},
  ) {}

  /**
   * Append one record; errors are logged and never propagated.
   * 中文：追加一条记录；错误只记录日志，绝不向外传播。
   */
  write(record: AuditRecord): void {
    try {
      mkdirSync(dirname(this.file), { recursive: true })
      this.rotateIfNeeded()
      appendFileSync(this.file, `${JSON.stringify(record)}\n`, 'utf8')
    } catch (error) {
      this.log(`audit write failed for ${this.file}: ${String(error)}`)
    }
  }

  /**
   * Keep the newest generation at `file` and move the full one to `file.1`.
   * 中文：把最新一代留在 `file`，把写满的一代移到 `file.1`。
   */
  private rotateIfNeeded(): void {
    try {
      if (statSync(this.file).size < AUDIT_MAX_BYTES) return
      renameSync(this.file, `${this.file}.1`)
    } catch (error) {
      // A missing file is the normal first-write path; anything else is real.
      // 中文：文件不存在是正常的首次写入路径；其他错误才是真的。
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
}

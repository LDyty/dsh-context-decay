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
import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
/**
 * Rotate the audit file once it reaches this size (one previous generation is kept).
 * 中文：审计文件达到该大小时轮转（保留上一代）。
 */
export const AUDIT_MAX_BYTES = 8 * 1024 * 1024;
/**
 * Default path of the request audit document.
 * 中文：请求审计文档的默认路径。
 */
export function auditPath() {
    const home = process.env['DSH_HOME']?.trim();
    const base = home !== undefined && home.length > 0 ? home : join(homedir(), '.dsh');
    return join(base, 'context-decay', 'audit.jsonl');
}
/**
 * Append-only JSONL audit writer.
 * 中文：只追加的 JSONL 审计写入器。
 */
export class AuditWriter {
    file;
    log;
    constructor(file = auditPath(), log = () => { }) {
        this.file = file;
        this.log = log;
    }
    /**
     * Append one record; errors are logged and never propagated.
     * 中文：追加一条记录；错误只记录日志，绝不向外传播。
     */
    write(record) {
        try {
            mkdirSync(dirname(this.file), { recursive: true });
            this.rotateIfNeeded();
            appendFileSync(this.file, `${JSON.stringify(record)}\n`, 'utf8');
        }
        catch (error) {
            this.log(`audit write failed for ${this.file}: ${String(error)}`);
        }
    }
    /**
     * Keep the newest generation at `file` and move the full one to `file.1`.
     * 中文：把最新一代留在 `file`，把写满的一代移到 `file.1`。
     */
    rotateIfNeeded() {
        try {
            if (statSync(this.file).size < AUDIT_MAX_BYTES)
                return;
            renameSync(this.file, `${this.file}.1`);
        }
        catch (error) {
            // A missing file is the normal first-write path; anything else is real.
            // 中文：文件不存在是正常的首次写入路径；其他错误才是真的。
            if (error.code !== 'ENOENT')
                throw error;
        }
    }
}

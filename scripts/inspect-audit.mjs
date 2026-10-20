#!/usr/bin/env node
/**
 * Summarize and validate a request-audit JSONL file.
 *
 * Usage:
 *   node scripts/inspect-audit.mjs [audit.jsonl] [--json]
 *
 * The file defaults to `$DSH_HOME/context-decay/audit.jsonl`. Validation checks
 * the schema version v1, the required fields, and that each session's
 * requestIndex strictly increases. Exit code 2 means the file was readable but
 * had problems; exit code 1 means it could not be read.
 *
 * 中文：汇总并校验请求审计 JSONL 文件。
 * 用法：
 *   node scripts/inspect-audit.mjs [audit.jsonl] [--json]
 * 文件默认为 `$DSH_HOME/context-decay/audit.jsonl`。校验内容包括 schema 版本 v1、必需
 * 字段，以及每个 session 的 requestIndex 严格递增。退出码 2 表示文件可读但有问题；
 * 退出码 1 表示文件无法读取。
 */

import { readFileSync } from 'node:fs'
import { auditPath } from '../lib/audit.js'

const args = process.argv.slice(2)
const json = args.includes('--json')
const file = args.find(arg => !arg.startsWith('--')) ?? auditPath()

let raw
try {
  raw = readFileSync(file, 'utf8')
} catch (error) {
  console.error(`inspect-audit: cannot read ${file}: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
}

const REQUIRED = [
  'v', 'time', 'sessionId', 'requestIndex', 'messages', 'anchors',
  'first', 'last', 'blocks', 'overheadTokens', 'decorators', 'scope',
]

const records = []
const problems = []
const lastIndex = new Map()
for (const [position, line] of raw.split('\n').entries()) {
  if (line.trim().length === 0) continue
  let record
  try {
    record = JSON.parse(line)
  } catch (error) {
    problems.push(`line ${position + 1}: invalid JSON (${error instanceof Error ? error.message : String(error)})`)
    continue
  }
  for (const key of REQUIRED) {
    if (!(key in record)) problems.push(`line ${position + 1}: missing "${key}"`)
  }
  if (record.v !== 1) problems.push(`line ${position + 1}: unknown schema version ${JSON.stringify(record.v)}`)
  if (!Array.isArray(record.blocks)) problems.push(`line ${position + 1}: "blocks" is not an array`)
  if (!Array.isArray(record.decorators)) problems.push(`line ${position + 1}: "decorators" is not an array`)
  if (record.sessionRequest !== undefined && !Number.isSafeInteger(record.sessionRequest)) {
    problems.push(`line ${position + 1}: "sessionRequest" is not an integer`)
  }
  if (typeof record.requestIndex === 'number') {
    const previous = lastIndex.get(record.sessionId)
    if (previous !== undefined && record.requestIndex <= previous) {
      problems.push(`line ${position + 1}: requestIndex ${record.requestIndex} does not increase for ${record.sessionId} (previous ${previous})`)
    }
    lastIndex.set(record.sessionId, record.requestIndex)
  }
  records.push(record)
}

const sessions = new Map()
for (const record of records) {
  let session = sessions.get(record.sessionId)
  if (session === undefined) {
    session = { sessionId: record.sessionId, requests: 0, lastRequestIndex: 0, lastSessionRequest: 0, anchors: 0, maxAnchors: 0, overheadTokens: 0 }
    sessions.set(record.sessionId, session)
  }
  session.requests += 1
  session.lastRequestIndex = record.requestIndex
  session.lastSessionRequest = record.sessionRequest ?? session.lastSessionRequest
  session.anchors += record.anchors
  session.maxAnchors = Math.max(session.maxAnchors, record.anchors)
  session.overheadTokens += record.overheadTokens
}

const latest = records.at(-1) ?? null
if (json) {
  console.log(JSON.stringify({
    file,
    requests: records.length,
    problems,
    sessions: [...sessions.values()],
    latest,
  }, null, 2))
} else {
  console.log(`audit file: ${file}`)
  console.log(`requests: ${records.length}, sessions: ${sessions.size}, problems: ${problems.length}`)
  for (const session of sessions.values()) {
    console.log(
      `- ${session.sessionId}: ${session.requests} request(s), process #${session.lastRequestIndex}, `
      + `session #${session.lastSessionRequest}, ${session.anchors} anchors total (max ${session.maxAnchors}), `
      + `${session.overheadTokens} tok overhead`,
    )
  }
  if (latest !== null) {
    console.log(
      `latest: session #${latest.sessionRequest ?? '?'} (process #${latest.requestIndex}) `
      + `${latest.anchors}/${latest.messages} anchors, `
      + `${latest.overheadTokens} tok overhead, blocks ${JSON.stringify(latest.blocks)}`,
    )
  }
  if (problems.length > 0) for (const problem of problems) console.error(`problem: ${problem}`)
}

if (problems.length > 0) process.exitCode = 2

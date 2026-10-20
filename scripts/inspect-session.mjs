/**
 * Dump the relevant event types and compression transactions of one stored session.
 *
 * Usage: node scripts/inspect-session.mjs <session.jsonl.zstd> <out.jsonl>
 *
 * 中文：导出某个已存储 session 的相关事件类型和压缩事务。
 * 用法：node scripts/inspect-session.mjs <session.jsonl.zstd> <out.jsonl>
 */

import { readFileSync, writeFileSync } from "node:fs"
import { zstdDecompressSync } from "node:zlib"
const file = process.argv[2]
const outFile = process.argv[3]
const buffer = readFileSync(file)
const magic = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])
const offsets = []
for (let i = 0; i <= buffer.length - 4; i += 1) if (buffer[i] === magic[0] && buffer[i+1] === magic[1] && buffer[i+2] === magic[2] && buffer[i+3] === magic[3]) offsets.push(i)
let text = ""
for (let i = 0; i < offsets.length; i += 1) {
  const start = offsets[i]
  const end = i + 1 < offsets.length ? offsets[i+1] : buffer.length
  try { text += zstdDecompressSync(buffer.subarray(start, end)).toString("utf8") } catch {}
}
writeFileSync(outFile, text)
const events = text.split("\n").filter(Boolean).map(line => JSON.parse(line))
const counts = {}
for (const event of events) counts[event.type] = (counts[event.type] ?? 0) + 1
console.log("EVENTS", events.length)
console.log(JSON.stringify(counts))
for (const event of events) {
  if (event.type === "compaction/summary") {
    const d = event.data
    console.log("\n=== compaction/summary seq=" + event.seq + " ===")
    console.log("shadowedRange", JSON.stringify(d.shadowedRange), "shadowedSeqs", d.shadowedSeqs.length, "shadowedTokens", d.shadowedTokenCount)
    console.log("provider", d.provider, "model", d.model)
    console.log("rawOutput", JSON.stringify(d.rawOutput))
    console.log("summaryText", JSON.stringify(d.summary))
  }
  if (event.type === "compaction/prune") console.log("\n=== compaction/prune seq=" + event.seq + " " + JSON.stringify(event.data))
  if (event.type === "user/message" && event.surfaceOp?.op === "replace") {
    console.log("\n=== replace user/message seq=" + event.seq + " surfaceOp=" + JSON.stringify(event.surfaceOp) + " ===")
    console.log("source", JSON.stringify(event.data.source), "chars", event.data.content.reduce((n,b) => n + (b.text?.length ?? 0), 0), "sourceEventSeqs", event.sourceEventSeqs?.length)
  }
  if (event.type === "system/message" && event.surfaceOp?.op === "replace") {
    console.log("\n=== replace system/message seq=" + event.seq + " surfaceOp=" + JSON.stringify(event.surfaceOp) + " ===")
    console.log("source", JSON.stringify(event.data.message.source), "content", JSON.stringify(event.data.message.content))
  }
  if (event.type === "user/message" && event.data?.source?.kind === "context-decay" && event.data.source.form === "notice") {
    console.log("\n=== reminder seq=" + event.seq + " source=" + JSON.stringify(event.data.source))
    console.log("text", JSON.stringify(event.data.content))
  }
}

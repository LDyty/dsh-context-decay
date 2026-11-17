/**
 * Print the replayed anchor space of one stored session (multi-frame zstd).
 *
 * Usage: node scripts/inspect-positions.mjs <session.jsonl.zstd> [out.jsonl] [session-id]
 *
 * 中文：打印一个已存储 session 的重放锚点空间（多帧 zstd）。
 * 用法：node scripts/inspect-positions.mjs <session.jsonl.zstd> [out.jsonl] [session-id]
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { zstdDecompressSync } from 'node:zlib'
import { foldAll } from '../lib/state.js'

const file = process.argv[2]
const outFile = process.argv[3]
const sessionId = process.argv[4]
const buffer = readFileSync(file)
const magic = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])
const offsets = []
for (let i = 0; i <= buffer.length - 4; i += 1) {
  if (buffer[i] === magic[0] && buffer[i + 1] === magic[1] && buffer[i + 2] === magic[2] && buffer[i + 3] === magic[3]) offsets.push(i)
}
let text = ''
for (let i = 0; i < offsets.length; i += 1) {
  const start = offsets[i]
  const end = i + 1 < offsets.length ? offsets[i + 1] : buffer.length
  try { text += zstdDecompressSync(buffer.subarray(start, end)).toString('utf8') } catch {}
}
if (outFile !== undefined) writeFileSync(outFile, text)
const events = text.split('\n').filter(Boolean).map(line => JSON.parse(line))
const state = foldAll(events, sessionId)

console.log(`events=${events.length} allocated=${state.allocated} free=${state.free.length} reused=${state.reusedPositions}`)
console.log('surface nodes (left/right/block/role/tokens):')
for (const node of state.nodes) {
  console.log(`  seq=${node.seq} left=${node.left === null ? '-' : `#${node.left}`} right=${node.right === null ? '-' : `#${node.right}`} block=${node.block ? 'yes' : 'no'} role=${node.role} tokens=${node.tokens}`)
}
const visible = state.nodes.filter(node => node.left !== null).map(node => node.left)
console.log(`visible anchors (surface order): ${visible.map(value => `#${value}`).join(' ')}`)
console.log(`unique=${new Set(visible).size === visible.length}`)
console.log(`free anchors: ${state.free.map(value => `#${value}`).join(' ') || '(none)'}`)
console.log(`refs: ${Object.entries(state.refs).sort(([left], [right]) => left.localeCompare(right)).map(([anchor, count]) => `#${anchor}x${count}`).join(' ') || '(none)'}`)
console.log(`anchor pool: ${state.anchorPool.length} pre-generated, seed=${state.anchorSeed}`)

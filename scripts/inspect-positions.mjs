/**
 * Print the replayed position space of one stored session (multi-frame zstd).
 *
 * Usage: node scripts/inspect-positions.mjs <session.jsonl.zstd> [out.jsonl]
 *
 * 中文：打印一个已存储 session 的重放位置空间（多帧 zstd）。
 * 用法：node scripts/inspect-positions.mjs <session.jsonl.zstd> [out.jsonl]
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { zstdDecompressSync } from 'node:zlib'
import { foldAll } from '../lib/state.js'

const file = process.argv[2]
const outFile = process.argv[3]
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
const state = foldAll(events)

console.log(`events=${events.length} allocated=${state.nextPosition} free=${state.free.length} reused=${state.reusedPositions}`)
console.log('surface nodes (left/right/block/role/tokens):')
for (const node of state.nodes) {
  console.log(`  seq=${node.seq} left=${node.left ?? '-'} right=${node.right ?? '-'} block=${node.block ? 'yes' : 'no'} role=${node.role} tokens=${node.tokens}`)
}
const visible = state.nodes.filter(node => node.left !== null).map(node => node.left)
console.log(`visible anchors (surface order): ${visible.map(value => `#${value}`).join(' ')}`)
const increasing = visible.every((value, index) => index === 0 || value > visible[index - 1])
console.log(`monotonic=${increasing}`)
console.log(`free ids: ${state.free.map(value => `#${value}`).join(' ') || '(none)'}`)
console.log(`refs: ${Object.entries(state.refs).map(([position, count]) => [Number(position), count]).sort((left, right) => left[0] - right[0]).map(([position, count]) => `#${position}x${count}`).join(' ') || '(none)'}`)

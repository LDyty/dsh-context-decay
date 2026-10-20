#!/usr/bin/env node
/**
 * Verify the distributed host patches are LF-only and byte-identical.
 *
 * `git apply` matches patch context exactly. A CRLF copy makes every hunk
 * mismatch on an LF checkout, which looks like a wrong DSH revision instead of
 * a packaging defect.
 */
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const patches = [
  new URL('../patches/dsh-model-message-decoration.patch', import.meta.url),
  new URL('../release/dsh-model-message-decoration.patch', import.meta.url),
]

let failed = false
let first
for (const url of patches) {
  const bytes = await readFile(url)
  const cr = bytes.reduce((count, byte) => count + (byte === 13 ? 1 : 0), 0)
  const lf = bytes.reduce((count, byte) => count + (byte === 10 ? 1 : 0), 0)
  process.stdout.write(`${fileURLToPath(url)}: ${bytes.byteLength} bytes, ${lf} LF, ${cr} CR\n`)
  if (first === undefined) first = bytes
  else if (!bytes.equals(first)) failed = true
  if (cr !== 0 || lf === 0) failed = true
}
if (failed) {
  process.stderr.write('check-host-patch: patch files must be LF-only and byte-identical; '
    + 'CRLF or a diverged copy makes git apply reject every hunk\n')
  process.exitCode = 1
}

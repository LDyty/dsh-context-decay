#!/usr/bin/env node
/**
 * Copy the source host patch into the ignored `release/` staging directory.
 *
 * `release/` is a local-only release workspace and is not committed. The
 * `check:patch` script compares the staged copy with `patches/`; run this
 * first on a fresh checkout.
 */
import { copyFile, mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const source = new URL('../patches/dsh-model-message-decoration.patch', import.meta.url)
const target = new URL('../release/dsh-model-message-decoration.patch', import.meta.url)

await mkdir(new URL('../release/', import.meta.url), { recursive: true })
await copyFile(source, target)
process.stdout.write(`prepared ${fileURLToPath(target)}\n`)

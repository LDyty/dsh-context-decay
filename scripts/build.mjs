/**
 * Build helper: compile `src/` to `lib/` and emit declarations.
 *
 * Resolution order for TypeScript:
 *   1. `node_modules/typescript` in this package (normal published build);
 *   2. a DSH checkout's TypeScript (local development without install).
 *
 * The checkout is discovered from DSH_HARNESS_ROOT, then the conventional
 * sibling directories. Set DSH_HARNESS_ROOT when your checkout lives elsewhere.
 *
 * 中文：构建辅助脚本：把 `src/` 编译到 `lib/` 并生成声明文件。
 * TypeScript 解析顺序：
 *   1. 本包 `node_modules/typescript`（正常的发布构建）；
 *   2. DSH checkout 里的 TypeScript（没有安装依赖的本地开发）。
 * checkout 依次从 DSH_HARNESS_ROOT、约定的同级目录发现。checkout 在别处时设置
 * DSH_HARNESS_ROOT。
 */

import { spawnSync } from 'node:child_process'
import { existsSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const project = resolve(here, '..')
const tsconfig = join(project, 'tsconfig.json')
const check = process.argv.includes('--check')

function localTypeScript() {
  try {
    const require = createRequire(join(project, 'package.json'))
    return require.resolve('typescript/bin/tsc')
  } catch {
    return null
  }
}

function harnessRoot() {
  const configured = process.env['DSH_HARNESS_ROOT']
  const candidates = [
    configured,
    resolve(project, '..', 'deepseek-harness'),
    resolve(project, '..', 'deepseek-harness-latest-version'),
  ].filter(value => typeof value === 'string' && value.length > 0)
  for (const candidate of candidates) {
    if (existsSync(join(candidate, 'node_modules', 'typescript', 'bin', 'tsc'))) {
      return resolve(candidate)
    }
  }
  return null
}

const local = localTypeScript()
const harness = local === null ? harnessRoot() : null
if (local === null && harness === null) {
  console.error(
    '[context-decay] TypeScript not found. Run `npm install` in this package, '
    + 'or set DSH_HARNESS_ROOT to a DSH checkout with node_modules installed.',
  )
  process.exit(1)
}

const tsc = local ?? join(harness, 'node_modules', 'typescript', 'bin', 'tsc')
const args = ['-p', tsconfig]
if (check) args.push('--noEmit')
if (local === null) args.push('--typeRoots', join(harness, 'node_modules', '@types'))

if (!check) {
  // Remove stale outputs (for example a deleted source module) before emitting.
  // 中文：生成前删除陈旧产物（例如已删除的源模块）。
  rmSync(join(project, 'lib'), { recursive: true, force: true })
}

const result = spawnSync(process.execPath, [tsc, ...args], {
  cwd: project,
  stdio: 'inherit',
})

if (result.error !== undefined) {
  console.error(`[context-decay] failed to launch tsc: ${String(result.error)}`)
  process.exit(1)
}
process.exit(result.status ?? 1)

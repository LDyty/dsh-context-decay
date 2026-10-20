/**
 * Build the browser half: bundle `client/index.jsx` into the lazy-CJS plugin
 * factory the DSH client module loader expects.
 *
 * The bundle resolves React through the shell's module table (`require(...)`
 * inside the factory) and inlines everything else. No web rebuild is needed:
 * the host serves `lib/client.js` under /plugins for enabled Loader entries
 * that declare `dsh.client`.
 *
 * 中文：构建浏览器端：把 `client/index.jsx` 打成 DSH client module loader 期望的
 * lazy-CJS 插件工厂。
 * bundle 通过 shell 的 module table 解析 React（工厂内部的 `require(...)`），其余全部
 * inline。不需要重建 web：宿主会在 /plugins 下提供 `lib/client.js`，只要已启用的 Loader
 * 条目声明了 `dsh.client`。
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const project = resolve(here, '..')
const configured = process.env['DSH_HARNESS_ROOT']
const candidates = [
  configured,
  resolve(project, '..', 'deepseek-harness'),
  resolve(project, '..', 'deepseek-harness-latest-version'),
].filter(value => typeof value === 'string' && value.length > 0)
const harness = candidates.find(value => {
  try {
    createRequire(join(value, 'package.json')).resolve('tsdown')
    return true
  } catch {
    return false
  }
})
if (harness === undefined) {
  console.error(
    '[context-decay] client build needs a DSH checkout with tsdown installed. '
    + 'Set DSH_HARNESS_ROOT to that checkout. Published packages ship prebuilt lib/client.js.',
  )
  process.exit(1)
}
const manifest = JSON.parse(readFileSync(join(project, 'package.json'), 'utf8'))
const packageName = manifest.name

const harnessRequire = createRequire(join(harness, 'package.json'))
const tsdownEntry = harnessRequire.resolve('tsdown')
const { Rolldown } = await import(pathToFileURL(tsdownEntry).href)

const bundle = await Rolldown.rolldown({
  input: join(project, 'client', 'index.jsx'),
  external: ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client'],
  platform: 'browser',
  transform: { jsx: 'react-jsx' },
})
const generated = await bundle.generate({
  format: 'cjs',
  exports: 'named',
  sourcemap: false,
})
const chunk = generated.output.find(output => output.type === 'chunk')
if (chunk === undefined) throw new Error('build-client: rolldown produced no chunk')

const banner = `window.__ModuleLoader__.load({ id: ${JSON.stringify(packageName)}, factory: (require) => {\n`
const intro = 'var module = { exports: {} }; var exports = module.exports;\n'
const footer = '\nreturn module.exports;\n} });\n'

const output = `${banner}${intro}${chunk.code}\n${footer}`
const target = join(project, 'lib', 'client.js')
mkdirSync(dirname(target), { recursive: true })
writeFileSync(target, output)
console.log(`[context-decay] client bundle: ${target} (${Buffer.byteLength(output)} bytes)`)

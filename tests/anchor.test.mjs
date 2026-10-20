/**
 * Anchor argument forms: the model can pass the visible `⟦pN⟧` text,
 * a bare `pN`, a decimal string, or an integer. `to` also accepts
 * `"end"`.
 *
 * 中文：锚点参数形式：模型可以传可见的 `⟦pN⟧`、裸 `pN`、十进制字符串或整数；
 * `to` 还接受 `"end"`。
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseAnchorArgument, parseAnchorBound } from '../lib/anchor.js'

test('anchor arguments accept visible, bare, string, and integer forms', () => {
  for (const value of ['⟦p12⟧', 'p12', '12', 12, '  ⟦p12⟧  ']) {
    assert.equal(parseAnchorArgument(value), 12, JSON.stringify(value))
  }
  for (const value of ['end', '⟦p-1⟧', 'p', '-1', 1.5, -1, null, undefined, {}]) {
    assert.equal(parseAnchorArgument(value), null, JSON.stringify(value))
  }
})

test('bound parsing keeps the "end" sentinel separate from anchor text', () => {
  assert.equal(parseAnchorBound('end'), 'end')
  assert.equal(parseAnchorBound('⟦p20⟧'), 20)
  assert.equal(parseAnchorBound(20), 20)
  assert.equal(parseAnchorBound('END'), null)
  assert.equal(parseAnchorBound('⟦pend⟧'), null)
})

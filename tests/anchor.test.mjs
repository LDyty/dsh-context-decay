/**
 * Anchor arguments and pool behavior: visible `⟦#a8c5⟧`, bare `#a8c5`,
 * and raw `a8c5` forms; `to` also accepts `end`.
 *
 * 中文：锚点参数与锚点池行为：接受可见 `⟦#a8c5⟧`、裸 `#a8c5`、裸 `a8c5`；
 * `to` 还接受 `end`。
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  ANCHOR_POOL_INITIAL,
  ANCHOR_POOL_LOW_WATER,
  formatAnchor,
  generateAnchor,
  parseAnchor,
  parseAnchorArgument,
  parseAnchorBound,
  stripAnchors,
  stripLeadingAnchors,
} from '../lib/anchor.js'
import { createState } from '../lib/state.js'
import { FakeSession, foldSession } from './helpers.mjs'

const A = 'a8c5'
const B = 'c9d1'

test('anchor arguments accept visible, bare, raw, and padded forms', () => {
  for (const value of ['⟦#a8c5⟧', '#a8c5', 'a8c5', '  ⟦#A8C5⟧  ', '  #A8C5  ']) {
    assert.equal(parseAnchorArgument(value), A, JSON.stringify(value))
  }
  for (const value of ['end', '⟦p12⟧', 'p12', 12, 'a8c', 'a8c55', '', null, undefined, {}]) {
    assert.equal(parseAnchorArgument(value), null, JSON.stringify(value))
  }
})

test('bound parsing keeps the "end" sentinel separate from anchor text', () => {
  assert.equal(parseAnchorBound('end'), 'end')
  assert.equal(parseAnchorBound('⟦#c9d1⟧'), B)
  assert.equal(parseAnchorBound('#c9d1'), B)
  assert.equal(parseAnchorBound('END'), null)
  assert.equal(parseAnchorBound('⟦#end⟧'), null)
})

test('format, parse, and strip use the new four-character form', () => {
  assert.equal(formatAnchor(A), '⟦#a8c5⟧')
  assert.equal(parseAnchor('⟦#a8c5⟧ text'), A)
  assert.equal(parseAnchor('text only'), null)
  assert.equal(stripLeadingAnchors('⟦#a8c5⟧ ⟦#c9d1⟧ reply'), 'reply')
  assert.equal(stripLeadingAnchors('⟦#A8C5⟧ reply'), 'reply')
  assert.equal(stripAnchors('see ⟦#a8c5⟧ and [#3]'), 'see and [#3]')
  assert.equal(stripAnchors('see ⟦#A8C5⟧ and [#3]'), 'see and [#3]')
  assert.equal(stripAnchors('keep [a8c5] as ordinary content'), 'keep [a8c5] as ordinary content')
})

test('the generated pool is unique and deterministic for a seed', () => {
  const first = createState('session-anchor-pool')
  assert.equal(first.anchorPool.length, ANCHOR_POOL_INITIAL)
  assert.equal(new Set(first.anchorPool).size, first.anchorPool.length)
  for (const anchor of first.anchorPool) assert.match(anchor, /^[a-z0-9]{4}$/)
  // `createState` consumes the same generator stream: same seed, same pool.
  const second = createState('session-anchor-pool')
  assert.deepEqual(second.anchorPool, first.anchorPool)
  const other = createState('another-session')
  assert.notDeepEqual(other.anchorPool, first.anchorPool)
})

test('generation is stable and collision-free for sequential counters', () => {
  const seen = new Set()
  for (let counter = 0; counter < 500; counter += 1) {
    const anchor = generateAnchor('stable-seed', counter)
    assert.match(anchor, /^[a-z0-9]{4}$/)
    seen.add(anchor)
  }
  assert.equal(seen.size, 500)
})

test('the pool refills before it runs dry', () => {
  const session = new FakeSession()
  session.turnStart()
  const count = ANCHOR_POOL_INITIAL + 20
  for (let index = 0; index < count; index += 1) session.user(`message ${index}`)
  const state = foldSession(session)
  assert.equal(state.allocated, count)
  assert.equal(state.issued.length, count)
  assert.equal(new Set(state.issued).size, state.issued.length)
  assert.ok(state.anchorPool.length >= ANCHOR_POOL_LOW_WATER)
})

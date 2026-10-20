/**
 * Effective-window resolution: the denominator is the total route capacity
 * minus the output reservation recorded in the latest request header.
 *
 * 中文：有效窗口解析：denominator 是路由总容量减去最新请求 header 里记录的输出预留。
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { planWindow, reservedOutputTokensOf } from '../lib/window.js'
import { FakeSession } from './helpers.mjs'

const BASE = {
  configTotal: null,
  configReserved: null,
  requestTotal: undefined,
  headerReserved: null,
  fallbackTotal: 200_000,
}

test('a 1M route with a 256K output reservation resolves to a 744K effective window', () => {
  const plan = planWindow({ ...BASE, requestTotal: 1_000_000, headerReserved: 256_000 })
  assert.deepEqual(plan, {
    total: 1_000_000,
    reserved: 256_000,
    effective: 744_000,
    source: 'request',
    reservationSource: 'header',
  })
})

test('config overrides both the total and the reservation', () => {
  const plan = planWindow({
    ...BASE,
    configTotal: 60_000,
    configReserved: 2_000,
    requestTotal: 1_000_000,
    headerReserved: 256_000,
  })
  assert.deepEqual(plan, {
    total: 60_000,
    reserved: 2_000,
    effective: 58_000,
    source: 'config',
    reservationSource: 'config',
  })
})

test('the reservation is clamped below the total and the window never reaches zero', () => {
  const plan = planWindow({ ...BASE, requestTotal: 10_000, headerReserved: 50_000 })
  assert.equal(plan.reserved, 9_999)
  assert.equal(plan.effective, 1)
})

test('without a route or a header the fallback total is used with no reservation', () => {
  const plan = planWindow(BASE)
  assert.deepEqual(plan, {
    total: 200_000,
    reserved: 0,
    effective: 200_000,
    source: 'default',
    reservationSource: 'none',
  })
})

test('the latest request header supplies the reservation', () => {
  const session = new FakeSession()
  session.append('request/header', { header: { config: { provider: 'p', model: 'm', maxTokens: 256_000 } }, reason: 'initial' })
  session.append('request/header', { header: { config: { provider: 'p', model: 'm', maxTokens: 8_192 } }, reason: 'change' })
  assert.equal(reservedOutputTokensOf(session), 8_192)

  const bare = new FakeSession()
  bare.append('request/header', { header: { config: { provider: 'p', model: 'm' } }, reason: 'initial' })
  assert.equal(reservedOutputTokensOf(bare), null)
})

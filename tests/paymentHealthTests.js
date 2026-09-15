'use strict'

const assert = require('assert')
const paymentHealth = require('../lib/paymentHealth.js')

const now = 200000

assert.strictEqual(paymentHealth.status('ok', now, now, true), 'ok')
assert.strictEqual(paymentHealth.status('ok', now - paymentHealth.ONE_DAY_SECONDS, now, true), 'ok')
assert.strictEqual(paymentHealth.status('ok', now - paymentHealth.ONE_DAY_SECONDS - 1, now, true), 'warn')
assert.strictEqual(paymentHealth.status('ok', now - paymentHealth.TWO_DAYS_SECONDS, now, true), 'warn')
assert.strictEqual(paymentHealth.status('ok', now - paymentHealth.TWO_DAYS_SECONDS - 1, now, true), 'fail')
assert.strictEqual(paymentHealth.status('ok', null, now, true), 'fail')
assert.strictEqual(paymentHealth.status('fail', now, now, true), 'fail')
assert.strictEqual(paymentHealth.status('unknown', now, now, true), 'unknown')
assert.strictEqual(paymentHealth.status('fail', null, now, false), 'disabled')

assert.strictEqual(paymentHealth.lastPaymentScore(['transaction', '12345']), 12345)
assert.strictEqual(paymentHealth.lastPaymentScore([]), null)
assert.strictEqual(paymentHealth.lastPaymentScore(null), null)

console.log('payment health tests passed')

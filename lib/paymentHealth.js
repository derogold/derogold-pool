'use strict'

const ONE_DAY_SECONDS = 24 * 60 * 60
const TWO_DAYS_SECONDS = 2 * ONE_DAY_SECONDS

function status (walletStatus, lastPayment, now, enabled) {
  if (enabled === false) return 'disabled'
  if (walletStatus === 'fail') return 'fail'

  const paymentTime = Number(lastPayment)
  if (!Number.isFinite(paymentTime) || paymentTime <= 0) return 'fail'

  const age = Math.max(0, Number(now) - paymentTime)
  const paymentStatus = age <= ONE_DAY_SECONDS
    ? 'ok'
    : age <= TWO_DAYS_SECONDS ? 'warn' : 'fail'

  if (paymentStatus !== 'ok') return paymentStatus
  return walletStatus || 'unknown'
}

function lastPaymentScore (reply) {
  if (!Array.isArray(reply) || reply.length < 2) return null
  const score = Number(reply[1])
  return Number.isFinite(score) && score > 0 ? score : null
}

module.exports = {
  ONE_DAY_SECONDS,
  TWO_DAYS_SECONDS,
  status,
  lastPaymentScore
}

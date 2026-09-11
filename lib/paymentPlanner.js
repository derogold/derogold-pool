'use strict'

function createTransferCommands (context, payments, unlockedBalance) {
  var transferCommands = []
  var addresses = 0
  var commandAmount = 0
  var commandIndex = 0
  var unlockedRemaining = unlockedBalance
  var transferFee = parseInt(context.payments.transferFee) || 0
  var denomination = parseInt(context.payments.denomination) || 1

  for (var worker in payments) {
    var payment = payments[worker]
    if (payment.paymentId && addresses !== 0) {
      commandIndex++
      addresses = 0
      commandAmount = 0
    }

    var amount = parseInt(payment.amount)
    if (context.payments.maxTransactionAmount && amount + commandAmount > context.payments.maxTransactionAmount) {
      amount = context.payments.maxTransactionAmount - commandAmount
    }
    if (amount <= 0) continue

    if (!transferCommands[commandIndex]) {
      if (unlockedRemaining !== null && unlockedRemaining <= transferFee) {
        break
      }
      transferCommands[commandIndex] = {
        redis: [],
        records: [],
        amount: 0,
        rpc: {
          destinations: [],
          mixin: context.payments.mixin !== undefined ? context.payments.mixin : 0,
          fee: transferFee
        }
      }
      if (unlockedRemaining !== null) unlockedRemaining -= transferFee
    }

    if (unlockedRemaining !== null && amount > unlockedRemaining) {
      amount = unlockedRemaining - (unlockedRemaining % denomination)
    }
    if (amount <= 0) {
      if (transferCommands[commandIndex] && transferCommands[commandIndex].rpc.destinations.length === 0) {
        transferCommands.splice(commandIndex, 1)
      }
      continue
    }

    if (payment.paymentId) transferCommands[commandIndex].rpc.paymentID = payment.paymentId

    transferCommands[commandIndex].rpc.destinations.push({ amount: amount, address: payment.destination })
    transferCommands[commandIndex].records.push({ worker: worker, amount: amount, destination: payment.destination })
    transferCommands[commandIndex].redis.push(['hincrby', context.prefix + ':workers:' + worker, 'balance', -amount])
    transferCommands[commandIndex].redis.push(['hincrby', context.prefix + ':workers:' + worker, 'paid', amount])
    transferCommands[commandIndex].amount += amount

    addresses++
    commandAmount += amount
    if (unlockedRemaining !== null) unlockedRemaining -= amount
    if (addresses >= context.payments.maxAddresses || (context.payments.maxTransactionAmount && commandAmount >= context.payments.maxTransactionAmount) || payment.paymentId) {
      commandIndex++
      addresses = 0
      commandAmount = 0
    }
  }

  return transferCommands.filter(function (transferCmd) {
    return transferCmd && transferCmd.rpc.destinations.length > 0
  })
}

module.exports = {
  createTransferCommands
}

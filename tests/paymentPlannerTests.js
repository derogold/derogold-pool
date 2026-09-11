'use strict'

const assert = require('assert')
const paymentPlanner = require('../lib/paymentPlanner.js')

const context = {
  prefix: 'Coin',
  payments: {
    transferFee: 10000,
    denomination: 100,
    maxAddresses: 5,
    maxTransactionAmount: 100000000,
    mixin: 1
  }
}

const payments = {
  worker1: {
    amount: 4000200,
    destination: 'address1',
    paymentId: ''
  }
}

let commands = paymentPlanner.createTransferCommands(context, payments, 3000230)
assert.strictEqual(commands.length, 1)
assert.strictEqual(commands[0].amount, 2990200)
assert.deepStrictEqual(commands[0].rpc.destinations, [{ amount: 2990200, address: 'address1' }])
assert.strictEqual(commands[0].rpc.fee, 10000)
assert.deepStrictEqual(commands[0].redis[0], ['hincrby', 'Coin:workers:worker1', 'balance', -2990200])
assert.deepStrictEqual(commands[0].redis[1], ['hincrby', 'Coin:workers:worker1', 'paid', 2990200])

commands = paymentPlanner.createTransferCommands(context, payments, 10000)
assert.strictEqual(commands.length, 0)

commands = paymentPlanner.createTransferCommands(context, payments, null)
assert.strictEqual(commands.length, 1)
assert.strictEqual(commands[0].amount, 4000200)

commands = paymentPlanner.createTransferCommands(context, {
  worker1: {
    amount: 50000,
    destination: 'address1',
    paymentId: ''
  },
  worker2: {
    amount: 50000,
    destination: 'address2',
    paymentId: ''
  }
}, 70000)
assert.strictEqual(commands.length, 1)
assert.deepStrictEqual(commands[0].rpc.destinations, [
  { amount: 50000, address: 'address1' },
  { amount: 10000, address: 'address2' }
])

console.log('payment planner tests passed')

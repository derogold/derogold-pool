const async = require('async')
const cnUtil = require('turtlecoin-cryptonote-util')
const TurtleCoinUtils = require('turtlecoin-utils').CryptoNote
const turtleUtil = new TurtleCoinUtils()

const logSystem = 'payments'
require('./exceptionWriter.js')(logSystem)

const addressBase58Prefix = cnUtil.address_decode(Buffer.from(global.config.poolServer.poolAddress))

try {
  const poolAddress = turtleUtil.decodeAddress(global.config.poolServer.poolAddress, addressBase58Prefix)
  if (!poolAddress) throw new Error('Could not decode address')
} catch (e) {
  global.log('error', logSystem, 'Pool server address is invalid', [global.config.poolServer.poolAddress])
  process.exit(1)
}

var apiInterfaces = require('./apiInterfaces.js')(global.config.daemon, global.config.wallet, global.config.api)

global.log('info', logSystem, 'Started')

function runInterval () {
  async.waterfall([

    // Ensure wallet is open
    function (callback) {
      var body = {
        daemonHost: global.config.wallet.daemonHost,
        daemonPort: global.config.wallet.daemonPort,
        filename: global.config.wallet.filename,
        password: global.config.wallet.walletPassword
      }
      apiInterfaces.restWallet('POST', '/wallet/open', body, function (error) {
        if (error) {
          global.log('warn', logSystem, 'wallet/open error (wallet may already be open): %j', [error])
        }
        callback()
      })
    },

    // Get worker keys
    function (callback) {
      global.redisClient.keys(global.config.coin + ':workers:*', function (error, result) {
        if (error) {
          global.log('error', logSystem, 'Error trying to get worker balances from redis %j', [error])
          callback(true)
          return
        }
        callback(null, result)
      })
    },

    // Get worker balances
    function (keys, callback) {
      var redisCommands = keys.map(function (k) {
        return ['hmget', k, 'balance', 'minPayoutLevel']
      })
      global.redisClient.multi(redisCommands).exec(function (error, replies) {
        if (error) {
          global.log('error', logSystem, 'Error with getting balances from redis %j', [error])
          callback(true)
          return
        }
        var balances = {}
        var minPayoutLevel = {}
        for (var i = 0; i < replies.length; i++) {
          var parts = keys[i].split(':')
          var workerId = parts[parts.length - 1]
          var data = replies[i]
          var defaultPaymentThreshold = global.config.payments.minPayment
          balances[workerId] = parseInt(data[0]) || 0
          var minerAddress
          minPayoutLevel[workerId] = parseFloat(data[1]) || global.config.payments.minPayment
          try {
            minerAddress = turtleUtil.decodeAddress(workerId, addressBase58Prefix)
            if (minerAddress.paymentId.length !== 0) {
              if (minPayoutLevel[workerId] < global.config.payments.minPaymentIdPayment) {
                minPayoutLevel[workerId] = global.config.payments.minPaymentIdPayment
              }
              defaultPaymentThreshold = global.config.payments.minPaymentIdPayment
            }
          } catch (e) {
            global.log('error', logSystem, 'Skipping invalid miner payment address %s', [workerId])
            continue
          }
          global.log('info', logSystem, 'Using payout level %d for worker %s (default: %d)', [minPayoutLevel[workerId], workerId, defaultPaymentThreshold])
        }
        callback(null, balances, minPayoutLevel)
      })
    },

    // Filter workers under balance threshold for payment
    function (balances, minPayoutLevel, callback) {
      var payments = {}

      for (var worker in balances) {
        var balance = balances[worker]
        if (balance >= minPayoutLevel[worker]) {
          var remainder = balance % global.config.payments.denomination
          var payout = balance - remainder
          if (payout < 0) continue
          payments[worker] = payout
        }
      }

      if (Object.keys(payments).length === 0) {
        global.log('info', logSystem, 'No workers\' balances reached the minimum payment threshold')
        callback(true)
        return
      }

      var transferCommands = []
      var addresses = 0
      var commandAmount = 0
      var commandIndex = 0

      for (worker in payments) {
        var minerAddress
        var paymentId
        try {
          minerAddress = turtleUtil.decodeAddress(worker, addressBase58Prefix)
          if (minerAddress.paymentId.length !== 0 && addresses !== 0) {
            commandIndex++
            addresses = 0
            commandAmount = 0
            paymentId = minerAddress.paymentId
          }
        } catch (e) {
          global.log('error', logSystem, 'Skipping payment to invalid miner payment address %s', [worker])
          continue
        }

        var amount = parseInt(payments[worker])
        if (global.config.payments.maxTransactionAmount && amount + commandAmount > global.config.payments.maxTransactionAmount) {
          amount = global.config.payments.maxTransactionAmount - commandAmount
        }

        if (!transferCommands[commandIndex]) {
          transferCommands[commandIndex] = {
            redis: [],
            amount: 0,
            rpc: {
              destinations: [],
              mixin: global.config.payments.mixin || 3,
              fee: global.config.payments.transferFee
            }
          }
        }

        if (paymentId) {
          transferCommands[commandIndex].rpc.paymentID = paymentId
        }

        transferCommands[commandIndex].rpc.destinations.push({ amount: amount, address: worker })
        transferCommands[commandIndex].redis.push(['hincrby', global.config.coin + ':workers:' + worker, 'balance', -amount])
        transferCommands[commandIndex].redis.push(['hincrby', global.config.coin + ':workers:' + worker, 'paid', amount])
        transferCommands[commandIndex].amount += amount

        addresses++
        commandAmount += amount
        if (addresses >= global.config.payments.maxAddresses || (global.config.payments.maxTransactionAmount && commandAmount >= global.config.payments.maxTransactionAmount) || minerAddress.paymentId.length !== 0) {
          commandIndex++
          addresses = 0
          commandAmount = 0
        }
      }

      var timeOffset = 0

      async.filter(transferCommands, function (transferCmd, cback) {
        apiInterfaces.restWallet('POST', '/transactions/send/advanced', transferCmd.rpc, function (error, result) {
          if (error) {
            global.log('error', logSystem, 'Error with send/advanced REST request to wallet API %j', [error])
            global.log('error', logSystem, 'Payments failed to send to %j', transferCmd.rpc.destinations)
            cback(null, false)
            return
          }

          var now = (timeOffset++) + Date.now() / 1000 | 0
          var txHash = result.transactionHash

          global.log('info', logSystem, 'Payments sent via wallet daemon %j', [result])

          apiInterfaces.restWallet('GET', '/transactions/hash/' + txHash, null, function (txError, txResult) {
            var tx = (txResult && txResult.transaction) ? txResult.transaction : null
            var fee = tx ? tx.fee : transferCmd.rpc.fee
            var mixin = tx ? tx.mixin : (transferCmd.rpc.mixin || 0)
            var numRecipients = tx ? tx.transfers.length : transferCmd.rpc.destinations.length

            if (txError) {
              global.log('warn', logSystem, 'Could not fetch transaction details for %s: %j', [txHash, txError])
            }

            transferCmd.redis.push(['zadd', global.config.coin + ':payments:all', now, [
              txHash,
              transferCmd.amount,
              fee,
              mixin,
              numRecipients
            ].join(':')])

            for (var i = 0; i < transferCmd.rpc.destinations.length; i++) {
              var destination = transferCmd.rpc.destinations[i]
              transferCmd.redis.push(['zadd', global.config.coin + ':payments:' + destination.address, now, [
                txHash,
                destination.amount,
                fee
              ].join(':')])
            }

            global.redisClient.multi(transferCmd.redis).exec(function (error, replies) {
              if (error) {
                global.log('error', logSystem, 'Super critical error! Payments sent yet failing to update balance in redis, double payouts likely to happen %j', [error])
                global.log('error', logSystem, 'Double payments likely to be sent to %j', transferCmd.rpc.destinations)
                cback(null, false)
                return
              }
              cback(null, true)
            })
          })
        })
      }, function (err, succeeded) {
        var failedAmount = transferCommands.length - succeeded.length
        global.log('info', logSystem, 'Payments splintered and %d successfully sent, %d failed', [succeeded.length, failedAmount])
        callback(null)
      })
    }

  ], function (error, result) {
    global.log('info', logSystem, 'Payments processing failed: %s', [error])
    setTimeout(runInterval, global.config.payments.interval * 1000)
  })
}

runInterval()

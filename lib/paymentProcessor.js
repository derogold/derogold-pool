const async = require('async')
const cnUtil = require('turtlecoin-cryptonote-util')
const TurtleCoinUtils = require('turtlecoin-utils').CryptoNote
const turtleUtil = new TurtleCoinUtils()
const paymentPlanner = require('./paymentPlanner.js')

const logSystem = 'payments'
require('./exceptionWriter.js')(logSystem)

var mergedMiningConfig = global.config.mergedMining || {}

function addressPrefixFor (address, label) {
  var prefix = cnUtil.address_decode(Buffer.from(address))
  try {
    const decoded = turtleUtil.decodeAddress(address, prefix)
    if (!decoded) throw new Error('Could not decode address')
  } catch (e) {
    global.log('error', logSystem, '%s pool server address is invalid', [label])
    process.exit(1)
  }
  return prefix
}

function childPrefix (child) {
  return global.config.coin + ':mergedMining:' + (child.symbol || 'child')
}

function childPaymentsEnabled (child) {
  return !!(child && child.payments && child.payments.enabled)
}

function createApiInterfaces (walletConfig) {
  return require('./apiInterfaces.js')(global.config.daemon, walletConfig, global.config.api)
}

function parentContext () {
  if (!global.config.payments || !global.config.payments.enabled) return null
  return {
    symbol: global.config.symbol,
    prefix: global.config.coin,
    wallet: global.config.wallet,
    payments: global.config.payments,
    addressPrefix: addressPrefixFor(global.config.poolServer.poolAddress, global.config.symbol),
    payoutField: null
  }
}

function childContexts () {
  if (!mergedMiningConfig.enabled || !mergedMiningConfig.child || !childPaymentsEnabled(mergedMiningConfig.child)) return []

  var child = mergedMiningConfig.child
  if (!child.wallet) {
    global.log('error', logSystem, '%s merged-mining payments enabled but mergedMining.child.wallet is not configured', [child.symbol || 'child'])
    return []
  }
  if (!child.poolAddress) {
    global.log('error', logSystem, '%s merged-mining payments enabled but mergedMining.child.poolAddress is not configured', [child.symbol || 'child'])
    return []
  }

  return [{
    symbol: child.symbol || 'child',
    prefix: childPrefix(child),
    wallet: child.wallet,
    payments: child.payments,
    addressPrefix: addressPrefixFor(child.poolAddress, child.symbol || 'child'),
    payoutField: 'payoutAddress'
  }]
}

function paymentContexts () {
  var contexts = []
  var parent = parentContext()
  if (parent) contexts.push(parent)
  return contexts.concat(childContexts())
}

function intervalSeconds (contexts) {
  var intervals = contexts.map(function (context) {
    return context.payments.interval || 120
  })
  return intervals.length ? Math.min.apply(Math, intervals) : 120
}

function validateDestination (context, workerId, destination) {
  try {
    var minerAddress = turtleUtil.decodeAddress(destination, context.addressPrefix)
    return {
      address: turtleUtil.encodeAddress(
        minerAddress.publicViewKey,
        minerAddress.publicSpendKey,
        minerAddress.paymentId,
        context.addressPrefix
      ),
      paymentId: minerAddress.paymentId
    }
  } catch (e) {
    global.log('error', logSystem, 'Skipping %s payment for %s with invalid payout address %s', [context.symbol, workerId, destination])
    return null
  }
}

function getWalletUnlockedBalance (apiInterfaces, context, callback) {
  apiInterfaces.restWallet('GET', '/balance', null, function (error, result) {
    if (error) {
      global.log('warn', logSystem, 'Could not fetch %s wallet balance before payment planning: %j', [context.symbol, error])
      callback(null, null)
      return
    }

    var unlocked = parseInt(result && result.unlocked)
    if (!isFinite(unlocked)) {
      global.log('warn', logSystem, 'Could not read %s unlocked wallet balance before payment planning: %j', [context.symbol, result])
      callback(null, null)
      return
    }

    callback(null, unlocked)
  })
}

function runPaymentContext (context, finished) {
  var apiInterfaces = createApiInterfaces(context.wallet)

  async.waterfall([
    function (callback) {
      var body = {
        daemonHost: context.wallet.daemonHost,
        daemonPort: context.wallet.daemonPort,
        filename: context.wallet.filename,
        password: context.wallet.walletPassword
      }
      apiInterfaces.restWallet('POST', '/wallet/open', body, function (error) {
        if (error) {
          global.log('warn', logSystem, '%s wallet/open error (wallet may already be open): %j', [context.symbol, error])
        }
        callback()
      })
    },

    function (callback) {
      global.redisClient.keys(context.prefix + ':workers:*', function (error, result) {
        if (error) {
          global.log('error', logSystem, 'Error trying to get %s worker balances from redis %j', [context.symbol, error])
          callback(true)
          return
        }
        callback(null, result)
      })
    },

    function (keys, callback) {
      if (keys.length === 0) {
        callback(null, {})
        return
      }

      var redisCommands = keys.map(function (k) {
        return ['hmget', k, 'balance', 'minPayoutLevel', context.payoutField || 'balance']
      })
      global.redisClient.multi(redisCommands).exec(function (error, replies) {
        if (error) {
          global.log('error', logSystem, 'Error with getting %s balances from redis %j', [context.symbol, error])
          callback(true)
          return
        }

        var balances = {}
        for (var i = 0; i < replies.length; i++) {
          var parts = keys[i].split(':')
          var workerId = parts[parts.length - 1]
          var data = replies[i]
          var balance = parseInt(data[0]) || 0
          var minPayoutLevel = parseFloat(data[1]) || context.payments.minPayment
          var destination = context.payoutField ? data[2] : workerId

          if (!destination) {
            if (balance > 0) {
              global.log('warn', logSystem, 'Skipping %s payment for %s: no payout address recorded', [context.symbol, workerId])
            }
            continue
          }

          var validated = validateDestination(context, workerId, destination)
          if (!validated) continue

          if (validated.paymentId && context.payments.minPaymentIdPayment && minPayoutLevel < context.payments.minPaymentIdPayment) {
            minPayoutLevel = context.payments.minPaymentIdPayment
          }

          balances[workerId] = {
            balance: balance,
            minPayoutLevel: minPayoutLevel,
            destination: validated.address,
            paymentId: validated.paymentId || ''
          }
          global.log('info', logSystem, 'Using %s payout level %d for worker %s', [context.symbol, minPayoutLevel, workerId])
        }
        callback(null, balances)
      })
    },

    function (balances, callback) {
      var payments = {}

      for (var worker in balances) {
        var balance = balances[worker].balance
        if (balance >= balances[worker].minPayoutLevel) {
          var remainder = balance % context.payments.denomination
          var payout = balance - remainder
          if (payout < 0) continue
          payments[worker] = {
            amount: payout,
            destination: balances[worker].destination,
            paymentId: balances[worker].paymentId
          }
        }
      }

      if (Object.keys(payments).length === 0) {
        global.log('info', logSystem, "No %s workers' balances reached the minimum payment threshold", [context.symbol])
        callback(true)
        return
      }

      getWalletUnlockedBalance(apiInterfaces, context, function (error, unlockedBalance) {
        callback(null, payments, unlockedBalance)
      })
    },

    function (payments, unlockedBalance, callback) {
      var transferCommands = paymentPlanner.createTransferCommands(context, payments, unlockedBalance)

      if (transferCommands.length === 0) {
        global.log('info', logSystem, 'No %s payment commands could be funded by unlocked wallet balance', [context.symbol])
        callback(true)
        return
      }

      var timeOffset = 0

      async.filter(transferCommands, function (transferCmd, cback) {
        apiInterfaces.restWallet('POST', '/transactions/send/advanced', transferCmd.rpc, function (error, result) {
          if (error) {
            global.log('error', logSystem, 'Error with %s send/advanced REST request to wallet API %j', [context.symbol, error])
            global.log('error', logSystem, '%s payments failed to send to %j', [context.symbol, transferCmd.rpc.destinations])
            cback(null, false)
            return
          }

          var now = (timeOffset++) + Date.now() / 1000 | 0
          var txHash = result.transactionHash

          global.log('info', logSystem, '%s payments sent via wallet daemon %j', [context.symbol, result])

          apiInterfaces.restWallet('GET', '/transactions/hash/' + txHash, null, function (txError, txResult) {
            var tx = (txResult && txResult.transaction) ? txResult.transaction : null
            var fee = tx ? tx.fee : transferCmd.rpc.fee
            var mixin = tx ? tx.mixin : (transferCmd.rpc.mixin || 0)
            var numRecipients = tx ? tx.transfers.length : transferCmd.rpc.destinations.length

            if (txError) {
              global.log('warn', logSystem, 'Could not fetch %s transaction details for %s: %j', [context.symbol, txHash, txError])
            }

            transferCmd.redis.push(['zadd', context.prefix + ':payments:all', now, [
              txHash,
              transferCmd.amount,
              fee,
              mixin,
              numRecipients
            ].join(':')])

            for (var i = 0; i < transferCmd.records.length; i++) {
              var record = transferCmd.records[i]
              transferCmd.redis.push(['zadd', context.prefix + ':payments:' + record.worker, now, [
                txHash,
                record.amount,
                fee
              ].join(':')])
              if (record.destination !== record.worker) {
                transferCmd.redis.push(['zadd', context.prefix + ':payments:address:' + record.destination, now, [
                  txHash,
                  record.amount,
                  fee
                ].join(':')])
              }
            }

            global.redisClient.multi(transferCmd.redis).exec(function (error) {
              if (error) {
                global.log('error', logSystem, 'Super critical error! %s payments sent yet failing to update balance in redis, double payouts likely to happen %j', [context.symbol, error])
                global.log('error', logSystem, 'Double %s payments likely to be sent to %j', [context.symbol, transferCmd.rpc.destinations])
                cback(null, false)
                return
              }
              cback(null, true)
            })
          })
        })
      }, function (err, succeeded) {
        var failedAmount = transferCommands.length - succeeded.length
        global.log('info', logSystem, '%s payments splintered and %d successfully sent, %d failed', [context.symbol, succeeded.length, failedAmount])
        callback(null)
      })
    }
  ], function () {
    finished()
  })
}

function runInterval () {
  var contexts = paymentContexts()
  if (contexts.length === 0) {
    global.log('info', logSystem, 'No payment processors are enabled')
    setTimeout(runInterval, 120 * 1000)
    return
  }

  async.eachSeries(contexts, runPaymentContext, function () {
    setTimeout(runInterval, intervalSeconds(contexts) * 1000)
  })
}

global.log('info', logSystem, 'Started')
runInterval()

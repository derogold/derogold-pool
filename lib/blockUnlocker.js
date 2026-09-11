const async = require('async')

const apiInterfaces = require('./apiInterfaces.js')(global.config.daemon, global.config.wallet, global.config.api)
const mergedMiningConfig = global.config.mergedMining || {}

const logSystem = 'unlocker'
require('./exceptionWriter.js')(logSystem)

global.log('info', logSystem, 'Started')

function childPrefix (child) {
  return global.config.coin + ':mergedMining:' + (child.symbol || 'child')
}

function childDepth (child) {
  return child.unlockDepth || global.config.blockUnlocker.depth
}

function childFeePercent (child) {
  return ((child.poolFee !== undefined ? child.poolFee : 0) / 100)
}

function childRoundKey (prefix, block) {
  return prefix + ':shares:round:' + block.height + ':' + block.hash
}

function getEnabledChildren () {
  if (!mergedMiningConfig.enabled) return []
  if (Array.isArray(mergedMiningConfig.children)) {
    return mergedMiningConfig.children.filter(function (child) { return child && child.enabled !== false })
  }
  if (mergedMiningConfig.child) return [mergedMiningConfig.child]
  return []
}

function runMergedMiningChildUnlocker (child, done) {
  const prefix = childPrefix(child)
  const symbol = child.symbol || 'child'
  const daemonConfig = child.daemon

  if (!daemonConfig) {
    global.log('warn', logSystem, 'Merged-mining child %s has no daemon configured, skipping unlocker', [symbol])
    done()
    return
  }

  async.waterfall([
    function (callback) {
      global.redisClient.zrange(prefix + ':blocks:candidates', 0, -1, 'WITHSCORES', function (error, results) {
        if (error) {
          global.log('error', logSystem, 'Error trying to get %s merged-mining pending blocks from redis %j', [symbol, error])
          callback(true)
          return
        }
        if (results.length === 0) {
          global.log('info', logSystem, 'No %s merged-mining block candidates in redis', [symbol])
          callback(true)
          return
        }

        var blocks = []
        for (var i = 0; i < results.length; i += 2) {
          var parts = results[i].split(':')
          blocks.push({
            serialized: results[i],
            height: parseInt(results[i + 1]),
            hash: parts[0],
            time: parts[1],
            difficulty: parts[2],
            shares: parts[3],
            shareDifficulty: parts[4],
            submitStatus: parts[5]
          })
        }

        callback(null, blocks)
      })
    },

    function (blocks, callback) {
      async.filter(blocks, function (block, mapCback) {
        apiInterfaces.rpcDaemonConfig(daemonConfig, 'getblockheaderbyheight', { height: block.height }, function (error, result) {
          if (error) {
            global.log('error', logSystem, 'Error with %s getblockheaderbyheight RPC request for block %s - %j', [symbol, block.serialized, error])
            block.unlocked = false
            mapCback(null, false)
            return
          }
          if (!result || !result.block_header) {
            global.log('error', logSystem, 'Error with %s getblockheaderbyheight, no details returned for %s - %j', [symbol, block.serialized, result])
            block.unlocked = false
            mapCback(null, false)
            return
          }

          const blockHeader = result.block_header
          block.orphaned = blockHeader.hash === block.hash ? 0 : 1
          block.unlocked = blockHeader.depth >= childDepth(child)
          block.reward = blockHeader.reward
          mapCback(null, block.unlocked)
        })
      }, function (err, unlockedBlocks) {
        if (unlockedBlocks.length === 0) {
          global.log('info', logSystem, 'No %s merged-mining pending blocks are unlocked yet (%d pending)', [symbol, blocks.length])
          callback(true)
          return
        }

        callback(null, unlockedBlocks)
      })
    },

    function (blocks, callback) {
      var redisCommands = blocks.map(function (block) {
        return ['hgetall', childRoundKey(prefix, block)]
      })

      global.redisClient.multi(redisCommands).exec(function (error, replies) {
        if (error) {
          global.log('error', logSystem, 'Error getting %s merged-mining round shares from redis %j', [symbol, error])
          callback(true)
          return
        }
        for (var i = 0; i < replies.length; i++) {
          blocks[i].workerShares = replies[i]
        }
        callback(null, blocks)
      })
    },

    function (blocks, callback) {
      var redisCommands = []
      var payments = {}
      var unlockedCount = 0

      blocks.forEach(function (block) {
        const roundKey = childRoundKey(prefix, block)
        redisCommands.push(['del', roundKey])
        redisCommands.push(['zrem', prefix + ':blocks:candidates', block.serialized])
        redisCommands.push(['zadd', prefix + ':blocks:matured', block.height, [
          block.hash,
          block.time,
          block.difficulty,
          block.shares,
          block.orphaned,
          block.reward,
          block.shareDifficulty,
          block.submitStatus
        ].join(':')])

        if (block.orphaned) {
          if (block.workerShares) {
            Object.keys(block.workerShares).forEach(function (worker) {
              redisCommands.push(['hincrby', prefix + ':shares:roundCurrent', worker, block.workerShares[worker]])
            })
          }
          return
        }

        unlockedCount++
        var feePercent = childFeePercent(child)
        var reward = Math.round(block.reward - (block.reward * feePercent))
        var totalShares = parseInt(block.shares)

        global.log('info', logSystem, 'Unlocked %s merged-mining block %d with reward %d and fee %d. Miners reward: %d', [symbol, block.height, block.reward, feePercent, reward])

        if (block.workerShares && totalShares > 0) {
          Object.keys(block.workerShares).forEach(function (worker) {
            var percent = block.workerShares[worker] / totalShares
            var workerReward = Math.round(reward * percent)
            payments[worker] = (payments[worker] || 0) + workerReward
            global.log('info', logSystem, '%s merged-mining block %d payment to %s for %d shares: %d', [symbol, block.height, worker, totalShares, payments[worker]])
          })
        }
      })

      Object.keys(payments).forEach(function (worker) {
        var amount = parseInt(payments[worker])
        if (amount > 0) redisCommands.push(['hincrby', prefix + ':workers:' + worker, 'balance', amount])
      })

      if (redisCommands.length === 0) {
        callback(true)
        return
      }

      global.redisClient.multi(redisCommands).exec(function (error) {
        if (error) {
          global.log('error', logSystem, 'Error unlocking %s merged-mining blocks %j', [symbol, error])
          callback(true)
          return
        }
        global.log('info', logSystem, 'Unlocked %d %s merged-mining blocks and updated balances for %d workers', [unlockedCount, symbol, Object.keys(payments).length])
        callback(null)
      })
    }
  ], function () {
    done()
  })
}

function runInterval () {
  async.waterfall([

    // Get all block candidates in redis
    function (callback) {
      global.redisClient.zrange(global.config.coin + ':blocks:candidates', 0, -1, 'WITHSCORES', function (error, results) {
        if (error) {
          global.log('error', logSystem, 'Error trying to get pending blocks from redis %j', [error])
          callback(true)
          return
        }
        if (results.length === 0) {
          global.log('info', logSystem, 'No blocks candidates in redis')
          callback(true)
          return
        }

        var blocks = []

        for (var i = 0; i < results.length; i += 2) {
          var parts = results[i].split(':')
          blocks.push({
            serialized: results[i],
            height: parseInt(results[i + 1]),
            hash: parts[0],
            time: parts[1],
            difficulty: parts[2],
            shares: parts[3]
          })
        }

        callback(null, blocks)
      })
    },

    // Check if blocks are orphaned
    function (blocks, callback) {
      async.filter(blocks, function (block, mapCback) {
        apiInterfaces.rpcDaemon('getblockheaderbyheight', { height: block.height }, function (error, result) {
          if (error) {
            global.log('error', logSystem, 'Error with getblockheaderbyheight RPC request for block %s - %j', [block.serialized, error])
            block.unlocked = false
            mapCback(null, false)
            return
          }
          if (!result.block_header) {
            global.log('error', logSystem, 'Error with getblockheaderbyheight, no details returned for %s - %j', [block.serialized, result])
            block.unlocked = false
            mapCback(null, false)
            return
          }
          const blockHeader = result.block_header
          block.orphaned = blockHeader.hash === block.hash ? 0 : 1
          block.unlocked = blockHeader.depth >= global.config.blockUnlocker.depth
          block.reward = blockHeader.reward
          mapCback(null, block.unlocked)
        })
      }, function (err, unlockedBlocks) {
        if (unlockedBlocks.length === 0) {
          global.log('info', logSystem, 'No pending blocks are unlocked yet (%d pending)', [blocks.length])
          callback(true)
          return
        }

        callback(null, unlockedBlocks)
      })
    },

    // Get worker shares for each unlocked block
    function (blocks, callback) {
      var redisCommands = blocks.map(function (block) {
        return ['hgetall', global.config.coin + ':shares:round' + block.height]
      })

      global.redisClient.multi(redisCommands).exec(function (error, replies) {
        if (error) {
          global.log('error', logSystem, 'Error with getting round shares from redis %j', [error])
          callback(true)
          return
        }
        for (var i = 0; i < replies.length; i++) {
          var workerShares = replies[i]
          blocks[i].workerShares = workerShares
        }
        callback(null, blocks)
      })
    },

    // Handle orphaned blocks
    function (blocks, callback) {
      var orphanCommands = []

      blocks.forEach(function (block) {
        if (!block.orphaned) return

        orphanCommands.push(['del', global.config.coin + ':shares:round' + block.height])

        orphanCommands.push(['zrem', global.config.coin + ':blocks:candidates', block.serialized])
        orphanCommands.push(['zadd', global.config.coin + ':blocks:matured', block.height, [
          block.hash,
          block.time,
          block.difficulty,
          block.shares,
          block.orphaned
        ].join(':')])

        if (block.workerShares) {
          var workerShares = block.workerShares
          Object.keys(workerShares).forEach(function (worker) {
            orphanCommands.push(['hincrby', global.config.coin + ':shares:roundCurrent', worker, workerShares[worker]])
          })
        }
      })

      if (orphanCommands.length > 0) {
        global.redisClient.multi(orphanCommands).exec(function (error, replies) {
          if (error) {
            global.log('error', logSystem, 'Error with cleaning up data in redis for orphan block(s) %j', [error])
            callback(true)
            return
          }
          callback(null, blocks)
        })
      } else {
        callback(null, blocks)
      }
    },

    // Handle unlocked blocks
    function (blocks, callback) {
      var unlockedBlocksCommands = []
      var payments = {}
      var totalBlocksUnlocked = 0
      blocks.forEach(function (block) {
        if (block.orphaned) return
        totalBlocksUnlocked++

        unlockedBlocksCommands.push(['del', global.config.coin + ':shares:round' + block.height])
        unlockedBlocksCommands.push(['zrem', global.config.coin + ':blocks:candidates', block.serialized])
        unlockedBlocksCommands.push(['zadd', global.config.coin + ':blocks:matured', block.height, [
          block.hash,
          block.time,
          block.difficulty,
          block.shares,
          block.orphaned,
          block.reward
        ].join(':')])

        var feePercent = global.config.blockUnlocker.poolFee / 100

        if (Object.keys(global.donations).length) {
          for (var wallet in global.donations) {
            var percent = global.donations[wallet] / 100
            feePercent += percent
            payments[wallet] = Math.round(block.reward * percent)
            global.log('info', logSystem, 'Block %d donation to %s as %d percent of reward: %d', [block.height, wallet, percent, payments[wallet]])
          }
        }

        var reward = Math.round(block.reward - (block.reward * feePercent))

        global.log('info', logSystem, 'Unlocked %d block with reward %d and donation fee %d. Miners reward: %d', [block.height, block.reward, feePercent, reward])

        if (block.workerShares) {
          var totalShares = parseInt(block.shares)
          Object.keys(block.workerShares).forEach(function (worker) {
            var percent = block.workerShares[worker] / totalShares
            var workerReward = Math.round(reward * percent)
            payments[worker] = (payments[worker] || 0) + workerReward
            global.log('info', logSystem, 'Block %d payment to %s for %d shares: %d', [block.height, worker, totalShares, payments[worker]])
          })
        }
      })

      for (var worker in payments) {
        var amount = parseInt(payments[worker])
        if (amount <= 0) {
          delete payments[worker]
          continue
        }
        unlockedBlocksCommands.push(['hincrby', global.config.coin + ':workers:' + worker, 'balance', amount])
      }

      if (unlockedBlocksCommands.length === 0) {
        global.log('info', logSystem, 'No unlocked blocks yet (%d pending)', [blocks.length])
        callback(true)
        return
      }

      global.redisClient.multi(unlockedBlocksCommands).exec(function (error, replies) {
        if (error) {
          global.log('error', logSystem, 'Error with unlocking blocks %j', [error])
          callback(true)
          return
        }
        global.log('info', logSystem, 'Unlocked %d blocks and update balances for %d workers', [totalBlocksUnlocked, Object.keys(payments).length])
        callback(null)
      })
    }
  ], function (error, result) {
    /* If the result is empty we've already sent back a log statement, we dont' need to do it again */
    if (error && result) {
      global.log('info', logSystem, 'Error running blockUnlocker: %s', [result])
    }
    async.eachSeries(getEnabledChildren(), runMergedMiningChildUnlocker, function () {
      setTimeout(runInterval, global.config.blockUnlocker.interval * 1000)
    })
  })
}

runInterval()

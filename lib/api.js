const fs = require('fs')
const http = require('http')
const https = require('https')
const url = require('url')
const zlib = require('zlib')
const cnUtil = require('turtlecoin-cryptonote-util')
const TurtleCoinUtils = require('turtlecoin-utils').CryptoNote
const turtleUtil = new TurtleCoinUtils()

const logSystem = 'api'
require('./exceptionWriter.js')(logSystem)

const addressBase58Prefix = cnUtil.address_decode(Buffer.from(global.config.poolServer.poolAddress))

try {
  const poolAddress = turtleUtil.decodeAddress(global.config.poolServer.poolAddress, addressBase58Prefix)
  if (!poolAddress) throw new Error('Could not decode address')
} catch (e) {
  global.log('error', logSystem, 'Pool server address is invalid', [global.config.poolServer.poolAddress])
  process.exit(1)
}

var async = require('async')

var apiInterfaces = require('./apiInterfaces.js')(global.config.daemon, global.config.wallet)
var charts = require('./charts.js')
var authSid = Math.round(Math.random() * 10000000000) + '' + Math.round(Math.random() * 10000000000)
var mergedMiningConfig = global.config.mergedMining || {}
var marketConfig = (global.config.market && global.config.market.cexswap) || {}
var defaultMarketDisplayAmounts = {
  DEGO: 1000000000,
  WRKZ: 1000000
}
var marketPriceCache = {
  expires: 0,
  payload: null
}

var redisCommands = [
  ['zremrangebyscore', global.config.coin + ':hashrate', '-inf', ''],
  ['zrange', global.config.coin + ':hashrate', 0, -1],
  ['hgetall', global.config.coin + ':stats'],
  ['zrevrange', global.config.coin + ':blocks:candidates', 0, global.config.api.blocks - 1, 'WITHSCORES'],
  ['zrevrange', global.config.coin + ':blocks:matured', 0, global.config.api.blocks - 1, 'WITHSCORES'],
  ['hgetall', global.config.coin + ':shares:roundCurrent'],
  ['hgetall', global.config.coin + ':stats'],
  ['zcard', global.config.coin + ':blocks:matured'],
  ['zrevrange', global.config.coin + ':payments:all', 0, global.config.api.payments - 1, 'WITHSCORES'],
  ['zcard', global.config.coin + ':payments:all'],
  ['keys', global.config.coin + ':payments:*']
]

var currentStats = ''
var currentStatsCompressed = ''
var currentStatsCollectedAt = 0

var minerStats = {}
var minersHashrate = {}
var mergedMiningMinerStats = {}

var liveConnections = {}
var addressConnections = {}

function collectStats () {
  var startTime = Date.now()
  var redisFinished
  var daemonFinished

  var windowTime = (((Date.now() / 1000) - global.config.api.hashrateWindow) | 0).toString()
  redisCommands[0][3] = '(' + windowTime

  async.parallel({
    pool: function (callback) {
      global.redisClient.multi(redisCommands).exec(function (error, replies) {
        redisFinished = Date.now()
        var dateNowSeconds = Date.now() / 1000 | 0

        if (error) {
          global.log('error', logSystem, 'Error getting redis data: %s', [error.message || error])
          callback(true)
          return
        }

        var data = {
          stats: replies[2],
          blocks: replies[3].concat(replies[4]),
          totalBlocks: parseInt(replies[7]) + (replies[3].length / 2),
          payments: replies[8],
          totalPayments: parseInt(replies[9]),
          totalMinersPaid: replies[10].length - 1
        }

        var hashrates = replies[1]

        minerStats = {}
        minersHashrate = {}

        for (var i = 0; i < hashrates.length; i++) {
          var hashParts = hashrates[i].split(':')
          minersHashrate[hashParts[1]] = (minersHashrate[hashParts[1]] || 0) + parseInt(hashParts[0])
        }

        var totalShares = 0

        for (var miner in minersHashrate) {
          var shares = minersHashrate[miner]
          // Do not count the hashrates of individual workers. Instead
          // only use the shares where miner == wallet address.
          if (miner.indexOf('+') !== -1) {
            totalShares += shares
          }
          minersHashrate[miner] = Math.round(shares / global.config.api.hashrateWindow)
          var minerParts = miner.split('+')
          minerStats[minerParts[0]] = (minersHashrate[miner] || 0) + (parseInt(minerStats[minerParts[0]]) || 0)
        }
        for (miner in minerStats) {
          minerStats[miner] = getReadableHashRateString(minerStats[miner])
        }
        data.miners = Object.keys(minerStats).length

        data.hashrate = Math.round(totalShares / global.config.api.hashrateWindow)

        data.roundHashes = 0

        if (replies[5]) {
          for (miner in replies[5]) {
            if (global.config.poolServer.slushMining.enabled) {
              data.roundHashes += parseInt(replies[5][miner]) / Math.pow(Math.E, ((data.lastBlockFound - dateNowSeconds) / global.config.poolServer.slushMining.weight)) // TODO: Abstract: If something different than lastBlockfound is used for scoreTime, this needs change.
            } else {
              data.roundHashes += parseInt(replies[5][miner])
            }
          }
        }

        if (replies[6]) {
          data.lastBlockFound = replies[6].lastBlockFound
        }

        callback(null, data)
      })
    },
    network: function (callback) {
      apiInterfaces.rpcDaemon('getlastblockheader', {}, function (error, reply) {
        daemonFinished = Date.now()
        if (error) {
          global.log('error', logSystem, 'Error getting daemon data %j', [error])
          callback(true)
          return
        }
        var blockHeader = reply.block_header
        callback(null, {
          difficulty: blockHeader.difficulty,
          height: blockHeader.height,
          timestamp: blockHeader.timestamp,
          reward: blockHeader.reward,
          hash: blockHeader.hash
        })
      })
    },
    mergedMining: getMergedMiningStats,
    config: function (callback) {
      callback(null, {
        ports: getPublicPorts(global.config.poolServer.ports),
        publicUrl: global.config.api.publicUrl || null,
        hashrateWindow: global.config.api.hashrateWindow,
        fee: global.config.blockUnlocker.poolFee,
        coin: global.config.coin,
        coinUnits: global.config.coinUnits,
        coinDifficultyTarget: global.config.coinDifficultyTarget,
        symbol: global.config.symbol,
        depth: global.config.blockUnlocker.depth,
        donation: global.donations,
        version: global.version,
        minPaymentThreshold: global.config.payments.minPayment,
        denominationUnit: global.config.payments.denomination,
        blockTime: global.config.coinDifficultyTarget,
        slushMiningEnabled: global.config.poolServer.slushMining.enabled,
        weight: global.config.poolServer.slushMining.weight,
        paymentIdSupported: global.config.payments.allowPaymentId,
        paymentIdMinPaymentAmount: global.config.payments.minPaymentIdPayment,
        mergedMining: getPublicMergedMiningConfig()
      })
    },
    charts: charts.getPoolChartsData
  }, function (error, results) {
    global.log('info', logSystem, 'Stat collection finished: %d ms redis, %d ms daemon', [redisFinished - startTime, daemonFinished - startTime])

    if (error) {
      global.log('error', logSystem, 'Error collecting all stats')
    } else {
      results.coins = buildCoinsStats(results)
      currentStatsCollectedAt = Date.now() / 1000 | 0
      currentStats = JSON.stringify(results)
      zlib.deflateRaw(currentStats, function (error, result) {
        if (error) {
          global.log('info', logSystem, 'Error deflating data: %s', [error])
          return
        }
        currentStatsCompressed = result
        broadcastLiveStats()
      })
    }

    setTimeout(collectStats, global.config.api.updateInterval * 1000)
  })
}

function getPublicMergedMiningConfig () {
  if (!mergedMiningConfig.enabled || !mergedMiningConfig.child) return { enabled: false }
  return {
    enabled: true,
    parent: {
      coin: global.config.coin,
      symbol: global.config.symbol
    },
    child: {
      coin: mergedMiningConfig.child.coin,
      symbol: mergedMiningConfig.child.symbol,
      daemon: mergedMiningConfig.child.daemon
        ? {
            host: mergedMiningConfig.child.daemon.host,
            port: mergedMiningConfig.child.daemon.port
          }
        : null
    }
  }
}

function getPublicApiBase (request) {
  if (global.config.api && global.config.api.publicUrl) {
    return String(global.config.api.publicUrl).replace(/\/+$/, '')
  }

  var proto = request.headers['x-forwarded-proto'] || (request.socket.encrypted ? 'https' : 'http')
  var host = request.headers['x-forwarded-host'] || request.headers.host
  var prefix = request.headers['x-forwarded-prefix'] || ''

  if (!host) return ''
  return (proto + '://' + host + prefix).replace(/\/+$/, '')
}

function getChildApiSlug () {
  if (!mergedMiningConfig.enabled || !mergedMiningConfig.child) return ''
  return String(mergedMiningConfig.child.apiSlug || getChildSymbol()).toLowerCase()
}

function getChildApiBase (request) {
  if (!mergedMiningConfig.enabled || !mergedMiningConfig.child) return ''
  if (mergedMiningConfig.child.api) return String(mergedMiningConfig.child.api).replace(/\/+$/, '')
  var publicApiBase = getPublicApiBase(request)
  return publicApiBase ? publicApiBase + '/' + getChildApiSlug() : ''
}

function handleGetApis (request, response) {
  var apis = {}
  if (mergedMiningConfig.enabled && mergedMiningConfig.child) {
    var childCoin = mergedMiningConfig.child.coin || getChildSymbol()
    apis[childCoin] = {
      api: getChildApiBase(request)
    }
  }
  writeJson(response, apis)
}

function buildChildStatsFacade (stats) {
  var childSymbol = getChildSymbol()
  var coinStats = stats.coins && stats.coins[childSymbol]
  if (!coinStats) return null

  var childPool = coinStats.pool || {}
  var childNetwork = coinStats.network || {}
  var childBlocks = coinStats.blocks || {}
  var childPayments = getChildPaymentConfig()
  var childDifficultyTarget = getChildDifficultyTarget()
  var childCoinUnits = childPool.coinUnits || childPool.denomination || global.config.coinUnits

  return {
    config: {
      ports: stats.config ? stats.config.ports : getPublicPorts(global.config.poolServer.ports),
      hashrateWindow: stats.config ? stats.config.hashrateWindow : global.config.api.hashrateWindow,
      fee: childPool.fee,
      coin: coinStats.coin,
      coinUnits: childCoinUnits,
      coinDifficultyTarget: childDifficultyTarget,
      symbol: childSymbol,
      depth: childPool.unlockDepth,
      donation: global.donations,
      version: global.version,
      minPaymentThreshold: childPool.minimumPayout,
      denominationUnit: childPool.denomination,
      blockTime: childDifficultyTarget,
      slushMiningEnabled: false,
      weight: 0,
      paymentIdSupported: true,
      paymentIdMinPaymentAmount: childPayments.minPaymentIdPayment,
      mergedMining: {
        enabled: true,
        parent: {
          coin: global.config.coin,
          symbol: global.config.symbol,
          api: stats.config && stats.config.publicUrl ? stats.config.publicUrl : undefined
        },
        child: {
          coin: coinStats.coin,
          symbol: childSymbol
        }
      }
    },
    pool: {
      stats: stats.mergedMining ? stats.mergedMining.stats : {},
      blocks: stats.mergedMining
        ? (stats.mergedMining.submittedBlocks || []).concat(stats.mergedMining.maturedBlocks || [])
        : [],
      totalBlocks: childBlocks.found || 0,
      totalMaturedBlocks: childBlocks.matured || 0,
      payments: [],
      totalPayments: 0,
      miners: childPool.miners || 0,
      workers: childPool.miners || 0,
      hashrate: childPool.hashrate || 0,
      roundHashes: stats.mergedMining && stats.mergedMining.stats ? stats.mergedMining.stats.roundDifficulty : 0
    },
    network: {
      difficulty: childNetwork.difficulty,
      height: childNetwork.height
    },
    lastblock: childNetwork,
    mergedMining: {
      enabled: true,
      parent: {
        coin: global.config.coin,
        symbol: global.config.symbol
      },
      child: {
        coin: coinStats.coin,
        symbol: childSymbol
      }
    },
    coins: {}
  }
}

function handleChildStatsFacade (response) {
  if (!currentStats) {
    writeJson(response, { error: 'stats unavailable' })
    return
  }

  var stats
  try {
    stats = JSON.parse(currentStats)
  } catch (error) {
    writeJson(response, { error: 'stats unavailable' })
    return
  }

  var facade = buildChildStatsFacade(stats)
  if (!facade) {
    writeJson(response, { error: 'child stats unavailable' })
    return
  }

  facade.coins[getChildSymbol()] = stats.coins[getChildSymbol()]
  writeJson(response, facade)
}

function getMergedMiningStats (callback) {
  if (!mergedMiningConfig.enabled || !mergedMiningConfig.child || !mergedMiningConfig.child.daemon) {
    callback(null, { enabled: false })
    return
  }

  var childSymbol = mergedMiningConfig.child.symbol || 'child'
  var childPrefix = global.config.coin + ':mergedMining:' + childSymbol
  var windowTime = (((Date.now() / 1000) - global.config.api.hashrateWindow) | 0).toString()

  async.parallel({
    stats: function (cback) {
      global.redisClient.hgetall(childPrefix + ':stats', function (error, stats) {
        cback(error, stats || {})
      })
    },
    pool: function (cback) {
      global.redisClient.multi([
        ['zremrangebyscore', childPrefix + ':hashrate', '-inf', '(' + windowTime],
        ['zrange', childPrefix + ':hashrate', 0, -1]
      ]).exec(function (error, replies) {
        if (error) {
          cback(error)
          return
        }
        cback(null, summarizeHashrateEntries(replies && replies[1] ? replies[1] : []))
      })
    },
    submittedBlocks: function (cback) {
      global.redisClient.multi([
        ['zrevrange', childPrefix + ':blocks:submitted', 0, global.config.api.blocks - 1, 'WITHSCORES']
      ]).exec(function (error, replies) {
        cback(error, replies && replies[0] ? replies[0] : [])
      })
    },
    candidateBlocks: function (cback) {
      global.redisClient.multi([
        ['zrevrange', childPrefix + ':blocks:candidates', 0, global.config.api.blocks - 1, 'WITHSCORES']
      ]).exec(function (error, replies) {
        cback(error, replies && replies[0] ? replies[0] : [])
      })
    },
    maturedBlocks: function (cback) {
      global.redisClient.multi([
        ['zrevrange', childPrefix + ':blocks:matured', 0, global.config.api.blocks - 1, 'WITHSCORES'],
        ['zcard', childPrefix + ':blocks:matured']
      ]).exec(function (error, replies) {
        cback(error, {
          blocks: replies && replies[0] ? replies[0] : [],
          total: replies && replies[1] ? parseInt(replies[1]) : 0
        })
      })
    },
    network: function (cback) {
      apiInterfaces.rpcDaemonConfig(mergedMiningConfig.child.daemon, 'getlastblockheader', {}, function (error, reply) {
        if (error || !reply || !reply.block_header) {
          cback(null, {
            error: error && (error.message || error.toString()) || 'missing child block header'
          })
          return
        }

        var blockHeader = reply.block_header
        cback(null, {
          difficulty: blockHeader.difficulty,
          height: blockHeader.height,
          timestamp: blockHeader.timestamp,
          reward: blockHeader.reward,
          hash: blockHeader.hash
        })
      })
    }
  }, function (error, data) {
    if (error) {
      callback(error)
      return
    }
    mergedMiningMinerStats[childSymbol] = data.pool && data.pool.minerStats ? data.pool.minerStats : {}

    callback(null, {
      enabled: true,
      child: {
        coin: mergedMiningConfig.child.coin,
        symbol: childSymbol
      },
      pool: {
        hashrate: data.pool && data.pool.hashrate ? data.pool.hashrate : 0,
        miners: data.pool && data.pool.miners ? data.pool.miners : 0
      },
      stats: data.stats,
      submittedBlocks: data.submittedBlocks,
      candidateBlocks: data.candidateBlocks,
      maturedBlocks: data.maturedBlocks.blocks,
      totalMaturedBlocks: data.maturedBlocks.total,
      network: data.network
    })
  })
}

function summarizeHashrateEntries (hashrates) {
  var sharesByMiner = {}
  var addressHashrates = {}
  var totalShares = 0

  for (var i = 0; i < hashrates.length; i++) {
    var hashParts = hashrates[i].split(':')
    var shares = parseInt(hashParts[0])
    var miner = hashParts[1]
    if (!miner || !Number.isFinite(shares)) continue
    sharesByMiner[miner] = (sharesByMiner[miner] || 0) + shares
  }

  for (var miner in sharesByMiner) {
    var minerParts = miner.split('+')
    var address = minerParts[0]
    var hashrate = Math.round(sharesByMiner[miner] / global.config.api.hashrateWindow)
    addressHashrates[address] = (addressHashrates[address] || 0) + hashrate
    if (miner.indexOf('+') !== -1) totalShares += sharesByMiner[miner]
  }

  var addressReadableHashrates = {}
  for (var minerAddress in addressHashrates) {
    addressReadableHashrates[minerAddress] = getReadableHashRateString(addressHashrates[minerAddress])
  }

  return {
    hashrate: Math.round(totalShares / global.config.api.hashrateWindow),
    miners: Object.keys(addressHashrates).length,
    minerStats: addressReadableHashrates
  }
}

function toNumberOrNull (value) {
  if (value === undefined || value === null || value === '') return null
  var number = Number(value)
  return Number.isFinite(number) ? number : null
}

function getNetworkHashrate (difficulty, targetTime) {
  difficulty = toNumberOrNull(difficulty)
  targetTime = toNumberOrNull(targetTime)
  if (!difficulty || !targetTime) return null
  return Math.round(difficulty / targetTime)
}

function getCurrentEffortPercent (roundHashes, difficulty) {
  roundHashes = toNumberOrNull(roundHashes)
  difficulty = toNumberOrNull(difficulty)
  if (!roundHashes || !difficulty) return null
  return Math.round((roundHashes / difficulty) * 10000) / 100
}

function getBlockEffortPercent (work, difficulty) {
  work = toNumberOrNull(work)
  difficulty = toNumberOrNull(difficulty)
  if (!work || !difficulty) return null
  return Math.round((work / difficulty) * 10000) / 100
}

function parseBlockList (blocks) {
  var parsedBlocks = []
  if (!Array.isArray(blocks)) return parsedBlocks

  for (var i = 0; i < blocks.length; i += 2) {
    var serialized = blocks[i]
    var height = toNumberOrNull(blocks[i + 1])
    if (typeof serialized !== 'string') continue

    var parts = serialized.split(':')
    var difficulty = toNumberOrNull(parts[2])
    var shares = toNumberOrNull(parts[3])
    parsedBlocks.push({
      hash: parts[0],
      timestamp: toNumberOrNull(parts[1]),
      difficulty: difficulty,
      shares: shares,
      effortPercent: getBlockEffortPercent(shares, difficulty),
      orphaned: parts[4] !== undefined ? parts[4] === '1' : null,
      reward: toNumberOrNull(parts[5]),
      height: height
    })
  }

  return parsedBlocks
}

function parseSubmittedChildBlocks (blocks) {
  var parsedBlocks = []
  if (!Array.isArray(blocks)) return parsedBlocks

  for (var i = 0; i < blocks.length; i += 2) {
    var serialized = blocks[i]
    var height = toNumberOrNull(blocks[i + 1])
    if (typeof serialized !== 'string') continue

    var parts = serialized.split(':')
    var difficulty = toNumberOrNull(parts[2])
    var shareDifficulty = toNumberOrNull(parts[3])
    parsedBlocks.push({
      hash: parts[0],
      timestamp: toNumberOrNull(parts[1]),
      difficulty: difficulty,
      shareDifficulty: shareDifficulty,
      effortPercent: getBlockEffortPercent(shareDifficulty, difficulty),
      status: parts[4] || null,
      height: height
    })
  }

  return parsedBlocks
}

function parseCandidateChildBlocks (blocks) {
  var parsedBlocks = []
  if (!Array.isArray(blocks)) return parsedBlocks

  for (var i = 0; i < blocks.length; i += 2) {
    var serialized = blocks[i]
    var height = toNumberOrNull(blocks[i + 1])
    if (typeof serialized !== 'string') continue

    var parts = serialized.split(':')
    var difficulty = toNumberOrNull(parts[2])
    var shares = toNumberOrNull(parts[3])
    var shareDifficulty = toNumberOrNull(parts[4])
    parsedBlocks.push({
      hash: parts[0],
      timestamp: toNumberOrNull(parts[1]),
      difficulty: difficulty,
      shares: shares,
      shareDifficulty: shareDifficulty,
      effortPercent: getBlockEffortPercent(shareDifficulty || shares, difficulty),
      status: parts[5] || null,
      height: height
    })
  }

  return parsedBlocks
}

function parseMaturedChildBlocks (blocks) {
  var parsedBlocks = []
  if (!Array.isArray(blocks)) return parsedBlocks

  for (var i = 0; i < blocks.length; i += 2) {
    var serialized = blocks[i]
    var height = toNumberOrNull(blocks[i + 1])
    if (typeof serialized !== 'string') continue

    var parts = serialized.split(':')
    var difficulty = toNumberOrNull(parts[2])
    var shares = toNumberOrNull(parts[3])
    var shareDifficulty = toNumberOrNull(parts[6])
    parsedBlocks.push({
      hash: parts[0],
      timestamp: toNumberOrNull(parts[1]),
      difficulty: difficulty,
      shares: shares,
      effortPercent: getBlockEffortPercent(shareDifficulty || shares, difficulty),
      orphaned: parts[4] !== undefined ? parts[4] === '1' : null,
      reward: toNumberOrNull(parts[5]),
      shareDifficulty: shareDifficulty,
      status: parts[7] || null,
      height: height
    })
  }

  return parsedBlocks
}

function countBlocksInWindow (blocks, minutes) {
  var now = Date.now() / 1000
  var minTimestamp = now - (minutes * 60)
  var count = 0

  blocks.forEach(function (block) {
    if (block.timestamp !== null && block.timestamp >= minTimestamp) count++
  })

  return count
}

function getChildDifficultyTarget () {
  return mergedMiningConfig.child && mergedMiningConfig.child.coinDifficultyTarget
    ? mergedMiningConfig.child.coinDifficultyTarget
    : null
}

function getChildPaymentConfig () {
  return mergedMiningConfig.child && mergedMiningConfig.child.payments
    ? mergedMiningConfig.child.payments
    : {}
}

function getChildBlockUnlockDepth () {
  return mergedMiningConfig.child && mergedMiningConfig.child.unlockDepth
    ? mergedMiningConfig.child.unlockDepth
    : global.config.blockUnlocker.depth
}

function getChildFeePercent () {
  return mergedMiningConfig.child && mergedMiningConfig.child.poolFee !== undefined
    ? mergedMiningConfig.child.poolFee
    : null
}

function getChildSymbol () {
  return mergedMiningConfig.child && mergedMiningConfig.child.symbol
    ? mergedMiningConfig.child.symbol
    : 'child'
}

function getChildPrefix () {
  return global.config.coin + ':mergedMining:' + getChildSymbol()
}

function childStatsCommands (address) {
  if (!mergedMiningConfig.enabled || !mergedMiningConfig.child) return []
  var childPrefix = getChildPrefix()
  return [
    ['hgetall', childPrefix + ':workers:' + address],
    ['zrevrange', childPrefix + ':payments:' + address, 0, global.config.api.payments - 1, 'WITHSCORES'],
    ['zrevrange', childPrefix + ':payments:address:' + address, 0, global.config.api.payments - 1, 'WITHSCORES']
  ]
}

function buildMinerCoinStats (address, parentStats, parentPayments, childReplies) {
  var coins = {}
  coins[global.config.symbol] = {
    role: 'parent',
    coin: global.config.coin,
    symbol: global.config.symbol,
    stats: parentStats || {},
    payments: parentPayments || [],
    hashrate: minerStats[address] || null,
    minimumPayout: global.config.payments.minPayment,
    paymentInterval: global.config.payments.interval,
    denomination: global.config.payments.denomination,
    transferFee: global.config.payments.transferFee,
    unlockDepth: global.config.blockUnlocker.depth,
    poolFee: global.config.blockUnlocker.poolFee
  }

  if (mergedMiningConfig.enabled && mergedMiningConfig.child) {
    var childSymbol = getChildSymbol()
    var childPayments = getChildPaymentConfig()
    var childStats = childReplies && childReplies[0] ? childReplies[0] : {}
    var childMinerStats = mergedMiningMinerStats[childSymbol] || {}
    var childPaymentRecords = []
    if (childReplies && childReplies[1]) childPaymentRecords = childPaymentRecords.concat(childReplies[1])
    if (childReplies && childReplies[2]) childPaymentRecords = childPaymentRecords.concat(childReplies[2])
    coins[childSymbol] = {
      role: 'child',
      coin: mergedMiningConfig.child.coin,
      symbol: childSymbol,
      stats: childStats,
      payments: childPaymentRecords,
      hashrate: childMinerStats[address] || null,
      payoutAddress: childStats.payoutAddress || null,
      minimumPayout: childPayments.minPayment !== undefined ? childPayments.minPayment : null,
      paymentInterval: childPayments.interval !== undefined ? childPayments.interval : null,
      denomination: childPayments.denomination !== undefined ? childPayments.denomination : null,
      transferFee: childPayments.transferFee !== undefined ? childPayments.transferFee : null,
      unlockDepth: getChildBlockUnlockDepth(),
      poolFee: getChildFeePercent()
    }
  }

  return coins
}

function buildCoinsStats (results) {
  var blocksWindowMinutes = global.config.api.blocksWindowMinutes || 60
  var parentBlocks = parseBlockList(results.pool && results.pool.blocks)
  var parentNetwork = results.network || {}
  var parentRoundHashes = results.pool && results.pool.roundHashes
  var coins = {}

  coins[global.config.symbol] = {
    role: 'parent',
    coin: global.config.coin,
    symbol: global.config.symbol,
    network: {
      height: parentNetwork.height,
      difficulty: parentNetwork.difficulty,
      hashrate: getNetworkHashrate(parentNetwork.difficulty, global.config.coinDifficultyTarget),
      reward: parentNetwork.reward,
      timestamp: parentNetwork.timestamp,
      hash: parentNetwork.hash
    },
    pool: {
      hashrate: results.pool ? results.pool.hashrate : 0,
      miners: results.pool ? results.pool.miners : 0,
      fee: global.config.blockUnlocker.poolFee,
      finderRewardPercent: global.config.blockUnlocker.finderRewardPercent || 0,
      minimumPayout: global.config.payments.minPayment,
      paymentInterval: global.config.payments.interval,
      denomination: global.config.payments.denomination,
      transferFee: global.config.payments.transferFee,
      unlockDepth: global.config.blockUnlocker.depth
    },
    blocks: {
      found: results.pool ? results.pool.totalBlocks : 0,
      foundLastWindow: {
        minutes: blocksWindowMinutes,
        count: countBlocksInWindow(parentBlocks, blocksWindowMinutes)
      },
      currentEffortPercent: getCurrentEffortPercent(parentRoundHashes, parentNetwork.difficulty),
      latest: parentBlocks
    }
  }

  if (results.mergedMining && results.mergedMining.enabled && results.mergedMining.child) {
    var childSymbol = results.mergedMining.child.symbol
    var childStats = results.mergedMining.stats || {}
    var childNetwork = results.mergedMining.network || {}
    var childBlocks = parseSubmittedChildBlocks(results.mergedMining.submittedBlocks)
    var childCandidates = parseCandidateChildBlocks(results.mergedMining.candidateBlocks)
    var childMaturedBlocks = parseMaturedChildBlocks(results.mergedMining.maturedBlocks)
    var childDifficultyTarget = getChildDifficultyTarget()
    var childPayments = getChildPaymentConfig()
    var childPool = results.mergedMining.pool || {}

    coins[childSymbol] = {
      role: 'child',
      coin: results.mergedMining.child.coin,
      symbol: childSymbol,
      network: {
        height: childNetwork.height,
        difficulty: childNetwork.difficulty,
        hashrate: getNetworkHashrate(childNetwork.difficulty, childDifficultyTarget),
        reward: childNetwork.reward,
        timestamp: childNetwork.timestamp,
        hash: childNetwork.hash
      },
      pool: {
        hashrate: childPool.hashrate || 0,
        miners: childPool.miners || 0,
        fee: mergedMiningConfig.child.poolFee !== undefined ? mergedMiningConfig.child.poolFee : null,
        finderRewardPercent: mergedMiningConfig.child.finderRewardPercent !== undefined ? mergedMiningConfig.child.finderRewardPercent : null,
        minimumPayout: childPayments.minPayment !== undefined ? childPayments.minPayment : null,
        paymentInterval: childPayments.interval !== undefined ? childPayments.interval : null,
        denomination: childPayments.denomination !== undefined ? childPayments.denomination : null,
        transferFee: childPayments.transferFee !== undefined ? childPayments.transferFee : null,
        unlockDepth: getChildBlockUnlockDepth()
      },
      blocks: {
        found: toNumberOrNull(childStats.submittedBlocks) || 0,
        matured: results.mergedMining.totalMaturedBlocks || 0,
        foundLastWindow: {
          minutes: blocksWindowMinutes,
          count: countBlocksInWindow(childBlocks, blocksWindowMinutes)
        },
        currentEffortPercent: getCurrentEffortPercent(childStats.roundDifficulty, childNetwork.difficulty),
        latest: childBlocks,
        candidates: childCandidates,
        maturedLatest: childMaturedBlocks
      },
      shares: {
        accepted: toNumberOrNull(childStats.acceptedShares) || 0,
        qualifying: toNumberOrNull(childStats.qualifyingShares) || 0,
        lastDifficulty: toNumberOrNull(childStats.lastShareDifficulty),
        lastChildDifficulty: toNumberOrNull(childStats.lastChildDifficulty)
      }
    }
  }

  return coins
}

function getPublicPorts (ports) {
  return ports.filter(function (port) {
    return !port.hidden
  })
}

function getReadableHashRateString (hashrate) {
  var i = 0
  var byteUnits = [ ' H', ' KH', ' MH', ' GH', ' TH', ' PH' ]
  while (hashrate > 1000) {
    hashrate = hashrate / 1000
    i++
  }
  return hashrate.toFixed(2) + byteUnits[i]
}

function broadcastLiveStats () {
  global.log('info', logSystem, 'Broadcasting to %d visitors and %d address lookups', [Object.keys(liveConnections).length, Object.keys(addressConnections).length])

  for (var uid in liveConnections) {
    var res = liveConnections[uid]
    res.end(currentStatsCompressed)
  }

  var redisCommands = []
  for (var address in addressConnections) {
    redisCommands.push(['hgetall', global.config.coin + ':workers:' + address])
    redisCommands.push(['zrevrange', global.config.coin + ':payments:' + address, 0, global.config.api.payments - 1, 'WITHSCORES'])
  }
  global.redisClient.multi(redisCommands).exec(function (error, replies) {
    if (error) {
      global.log('info', logSystem, 'Redis error occurred: %s', [error])
      return
    }
    var addresses = Object.keys(addressConnections)

    for (var i = 0; i < addresses.length; i++) {
      var offset = i * 2
      var address = addresses[i]
      var stats = replies[offset]
      var res = addressConnections[address]
      if (!stats) {
        res.end(JSON.stringify({ error: 'not found' }))
        return
      }
      stats.hashrate = minerStats[address]
      res.end(JSON.stringify({ stats: stats, payments: replies[offset + 1] }))
    }
  })
}

function handleMinerStats (urlParts, response) {
  response.writeHead(200, {
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-cache',
    'Content-Type': 'application/json',
    'Connection': 'keep-alive'
  })
  response.write('\n')
  var address = urlParts.query.address

  if (urlParts.query.longpoll === 'true') {
    global.redisClient.exists(global.config.coin + ':workers:' + address, function (error, result) {
      if (error) {
        global.log('info', logSystem, 'Redis error occurred: %s', [error])
        response.end(JSON.stringify({ error: 'backend error' }))
        return
      }
      if (!result) {
        response.end(JSON.stringify({ error: 'not found' }))
        return
      }
      addressConnections[address] = response
      response.on('finish', function () {
        delete addressConnections[address]
      })
    })
  } else {
    var commands = [
      ['hgetall', global.config.coin + ':workers:' + address],
      ['zrevrange', global.config.coin + ':payments:' + address, 0, global.config.api.payments - 1, 'WITHSCORES'],
      ['keys', global.config.coin + ':charts:hashrate:' + address + '*']
    ].concat(childStatsCommands(address))

    global.redisClient.multi(commands).exec(function (error, replies) {
      if (error || !replies[0]) {
        response.end(JSON.stringify({ error: 'not found' }))
        return
      }
      var stats = replies[0]
      // console.global.log(replies);
      stats.hashrate = minerStats[address]

      // Grab the worker names.
      var workers = []
      for (var i = 0; i < replies[2].length; i++) {
        var key = replies[2][i]
        var nameOffset = key.indexOf('+')
        if (nameOffset !== -1) {
          workers.push(key.substr(nameOffset + 1))
        }
      }

      charts.getUserChartsData(address, replies[1], function (error, chartsData) {
        if (error) {
          global.log('info', logSystem, 'Error getting user charts data: %s', [error])
          response.end(JSON.stringify({ error: 'error get user charts data' }))
          return
        }
        response.end(JSON.stringify({
          stats: stats,
          payments: replies[1],
          coins: buildMinerCoinStats(address, stats, replies[1], replies.slice(3, 6)),
          charts: chartsData,
          workers: workers
        }))
      })
    })
  }
}

function handleWorkerStats (urlParts, response) {
  response.writeHead(200, {
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-cache',
    'Content-Type': 'application/json',
    'Connection': 'keep-alive'
  })
  response.write('\n')
  var address = urlParts.query.address

  charts.getUserChartsData(address, [], function (error, chartsData) {
    if (error) {
      global.log('info', logSystem, 'Redis error occurred: %s', [error])
      response.end(JSON.stringify({ error: 'backend error' }))
      return
    }
    response.end(JSON.stringify({ charts: chartsData }))
  })
}

function handleSetMinerPayoutLevel (urlParts, response) {
  response.writeHead(200, {
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-cache',
    'Content-Type': 'application/json',
    'Connection': 'keep-alive'
  })
  response.write('\n')

  var address = urlParts.query.address
  var level = urlParts.query.level

  // Check the minimal required parameters for this handle.
  if (address === undefined || level === undefined) {
    response.end(JSON.stringify({ 'status': 'parameters are incomplete' }))
    return
  }

  // Do not allow wildcards in the queries.
  if (address.indexOf('*') !== -1) {
    response.end(JSON.stringify({ 'status': 'Please remove the wildcard from your input' }))
    return
  }

  var minerAddress
  try {
    minerAddress = turtleUtil.decodeAddress(address, addressBase58Prefix)
  } catch (e) {
    response.end(JSON.stringify({ 'status': 'You did not supply a valid wallet address' }))
  }

  level = parseFloat(level)
  if (isNaN(level)) {
    response.end(JSON.stringify({ 'status': 'Your desired payment level doesn\'t look like a digit' }))
    return
  }

  if (minerAddress.paymentId.length !== 0 && level < global.config.payments.minPaymentIdPayment / global.config.coinUnits) {
    response.end(JSON.stringify({ 'status': 'Please choose a value above ' + global.config.payments.minPaymentIdPayment / global.config.coinUnits }))
    return
  } else if (level < global.config.payments.minPayment / global.config.coinUnits) {
    response.end(JSON.stringify({ 'status': 'Please choose a value above ' + global.config.payments.minPayment / global.config.coinUnits }))
    return
  }

  var payoutLevel = level * global.config.coinUnits
  global.redisClient.hset(global.config.coin + ':workers:' + address, 'minPayoutLevel', payoutLevel, function (error, value) {
    if (error) {
      response.end(JSON.stringify({ 'status': 'woops something failed' }))
      return
    }

    global.log('info', logSystem, 'Updated payout level for address ' + address + ' level: ' + payoutLevel)
    response.end(JSON.stringify({ 'status': 'done' }))
  })
}

function handleGetMinerPayoutLevel (urlParts, response) {
  response.writeHead(200, {
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-cache',
    'Content-Type': 'application/json',
    'Connection': 'keep-alive'
  })
  response.write('\n')

  var address = urlParts.query.address
  // Check the minimal required parameters for this handle.
  if (address === undefined) {
    response.end(JSON.stringify({ 'status': 'parameters are incomplete' }))
    return
  }

  global.redisClient.hget(global.config.coin + ':workers:' + address, 'minPayoutLevel', function (error, value) {
    if (error) {
      response.end(JSON.stringify({ 'status': 'woops something failed' }))
      return
    }
    var payoutLevel = value / global.config.coinUnits
    response.end(JSON.stringify({ 'status': 'done', 'level': payoutLevel }))
  })
}

function handleGetPayments (urlParts, response) {
  var prefix = getPaymentQueryPrefix(urlParts.query.coin)
  if (!prefix) {
    writeJson(response, { error: 'unknown coin' })
    return
  }

  var paymentKey = ':payments:all'

  if (urlParts.query.address) {
    paymentKey = ':payments:' + urlParts.query.address
    if (prefix !== global.config.coin && urlParts.query.payoutAddress === 'true') {
      paymentKey = ':payments:address:' + urlParts.query.address
    }
  }

  global.redisClient.multi([
    [
      'zrevrangebyscore',
      prefix + paymentKey,
      '(' + urlParts.query.time,
      '-inf',
      'WITHSCORES',
      'LIMIT',
      0,
      global.config.api.payments
    ]
  ]).exec(function (err, replies) {
    var result = replies && replies[0] ? replies[0] : []
    var reply

    if (err) { reply = JSON.stringify({ error: 'query failed' }) } else { reply = JSON.stringify(result) }

    response.writeHead('200', {
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-cache',
      'Content-Type': 'application/json',
      'Content-Length': reply.length
    })
    response.end(reply)
  })
}

function getPaymentQueryPrefix (coin) {
  if (!coin || coin.toUpperCase() === global.config.symbol.toUpperCase()) return global.config.coin
  if (!mergedMiningConfig.enabled || !mergedMiningConfig.child) return null
  if (coin.toUpperCase() === getChildSymbol().toUpperCase()) return getChildPrefix()
  return null
}

function writeJson (response, body) {
  var reply = JSON.stringify(body)
  response.writeHead('200', {
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-cache',
    'Content-Type': 'application/json',
    'Content-Length': reply.length
  })
  response.end(reply)
}

function handleGetBlocks (urlParts, response) {
  global.redisClient.multi([
    [
      'zrevrangebyscore',
      global.config.coin + ':blocks:matured',
      '(' + urlParts.query.height,
      '-inf',
      'WITHSCORES',
      'LIMIT',
      0,
      global.config.api.blocks
    ]
  ]).exec(function (err, replies) {
    var result = replies && replies[0] ? replies[0] : []
    var reply

    if (err) { reply = JSON.stringify({ error: 'query failed' }) } else { reply = JSON.stringify(result) }

    response.writeHead('200', {
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-cache',
      'Content-Type': 'application/json',
      'Content-Length': reply.length
    })
    response.end(reply)
  })
}

function handleGetMinersHashrate (response) {
  var reply = JSON.stringify({
    minersHashrate: minersHashrate
  })
  response.writeHead('200', {
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-cache',
    'Content-Type': 'application/json',
    'Content-Length': reply.length
  })
  response.end(reply)
}

function parseCookies (request) {
  var list = {}
  var rc = request.headers.cookie
  rc && rc.split(';').forEach(function (cookie) {
    var parts = cookie.split('=')
    list[parts.shift().trim()] = unescape(parts.join('='))
  })
  return list
}

function authorize (request, response) {
  var remoteAddress = request.socket.remoteAddress
  if (remoteAddress === '127.0.0.1' || remoteAddress === '::ffff:127.0.0.1') {
    return true
  }

  response.setHeader('Access-Control-Allow-Origin', '*')

  var cookies = parseCookies(request)
  if (cookies.sid && cookies.sid === authSid) {
    return true
  }

  var sentPass = new URL(request.url, 'http://localhost').searchParams.get('password')

  if (sentPass !== global.config.api.password) {
    response.statusCode = 401
    response.end('invalid password')
    return
  }

  global.log('warn', logSystem, 'Admin authorized')
  response.statusCode = 200

  var cookieExpire = new Date(new Date().getTime() + 60 * 60 * 24 * 1000)
  response.setHeader('Set-Cookie', 'sid=' + authSid + '; path=/; expires=' + cookieExpire.toUTCString())
  response.setHeader('Cache-Control', 'no-cache')
  response.setHeader('Content-Type', 'application/json')

  return true
}

function handleDaemonRpc (request, response) {
  response.writeHead(200, {
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-cache',
    'Content-Type': 'application/json'
  })
  var body = ''
  request.on('data', function (chunk) { body += chunk })
  request.on('end', function () {
    apiInterfaces.jsonHttpRequest(
      global.config.daemon.host,
      global.config.daemon.port,
      body,
      function (error, result) {
        if (error) {
          response.end(JSON.stringify({ error: error }))
        } else {
          response.end(JSON.stringify(result))
        }
      }
    )
  })
}

function handleAdminStats (response) {
  var contexts = [{
    symbol: global.config.symbol,
    prefix: global.config.coin
  }]

  if (mergedMiningConfig.enabled && mergedMiningConfig.child) {
    contexts.push({
      symbol: getChildSymbol(),
      prefix: getChildPrefix()
    })
  }

  Promise.all(contexts.map(collectAdminCoinStats)).then(function (coinStats) {
    var coins = {}
    for (var i = 0; i < coinStats.length; i++) {
      coins[coinStats[i].symbol] = coinStats[i].stats
    }

    var parentStats = coins[global.config.symbol] || emptyAdminStats()
    var responseStats = {}
    Object.keys(parentStats).forEach(function (key) {
      responseStats[key] = parentStats[key]
    })
    responseStats.coins = coins
    sendJson(response, 200, responseStats)
  }).catch(function (error) {
    global.log('error', logSystem, 'Error collecting merged admin stats: %s', [error && (error.stack || error.message || error.toString()) || error])
    sendJson(response, 500, { error: 'error collecting stats' })
  })
}

function collectAdminCoinStats (context) {
  return Promise.all([
    redisLegacyCall(function (done) {
      global.redisClient.keys(context.prefix + ':workers:*', done)
    }),
    redisLegacyCall(function (done) {
      global.redisClient.zrange(context.prefix + ':blocks:matured', 0, -1, done)
    })
  ]).then(function (replies) {
    return collectAdminBalances(context, replies[0] || [], replies[1] || [])
  }).catch(function (error) {
    global.log('error', logSystem, 'Error trying to get %s admin data from redis: %s', [context.symbol, error && (error.stack || error.message || error.toString()) || error])
    throw error
  })
}

function collectAdminBalances (context, workerKeys, blocks) {
  return Promise.all(workerKeys.map(function (key) {
    return redisLegacyCall(function (done) {
      global.redisClient.hgetall(key, done)
    })
  })).then(function (workers) {
    return {
      symbol: context.symbol,
      stats: buildAdminStats(workers || [], blocks)
    }
  }).catch(function (error) {
    global.log('error', logSystem, 'Error with getting %s balances from redis: %s', [context.symbol, error && (error.stack || error.message || error.toString()) || error])
    throw error
  })
}

function redisLegacyCall (command) {
  return new Promise(function (resolve, reject) {
    var settled = false
    command(function (error, reply) {
      if (settled) return
      settled = true
      if (arguments.length === 1) {
        if (error instanceof Error) reject(error)
        else resolve(error)
        return
      }
      if (error) reject(error)
      else resolve(reply)
    })
  })
}

function emptyAdminStats () {
  return {
    totalOwed: 0,
    totalPaid: 0,
    totalRevenue: 0,
    totalDiff: 0,
    totalShares: 0,
    blocksOrphaned: 0,
    blocksUnlocked: 0,
    totalWorkers: 0
  }
}

function buildAdminStats (workerData, blocks) {
  var stats = emptyAdminStats()

  for (var i = 0; i < workerData.length; i++) {
    stats.totalOwed += parseInt(workerData[i].balance) || 0
    stats.totalPaid += parseInt(workerData[i].paid) || 0
    stats.totalWorkers++
  }

  for (i = 0; i < blocks.length; i++) {
    var block = String(blocks[i]).split(':')
    var orphaned = block[4] === '1' || block[4] === 'true'
    var reward = parseInt(block[5]) || 0
    if (orphaned || !reward) {
      stats.blocksOrphaned++
      continue
    }
    stats.blocksUnlocked++
    stats.totalDiff += parseInt(block[2]) || 0
    stats.totalShares += parseInt(block[3]) || 0
    stats.totalRevenue += reward
  }

  return stats
}

function handleAdminUsers (response) {
  async.waterfall([
    // get workers Redis keys
    function (callback) {
      global.redisClient.keys(global.config.coin + ':workers:*', callback)
    },
    // get workers data
    function (workerKeys, callback) {
      var redisCommands = workerKeys.map(function (k) {
        return ['hmget', k, 'balance', 'paid', 'lastShare', 'hashes']
      })
      global.redisClient.multi(redisCommands).exec(function (error, redisData) {
        if (error) {
          global.log('info', logSystem, 'Redis error occurred: %s', [error])
          response.end(JSON.stringify({ error: 'backend error' }))
          return
        }
        var workersData = {}
        var addressLength = global.config.poolServer.poolAddress.length
        for (var i in redisData) {
          var address = workerKeys[i].substr(-addressLength)
          var data = redisData[i]
          workersData[address] = {
            pending: data[0],
            paid: data[1],
            lastShare: data[2],
            hashes: data[3],
            hashrate: minerStats[address] ? minerStats[address] : 0
          }
        }
        callback(null, workersData)
      })
    }
  ], function (error, workersData) {
    if (error) {
      response.end(JSON.stringify({ error: 'error collecting users stats' }))
      return
    }
    response.end(JSON.stringify(workersData))
  }
  )
}

function handleAdminMonitoring (response) {
  response.writeHead('200', {
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-cache',
    'Content-Type': 'application/json'
  })
  async.parallel({
    monitoring: getMonitoringData,
    logs: getLogFiles
  }, function (error, result) {
    if (error) {
      global.log('info', logSystem, 'Could not handle admin monitoring: %s', [error])
    }
    response.end(JSON.stringify(result))
  })
}

function handlePublicHealth (response) {
  response.writeHead('200', {
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-cache',
    'Content-Type': 'application/json'
  })
  getMonitoringData(function (error, monitoring) {
    if (error) {
      global.log('info', logSystem, 'Could not handle public health: %s', [error])
    }
    response.end(JSON.stringify(buildPublicHealth(monitoring || {})))
  })
}

function handleMarketPrices (response) {
  if (marketConfig.enabled === false) {
    return sendJson(response, 404, { error: 'market prices disabled' })
  }

  var now = Date.now()
  if (marketPriceCache.payload && marketPriceCache.expires > now) {
    return sendJson(response, 200, marketPriceCache.payload)
  }

  fetchCexswapPrices(function (error, payload) {
    if (error) {
      global.log('info', logSystem, 'Could not fetch CEXSwap market prices: %s', [error.message || error])
      if (marketPriceCache.payload) {
        var stalePayload = Object.assign({}, marketPriceCache.payload, {
          stale: true,
          error: 'market price source unavailable'
        })
        return sendJson(response, 200, stalePayload)
      }
      return sendJson(response, 502, { error: 'market price source unavailable' })
    }

    marketPriceCache.payload = payload
    marketPriceCache.expires = now + (getMarketCacheSeconds() * 1000)
    sendJson(response, 200, payload)
  })
}

function fetchCexswapPrices (callback) {
  var baseUrl = String(marketConfig.baseUrl || 'https://cexswap.cc').replace(/\/+$/, '')
  var symbols = getMarketSymbols()
  var endpoint = baseUrl + '/api/amm/public/prices-usd?codes=' + encodeURIComponent(symbols.join(','))

  https.get(endpoint, function (res) {
    var body = ''
    res.setEncoding('utf8')
    res.on('data', function (chunk) {
      body += chunk
      if (body.length > 1024 * 1024) {
        res.destroy(new Error('market price response too large'))
      }
    })
    res.on('end', function () {
      if (res.statusCode < 200 || res.statusCode >= 300) {
        return callback(new Error('CEXSwap HTTP ' + res.statusCode))
      }
      try {
        callback(null, normalizeMarketPrices(JSON.parse(body), symbols))
      } catch (error) {
        callback(error)
      }
    })
  }).on('error', callback).setTimeout(getMarketTimeoutMs(), function () {
    this.destroy(new Error('CEXSwap request timed out'))
  })
}

function normalizeMarketPrices (prices, symbols) {
  var defaultDisplayAmount = getMarketDisplayAmount()

  var normalized = {
    source: 'CEXSwap',
    url: String(marketConfig.baseUrl || 'https://cexswap.cc').replace(/\/+$/, ''),
    displayAmount: defaultDisplayAmount,
    updated: Date.now() / 1000 | 0,
    prices: {}
  }

  symbols.forEach(function (symbol) {
    var usd = Number(prices && prices[symbol])
    var displayAmount = getMarketDisplayAmount(symbol)
    normalized.prices[symbol] = {
      usd: Number.isFinite(usd) && usd > 0 ? usd : null,
      displayAmount: displayAmount,
      displayUsd: Number.isFinite(usd) && usd > 0 ? usd * displayAmount : null
    }
  })

  return normalized
}

function getMarketDisplayAmount (symbol) {
  var configured = symbol && marketConfig.displayAmounts
    ? Number(marketConfig.displayAmounts[String(symbol).toUpperCase()])
    : null
  var defaultAmount = symbol && defaultMarketDisplayAmounts[String(symbol).toUpperCase()]
    ? defaultMarketDisplayAmounts[String(symbol).toUpperCase()]
    : Number(marketConfig.displayAmount || 1000000)
  var amount = Number.isFinite(configured) && configured > 0 ? configured : defaultAmount
  return Number.isFinite(amount) && amount > 0 ? amount : 1000000
}

function getMarketSymbols () {
  var symbols = marketConfig.symbols
  if (!Array.isArray(symbols) || !symbols.length) symbols = [global.config.symbol, getChildSymbol()].filter(Boolean)
  return symbols.map(function (symbol) {
    return String(symbol || '').trim().toUpperCase()
  }).filter(function (symbol, index, list) {
    return symbol && list.indexOf(symbol) === index
  })
}

function getMarketCacheSeconds () {
  var seconds = Number(marketConfig.cacheSeconds || 300)
  return Number.isFinite(seconds) && seconds > 0 ? seconds : 300
}

function getMarketTimeoutMs () {
  var timeout = Number(marketConfig.timeoutMs || 5000)
  return Number.isFinite(timeout) && timeout > 0 ? timeout : 5000
}

function sendJson (response, statusCode, payload) {
  var reply = JSON.stringify(payload)
  response.writeHead(statusCode, {
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-cache',
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(reply)
  })
  response.end(reply)
}

function buildPublicHealth (monitoring) {
  var now = Date.now() / 1000 | 0
  var services = {
    api: {
      label: 'API',
      status: 'ok',
      lastCheck: now
    },
    pool: {
      label: 'Pool',
      status: currentStats ? 'ok' : 'warn',
      lastCheck: currentStatsCollectedAt || null
    },
    payments: {
      label: 'DEGO payments',
      status: publicPaymentStatus(monitoring.wallet, global.config.payments),
      lastCheck: monitoring.wallet && monitoring.wallet.lastCheck || null
    }
  }

  Object.keys(monitoring).forEach(function (key) {
    var item = monitoring[key] || {}
    if (key === 'wallet' || /:wallet$/.test(key)) return
    services[publicServiceKey(key)] = {
      label: publicServiceLabel(key),
      status: item.lastStatus || 'unknown',
      lastCheck: item.lastCheck || null
    }
  })

  if (mergedMiningConfig.enabled && mergedMiningConfig.child) {
    var childSymbol = getChildSymbol()
    var childPayments = getChildPaymentConfig()
    var childWalletKey = 'mergedMining:' + childSymbol + ':wallet'
    services['mergedMining:' + childSymbol + ':payments'] = {
      label: childSymbol + ' payments',
      status: publicPaymentStatus(monitoring[childWalletKey], childPayments),
      lastCheck: monitoring[childWalletKey] && monitoring[childWalletKey].lastCheck || null
    }
  }

  return {
    status: publicOverallStatus(services),
    updated: now,
    services: services
  }
}

function publicPaymentStatus (walletMonitoring, paymentConfig) {
  if (paymentConfig && paymentConfig.enabled === false) return 'disabled'
  if (!walletMonitoring) return 'unknown'
  return walletMonitoring.lastStatus || 'unknown'
}

function publicServiceKey (key) {
  return String(key).replace(/:/g, '_')
}

function publicServiceLabel (key) {
  if (key === 'daemon') return global.config.symbol + ' daemon'
  if (key === 'wallet') return global.config.symbol + ' wallet'
  var parts = String(key).split(':')
  if (parts.length === 3 && parts[0] === 'mergedMining') return parts[1] + ' ' + parts[2]
  return key
}

function publicOverallStatus (services) {
  var status = 'ok'
  Object.keys(services).forEach(function (key) {
    if (services[key].status === 'fail') status = 'fail'
    if (status !== 'fail' && (services[key].status === 'warn' || services[key].status === 'unknown')) status = 'warn'
  })
  return status
}

function handleAdminLog (urlParts, response) {
  var file = urlParts.query.file
  var filePath = global.config.logging.files.directory + '/' + file
  if (!file.match(/^\w+\.log$/)) {
    response.end('wrong log file')
  }
  response.writeHead(200, {
    'Content-Type': 'text/plain',
    'Cache-Control': 'no-cache',
    'Content-Length': fs.statSync(filePath).size
  })
  fs.createReadStream(filePath).pipe(response)
}

function startRpcMonitoring (rpc, module, method, interval) {
  setInterval(function () {
    rpc(method, {}, function (error, response) {
      var stat = {
        lastCheck: new Date() / 1000 | 0,
        lastStatus: error ? 'fail' : 'ok',
        lastResponse: JSON.stringify(error || response)
      }
      if (error) {
        stat.lastFail = stat.lastCheck
        stat.lastFailResponse = stat.lastResponse
      }
      var key = getMonitoringDataKey(module)
      var redisCommands = []
      for (var property in stat) {
        redisCommands.push(['hset', key, property, stat[property]])
      }
      global.redisClient.multi(redisCommands).exec()
    })
  }, interval * 1000)
}

function getMonitoringDataKey (module) {
  return global.config.coin + ':status:' + module
}

function initMonitoring () {
  var modules = getMonitoringModules()
  for (var i = 0; i < modules.length; i++) {
    var module = modules[i]
    var settings = module.settings
    if (settings.checkInterval) {
      startRpcMonitoring(module.rpc, module.name, settings.rpcMethod, settings.checkInterval)
    }
  }
}

function getMonitoringData (callback) {
  var modules = getMonitoringModules()
  var redisCommands = []
  for (var i in modules) {
    redisCommands.push(['hgetall', getMonitoringDataKey(modules[i].name)])
  }
  global.redisClient.multi(redisCommands).exec(function (error, results) {
    var stats = {}
    for (var i in modules) {
      if (results[i]) {
        stats[modules[i].name] = results[i]
      }
    }
    callback(error, stats)
  })
}

function getMonitoringModules () {
  var modules = []
  var monitoring = global.config.monitoring || {}

  if (monitoring.daemon) {
    modules.push({
      name: 'daemon',
      settings: monitoring.daemon,
      rpc: apiInterfaces.rpcDaemon
    })
  }

  if (monitoring.wallet) {
    modules.push({
      name: 'wallet',
      settings: monitoring.wallet,
      rpc: function (method, params, callback) {
        apiInterfaces.restWallet('GET', '/status', null, callback)
      }
    })
  }

  if (mergedMiningConfig.enabled && mergedMiningConfig.child) {
    var child = mergedMiningConfig.child
    var childSymbol = getChildSymbol()
    var childMonitoring = child.monitoring || {}

    if (child.daemon) {
      modules.push({
        name: 'mergedMining:' + childSymbol + ':daemon',
        settings: childMonitoring.daemon || monitoring.daemon || { checkInterval: 60, rpcMethod: 'getblockcount' },
        rpc: function (method, params, callback) {
          apiInterfaces.rpcDaemonConfig(child.daemon, method, params, callback)
        }
      })
    }

    if (child.wallet) {
      modules.push({
        name: 'mergedMining:' + childSymbol + ':wallet',
        settings: childMonitoring.wallet || monitoring.wallet || { checkInterval: 60, rpcMethod: 'status' },
        rpc: function (method, params, callback) {
          var childApi = require('./apiInterfaces.js')(global.config.daemon, child.wallet, global.config.api)
          childApi.restWallet('GET', '/status', null, callback)
        }
      })
    }
  }

  return modules
}

function getLogFiles (callback) {
  var dir = global.config.logging.files.directory
  fs.readdir(dir, function (error, files) {
    var logs = {}
    for (var i in files) {
      var file = files[i]
      var stats = fs.statSync(dir + '/' + file)
      logs[file] = {
        size: stats.size,
        changed: Date.parse(stats.mtime) / 1000 | 0
      }
    }
    callback(error, logs)
  })
}

var server = http.createServer(function (request, response) {
  if (request.method.toUpperCase() === 'OPTIONS') {
    response.writeHead('204', 'No Content', {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'access-control-allow-headers': 'content-type, accept',
      'access-control-max-age': 10, // Seconds.
      'content-length': 0
    })

    return (response.end())
  }

  var urlParts = url.parse(request.url, true)
  var childStatsPath = '/' + getChildApiSlug() + '/stats'

  switch (urlParts.pathname) {
    case '/stats':
      var deflate = request.headers['accept-encoding'] && request.headers['accept-encoding'].indexOf('deflate') !== -1
      var reply = deflate ? currentStatsCompressed : currentStats
      response.writeHead('200', {
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-cache',
        'Content-Type': 'application/json',
        'Content-Encoding': deflate ? 'deflate' : '',
        'Content-Length': reply.length
      })
      response.end(reply)
      break
    case '/health':
      handlePublicHealth(response)
      break
    case '/market_prices':
      handleMarketPrices(response)
      break
    case '/get_apis':
      handleGetApis(request, response)
      break
    case childStatsPath:
      handleChildStatsFacade(response)
      break
    case '/live_stats':
      response.writeHead(200, {
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-cache',
        'Content-Type': 'application/json',
        'Content-Encoding': 'deflate',
        'Connection': 'keep-alive'
      })
      var uid = Math.random().toString()
      liveConnections[uid] = response
      response.on('finish', function () {
        delete liveConnections[uid]
      })
      break
    case '/stats_address':
      handleMinerStats(urlParts, response)
      break
    case '/get_payments':
      handleGetPayments(urlParts, response)
      break
    case '/get_blocks':
      handleGetBlocks(urlParts, response)
      break
    case '/json_rpc':
      handleDaemonRpc(request, response)
      break
    case '/admin_stats':
      if (!authorize(request, response)) { return }
      handleAdminStats(response)
      break
    case '/admin_monitoring':
      if (!authorize(request, response)) {
        return
      }
      handleAdminMonitoring(response)
      break
    case '/admin_log':
      if (!authorize(request, response)) {
        return
      }
      handleAdminLog(urlParts, response)
      break
    case '/admin_users':
      if (!authorize(request, response)) {
        return
      }
      handleAdminUsers(response)
      break

    case '/miners_hashrate':
      if (!authorize(request, response)) { return }
      handleGetMinersHashrate(response)
      break
    case '/stats_worker':
      handleWorkerStats(urlParts, response)
      break
    case '/get_miner_payout_level':
      handleGetMinerPayoutLevel(urlParts, response)
      break
    case '/set_miner_payout_level':
      handleSetMinerPayoutLevel(urlParts, response)
      break
    default:
      response.writeHead(404, {
        'Access-Control-Allow-Origin': '*'
      })
      response.end('Invalid API call')
      break
  }
})

collectStats()
initMonitoring()

server.listen(global.config.api.port, function () {
  global.log('info', logSystem, 'API started & listening on port %d', [global.config.api.port])
})

#!/usr/bin/env node

const fs = require('fs')
const path = require('path')
const redis = require('redis')

const SUPPORTED_TYPES = new Set(['string', 'hash', 'list', 'set', 'zset'])

function usage () {
  console.log([
    'Usage:',
    '  node scripts/prepare-redis-migration.js --map SOURCE=TARGET [options]',
    '',
    'Options:',
    '  --map SOURCE=TARGET       Prefix mapping to copy. May be repeated.',
    '  --config FILE             JSON file with redis and mappings fields.',
    '  --apply                   Execute writes. Without this, the tool is dry-run only.',
    '  --overwrite               Replace existing target keys when --apply is used.',
    '  --redis-url URL           Redis connection URL.',
    '  --redis-host HOST         Redis host. Default: 127.0.0.1',
    '  --redis-port PORT         Redis port. Default: 6379',
    '  --redis-db DB             Redis database number. Default: 0',
    '  --redis-password PASS     Redis password.',
    '  --sample N                Number of sample keys per mapping. Default: 10',
    '  --show-full-keys          Do not redact long key segments in sample output.',
    '  --help                    Show this help.',
    '',
    'Examples:',
    '  node scripts/prepare-redis-migration.js \\',
    '    --map DeroGoldOld=DeroGold \\',
    '    --map DeroGoldPaymentTest:mergedMining:WRKZ=DeroGold:mergedMining:WRKZ',
    '',
    '  node scripts/prepare-redis-migration.js --config migration.json --apply'
  ].join('\n'))
}

function parseArgs (argv) {
  const args = {
    apply: false,
    overwrite: false,
    redis: {
      host: '127.0.0.1',
      port: 6379,
      db: 0
    },
    mappings: [],
    sample: 10,
    showFullKeys: false
  }

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]

    if (arg === '--help' || arg === '-h') {
      args.help = true
    } else if (arg === '--apply') {
      args.apply = true
    } else if (arg === '--overwrite') {
      args.overwrite = true
    } else if (arg === '--map') {
      const value = requireValue(argv, ++i, '--map')
      args.mappings.push(parseMapping(value))
    } else if (arg.indexOf('--map=') === 0) {
      args.mappings.push(parseMapping(arg.slice('--map='.length)))
    } else if (arg === '--config') {
      args.config = requireValue(argv, ++i, '--config')
    } else if (arg.indexOf('--config=') === 0) {
      args.config = arg.slice('--config='.length)
    } else if (arg === '--redis-url') {
      args.redis.url = requireValue(argv, ++i, '--redis-url')
    } else if (arg.indexOf('--redis-url=') === 0) {
      args.redis.url = arg.slice('--redis-url='.length)
    } else if (arg === '--redis-host') {
      args.redis.host = requireValue(argv, ++i, '--redis-host')
    } else if (arg.indexOf('--redis-host=') === 0) {
      args.redis.host = arg.slice('--redis-host='.length)
    } else if (arg === '--redis-port') {
      args.redis.port = parseInteger(requireValue(argv, ++i, '--redis-port'), '--redis-port')
    } else if (arg.indexOf('--redis-port=') === 0) {
      args.redis.port = parseInteger(arg.slice('--redis-port='.length), '--redis-port')
    } else if (arg === '--redis-db') {
      args.redis.db = parseInteger(requireValue(argv, ++i, '--redis-db'), '--redis-db')
    } else if (arg.indexOf('--redis-db=') === 0) {
      args.redis.db = parseInteger(arg.slice('--redis-db='.length), '--redis-db')
    } else if (arg === '--redis-password') {
      args.redis.password = requireValue(argv, ++i, '--redis-password')
    } else if (arg.indexOf('--redis-password=') === 0) {
      args.redis.password = arg.slice('--redis-password='.length)
    } else if (arg === '--sample') {
      args.sample = parseInteger(requireValue(argv, ++i, '--sample'), '--sample')
    } else if (arg.indexOf('--sample=') === 0) {
      args.sample = parseInteger(arg.slice('--sample='.length), '--sample')
    } else if (arg === '--show-full-keys') {
      args.showFullKeys = true
    } else {
      throw new Error('Unknown argument: ' + arg)
    }
  }

  if (args.config) {
    mergeConfig(args, loadJson(args.config))
  }

  return args
}

function requireValue (argv, index, name) {
  if (index >= argv.length || argv[index].indexOf('--') === 0) {
    throw new Error(name + ' requires a value')
  }
  return argv[index]
}

function parseInteger (value, name) {
  const parsed = parseInt(value, 10)
  if (!Number.isFinite(parsed)) throw new Error(name + ' must be an integer')
  return parsed
}

function parseMapping (value) {
  const splitAt = value.indexOf('=')
  if (splitAt < 1 || splitAt === value.length - 1) {
    throw new Error('--map must be SOURCE=TARGET')
  }
  return {
    sourcePrefix: value.slice(0, splitAt),
    targetPrefix: value.slice(splitAt + 1)
  }
}

function loadJson (fileName) {
  const resolved = path.resolve(process.cwd(), fileName)
  return JSON.parse(fs.readFileSync(resolved, 'utf8'))
}

function mergeConfig (args, config) {
  if (config.redis) {
    Object.assign(args.redis, config.redis)
  }
  if (config.apply !== undefined) args.apply = !!config.apply
  if (config.overwrite !== undefined) args.overwrite = !!config.overwrite
  if (config.sample !== undefined) args.sample = parseInteger(config.sample, 'config.sample')
  if (config.showFullKeys !== undefined) args.showFullKeys = !!config.showFullKeys
  if (Array.isArray(config.mappings)) {
    config.mappings.forEach(function (mapping) {
      if (!mapping.sourcePrefix || !mapping.targetPrefix) {
        throw new Error('config.mappings entries require sourcePrefix and targetPrefix')
      }
      args.mappings.push({
        label: mapping.label,
        sourcePrefix: mapping.sourcePrefix,
        targetPrefix: mapping.targetPrefix
      })
    })
  }
}

function createRedisClient (redisConfig) {
  if (redisConfig.url) {
    return redis.createClient({
      url: redisConfig.url,
      password: redisConfig.password,
      database: redisConfig.db
    })
  }

  return redis.createClient({
    socket: {
      host: redisConfig.host,
      port: redisConfig.port
    },
    password: redisConfig.password,
    database: redisConfig.db
  })
}

async function scanPrefix (client, prefix) {
  const keys = []
  const exactExists = await client.exists(prefix)
  if (exactExists) keys.push(prefix)

  for await (const key of client.scanIterator({ MATCH: prefix + ':*', COUNT: 250 })) {
    keys.push(key)
  }

  return keys.sort()
}

function mapTargetKey (sourceKey, mapping) {
  if (sourceKey === mapping.sourcePrefix) return mapping.targetPrefix
  if (sourceKey.indexOf(mapping.sourcePrefix + ':') !== 0) {
    throw new Error('Source key does not match mapping prefix: ' + sourceKey)
  }
  return mapping.targetPrefix + sourceKey.slice(mapping.sourcePrefix.length)
}

async function inspectMapping (client, mapping, args) {
  const keys = await scanPrefix(client, mapping.sourcePrefix)
  const summary = {
    label: mapping.label || mapping.sourcePrefix + ' -> ' + mapping.targetPrefix,
    sourcePrefix: mapping.sourcePrefix,
    targetPrefix: mapping.targetPrefix,
    sourceKeys: keys.length,
    copied: 0,
    skippedExisting: 0,
    skippedUnsupported: 0,
    errors: 0,
    types: {},
    samples: []
  }

  for (const sourceKey of keys) {
    const targetKey = mapTargetKey(sourceKey, mapping)
    const type = await client.type(sourceKey)
    summary.types[type] = (summary.types[type] || 0) + 1

    const exists = await client.exists(targetKey)
    const sample = {
      sourceKey: sampleKey(sourceKey, args.showFullKeys),
      targetKey: sampleKey(targetKey, args.showFullKeys),
      type: type,
      targetExists: !!exists
    }
    if (summary.samples.length < args.sample) summary.samples.push(sample)

    if (!SUPPORTED_TYPES.has(type)) {
      summary.skippedUnsupported++
      sample.action = 'skip-unsupported'
      continue
    }

    if (exists && !args.overwrite) {
      summary.skippedExisting++
      sample.action = 'skip-existing'
      continue
    }

    if (!args.apply) {
      sample.action = exists ? 'would-overwrite' : 'would-copy'
      continue
    }

    try {
      await copyKey(client, sourceKey, targetKey, type, args.overwrite)
      summary.copied++
      sample.action = exists ? 'overwritten' : 'copied'
    } catch (e) {
      summary.errors++
      sample.action = 'error'
      sample.error = e.message
    }
  }

  return summary
}

async function copyKey (client, sourceKey, targetKey, type, overwrite) {
  if (overwrite) await client.del(targetKey)

  if (type === 'string') {
    const value = await client.get(sourceKey)
    await client.set(targetKey, value)
  } else if (type === 'hash') {
    const value = await client.hGetAll(sourceKey)
    if (Object.keys(value).length) await client.hSet(targetKey, value)
  } else if (type === 'list') {
    const value = await client.lRange(sourceKey, 0, -1)
    if (value.length) await client.rPush(targetKey, value)
  } else if (type === 'set') {
    const value = await client.sMembers(sourceKey)
    if (value.length) await client.sAdd(targetKey, value)
  } else if (type === 'zset') {
    const value = await client.zRangeWithScores(sourceKey, 0, -1)
    if (value.length) await client.zAdd(targetKey, value)
  } else {
    throw new Error('Unsupported Redis type: ' + type)
  }

  const pttl = await client.pTTL(sourceKey)
  if (pttl > 0) await client.pExpire(targetKey, pttl)
}

async function main () {
  const args = parseArgs(process.argv.slice(2))

  if (args.help) {
    usage()
    return
  }
  if (!args.mappings.length) {
    usage()
    throw new Error('At least one --map SOURCE=TARGET is required')
  }

  const client = createRedisClient(args.redis)
  client.on('error', function (error) {
    console.error('Redis client error:', error.message)
  })
  await client.connect()

  const result = {
    mode: args.apply ? 'apply' : 'dry-run',
    overwrite: args.overwrite,
    redis: {
      url: args.redis.url ? redactRedisUrl(args.redis.url) : undefined,
      host: args.redis.url ? undefined : args.redis.host,
      port: args.redis.url ? undefined : args.redis.port,
      db: args.redis.db || 0
    },
    mappings: []
  }

  try {
    for (const mapping of args.mappings) {
      result.mappings.push(await inspectMapping(client, mapping, args))
    }
  } finally {
    await client.quit()
  }

  console.log(JSON.stringify(result, null, 2))

  const failed = result.mappings.some(function (mapping) {
    return mapping.errors > 0 || mapping.skippedUnsupported > 0
  })
  if (failed) process.exitCode = 2
}

function redactRedisUrl (url) {
  return url.replace(/:\/\/([^@/]+)@/, '://***@')
}

function sampleKey (key, showFullKeys) {
  if (showFullKeys) return key
  return key.split(':').map(function (part) {
    if (part.length <= 48) return part
    return part.slice(0, 12) + '...' + part.slice(-8)
  }).join(':')
}

main().catch(function (error) {
  console.error(error.stack || error.message || error)
  process.exit(1)
})

'use strict'

function isEnabled (config) {
  return !!(config && config.enabled)
}

function readHash (hex, name) {
  if (typeof hex !== 'string' || !/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error('mergedMining.' + name + ' must be a 32-byte hex hash')
  }
  return Buffer.from(hex, 'hex')
}

function buildMergedBuffer (parentBuffer, childBuffer, config, cnUtil) {
  return cnUtil.construct_mm_parent_block_blob(
    parentBuffer,
    childBuffer,
    readHash(config.parentGenesisHash, 'parentGenesisHash'),
    readHash(config.childGenesisHash, 'childGenesisHash')
  )
}

function childDaemonConfig (config) {
  if (!isEnabled(config)) return null
  if (!config.child || !config.child.daemon) {
    throw new Error('mergedMining.child.daemon must be configured when merged mining is enabled')
  }
  return config.child.daemon
}

function childPoolAddress (config) {
  if (!isEnabled(config)) return null
  if (!config.child || !config.child.poolAddress) {
    throw new Error('mergedMining.child.poolAddress must be configured when merged mining is enabled')
  }
  return config.child.poolAddress
}

module.exports = {
  isEnabled,
  buildMergedBuffer,
  childDaemonConfig,
  childPoolAddress,
  readHash
}

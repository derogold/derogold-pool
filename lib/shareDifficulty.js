'use strict'

const diff1 = BigInt('0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF')

function bigIntToBuffer (n) {
  let hex = n.toString(16)
  if (hex.length % 2) hex = '0' + hex
  return Buffer.from(hex, 'hex')
}

function toPositiveBigInt (value, name) {
  const n = typeof value === 'bigint' ? value : BigInt(value)
  if (n <= 0n) throw new RangeError(`${name} must be greater than zero`)
  return n
}

function targetFromDifficulty (difficulty) {
  const padded = Buffer.alloc(32)
  const diffBuff = bigIntToBuffer(diff1 / toPositiveBigInt(difficulty, 'difficulty'))
  diffBuff.copy(padded, 32 - diffBuff.length)

  const targetBuffer = Buffer.from(padded.slice(0, 4)).reverse()
  return {
    diffHex: targetBuffer.toString('hex'),
    target: targetBuffer.readUInt32BE(0)
  }
}

function hashToInteger (hash) {
  if (!Buffer.isBuffer(hash) || hash.length !== 32) {
    throw new TypeError('hash must be a 32-byte buffer')
  }

  return BigInt('0x' + Buffer.from(Array.from(hash).reverse()).toString('hex'))
}

function hashToDifficulty (hash) {
  const hashNum = hashToInteger(hash)
  return hashNum === 0n ? 0n : diff1 / hashNum
}

module.exports = {
  diff1,
  targetFromDifficulty,
  hashToInteger,
  hashToDifficulty
}

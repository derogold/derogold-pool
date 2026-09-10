'use strict'

const assert = require('assert')
const cnUtil = require('turtlecoin-cryptonote-util')
const cnHashing = require('cryptonight-hashing')
const shareDifficulty = require('../lib/shareDifficulty.js')

const blockTemplate = {
  blob: '070015648cdc6bb433bd09d505901a4f203529e10fb074078fbb979ba16a4df48bdc0000efbf8cd506000000000000000000000000000000000000000000000000000000000000000000000000010000000023032100000000000000000000000000000000000000000000000000000000000000000001f7dfb50101ffefdfb501070702a4bde2e91473a6e6d75e0f2976444738a2211344720c5f9da19e983db43c06f94602dbc0d7a85a2877e65bcb887992ae516a6a8ff091f998de050478afe3e2d3815cf02e027eff3545ce69e1fd9ac3cfe38323c13d63d9dbdf4590d6e1eaede8b509404cc6b0ea01027b43faf588eaf973c357726932db639d804abd764d2f8f77ddb879c5829ca92ac0a8a50402c11a4b4b67759c0de825d7b4002ff227c947ec04f69330e256731d92177a144880bbb021023bb328e8039ccb250f577baa175dacc90e0c74c9e7c01f6178d4a08c55536dfb8088debe0102b05b21229f3d8100916d68c4764025fa0a06011422159082e442b6f0c2f29cf82b017c674c23efb5438294317cd15ce3aa17a995d27859a6ff55e91a257674d77b5f02080000000000000000021aefb08aebb40c4ce52613d6fb34671246a49071a9f0f9e6944ee5040cadb4433fd1d6161cfdcfc23c0c8de519acd089fc226ac69030c1a862e2818e8695c94d',
  difficulty: 128366794n,
  height: 2977775,
  reserveOffset: 417
}

const job = {
  extraNonce: 5,
  instanceId: '850fb100',
  difficulty: 10000n
}

const fixtures = [
  {
    name: 'accepted_branch0',
    finalizerBranch: 0,
    nonce: 'ceab0000',
    convertedBlob: '0100efbf8cd50615648cdc6bb433bd09d505901a4f203529e10fb074078fbb979ba16a4df48bdcceab00004763ad24b81b02008bfd548aa95e7e4d11571839abd436c1e7c1b37afb4b1fa801',
    expectedHash: '6e49d0e9630640ff0d0a388eb26b28128f832360e07f628fa091c8c94f4f0000'
  },
  {
    name: 'accepted_branch1',
    finalizerBranch: 1,
    nonce: '6e6d0000',
    convertedBlob: '0100efbf8cd50615648cdc6bb433bd09d505901a4f203529e10fb074078fbb979ba16a4df48bdc6e6d00004763ad24b81b02008bfd548aa95e7e4d11571839abd436c1e7c1b37afb4b1fa801',
    expectedHash: '660acde3bfc56fb2399afa9d762475f5dd4a51633287d95b11937bb79b480500'
  },
  {
    name: 'accepted_branch3',
    finalizerBranch: 3,
    nonce: '46e20000',
    convertedBlob: '0100efbf8cd50615648cdc6bb433bd09d505901a4f203529e10fb074078fbb979ba16a4df48bdc46e200004763ad24b81b02008bfd548aa95e7e4d11571839abd436c1e7c1b37afb4b1fa801',
    expectedHash: 'abb322792486a1099a3829dd1f3bfde7f5f3d165caa20ccd17a37359443e0600'
  },
  {
    name: 'false_reject_branch2_a',
    finalizerBranch: 2,
    nonce: '3a380200',
    convertedBlob: '0100efbf8cd50615648cdc6bb433bd09d505901a4f203529e10fb074078fbb979ba16a4df48bdc3a3802004763ad24b81b02008bfd548aa95e7e4d11571839abd436c1e7c1b37afb4b1fa801',
    expectedHash: '13b0b0ee10820ff6c6139cf9d2ca29700dd040fdc00966903797b24fa0cc0100',
    badOfastHash: '49aaa136ba7daf5ada48aa7154707a13640c56ebe498d91573b1618092e06cad'
  },
  {
    name: 'false_reject_branch2_b',
    finalizerBranch: 2,
    nonce: 'b8620400',
    convertedBlob: '0100efbf8cd50615648cdc6bb433bd09d505901a4f203529e10fb074078fbb979ba16a4df48bdcb86204004763ad24b81b02008bfd548aa95e7e4d11571839abd436c1e7c1b37afb4b1fa801',
    expectedHash: '588dcafc2f14dc8f93b5e814f4b9000316b298c507cf94fe16aa8781ffff0400',
    badOfastHash: '752f1231bc9226fc133102fae5e55286dbd6ec53ba91e4d6269d74a9816d9072'
  },
  {
    name: 'false_reject_branch2_c',
    finalizerBranch: 2,
    nonce: '108e0400',
    convertedBlob: '0100efbf8cd50615648cdc6bb433bd09d505901a4f203529e10fb074078fbb979ba16a4df48bdc108e04004763ad24b81b02008bfd548aa95e7e4d11571839abd436c1e7c1b37afb4b1fa801',
    expectedHash: 'd8779a964ac53e2e4b6969a368985e35dca00a9dfe525f9dde66625cfdbf0400',
    badOfastHash: '98a0ea43914c0c903cc620fab5ed2caf4ecf30b96ed43dc0a0929cf6ac442b1b'
  }
]

function shareBlobForNonce (nonce) {
  const template = Buffer.from(blockTemplate.blob, 'hex')
  template.writeUInt32BE(job.extraNonce, blockTemplate.reserveOffset)
  Buffer.from(job.instanceId, 'hex').copy(template, blockTemplate.reserveOffset + 4)
  return cnUtil.construct_block_blob(template, Buffer.from(nonce, 'hex'))
}

for (const fixture of fixtures) {
  const shareBlob = shareBlobForNonce(fixture.nonce)
  const convertedBlob = cnUtil.convert_blob(shareBlob)
  assert.strictEqual(convertedBlob.toString('hex'), fixture.convertedBlob, `${fixture.name}: converted blob`)

  const hash = cnHashing.cryptonight_plex(convertedBlob, 8)
  assert.strictEqual(hash.toString('hex'), fixture.expectedHash, `${fixture.name}: PLEX/UPX2 hash`)
  if (fixture.badOfastHash) {
    assert.notStrictEqual(hash.toString('hex'), fixture.badOfastHash, `${fixture.name}: known -Ofast miscompile hash`)
  }

  const shareDiff = shareDifficulty.hashToDifficulty(hash)
  assert(shareDiff >= job.difficulty, `${fixture.name}: share difficulty ${shareDiff} below ${job.difficulty}`)
  assert(shareDiff < blockTemplate.difficulty, `${fixture.name}: fixture unexpectedly meets block difficulty`)

  console.log(`${fixture.name}: branch=${fixture.finalizerBranch} diff=${shareDiff}`)
}

const target10000 = shareDifficulty.diff1 / 10000n
const roundedStep = target10000 / 10000n
assert.strictEqual(shareDifficulty.hashToInteger(Buffer.from('0100000000000000000000000000000000000000000000000000000000000000', 'hex')), 1n)
assert.strictEqual(shareDifficulty.hashToDifficulty(Buffer.alloc(32)), 0n)
assert.strictEqual(shareDifficulty.hashToDifficulty(uint256LE(target10000)), 10000n)
assert(shareDifficulty.hashToDifficulty(uint256LE(target10000 + 1n)) < 10000n)
assert(shareDifficulty.hashToDifficulty(uint256LE(target10000 - roundedStep)) > 10000n)
assert.throws(() => shareDifficulty.targetFromDifficulty(0), /greater than zero/)
assert.doesNotThrow(() => shareDifficulty.targetFromDifficulty(2n ** 80n))
assert.strictEqual(shareDifficulty.targetFromDifficulty(10000).diffHex, 'b88d0600')

function uint256LE (n) {
  const hex = n.toString(16).padStart(64, '0')
  return Buffer.from(hex.match(/../g).reverse().join(''), 'hex')
}

console.log(`share replay vectors passed: ${fixtures.length}/${fixtures.length}`)

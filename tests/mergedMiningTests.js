'use strict'

const assert = require('assert')
const cnUtil = require('turtlecoin-cryptonote-util')
const mergedMining = require('../lib/mergedMining.js')

const parentTemplate = {
  blocktemplate_blob: '070015648cdc6bb433bd09d505901a4f203529e10fb074078fbb979ba16a4df48bdc0000efbf8cd506000000000000000000000000000000000000000000000000000000000000000000000000010000000023032100000000000000000000000000000000000000000000000000000000000000000001f7dfb50101ffefdfb501070702a4bde2e91473a6e6d75e0f2976444738a2211344720c5f9da19e983db43c06f94602dbc0d7a85a2877e65bcb887992ae516a6a8ff091f998de050478afe3e2d3815cf02e027eff3545ce69e1fd9ac3cfe38323c13d63d9dbdf4590d6e1eaede8b509404cc6b0ea01027b43faf588eaf973c357726932db639d804abd764d2f8f77ddb879c5829ca92ac0a8a50402c11a4b4b67759c0de825d7b4002ff227c947ec04f69330e256731d92177a144880bbb021023bb328e8039ccb250f577baa175dacc90e0c74c9e7c01f6178d4a08c55536dfb8088debe0102b05b21229f3d8100916d68c4764025fa0a06011422159082e442b6f0c2f29cf82b017c674c23efb5438294317cd15ce3aa17a995d27859a6ff55e91a257674d77b5f02080000000000000000021aefb08aebb40c4ce52613d6fb34671246a49071a9f0f9e6944ee5040cadb4433fd1d6161cfdcfc23c0c8de519acd089fc226ac69030c1a862e2818e8695c94d',
  difficulty: 128366794,
  height: 2977775,
  reserved_offset: 417
}

const childTemplate = {
  blocktemplate_blob: '0600b202c10839114a0beff7a198f58c8bb98dcb7bece23fe470f8932a7f408d966b0000ff97e5f905000000000000000000000000000000000000000000000000000000000000000000000000010000000023032100000000000000000000000000000000000000000000000000000000000000000001ecb4ab0101ffc4b4ab0106060295cfad0503908a8b7309d7167dcff4867bd31cf02a5888bfb3a3c33fed81991d64029fd4040457feb01a915b1791a0b01e32e26414b105f500660edd9bbf4092c08ae80702101fe42efb65a694c3508758af2b05184858827f8b3494f2b29eb288d4d7bc19c0b80202d903c42269db0d5c5f961d717bf8f467582cb2ac5c2bb189d57743d97b2e73e0e0dc2a021abb1f568a7aa4f0ba2ed2238c495ebaa0a8012abfd63fcb31836a11dcfd94c580897a02807910d7993d5c21e367f466918da568fb3a8ab96ccaed732000087a2535647f8c0101651ba7aa2bf4fd745ce1ab683c7d6ab5a9db52951125627d437b3cb91324497f0706000000000000045d0dd5b208bf363b00d9e941197f1bea7df5336ee70a854ffdc42c13caca704505a9f0d9e66a156ead440c72e168b4a4e656e1822593537898b9d6e93a3267583006e31a73a4fc42368ff94bcdd92e02bffd144c934c348b5d1015b7b1354741fa0100',
  difficulty: 10000,
  height: 2808388,
  reserved_offset: 378
}

const config = {
  enabled: true,
  parentGenesisHash: '0000000000000000000000000000000000000000000000000000000000000000',
  childGenesisHash: '0100000000000000000000000000000000000000000000000000000000000000',
  child: {
    poolAddress: 'WRKZ_POOL_ADDRESS',
    daemon: {
      host: '127.0.0.1',
      port: 17856
    }
  }
}

const nonce = Buffer.from('ceab0000', 'hex')
const preparedParentTemplate = Buffer.from(parentTemplate.blocktemplate_blob, 'hex')
preparedParentTemplate.writeUInt32BE(5, parentTemplate.reserved_offset)
Buffer.from('850fb100', 'hex').copy(preparedParentTemplate, parentTemplate.reserved_offset + 4)

const mergedTemplate = mergedMining.buildMergedBuffer(
  preparedParentTemplate,
  Buffer.from(childTemplate.blocktemplate_blob, 'hex'),
  config,
  cnUtil
)
assert(mergedTemplate.length > preparedParentTemplate.length)

const mergedParentShare = cnUtil.construct_block_blob(mergedTemplate, nonce)
const unmergedParentShare = cnUtil.construct_block_blob(preparedParentTemplate, nonce)

assert.notStrictEqual(
  cnUtil.convert_blob(mergedParentShare).toString('hex'),
  cnUtil.convert_blob(unmergedParentShare).toString('hex')
)

const childBlock = cnUtil.construct_mm_child_block_blob(
  mergedParentShare,
  Buffer.from(childTemplate.blocktemplate_blob, 'hex'),
  mergedMining.readHash(config.parentGenesisHash, 'parentGenesisHash'),
  mergedMining.readHash(config.childGenesisHash, 'childGenesisHash')
)

assert.doesNotThrow(() => cnUtil.convert_blob(childBlock))
assert.doesNotThrow(() => cnUtil.get_block_id(childBlock))

assert.throws(
  () => mergedMining.buildMergedBuffer(preparedParentTemplate, Buffer.from(childTemplate.blocktemplate_blob, 'hex'), { enabled: true }, cnUtil),
  /mergedMining.parentGenesisHash/
)

console.log('merged mining helper tests passed')

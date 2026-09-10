'use strict'

const cnUtil = require('turtlecoin-cryptonote-util')
const multiHashing = require('wrkzcoin-multi-hashing')
const assert = require('assert')

// turtlecoin-multi-hashing tests

const xmrigdata = Buffer.from('0100fb8e8ac805899323371bb790db19218afd8db8e3755d8b90f39b3d5506a9abce4fa912244500000000ee8146d49fa93ee724deb57d12cbc6c6f3b924d946127c7a97418f9348828f0f02', 'hex')

const cnfasthash = Buffer.from('b542df5b6e7f5f05275c98e7345884e2ac726aeeb07e03e44e0389eb86cd05f0', 'hex')
const xmrigcnvariant0hash = Buffer.from('1b606a3f4a07d6489a1bcd07697bd16696b61c8ae982f61a90160f4e52828a7f', 'hex')
const xmrigcnvariant1hash = Buffer.from('c9fae8425d8688dc236bcdbc42fdb42d376c6ec190501aa84b04a4b4cf1ee122', 'hex')
const xmrigcnvariant2hash = Buffer.from('871fcd6823f6a879bb3f33951c8e8e891d4043880b02dfa1bb3be498b50e7578', 'hex')

const xmrigcnlitevariant0hash = Buffer.from('28a22bad3f93d1408fca472eb5ad1cbe75f21d053c8ce5b3af105a57713e21dd', 'hex')
const xmrigcnlitevariant1hash = Buffer.from('81db15880da42189f0270e559aa166f663703d6202d42f20e55c471911de75bc', 'hex')
const xmrigcnlitevariant2hash = Buffer.from('b7e78fab22eb19cb8c9c3afe034fb53390321511bab6ab4915cd538a630c3c62', 'hex')

const xmrigcndarkvariant0hash = Buffer.from('0faf67c7cbb1de8cb102613d7a34dd78bc4d0eaf3b3080e325c8ea2b218a4dab', 'hex')
const xmrigcndarkvariant1hash = Buffer.from('d18cb32bd5b465e5a7ba4763d60f88b5792f24e513306f1052954294b737e871', 'hex')
const xmrigcndarkvariant2hash = Buffer.from('7acbbdf53c5f11bf598608f00744ed47822151a086f2d0b2ce9461e221f2d2ac', 'hex')

const xmrigcndarklitevariant0hash = Buffer.from('faa7884d9c08126eb164814aeba6547b5d6064277a09fb6b414f5dbc9d01eb2b', 'hex')
const xmrigcndarklitevariant1hash = Buffer.from('c75c010780fffd9d5e99838eb093b37c0dd015101c9d298217866daa2993d277', 'hex')
const xmrigcndarklitevariant2hash = Buffer.from('fdceb794c1055977a955f31c576a8be528a0356ee1b0a1f9b7f09e20185cda28', 'hex')

const xmrigcnturtlevariant0hash = Buffer.from('546c3f1badd7c1232c7a3b88cdb013f7f611b7bd3d1d2463540fccbd12997982', 'hex')
const xmrigcnturtlevariant1hash = Buffer.from('29e7831780a0ab930e0fe3b965f30e8a44d9b3f9ad2241d67cfbfea3ed62a64e', 'hex')
const xmrigcnturtlevariant2hash = Buffer.from('3080efe454e53de804d2b94ba58a292e725a4bf6fb8dd58949bc4e1369ffb3a7', 'hex')

const xmrigcnturtlelitevariant0hash = Buffer.from('5e1891a15d5d85c09baf4a3bbe33675cfa3f77229c8ad66c01779e590528d6d3', 'hex')
const xmrigcnturtlelitevariant1hash = Buffer.from('ae7f864a7a2f2b07dcef253581e60a014972b9655a152341cb989164761c180a', 'hex')
const xmrigcnturtlelitevariant2hash = Buffer.from('b2172ec9466e1aee70ec8572a14c233ee354582bcb93f869d429744de5726a26', 'hex')

const cnsoftshellHashv0 = []
cnsoftshellHashv0.push(Buffer.from('5e1891a15d5d85c09baf4a3bbe33675cfa3f77229c8ad66c01779e590528d6d3', 'hex'))
cnsoftshellHashv0.push(Buffer.from('d48f70aff41747497c31e46f6d67c5192f52559148e414557d45184448237a84', 'hex'))
cnsoftshellHashv0.push(Buffer.from('118a03801c564d12f7e68972419303fe06f7a54ab8f44a8ce7deafbc6b1b5183', 'hex'))
cnsoftshellHashv0.push(Buffer.from('aa638871e072300dfbf22b294e5d0c37a56599cfa3546f89c9a8c3a8a9945d28', 'hex'))
cnsoftshellHashv0.push(Buffer.from('5f0fab20d03658ac24363ddb458babd9071e8f4c3933b0228ac1f0603404c675', 'hex'))
cnsoftshellHashv0.push(Buffer.from('aa638871e072300dfbf22b294e5d0c37a56599cfa3546f89c9a8c3a8a9945d28', 'hex'))
cnsoftshellHashv0.push(Buffer.from('118a03801c564d12f7e68972419303fe06f7a54ab8f44a8ce7deafbc6b1b5183', 'hex'))
cnsoftshellHashv0.push(Buffer.from('d48f70aff41747497c31e46f6d67c5192f52559148e414557d45184448237a84', 'hex'))
cnsoftshellHashv0.push(Buffer.from('5e1891a15d5d85c09baf4a3bbe33675cfa3f77229c8ad66c01779e590528d6d3', 'hex'))
cnsoftshellHashv0.push(Buffer.from('d48f70aff41747497c31e46f6d67c5192f52559148e414557d45184448237a84', 'hex'))
cnsoftshellHashv0.push(Buffer.from('118a03801c564d12f7e68972419303fe06f7a54ab8f44a8ce7deafbc6b1b5183', 'hex'))
cnsoftshellHashv0.push(Buffer.from('aa638871e072300dfbf22b294e5d0c37a56599cfa3546f89c9a8c3a8a9945d28', 'hex'))
cnsoftshellHashv0.push(Buffer.from('5f0fab20d03658ac24363ddb458babd9071e8f4c3933b0228ac1f0603404c675', 'hex'))
cnsoftshellHashv0.push(Buffer.from('aa638871e072300dfbf22b294e5d0c37a56599cfa3546f89c9a8c3a8a9945d28', 'hex'))
cnsoftshellHashv0.push(Buffer.from('118a03801c564d12f7e68972419303fe06f7a54ab8f44a8ce7deafbc6b1b5183', 'hex'))
cnsoftshellHashv0.push(Buffer.from('d48f70aff41747497c31e46f6d67c5192f52559148e414557d45184448237a84', 'hex'))
cnsoftshellHashv0.push(Buffer.from('5e1891a15d5d85c09baf4a3bbe33675cfa3f77229c8ad66c01779e590528d6d3', 'hex'))

const cnsoftshellHashv1 = []
cnsoftshellHashv1.push(Buffer.from('ae7f864a7a2f2b07dcef253581e60a014972b9655a152341cb989164761c180a', 'hex'))
cnsoftshellHashv1.push(Buffer.from('d7a4ebee5921fdd106a1c95537fec7e8d4e4267992d4cd7b8741c5d0f5d0b9ad', 'hex'))
cnsoftshellHashv1.push(Buffer.from('ddb6011d400ac8725995fb800af11646bb2fef0d8b6136b634368ad28272d7f4', 'hex'))
cnsoftshellHashv1.push(Buffer.from('02576f9873dc9c8b1b0fc14962982734dfdd41630fc936137a3562b8841237e1', 'hex'))
cnsoftshellHashv1.push(Buffer.from('d37e2785ab7b3d0a222940bf675248e7b96054de5c82c5f0b141014e136eadbc', 'hex'))
cnsoftshellHashv1.push(Buffer.from('02576f9873dc9c8b1b0fc14962982734dfdd41630fc936137a3562b8841237e1', 'hex'))
cnsoftshellHashv1.push(Buffer.from('ddb6011d400ac8725995fb800af11646bb2fef0d8b6136b634368ad28272d7f4', 'hex'))
cnsoftshellHashv1.push(Buffer.from('d7a4ebee5921fdd106a1c95537fec7e8d4e4267992d4cd7b8741c5d0f5d0b9ad', 'hex'))
cnsoftshellHashv1.push(Buffer.from('ae7f864a7a2f2b07dcef253581e60a014972b9655a152341cb989164761c180a', 'hex'))
cnsoftshellHashv1.push(Buffer.from('d7a4ebee5921fdd106a1c95537fec7e8d4e4267992d4cd7b8741c5d0f5d0b9ad', 'hex'))
cnsoftshellHashv1.push(Buffer.from('ddb6011d400ac8725995fb800af11646bb2fef0d8b6136b634368ad28272d7f4', 'hex'))
cnsoftshellHashv1.push(Buffer.from('02576f9873dc9c8b1b0fc14962982734dfdd41630fc936137a3562b8841237e1', 'hex'))
cnsoftshellHashv1.push(Buffer.from('d37e2785ab7b3d0a222940bf675248e7b96054de5c82c5f0b141014e136eadbc', 'hex'))
cnsoftshellHashv1.push(Buffer.from('02576f9873dc9c8b1b0fc14962982734dfdd41630fc936137a3562b8841237e1', 'hex'))
cnsoftshellHashv1.push(Buffer.from('ddb6011d400ac8725995fb800af11646bb2fef0d8b6136b634368ad28272d7f4', 'hex'))
cnsoftshellHashv1.push(Buffer.from('d7a4ebee5921fdd106a1c95537fec7e8d4e4267992d4cd7b8741c5d0f5d0b9ad', 'hex'))
cnsoftshellHashv1.push(Buffer.from('ae7f864a7a2f2b07dcef253581e60a014972b9655a152341cb989164761c180a', 'hex'))

const fastHashData = multiHashing['cryptonight'](xmrigdata, true)
const cnvariant0Data = multiHashing['cryptonight'](xmrigdata)
const cnvariant1Data = multiHashing['cryptonight'](xmrigdata, 1)
const cnvariant2Data = multiHashing['cryptonight'](xmrigdata, 2)
const cnlitevariant0Data = multiHashing['cryptonight-lite'](xmrigdata, 0)
const cnlitevariant1Data = multiHashing['cryptonight-lite'](xmrigdata, 1)
const cnlitevariant2Data = multiHashing['cryptonight-lite'](xmrigdata, 2)
const cndarkvariant0Data = multiHashing['cryptonight-dark'](xmrigdata, 0)
const cndarkvariant1Data = multiHashing['cryptonight-dark'](xmrigdata, 1)
const cndarkvariant2Data = multiHashing['cryptonight-dark'](xmrigdata, 2)
const cndarklitevariant0Data = multiHashing['cryptonight-dark-lite'](xmrigdata, 0)
const cndarklitevariant1Data = multiHashing['cryptonight-dark-lite'](xmrigdata, 1)
const cndarklitevariant2Data = multiHashing['cryptonight-dark-lite'](xmrigdata, 2)
const cnturtlevariant0Data = multiHashing['cryptonight-turtle'](xmrigdata, 0)
const cnturtlevariant1Data = multiHashing['cryptonight-turtle'](xmrigdata, 1)
const cnturtlevariant2Data = multiHashing['cryptonight-turtle'](xmrigdata, 2)
const cnturtlelitevariant0Data = multiHashing['cryptonight-turtle-lite'](xmrigdata, 0)
const cnturtlelitevariant1Data = multiHashing['cryptonight-turtle-lite'](xmrigdata, 1)
const cnturtlelitevariant2Data = multiHashing['cryptonight-turtle-lite'](xmrigdata, 2)

// Easy fill soft shell data
const cnsoftshellDatav0 = []
for (let i = 0; i <= 8192; i += 512) {
  cnsoftshellDatav0.push({ height: i, hash: multiHashing['cryptonight-soft-shell'](xmrigdata, 0, i) })
}

// Easy fill soft shell data
const cnsoftshellDatav1 = []
for (let i = 0; i <= 8192; i += 512) {
  cnsoftshellDatav1.push({ height: i, hash: multiHashing['cryptonight-soft-shell'](xmrigdata, 1, i) })
}

// Easy fill soft shell data
const cnsoftshellDatav2 = []
for (let i = 0; i <= 8192; i += 512) {
  cnsoftshellDatav2.push({ height: i, hash: multiHashing['cryptonight-soft-shell'](xmrigdata, 2, i) })
}

console.log('')
console.log('[#1] Cryptonight Fast Hash: ', fastHashData.toString('hex'))
assert.deepEqual(fastHashData, cnfasthash)
console.log('')
console.log('[#2] Cryptonight v0: ', cnvariant0Data.toString('hex'))
assert.deepEqual(cnvariant0Data, xmrigcnvariant0hash)
console.log('[#3] Cryptonight v1: ', cnvariant1Data.toString('hex'))
assert.deepEqual(cnvariant1Data, xmrigcnvariant1hash)
console.log('[#4] Cryptonight v2: ', cnvariant2Data.toString('hex'))
assert.deepEqual(cnvariant2Data, xmrigcnvariant2hash)
console.log('')
console.log('[#5] Cryptonight Lite v0: ', cnlitevariant0Data.toString('hex'))
assert.deepEqual(cnlitevariant0Data, xmrigcnlitevariant0hash)
console.log('[#6] Cryptonight Lite v1: ', cnlitevariant1Data.toString('hex'))
assert.deepEqual(cnlitevariant1Data, xmrigcnlitevariant1hash)
console.log('[#7] Cryptonight Lite v2: ', cnlitevariant2Data.toString('hex'))
assert.deepEqual(cnlitevariant2Data, xmrigcnlitevariant2hash)
console.log('')
console.log('[#8] Cryptonight Dark v0: ', cndarkvariant0Data.toString('hex'))
assert.deepEqual(cndarkvariant0Data, xmrigcndarkvariant0hash)
console.log('[#9] Cryptonight Dark v1: ', cndarkvariant1Data.toString('hex'))
assert.deepEqual(cndarkvariant1Data, xmrigcndarkvariant1hash)
console.log('[#10] Cryptonight Dark v2: ', cndarkvariant2Data.toString('hex'))
assert.deepEqual(cndarkvariant2Data, xmrigcndarkvariant2hash)
console.log('')
console.log('[#11] Cryptonight Dark Lite v0: ', cndarklitevariant0Data.toString('hex'))
assert.deepEqual(cndarklitevariant0Data, xmrigcndarklitevariant0hash)
console.log('[#12] Cryptonight Dark Lite v1: ', cndarklitevariant1Data.toString('hex'))
assert.deepEqual(cndarklitevariant1Data, xmrigcndarklitevariant1hash)
console.log('[#13] Cryptonight Dark Lite v2: ', cndarklitevariant2Data.toString('hex'))
assert.deepEqual(cndarklitevariant2Data, xmrigcndarklitevariant2hash)
console.log('')
console.log('[#14] Cryptonight Turtle v0: ', cnturtlevariant0Data.toString('hex'))
assert.deepEqual(cnturtlevariant0Data, xmrigcnturtlevariant0hash)
console.log('[#15] Cryptonight Turtle v1: ', cnturtlevariant1Data.toString('hex'))
assert.deepEqual(cnturtlevariant1Data, xmrigcnturtlevariant1hash)
console.log('[#16] Cryptonight Turtle v2: ', cnturtlevariant2Data.toString('hex'))
assert.deepEqual(cnturtlevariant2Data, xmrigcnturtlevariant2hash)
console.log('')
console.log('[#17] Cryptonight Turtle Lite v0: ', cnturtlelitevariant0Data.toString('hex'))
assert.deepEqual(cnturtlelitevariant0Data, xmrigcnturtlelitevariant0hash)
console.log('[#18] Cryptonight Turtle Lite v1: ', cnturtlelitevariant1Data.toString('hex'))
assert.deepEqual(cnturtlelitevariant1Data, xmrigcnturtlelitevariant1hash)
console.log('[#19] Cryptonight Turtle Lite v2: ', cnturtlelitevariant2Data.toString('hex'))
assert.deepEqual(cnturtlelitevariant2Data, xmrigcnturtlelitevariant2hash)

// Spit out soft shell hashes
let count = 20
console.log('')

for (let i = 0; i < cnsoftshellDatav0.length; i++) {
  console.log('[#' + count + '] Cryptonight Soft Shell v0 (' + cnsoftshellDatav0[i].height + '): ', cnsoftshellDatav0[i].hash.toString('hex'))
  count++
}

for (let i = 0; i < cnsoftshellDatav0.length; i++) {
  assert.deepEqual(cnsoftshellDatav0[i].hash, cnsoftshellHashv0[i])
}

console.log('')
for (let i = 0; i < cnsoftshellDatav1.length; i++) {
  console.log('[#' + count + '] Cryptonight Soft Shell v1 (' + cnsoftshellDatav1[i].height + '): ', cnsoftshellDatav1[i].hash.toString('hex'))
  count++
}

for (let i = 0; i < cnsoftshellDatav1.length; i++) {
  assert.deepEqual(cnsoftshellDatav1[i].hash, cnsoftshellHashv1[i])
}

/* We cannot currently generate a valid Soft Shell v2 hash at this time
   that issue will be rectified soon */

/*
console.log('')
for (let i = 0; i < cnsoftshellDatav2.length; i++) {
  console.log('[#' + count + '] Cryptonight Soft Shell v2 (' + cnsoftshellDatav2[i].height + '): ', cnsoftshellDatav2[i].hash.toString('hex'))
  count++
}
*/

// turtlecoin-cryptonote-util tests

const validAddressPrefix = 3914525
const address = Buffer.from('TRTLuxN6FVALYxeAEKhtWDYNS9Vd9dHVp3QHwjKbo76ggQKgUfVjQp8iPypECCy3MwZVyu89k1fWE2Ji6EKedbrqECHHWouZN6g')

const addressPrefix = cnUtil.address_decode(address)

console.log('')
console.log('')
console.log('[#' + count + '] Address Prefix: ', addressPrefix)

assert.deepEqual(validAddressPrefix, addressPrefix)

'use strict'

/**
 * Patches native C++ addons to compile against modern Node / V8 headers.
 *
 * The upstream packages were written against the old V8 API (pre-Node 10) and
 * will not compile on modern Node without these changes.  Run after every
 * `npm install --ignore-scripts`:
 *
 *   npm install --ignore-scripts
 *   node scripts/patch-native-addons.js
 */

const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')

const nm = path.join(__dirname, '..', 'node_modules')

function patchFile (filePath, replacements) {
  if (!fs.existsSync(filePath)) {
    console.log(`  skip (not found): ${filePath}`)
    return false
  }
  let content = fs.readFileSync(filePath, 'utf8')
  let changed = false
  for (const [from, to] of replacements) {
    if (content.includes(from)) {
      // replaceAll via split/join to avoid RegExp special-char issues
      content = content.split(from).join(to)
      changed = true
    }
  }
  if (changed) {
    fs.writeFileSync(filePath, content, 'utf8')
    console.log(`  patched: ${path.relative(nm, filePath)}`)
  } else {
    console.log(`  already ok: ${path.relative(nm, filePath)}`)
  }
  return changed
}

function rebuild (packageName) {
  const dir = path.join(nm, packageName)
  if (!fs.existsSync(dir)) {
    console.log(`  skip rebuild (not installed): ${packageName}`)
    return
  }
  console.log(`  rebuilding ${packageName} ...`)
  try {
    execSync('node-gyp rebuild', { cwd: dir, stdio: 'inherit' })
    console.log(`  rebuilt: ${packageName}`)
  } catch (e) {
    console.error(`  ERROR: failed to rebuild ${packageName}`)
    process.exit(1)
  }
}

// ---------------------------------------------------------------------------
// wrkzcoin-multi-hashing
// Fixes: C++ standard (c++0x -> c++20), V8 API (ToObject / Value accessors /
//        String::NewFromUtf8 now return MaybeLocal / need context argument)
// ---------------------------------------------------------------------------
console.log('\n[wrkzcoin-multi-hashing]')
patchFile(path.join(nm, 'wrkzcoin-multi-hashing', 'binding.gyp'), [
  ['-std=c++0x', '-std=c++20'],
  ['-std=c++17', '-std=c++20']
])
patchFile(path.join(nm, 'wrkzcoin-multi-hashing', 'multihashing.cc'), [
  // String::NewFromUtf8 now returns MaybeLocal<String>
  [
    'String::NewFromUtf8(isolate, msg))',
    'String::NewFromUtf8(isolate, msg).ToLocalChecked())'
  ],
  // ToObject() requires a context argument
  [
    '->ToObject()',
    '->ToObject(isolate->GetCurrentContext()).ToLocalChecked()'
  ],
  // Value accessors require a context argument
  [
    '->Uint32Value()',
    '->Uint32Value(isolate->GetCurrentContext()).FromJust()'
  ],
  [
    '->Int32Value()',
    '->Int32Value(isolate->GetCurrentContext()).FromJust()'
  ],
  // BooleanValue no longer needs a context but does need the isolate
  [
    '->BooleanValue()',
    '->BooleanValue(isolate)'
  ]
])
rebuild('wrkzcoin-multi-hashing')

// ---------------------------------------------------------------------------
// turtlecoin-cryptonote-util
// Fixes: C++ standard and binary_archive.h for modern Node/V8 headers.
// ---------------------------------------------------------------------------
console.log('\n[turtlecoin-cryptonote-util]')
patchFile(path.join(nm, 'turtlecoin-cryptonote-util', 'binding.gyp'), [
  ['-std=c++0x', '-std=c++20'],
  ['-std=c++14', '-std=c++20'],
  ['-std=c++17', '-std=c++20']
])
patchFile(path.join(nm, 'turtlecoin-cryptonote-util', 'src', 'serialization', 'binary_archive.h'), [
  ['stream_type::streampos', 'std::streampos']
])
patchFile(path.join(nm, 'turtlecoin-cryptonote-util', 'src', 'main.cc'), [
  ['std::vector<crypto::hash>', 'std::vector<::crypto::hash>'],
  ['block2.parent_block.miner_tx_branch.resize(crypto::tree_depth(block1.tx_hashes.size() + 1));', 'block2.parent_block.miner_tx_branch.resize(::crypto::tree_depth(block1.tx_hashes.size() + 1));'],
  ['    tree_branch(transactionHashes.data(), transactionHashes.size(), block2.parent_block.miner_tx_branch.data());', '    ::crypto::tree_branch(transactionHashes.data(), transactionHashes.size(), block2.parent_block.miner_tx_branch.data());'],
  ['    crypto::hash block_id;', '    ::crypto::hash block_id;'],
  ['    if (!crypto::check_key(adr.m_spend_public_key) || !crypto::check_key(adr.m_view_public_key)) {', '    if (!::crypto::check_key(adr.m_spend_public_key) || !::crypto::check_key(adr.m_view_public_key)) {']
])
rebuild('turtlecoin-cryptonote-util')

// ---------------------------------------------------------------------------
// cryptonight-hashing
// Fixes: V8 ToObject() — uses NAN, so context is Nan::GetCurrentContext()
//        (no bare `isolate` variable in NAN_METHOD scope)
//        c_jh.c is miscompiled by modern GCC under -Ofast; use -O2 for C
//        finalizer sources so PLEX/UPX2 JH hashes match miner/daemon truth.
// ---------------------------------------------------------------------------
console.log('\n[cryptonight-hashing]')
patchFile(path.join(nm, 'cryptonight-hashing', 'binding.gyp'), [
  [
    '-std=gnu11      -fPIC -DNDEBUG -Ofast -fno-fast-math',
    '-std=gnu11      -fPIC -DNDEBUG -O2 -fno-fast-math'
  ],
  [
    '-std=gnu++11 -s -fPIC -DNDEBUG -Ofast -fno-fast-math -fno-exceptions -fno-rtti -Wno-class-memaccess',
    '-std=gnu++20 -s -fPIC -DNDEBUG -Ofast -fno-fast-math -fno-exceptions -fno-rtti -Wno-class-memaccess'
  ]
])
patchFile(path.join(nm, 'cryptonight-hashing', 'multihashing.cc'), [
  [
    '->ToObject()',
    '->ToObject(Nan::GetCurrentContext()).ToLocalChecked()'
  ]
])
rebuild('cryptonight-hashing')

console.log('\nAll native addons patched and rebuilt successfully.')

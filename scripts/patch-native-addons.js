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
// The DeroGold fork contains the modern Node/V8 and merged-mining helper fixes.
// Rebuild the source checkout after npm installs it with lifecycle scripts
// disabled.
// ---------------------------------------------------------------------------
console.log('\n[turtlecoin-cryptonote-util]')
rebuild('turtlecoin-cryptonote-util')

// ---------------------------------------------------------------------------
// cryptonight-hashing
// The DeroGold fork contains the Node/V8 and PLEX/UPX2 hash fixes. Rebuild the
// source checkout after npm installs it with lifecycle scripts disabled.
// ---------------------------------------------------------------------------
console.log('\n[cryptonight-hashing]')
rebuild('cryptonight-hashing')

console.log('\nAll native addons patched and rebuilt successfully.')

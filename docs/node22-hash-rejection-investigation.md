# Node 22+ Hash Rejection Investigation

Status: root cause reproduced and fixed in the pool integration patch path.
The durable upstream source fix is still pending identification of the DeroGold
repository used to publish `@leocuvee/cryptonight-hashing`.

## Share Validation Path

Observed in `lib/pool.js`:

- `BlockTemplate.nextBlob()` writes the pool extra nonce into the daemon `blocktemplate_blob` reserve area and returns `turtlecoin-cryptonote-util.convert_blob(this.buffer)` as the miner job blob.
- `Miner.getTargetHex()` computes the Stratum target from `diff1 / miner.difficulty`, stores the 32-bit target integer, and returns the first four target bytes in little-endian order.
- `processShare()` reconstructs the submitted block from the original daemon template, `job.extraNonce`, and the submitted nonce via `turtlecoin-cryptonote-util.construct_block_blob()`.
- `processShare()` then calls `turtlecoin-cryptonote-util.convert_blob()` on that reconstructed block.
- For block major version `>= 7`, `processShare()` hashes with `cryptonight-hashing.cryptonight_plex(convertedBlob, 8)`.
- The first rejection gate is bytewise equality between the local hash and miner-submitted `result`. A mismatch logs `Bad hash from miner` and returns `false`.
- Difficulty is checked only after bytewise equality. The 32-byte hash is reversed, parsed as a 256-bit integer, and compared as `diff1 / hashNum` against block and job difficulty.
- The Stratum reply path maps any `processShare()` false return to `Low difficulty share`, so miner output alone cannot distinguish `Bad hash` from a true low-difficulty share.

## Observed Facts

- Live Docker test stack:
  - pool image: `node:22-bookworm-slim`, Node `v22.23.2`, V8 `12.4.254.21-node.56`, node-gyp `v13.0.2`, Debian GCC/G++ `12.2.0`, x86_64.
  - miner image: XMRig `v6.26.0`, GCC/G++ `15.3.0`, `cn/upx2`, `--asm=none`, fixed difficulty `10000`.
- A 60 second one-thread run produced `20` accepted shares and `7` server-side `bad_hash` captures. A 60 second twelve-thread run produced `201` accepted shares and `53` server-side `bad_hash` captures.
- Instrumented XMRig rehashed each submitted share immediately before submit and matched its own submitted result. That excludes Stratum result corruption in the tested path.
- The failures correlated with CryptoNight finalizer branch `2` only. In one traced window, branch `2` was `0/8` accepted while branches `0`, `1`, and `3` were `34/34` accepted.
- The pool-reconstructed converted blob for each captured share matches the fixture replay input. That excludes `construct_block_blob()`, `convert_blob()`, nonce placement, and job context as the failing boundary for these captures.
- Host replay using the same published package source and Node `v22.22.2` produced the miner hashes for all sampled captures. Docker replay using byte-identical source and Node `v22.23.2` reproduced the bad local hashes before the fix.

## Root Cause

The defect is owned by `@leocuvee/cryptonight-hashing@9.0.3`, with a deterministic trigger in its bundled JH finalizer C source and build flags.

Source evidence:

- `node_modules/cryptonight-hashing/multihashing.cc:249-290` implements `cryptonight_plex()`. Both the explicit `case 0` path and `default` path call `cryptonight_single_hash<xmrig::CRYPTONIGHT_PLEX, ..., xmrig::VARIANT_UPX2>()`.
- `node_modules/cryptonight-hashing/xmrig/crypto/CryptoNight_constants.h:60-62` defines PLEX/UPX2 as 128 KiB memory, mask `0x1FFF0`, and `0x4000` iterations.
- `node_modules/cryptonight-hashing/xmrig/crypto/CryptoNight_x86.h:65-67` routes finalizer branch `2` to `jh_hash(32 * 8, input, 8 * len, output)`.
- `node_modules/cryptonight-hashing/xmrig/crypto/c_jh.c:160`, `167`, `174`, `181`, `188`, and `195` read `unsigned char` round constants through `uint64*`.
- `node_modules/cryptonight-hashing/xmrig/crypto/c_jh.c:219` and `225` read the `unsigned char buffer[64]` compression input through `uint64*`.
- `node_modules/cryptonight-hashing/binding.gyp` compiled all C finalizer sources with `-Ofast`.

Controlled proof:

- With Docker Node `v22.23.2` and Debian GCC `12.2.0`, the unmodified `-Ofast` build returns the known bad pool hashes for branch-2 captures and returns correct hashes for branch 0/1/3 captures.
- Changing only the C compile flags in `cryptonight-hashing/binding.gyp` from `-Ofast` to `-O2`, then rebuilding, makes all replay fixtures match the miner hashes.
- Reverting only that flag change restores the branch-2 failures.
- Rebuilding only `xmrig/crypto/c_jh.o` at `-O2`, then relinking it into an otherwise `-Ofast` addon, also makes the bad branch-2 fixtures pass. That localizes the optimizer-sensitive code to `c_jh.c`.

This is consistent with undefined behavior from aliasing/alignment-sensitive C code being exposed by newer distro/compiler/runtime combinations. The Node 22 correlation came from rebuilding native addons in a newer container, not from a JavaScript share-validation logic change.

## Fix

`scripts/patch-native-addons.js` now patches `cryptonight-hashing/binding.gyp` so the C finalizer sources compile at `-O2` instead of `-Ofast` before `node-gyp rebuild`.

The same script patches legacy native addon sources for modern V8 and compiler
compatibility. Node 22+ builds use C++20 for the C++ addons, and
`turtlecoin-cryptonote-util` references the global `::crypto` namespace
explicitly to avoid ambiguity with `node::crypto` in current Node headers.

This keeps the DeroGold consensus/mining algorithm unchanged. The pool still constructs the same blob, selects `cryptonight_plex(convertedBlob, 8)` for major version `>= 7`, compares hashes byte-for-byte, and applies the same difficulty rules.

The durable upstream dependency fix should be the same source/build change in the repository used to publish `@leocuvee/cryptonight-hashing`: release a new package version with the C JH path protected from `-Ofast` miscompilation, then update `derogold-pool` to depend on that version and remove the downstream patch for this flag.

## Regression Coverage

`tests/shareReplayTests.js` replays sanitized captured DeroGold shares from the live test run. It exercises:

- template reserve-area extra nonce writing;
- `construct_block_blob()`;
- `convert_blob()`;
- major-version `>= 7` PLEX/UPX2 selection via `cryptonight_plex(..., 8)`;
- bytewise hash comparison against miner-known hashes;
- little-endian 256-bit difficulty conversion;
- target generation, equality, below-target, above-target, zero-hash, invalid difficulty, and large-difficulty edge cases.

The committed corpus includes six valid shares: finalizer branch `0`, `1`, and `3` controls, plus three branch-`2` JH shares that failed before the compile-flag fix.

## Verification Matrix

Commands used for the local runtime matrix:

```bash
npm ci --ignore-scripts
node scripts/patch-native-addons.js
node tests/dependencyTests.js
node tests/shareReplayTests.js
```

Equivalent commands were run under Node 18 and Node 24 with `nvm exec`.
The Docker image path was verified with:

```bash
docker build -t derogold-pool:node24-test .
docker run --rm derogold-pool:node24-test sh -lc 'node tests/dependencyTests.js && node tests/shareReplayTests.js'
```

| Environment | Runtime | Compiler | Corpus | Pre-fix false rejects | Post-fix result |
| --- | --- | --- | --- | --- | --- |
| Host control | Node `v18.20.4`, npm `10.7.0` | GCC/G++ `12.5.0` | 6 valid PLEX/UPX2 shares | 0/6 | 6/6 accepted, dependency vectors passed |
| Host target | Node `v22.22.2`, V8 `12.4.254.21-node.33`, node-gyp `10.2.0` | GCC/G++ `12.5.0` | 6 valid PLEX/UPX2 shares | 0/6 on this host build | 6/6 accepted, dependency vectors passed |
| Current-LTS check | Node `v24.21.0`, npm `11.19.0` | GCC/G++ `12.5.0` | 6 valid PLEX/UPX2 shares | not applicable; required extra V8/C++ patches to build | 6/6 accepted, dependency vectors passed |
| Docker live pre-fix | Node `v22.23.2`, V8 `12.4.254.21-node.56`, node-gyp `13.0.2`, x86_64 | GCC/G++ `12.2.0`; miner GCC/G++ `15.3.0` | live `cn/upx2`, one thread, fixed diff `10000` | 7/27 server-side `bad_hash` | not fixed in this run |
| Docker live post-fix | Node `v22.23.2`, V8 `12.4.254.21-node.56`, node-gyp `13.0.2`, x86_64 | GCC/G++ `12.2.0`; miner GCC/G++ `15.3.0` | live `cn/upx2`, one thread, diff `10000` then retargeted to `100001` | not applicable | 9/9 accepted, 0 `bad_hash`, 0 low difficulty |

The historical "about one third" report was not reproduced exactly, but the
measured bad-hash rates before the fix were close enough to classify the same
failure class: `7/27` in the one-thread run and `53/254` in the twelve-thread
run. After the fix, the isolated live run produced `0/9` false rejects.

## Residual Risk

- The pool branch contains the deterministic integration patch. The source
  repository that owns `@leocuvee/cryptonight-hashing@9.0.3` still needs the
  same fix and regression vectors before a new npm version can replace the
  downstream patch.
- The committed corpus covers the PLEX/UPX2 path used by current DeroGold
  blocks and all four finalizer branches, but it is still small. More captured
  production shares would improve confidence in rare CPU/compiler path issues.
- The live miner run used `--asm=none`; the addon build and host CPU path were
  exercised by replay, but a dedicated hardware-AES versus portable comparison
  remains useful if the upstream dependency exposes a reliable switch.

# Node 22+ Hash Rejection Investigation

Status: blocked pending authoritative valid-share replay data.

## Confirmed Architecture

Observed in `lib/pool.js`:

- `BlockTemplate.nextBlob()` mutates the daemon `blocktemplate_blob` reserve area with an incrementing extra nonce, then returns `turtlecoin-cryptonote-util.convert_blob(this.buffer)` as the miner job blob.
- `Miner.getTargetHex()` computes the stratum target from `diff1 / miner.difficulty`, stores a 32-bit target, and returns the first four bytes reversed for the miner.
- `processShare()` rebuilds the submitted block by copying the original daemon template, writing `job.extraNonce`, and calling `turtlecoin-cryptonote-util.construct_block_blob(template, nonce)`.
- `processShare()` converts that rebuilt share block with `turtlecoin-cryptonote-util.convert_blob(shareBuffer)`.
- For block major version `>= 7`, `processShare()` hashes the converted blob with `cryptonight-hashing.cryptonight_plex(convertedBlob, 8)`.
- The pool first performs a byte-for-byte comparison between its local hash and the miner-submitted `result`. A mismatch logs `Bad hash from miner` and returns `false`.
- Only after bytewise hash equality does the pool reverse the 32-byte hash, parse it as a 256-bit integer, compute `diff1 / hashNum`, and compare it with the block and assigned job difficulties.
- The stratum reply maps any `processShare()` false return to `Low difficulty share`, so miner-facing errors do not distinguish bytewise `Bad hash` from actual low difficulty. The server log does distinguish those classes.

Observed in `scripts/patch-native-addons.js`:

- `wrkzcoin-multi-hashing` is patched to C++17 plus modern V8 API calls.
- `cryptonight-hashing` is patched only for NAN/V8 `ToObject()` compatibility.
- `turtlecoin-cryptonote-util` is deliberately patched to C++14 because the current repository notes C++17 breaks `binary_archive.h`.

Observed in the exact published dependency tarballs:

- `@leocuvee/cryptonight-hashing@9.0.3` implements `cryptonight_plex()` in `multihashing.cc`. It parses a numeric variant but both `case 0` and `default` call `CRYPTONIGHT_PLEX` with `VARIANT_UPX2`, including the hardware assembly branches when enabled.
- `@leocuvee/turtlecoin-cryptonote-util@0.1.0` implements `convert_blob()` and `construct_block_blob()` in `src/main.cc`. `construct_block_blob()` reads the nonce with `*reinterpret_cast<uint32_t*>(Buffer::Data(nonce_buf))`, parses the template, writes `b.nonce`, reconstructs parent block data for major version 2+, and serializes the final block.
- `@leocuvee/turtlecoin-cryptonote-util@0.1.0` contains `src/serialization/binary_archive.h` with `stream_type::streampos pos = stream_.tellg();`, the line patched by the reverted Node 22 attempt.

## Known Failure Class

The repository README currently states that Node 22 testing produced rejected `Bad hash` shares. The code confirms that server-side `Bad hash` means local bytewise hash mismatch before difficulty math runs.

The historical symptom still needs a deterministic replay to establish whether production failures were only bytewise `Bad hash`, actual low-difficulty failures after hash equality, or both. The miner-facing `Low difficulty share` reply cannot answer that because it is used for all `processShare()` false returns.

## Hypotheses Not Yet Proven

- `turtlecoin-cryptonote-util` may serialize or parse some block templates differently when forced from C++14 to C++17, causing the pool to hash a different converted blob than the miner.
- `cryptonight-hashing` PLEX/UPX2 may have a compiler/runtime-sensitive path, especially across optimized hardware assembly versus portable software AES.
- A V8/NAN boundary issue may affect buffer conversion, length, or lifetime under Node 22.
- Difficulty math may have edge cases, but it cannot explain server-side `Bad hash` logs because those return before `hashDiff` is computed.

## Current Owner Assessment

The defect owner is not proven yet. The failing boundary must be identified by replaying the same authoritative DeroGold share inputs under Node 18 and Node 22:

- If `construct_block_blob()` or `convert_blob()` diverges before hashing, the owner is `@leocuvee/turtlecoin-cryptonote-util`.
- If converted blobs match but `cryptonight_plex(..., 8)` diverges, the owner is `@leocuvee/cryptonight-hashing`.
- If native outputs match but the pool rejects anyway, the owner is `derogold-pool`.

## Required Evidence Before Crypto Changes

Do not change crypto code until at least one authoritative valid DeroGold share fixture exists. The minimum useful fixture is a sanitized miner transcript and daemon job context containing:

- daemon `getblocktemplate` response: `blocktemplate_blob`, `difficulty`, `height`, and `reserved_offset`;
- pool job fields sent to the miner: `job_id`, `blob`, `target`, `height`, major/minor versions, and the internal `extraNonce` for that job;
- miner submit fields: `nonce` and `result`;
- server-side classification under Node 18 and Node 22 if available: accepted, `Bad hash`, or low difficulty;
- expected/canonical 32-byte hash from Node 18, the daemon, miner, or another independent known-good implementation.

Miner wallet addresses, worker names, IPs, credentials, private pool config, and live service endpoints must be removed before committing fixtures.

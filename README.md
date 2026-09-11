# DeroGold Pool

DeroGold Pool is the production mining pool for DeroGold/DEGO, with native CryptoNote hashing support, Node.js 22 Docker deployment, Redis-backed accounting, wallet-api payments, a static dashboard, and optional WRKZ merged mining.

This repository is derived from the original CryptoNote/Forknote Node.js pool, but the current codebase is maintained for DeroGold `cn/upx2` mining. Node.js 18 is still useful as a compatibility control, but the supported production path is modern Node.js with rebuilt native addons.

## Features

- Stratum-like TCP mining server with fixed and variable difficulty.
- DeroGold share validation using the same blob construction, hash selection, byte ordering, and difficulty checks as the pool runtime.
- Optional WRKZ merged mining with DEGO as the parent work stream.
- DEGO-only miners remain compatible by using a normal DEGO address and any non-WRKZ password value.
- WRKZ opt-in miners provide the DEGO address as `-u` and the WRKZ payout address as `-p`.
- Separate parent and child accounting, fees, unlock depth, Redis namespaces, wallet API settings, blocks, payments, and dashboard stats.
- Payment planner with large-balance and fee-aware transfer splitting.
- Public API, admin accounting endpoint, public service health endpoint, market price endpoint, and chart collectors.
- Static dashboard for pool overview, miner lookup, blocks, payments, connect instructions, and admin accounting.
- Docker Compose deployment using Node.js 22 and host networking.

## Repository Layout

- `init.js` starts the selected modules.
- `lib/pool.js` serves miners, builds jobs, validates shares, and submits parent/child blocks.
- `lib/mergedMining.js` builds and validates the merged-mining auxiliary data.
- `lib/blockUnlocker.js` matures parent and child blocks and credits balances.
- `lib/paymentProcessor.js` sends DEGO and WRKZ payments through wallet-api.
- `lib/paymentPlanner.js` prepares fee-aware wallet transfer commands.
- `lib/api.js` exposes public stats, admin stats, health, charts, and market data.
- `website/` contains the static dashboard.
- `scripts/patch-native-addons.js` applies native addon compatibility patches and rebuilds dependencies.
- `scripts/prepare-redis-migration.js` prepares Redis migration commands for production cutovers.
- `tests/` contains dependency, share replay, merged-mining, and payment planner regression tests.
- `docs/` contains operational and investigation notes.

## Requirements

- Linux host with build tools.
- Node.js `>=18 <25`. Node.js 22 is the primary deployment target.
- Redis.
- Synced DeroGold daemon with mining/RPC enabled.
- DeroGold wallet-api for payments.
- Optional synced WRKZ daemon and WRKZ wallet-api for merged-mining payments.
- `git`, `make`, `g++`, `python3`, `node-gyp`, and Boost headers for native addon builds.

On Debian/Ubuntu:

```bash
sudo apt-get update
sudo apt-get install -y git build-essential python3 libboost-all-dev redis-server
```

Use a current Node.js release from your preferred Node distribution. Avoid old distribution Node packages.

## Install

```bash
git clone https://github.com/derogold/derogold-pool.git
cd derogold-pool
npm ci --ignore-scripts
node scripts/patch-native-addons.js
```

The install intentionally uses `--ignore-scripts`. Native addons are patched and rebuilt by `scripts/patch-native-addons.js` so the exact compatibility fixes are under repository control.

## Configuration

Create a local config from the example:

```bash
cp config.json.example config.json
```

`config.json` is gitignored. Do not commit real wallet addresses, RPC passwords, wallet filenames, daemon IPs, Redis credentials, exchange API keys, or production hostnames.

Important sections:

- `coin`, `symbol`, `coinUnits`, `coinDifficultyTarget`: parent DEGO constants.
- `poolServer.poolAddress`: DEGO pool wallet address where mined rewards go.
- `poolServer.ports`: public mining ports and starting difficulties.
- `poolServer.varDiff`: per-miner difficulty retargeting.
- `payments`: DEGO payout interval, fee, minimum payout, denomination, and split limits.
- `blockUnlocker`: DEGO unlock depth and pool fee.
- `daemon`: DEGO daemon RPC connection.
- `wallet`: DEGO wallet-api connection and wallet file details.
- `redis`: Redis connection.
- `api`: API bind host/port, public list limits, chart window, and admin password.
- `market.cexswap`: optional CEXSwap market-price settings.
- `mergedMining`: optional child-chain settings.

### Merged Mining

WRKZ merged mining is disabled in `config.json.example`. To enable it, set the child section with your own daemon, wallet, pool address, and genesis hashes:

```json
{
  "mergedMining": {
    "enabled": true,
    "parentGenesisHash": "REPLACE_WITH_DEGO_GENESIS_HASH",
    "childGenesisHash": "REPLACE_WITH_WRKZ_GENESIS_HASH",
    "child": {
      "coin": "WrkzCoin",
      "symbol": "WRKZ",
      "coinDifficultyTarget": 60,
      "unlockDepth": 40,
      "poolFee": 1,
      "poolAddress": "YOUR_WRKZ_POOL_WALLET_ADDRESS",
      "daemon": {
        "host": "127.0.0.1",
        "port": 17856
      },
      "wallet": {
        "host": "127.0.0.1",
        "port": 1338,
        "password": "YOUR_WRKZ_WALLET_API_PASSWORD",
        "filename": "/path/to/your/wrkz.wallet",
        "walletPassword": "YOUR_WRKZ_WALLET_FILE_PASSWORD",
        "daemonHost": "127.0.0.1",
        "daemonPort": 17856
      },
      "payments": {
        "enabled": true,
        "interval": 120,
        "maxAddresses": 2,
        "transferFee": 10000,
        "minPayment": 10000000,
        "denomination": 100,
        "mixin": 1
      }
    }
  }
}
```

The genesis hashes must come from the respective core repositories. They are used to build the auxiliary merged-mining buffer; they are not arbitrary labels.

Merged mining does not create a second miner job stream. Miners solve normal DEGO work. For each valid parent share, the pool checks whether the same proof also satisfies the current WRKZ child target. If it does, the pool submits a WRKZ block. This keeps the miner protocol compatible with existing DEGO miners.

Miner address rules:

- DEGO-only miner: `-u YOUR_DEGO_ADDRESS -p x`
- DEGO plus WRKZ merged mining: `-u YOUR_DEGO_ADDRESS -p YOUR_WRKZ_ADDRESS`

If the password is not a valid WRKZ address, the miner is accepted for DEGO only and excluded from WRKZ accounting.

## Running The Pool

Start every enabled module:

```bash
node init.js -config=config.json
```

Run one module only:

```bash
node init.js -config=config.json -module=pool
node init.js -config=config.json -module=api
node init.js -config=config.json -module=unlocker
node init.js -config=config.json -module=payments
node init.js -config=config.json -module=chartsDataCollector
```

The main modules are:

- `pool`: mining ports, jobs, shares, parent block submission, child block checks.
- `api`: dashboard/API data.
- `unlocker`: block maturity and balance crediting.
- `payments`: DEGO and child payment processing.
- `chartsDataCollector`: chart snapshots.

## Docker

The supplied image uses Node.js 22:

```bash
docker compose build
docker compose up -d
```

The Compose file mounts local `config.json` into the container and uses host networking so the pool can reach local Redis, daemon RPC, and wallet-api services on `127.0.0.1`.

Useful operations:

```bash
docker compose ps
docker compose logs -f pool
docker compose restart pool
docker compose down
```

After native dependency or patch changes:

```bash
docker compose build --no-cache
docker compose up -d --force-recreate
```

## Wallet API

Run one wallet-api instance per coin. The pool opens the configured wallet file through the wallet-api using the values from `wallet` and `mergedMining.child.wallet`.

Example DEGO wallet-api command:

```bash
./wallet-api \
  -p 1337 \
  -r YOUR_DEGO_WALLET_API_PASSWORD \
  --log-file wallet-api.log \
  --log-level 2 \
  --scan-coinbase-transactions
```

Example WRKZ wallet-api command:

```bash
./wrkz-wallet-api \
  -p 1338 \
  -r YOUR_WRKZ_WALLET_API_PASSWORD \
  --log-file wrkz-wallet-api.log \
  --log-level 2 \
  --scan-coinbase-transactions
```

Check a wallet-api directly:

```bash
curl -sS -H 'X-API-KEY: YOUR_WALLET_API_PASSWORD' \
  http://127.0.0.1:1337/status
```

The wallet and daemon heights should match before expecting payments.

## Dashboard

The dashboard is static and lives in `website/`. Host it with nginx, Apache, or any static file server.

Tracked `website/config.js` is a generic example. Put production values in `website/config.local.js`; that file is gitignored and loaded after `config.js`.

```bash
cp website/config.local.js.example website/config.local.js
```

Set at least:

```javascript
var api = 'https://your-pool-api.example.com/apimine'
var api_blockexplorer = api
var poolHost = 'your-pool.example.com'
var stratumHost = poolHost
```

The dashboard uses:

- `/stats` for public pool, network, merged-mining, blocks, payments, and chart data.
- `/miner_stats?address=...` for miner lookup.
- `/health` for public service health.
- `/market_prices` for optional CEXSwap prices.
- `/admin_stats?password=...` for admin accounting.

## API

Common public endpoints:

```text
GET /stats
GET /miner_stats?address=YOUR_DEGO_ADDRESS
GET /health
GET /market_prices
```

Admin accounting:

```text
GET /admin_stats?password=YOUR_API_PASSWORD
```

Do not expose the admin password in frontend files unless the site is private and you understand the risk.

## Miner Examples

CPU XMRig-UPX style:

```bash
./xmrig \
  -o your-pool.example.com:3333 \
  -a cn/upx2 \
  -u YOUR_DEGO_ADDRESS \
  -p YOUR_WRKZ_ADDRESS
```

DEGO-only compatibility:

```bash
./xmrig \
  -o your-pool.example.com:3333 \
  -a cn/upx2 \
  -u YOUR_DEGO_ADDRESS \
  -p x
```

A fixed difficulty can be requested by suffixing the DEGO login if `poolServer.fixedDiff.enabled` is true:

```bash
./xmrig \
  -o your-pool.example.com:3333 \
  -a cn/upx2 \
  -u YOUR_DEGO_ADDRESS.300000 \
  -p YOUR_WRKZ_ADDRESS
```

Use a starting difficulty high enough for your miner fleet. Very low difficulty can flood an old CryptoNote pool with low-value shares.

## Tests

Run the native dependency vectors:

```bash
npm ci --ignore-scripts
node scripts/patch-native-addons.js
node tests/dependencyTests.js
```

Run the share replay harness:

```bash
node tests/shareReplayTests.js
```

Run merged-mining and payment planner tests:

```bash
node tests/mergedMiningTests.js
node tests/paymentPlannerTests.js
```

Run the package test command:

```bash
npm test
```

`npm test` reinstalls dependencies with `npm install --ignore-scripts`, patches native addons, then runs dependency and share replay tests.

## Node 22 Native Addon Notes

The share validation path depends on native hashing and CryptoNote blob conversion. Node.js 22 changed the V8/native-addon build environment enough that the pool must build patched addon sources deterministically.

The historical false share-rejection investigation is documented in:

```text
docs/node22-hash-rejection-investigation.md
```

The short rule for operators is: after every dependency install, run `node scripts/patch-native-addons.js` before starting the pool.

## Redis

Redis keys are namespaced by `coin`, for example `DeroGold:*`. WRKZ merged mining uses a child namespace below the parent:

```text
DeroGold:mergedMining:WRKZ:*
```

The migration helper prepares copy/rename commands for cutovers:

```bash
node scripts/prepare-redis-migration.js \
  --map OldDeroGold=DeroGold \
  --map OldPool:mergedMining:WRKZ=DeroGold:mergedMining:WRKZ
```

Read `docs/production-redis-migration.md` before using it on production data. Always back up Redis first.

## Operations Checklist

Before production start:

- Daemon is synced and mining RPC returns block templates.
- Wallet-api is running for each payment-enabled coin.
- Wallet status height matches daemon/network height.
- Redis is reachable and protected from public access.
- `config.json` has real local values and is not committed.
- `website/config.local.js` has real public API/mining/explorer values and is not committed.
- `npm ci --ignore-scripts` and `node scripts/patch-native-addons.js` completed.
- Regression tests pass.
- Pool logs show accepted shares and no unexpected `Bad hash` pattern.
- `/health` reports API, pool, daemon, and payment services as `ok`.

Useful checks:

```bash
curl -sS http://127.0.0.1:8117/stats
curl -sS http://127.0.0.1:8117/health
docker compose logs -f pool
redis-cli ping
```

## Security

- Never commit production `config.json`, `website/config.local.js`, wallet files, wallet-api passwords, exchange API keys, or private deployment hostnames.
- Bind Redis locally or protect it with firewall rules.
- Bind wallet-api locally unless you have a specific protected network design.
- Treat `/admin_stats` as private because it exposes accounting totals.
- Keep daemon block-explorer-expensive RPC flags disabled unless explicitly needed.

## Credits

Original pool lineage and contributors include the CryptoNote Node.js pool, Forknote, TurtleCoin, uPlexa, and the DeroGold maintainers.

Current DeroGold maintenance and merged-mining work lives under the DeroGold GitHub organization:

```text
https://github.com/derogold
```

## License

Released under the GNU General Public License v2. See `LICENSE` for details.

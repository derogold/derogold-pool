# Production Redis Migration Preparation

This note describes the migration helper only. Do not run the apply step until the local WRKZ daemon is synced, the pool has been tested against it, and the production cutover window is agreed.

## What Moves

The pool stores accounting and public stats by Redis key prefix:

- Parent DEGO keys use the configured `coin` value directly, for example `<parentPrefix>:workers:*`, `<parentPrefix>:blocks:*`, `<parentPrefix>:payments:*`, `<parentPrefix>:stats`, and chart keys.
- Merged-mined child keys live below the parent namespace, for example `<parentPrefix>:mergedMining:WRKZ:workers:*`, `<parentPrefix>:mergedMining:WRKZ:blocks:*`, `<parentPrefix>:mergedMining:WRKZ:payments:*`, and `<parentPrefix>:mergedMining:WRKZ:stats`.

`scripts/prepare-redis-migration.js` copies complete Redis prefixes from a source namespace to a target namespace. It does not move wallet files, daemon data, or config files. Wallet migration should be handled separately with backups of the existing production DEGO pool wallet and the WRKZ wallet used during the live merged-mining test.

## Dry Run First

Use `--map SOURCE=TARGET` for each namespace to copy. Prefixes may contain colons; the first `=` separates source and target.

```bash
node scripts/prepare-redis-migration.js \
  --redis-host 127.0.0.1 \
  --redis-port 6379 \
  --map OldDeroGoldProductionPrefix=NewDeroGoldProductionPrefix \
  --map DeroGoldPaymentTest:mergedMining:WRKZ=NewDeroGoldProductionPrefix:mergedMining:WRKZ
```

The default mode is dry-run. It scans source keys, maps each target key, reports data types, and flags target-key conflicts. It performs no writes unless `--apply` is present.

Sample keys redact long key segments by default because payment and worker keys can contain full miner payout addresses. Use `--show-full-keys` only for local operator debugging where the output will not be pasted into public issue trackers or PRs.

## Apply Step

After testing against a Redis dump or staging Redis instance, the production write form is:

```bash
node scripts/prepare-redis-migration.js \
  --redis-host 127.0.0.1 \
  --redis-port 6379 \
  --map OldDeroGoldProductionPrefix=NewDeroGoldProductionPrefix \
  --map DeroGoldPaymentTest:mergedMining:WRKZ=NewDeroGoldProductionPrefix:mergedMining:WRKZ \
  --apply
```

By default existing target keys are skipped. Add `--overwrite` only after confirming the target namespace is disposable or has been backed up.

## Supported Redis Types

The helper copies strings, hashes, lists, sets, and sorted sets, and preserves key TTLs. Those cover the pool's worker, share, block, payment, stats, monitoring, and chart keys. Unsupported key types cause a non-zero exit so the migration cannot silently drop data.

## Cutover Checklist

1. Stop only the pool processes that write to the source and target production Redis namespaces.
2. Take a Redis backup or export from the production instance.
3. Run the helper in dry-run mode against production Redis and save the JSON output.
4. Run the same mappings against a restored Redis dump or staging Redis and verify dashboard, block unlocker, and payment processor reads.
5. Move or restore wallet files with backups. Keep the existing production DEGO wallet for DEGO; promote the WRKZ wallet used during the live test if we decide to preserve its mainnet history.
6. Run the helper with `--apply`.
7. Start the merged-mining pool against the synced local WRKZ node.
8. Confirm `/stats`, `/admin_stats`, `/get_payments`, worker lookup, block unlocker, and payment processor output for both DEGO and WRKZ.

Actual migration remains blocked until the local WRKZ node is synced and accepted for mining tests.

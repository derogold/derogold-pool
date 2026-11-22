# DoubleMint pool interface

Static Astro frontend for the DoubleMint DEGO + WRKZ merged-mining pool.

## Stack

Astro, React, Base UI/coss UI conventions, Tailwind CSS v4, Inter/Geist and Lucide.

## Development

```bash
cp public/config.local.example.js public/config.local.js
corepack pnpm install
corepack pnpm dev
```

`public/config.local.js` is machine/deployment-specific and intentionally ignored. The generated site consumes the existing pool API and retains the current hash routes: overview, miner, blocks, payments, connect and admin.

## Verification

```bash
corepack pnpm run build
```

Deployment must preserve the production `config.local.js`; do not replace it with the example file.

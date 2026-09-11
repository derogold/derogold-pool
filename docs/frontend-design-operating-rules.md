# Frontend Design Operating Rules

This project uses three external reference repos as the design operating layer
for pool frontend work:

- `LeoStehlik/no-slop-ui` at `3c8f9e5ef5ca18f5632f7b9ad8f95e2d68188bc`
- `LeoStehlik/visual-dna` at `b7d9b806a1e4e8ffa1162375ed1a4655e91c20c7`
- `LeoStehlik/brief-master` at `0a3b35505a378cb24bd4ba97aa3c80fc7e3021b2`

Use these as project memory before changing any visible dashboard, website, or
frontend code.

## Product Direction

The pool frontend is an operations dashboard for miners and pool operators. The
first screen should show the actual working state of the pool, not a landing
page, hero section, or marketing explanation.

For merged mining, the dashboard must make DEGO and WRKZ status comparable
without pretending they are the same ledger. Show parent and child coin facts
side by side where comparison helps, and separate them where balances, payments,
blocks, fees, unlock depth, or wallet status have different meanings.

## No-Slop UI Rules

- Build dense, scannable product screens with tables, rows, filters, tabs, and
  ordinary controls.
- Use only real metrics from the API. Do not invent cards, badges, activity, or
  charts to fill space.
- Avoid glassmorphism, decorative gradients, glows, gradient text, oversized
  rounded corners, floating shells, and dramatic shadows.
- Do not use hero sections inside the dashboard.
- Avoid generic SaaS filler copy. Headings, labels, empty states, and errors
  should say exactly what the miner or operator needs to know.
- Keep typography normal for software: system UI or one clean sans-serif, clear
  hierarchy, compact body text, no mixed serif/sans treatment.
- Use a 4px spacing base: 4, 8, 12, 16, 24, 32.
- Use subtle 1px borders, restrained shadows, and 6-10px control radius.
- Prefer icons for familiar actions and keep hover states to color, border, or
  shadow changes. No transform, bounce, scale, parallax, or page-load spectacle.
- Check mobile and desktop layouts for stable dimensions and no text overlap.

## Visual DNA For This Dashboard

Until a specific brand reference is supplied, treat the dashboard as a restrained
operator console:

- Mood: calm, precise, operational.
- Layout: strict grid with a stable sidebar or top navigation, compact header,
  and content-first sections.
- Density: compact, with enough whitespace to separate workflows but no large
  empty decorative areas.
- Surfaces: flat backgrounds and panels with low-contrast borders.
- Data display: tables and structured rows first; cards only for repeated items,
  modals, or genuinely framed tools.
- Motion: lightweight and functional only.
- Effects: none unless they explain state.

## Dashboard Data Priorities

The merged-mining dashboard should use these backend surfaces:

- `/stats` for global parent/child coin stats, network state, hashrate, block
  counts, effort, latest blocks, pool fee, payout metadata, and unlock depth.
- `/stats_address?address=<DEGO_ADDRESS>` for miner-specific DEGO and WRKZ
  balances, payments, payout address, and hashrate.
- `/get_payments?coin=WRKZ&time=<unix>` for WRKZ pool payment history.
- `/get_payments?coin=WRKZ&address=<WRKZ_ADDRESS>&payoutAddress=true&time=<unix>`
  for child payments indexed by WRKZ payout address.
- `/admin_monitoring` for parent daemon/wallet and child daemon/wallet health.

Keep old endpoint shapes intact for existing frontend code. Add new merged-
mining UI by reading the `coins` objects and optional child-aware endpoints.

## Brief Discipline

Before a frontend implementation task, write or restate the brief with:

- one outcome;
- concrete files or endpoints to read;
- testable acceptance criteria;
- non-goals;
- constraints around compatibility, production config, and secrets;
- exact verification steps.

Ask clarifying questions only when a missing answer affects correctness. Do not
turn every UI task into an interview.

## Review Checklist

Before calling frontend work done:

- The first screen is the actual pool/miner dashboard.
- DEGO and WRKZ data is real, labeled, and not conflated.
- Existing single-coin dashboard behavior remains compatible.
- No hard-banned No Slop UI patterns are present.
- Tables, filters, tabs, empty states, loading states, and errors remain stable
  on mobile and desktop.
- Text fits its containers.
- The page can be read quickly by a miner or pool operator.
- Verification commands and browser/API checks are reported.

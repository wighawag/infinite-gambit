---
title: 'The install prepare runs two hardhat compiles at once, and they can race'
---

Observed 2026-11-05 by the drive-tasks conductor: the `chess-collisions` acceptance gate failed in `prepare`, before `verify`, with `FileNotFoundError: .../contracts/cache/build-info/solc-0_8_28-<hash>.json not found` (ENOENT on the rename into `contracts/artifacts/build-info`).

Cause: `pnpm install` runs the workspace `prepare` scripts concurrently. The root `prepare` is `node scripts/ensure-deployments.mjs`, which (with no committed deployment records) runs `pnpm --filter ./contracts exec hardhat run scripts/deploy-ephemeral.ts` and so compiles; at the same moment `contracts prepare` runs `hardhat compile`. Two compiles share `contracts/cache` and `contracts/artifacts`, and one can move a build-info file the other is about to rename. It passed on the three previous gates and failed on the fourth, so it is a race, not a constant failure.

Possible fixes (not done here): make `ensure-deployments.mjs` skip compiling when a compile is already running, or run the contracts compile first and the ensure step after it (for example drop the root `prepare` from the install and keep it only in `dorfl.json`'s `prepare`, which already runs it after `pnpm install`), or make `contracts prepare` not compile.

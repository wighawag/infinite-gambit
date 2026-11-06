---
title: 'The install prepare runs two hardhat compiles at once, and they can race'
---

Observed 2026-11-05 by the drive-tasks conductor: the `chess-collisions` acceptance gate failed in `prepare`, before `verify`, with `FileNotFoundError: .../contracts/cache/build-info/solc-0_8_28-<hash>.json not found` (ENOENT on the rename into `contracts/artifacts/build-info`).

Cause: `pnpm install` runs the workspace `prepare` scripts concurrently. The root `prepare` is `node scripts/ensure-deployments.mjs`, which (with no committed deployment records) runs `pnpm --filter ./contracts exec hardhat run scripts/deploy-ephemeral.ts` and so compiles; at the same moment `contracts prepare` runs `hardhat compile`. Two compiles share `contracts/cache` and `contracts/artifacts`, and one can move a build-info file the other is about to rename. It passed on the three previous gates and failed on the fourth, so it is a race, not a constant failure.

Possible fixes (not done here): make `ensure-deployments.mjs` skip compiling when a compile is already running, or run the contracts compile first and the ensure step after it (for example drop the root `prepare` from the install and keep it only in `dorfl.json`'s `prepare`, which already runs it after `pnpm install`), or make `contracts prepare` not compile.

**Update 2026-11-06 (conductor): it is now systematic, not occasional.** `chess-camera-minimap`'s gate failed the same way three times in a row (the first run and two re-runs of the same rebased tip), after `chess-collisions` had failed once. A plausible reason it became deterministic: both compiles see the same sources, so they write the SAME `solc-0_8_28-<hash>.json` build-info name, and with a warm compiler cache they finish close enough together for one to rename the other's file away. Until it is fixed, every acceptance gate is likely to fail in `prepare`.

Verified workaround (conductor, scratch clone of `work/task-chess-camera-minimap`, the full `verify` then green): run the prepare steps one after another instead of letting `pnpm install` run them concurrently, for example as `dorfl.json`'s `prepare`: `pnpm install --frozen-lockfile --ignore-scripts && pnpm --filter ./contracts run prepare && pnpm --filter ./web run prepare && node scripts/ensure-deployments.mjs`. (`--ignore-scripts` also skips esbuild's install script, which only checks its platform binary; the suites still ran.) A fix in the repo itself (so a plain `pnpm i` is safe too) would be to stop the root `prepare` from compiling while `contracts prepare` does.

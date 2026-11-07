---
title: '`pnpm web:check` fails on main since the Sepolia records were committed'
---

Observed 2026-11-06 while building `offline-demo-presets`. With `web/src/lib/deployments.ts` exported from the committed Sepolia records (`edb80ab sepolia deployment`), `svelte-check` reports one error in a file the build did not touch: `web/src/lib/chess/context.ts:646`, `deployments.chain.id === 31337 ? 1_000 : 5_000`, "the types '11155111' and '31337' have no overlap". The export keeps the chain id as a literal type, so any comparison against another chain id is a type error. This makes the `verify` gate red for every task until it is fixed (for example by widening `chain.id` to `number` at that comparison, or in the export's `WidenChain`).

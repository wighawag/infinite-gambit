# `DeploymentCollisions.test.ts` does not type-check

2026-11-06. `npx tsc -p contracts/test/js/tsconfig.json --noEmit` reports three errors, all in `contracts/test/js/DeploymentCollisions.test.ts` (lines 116 and 436: a `functionName: string` and `args: unknown[]` passed to the typed `env.read`/`env.execute`). The suites run through tsx, which does not type-check, and `verify` does not run `pnpm --filter ./contracts typescript`, so nothing catches it (spotted while building `chess-collisions`; the errors are there without that task's changes).

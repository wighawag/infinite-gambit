<!-- dorfl-sidecar: item=task:chess-collisions type=task slug=chess-collisions allAnswered=false -->

## Q1

**'task:chess-collisions' was bounced — how should we proceed?**

> prepare (env-prep) failed (exit 1) on the rebased tip

<!-- q1 fields: id=q1 kind=stuck -->

**Your answer** (write below this line):
keep. The gate failed on an infrastructure race, not on the work: `pnpm install` runs the root `prepare` (scripts/ensure-deployments.mjs, which runs `hardhat run` and so compiles) concurrently with `contracts prepare` (`hardhat compile`), and the two compiles raced on contracts/cache/build-info (ENOENT on rename). The committed work on work/task-chess-collisions is complete: do not redo it. Check it is still green and finish.

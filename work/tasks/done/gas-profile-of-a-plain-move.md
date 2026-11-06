---
title: 'Profile where the gas of a plain move goes, commit and reveal'
slug: gas-profile-of-a-plain-move
blockedBy: []
covers: []
---

## What to build

Nobody knows where the gas of an ORDINARY move goes, and it is far above what one piece moving should cost. `GasBudget.test.ts` measures (last run, 2026-11-06): a deployment reveal 332k, a 7-square slider reveal 373k, a king move reveal 452k, a first deployment commit about 308k, a settling commit about 311k and the paid first commit about 380k (the one `commitGas` is priced on). One piece moving should be a few storage writes. The worst cases (merge chains about 665k, a folded capture loop with exits about 1.2M) are understood and are going away with the `lean-rules` spec (`work/specs/proposed/lean-rules.md`). The plain cost is not understood, and that spec's storage work, and later the several-pieces-per-move idea (`work/notes/ideas/king-chase-table-modes.md`), have to be sized on real numbers.

Produce a reproducible breakdown of the gas of:

1. a plain move's COMMIT (an army already deployed, a commit in a later cycle, nothing to settle);
2. a plain move's REVEAL: a pawn step onto an empty square, a 7-square slider, and a king step, each both on squares never touched before (the piece's first move off its deployment) and on squares already touched;
3. a deployment's commit and reveal, for comparison.

For each, attribute the gas to: the transaction's intrinsic cost and calldata, the router's dispatch, the commit-reveal base (commitment, bond, reserve, attendance), the game's square records (reads and writes, per slot), the spawn records, the zone index, the army record, the capture candidate list, events, and anything else that shows up. Report storage per SLOT and whether each write is a fresh slot (about 22,100), an update (about 5,000 / 2,900) or a refund.

How: use the local node's tracer (`debug_traceTransaction` with the struct logger, or the equivalent the contracts test environment offers) and fold the opcodes by contract and by storage slot. Keep the tool as a script or test under `contracts/` that anyone can re-run, not a one-off.

Then write the result down, durably, as `docs/gas.md`: the table of where each transaction's gas goes, and a ranked list of what could be cut, each with its estimated saving. Include at least: packing a square record (today 4 slots: a 256-bit army id, a packed slot, two more 256-bit army ids) into one slot with a compact army index; dropping the `forward`/`moved` fields once pawns step in every direction (lean rules); the zone index write; the capture candidate push; and whatever the commit spends beyond storing a hash.

This task changes NO contract behaviour. It measures and reports.

## Acceptance criteria

- [ ] A re-runnable script or test under `contracts/` prints the breakdown for every transaction listed above.
- [ ] `docs/gas.md` holds the breakdown table and the ranked list of savings, each with an estimate, and says which run and commit it was measured on.
- [ ] The commit's cost is explained: what it spends beyond storing a hash.
- [ ] No contract source and no declared gas figure is changed; `verify` is green.

## Blocked by

- None: can start immediately.

## Prompt

Goal: build the task above. The "What to build" and "Acceptance criteria" sections are the brief; "done" is every criterion met with the `verify` gate in `dorfl.json` green.

Read first: `AGENTS.md` (the commit-reveal rules), `contracts/rocketh/config.ts` (the comments above `COMMIT_GAS` and `REVEAL_GAS`), `contracts/test/js/GasBudget.test.ts` (how transactions are measured today, and its helpers for deploying, committing and revealing), `contracts/src/game/internal/UsingGameStore.sol` (`SquareRecord`, `ArmyRecord`, `SpawnRecord`), `contracts/src/game/internal/UsingGameBoard.sol` (`_revealMove`, `_touch`, `_rawSquareAt`), `contracts/src/commit-reveal/` (the base's commit and reveal), and `work/specs/proposed/lean-rules.md` (what is about to change, so the savings list speaks to it).

FIRST, check this task against current reality: are the figures above still roughly what `GasBudget.test.ts` logs, and is the square record still four slots? If it has drifted, route the task to needs-attention with the discrepancy (WORK-CONTRACT.md "Drift is a needs-attention signal").

Work in small steps (one decision, then edit and run a test), and grow files with edits of at most about 300 lines: earlier builds in this repo died on the 16,384-token output limit when a single reply tried to plan everything.

RECORD non-obvious in-scope decisions in a `## Decisions` block at the end of your FINAL REPORT (the runner transcribes it into the done record). Do not write the done record, commit message or PR body yourself, and do not edit this task body.

## Decisions

- **The profiler is a test file, not a standalone script.** It runs as `contracts/test/js/GasProfile.test.ts`, so it reuses the existing fixtures and runs inside `verify` (about 2 seconds), which stops it rotting. The alternative was a script under `contracts/scripts/` that nobody would run. This touches nothing else.
- **Only the per-category table prints by default.** The slot and function lists (about 800 lines) come only with `GAS_PROFILE=slots` or `GAS_PROFILE=functions`. I chose this so `verify` output stays short. The alternative was printing everything every run. It affects only this test's output.
- **The breakdown table reports the test build, with a production row and total alongside.** The test build is what `GasBudget.test.ts` measures. Storage costs are identical between the two builds except for a few hundred gas of repeated warm reads; compute differs. The alternative was reporting the production build only. Running in production mode recompiles `artifacts/` (gitignored), and the next plain `pnpm test` recompiles them back.
- **The function breakdown is only meaningful on the test build.** The optimiser inlines functions, so its jumps no longer say which function they enter; under production everything lands in one "(compiler-generated helper)" bucket. I documented this rather than building a second method.

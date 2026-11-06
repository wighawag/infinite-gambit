---
title: "The contract's outcomes say when a piece was promoted and when a stone was made, so the client stops inferring it"
slug: outcomes-report-promotion-and-stones
spec: lean-rules
blockedBy: [lean-rules-stone-on-the-two-victim-square, three-piece-moves-bot-and-words]
covers: [1, 3, 8]
---

## What to build

`getOutcomes` (built from `ChessRules.outcome`) does not say whether the piece that took a king was promoted, or whether a capture left a stone. So `web/src/lib/chess/outcomes.ts` (`captureEffectsOf`, from `lean-rules-captures-on-the-client`) INFERS them: a promotion is "a queen stands there now, and a king was taken or one arrival died", and a stone made is read from what stands on the square. A piece that was already a queen is shown as promoted, and on a two-victim square the client cannot say which stake went into which stone. Rules live only in the contract (`docs/adr/0007-rules-live-only-in-the-contract.md`), so the contract should say it.

- Add to each outcome what the client now guesses: whether the arriving piece was PROMOTED (it took a king and was not a king), whether a STONE was made there (and of which army), and whether a STONE was captured there. Derive them in `ChessRules.outcome` from the same closed-cycle facts the fold uses (`_captorFell` for "the captor's king fell"), so the answer is order-free and the same before and after the square is folded.
- This is a VIEW change only: no storage field, no stored record changes (the storage layout is final for the Sepolia deploy, see `lean-rules-one-slot-square-record-and-tight-gas-limits`). Regenerate what the ABI change needs.
- The client reads the new fields and drops the inference in `captureEffectsOf`. Its tests (`web/test/lib/chess/outcomes.test.ts`) assert the reported values, including the two-victim square.

## Acceptance criteria

- [ ] `getOutcomes` reports promoted, stone made (with its army) and stone captured for each capture square, tested in the contract in every reveal order (`inEveryOrder`) and before and after the fold, covering a lone piece taking a king, a king taking a king (not promoted), the moving-king row, both two-victim cases, a stone made (captor taken, captor exiting) and a stone captured.
- [ ] No storage layout changes (`StorageLayout.test.ts` unchanged and green); `RouteSizes.test.ts` and `GasBudget.test.ts` stay green.
- [ ] `outcomes.ts` uses the reported values, with no inference left; the web tests pass.
- [ ] All client logic in plain `.ts` (AGENTS.md "Svelte conventions").

## Blocked by

- `lean-rules-stone-on-the-two-victim-square` (it pins the two-victim rules these outcomes report).

## Prompt

Goal: build the task above. The "What to build" and "Acceptance criteria" sections are the brief; "done" is every criterion met with the `verify` gate in `dorfl.json` green.

Read first: `AGENTS.md`, `docs/adr/0007`, `0013`, `0014`, `contracts/src/game/internal/ChessRules.sol` (`outcome`, `kingCapture`), the outcomes route and its tests under `contracts/test/js/`, `web/src/lib/chess/outcomes.ts` and `web/test/lib/chess/outcomes.test.ts`, and the done records of `lean-rules-captures-on-the-client` and `lean-rules-stone-on-the-two-victim-square`.

Work in small steps, and `git commit -am "wip: <step>"` after each one. RECORD non-obvious in-scope decisions in a `## Decisions` block at the end of your FINAL REPORT. Do not write the done record, commit message or PR body yourself, and do not edit this task body.

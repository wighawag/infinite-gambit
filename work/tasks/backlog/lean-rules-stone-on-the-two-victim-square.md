---
title: 'Lean rules follow-up: test the two-victim square with a stone standing there, and the stone whose captor fell'
slug: lean-rules-stone-on-the-two-victim-square
spec: lean-rules
blockedBy: []
covers: [3, 8, 11]
---

## What to build

Two board cases of `docs/adr/0013` and `docs/adr/0014` that the contract implements but no board test exercises (found at the Gate-3 review of PR #21). Both live in `_foldCapture` / `_captorFell` in `contracts/src/game/internal/UsingGameBoard.sol`. Expect this to be TEST-ONLY. If a test shows the contract disagrees with the rule below, fix the contract in this task and say so in the Decisions block.

1. **A stone on the two-victim square.** A STONE stands on a square, and in one cycle a moving enemy king and exactly one other piece arrive there. The moving king dies, and the other piece lands as a queen and takes BOTH: the stone's stake and the moving king's stake go to its army. The stone and the moving king's army are both captured by it (`capturedBy`), and the moving king's other pieces vanish from the next cycle. Today `KingCapture.test.ts`'s "the two-victim square" covers this only with a KING standing there.
2. **The same square when the captor's own king falls that cycle.** As in case 1, a moving king and exactly one other piece arrive on a square where a king or a stone stands, but the arriving piece's own king is taken elsewhere in the same cycle. The maintainer ratified the rule `lean-rules-captures-without-merges-and-stones` chose (its done record, Decisions): **a square holds one stone. What stood there becomes, or stays, the stone, and the moving king's stake goes into that stone's army.** The arriving piece vanishes with its army. Nothing is stranded or lost: the total of every reserve is unchanged.

Both cases must run through the order-replay helper (`inEveryOrder` over `REVEAL_ORDERS`, as in `KingCapture.test.ts` and `Stones.test.ts`). They must assert the same board, registry (status, `capturedBy`, stake) and outcomes in every order, and the same stakes whether the square is folded before or after the read (as "reads the same stakes before and after each capture square is folded" does in `Stones.test.ts`). Case 2 needs a third army to take the captor's king in the same cycle: build it on the existing four-army world.

**ADR-0014.** Add one paragraph to `docs/adr/0014-a-capture-whose-captor-falls-the-same-cycle-leaves-a-stone.md` stating case 2's rule as decided (ratified by the maintainer on 2026-11-07), citing the test that pins it.

## Acceptance criteria

- [ ] Case 1 is tested on a board in every reveal order: the arriving piece lands as a queen, and its army holds the stone's and the moving king's stakes.
- [ ] Case 2 is tested on a board in every reveal order, for a standing KING and for a standing STONE: what stood there is the stone, it holds its own stake plus the moving king's, the arriving piece's army vanishes, and the sum of all reserves is unchanged.
- [ ] Both cases read the same stakes before and after the square is folded.
- [ ] ADR-0014 states case 2's rule.
- [ ] If the contract had to change, the Decisions block says what and why; the gas figures stay inside `GasBudget.test.ts`'s window.

## Blocked by

- None: can start immediately.

## Prompt

Goal: build the task above. The "What to build" and "Acceptance criteria" sections are the brief; "done" is every criterion met with the `verify` gate in `dorfl.json` green.

Read first: `AGENTS.md` (the commit-reveal rules), `docs/adr/0013` and `0014`, `work/tasks/done/lean-rules-captures-without-merges-and-stones.md` (its Decisions), `contracts/test/js/KingCapture.test.ts` ("the two-victim square", `kingsFaceToFace`) and `contracts/test/js/Stones.test.ts` (`chain`, `aroundTheStone`, `inEveryOrder`), `contracts/test/js/utils/moves-world.ts`, then `_foldCapture`, `_captorFell`, `_fellIn` and `_captureOf` in `contracts/src/game/internal/UsingGameBoard.sol`.

Work in small steps, and `git commit -am "wip: <step>"` after each one. RECORD non-obvious in-scope decisions in a `## Decisions` block at the end of your FINAL REPORT. Do not write the done record, commit message or PR body yourself, and do not edit this task body.

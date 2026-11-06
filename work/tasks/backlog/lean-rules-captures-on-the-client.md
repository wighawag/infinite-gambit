---
title: 'Lean rules, captures on the client: stones on the board, the bot values them, and the words follow'
slug: lean-rules-captures-on-the-client
spec: lean-rules
blockedBy: [lean-rules-captures-without-merges-and-stones]
covers: [5, 9, 24]
---

## What to build

> FORWARD-POINTER (conductor, 2026-11-06, after PR #21): `lean-rules-captures-without-merges-and-stones` already did part of this task's words and ADR work. `CONTEXT.md` already has no Merge, Rock or Capture loop entries and has Stone and Promotion. ADRs 0001, 0003, 0004, 0009, 0010, 0011 and 0012 already carry their "Amended by" / "Superseded by" lines. VERIFY those against the list below and finish what is left (notably ADR-0013 and ADR-0014 are still `status: proposed`: flip them to `accepted`), rather than redoing them. On the client that task changed only decoding: `ArmyView.mergedInto` is now `capturedBy`, `PIECE_KIND.Stone = 7`, and `render/style.ts` has a placeholder stone glyph to replace. Its done record says `getOutcomes` reports the moving-king row as `died=1` with what stood there as `captured`, and that a stone made shows only in what stands on the square now: refine the client display from that, but do not change the contract.

The client and the words for the captures that `lean-rules-captures-without-merges-and-stones` put in the contract (no merges, promotion to queen, a captured army vanishing, stones). That task changed on the client only what the ABI forced; this one makes the game show and play the new captures.

- **The board draws stones**, distinctly from pieces and from the old rocks (a stone is a piece of its own kind, labelled with the army it was, and holds that army's stake: say so on hover or in the square's detail if the board shows one), and draws NO rocks. A captured army's pieces are gone from the board the cycle after the capture, as the contract reads them.
- **Captures are shown from the contract's `ChessRules.outcome`** as it now is: promotion (the capturing piece shown as a queen), a vanished army, a stone made, a stone captured.
- **The HUD's exit text and `$lib/chess/armies.ts`** stop mentioning rocks and merged armies; a player's army that holds captured stakes shows the total it would exit with.
- **The greedy bot** (`$lib/chess/strategy.ts`, CONTEXT "Greedy level") values a stone like a king: above any material.
- **The attacked-squares overlay** (`$lib/chess/attacked.ts`) treats a stone as attacking nothing, like a frozen army.
- **The offline world** plays it all: machine seats capture stones, and the world and boot tests stay green.
- **Words.** In `CONTEXT.md` ("This game"): remove Merge, Rock and Capture loop; add Promotion and Stone; rewrite the introduction ("absorbs its army"), Army, Capture, Collision, Exit (no rocks), Dead army, Freeze ("its pieces then joining the captor"), Material and Greedy level (rocks), to match the contract.
- **ADR statuses.** Mark ADR-0013 and ADR-0014 `status: accepted`; mark ADR-0004 and ADR-0010 superseded by ADR-0014 and ADR-0009 superseded by ADR-0013; add a line to ADR-0001, ADR-0003, ADR-0011 and ADR-0012 saying which part ADR-0013 or ADR-0014 amends.

## Acceptance criteria

- [ ] Stones are drawn, rocks are not, and a captured army's pieces leave the board the cycle after the capture.
- [ ] Promotion, a vanished army, a stone made and a stone captured are shown as the contract's `outcome` reports them.
- [ ] The HUD and `armies.ts` say nothing of rocks or merged armies.
- [ ] The greedy bot targets a stone like a king (unit-tested on a scene with a stone and material in reach), and the overlay marks nothing as attacked by a stone.
- [ ] The offline world tests (`web/test/lib/embedded/world.test.ts`, `web/test/lib/offline-boot.test.ts`, `web/test/lib/offline-players.test.ts`) pass.
- [ ] `CONTEXT.md` and the ADR statuses are updated as above.
- [ ] All logic in plain `.ts`; components only render (AGENTS.md "Svelte conventions").

## Blocked by

- `lean-rules-captures-without-merges-and-stones` (the contract rules and ABI this shows).

## Prompt

Goal: build the task above. The "What to build" and "Acceptance criteria" sections are the brief; "done" is every criterion met with the `verify` gate in `dorfl.json` green.

Read first: `AGENTS.md` (Svelte conventions, the framework boundary), `CONTEXT.md` ("This game"), the spec `work/specs/tasked/lean-rules.md`, `docs/adr/0013` and `0014`, the done record `work/tasks/done/lean-rules-captures-without-merges-and-stones.md` (what the contract now does and what it changed on the client), and `web/src/lib/chess/` (the renderer under `render/`, `armies.ts`, `strategy.ts`, `attacked.ts`, `ui/hud.ts`, `view.ts`, `board.ts`). Legal moves and outcomes come only from the contract's Simulation route (`docs/adr/0007-rules-live-only-in-the-contract.md`).

FIRST, check this task against current reality: has the captures task landed (stones and promotion in the contract, no merges or rocks), and does the client still draw rocks or mention merges? If not, route the task to needs-attention with the discrepancy (WORK-CONTRACT.md "Drift is a needs-attention signal").

Work in small steps (one decision, then edit and run a test), and grow files with edits of at most about 300 lines: earlier builds in this repo died on the 16,384-token output limit when a single reply tried to plan everything.

RECORD non-obvious in-scope decisions in a `## Decisions` block at the end of your FINAL REPORT (the runner transcribes it into the done record). Do not write the done record, commit message or PR body yourself, and do not edit this task body.

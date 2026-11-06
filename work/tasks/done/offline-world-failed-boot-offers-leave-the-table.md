---
title: 'A failed offline world offers a way to leave the table'
slug: offline-world-failed-boot-offers-leave-the-table
blockedBy: []
covers: []
---

## What to build

When the offline world fails to start, `/offline` shows "The offline world did not start." and the error, with no control at all. The world's navbar (`OfflineWorldNavbar.svelte`) offers "Leave this table" only once the world is `Ready`, so in the `Failed` state the only exit is "Home". Home keeps the same table, so the next visit boots the same failing world again. Since `offline-world-pre-deploys-every-seat`, the boot fails on purpose when it cannot deploy every seat and tells the player that "reloading carries on". If a reload does not carry on, the player has no way out short of clearing site data.

Offer the way out wherever the world has failed:

- **On the error card:** a "Leave this table" button that calls the lobby's existing `leaveTheTable()`. That function forgets the game and the table's choices and reloads, which brings back the lobby with a new world. Next to it, a "Try again" button that reloads the page (the world restores from its persisted chain and runs the boot again), since the error text itself tells the player to reload.
- **In the navbar:** show "Leave this table" in the `Failed` state as well as `Ready`. In `Failed` the seat count may not be known; show it only if it is.
- Say on the card what leaving does, briefly: this world is thrown away and a new one starts. Leaving is the one destructive exit, so its wording must not suggest it is a retry.

Leave the booting state (the spinner) alone: a boot in progress must not be interrupted by this task.

## Acceptance criteria

- [ ] When `$offlineWorld.step === 'Failed'`, the page shows "Leave this table" and "Try again", and the navbar shows "Leave this table".
- [ ] "Leave this table" there calls `offlineLobby.leaveTheTable()` and lands on the lobby with a new world; "Try again" reloads into the same world.
- [ ] The `Ready` state is unchanged, and nothing is added to the booting state.
- [ ] The components stay logic-less (AGENTS.md "Svelte conventions"): any decision about which exits to show lives in a plain `.ts` module or store, not in the `.svelte` file.
- [ ] Tests cover it: a unit test of whatever decides the exits per world step, and an e2e (or component) test that forces a failed boot and finds both buttons.

## Blocked by

- None: can start immediately.

## Prompt

Goal: build the task above. The "What to build" and "Acceptance criteria" sections are the brief; "done" is every criterion met with the `verify` gate in `dorfl.json` green.

Read first: `AGENTS.md` (Svelte conventions, the framework boundary: only `web/src/lib/kit` may import `$app/*`), `web/src/routes/offline/+page.svelte` (the `Failed` branch), `web/src/lib/ui/offline-world/OfflineWorldNavbar.svelte` (why it reads app-scoped modules and never a context), `web/src/lib/offline-lobby.ts` and `web/src/lib/game/lobby/lobby.ts` (`leaveTheTable`), and `web/src/lib/offline.ts` (`OfflineWorldStatus`, the `Failed` step). `web/e2e/tests/offline.e2e.ts` shows how the offline suites drive the page.

FIRST, check this task against current reality: is "Leave this table" still shown only in `Ready`, and does the `Failed` card still have no control? If it has drifted, route the task to needs-attention with the discrepancy (WORK-CONTRACT.md "Drift is a needs-attention signal").

Work in small steps (one decision, then edit and run a test), and grow files with edits of at most about 300 lines: earlier builds in this repo died on the 16,384-token output limit when a single reply tried to plan everything.

RECORD non-obvious in-scope decisions in a `## Decisions` block at the end of your FINAL REPORT (the runner transcribes it into the done record). Do not write the done record, commit message or PR body yourself, and do not edit this task body.

## Decisions

- **The seat count shows only once the lobby step is `Sat`.** "Known" needed a definition. The lobby always has a `seats` number, but before a sit-down or a restore it is a default, not this world's table. In `Ready` the lobby is always `Sat`, so the `Ready` navbar looks exactly as before. The alternative was to always show `$offlineLobby.seats`, which could display a wrong default for a world that failed early. This only affects the navbar.
- **The failed card is its own component, with its exits passed in as data.** This keeps the page and the card free of logic, as AGENTS.md asks, and lets a browser test render the card without booting a chain. The alternative was to keep the markup inline in `+page.svelte`, which is meant to stay identical across template branches, so the inline version would have made it differ more from upstream.
- **The card's leave button has its own test id, `leave-the-failed-table`.** It is different from the navbar's `leave-the-table`, so in a failed state both buttons are on screen without an e2e locator matching two elements. "Try again" is `try-the-world-again`. These ids are new names for future e2e tests.
- **A component test, not an e2e, is the coverage for a failed boot.** The task allowed either. Forcing a real failed boot in a browser needs a chain that refuses to deploy every seat, which isn't scriptable today, and the e2e suites aren't part of `verify` anyway.

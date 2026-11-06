---
title: 'A new offline world starts with every seat, the person included, already deployed'
slug: offline-world-pre-deploys-every-seat
blockedBy: [offline-world-chain-in-a-worker]
covers: []
---

## What to build

Today a fresh offline world (the hotseat mode, `$lib/offline.ts` + `$lib/offline-players.ts`) makes the person pick a spawn point and deploy, while the machine seats deploy on their own at spawn points counted from the FAR end of the open set (`spawnPointForSeat`). If the person picks one of those, both deployments fail by count (`chess-deployment-collisions`), the seat redeploys as its next army and the person has to deploy again, sometimes several times. On one device a hidden spawn choice buys nothing, so make the world start the way a table does: every seat already has an army on the board.

- **Enough open spawn points (decided by the human, 2026-11-06).** The offline world opens `openSpawnPoints` = 8 (the deploy's `default`, spread unchanged into `OFFLINE_DEPLOYMENT`), but a table can have up to `MOST_SEATS` = 10 seats, so "every seat on its own spawn point in one cycle" is impossible above 8, and `spawnPointForSeat`'s `seat % length` already collides there. Raise `openSpawnPoints` for the OFFLINE world only, to at least `MOST_SEATS` (a data change in `OFFLINE_DEPLOYMENT`; no contract change; the online world and tables keep theirs). The first deployment reveal writes the whole open set, so re-measure: the offline world uses the same gas figures, and `GasBudget.test.ts` must stay green for it (say in the Decisions block what K costs).
- **On a FRESH world** (not on a restore: "a boot is not always a first boot", see `web/src/lib/embedded/README.md`), every seat ends the boot with a `Deployed` army, through the normal contract path (each deployment's commit, advance, every reveal, advance; the world runs `CyclePolicy.Manual`). No contract change: the world keeps world rules (exits included). Online, deployment stays hidden and chosen, and tables already deploy at purchase.
- **The boot deploys only the HUMAN seats; the machine seats keep deploying through their own loop.** For a machine seat whose army is `Deploying`, `$lib/offline-players.ts` rebuilds the deployment from `spawnPointForSeat(seat, open)` and its derived secret, re-commits whenever the hash differs and at reveal tries only that deployment; the module says the spawn point is part of that WIRE. So a boot that placed a machine seat anywhere else would have its commitment replaced or unopenable, and the army would freeze. Give each human seat the spawn point of ITS OWN seat number by the same rule, `spawnPointForSeat(seat, open)` over the open set the cycle started with: seat numbers are distinct and below K (guaranteed by the bullet above), so every seat, human or machine, gets a distinct spawn point, and no machine seat's wire changes. (Do not hand humans "the near end" by a separate rule: with 10 seats and K = 10, the last machine seat's far-end slot IS index 0.) The boot drives the cycle so the machine seats' own deployments land in the same boot.
- **Who signs, and when.** The human seats' transactions are signed by the embedded wallet's accounts (the world's own burner wallet, which auto-approves). Run the boot after provisioning (the stakes are bought) and finish it BEFORE the world is marked ready (`status.set(ready)`) and before the seats' loop starts (`players.start()`), so neither the seat loop nor the advance client ever sees a half-done boot; drive the machine seats' deployments within the boot the same way the world test does.
- **Crash-safe, with no new wire.** If the tab closes between the commits and the reveals, the next boot must finish (or the armies would freeze, and an unrevealed deployment BURNS its stake). Derive each human seat's boot secret with the existing `playedSeatSecret` on that seat's first army id (`firstArmyOf`), which no machine seat ever uses, so no new derivation is added. Make the boot idempotent and decide from the CHAIN, never from a flag in storage: finish any deployment already committed for a seat, and deploy only seats with no army.
- **The person lands on a board with their army on it**, the camera on it (`chess-camera-minimap` centres on the army once it lands), and the deploy controls only appear once their army is gone (failed, captured, exited, frozen), as now. Their later redeploy keeps the current flow (choose a spawn point).
- **Machine seats** keep redeploying on their own when their army is gone (`chess-greedy-bot`).
- Keep the existing wires intact: the submission storage key and record shape, the machine seats' derived secrets and spawn points, and `offline-world:played-turns`.

## Acceptance criteria

- [ ] The offline world opens at least `MOST_SEATS` spawn points (online and table worlds unchanged), and `GasBudget.test.ts` stays green.
- [ ] A fresh offline world opens at a cycle where every seat, human and machine, has a `Deployed` army on its own spawn point, without the person acting, for every table size up to `MOST_SEATS`; every seat at `spawnPointForSeat(seat, open)`, machine seats with their usual secrets.
- [ ] Reloading at any point of that boot (after the commits, after the advance, after some reveals) finishes it on the next boot, with no frozen army and no burned stake; a restored world that already has its armies deploys nothing.
- [ ] The person is only offered the deploy controls once their army is gone, and that redeploy still works.
- [ ] Hotseat with several humans and single player both start pre-deployed.
- [ ] Tests cover the new behaviour (the boot from fresh, each interrupted point, and the restore path), next to the existing `web/test/lib/offline-players.test.ts` and `web/test/lib/embedded/world.test.ts`.

## Blocked by

- `offline-world-chain-in-a-worker` (both edit `web/src/lib/offline.ts`, and the boot's transactions should run off the main thread).

## Prompt

Goal: build the task above. The "What to build" and "Acceptance criteria" sections are the brief; "done" is every criterion met with the `verify` gate in `dorfl.json` green.

Read first: `AGENTS.md` (Svelte conventions; the commit-reveal rules, in particular "renaming a persisted key or field forfeits the stake" and "something must be at stake"), `CONTEXT.md` ("This game": army, spawn point, deployment, freeze), `web/src/lib/embedded/README.md` (what a boot vs a restore is, and the provisioning-on-every-boot lesson), `web/src/lib/offline.ts` (`startOfflineWorld`, provisioning, `stakeForEveryoneInTheWorld`, `playedByTheWorld`) and `web/src/lib/offline-players.ts` (how machine seats deploy and derive their secrets). The done records `work/tasks/done/chess-army-deployment.md`, `chess-deployment-collisions.md` and `chess-greedy-bot.md` explain why the world waits for every seat and how seats redeploy. All logic in plain `.ts`; components only render.

FIRST, check this task against current reality: does a fresh offline world still make the person deploy, and do machine seats still pick from the far end of the open set? If it has drifted, route the task to needs-attention with the discrepancy (WORK-CONTRACT.md "Drift is a needs-attention signal").

Work in small steps (one decision, then edit and run a test), and grow files with edits of at most about 300 lines: earlier builds in this repo died on the 16,384-token output limit when a single reply tried to plan everything.

RECORD non-obvious in-scope decisions in a `## Decisions` block at the end of your FINAL REPORT (the runner transcribes it into the done record). Do not write the done record, commit message or PR body yourself, and do not edit this task body.

## Decisions

- **What a person's seat number is.** The task says to give each human the spawn point of "its own seat number", and claims seat numbers are distinct and below K. In the code, a machine seat's `seat` is its index among the world's seats only (`playedByTheWorld` numbers them `0..played-1`), not its place at the table. So the person, at table seat 0, would share number 0, and the same spawn point, with the first machine seat. I chose `humanBootSeat(index, played) = played + index`: the people are numbered after the machine seats. This keeps the machine seats' numbers unchanged, all numbers stay distinct and below `MOST_SEATS` (a unit test checks every table/humans combination), and the people end up at the spawn points nearest the origin. The other option was renumbering machine seats by their table index, which would change their spawn points (forbidden). The number is a wire only for the length of one boot: an interrupted boot rebuilds the person's deployment from it. It affects `offline-boot.ts` only.
- **Where K lives.** `OFFLINE_OPEN_SPAWN_POINTS = 10n` is exported from `contracts/rocketh/config.ts` rather than written into `OFFLINE_DEPLOYMENT`. That way `GasBudget.test.ts` measures exactly the K the web world deploys, without a second copy. The alternative was a literal in `offline.ts` plus a hard-coded 10 in the gas test, which could drift apart. This touches the contracts config (a data constant, not a contract change) and needs `contracts/dist` rebuilt, which `pnpm install` does.
- **A commitment the boot did not make is left alone.** If a person's first army is already deploying under a commitment the boot didn't make (for example, one committed through the board by an earlier build), the boot treats that seat as done. The opening is to commit for a seat with no army and to finish its own commitments; replacing a person's choice would be worse.
- **A boot that cannot finish fails the world.** It is bounded at 12 steps. Past that it throws, `startOfflineWorld` reports `Failed`, and a reload carries on from the chain. The alternative, showing the board anyway, could leave the person's deployment committed but never revealed, which burns its stake. This is a new user-visible error path.
- **No boot without the world's wallet.** If no wallet was announced, the boot is skipped and the world opens with the old deploy-from-the-board flow.
- **A restored world whose person never deployed gets deployed.** An older world restored with a person who has no army is not a fresh world, but the boot (deciding from the chain) deploys the person anyway. On such a world K is still 8, so with 9 or more seats the person's spawn point can collide with a machine seat's. The deployment then fails and is refunded, the boot stops, and the person redeploys as usual.

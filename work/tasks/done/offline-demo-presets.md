---
title: 'Offline demo presets: one URL puts the offline world one move away from a rule'
slug: offline-demo-presets
blockedBy: []
covers: []
---

## What to build

Named starting positions for the offline world (`/offline`), for recording the ETHGlobal demo video with the network off. Source: the presentation repo's handoff `wighawag/chess-battleground-presentation/handoffs/offline-demo-presets.md`.

A preset is: deploy data on top of `OFFLINE_DEPLOYMENT` with the tight spawn grid (`spawnSpacing: 6n`, as `contracts/test/js/utils/moves-world.ts`); a setup script (which armies deploy on which spawn points, then the cycles that bring the pieces into position) driven through the REAL contract with the same calls a player makes (no cheat setters, no storage writes: `docs/adr/0007-rules-live-only-in-the-contract.md`); the seats (hotseat people at this device, and world seats); and a short description of the decisive move.

- Presets, in build order: `showcase` (dodge, collision and king capture each one move away on different parts of the board), then `collision`, `king-capture`, `dodge`, `exit`.
- Added by the presentation side on 2026-11-06 22:30 UTC: `showcase-spawn` (the showcase plus a third hotseat person who holds a stake and has NOT deployed, to film choosing a spawn point and deploying), and `chase-trade` (three piece-moves: the king steps to its empty core square, its queen lands where it stood, the enemy knight arrives there too, and the queen and knight both die; `ThreePieceMoves.test.ts` "the chase ends in a trade"). Every preset must also work under `PUBLIC_RENDERER=pixi`: it boots, the hint does not hide the pieces involved, pieces can be selected and moved on the board, and the setup cycles do not replay as a burst of animations when the board first shows. README.md, web/.env.sepolia and web/src/web-config.json are not to be touched (another branch changes them).
- Reached from a "Demo presets" list in the offline lobby and from `/offline?preset=<id>`.
- "Restart preset" rebuilds the preset from scratch in seconds, in the tab, without a reload (it has to work with the network off).
- A preset world never touches the player's normal offline world: its own fresh chain id that is never written to `offline-world:chain-id`, a chain and deployment records that are not persisted, no lobby keys, and the world seats' played turns in memory rather than in `offline-world:played-turns` (whose store deletes other chains' records at boot).
- Deterministic: the same spawn points, army ids (the preset wallet derives from a fixed mnemonic) and pieces every time.
- The decisive move is shown in a dismissable demo-only hint panel, which only exists in a preset world and hides with one key.
- No change to the online world, tables, or the default offline world's deploy data and behaviour. Renderer-agnostic: nothing in the renderer.

### Drift from the handoff (checked against `main` on 2026-11-06)

- **There are no merges any more** (`docs/adr/0013-no-merges-a-captured-army-vanishes-and-its-captor-is-promoted.md`). A king taken by a lone piece makes its army vanish from the board, the capturing piece becomes a queen, and the whole stake goes to the captor. The `king-capture` outcome is asserted as that: the victim's army is `Captured` by the captor, and the captor's stake grew by the victim's.
- **The army layout changed** (`docs/adr/0015`): the king stands on its spawn point (bob's on (6,0), not (6,1)). The positions are re-derived from the current contract tests (`KingCapture.test.ts` "a capture in the offline world", `Collisions.test.ts`, `Exits.test.ts`).

## Acceptance criteria

- [ ] `/offline?preset=<id>` and the lobby's "Demo presets" both start each preset (at least `showcase`, `collision` and `king-capture`).
- [ ] `showcase-spawn` and `chase-trade` exist, each with an e2e test like the others, and the preset suite passes under `PUBLIC_RENDERER=pixi` too.
- [ ] A test per preset starts it, plays the decisive move with each seat, advances the cycle and asserts the outcome: the dodger survives and the attacker stands on the empty square; both colliding pieces are gone; the king's army is captured by the captor, which holds its stake; the exiting king is gone and its owner's ETH went up.
- [ ] "Restart preset" brings back the starting position in a few seconds.
- [ ] Starting, playing and restarting a preset leaves the normal offline world untouched (an e2e test covers it).
- [ ] Every preset boots and plays with the browser offline.
- [ ] `check`, `test:unit` and the e2e suite are green.

## Blocked by

- None.

## Decisions

- **Preset worlds are never persisted and are minted a fresh chain id on every build**, never written to `offline-world:chain-id`. A fixed id would let a previous take's submissions and operations ledger be read into the next. Determinism of army ids comes instead from a fixed wallet mnemonic (`PRESET_MNEMONIC`), via a new optional `mnemonic` parameter on `announceEmbeddedWallet` (`$lib/embedded/wallet.ts`, a mechanism file that belongs upstream).
- **Presets do not take the `offline-world` one-tab lock**: the lock protects a persisted world from a second writer, and a preset is never persisted.
- **Restart rebuilds in the tab** (dispose the node, stop the wallet, build again; about 2 s measured in e2e) so it works offline. Leaving a preset and opening one from the lobby are full page loads, so a preset never starts beside a booted normal world.
- **A preset's world seats keep their decided turns in memory**: `createPlayedTurnStore` deletes every other chain's records when it opens, so sharing `offline-world:played-turns` would strand the normal world's greedy seats.
- **Presets start the rules sandbox once at boot** (`warmTheRulesSandbox`), because the service worker does not precache Worker bundles; a sandbox first started offline cannot load and every move is refused. The normal offline world still has the gap (`work/notes/observations/service-worker-does-not-precache-worker-bundles.md`).
- **A preset's setup ends with one cycle in which every army passes**, so the HUD's last-cycle outcomes do not report a setup capture on the first board.
- **The king-capture outcome is asserted under the lean rules** (`docs/adr/0013`): the victim is `Captured` by the captor, its pieces leave, the capturing piece is a queen and the captor's stake grew by the victim's. The handoff's "merge" is gone.
- **The exit payout is asserted against its receipt**: the offline price (0.00000001 ETH) is smaller than the gas the owner pays to claim it, so the balance alone goes down.
- **`showcase-spawn` is a separate preset**, not an option on `showcase`, so the main take keeps two handovers per cycle.
- **The exit payout button got `data-testid="exit-payout"`.**

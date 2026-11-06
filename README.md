# Infinite Gambit

![Infinite Gambit](web/static/preview.png)

**Simultaneous chess on an infinite onchain board. Stake an army, capture kings, betray your allies.**

Built at ETHGlobal Mumbai 2026.

- Live demo: [TODO]
- Demo video: [TODO]
- Contracts: Sepolia [TODO: addresses]

## What it is

Infinite Gambit is chess rebuilt for a persistent, permissionless world. Anyone can stake ETH to deploy an army (a king and nineteen pieces) at a spawn point they choose in secret. Every cycle, every army makes one chess move, committed as a hash and then revealed together, and all moves resolve simultaneously against the board as it was at the start of the cycle.

Staked two-player chess does not work onchain, because engines beat humans and nobody stakes against them. With unbounded players and hidden simultaneous moves, the game becomes social as well as tactical: armies can ally against a third, but nothing forces them to keep the promise, so every cycle is a small prisoner's dilemma.

## The rules in one minute

- **Deploy.** Stake ETH to place an army at a hidden spawn point. Two deployments on the same spawn point in the same cycle both fail and are refunded.
- **One move per army per cycle.** However big your army grows, it makes one move per cycle. Commit the move as a hash, then reveal it.
- **Simultaneous resolution.** A piece that moves away dodges the capture aimed at it. Two pieces that swap squares both complete their moves. Two or more pieces arriving on one square all die, while a single arriver takes a piece that stayed put. A moving king survives a crowd, but not a lone attacker.
- **No checkmate.** You have to actually capture a king. When you do, you take its stake and absorb its whole army.
- **Exits.** The only way to take a stake home is to bring your king, alone, to an exit square.
- **Miss a reveal and your army freezes.** It never moves again, and its stake stays on the board as prey.

The same rules also run as **tables** (closed games for a fixed set of players, with a winner) and **offline**: a whole world on a chain inside the browser tab, for hotseat play at one device and for single player against machine-played seats.

The vocabulary is defined in [`CONTEXT.md`](CONTEXT.md) and the full rule set is in [`work/specs/tasked/infinite-chess.md`](work/specs/tasked/infinite-chess.md).

## How it works

**Reveal order never decides anything.** Reveals land onchain in any order, so a reveal only records facts that do not depend on that order: each origin's destination, a per-destination arrival count, the lone arriver, whether a king arrived. A square's state is a pure function of those facts and its previous state, computed lazily the next time anything touches it. There is no settlement transaction that someone has to pay for each cycle. King captures and merges resolve the same way, through per-army "captured into" pointers that are followed on read, so absorbing an army moves nothing and capture loops (A takes B while B takes A) resolve deterministically.

**One copy of the rules.** Move legality, resolution and the bot's scoring exist only as the contract's `pure` functions. The frontend never re-implements them: it runs the contract's own code in [webevm](https://github.com/wighawag/webevm), an EVM inside the browser tab, so client and chain cannot disagree. The same in-browser EVM can host a whole world, which is how offline play works.

**Stack.**

- Solidity contracts, built with Hardhat v3 and deployed with hardhat-deploy v2 / rocketh. They are route contracts (commit, reveal, getters, simulation, registry) over shared storage, on top of a generic commit-reveal base.
- A SvelteKit 5 / Svelte 5 frontend that draws the infinite board on a canvas (canvas 2d), with a camera that follows your army and a minimap of the spawn spiral. It uses viem for the chain.
- The frontend is a static, IPFS-compatible PWA.
- [fuzd](https://github.com/wighawag/fuzd) is an optional time-locked reveal service, so you don't have to keep the tab open.

Every non-obvious decision is written down as an ADR in [`docs/adr/`](docs/adr/). Start with 0002 (order-free lazy resolution), 0003 (the collision table), 0004 and 0010 (capture loops), 0007 (the rules live only in the contract) and 0009 (merges through "captured into" pointers). ADRs 0013 to 0015 are proposals for a leaner rule set and are not implemented.

## CROPS

- **C (censorship resistant):** The frontend is static and runs from IPFS or any static host. With no RPC configured, it reads the chain through the user's own wallet. Our optional reveal service (fuzd) is a convenience: if it goes away, the open tab reveals for you, and the only cost is that you must keep it open until your reveal lands. The offline world needs nothing from us at all.
- **O (open source):** AGPL-3.0 (see [`LICENSE`](LICENSE)). The contracts, the frontend, the deploy scripts and the in-browser chain can all be built and run from this repo alone.
- **P (private):** No analytics or trackers. Moves stay hidden until the reveal phase, which is the point of commit-reveal. What still leaks: the RPC provider (yours, or the wallet's) sees your address and which board region you read, so it could infer roughly where your army is.
- **S (secure):** Keys stay in your wallet or on your device. The secret for each commitment is kept in your browser's storage until it is revealed. The rules exist only in the contract, so the client cannot disagree with the chain about a move. Trust assumptions: the chain, and the contracts as deployed. The hackathon deployment is still behind an upgradeable proxy, and it becomes immutable once the proxy is dropped or its admin renounced.

## What is new and what is reused

- **Reused:** our own public, generic starter kit, [template-commit-reveal](https://github.com/wighawag/template-commit-reveal). Everything up to commit `6466641` ("template: github:wighawag/template-commit-reveal@5c8b2d8", 5 Nov 2026, 15:56 UTC) comes from it. It provides the commit-reveal cycle machinery, the lobby and table factory, the stake token and sale, an infinite board and canvas, the in-browser chain, hotseat, and the wallet and transaction plumbing. Its developer documentation is kept in [`README.template.md`](README.template.md).
- **New at ETHGlobal Mumbai:** everything after that commit. That covers:
  - the infinite-chess spec and ADRs 0001 to 0012;
  - the chess rules contract ([`contracts/src/game/internal/ChessRules.sol`](contracts/src/game/internal/ChessRules.sol)) and board resolution;
  - army deployment, spawn collisions and refunds;
  - one move per army per cycle, simultaneous resolution and the collision table;
  - king capture and merge, and capture loops;
  - freezing, exits and redeeming, and tables;
  - the greedy bot, the camera and minimap, the HUD and the chess UI;
  - the offline world running its chain in a Worker.

  Each was merged as its own PR.

## How AI was used

We worked spec-driven with AI agents, all running Claude Opus 5.5. A human (Ronan) wrote and decided the game spec and every ADR. An autonomous runner drove Claude Code agents to implement each task on its own isolated branch, and a task was merged only when the test suite was green. When an agent hit an ambiguity, it stopped and asked the human, who answered in writing. Every spec, ADR, task, question and answer is in this repo under [`work/`](work/) and [`docs/adr/`](docs/adr/), so the split between human and AI work can be audited. The same model also produced the game's look (sprites, UI styling, the brand) under human direction.

## Run it locally

You need [Node.js](https://nodejs.org/) and [pnpm](https://pnpm.io/).

```bash
pnpm i
pnpm start        # local chain, contract auto-deploy and the web dev server, in Zellij
```

Without Zellij:

```bash
pnpm contracts:node:local                       # terminal 1
pnpm contracts:deploy localhost --skip-prompts  # terminal 2
pnpm contracts:export localhost --ts ../web/src/lib/deployments.ts
pnpm web:dev
```

To play with no chain at all, open the **Offline** entry of the menu: the whole world runs inside the tab.

Run the tests:

```bash
pnpm contracts:test
pnpm --filter ./web test:unit
```

Deploy to a network (Sepolia here), with `ETH_NODE_URI_sepolia` and the deployer key set in `contracts/.env.local`:

```bash
pnpm contracts:deploy sepolia
pnpm build sepolia                              # exports the deployment, then builds web/build
pnpm web:serve                                  # serves the build the way an IPFS gateway would
```

More detail on the tooling (deploy scripts, environment variables, development modes) is in [`README.template.md`](README.template.md).

## License

[AGPL-3.0-only](LICENSE). Some Solidity interface files are MIT, as marked in their SPDX headers.

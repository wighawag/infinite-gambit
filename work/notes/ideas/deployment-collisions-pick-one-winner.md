---
title: "Deployment collisions: options so a spawn point cannot be blocked for free"
type: idea
status: incubating
created: 2026-11-06
---

Raised by the maintainer, 2026-11-06, while reviewing how deployments work. Nothing is chosen: this lists the options and the drawbacks of each.

## The problem

Two deployments that reveal the same spawn point in the same cycle both FAIL, and each stake is refunded in full to its account's reserve (`_settleDeployment` / `_refundArmy` in `contracts/src/game/internal/UsingGameInternal.sol`; the Deployment entry in `CONTEXT.md`). So a collision costs its makers nothing but gas, which makes griefing cheap:

- Two accounts committing to the same spawn point every cycle keep it empty forever (an account has one pending deployment at a time, so it takes two). With 8 open spawn points online (`openSpawnPoints: 8n` in `contracts/rocketh/config.ts`), 16 accounts stop every new player from joining, for about 300k commit gas plus 300k reveal gas per account per cycle.
- One griefing account is enough to kill a specific honest deployment, if it guesses or covers that player's spawn point: the honest deployment fails with it.

## Options

### A fee on collisions

Refund the stake minus a few percent, burned.

- Simple to build.
- Every griefed cycle now costs the griefer money, not just gas.
- Drawback: honest players who collide by accident pay the fee too.
- Drawback: the spawn point still stays empty, so a griefer willing to pay can still block it.

### One random winner per collision: counter, XOR and map, read lazily

Per spawn point per cycle, each deployment reveal adds to:
- a COUNTER of deployments (`n`);
- the XOR of their secrets (`x`);
- a MAP, `index => army`, written at index `counter` before incrementing.

After the cycle closes, the winner is read lazily, like every other square fact (`docs/adr/0002-order-free-lazy-resolution.md`), as `map[keccak(x) % n]`. That is one read, with no loop. The losers are refunded by `settleDeployment` as today.

- The spawn point always fills, so blocking it means landing a real army (a locked stake, which others can capture) every time. Sybils buy better odds, each at the price of a stake when it wins.
- `x` cannot be ground at commit time, because it depends on every collider's secret. A last revealer who sees they lost can only withhold their reveal, which burns their stake (`docs/adr/0005-missed-reveal-freezes-the-army.md`).
- Drawback: the map's indices are assigned in reveal order.
  - An honest reveal waiting in a public mempool exposes its secret.
  - A griefer with one or more of its own colliding deployments still unrevealed then knows `x`, `n` and the winning index.
  - It can front-run with its own reveals to push the honest deployment off that index, so a contested spawn point goes to whoever controls ordering rather than at random.
  - The cost of this is limited: every win still lands a funded army, the griefer has to be on the honest player's (hidden) spawn point in the first place, and the attack needs a public mempool and priority gas.
  - It is still order deciding what a player gets (the AGENTS.md commit-reveal rule). Accepting it would need the argument written next to the code and pinned with a test.

### Variants of the lottery that remove the reveal-order index

- **Fix each deployment's index at commit time, from a per-cycle counter.** Drawback: the commit hides the spawn point, so a global commit index does not give a dense per-spawn-point index that `% n` can pick from without a loop.
- **Mix in entropy nobody has while reveals are landing**: for example a block hash from after the reveal phase ends, stored by the first read after the cycle. Drawback: whoever chooses that block can bias it a little, and `blockhash` only reaches back 256 blocks, so it must be stored in time.
- **A bounded loop at fold time picking `argmin keccak(x, army)`**, which does not depend on order. Drawbacks:
  - The number of colliders has to be capped.
  - A cap that refuses extras is order-dependent again.
  - The fold cost must stay inside the reveal gas, because a reveal that runs out of gas freezes the army.

### Assign spawn points instead of letting players choose

Each cycle, a random permutation places the cycle's deployers over the open set, seeded from all their secrets.

- No collisions at all, and positions still cannot be predicted.
- Drawback: players lose the choice of spawn point.
- Drawback: every position read moves to after the cycle.
- Drawback: the permutation's seed has the same reveal-order and entropy questions as the lottery.
- It is the largest change of the options listed here.

### A sealed-bid auction inside the deployment's own commit-reveal

It fits in ONE cycle (the maintainer's point; an earlier draft of this note wrongly said it would likely need more):
- The bid is part of the deployment's actions, so the commitment hides it along with the spawn point.
- The reveal opens it and compares it with the spawn point's running maximum for the cycle, keeping the highest bid and its army.
- A maximum is commutative, so the result does not depend on reveal order, and no front-running can change who wins. Keeping the top two the same way gives a second-price auction at the same cost.
- After the cycle, the highest bidder's deployment lands. The others fail, and their stakes and bids are refunded by `settleDeployment`, which compares the army's own stored bid with the final maximum.

What it gains:
- A deployer alone on a spawn point can bid 0, so the auction only costs anything when a spawn point is contested.
- Blocking a point means outbidding everyone there every cycle and landing an army each time.
- Per reveal, it costs one comparison and a slot write or two.

Drawbacks:
- The bid must be escrowed at COMMIT time, and the escrowed amount is public, so it reveals an upper bound on the bid. Escrowing more than the bid hides it better but ties up more stake.
- Ties need a tie-break that does not depend on order. Options: by `keccak(army, cycle)`, which a griefer can grind through addresses but which only matters at exact ties; or fail every tied deployment, which brings back free blocking for anyone who can match a bid.
- The winning bid has to go somewhere: burned, into the `StakeSale` surplus, or into some pot. Each choice changes the token's economics (`docs/adr/0006-stake-erc20-reserve-exit-only.md`).
- The richest player gets the best spawn points.
- Players have to choose a bid, which adds a decision to the deployment UI.
- A bidder who sees they have lost can still withhold their reveal, which burns their stake as it does today. That is costly, so it is not a lever.

## Whatever is chosen

It changes ADR-backed behaviour (the Deployment entry in `CONTEXT.md`), so it needs an ADR. It also touches the deployment reveal's gas, which `contracts/test/js/GasBudget.test.ts` prices.

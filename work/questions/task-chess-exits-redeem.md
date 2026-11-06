<!-- dorfl-sidecar: item=task:chess-exits-redeem type=task slug=chess-exits-redeem allAnswered=false -->

## Q1

**'task:chess-exits-redeem' was bounced — how should we proceed?**

> chess-exits-redeem cannot be built as written. Two hard budgets the task names are already exhausted or contradicted by what landed, and one client premise is missing.
>
> 1. ROUTE SIZE: the Reveal route has no room. `RouteSizes.test.ts` measures GameReveal at 24,545 of 24,576 bytes (31 bytes free) in the default, unoptimised profile. That is the build `pnpm compile` produces and the one the in-browser offline world deploys (`web/src/lib/offline.ts`, `contracts prepare`). The production profile is 20,792 bytes, but neither the test nor the offline world uses it. The exit rule needs code on the reveal path: a "has this army exited" check when a square is resolved (`_rawSquareAt`/`_squareAt`), and saving the exit fact when the square is touched again (`_touch`). A structural choice must be made first. Options: (a) measure route sizes on the production profile and ship production artifacts to the offline world; (b) split the reveal route, for example moving deployment reveals behind their own entry point, which changes the ABI and the client; (c) move ChessRules into an external library, which breaks ADR 0007's simulation sandbox, since it runs one route's bytecode alone. Each choice affects every later contract task, so a human should pick it.
>
> 2. GAS: removing an exited empire's pieces contradicts ADR 0009's bound. The task says the exited army's remaining pieces vanish lazily, through a flag read on resolution. "Its pieces" includes pieces of armies merged into it, and you only learn their army by following the merge pointers (`_walk`, about 20,069 gas per unfolded merge measured, up to MAX_CHAIN = 8). ADR 0009 bounds reveal gas by following that chain for exactly two squares (the mover and the destination). Path squares, a king's 8 neighbours and the 20 footprint squares checked by `_footprintClear` are read without it (`_rawSquareAt`), on the stated premise that only kind matters there. Once exits remove pieces, kind depends on the chain: a path or footprint square holding a piece of an exited empire must read empty. Pricing that honestly adds about 6 × 8 × 20k ≈ 960k gas for a slider path, and far more for a deployment footprint, on top of today's worst of about 1,038,000 against the declared 1,200,000 revealGas. Raising the budget that far, accepting a narrower meaning of "removed", or adding some new mechanism that makes exited pieces cheap to recognise is a design decision. It probably needs an ADR amending 0009.
>
> 3. CLIENT: there is no minimap to mark exits on. The task asks for exits "on the board and on the minimap", but `chess-camera-minimap` is still in backlog, is not in this task's blockedBy, and says the exit markers come from this task.
>
> Suggested re-scope: first decide (1) and (2), recorded as an ADR on how leftover pieces of an exited army are resolved within bounded reveal gas, and how the routes get room. Then either split this task into a contract/money part (StakeSale `redeem`, only the sale mints, the sale keeps its ETH, guarded `setMinter` and game-to-sale setter, test helpers moved onto buying, no direct army-reserve withdrawal, an incremental permissionless collection of merged reserves deeper than MAX_CHAIN) and an exit-resolution part built on that decision, or keep it whole but make it blocked by a route-size task. Move the minimap exit markers to `chess-camera-minimap`, or make this task blocked by it.

<!-- q1 fields: id=q1 kind=stuck -->

**Your answer** (write below this line):

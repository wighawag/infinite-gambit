# Where the gas of a plain move goes

Measured on commit `a9ae76a` (2026-11-06), on the `test` network (EDR, `evmVersion: london`), by `contracts/test/js/GasProfile.test.ts`, with the folding in `contracts/test/js/utils/gas-profile.ts` and `utils/gas-functions.ts`. The raw output of that run, every slot of every transaction included, is in `docs/spikes/gas-profile-of-a-plain-move/default-build.txt` (the test build) and `production-build.txt` (the optimised build).

To reproduce, from `contracts/`:

```sh
pnpm hardhat --network test test nodejs test/js/GasProfile.test.ts
GAS_PROFILE=slots,functions pnpm hardhat --network test test nodejs test/js/GasProfile.test.ts
GAS_PROFILE=slots pnpm hardhat --build-profile production --network test test nodejs test/js/GasProfile.test.ts
```

The first prints the buckets of every transaction; `slots` adds every storage slot each one read or wrote, with what it cost; `functions` adds the Solidity functions the gas was spent in (meaningful on the test build only: the optimiser inlines, and its jumps no longer say which function they enter). The production run recompiles `artifacts/` with the optimiser; the next plain `pnpm test` recompiles them back.

## How it is measured

`profileTransaction` reads the node's struct-log trace (`debug_traceTransaction`) and books every step's own cost (the gas left before it minus the gas left after it; a call's child frame is subtracted from the call) to the contract whose code ran and to a bucket. Storage operations are booked to the slot they touch, and each slot is named from the hashes the transaction itself computed: the profile shadows the scratch space Solidity hashes mapping keys in, keeps a preimage only when its hash is the one the EVM pushed, and names the base slot from the compiled storage layout or the ERC-7201 namespaces of the commit-reveal base and of delegation. Before it reports anything it checks that intrinsic + execution - refund is the receipt's `gasUsed`, exactly.

The buckets: `intrinsic` (the 21,000 every transaction pays) and `calldata` (4 per zero byte, 16 per other); `dispatch` (everything that runs in the proxy and the router, including their `DELEGATECALL`s and the proxy's read of its implementation slot); one bucket per group of storage (the commit-reveal base's commitment, reserve, attendance, cycle state and roster; the game's square records, spawn records, zone index, army record, ...); `events`; `hashing` (KECCAK256, mostly mapping slots); `calls out`; and `compute`, every other opcode the game's routes ran.

Storage is priced by EIP-2929/3529: a cold read 2,100 and a warm one 100; a write that makes a zero slot non-zero 20,000, a write that changes a non-zero slot 2,900, a write of the value already there (or to a slot already written this transaction) 100, each plus 2,100 if the slot was cold; clearing a slot refunds 4,800, capped at a fifth of the transaction.

## The scene

The first army of the shipped world, deployed on (0,0), facing North, alone, one move a cycle, nothing to settle:

```
y= 1  . P P P P .     x = -3 .. 2
y= 0  P K B N R P
y=-1  P R N B Q P
y=-2  . P P P P .
```

- **pawn**: (0,1) to (0,2), its first step ("fresh": neither square has a record); later (0,2) to (0,3) after a knight has stood on (0,3) and left ("touched": both squares have a record of an earlier cycle, which the move folds).
- **slider**: the queen (1,-1) to (8,-8) down the open diagonal, 7 squares, then back. Its path squares are only read, never touched, so the path is fresh both ways.
- **king**: (-2,0) into the empty corner (-3,1), then back.
- **commit**: the commitment of the king's return, a cycle after several moves; the army's first commit after its deployment costs 103,314 (89,056 optimised) and differs only in reading a king's square with no record.
- **deployment**: the first ever, commit and reveal, every slot cold.

`GasBudget.test.ts` logs different figures (king 452k, slider 373k, deployment reveal 332k) because its scene is the budget's worst case: the last spawn point of the open set, a king stepping into a zone nobody touched, and a slider over seven squares holding stale facts. This profile is of the ordinary case.

## The breakdown

Gas per bucket. Storage is the test build's; the optimised build's storage differs only by repeated warm reads it drops (a few hundred gas per transaction, see the raw output). Compute is given for both builds.

| | commit | pawn fresh | pawn touched | slider fresh | slider touched | king fresh | king touched | deploy commit | deploy reveal |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| intrinsic (21000) | 21,000 | 21,000 | 21,000 | 21,000 | 21,000 | 21,000 | 21,000 | 21,000 | 21,000 |
| calldata | 1,116 | 1,400 | 1,400 | 1,496 | 1,496 | 1,484 | 1,484 | 1,188 | 1,376 |
| dispatch: proxy + router | 11,431 | 9,359 | 9,359 | 9,359 | 9,359 | 9,359 | 9,359 | 11,431 | 14,556 |
| commit-reveal: commitment | 7,800 | 7,400 | 7,400 | 7,400 | 7,400 | 7,400 | 7,400 | 46,800 | 10,200 |
| commit-reveal: reserve | 2,100 |  |  |  |  |  |  | 27,200 |  |
| commit-reveal: attendance | 7,600 | 5,200 | 5,200 | 5,200 | 5,200 | 5,200 | 5,200 | 67,100 | 5,200 |
| commit-reveal: cycle state | 5,900 | 4,600 | 4,600 | 4,600 | 4,600 | 4,600 | 4,600 | 5,900 | 4,600 |
| commit-reveal: roster |  | 2,500 |  | 2,500 |  |  |  | 2,500 |  |
| game: square records | 10,100 | 104,300 | 81,400 | 116,900 | 94,000 | 117,100 | 101,500 |  | 42,000 |
| game: spawn records | 4,400 | 5,600 | 4,800 | 5,200 | 8,400 | 7,600 | 12,000 |  | 59,600 |
| game: zone index |  | 22,300 |  | 27,100 |  | 5,200 |  |  |  |
| game: army record | 10,100 | 10,300 | 10,300 | 10,300 | 10,300 | 31,700 | 17,300 | 30,900 | 5,400 |
| game: army count |  |  |  |  |  |  |  | 22,200 |  |
| game: army list |  |  |  |  |  |  |  | 44,200 |  |
| game: open spawn set |  |  |  |  |  |  |  |  | 89,700 |
| events | 2,012 | 2,268 | 2,268 | 2,268 | 2,268 | 2,268 | 2,268 | 8,935 | 4,024 |
| hashing | 714 | 1,242 | 990 | 1,452 | 1,326 | 1,956 | 2,670 | 708 | 1,530 |
| calls out |  |  |  |  |  |  |  |  | 100 |
| compute (test build) | 24,188 | 83,416 | 72,689 | 126,586 | 132,030 | 166,957 | 204,798 | 22,553 | 68,038 |
| compute (production build) | 13,106 | 48,562 | 43,440 | 73,655 | 79,126 | 100,542 | 124,186 | 12,435 | 42,567 |
| refund |  |  | -9,600 |  | -9,600 |  | -9,600 | -4,800 | -4,800 |
| **total, test build** | **108,461** | **280,885** | **211,806** | **341,361** | **287,779** | **381,824** | **379,979** | **307,815** | **322,524** |
| **total, production build** | **94,779** | **242,531** | **178,457** | **284,930** | **230,775** | **312,009** | **294,267** | **295,397** | **296,253** |

No plain move notes a capture candidate (`_capturesBy`): that list is only pushed when a king meets a piece, and is priced in `GasBudget.test.ts` at about 45,200 (two fresh slots).

### The declared figures are measured on the test build

`pnpm test` compiles the `default` profile, which has no optimiser, and `GasBudget.test.ts` measures that build; `pnpm deploy` compiles `production` (optimiser, 999,999 runs). The same transactions cost 4% (a first deployment commit) to 23% (a touched king step) less in the build a chain runs, all of it compute. So `commitGas` and `revealGas` carry more headroom on a real chain than the test says, which is the safe direction, but the savings below should be judged on the production column.

### A square record, slot by slot

The record is four slots: the standing piece's army (256 bits), one packed slot (`cycle`, `kind`, `forward`, `moved`, `departed`, `arrivals`, `kingArrived`, `arriverKind`, `arriverForward`, `kingForward`, 160 bits used), the arriver's army and the arriving king's army (256 bits each). What the two squares a move touches cost (test build; reads and writes of each slot, refunds in brackets):

| square | packed slot | `army` | `arriverArmy` | `kingArmy` | total |
|---|---:|---:|---:|---:|---:|
| pawn fresh, origin (0,1) | 24,400 fresh | 22,100 fresh | 2,100 read | 2,100 read | 50,700 |
| pawn fresh, destination (0,2) | 25,000 fresh | 2,200 zero over zero | 22,100 fresh | 2,100 read | 51,400 |
| pawn touched, origin (0,2) | 9,600 update | 22,300 fresh | 5,300 cleared (-4,800) | 2,100 read | 39,300 (-4,800) |
| pawn touched, destination (0,3) | 10,200 update | 5,200 cleared (-4,800) | 22,400 fresh | 2,100 read | 39,900 (-4,800) |
| king fresh, origin (-2,0) | 24,700 fresh | 22,100 fresh | 2,100 read | 2,100 read | 51,000 |
| king fresh, destination (-3,1) | 25,000 fresh | 2,200 zero over zero | 2,100 read | 22,100 fresh | 51,400 |
| king touched, origin (-3,1) | 15,800 update | 22,600 fresh | 2,700 read | 5,600 cleared (-4,800) | 46,700 (-4,800) |
| king touched, destination (-2,0) | 10,400 update | 5,200 cleared (-4,800) | 2,400 read | 22,100 fresh | 40,100 (-4,800) |

The slider's two squares cost the same as the pawn's. Every other square a move reads costs one cold read of the packed slot, 2,100: the 6 path squares of the slider, the 7 neighbours of the king's destination that are not its origin, and the mover's own king square, which every reveal and every commit reads to ask whether the army is still its own (`_pendingCapture`, through `_armyOf` on a reveal and `_ownerOf` on a commit; the commit reads all four of its slots, 10,100).

So one written square costs about 51,000 fresh and about 35,000 net touched, and the 256-bit ids are most of it: a touched square is not cheap, because folding moves an army id from one id slot to another, and a zero slot made non-zero costs 20,000 whether or not the record existed. The packed slot itself costs about 25,000 the first time and 10,000 to 16,000 after: one cold read and one priced write (22,100, or 5,000), plus tens of warm reads and rewrites of its fields at 100 each, since `_touch` writes the fields one by one.

### Where the compute goes

On the test build (`GAS_PROFILE=functions`), inclusive of storage, the king step back onto its square (379,979) spends 190,424 in `_rawSquareAt` over the 9 squares it reads (104k of it in `_laidAt`, which finds the spawn point covering the square, `_spawnCovering`, 53k, and lays its piece out, `ChessRules.layoutAt`, 39k), 82,048 in `_touch` for the two squares it writes, 33,236 in `_exited` (asked for every occupied square read), 24,920 in `ChessRules.moveSquares` and 93,356 in compiler-generated helpers (memory struct copies, checked arithmetic, cleanups). The pawn's fresh step (280,885) spends 140,755 in `_touch`, 46,567 in `_rawSquareAt` and 41,245 in helpers. The optimiser removes about 40% of the compute; the shape stays.

## What the commit spends beyond storing a hash

Storing the hash is about 5,600: one cold read and one update of the slot holding the hash and its cycle (5,000), and their warm repeats. The commit of a plain move costs 108,461 (94,779 optimised). The rest:

- **The transaction**, 22,116: intrinsic 21,000 and calldata 1,116.
- **Dispatch**, 11,431: the proxy reads its implementation slot (2,100) and delegates to the router, which looks the selector up and delegates to the `Commit` route (two `DELEGATECALL`s to cold addresses, 2,600 each), with the calldata copied at each hop.
- **The base's bookkeeping**, about 20,000: reading the clock (two cycle-state slots, 5,900), counting the commit in the cycle's tally (5,500) and checking the army is waited for (`isWaitedFor`, 2,100), reading the reserve the bond is checked against (2,100), reading the bond slot and writing the same zero back (2,200), and the event (2,012).
- **The game's checks on who may commit**, about 25,000 of storage: `_playerOf` resolves the army's owner through capture loops (`_ownerOf`), which reads the army record (four slots, 10,100) and the square its king stands on (all four slots, 10,100); `_isDead` walks the captures and asks whether the army exited and whether its deployment landed (the spawn record, two slots, 4,400); `_isFrozen` reads the commitment again (warm).
- **Compute**, 24,188 (13,106 optimised), of which `_playerOf` and `_isDead` are most (26,433 and 20,343 inclusive of their storage on the test build).

## What could be cut, ranked

Estimates are per transaction, from the slots above; "measured" means it is the arithmetic of slots the profile saw, "estimated" means it depends on code not written yet.

1. **A square record in one slot, with a compact army index (lean rules' storage task): about 45,000 to 55,000 per plain reveal, 6,000 per commit (measured).** With 32-bit indices for the standing, arriving and king armies, the packed slot holds everything (160 + 96 bits today, exactly full; 128 + 96 once `forward`, `moved` and the two arriving facings go). A written square then costs what its packed slot costs today, about 25,000 fresh and 10,000 to 16,000 touched, instead of about 51,000 and 35,000 net: about 54,000 saved on a fresh move and about 50,000 on a touched one, minus the cost of turning an index back into an army id (a cold read per distinct army a reveal resolves, about 2,100 for the mover, 4,200 when the destination holds an enemy). The commit's read of the king's square drops from four slots to one. It is the largest single cut, and it removes the churn that makes a touched square almost as dear as a fresh one.
2. **Compute, about 40,000 to 125,000 optimised per reveal: perhaps a quarter of it (estimated).** Most is spent re-deriving the same facts per square read: the covering spawn point, its spiral index and layout (`_laidAt`, `_spawnCovering`, `layoutAt`), and `_exited` for each occupied square. The squares of a move almost always share one spawn point and one army, so computing those once per reveal, and dropping the facing (lean rules), should save something like 10,000 on a pawn or slider and 25,000 to 30,000 on a king step. Lean rules also removes `_walk` and the loop checks. Its vanish check adds about 4,200 per distinct foreign army on a square a reveal reads.
3. **The zone index write: 5,000 per fresh square, 22,100 plus a roster read (2,100) on a zone's first touch, nothing on touched squares (measured).** Measured here: 22,300 on the pawn's first step (zone 0's first touch) and 27,100 on the queen's (a new zone and a fresh square of zone 0). It serves only the viewport read (`getPieces`), so it could go if that read found records another way (by the spawn points in view, plus a per-zone flag written once, or off-chain from the move events): about 5,000 to 10,000 on a piece's first move and 22,000 on a zone's first touch.
4. **Dropping `forward` and `moved` (lean rules): no storage saved by itself (measured), a little compute (estimated, under 3,000).** Both live in the packed slot, so removing them changes no write. What they buy is the room that lets item 1 fit with margin, and three fewer fields copied per square read.
5. **The army record, four slots read by every reveal and every commit: 4,200 each (measured), once lean rules removes `capturedInto` and `loopedIn`.** Lean rules adds the cycle a king fell in and its captor; packed into the king's slot (as a cycle and a 32-bit index) the record reads two slots instead of four. The king's first move also writes its slot from zero (20,000, the king fresh column's 31,700); that is paid once per army.
6. **The spawn record's separate army slot: 2,100 per reveal and per commit (measured).** `_laidAt` reads both slots of the spawn record of every square it lays out; a compact index in the packed slot (lean rules) makes it one.
7. **The commit's checks: about 15,000 (estimated) after items 1, 5 and 6.** Without capture loops (lean rules) `_ownerOf` is the army record's owner, and `_isDead` needs only the army record and one slot of the king's square. The base's own bookkeeping (tally and waited-for, about 7,000 per commit and 5,000 per reveal; the bond slot rewritten with the value it holds, 100) is the framework's, upstream in `template-commit-reveal`, and is left alone here.
8. **Dispatch: 9,359 per reveal, 11,431 per commit (measured).** The price of the proxy and the router: an implementation read and two cold delegate calls. It buys upgradability and routes that fit the size limit; removing it is an architecture change, not an optimisation.
9. **The capture candidate push: nothing on a plain move; about 45,200 when a king meets a piece (two fresh slots, `GasBudget.test.ts`).** Lean rules keeps the list (an exit payout needs it). Pushing compact indices, eight to a slot, would make a later push of the same captor about 5,000 instead of 22,100.

The intrinsic 21,000 and the calldata (1,100 to 1,500) are fixed per transaction. Several pieces per move (`work/notes/ideas/king-chase-table-modes.md`) shares them, the dispatch, the base's bookkeeping and the events (together about 51,000 per reveal) across its pieces, and pays the square records and the compute per piece.

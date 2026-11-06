# Where the gas of a plain move goes

Measured by `lean-rules-one-slot-square-record-and-tight-gas-limits` (2026-11-07), on the `test` network (EDR, `evmVersion: london`), by `contracts/test/js/GasProfile.test.ts`, with the folding in `contracts/test/js/utils/gas-profile.ts` and `utils/gas-functions.ts`. The raw output of that run, every slot of every transaction included, is in `docs/spikes/lean-rules-one-slot-square-record-and-tight-gas-limits/default-build.txt` (the test build) and `production-build.txt` (the optimised build); `before-default-build.txt` and `before-production-build.txt` are the same scene measured just before that task, on the four-slot square record. The first profile (`gas-profile-of-a-plain-move`, commit `a9ae76a`, 2026-11-06, on the old 6 by 4 board) is kept in `docs/spikes/gas-profile-of-a-plain-move/`.

To reproduce, from `contracts/`:

```sh
pnpm hardhat --network test test nodejs test/js/GasProfile.test.ts
GAS_PROFILE=slots,functions pnpm hardhat --network test test nodejs test/js/GasProfile.test.ts
GAS_PROFILE=slots pnpm hardhat --build-profile production --network test test nodejs test/js/GasProfile.test.ts
```

The first prints the buckets of every transaction; `slots` adds every storage slot each one read or wrote, with what it cost; `functions` adds the Solidity functions the gas was spent in (meaningful on the test build only: the optimiser inlines, and its jumps no longer say which function they enter). The production run recompiles `artifacts/` with the optimiser; the next plain `pnpm test` recompiles them back.

## How it is measured

`profileTransaction` reads the node's struct-log trace (`debug_traceTransaction`) and books every step's own cost (the gas left before it minus the gas left after it; a call's child frame is subtracted from the call) to the contract whose code ran and to a bucket. Storage operations are booked to the slot they touch, and each slot is named from the hashes the transaction itself computed: the profile shadows the scratch space Solidity hashes mapping keys in, keeps a preimage only when its hash is the one the EVM pushed, and names the base slot from the compiled storage layout or the ERC-7201 namespaces of the commit-reveal base and of delegation. Before it reports anything it checks that intrinsic + execution - refund is the receipt's `gasUsed`, exactly.

The buckets: `intrinsic` (the 21,000 every transaction pays) and `calldata` (4 per zero byte, 16 per other); `dispatch` (everything that runs in the proxy and the router, including their `DELEGATECALL`s and the proxy's read of its implementation slot); one bucket per group of storage (the commit-reveal base's commitment, reserve, attendance, cycle state and roster; the game's square records, spawn records, zone index, army record, army list, ...); `events`; `hashing` (KECCAK256, mostly mapping slots); `calls out`; and `compute`, every other opcode the game's routes ran.

Storage is priced by EIP-2929/3529: a cold read 2,100 and a warm one 100; a write that makes a zero slot non-zero 20,000, a write that changes a non-zero slot 2,900, a write of the value already there (or to a slot already written this transaction) 100, each plus 2,100 if the slot was cold; clearing a slot refunds 4,800, capped at a fifth of the transaction.

## The scene

The first army of the shipped world, deployed on (0,0), alone, one move a cycle, nothing to settle (the 5 by 5 army of `docs/adr/0015`):

```
y= 2  . P P P .     x = -2 .. 2
y= 1  P R N B P
y= 0  P Q K . P
y=-1  P B N R P
y=-2  . P P P .
```

- **pawn**: (0,2) to (0,3), its first step ("fresh": neither square has a record); later (0,3) to (0,4) after a knight has stood on (0,4) and left ("touched": both squares have a record of an earlier cycle, which the move folds).
- **slider**: the bishop (1,1) to (8,8) down the open diagonal, 7 squares, then back. Its path squares are only read, never touched, so the path is fresh both ways. (8,8) is on the footprint of the spawn point (9,9), so the move also writes that spawn record's `arrivedIn` (the deployment-collision rule), from zero the first time.
- **king**: (0,0) into its empty core square (1,0), then back.
- **commit**: the commitment of the king's return, a cycle after several moves; the army's first commit after its deployment costs 83,105 (73,441 optimised) and differs only in reading a king's square with no record.
- **deployment**: the first ever, commit and reveal, every slot cold.

`GasBudget.test.ts` logs different figures because its scene is the budget's worst case: the last spawn point of the open set, a king stepping into a zone nobody touched, a slider over seven squares holding stale facts, and the captures. This profile is of the ordinary case.

## The breakdown

Gas per bucket. Storage is the test build's; the optimised build's storage differs only by repeated warm reads it drops (a few hundred gas per transaction, see the raw output). Compute is given for both builds.

| | commit | pawn fresh | pawn touched | slider fresh | slider touched | king fresh | king touched | deploy commit | deploy reveal |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| intrinsic (21000) | 21,000 | 21,000 | 21,000 | 21,000 | 21,000 | 21,000 | 21,000 | 21,000 | 21,000 |
| calldata | 1,116 | 1,400 | 1,400 | 1,424 | 1,424 | 1,388 | 1,388 | 1,188 | 1,376 |
| dispatch: proxy + router | 9,102 | 11,446 | 11,446 | 11,446 | 11,446 | 11,446 | 11,446 | 9,102 | 16,643 |
| commit-reveal: attendance | 7,600 | 5,200 | 5,200 | 5,200 | 5,200 | 5,200 | 5,200 | 67,100 | 5,200 |
| commit-reveal: commitment | 7,800 | 7,400 | 7,400 | 7,400 | 7,400 | 7,400 | 7,400 | 46,800 | 10,200 |
| commit-reveal: cycle state | 5,300 | 4,600 | 4,600 | 4,600 | 4,600 | 4,600 | 4,600 | 5,900 | 4,600 |
| commit-reveal: reserve | 2,100 |  |  |  |  |  |  | 27,200 |  |
| commit-reveal: roster |  | 2,500 |  | 2,500 |  |  |  | 2,500 |  |
| game: army count |  |  |  |  |  |  |  | 22,200 |  |
| game: army list |  | 2,100 | 2,200 | 2,200 | 2,400 | 2,300 | 2,600 | 44,300 |  |
| game: army record | 5,600 | 4,900 | 4,900 | 4,900 | 4,900 | 25,400 | 8,500 | 22,700 | 5,500 |
| game: open spawn set |  |  |  |  |  |  |  |  | 89,700 |
| game: spawn records | 2,400 | 2,400 |  | 25,300 | 8,200 | 5,600 | 5,600 |  | 37,700 |
| game: square records | 2,400 | 46,500 | 15,800 | 59,100 | 28,400 | 61,400 | 32,600 |  | 44,100 |
| game: zone index |  | 22,300 |  | 27,100 |  | 5,200 |  |  |  |
| events | 2,012 | 2,268 | 2,268 | 2,268 | 2,268 | 2,268 | 2,268 | 8,935 | 4,024 |
| hashing | 462 | 900 | 726 | 1,356 | 1,260 | 1,392 | 1,332 | 708 | 1,614 |
| calls out |  |  |  |  |  |  |  |  | 100 |
| compute (test build) | 17,082 | 50,241 | 43,077 | 121,280 | 117,004 | 118,537 | 123,962 | 21,252 | 59,317 |
| compute (production build) | 8,813 | 29,871 | 26,061 | 70,715 | 69,088 | 77,027 | 80,696 | 10,691 | 36,354 |
| refund |  |  |  |  |  |  |  | -4,800 | -4,800 |
| **total, test build** | **83,974** | **185,155** | **120,017** | **297,074** | **215,502** | **273,131** | **227,896** | **296,085** | **296,274** |
| **total, production build** | **74,105** | **163,949** | **101,329** | **245,637** | **165,842** | **230,713** | **182,214** | **283,188** | **272,511** |

`game: army list` is new: it is `_armyIds`, read to turn an army's compact index back into its id (one cold read per distinct army a reveal meets, then 100 a time). The touched moves have no refund any more: a fold no longer clears army-id slots, because there are none.

No plain move notes a capture candidate (`_capturesBy`): that list is only pushed when a king meets a piece, and is priced in `GasBudget.test.ts`.

### Against the first profile, and change by change

Totals, test build, on the same kinds of move. The first profile was measured on the old 6 by 4 board, so its column is the old scene; "before" is this scene just before the storage task; then each change of `lean-rules-one-slot-square-record-and-tight-gas-limits` in turn.

| | commit | pawn fresh | pawn touched | slider fresh | slider touched | king fresh | king touched |
|---|---:|---:|---:|---:|---:|---:|---:|
| first profile (2026-11-06, old board) | 108,461 | 280,885 | 211,806 | 341,361 | 287,779 | 381,824 | 379,979 |
| before (5 by 5 army, four-slot record) | 87,375 | 252,398 | 184,010 | 362,056 | 282,183 | 406,610 | 366,380 |
| 1. compact army index: square and spawn records one slot | 83,974 | 204,094 | 143,586 | 314,078 | 240,723 | 354,483 | 324,581 |
| 2. each square read once per reveal | 83,974 | 190,140 | 125,002 | 302,059 | 220,487 | 278,117 | 232,882 |
| 3. a touched square written in one store | 83,974 | 185,155 | 120,017 | 297,074 | 215,502 | 273,131 | 227,896 |
| **saved against before** | **3,401** | **67,243** | **63,993** | **64,982** | **66,681** | **133,479** | **138,484** |
| production build, before | 77,847 | 223,992 | 157,954 | 303,787 | 224,731 | 332,874 | 288,846 |
| production build, now | 74,105 | 163,949 | 101,329 | 245,637 | 165,842 | 230,713 | 182,214 |

What each change saved (test build):

1. **The compact army index** (`docs/gas.md` item 1, with items 5 and 6): about 48,000 on a fresh move, 40,000 to 42,000 on a touched one, 52,000 on the king's fresh step, 3,400 on a commit. Each army gets a 32-bit index when it is created (its place in `_armyIds`, plus one, kept in the first slot of its record), and storage names armies by it: the standing, arriving and king armies of a square record, the army of a spawn record and the army that took a stake (`capturedByIndex`). The square record and the spawn record are then one slot each, so a written square is one fresh or updated slot instead of two to four, and the commit reads one slot of the king's square and one of the spawn record. Turning an index back into an id costs a cold read of `_armyIds` per distinct army (2,100, then 100). The 256-bit id is unchanged everywhere outside storage: the base, the events, the views.
2. **Each square read once per reveal** (item 2): about 14,000 on a pawn, 12,000 to 20,000 on a slider, 76,000 to 92,000 on a king step. A reveal carries a small memory cache (`UsingGameBoard.Reads`) through the squares it reads: the covering spawn point, its deployment and its army are found once per 5 by 5 square instead of once per square read, and the vanish check's answer once per army. And the two squares a move writes are no longer read a second time: the origin's and the destination's start-of-cycle pieces were already read to judge the move, so `_touch` is handed them. Both are caches of start-of-cycle facts, which no reveal of the cycle can change, so neither can make the order of reveals matter.
3. **One store per touched square**: about 5,000 per move. The compiler writes a struct field by field even in one slot (nine stores on the test build, five optimised); `_storeSquare` packs the record and writes it once, at the offsets `test/js/StorageLayout.test.ts` pins.

### A square record, slot by slot

The record is one slot: `cycle`, `kind`, `departed`, `arrivals`, `kingArrived`, `arriverKind`, and the three army indices (`armyIndex`, `arriverIndex`, `kingIndex`), 224 bits. What the two squares a move touches cost (test build; every read and write of the record's slots, refunds in brackets; "before" is `before-default-build.txt`):

| square | before (four slots) | now |
|---|---:|---:|
| pawn fresh, origin (0,2) | 49,900 | 22,200 (one fresh write) |
| pawn fresh, destination (0,3) | 50,400 | 22,200 |
| pawn touched, origin (0,3) | 38,700 (-4,800) | 7,000 (one update) |
| pawn touched, destination (0,4) | 38,500 (-4,800) | 6,700 |
| king touched, destination (0,0) | 38,500 (-4,800) | 6,700 |
| king touched, origin (1,0) | 44,100 (-4,800) | 9,100 |

Every other square a move reads costs one cold read of the slot, 2,100: the 6 path squares of the slider, the neighbours of the king's destination, and the mover's own king square, which every reveal and every commit reads to ask whether the army is still standing (`_fellIn`). The warm reads on a written square are the fold's and the settle's reads of its fields.

### The army record

Three slots, laid out by who reads them: the first (`owner`, `deployCycle`, `spawnIndexPlusOne`, `index`) and the second (the king's last move and the flags) are what a reveal and a commit read; the third (`capturedByIndex`, `fellIn`) is read only by a capture's fold, an exit's payout and the stake views. `deployCycle` is 32 bits so that the index fits the first slot. Creating an army writes the first slot only (the others start at zero), which is why the deployment commit's army record is 22,700 rather than 31,100. The king's first move writes the second slot from zero (20,000, the king fresh column's 25,400), once per army.

### Where the compute goes

On the test build (`GAS_PROFILE=functions`), inclusive of storage, the king step back onto its square (227,896) spends 98,761 in `_squareAt` over the 10 squares it reads (44,153 in `_laidAt`, 22,602 of it laying the piece out, `ChessRules.layoutAt`, and only 8,206 finding the covering spawn point, `_spawnCovering`, which was 53,339 before), 24,916 in `ChessRules.moveSquares`, 22,639 settling the touched squares' facts, 14,839 in `ChessRules.isLegalMove`, 7,690 in `_touch` and 50,369 in compiler-generated helpers (memory struct copies, checked arithmetic, cleanups). The optimiser removes about 40% of the compute; the shape stays.

## What the commit spends beyond storing a hash

Storing the hash is about 5,600: one cold read and one update of the slot holding the hash and its cycle (5,000), and their warm repeats. The commit of a plain move costs 83,974 (74,105 optimised). The rest:

- **The transaction**, 22,116: intrinsic 21,000 and calldata 1,116.
- **Dispatch**, 9,102: the proxy reads its implementation slot (2,100) and delegates to the router, which looks the selector up and delegates to the `Commit` route, with the calldata copied at each hop.
- **The base's bookkeeping**, about 20,000: reading the clock (two cycle-state slots, 5,300), counting the commit in the cycle's tally and checking the army is waited for (7,600), reading the reserve the bond is checked against (2,100), reading the bond slot and writing the same zero back (2,200), and the event (2,012).
- **The game's checks on who may commit**, 10,400 of storage (25,000 on the first profile): `_playerOf` reads the army record's first slot (the owner); `_isDead` reads its second (the flags and the king's last move), the spawn record (one slot) to know its deployment landed, and the one slot of its king's square; `_isFrozen` reads the commitment again (warm).
- **Compute**, 17,082 (8,813 optimised), of which `_isDead` is most (17,996 inclusive of its storage on the test build).

## What could still be cut, ranked

Estimates are per transaction, from the slots above; "measured" means it is the arithmetic of slots the profile saw, "estimated" means it depends on code not written yet. Items 1, 2, 5, 6 and 7 of the first profile's list are done (above); what remains:

1. **The zone index write: 5,000 per fresh square, 22,100 plus a roster read (2,100) on a zone's first touch, nothing on touched squares (measured).** 22,300 on the pawn's first step (zone 0's first touch) and 27,100 on the bishop's (a new zone and a fresh square of zone 0). Now that a square record is one slot, it is as dear as the record itself on a fresh square. It serves only the viewport read (`getPieces`) and a table's count at the cap, so it could go if those found records another way (by the spawn points in view, plus a per-zone flag written once, or off-chain from the move events): about 5,000 to 10,000 on a piece's first move and 22,000 on a zone's first touch. It needs a design of its own (left out of the storage task on purpose).
2. **Compute, about 30,000 to 80,000 optimised per reveal (measured): perhaps a fifth of it (estimated).** What is left is mostly the move rule itself (`moveSquares`, `isLegalMove`), laying a deployed piece out per square read (`layoutAt`), settling a touched square's facts, and the compiler's memory copies of `Piece` structs. A king step reads 10 squares, so a cheaper square read is still worth something there.
3. **The arrival mark on a footprint: 20,000 the first time a move lands on another spawn point's footprint (measured, the slider's 25,300).** `_markArrival` writes `arrivedIn` so that a deployment revealed later in the cycle still sees the arrival (`docs/adr/0002`). It is part of the deployment-collision rule, not a storage layout choice, so it stays.
4. **Dispatch: 11,446 per reveal, 9,102 per commit (measured).** The price of the proxy and the router: an implementation read and two cold delegate calls. It buys upgradability and routes that fit the size limit; removing it is an architecture change, not an optimisation.
5. **The capture candidate push: nothing on a plain move; two fresh slots (about 45,000) when a king meets a piece (`GasBudget.test.ts`).** Lean rules keeps the list (an exit payout needs it). Pushing compact indices, eight to a slot, would make a later push by the same captor about 5,000 instead of 22,100. Left alone: it is off the plain move's path.
6. **The base's own bookkeeping** (tally and waited-for, about 7,600 per commit and 5,200 per reveal; the bond slot rewritten with the value it holds, 100) is the framework's, upstream in `template-commit-reveal`, and is left alone here.

The intrinsic 21,000 and the calldata (1,100 to 1,500) are fixed per transaction. Several pieces per move (`work/notes/ideas/king-chase-table-modes.md`) shares them, the dispatch, the base's bookkeeping and the events (together about 51,000 per reveal) across its pieces, and pays the square records and the compute per piece.

## The declared figures

`pnpm test` compiles the `default` profile, which has no optimiser, and `GasBudget.test.ts` measures that build; `pnpm deploy` compiles `production` (optimiser, 999,999 runs). The same transactions cost 4% (a first deployment commit) to 23% (a touched slider) less in the build a chain runs, all of it compute, so `commitGas` and `revealGas` carry more headroom on a real chain than the test says, which is the safe direction.

`contracts/rocketh/config.ts` declares each figure as the worst case `GasBudget.test.ts` builds plus its minimum headroom (10%), rounded up to ten thousand: `COMMIT_GAS` 410,000 (the worst commit, a first paid deployment commit in a manual world, 368,249), `REVEAL_GAS` 770,000 (the worst reveal, a king's move folding two two-victim squares among 8 fallen armies' pieces and noting three candidates for a stake, 695,871) and `LOBBY_REVEAL_GAS` 840,000 (the worst table reveal, 760,730).

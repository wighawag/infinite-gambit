# Where the gas of a plain move goes

Measured by `three-piece-moves-gas-limits` (2026-11-07), on the `test` network (EDR, `evmVersion: london`), by `contracts/test/js/GasProfile.test.ts`, with the folding in `contracts/test/js/utils/gas-profile.ts` and `utils/gas-functions.ts`. A move is now up to three piece-moves (`docs/adr/0016-an-army-moves-up-to-three-pieces-a-cycle-simultaneously.md`), so the profile measures each kind of piece-move alone and then a pawn, a slider and the king as one move. The raw output of that run, every slot of every transaction included, is in `docs/spikes/three-piece-moves-gas-limits/default-build.txt` (the test build), `production-build.txt` (the optimised build) and `default-build-functions.txt` (the test build's functions). The profile before it, of one piece-move a reveal on the one-slot square record (`lean-rules-one-slot-square-record-and-tight-gas-limits`, 2026-11-07), is kept in `docs/spikes/lean-rules-one-slot-square-record-and-tight-gas-limits/` with the four-slot record it replaced (`before-*.txt`); the first profile (`gas-profile-of-a-plain-move`, commit `a9ae76a`, 2026-11-06, on the old 6 by 4 board) is in `docs/spikes/gas-profile-of-a-plain-move/`.

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
- **three piece-moves**: on a fresh copy of the scene, the pawn, the bishop and the king moves above as ONE move, (0,2) to (0,3), (1,1) to (8,8) and (0,0) to (1,0), every square fresh; then all three back, (0,3) to (0,2), (8,8) to (1,1) and (1,0) to (0,0), every origin and destination touched (the bishop's path is only read, so it is fresh both ways).
- **commit**: the commitment of the king's return, a cycle after several moves; the army's first commit after its deployment costs 84,954 (75,290 optimised) and differs only in reading a king's square with no record. A commit stores a hash, so the first commit of the three piece-moves costs exactly that too.
- **deployment**: the first ever, commit and reveal, every slot cold.

`GasBudget.test.ts` logs different figures because its scene is the budget's worst case: the last spawn point of the open set, a king's first step beside two sliders each over seven squares holding stale facts, and the captures. This profile is of the ordinary case.

## The breakdown

Gas per bucket. Storage is the test build's; the optimised build's storage differs only by repeated warm reads it drops (a few hundred gas per transaction, 4,760 on the touched three piece-moves, see the raw output). Compute is given for both builds. The single moves cost a little more than on the one-slot record's profile (about 1,700 a reveal, 1,849 a commit): a commit's dispatch is 1,849 dearer through the vendored router that routes past 48 selectors (`contracts/src/vendor/router/Router10X60.sol`), a reveal's only 48, and a reveal's compute is about 1,650 more, mostly `ChessRules.vacatedBy` (1,173), which checks the cap and the refusals of a move (`docs/adr/0016`).

| | commit | pawn fresh | pawn touched | slider fresh | slider touched | king fresh | king touched | three fresh | three touched | deploy commit | deploy reveal |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| intrinsic (21000) | 21,000 | 21,000 | 21,000 | 21,000 | 21,000 | 21,000 | 21,000 | 21,000 | 21,000 | 21,000 | 21,000 |
| calldata | 1,116 | 1,400 | 1,400 | 1,424 | 1,424 | 1,388 | 1,388 | 1,972 | 1,972 | 1,188 | 1,376 |
| dispatch: proxy + router | 10,951 | 11,494 | 11,494 | 11,494 | 11,494 | 11,494 | 11,494 | 11,542 | 11,542 | 10,951 | 17,808 |
| commit-reveal: attendance | 7,600 | 5,200 | 5,200 | 5,200 | 5,200 | 5,200 | 5,200 | 5,200 | 5,200 | 67,100 | 5,200 |
| commit-reveal: commitment | 7,800 | 7,400 | 7,400 | 7,400 | 7,400 | 7,400 | 7,400 | 7,400 | 7,400 | 46,800 | 10,200 |
| commit-reveal: cycle state | 5,300 | 4,600 | 4,600 | 4,600 | 4,600 | 4,600 | 4,600 | 4,600 | 4,600 | 5,900 | 4,600 |
| commit-reveal: reserve | 2,100 |  |  |  |  |  |  |  |  | 27,200 |  |
| commit-reveal: roster |  | 2,500 |  | 2,500 |  |  |  | 3,000 |  | 2,500 |  |
| game: army count |  |  |  |  |  |  |  |  |  | 22,200 |  |
| game: army list |  | 2,100 | 2,200 | 2,200 | 2,400 | 2,300 | 2,600 | 2,400 | 3,000 | 44,300 |  |
| game: army record | 5,600 | 4,900 | 4,900 | 4,900 | 4,900 | 25,400 | 8,500 | 25,800 | 8,900 | 22,700 | 5,500 |
| game: open spawn set |  |  |  |  |  |  |  |  |  |  | 89,700 |
| game: spawn records | 2,400 | 2,400 |  | 25,300 | 8,200 | 5,600 | 5,600 | 28,900 | 9,000 |  | 37,700 |
| game: square records | 2,400 | 46,500 | 15,800 | 59,100 | 28,400 | 61,400 | 32,600 | 158,900 | 68,700 |  | 44,100 |
| game: zone index |  | 22,300 |  | 27,100 |  | 5,200 |  | 45,000 |  |  |  |
| events | 2,012 | 2,268 | 2,268 | 2,268 | 2,268 | 2,268 | 2,268 | 2,268 | 2,268 | 8,935 | 4,024 |
| hashing | 462 | 900 | 726 | 1,356 | 1,260 | 1,392 | 1,332 | 2,922 | 2,676 | 708 | 1,614 |
| calls out |  |  |  |  |  |  |  |  |  |  | 100 |
| compute (test build) | 17,082 | 51,885 | 44,722 | 122,927 | 118,652 | 120,225 | 125,651 | 271,367 | 272,321 | 21,252 | 59,317 |
| compute (production build) | 8,813 | 31,152 | 27,342 | 71,998 | 70,370 | 78,224 | 81,891 | 171,047 | 173,399 | 10,691 | 36,354 |
| refund |  |  |  |  |  |  |  |  |  | -4,800 | -4,800 |
| **total, test build** | **85,823** | **186,847** | **121,710** | **298,769** | **217,198** | **274,867** | **229,633** | **592,271** | **418,579** | **297,934** | **297,439** |

`game: army list` is `_armyIds`, read to turn an army's compact index back into its id (one cold read per distinct army a reveal meets, then 100 a time). The touched moves have no refund any more: a fold no longer clears army-id slots, because there are none.

No plain move notes a capture candidate (`_capturesBy`): that list is only pushed when a king meets a piece, and is priced in `GasBudget.test.ts`.

### A move of three piece-moves

The pawn, the bishop and the king moved as ONE move cost 592,271 fresh and 418,579 touched (490,407 and 314,897 optimised). Moved as three single moves, the same piece-moves cost 760,483 and 568,541 (644,004 and 453,087 optimised): one reveal of three saves 168,212 fresh and 149,962 touched (153,597 and 138,190 optimised), about a quarter. What a reveal pays once whatever it holds (test build, fresh, against the three singles):

| shared once per reveal | saved |
|---|---:|
| intrinsic (21,000 a transaction) | 42,000 |
| dispatch: proxy + router | 22,940 |
| commit-reveal: commitment, attendance, cycle state (the base's chunk and tally) | 34,400 |
| events (the one reveal event) | 4,536 |
| calldata (one transaction's head) | 2,240 |
| game: army record, army list, roster (the mover read once) | 15,600 |
| game: spawn records, square records (the mover's own king square and the covering spawn points read once, `Reads`) | 12,500 |
| game: zone index (zone 0's first touch, shared by the pawn and the bishop) | 9,600 |
| hashing and compute (one dispatch, one chunk opened and closed, one cache) | 24,396 |
| **total** | **168,212** |

What three piece-moves add that one does not is the legality-only mask (`docs/adr/0016`): `ChessRules.vacate` reads the army's own vacated squares as empty for the rule, 7,803 fresh and 7,138 touched, and `ChessRules.vacatedBy` checks the cap and the refusals (no piece twice, no two to one square) over the three, 5,224 where one piece-move costs 1,173. Together about 11,000 to 12,000 a three-piece-move reveal, nothing on a single piece-move (`vacate` returns at once). Everything else is paid per piece-move, as on a single move: the squares it reads and writes, the arrival mark, the move rule.

So a player who moves three pieces pays about three times the per-piece cost and once the transaction, and the cost of a move grows with the pieces it moves rather than jumping: one piece 186,847 to 298,769, three 418,579 to 592,271 on this scene. What the declared limit is priced on, the worst three-piece-move reveal, is far above either (`The declared figures`, below).

### Against the first profile, and change by change

Totals, test build, on the same kinds of move. The first profile was measured on the old 6 by 4 board, so its column is the old scene; "before" is this scene just before the storage task; then each change of `lean-rules-one-slot-square-record-and-tight-gas-limits` in turn; "now" is this profile, single piece-moves, after the vendored router and the three piece-moves rule (above).

| | commit | pawn fresh | pawn touched | slider fresh | slider touched | king fresh | king touched |
|---|---:|---:|---:|---:|---:|---:|---:|
| first profile (2026-11-06, old board) | 108,461 | 280,885 | 211,806 | 341,361 | 287,779 | 381,824 | 379,979 |
| before (5 by 5 army, four-slot record) | 87,375 | 252,398 | 184,010 | 362,056 | 282,183 | 406,610 | 366,380 |
| 1. compact army index: square and spawn records one slot | 83,974 | 204,094 | 143,586 | 314,078 | 240,723 | 354,483 | 324,581 |
| 2. each square read once per reveal | 83,974 | 190,140 | 125,002 | 302,059 | 220,487 | 278,117 | 232,882 |
| 3. a touched square written in one store | 83,974 | 185,155 | 120,017 | 297,074 | 215,502 | 273,131 | 227,896 |
| now (three piece-moves rule, single piece-moves) | 85,823 | 186,847 | 121,710 | 298,769 | 217,198 | 274,867 | 229,633 |
| **saved against before** | **1,552** | **65,551** | **62,300** | **63,287** | **64,985** | **131,743** | **136,747** |
| production build, before | 77,847 | 223,992 | 157,954 | 303,787 | 224,731 | 332,874 | 288,846 |
| production build, after the storage task | 74,105 | 163,949 | 101,329 | 245,637 | 165,842 | 230,713 | 182,214 |
| production build, now | 75,954 | 165,278 | 102,658 | 246,968 | 167,172 | 231,758 | 183,257 |

What each change of the storage task saved (test build):

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

On the test build (`GAS_PROFILE=functions`), inclusive of storage, the king step back onto its square (227,896) spends 98,761 in `_squareAt` over the 10 squares it reads (44,153 in `_laidAt`, 22,602 of it laying the piece out, `ChessRules.layoutAt`, and only 8,206 finding the covering spawn point, `_spawnCovering`, which was 53,339 before), 24,916 in `ChessRules.moveSquares`, 22,639 settling the touched squares' facts, 14,839 in `ChessRules.isLegalMove`, 7,690 in `_touch` and 50,369 in compiler-generated helpers (memory struct copies, checked arithmetic, cleanups). The optimiser removes about 40% of the compute; the shape stays. (Measured by the storage task; the raw functions of this profile are in `docs/spikes/three-piece-moves-gas-limits/default-build-functions.txt`.)

The three piece-moves back onto touched squares (418,579) spend 192,711 in `_squareAt` over the 20 squares they read (100,537 in `_laidAt`, 50,938 finding covering spawn points), 53,701 in `ChessRules.moveSquares`, 33,263 settling the touched squares' facts, 31,546 in `ChessRules.isLegalMove`, 21,717 marking arrivals, 20,346 in `_touch`, 12,362 in the mask and the refusals (`vacate`, `vacatedBy`) and 123,686 in compiler-generated helpers: three single moves' worth of the move rule, shared only where `Reads` caches a square or a spawn point.

## What the commit spends beyond storing a hash

Storing the hash is about 5,600: one cold read and one update of the slot holding the hash and its cycle (5,000), and their warm repeats. The commit of a plain move costs 85,823 (75,954 optimised), whether the move holds one piece-move or three: the commitment is one hash. The rest:

- **The transaction**, 22,116: intrinsic 21,000 and calldata 1,116.
- **Dispatch**, 10,951: the proxy reads its implementation slot (2,100) and delegates to the router, which looks the selector up and delegates to the `Commit` route, with the calldata copied at each hop. The vendored router (`contracts/src/vendor/router/Router10X60.sol`, which routes past 48 selectors) is 1,849 of it dearer than the package's was on a commit.
- **The base's bookkeeping**, about 20,000: reading the clock (two cycle-state slots, 5,300), counting the commit in the cycle's tally and checking the army is waited for (7,600), reading the reserve the bond is checked against (2,100), reading the bond slot and writing the same zero back (2,200), and the event (2,012).
- **The game's checks on who may commit**, 10,400 of storage (25,000 on the first profile): `_playerOf` reads the army record's first slot (the owner); `_isDead` reads its second (the flags and the king's last move), the spawn record (one slot) to know its deployment landed, and the one slot of its king's square; `_isFrozen` reads the commitment again (warm).
- **Compute**, 17,082 (8,813 optimised), of which `_isDead` is most (17,996 inclusive of its storage on the test build).

## What could still be cut, ranked

Estimates are per transaction, from the slots above; "measured" means it is the arithmetic of slots the profile saw, "estimated" means it depends on code not written yet. Items 1, 2, 5, 6 and 7 of the first profile's list are done (above); what remains:

1. **The zone index write: 5,000 per fresh square, 22,100 plus a roster read (2,100) on a zone's first touch, nothing on touched squares (measured).** 22,300 on the pawn's first step (zone 0's first touch) and 27,100 on the bishop's (a new zone and a fresh square of zone 0). Now that a square record is one slot, it is as dear as the record itself on a fresh square. It serves only the viewport read (`getPieces`) and a table's count at the cap, so it could go if those found records another way (by the spawn points in view, plus a per-zone flag written once, or off-chain from the move events): about 5,000 to 10,000 on a piece's first move and 22,000 on a zone's first touch. It needs a design of its own (left out of the storage task on purpose).
2. **Compute, about 30,000 to 80,000 optimised per reveal (measured): perhaps a fifth of it (estimated).** What is left is mostly the move rule itself (`moveSquares`, `isLegalMove`), laying a deployed piece out per square read (`layoutAt`), settling a touched square's facts, and the compiler's memory copies of `Piece` structs. A king step reads 10 squares, so a cheaper square read is still worth something there.
3. **The arrival mark on a footprint: 20,000 the first time a move lands on another spawn point's footprint (measured, the slider's 25,300).** `_markArrival` writes `arrivedIn` so that a deployment revealed later in the cycle still sees the arrival (`docs/adr/0002`). It is part of the deployment-collision rule, not a storage layout choice, so it stays.
4. **Dispatch: 11,494 per reveal (11,542 for three piece-moves), 10,951 per commit (measured).** The price of the proxy and the router: an implementation read and two cold delegate calls. It buys upgradability and routes that fit the size limit; removing it is an architecture change, not an optimisation.
5. **The capture candidate push: nothing on a plain move; two fresh slots (about 45,000) when a king meets a piece (`GasBudget.test.ts`).** Lean rules keeps the list (an exit payout needs it). Pushing compact indices, eight to a slot, would make a later push by the same captor about 5,000 instead of 22,100. Left alone: it is off the plain move's path.
6. **The base's own bookkeeping** (tally and waited-for, about 7,600 per commit and 5,200 per reveal; the bond slot rewritten with the value it holds, 100) is the framework's, upstream in `template-commit-reveal`, and is left alone here.

The intrinsic 21,000 and the calldata (1,100 to 2,000) are fixed per transaction. A move of three piece-moves shares them, the dispatch, the base's bookkeeping and the events across its pieces, and pays the square records and the compute per piece: measured above (`A move of three piece-moves`), about 75,000 to 84,000 a reveal saved for each piece-move past the first.

## The declared figures

`pnpm test` compiles the `default` profile, which has no optimiser, and `GasBudget.test.ts` measures that build; `pnpm deploy` compiles `production` (optimiser, 999,999 runs). The same transactions cost 4% (a first deployment commit) to 25% (the touched three piece-moves) less in the build a chain runs, almost all of it compute, so `commitGas` and `revealGas` carry more headroom on a real chain than the test says, which is the safe direction.

THE FIGURES ARE MEASURED UNDER AMSTERDAM, and everything else on this page is not. Amsterdam carries EIP-8037, which prices new state per byte: a slot written from zero is 64 state bytes at 1,530 gas, about 108,000 with its access where the breakdown above says 22,100, and a value sent to a fresh account pays 120 bytes (183,600) for creating it. Sepolia runs it, and the figures this section used to declare (a commit of 410,000, measured under the older pricing) made every first deployment commit there run out of gas on 2026-11-07: the trace shows each fresh slot at 108,020, and the same call estimates at 1,442,013 on Sepolia. So `GasBudget.test.ts` connects with the hardfork overridden to `amsterdam` (`MEASURED_HARDFORK`), whatever the rest of the suite runs on. The profile above is still the older pricing (`GasProfile.test.ts` does not run under Amsterdam: EIP-2780 changes the intrinsic cost its accounting checks, and the state gas sits outside the gas left it reads), so its buckets show where the gas goes and not what Sepolia charges for it: on Sepolia every fresh slot in them costs about five times as much.

`contracts/rocketh/config.ts` declares each figure as the worst case `GasBudget.test.ts` builds under Amsterdam plus TWENTY per cent, rounded up to ten thousand. Twenty rather than the test's minimum ten because the simulator marks Amsterdam experimental and does not price exactly as Sepolia does: the first commit paying a fresh payee measures 1,387,394 under it against Sepolia's estimate of 1,442,013, about 4% under.

- `COMMIT_GAS` 1,930,000 (was 410,000): the worst commit is a first paid deployment commit in a manual world, 1,602,858 (370,098 under the older pricing). A first deployment commit paying nobody is 1,186,654, and one paying a reveal scheduler a fresh account 1,387,394. A commit stores a hash, whatever the move holds, but a first deployment creates the army's records and the payee's account.
- `REVEAL_GAS` 3,090,000 (was 2,020,000). The worst reveal is a move of three piece-moves, each as dear as the rules allow: the dearest plain move `GasBudget.test.ts` plays (the king's first step and two 7-square sliders over stale squares, 1,206,674), with each piece-move folding a two-victim square at its origin and at its destination and noting three candidates for a stake (340,910 a piece-move in all), and each of the 22 squares it reads meeting a piece of a different fallen army not folded yet (15,600 each, the vanish check, cold): 2,572,604. It is an upper bound rather than a scene: three piece-moves share one cache of start-of-cycle facts, and a captor's list is fresh once.
- `LOBBY_REVEAL_GAS` 3,380,000 (was 2,100,000): the world's worst plus listing six zones, since a move touches up to six squares (243,787), 2,816,391.

THE GENEROSITY CEILING STAYS THREE, against the dearest plain transaction: the world's three-piece-move reveal 1,206,674 (three times is 3,620,022), a table's 1,450,461 (4,351,383), and a first deployment commit 1,186,654 (3,559,962). Every figure sits well inside its window, so the narrow window this section used to warn about is gone: the state cost is most of every figure and scales the worst and the plain move alike.

### The table's options, read on every reveal

A table chooses three piece-moves or one through one bit of the framework's `gameOptions` (`docs/adr/0016`, `ChessRules.ONE_PIECE_MOVE`), and the reveal caps a move by it (`ChessRules.maxPieceMovesOf`). So every reveal, in the worlds (which read zero) and at every table, reads the base's `gameOptions` slot: one cold read, 2,100, and the bit test, 3,030 a reveal on the test build in all (every plain reveal of the profile above, single piece-moves and three alike, is that much dearer than the breakdown's figures, which predate it) and 2,906 on the production build (the pawn's fresh step 168,184 where it was 165,278). A table's plain three-piece-move reveal rose 2,306, to 745,921. Seating at a table reads the same slot once more, to refuse a table whose options carry any other bit (`UsingGameTable._joinTable`); a commit reads nothing of it.

To make room for the read in the `Reveal` route (24,544 bytes of 24,576 before it), a deployment's reveal is now forwarded to its own route with the calldata as is, only the selector changed, rather than re-encoded (`GameReveal.reveal`): the route is 24,455 bytes, and the first deployment reveal ever is 1,052 cheaper (296,387 on the profile's scene, 300,623 in `GasBudget.test.ts`'s).

What players see: `creditsGasMultiplier` is `COMMIT_GAS + REVEAL_GAS`, 5,020,000 where it was 2,430,000 (and 1,180,000 before three piece-moves), so a credit is about twice the gas and the same balance shows about half the credits, for everyone, at tables that turn three piece-moves off too. The playing key's stipend and fuzd's prepayment for a scheduled reveal are sized from `commitGas` and `revealGas` and rise with them. A plain move still spends what it costs, so a player makes more moves than their credits say, and on a chain still on the older pricing far more.

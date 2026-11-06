// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.0;

import "./UsingGameStore.sol";
import "../../utils/PositionUtils.sol";
import {ChessRules} from "./ChessRules.sol";
import {CommitReveal} from "../../commit-reveal/CommitReveal.sol";

/// @dev THE BOARD, RESOLVED FROM FACTS
///      (`docs/adr/0002-order-free-lazy-resolution.md`). Two kinds of fact put
///      a piece on a square: a deployment that landed over it (stored per
///      spawn point, see {UsingGameStore-SpawnRecord}), and the moves revealed
///      onto and off it (stored per square, see {UsingGameStore-SquareRecord}).
///      Neither is the board: {_squareAt} works out what stands on a square at
///      the start of a cycle from both, and nothing is written when a cycle
///      ends, because nothing runs then.
///
///      A DEPLOYMENT ONLY LANDS ON A CLEAR FOOTPRINT. If any square its layout
///      puts a piece on was occupied at the start of its cycle, or any piece
///      arrived on one during it, the whole deployment fails (and is refunded),
///      and the arriving piece lands as on any empty square. So the two kinds
///      of fact never meet on one square in one cycle: a landed army's squares
///      were empty and untouched when it landed, and its layout simply stands
///      there until a reveal touches the square.
abstract contract UsingGameBoard is UsingGameStore {
    constructor(Config memory config) UsingGameStore(config) {}

    // ------------------------------------------------------------------------
    // DEPLOYMENTS
    // ------------------------------------------------------------------------

    /// @notice Whether a deployment has LANDED on the spawn point with spiral
    ///         index `index` before `cycleNumber`, and which army it was.
    /// @dev Resolved from the accumulated record: one deployment revealed in a
    ///      cycle that is over, onto a footprint nothing blocked. The current
    ///      cycle's reveals are not on the board until it ends, so an army acts
    ///      from the cycle after its deployment and no move committed before it
    ///      can reach it.
    function _landedBefore(
        uint256 index,
        uint64 cycleNumber
    ) internal view returns (bool landed, uint256 army) {
        SpawnRecord storage spawn = _spawns[index];
        uint64 cycle = spawn.cycle;
        if (
            cycle != 0 &&
            cycle < cycleNumber &&
            spawn.count == 1 &&
            !spawn.blocked
        ) {
            return (true, _armyAt(spawn.armyIndex));
        }
        return (false, 0);
    }

    /// @notice The spawn point whose footprint can cover `position`, if any,
    ///         and its spiral index.
    /// @dev A square is covered by at most one spawn point's footprint (the
    ///      spacing is more than the footprint's width), and a footprint
    ///      reaches 2 squares from its spawn point on each axis: so the spawn
    ///      point is the one multiple of the spacing in [x-2, x+2] by
    ///      [y-2, y+2], if there is one. Whether the square is ON the
    ///      footprint (not a corner) is {ChessRules-footprintCell}'s to say.
    function _spawnCovering(
        uint64 position
    ) internal view returns (bool near, uint64 spawnPoint, uint256 index) {
        (int32 x, int32 y) = PositionUtils.toXY(position);
        int256 s = int256(uint256(SPAWN_SPACING));
        int256 i = _floorDiv(int256(x) + 2, s);
        int256 j = _floorDiv(int256(y) + 2, s);
        if (i * s < int256(x) - 2 || j * s < int256(y) - 2) {
            return (false, 0, 0);
        }
        return (
            true,
            PositionUtils.fromXY(int32(i * s), int32(j * s)),
            ChessRules.spiralIndex(i, j)
        );
    }

    /// @notice Whether every square of the footprint of a deployment at
    ///         `spawnPoint` (its 21 squares, the empty core square included)
    ///         is empty at the START of `cycleNumber`.
    /// @dev Start-of-cycle facts only, so every reveal of the cycle computes
    ///      the same answer. Only the per-square layer can occupy these
    ///      squares: no other footprint overlaps them, and this spawn point is
    ///      open, so nothing has landed on it.
    function _footprintClear(
        uint64 spawnPoint,
        uint64 cycleNumber
    ) internal view returns (bool) {
        // Square by square rather than through {ChessRules-layout}, which
        // only the board read needs: it keeps the reveal route small.
        Reads memory reads;
        for (uint256 r = 0; r < 5; r++) {
            for (uint256 c = 0; c < 5; c++) {
                if (!ChessRules.onFootprint(r, c)) continue;
                uint64 position = ChessRules.layoutSquare(spawnPoint, r, c);
                if (_squares[position].cycle == 0) continue;
                if (
                    _squareAt(position, cycleNumber, reads).kind !=
                    PieceKind.None
                ) {
                    return false;
                }
            }
        }
        return true;
    }

    /// @notice Record that a piece arrives on `position` in `cycleNumber`, for
    ///         the deployment whose footprint the square is on, if any.
    /// @dev ORDER-FREE BOTH WAYS ROUND. If a deployment has already revealed
    ///      this spawn point in this cycle, it is blocked now. Otherwise the
    ///      spawn point remembers the cycle, and the first deployment reveal of
    ///      the cycle reads it and starts out blocked. Either way the record
    ///      ends the cycle blocked, whichever reveal landed first, and nothing
    ///      ever unsets it. A square no footprint covers costs nothing.
    function _markArrival(uint64 position, uint64 cycleNumber) internal {
        (bool near, uint64 spawnPoint, uint256 index) = _spawnCovering(
            position
        );
        if (!near) return;
        (bool on, , ) = ChessRules.footprintCell(spawnPoint, position);
        if (!on) return;
        SpawnRecord storage spawn = _spawns[index];
        if (spawn.cycle == cycleNumber) {
            if (!spawn.blocked) spawn.blocked = true;
        } else if (spawn.arrivedIn != cycleNumber) {
            spawn.arrivedIn = cycleNumber;
        }
    }

    /// @notice WHAT ONE TRANSACTION HAS ALREADY WORKED OUT ABOUT THE BOARD AT
    ///         THE START OF ONE CYCLE, so that the squares of a move, which
    ///         almost always share one covering spawn point and one army, do
    ///         not each work it out again (`docs/gas.md`).
    /// @dev A CACHE OF START-OF-CYCLE FACTS ONLY, which no write of the cycle
    ///      can change: the spawn point covering the last square laid out
    ///      (the 5 by 5 square around it), the deployment that still stands
    ///      there, and whether the last army asked about had fallen before
    ///      the cycle ({_fellIn}). Valid for ONE `cycleNumber`: a fresh one
    ///      ({_squareAt} without it) for every other read. It never holds
    ///      anything a reveal of the cycle wrote: `blocked` of the current
    ///      cycle's deployment is not final yet, so a deployment revealed in
    ///      `cycleNumber` itself is never cached.
    ///
    ///      ONE PER REVEAL, shared by its up to three piece-moves
    ///      (`docs/adr/0016`), which is safe because none of their writes
    ///      changes a cached answer: a square's touch folds facts into the army
    ///      records that {_fellIn} reads them from instead, so its answer is
    ///      the same before and after; a king's piece-move leaves its own
    ///      army's answer at zero, which it was at the start (an army that
    ///      reveals has not fallen); and an arrival on a footprint only marks
    ///      a deployment of the current cycle, which is never cached.
    struct Reads {
        bool covered;
        int32 sx;
        int32 sy;
        uint64 spawnPoint;
        uint64 laidIn;
        uint256 laidArmy;
        uint256 asked;
        uint64 fell;
    }

    /// @notice The piece the deployment over `position` laid there, and the
    ///         cycle it was revealed in; kind `None` if no deployment that is
    ///         still standing alone on a clear footprint covers the square.
    /// @dev See {_spawnCovering}. A deployment of the CURRENT cycle is returned
    ///      too: the caller decides whether its cycle is over, and only then is
    ///      `blocked` final.
    function _laidAt(
        uint64 position
    ) internal view returns (Piece memory piece, uint64 cycle) {
        Reads memory reads;
        return _laidAt(position, type(uint64).max, reads);
    }

    /// @dev {_laidAt}, through `reads`, for a read at the start of
    ///      `cycleNumber`: the covering spawn point and its deployment are
    ///      looked up once per 5 by 5 square, and kept only if that
    ///      deployment's cycle is over.
    function _laidAt(
        uint64 position,
        uint64 cycleNumber,
        Reads memory reads
    ) internal view returns (Piece memory piece, uint64 cycle) {
        piece.position = position;
        uint64 spawnPoint;
        uint256 army;
        if (reads.covered && _within(position, reads.sx, reads.sy)) {
            spawnPoint = reads.spawnPoint;
            cycle = reads.laidIn;
            army = reads.laidArmy;
        } else {
            bool near;
            uint256 index;
            (near, spawnPoint, index) = _spawnCovering(position);
            if (!near) return (piece, 0);
            SpawnRecord storage spawn = _spawns[index];
            cycle = spawn.cycle;
            if (cycle != 0 && spawn.count == 1 && !spawn.blocked) {
                army = _armyAt(spawn.armyIndex);
            } else {
                cycle = 0;
            }
            if (cycle < cycleNumber) {
                (int32 sx, int32 sy) = PositionUtils.toXY(spawnPoint);
                reads.covered = true;
                reads.sx = sx;
                reads.sy = sy;
                reads.spawnPoint = spawnPoint;
                reads.laidIn = cycle;
                reads.laidArmy = army;
            }
        }
        if (cycle == 0) return (piece, 0);
        piece = ChessRules.layoutAt(spawnPoint, army, position);
        if (piece.kind == PieceKind.None) cycle = 0;
    }

    /// @dev Whether `position` is in the 5 by 5 square around (`sx`,`sy`),
    ///      which only that spawn point can cover.
    function _within(
        uint64 position,
        int32 sx,
        int32 sy
    ) private pure returns (bool) {
        (int32 x, int32 y) = PositionUtils.toXY(position);
        int256 dx = int256(x) - sx;
        int256 dy = int256(y) - sy;
        return dx >= -2 && dx <= 2 && dy >= -2 && dy <= 2;
    }

    /// @dev {_fellIn} through `reads`, which keeps the last army's answer.
    function _fellIn(
        uint256 army,
        uint64 cycleNumber,
        Reads memory reads
    ) private view returns (uint64 fell) {
        if (reads.asked == army) return reads.fell;
        fell = _fellIn(army, cycleNumber);
        reads.asked = army;
        reads.fell = fell;
    }

    // ------------------------------------------------------------------------
    // SQUARES
    // ------------------------------------------------------------------------

    /// @notice What stands on `position` at the START of `cycleNumber`.
    /// @dev The facts are applied in the order of the cycles they belong to,
    ///      and only those of cycles that are over: the record's standing piece
    ///      (already resolved up to the start of the record's cycle), then that
    ///      cycle's moves, then a deployment that landed later. A deployment
    ///      never lands in the record's own cycle (a move onto or off the square
    ///      then would have blocked it), and when it lands later the square was
    ///      empty, so its piece simply takes it.
    ///
    ///      A FALLEN ARMY'S PIECES HAVE LEFT THE BOARD: a piece of an army
    ///      whose king was taken or exited before `cycleNumber` reads as an
    ///      empty square, except a stone, which is still labelled with the
    ///      army it was (`docs/adr/0013`, `docs/adr/0014`). The facts keep the
    ///      label they were written with; nothing is rewritten when an army
    ///      falls. The check ({_fellIn}) is the army's record and its king's
    ///      square, so it is paid once per distinct army a read meets.
    function _squareAt(
        uint64 position,
        uint64 cycleNumber
    ) internal view returns (Piece memory piece) {
        Reads memory reads;
        return _squareAt(position, cycleNumber, reads);
    }

    /// @dev {_squareAt}, through `reads` ({Reads}), which must be of
    ///      `cycleNumber`.
    function _squareAt(
        uint64 position,
        uint64 cycleNumber,
        Reads memory reads
    ) internal view returns (Piece memory piece) {
        (Piece memory laid, uint64 laidIn) = _laidAt(
            position,
            cycleNumber,
            reads
        );
        bool deployed = laidIn != 0 && laidIn < cycleNumber;
        SquareRecord storage record = _squares[position];
        uint64 touched = record.cycle;
        if (touched == 0) {
            if (deployed && _fellIn(laid.army, cycleNumber, reads) == 0) {
                return laid;
            }
            return _emptyAt(position);
        }

        piece =
            touched < cycleNumber
                ? _settled(record, position, cycleNumber)
                : _standingOf(record, position);
        if (deployed && laidIn > touched) {
            piece = laid;
        }
        if (
            piece.kind != PieceKind.None &&
            piece.kind != PieceKind.Stone &&
            _fellIn(piece.army, cycleNumber, reads) != 0
        ) {
            return _emptyAt(position);
        }
    }

    /// @dev What `record`'s facts, of a cycle over before `cycleNumber`, leave
    ///      on `position` ({ChessRules-settle}).
    function _settled(
        SquareRecord storage record,
        uint64 position,
        uint64 cycleNumber
    ) private view returns (Piece memory) {
        return
            ChessRules.settle(
                _standingOf(record, position),
                record.departed,
                record.arrivals,
                _kingOf(record, position),
                _arriverOf(record, position),
                _captorFell(record, position, cycleNumber)
            );
    }

    function _emptyAt(uint64 position) private pure returns (Piece memory e) {
        e.position = position;
    }

    /// @dev The piece that stood on `position` at the start of `record`'s
    ///      cycle, as the record keeps it.
    function _standingOf(
        SquareRecord storage record,
        uint64 position
    ) internal view returns (Piece memory) {
        return
            Piece({
                position: position,
                army: _armyAt(record.armyIndex),
                kind: record.kind
            });
    }

    /// @dev The king that arrived on `position` in `record`'s cycle; kind
    ///      `None` if none did.
    function _kingOf(
        SquareRecord storage record,
        uint64 position
    ) internal view returns (Piece memory king) {
        king.position = position;
        if (!record.kingArrived) return king;
        king.army = _armyAt(record.kingIndex);
        king.kind = PieceKind.King;
    }

    /// @dev The first piece other than a king that arrived on `position` in
    ///      `record`'s cycle.
    function _arriverOf(
        SquareRecord storage record,
        uint64 position
    ) internal view returns (Piece memory) {
        return
            Piece({
                position: position,
                army: _armyAt(record.arriverIndex),
                kind: record.arriverKind
            });
    }

    /// @notice The record of `position`, made current for `cycleNumber`: if
    ///         its facts are of an earlier cycle, they are folded into the
    ///         standing piece first and the cycle's facts start from nothing.
    /// @param standing What stands on `position` at the start of
    ///        `cycleNumber` ({_squareAt}), which the caller has already read.
    /// @return record A COPY, which the caller changes and writes back with
    ///         one store (the record is one slot): nothing about the square
    ///         itself is written here, only what a fold keeps elsewhere.
    /// @dev ORDER-FREE: the piece folded in is the start-of-cycle state, which
    ///      depends only on cycles that are over, so whichever reveal of this
    ///      cycle touches the square first writes the same thing.
    function _touch(
        uint64 position,
        uint64 cycleNumber,
        Piece memory standing
    ) internal returns (SquareRecord memory record) {
        SquareRecord storage stored = _squares[position];
        uint64 touched = stored.cycle;
        if (touched == cycleNumber) return stored;
        if (touched == 0) {
            uint64 zone = PositionUtils.getZone(position);
            uint256 bits = _touchedSquares[zone];
            // AT A TABLE a zone touched for the first time is listed, for the
            // count of material at the cap (`UsingGameTable-_tally`). The
            // roster is read only for a zone nobody has touched yet. Which
            // reveal lists a zone, and so the list's order, depends on the
            // order of reveals; the set listed does not, and the count over
            // it is a sum (`docs/adr/0012`).
            if (bits == 0 && _roster().seats != 0) _tableZones.push(zone);
            _touchedSquares[zone] =
                bits | (uint256(1) << PositionUtils.zoneLocalIndex(position));
        } else {
            _foldCapture(stored, position, cycleNumber);
            _foldExit(stored, position);
        }
        record.cycle = cycleNumber;
        record.kind = standing.kind;
        record.armyIndex = _indexOf(standing.army);
    }

    /// @notice Write `record` as the record of `position`, in ONE store.
    /// @dev The compiler writes a struct field by field, each a read and a
    ///      write of the same slot; this packs the fields into the slot the
    ///      way the compiler lays them out (pinned by
    ///      `test/js/StorageLayout.test.ts`), so every read through the
    ///      struct sees them.
    function _storeSquare(uint64 position, SquareRecord memory record) private {
        uint256 word =
            uint256(record.cycle) |
                (uint256(uint8(record.kind)) << 64) |
                (record.departed ? uint256(1) << 72 : 0) |
                (uint256(record.arrivals) << 80) |
                (record.kingArrived ? uint256(1) << 112 : 0) |
                (uint256(uint8(record.arriverKind)) << 120) |
                (uint256(record.armyIndex) << 128) |
                (uint256(record.arriverIndex) << 160) |
                (uint256(record.kingIndex) << 192);
        SquareRecord storage stored = _squares[position];
        assembly ("memory-safe") {
            sstore(stored.slot, word)
        }
    }

    // ------------------------------------------------------------------------
    // CAPTURES (`docs/adr/0013`, `docs/adr/0014`)
    // ------------------------------------------------------------------------

    /// @notice Before `record`'s facts are folded away, keep what the board
    ///         does not: whose king fell there, and who took whose stake.
    /// @dev ORDER-FREE: the facts are of a cycle that is over, and whether
    ///      the captor's own king fell in that cycle is read one level deep
    ///      ({_captorFell}), from facts of the same closed cycle or what their
    ///      fold kept. Each victim's king that fell here gets `fallen` and the
    ///      cycle. Its stake goes to the captor ({_take}), unless the captor's
    ///      king fell in the same cycle: then a king or stone that stayed is a
    ///      stone and keeps its own stake, and a moving king that met the
    ///      captor is the stone, or, if a king or stone stayed there, gives its
    ///      stake to that stone's army (one stone is all a square can hold).
    ///
    ///      ONE CAPTURE PER CYCLE: a stake only ever moves into the army that
    ///      took it, never on through a captor that fell with it.
    function _foldCapture(
        SquareRecord storage record,
        uint64 position,
        uint64 cycleNumber
    ) private {
        (
            uint32 standingVictim,
            uint32 kingVictim,
            uint32 captor
        ) = _kingCaptureAt(record);
        if (standingVictim == 0 && kingVictim == 0) return;
        bool fell = _captorFell(record, position, cycleNumber);
        uint64 cycle = record.cycle;
        if (kingVictim != 0) {
            _fall(_armyAt(kingVictim), cycle);
            _take(_armyAt(kingVictim), fell ? standingVictim : captor);
        }
        if (standingVictim != 0) {
            // A stone fell when it was made.
            if (record.kind == PieceKind.King) {
                _fall(_armyAt(standingVictim), cycle);
            }
            if (!fell) _take(_armyAt(standingVictim), captor);
        }
    }

    /// @dev `army`'s king fell in `cycle`: the fold's copy of the facts that
    ///      say so ({_fellIn}).
    function _fall(uint256 army, uint64 cycle) private {
        ArmyRecord storage record = _armies[army];
        record.fallen = true;
        record.fellIn = cycle;
    }

    /// @dev `victim`'s stake is that of the army with index `captor`:
    ///      written once, and its reserve moves up. An exit's collection may
    ///      have written it first, having collected the reserve itself
    ///      ({UsingGameInternal-_collect}).
    function _take(uint256 victim, uint32 captor) private {
        if (captor == 0) return;
        ArmyRecord storage record = _armies[victim];
        if (record.capturedByIndex != 0) return;
        record.capturedByIndex = captor;
        _moveReserveUp(victim, _armyAt(captor));
    }

    /// @notice Move `victim`'s whole reserve into `captor`'s, once its capture
    ///         is a folded fact (`docs/adr/0011`).
    /// @dev The captor's stake counts the victim's reserve either way
    ///      ({_treeStake}), so no stake changes, whatever the order; the tree
    ///      only gets flatter. Credited without a seat: the captor is already
    ///      a member, or dead.
    function _moveReserveUp(uint256 victim, uint256 captor) internal {
        uint256 amount = CommitReveal.debit(victim, type(uint256).max);
        if (amount != 0) CommitReveal.deposit(captor, amount);
    }

    /// @notice Whether the army that took a king or a stone on `position`, by
    ///         `record`'s facts (of a cycle over before `cycleNumber`), lost
    ///         its own king in that same cycle: then what it took is a stone
    ///         (`captorFell` of {ChessRules-settle}).
    /// @dev ONE LEVEL DEEP, never a walk. A captor that is the moving king
    ///      here survived (or was alone) on this square, so it fell only by
    ///      exiting through it. Any other captor took with a piece other than
    ///      its king, and its king may have stood still or made a piece-move of
    ///      its own in the same cycle (`docs/adr/0016`, amending
    ///      `docs/adr/0014`). Either way the king's last move says where it
    ///      stood at the end of that cycle (`kingTo`, or its deployment square
    ///      if it never moved), and the facts of that ONE square say whether it
    ///      fell there, taken where it stood, meeting exactly one piece where
    ///      it arrived, or leaving through an exit: {_fellIn} reads them
    ///      without asking who took it, and a king that moved again later did
    ///      not fall in that cycle, which the cycle comparison below says.
    function _captorFell(
        SquareRecord storage record,
        uint64 position,
        uint64 cycleNumber
    ) internal view returns (bool) {
        bool kingCame = record.kingArrived;
        uint32 arrivals = record.arrivals;
        bool meets = kingCame && arrivals == 2;
        if (
            !meets &&
            (arrivals == 0 ||
                record.departed ||
                (record.kind != PieceKind.King &&
                    record.kind != PieceKind.Stone))
        ) {
            return false;
        }
        (
            uint32 standingVictim,
            uint32 kingVictim,
            uint32 captor
        ) = _kingCaptureAt(record);
        if (standingVictim == 0 && kingVictim == 0) return false;
        if (kingCame && !meets) {
            return
                arrivals == 1 &&
                _isExit(position) &&
                !_armies[_armyAt(record.kingIndex)].atTable;
        }
        return _fellIn(_armyAt(captor), cycleNumber) == record.cycle;
    }

    /// @notice The cycle `army`'s king fell in, taken or leaving through an
    ///         exit, if that was before `cycleNumber`; zero if it stands.
    /// @dev TWO SOURCES, ONE ANSWER, as {_exited}: once a later reveal has
    ///      folded the square it fell on, the army record says it (`fallen`
    ///      and `fellIn`, or `exited`, whose cycle is its king's last move);
    ///      until then that square's facts do. A fallen king never moves
    ///      again, so the square is where its last move took it, or where it
    ///      was deployed ({_kingSquare}), and its facts there are the last
    ///      ones: any later fact on that square was written by a touch that
    ///      folded them first. Asks nothing about whoever took it, so it is
    ///      never a walk.
    function _fellIn(
        uint256 army,
        uint64 cycleNumber
    ) internal view returns (uint64) {
        ArmyRecord storage record = _armies[army];
        if (record.exited) return record.kingMovedIn;
        if (record.fallen) return record.fellIn;
        (bool placed, uint64 square) = _kingSquare(record, cycleNumber);
        if (!placed) return 0;
        SquareRecord storage facts = _squares[square];
        uint64 touched = facts.cycle;
        if (touched == 0 || touched >= cycleNumber) return 0;
        uint32 index = record.index;
        if (facts.kingArrived && facts.kingIndex == index) {
            uint32 arrivals = facts.arrivals;
            if (arrivals == 2) return touched;
            bool exits = arrivals == 1 && !record.atTable && _isExit(square);
            return exits ? touched : 0;
        }
        if (
            facts.departed ||
            facts.kind != PieceKind.King ||
            facts.armyIndex != index
        ) {
            return 0;
        }
        (uint32 standingVictim, , ) = _kingCaptureAt(facts);
        return standingVictim == index ? touched : 0;
    }

    /// @dev Where `record`'s king stands at the start of `cycleNumber`, if it
    ///      has been placed and did not move in a cycle that is not over (it
    ///      was then alive at that cycle's start, where nothing yet says
    ///      otherwise).
    function _kingSquare(
        ArmyRecord storage record,
        uint64 cycleNumber
    ) private view returns (bool, uint64) {
        uint64 movedIn = record.kingMovedIn;
        if (movedIn == 0) {
            uint32 indexPlusOne = record.spawnIndexPlusOne;
            if (indexPlusOne == 0) return (false, 0);
            return (
                true,
                ChessRules.kingOf(
                    ChessRules.spawnPointAt(indexPlusOne - 1, SPAWN_SPACING)
                )
            );
        }
        if (movedIn >= cycleNumber) return (false, 0);
        return (true, record.kingTo);
    }

    /// @notice The army that holds `army`'s stake at the start of
    ///         `cycleNumber` because it took `army`'s king or stone; zero if
    ///         `army` holds its own (it stands, it exited, or it is a stone
    ///         nobody has taken).
    /// @dev TWO SOURCES, ONE ANSWER: `capturedByIndex` once a fold has written it
    ///      ({_take}), else the facts of the square its king fell on, which
    ///      is also where its stone stands. The answer for those facts is the
    ///      fold's, so reads and folds in any order agree.
    function _captureOf(
        uint256 army,
        uint64 cycleNumber
    ) internal view returns (uint256) {
        ArmyRecord storage record = _armies[army];
        uint32 by = record.capturedByIndex;
        if (by != 0) return _armyAt(by);
        (bool placed, uint64 square) = _kingSquare(record, cycleNumber);
        if (!placed) return 0;
        SquareRecord storage facts = _squares[square];
        uint64 touched = facts.cycle;
        if (touched == 0 || touched >= cycleNumber) return 0;
        (
            uint32 standingVictim,
            uint32 kingVictim,
            uint32 captor
        ) = _kingCaptureAt(facts);
        uint32 index = record.index;
        if (standingVictim != index && kingVictim != index) return 0;
        if (!_captorFell(facts, square, cycleNumber)) return _armyAt(captor);
        return kingVictim == index ? _armyAt(standingVictim) : 0;
    }

    /// @dev {ChessRules-kingCapture} of `record`'s facts, in compact
    ///      indices ({ArmyRecord-index}): the rule only compares armies and
    ///      tells none from zero, so it reads the indices as it would the ids.
    function _kingCaptureAt(
        SquareRecord storage record
    ) private view returns (uint32, uint32, uint32) {
        (
            uint256 standingVictim,
            uint256 kingVictim,
            uint256 captor
        ) = ChessRules.kingCapture(
                record.kind,
                record.armyIndex,
                record.departed,
                record.arrivals,
                record.kingArrived ? record.kingIndex : 0,
                record.arriverIndex
            );
        return (uint32(standingVictim), uint32(kingVictim), uint32(captor));
    }

    // ------------------------------------------------------------------------
    // EXITS (`docs/adr/0006`; an exited army falls like a taken one)
    // ------------------------------------------------------------------------

    /// @notice Whether `position` is an exit: one of the 2 by 2 block at the
    ///         centre of a spawn-grid cell, where four armies meet diagonally
    ///         (`docs/adr/0015`). For a spacing S, the squares floor(S/2) and
    ///         floor(S/2) + 1 off a spawn point on both axes: at S = 9, offsets 4
    ///         and 5, two squares diagonally off each army's corner.
    function _isExit(uint64 position) internal view returns (bool) {
        (int32 x, int32 y) = PositionUtils.toXY(position);
        int256 s = int256(uint256(SPAWN_SPACING));
        return _inExitBand(x, s) && _inExitBand(y, s);
    }

    /// @dev Whether coordinate `v` is floor(s/2) or floor(s/2) + 1 off a multiple of
    ///      `s`, negative coordinates included.
    function _inExitBand(int32 v, int256 s) private pure returns (bool) {
        int256 m = int256(v) % s;
        if (m < 0) m += s;
        int256 h = s / 2;
        return m == h || m == h + 1;
    }

    /// @notice Whether `record`'s facts are of a king that landed ALONE on
    ///         the exit `position`: it left the board at the close of that
    ///         cycle. A king that arrived with others follows the collision
    ///         table and stays.
    function _exitIn(
        SquareRecord storage record,
        uint64 position
    ) private view returns (bool) {
        return record.kingArrived && record.arrivals == 1 && _isExit(position);
    }

    /// @notice Whether `army` has left the board through an exit before
    ///         `cycleNumber`.
    /// @dev ORDER-FREE, from closed-cycle facts only, and O(1): the cycle and
    ///      square of its king's last move ({ArmyRecord-kingMovedIn}), and the
    ///      facts of that square while they are still that cycle's. A touch
    ///      that folds them keeps the answer first ({_foldExit}), so both
    ///      sources give the same answer.
    function _exited(
        uint256 army,
        uint64 cycleNumber
    ) internal view returns (bool) {
        ArmyRecord storage record = _armies[army];
        if (record.exited) return true;
        // NO EXITS AT A TABLE: a table ends with a winner, so a king that lands
        // on an exit square there is only a king on a square. Read from the
        // slot `exited` is in, so it costs nothing.
        if (record.atTable) return false;
        uint64 movedIn = record.kingMovedIn;
        if (movedIn == 0 || movedIn >= cycleNumber) return false;
        uint64 to = record.kingTo;
        SquareRecord storage facts = _squares[to];
        return facts.cycle == movedIn && _exitIn(facts, to);
    }

    /// @notice Before an exit square's facts are folded away, keep that the
    ///         king which landed alone on it has exited.
    function _foldExit(SquareRecord storage record, uint64 position) private {
        if (!_exitIn(record, position)) return;
        ArmyRecord storage army = _armies[_armyAt(record.kingIndex)];
        // Exits do nothing at a table ({_exited}).
        if (!army.atTable) army.exited = true;
    }

    // ------------------------------------------------------------------------
    // MOVES
    // ------------------------------------------------------------------------

    /// @notice Validate one of `player`'s piece-moves against the start-of-cycle
    ///         board and record it.
    /// @param vacated the origins of every piece-move of the army's move this
    ///        cycle (`docs/adr/0016`), this one's included
    /// @param reads the reveal's cache of start-of-cycle facts ({Reads})
    /// @dev LOAD, RULE, APPLY. Load: the moving piece and every square
    ///      {ChessRules-moveSquares} names, all as they stood at the START of
    ///      the cycle, which no reveal of this cycle can change (a read ignores
    ///      the cycle's own writes, this reveal's earlier piece-moves included:
    ///      {_squareAt}). Rule: {ChessRules-isLegalMove}, the same pure code the
    ///      simulation route runs, on those contents with the army's own
    ///      vacated squares read as empty ({ChessRules-vacate}). THE MASK IS FOR
    ///      THE RULE ONLY: the touches and `prey` below get the real
    ///      start-of-cycle contents, so what a square's record keeps as its
    ///      standing piece never depends on which reveal touches it first.
    ///      Apply: ONLY ACCUMULATE. The origin records that its piece left,
    ///      the destination adds one to its arrival count and keeps the
    ///      arriver for the case where the count is one, and ORs in whether a
    ///      king arrived. Whether the move lands is decided when the square is
    ///      next read ({ChessRules-settle}), by the count, never by who
    ///      revealed first. Only this army moves its pieces, each at most once
    ///      per cycle and never two to one square (`OneMovePerCycle`), so
    ///      nothing else ever departs from the same square in the same cycle,
    ///      and one square's record copes with its own piece leaving while
    ///      another of the army's arrives.
    ///
    ///      THE ONE BRANCH ON SHARED STATE is the destination's first arrival
    ///      of the cycle, which writes the arriver; the rest only count. What
    ///      differs with order is which arriver sits in a record whose count
    ///      says to ignore it, exactly as for a spawn point
    ///      (`test/js/Moves.test.ts` replays the reveals in both orders).
    function _revealMove(
        uint256 player,
        Move calldata move,
        uint64[] memory vacated,
        uint64 cycleNumber,
        Reads memory reads
    ) internal {
        (Piece memory piece, Piece memory there) = _judgeMove(
            player,
            move,
            vacated,
            cycleNumber,
            reads
        );

        SquareRecord memory origin = _touch(move.from, cycleNumber, piece);
        origin.departed = true;
        _storeSquare(move.from, origin);

        SquareRecord memory target = _touch(move.to, cycleNumber, there);
        uint32 arrivals = target.arrivals;
        bool kingThere = target.kingArrived;
        // How many pieces other than a king had arrived before this one.
        uint32 others = kingThere ? arrivals - 1 : arrivals;
        // A king or a stone that stood here at the start of the cycle could
        // be taken, and could become, or stay, the stone that holds a moving
        // king's stake.
        bool prey =
            there.kind == PieceKind.King || there.kind == PieceKind.Stone;
        if (piece.kind == PieceKind.King) {
            target.kingArrived = true;
            target.kingIndex = _indexOf(player);
            _kingMoved(player, move, cycleNumber);
            // This king could die meeting the one piece already here.
            if (others == 1) {
                _noteCandidate(_armyAt(target.arriverIndex), player);
                if (prey) _noteCandidate(there.army, player);
            }
        } else {
            if (others == 0) {
                target.arriverIndex = _indexOf(player);
                target.arriverKind = piece.kind;
                // The king already here could die meeting this piece.
                if (kingThere) {
                    uint256 king = _armyAt(target.kingIndex);
                    _noteCandidate(player, king);
                    if (prey) _noteCandidate(there.army, king);
                }
            }
        }
        target.arrivals = arrivals + 1;
        _storeSquare(move.to, target);
        _markArrival(move.to, cycleNumber);
        if (prey) _noteCandidate(player, there.army);
    }

    /// @notice The LOAD and the RULE of {_revealMove}: the moving piece and
    ///         what stood on its destination at the start of the cycle (the
    ///         real contents, unmasked), or a revert if the piece-move is not
    ///         legal.
    /// @dev `squares[0]` is the destination, so the destination's contents
    ///      are returned: neither touch has to read its square again.
    function _judgeMove(
        uint256 player,
        Move calldata move,
        uint64[] memory vacated,
        uint64 cycleNumber,
        Reads memory reads
    ) private view returns (Piece memory piece, Piece memory there) {
        // An empty square's piece has army zero, which is never `player`.
        piece = _squareAt(move.from, cycleNumber, reads);
        (bool legal, uint64[] memory squares) = ChessRules.moveSquares(
            piece,
            move.to
        );
        legal = legal && piece.army == player;
        if (legal) {
            Piece[] memory contents = new Piece[](squares.length);
            for (uint256 i = 0; i < squares.length; i++) {
                contents[i] = _squareAt(squares[i], cycleNumber, reads);
            }
            there = contents[0];
            ChessRules.vacate(squares, contents, player, vacated);
            legal = ChessRules.isLegalMove(piece, move.to, contents);
        }
        if (!legal) revert IllegalMove(move.from, move.to);
    }

    /// @dev `army`'s king made `move` in `cycleNumber`.
    function _kingMoved(
        uint256 army,
        Move calldata move,
        uint64 cycleNumber
    ) private {
        ArmyRecord storage record = _armies[army];
        record.kingFrom = move.from;
        record.kingTo = move.to;
        record.kingMovedIn = cycleNumber;
    }

    /// @notice Note that `captor` may have taken `victim`'s king or stone,
    ///         for the captor's stake ({UsingGameStore-_capturesBy}).
    /// @dev WRITTEN AT REVEAL TIME, by whichever reveal can see that the
    ///      capture is possible, and never relied on alone: whether it
    ///      happened is {_captureOf}'s to say, from facts complete only once
    ///      the cycle is over. For a moving king meeting exactly one piece it
    ///      is the LATER of the two reveals that notes it (the earlier cannot
    ///      know), so it is noted once whichever order they land in.
    ///
    ///      A moving king meeting exactly one piece on a king or a stone that
    ///      stayed is ALSO noted under the army of what stood there: if the
    ///      captor's king falls that cycle, that army is the stone that holds
    ///      the moving king's stake ({_foldCapture}), and its stake must count
    ///      it before the square is folded as after
    ///      (`test/js/KingCapture.test.ts`, "the two-victim square").
    ///
    ///      AN ARMY IS NEVER ITS OWN PREY: a piece arriving where its own king
    ///      stood (the king moving away in the same cycle, `docs/adr/0016`)
    ///      notes nothing.
    function _noteCandidate(uint256 captor, uint256 victim) private {
        if (captor == victim) return;
        _capturesBy[captor].push(victim);
    }

    /// @notice Where `army`'s king stands at the start of `cycleNumber`, given
    ///         where it was deployed, if it has not been taken.
    /// @dev Only the army's own reveals write where its king went, so this is
    ///      order-free: it is where the king's last move took it. Whether the
    ///      king is still there is {_fellIn}'s to say.
    function _kingAt(
        uint256 army,
        uint64 spawnPoint,
        uint64 cycleNumber
    ) internal view returns (uint64) {
        ArmyRecord storage record = _armies[army];
        uint64 movedIn = record.kingMovedIn;
        if (movedIn == 0) return ChessRules.kingOf(spawnPoint);
        return movedIn < cycleNumber ? record.kingTo : record.kingFrom;
    }

    // ------------------------------------------------------------------------
    // STAKES
    // ------------------------------------------------------------------------

    /// @notice How deep the read-only stake view follows the tree of who
    ///         took whose stake ({_treeStake}).
    /// @dev THE VIEW'S OWN BOUND, now that no reveal walks a chain: a view
    ///      run by a client must not grow without limit with a long-lived
    ///      army's history. Below this depth the view reports what it has
    ///      reached, a LOWER BOUND; the stakes are still all there, and an
    ///      exit's payout (`UsingGameInternal-_collect`) and a table's pot
    ///      take them whole, unbounded. Reserves move up as captures are
    ///      folded, so the unfolded part of a tree, and so the shortfall, is
    ///      only the captures nobody has touched since.
    uint256 internal constant STAKE_VIEW_DEPTH = 8;

    /// @notice The stake `army` holds at the start of `cycleNumber`: its own
    ///         reserve and, recursively, that of every army whose king or
    ///         stone it took; zero once its stake is another army's.
    function _stakeOf(
        uint256 army,
        uint64 cycleNumber
    ) internal view returns (uint256) {
        if (_captureOf(army, cycleNumber) != 0) return 0;
        return _treeStake(army, cycleNumber, STAKE_VIEW_DEPTH);
    }

    /// @dev `army`'s reserve plus the trees of the armies whose stakes it
    ///      took and that a fold has not moved up yet, each counted once: an
    ///      army's stake has one taker, and is counted in its list only.
    function _treeStake(
        uint256 army,
        uint64 cycleNumber,
        uint256 depth
    ) internal view returns (uint256 stake) {
        stake = _reserveOf(army);
        if (depth == 0) return stake;
        uint256[] storage victims = _capturesBy[army];
        uint256 n = victims.length;
        for (uint256 k = 0; k < n; k++) {
            uint256 victim = victims[k];
            if (_captureOf(victim, cycleNumber) != army) continue;
            bool seen = false;
            for (uint256 j = 0; j < k; j++) {
                if (victims[j] == victim) {
                    seen = true;
                    break;
                }
            }
            if (!seen) {
                stake += _treeStake(victim, cycleNumber, depth - 1);
            }
        }
    }

    // ------------------------------------------------------------------------

    function _floorDiv(int256 a, int256 b) internal pure returns (int256) {
        int256 q = a / b;
        if (a % b != 0 && (a < 0) != (b < 0)) q -= 1;
        return q;
    }

    function _ceilDiv(int256 a, int256 b) internal pure returns (int256) {
        int256 q = a / b;
        if (a % b != 0 && (a < 0) == (b < 0)) q += 1;
        return q;
    }
}

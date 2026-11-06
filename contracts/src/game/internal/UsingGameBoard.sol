// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.0;

import "./UsingGameStore.sol";
import "../../utils/PositionUtils.sol";
import {ChessRules} from "./ChessRules.sol";

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
            return (true, spawn.army);
        }
        return (false, 0);
    }

    /// @notice The spawn point whose footprint can cover `position`, if any,
    ///         and its spiral index.
    /// @dev A square is covered by at most one spawn point's footprint (the
    ///      spacing is at least the footprint's width), and a footprint reaches
    ///      at most 3 squares left of / below its spawn point and 2 right of /
    ///      above it: so the spawn point is the one multiple of the spacing in
    ///      [x-2, x+3] by [y-2, y+3], if there is one. Whether the square is ON
    ///      the footprint (not a corner, not outside the rectangle of its
    ///      facing) is {ChessRules-layoutAt}'s to say.
    function _spawnCovering(
        uint64 position
    ) internal view returns (bool near, uint64 spawnPoint, uint256 index) {
        (int32 x, int32 y) = PositionUtils.toXY(position);
        int256 s = int256(uint256(SPAWN_SPACING));
        int256 i = _floorDiv(int256(x) + 3, s);
        int256 j = _floorDiv(int256(y) + 3, s);
        if (i * s < int256(x) - 2 || j * s < int256(y) - 2) {
            return (false, 0, 0);
        }
        return (
            true,
            PositionUtils.fromXY(int32(i * s), int32(j * s)),
            ChessRules.spiralIndex(i, j)
        );
    }

    /// @notice Whether every square the layout of a deployment at
    ///         `spawnPoint` puts a piece on is empty at the START of
    ///         `cycleNumber`.
    /// @dev Start-of-cycle facts only, so every reveal of the cycle computes
    ///      the same answer. Only the per-square layer can occupy these
    ///      squares: no other footprint overlaps them, and this spawn point is
    ///      open, so nothing has landed on it.
    function _footprintClear(
        uint64 spawnPoint,
        uint64 cycleNumber
    ) internal view returns (bool) {
        Piece[] memory pieces = ChessRules.layout(spawnPoint, 0);
        for (uint256 k = 0; k < pieces.length; k++) {
            uint64 position = pieces[k].position;
            if (_squares[position].cycle == 0) continue;
            if (_squareAt(position, cycleNumber).kind != PieceKind.None) {
                return false;
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
        if (
            ChessRules.layoutAt(spawnPoint, 0, position).kind == PieceKind.None
        ) {
            return;
        }
        SpawnRecord storage spawn = _spawns[index];
        if (spawn.cycle == cycleNumber) {
            if (!spawn.blocked) spawn.blocked = true;
        } else if (spawn.arrivedIn != cycleNumber) {
            spawn.arrivedIn = cycleNumber;
        }
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
        piece.position = position;
        (bool near, uint64 spawnPoint, uint256 index) = _spawnCovering(
            position
        );
        if (!near) return (piece, 0);
        SpawnRecord storage spawn = _spawns[index];
        cycle = spawn.cycle;
        if (cycle == 0 || spawn.count != 1 || spawn.blocked) return (piece, 0);
        piece = ChessRules.layoutAt(spawnPoint, spawn.army, position);
        if (piece.kind == PieceKind.None) cycle = 0;
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
    ///      THE PIECE'S ARMY IS RESOLVED: the army it plays for at the start of
    ///      `cycleNumber`, following every merge since the facts were written
    ///      ({_armyOf}). The facts keep the army as it was then.
    function _squareAt(
        uint64 position,
        uint64 cycleNumber
    ) internal view returns (Piece memory piece) {
        (Piece memory laid, uint64 laidIn) = _laidAt(position);
        bool deployed = laidIn != 0 && laidIn < cycleNumber;
        SquareRecord storage record = _squares[position];
        uint64 touched = record.cycle;
        if (touched == 0) {
            if (!deployed) {
                piece.position = position;
                return piece;
            }
            laid.army = _armyOf(laid.army, cycleNumber);
            return laid;
        }

        piece = _standingOf(record, position);
        if (touched < cycleNumber) {
            piece = ChessRules.settle(
                piece,
                record.departed,
                record.arrivals,
                _kingOf(record, position),
                _arriverOf(record, position)
            );
        }
        if (deployed && laidIn > touched) {
            piece = laid;
        }
        if (piece.kind != PieceKind.None) {
            piece.army = _armyOf(piece.army, cycleNumber);
        }
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
                army: record.army,
                kind: record.kind,
                forward: record.forward,
                moved: record.moved
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
        king.army = record.kingArmy;
        king.kind = PieceKind.King;
        king.forward = record.kingForward;
        king.moved = true;
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
                army: record.arriverArmy,
                kind: record.arriverKind,
                forward: record.arriverForward,
                moved: true
            });
    }

    /// @notice The record of `position`, made current for `cycleNumber`: if
    ///         its facts are of an earlier cycle, they are folded into the
    ///         standing piece first and the cycle's facts start from nothing.
    /// @dev ORDER-FREE: the piece folded in is the start-of-cycle state, which
    ///      depends only on cycles that are over, so whichever reveal of this
    ///      cycle touches the square first writes the same thing.
    function _touch(
        uint64 position,
        uint64 cycleNumber
    ) internal returns (SquareRecord storage record) {
        record = _squares[position];
        uint64 touched = record.cycle;
        if (touched == cycleNumber) return record;
        if (touched == 0) {
            _touchedSquares[PositionUtils.getZone(position)] |=
                uint256(1) << PositionUtils.zoneLocalIndex(position);
        }
        if (touched != 0) _foldCapture(record, position);
        Piece memory standing = _squareAt(position, cycleNumber);
        record.army = standing.army;
        record.cycle = cycleNumber;
        record.kind = standing.kind;
        record.forward = standing.forward;
        record.moved = standing.moved;
        record.departed = false;
        record.arrivals = 0;
        record.kingArrived = false;
        record.arriverKind = PieceKind.None;
        record.arriverForward = Direction.North;
        record.kingForward = Direction.North;
        if (record.arriverArmy != 0) record.arriverArmy = 0;
        if (record.kingArmy != 0) record.kingArmy = 0;
    }

    /// @notice Before `record`'s facts are folded away, keep the one fact the
    ///         board does not: whose king they took, and into whom
    ///         ({ArmyRecord-capturedInto}).
    /// @dev ORDER-FREE: the facts are of a cycle that is over. The captor
    ///      written is the one the facts name, the army it played for at the
    ///      start of the capture's cycle, and not the army that has it now:
    ///      the stake is resolved down the tree of who took whom
    ///      ({_treeStake}), which needs each army's own captor.
    function _foldCapture(
        SquareRecord storage record,
        uint64 position
    ) private {
        (uint256 victim, uint256 captor) = ChessRules.kingCapture(
            _standingOf(record, position),
            record.departed,
            record.arrivals,
            _kingOf(record, position),
            _arriverOf(record, position)
        );
        if (victim == 0) return;
        ArmyRecord storage army = _armies[victim];
        if (army.capturedInto == 0) army.capturedInto = captor;
    }

    // ------------------------------------------------------------------------
    // MOVES
    // ------------------------------------------------------------------------

    /// @notice Validate `player`'s move against the start-of-cycle board and
    ///         record it.
    /// @dev LOAD, RULE, APPLY. Load: the moving piece and every square
    ///      {ChessRules-moveSquares} names, all as they stood at the START of
    ///      the cycle, which no reveal of this cycle can change. Rule:
    ///      {ChessRules-isLegalMove}, the same pure code the simulation route
    ///      runs. Apply: ONLY ACCUMULATE. The origin records that its piece
    ///      left, the destination adds one to its arrival count and keeps the
    ///      arriver for the case where the count is one, and ORs in whether a
    ///      king arrived. Whether the move lands is decided when the square is
    ///      next read ({ChessRules-settle}), by the count, never by who
    ///      revealed first. Only this army moves its pieces, at most one per
    ///      cycle, so nothing else ever departs from the same square in the
    ///      same cycle.
    ///
    ///      THE ONE BRANCH ON SHARED STATE is the destination's first arrival
    ///      of the cycle, which writes the arriver; the rest only count. What
    ///      differs with order is which arriver sits in a record whose count
    ///      says to ignore it, exactly as for a spawn point
    ///      (`test/js/Moves.test.ts` replays the reveals in both orders).
    function _revealMove(
        uint256 player,
        Move calldata move,
        uint64 cycleNumber
    ) internal {
        Piece memory piece = _squareAt(move.from, cycleNumber);
        if (piece.kind == PieceKind.None || piece.army != player) {
            revert IllegalMove(move.from, move.to);
        }
        (bool shapeOk, uint64[] memory squares) = ChessRules.moveSquares(
            piece,
            move.to
        );
        if (!shapeOk) revert IllegalMove(move.from, move.to);
        Piece[] memory contents = new Piece[](squares.length);
        for (uint256 i = 0; i < squares.length; i++) {
            contents[i] = _squareAt(squares[i], cycleNumber);
        }
        if (!ChessRules.isLegalMove(piece, move.to, contents)) {
            revert IllegalMove(move.from, move.to);
        }

        _touch(move.from, cycleNumber).departed = true;

        SquareRecord storage target = _touch(move.to, cycleNumber);
        uint32 arrivals = target.arrivals;
        bool kingThere = target.kingArrived;
        // How many pieces other than a king had arrived before this one.
        uint32 others = kingThere ? arrivals - 1 : arrivals;
        if (piece.kind == PieceKind.King) {
            target.kingArrived = true;
            target.kingArmy = player;
            target.kingForward = piece.forward;
            ArmyRecord storage army = _armies[player];
            army.kingFrom = move.from;
            army.kingTo = move.to;
            army.kingMovedIn = cycleNumber;
            // This king could die meeting the one piece already here.
            if (others == 1) _noteCandidate(target.arriverArmy, player);
        } else {
            if (others == 0) {
                target.arriverArmy = player;
                target.arriverKind = piece.kind;
                target.arriverForward = piece.forward;
                // The king already here could die meeting this piece.
                if (kingThere) _noteCandidate(player, target.kingArmy);
            }
        }
        target.arrivals = arrivals + 1;
        _markArrival(move.to, cycleNumber);
        // A king that stood here at the start of the cycle could be taken.
        Piece memory there = contents[0];
        if (there.kind == PieceKind.King) _noteCandidate(player, there.army);
    }

    /// @notice Note that `captor` may have taken `victim`'s king, for the
    ///         captor's stake ({UsingGameStore-_capturesBy}).
    /// @dev WRITTEN AT REVEAL TIME, by whichever reveal can see that the
    ///      capture is possible, and never relied on alone: whether it
    ///      happened is {_captureOf}'s to say, from facts complete only once
    ///      the cycle is over. For a moving king meeting exactly one piece it
    ///      is the LATER of the two reveals that notes it (the earlier cannot
    ///      know), so it is noted once whichever order they land in.
    function _noteCandidate(uint256 captor, uint256 victim) private {
        _capturesBy[captor].push(victim);
    }

    /// @notice Where `army`'s king stands at the start of `cycleNumber`, given
    ///         where it was deployed, if it has not been taken.
    /// @dev Only the army's own reveals write where its king went, so this is
    ///      order-free: it is where the king's last move took it. Whether the
    ///      king is still there is {_captureOf}'s to say.
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
    // MERGES
    // ------------------------------------------------------------------------

    /// @notice How many "captured into" pointers {_armyOf} follows at most.
    /// @dev THE BOUND ON A CHAIN, which bounds what resolving one piece costs a
    ///      reveal. Chains stay short without it: a fold writes the RESOLVED
    ///      captor ({_foldCapture}) and a touched square keeps its piece's
    ///      resolved army, so a hop is a merge since that square was last
    ///      touched, and a kept one costs one storage read. A
    ///      chain longer than this ends at the army reached, which is not the
    ///      one that owns it: a cost bound, measured in `GasBudget.test.ts`.
    uint256 internal constant MAX_CHAIN = 16;

    /// @notice The army `army` plays for at the start of `cycleNumber`: itself,
    ///         or the army that took its king, followed as far as it goes
    ///         (`docs/adr/0001-one-move-per-army-merge-on-capture.md`).
    /// @dev ORDER-FREE, because every hop is a capture of a cycle that is
    ///      over. A chain within one cycle (A takes B while C takes A) ends
    ///      with the last captor. A capture LOOP (A takes B while B takes A)
    ///      comes back to where it started, and then the army is its own: the
    ///      rotation of ownership that loop calls for is not a rule yet
    ///      (`work/tasks/backlog/chess-capture-loops.md`), and stopping there
    ///      keeps every read finite and every answer the same.
    function _armyOf(
        uint256 army,
        uint64 cycleNumber
    ) internal view returns (uint256) {
        uint256 start = army;
        for (uint256 hop = 0; hop < MAX_CHAIN; hop++) {
            uint256 captor = _captureOf(army, cycleNumber);
            if (captor == 0) return army;
            if (captor == start) return start;
            army = captor;
        }
        return army;
    }

    /// @notice The army that took `army`'s king before `cycleNumber`, as it
    ///         was at the start of that capture's cycle; zero if none did.
    /// @dev TWO SOURCES, ONE ANSWER. Once a later reveal has folded the square
    ///      of the capture, the answer is kept on the army
    ///      ({ArmyRecord-capturedInto}). Until then it is still in that
    ///      square's facts, and the square is the one the king's last move
    ///      took it to (or where it was deployed): a king is only ever taken
    ///      where it stands or where it arrives, and a taken king never moves
    ///      again. So which reads happen first never changes the answer.
    function _captureOf(
        uint256 army,
        uint64 cycleNumber
    ) internal view returns (uint256) {
        ArmyRecord storage record = _armies[army];
        uint256 captor = record.capturedInto;
        if (captor != 0) return captor;
        uint64 movedIn = record.kingMovedIn;
        uint64 square;
        if (movedIn == 0) {
            uint32 indexPlusOne = record.spawnIndexPlusOne;
            if (indexPlusOne == 0) return 0;
            square = ChessRules.kingOf(
                ChessRules.spawnPointAt(indexPlusOne - 1, SPAWN_SPACING)
            );
        } else if (movedIn >= cycleNumber) {
            // It moved in a cycle that is not over: alive at its start.
            return 0;
        } else {
            square = record.kingTo;
        }
        SquareRecord storage facts = _squares[square];
        uint64 touched = facts.cycle;
        if (touched == 0 || touched >= cycleNumber) return 0;
        if (
            !facts.kingArrived &&
            (facts.kind != PieceKind.King || facts.departed)
        ) {
            return 0;
        }
        (uint256 victim, uint256 by) = ChessRules.kingCapture(
            _standingOf(facts, square),
            facts.departed,
            facts.arrivals,
            _kingOf(facts, square),
            _arriverOf(facts, square)
        );
        return victim == army ? by : 0;
    }

    /// @notice The stake `army` holds at the start of `cycleNumber`: its own
    ///         reserve and, recursively, that of every army it took a king of;
    ///         zero once its own king has been taken, because its stake is
    ///         then its captor's.
    /// @dev THE RESERVES DO NOT MOVE: a captured army's reserve stays where
    ///      it is (no army reserve can be withdrawn), and its captor's stake
    ///      is resolved through the captures, like its pieces, so no read order
    ///      can change it. Bounded like the chains: this is a view's walk.
    function _stakeOf(
        uint256 army,
        uint64 cycleNumber
    ) internal view returns (uint256) {
        if (_armyOf(army, cycleNumber) != army) return 0;
        return _treeStake(army, army, cycleNumber, MAX_CHAIN);
    }

    /// @dev `army`'s reserve plus the trees of the armies that merged into it,
    ///      each counted once: an army has one captor, and is counted in its
    ///      list only, and only if it resolves to `root` (an army in a capture
    ///      loop resolves to itself, see {_armyOf}, and keeps its own stake).
    function _treeStake(
        uint256 root,
        uint256 army,
        uint64 cycleNumber,
        uint256 depth
    ) private view returns (uint256 stake) {
        stake = _reserveOf(army);
        if (depth == 0) return stake;
        uint256[] storage victims = _capturesBy[army];
        uint256 n = victims.length;
        for (uint256 k = 0; k < n; k++) {
            uint256 victim = victims[k];
            if (_captureOf(victim, cycleNumber) != army) continue;
            if (_armyOf(victim, cycleNumber) != root) continue;
            bool seen = false;
            for (uint256 j = 0; j < k; j++) {
                if (victims[j] == victim) {
                    seen = true;
                    break;
                }
            }
            if (!seen) {
                stake += _treeStake(root, victim, cycleNumber, depth - 1);
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

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
///      A LANDED DEPLOYMENT IS ONE ARRIVAL on each square of its footprint, in
///      the cycle it was revealed in. That is the whole of how the two kinds of
///      fact combine, and it is what keeps a move onto a new army's footprint
///      from corrupting anything until `chess-deployment-collisions` says what
///      it should do: a piece arriving on a footprint square in the deployment's
///      own cycle makes two arrivals, and both fail, by the count.
abstract contract UsingGameBoard is UsingGameStore {
    constructor(Config memory config) UsingGameStore(config) {}

    // ------------------------------------------------------------------------
    // DEPLOYMENTS
    // ------------------------------------------------------------------------

    /// @notice Whether a deployment has LANDED on the spawn point with spiral
    ///         index `index` before `cycleNumber`, and which army it was.
    /// @dev Resolved from the accumulated record: one deployment revealed in a
    ///      cycle that is over. The current cycle's reveals are not on the
    ///      board until it ends, so an army acts from the cycle after its
    ///      deployment and no move committed before it can reach it.
    function _landedBefore(
        uint256 index,
        uint64 cycleNumber
    ) internal view returns (bool landed, uint256 army) {
        SpawnRecord storage spawn = _spawns[index];
        uint64 cycle = spawn.cycle;
        if (cycle != 0 && cycle < cycleNumber && spawn.count == 1) {
            return (true, spawn.army);
        }
        return (false, 0);
    }

    /// @notice The piece the deployment over `position` laid there, and the
    ///         cycle it was revealed in; kind `None` if no deployment that is
    ///         still standing alone on its spawn point covers the square.
    /// @dev A square is covered by at most one spawn point's footprint (the
    ///      spacing is at least the footprint's width), and a footprint reaches
    ///      at most 3 squares left of / below its spawn point and 2 right of /
    ///      above it: so the spawn point is the one multiple of the spacing in
    ///      [x-2, x+3] by [y-2, y+3], if there is one. A deployment of the
    ///      CURRENT cycle is returned too: the caller decides whether its cycle
    ///      is over.
    function _laidAt(
        uint64 position
    ) internal view returns (Piece memory piece, uint64 cycle) {
        piece.position = position;
        (int32 x, int32 y) = PositionUtils.toXY(position);
        int256 s = int256(uint256(SPAWN_SPACING));
        int256 i = _floorDiv(int256(x) + 3, s);
        int256 j = _floorDiv(int256(y) + 3, s);
        if (i * s < int256(x) - 2 || j * s < int256(y) - 2) return (piece, 0);
        SpawnRecord storage spawn = _spawns[ChessRules.spiralIndex(i, j)];
        cycle = spawn.cycle;
        if (cycle == 0 || spawn.count != 1) return (piece, 0);
        piece = ChessRules.layoutAt(
            PositionUtils.fromXY(int32(i * s), int32(j * s)),
            spawn.army,
            position
        );
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
    ///      revealed in the record's own cycle is one more arrival in it.
    function _squareAt(
        uint64 position,
        uint64 cycleNumber
    ) internal view returns (Piece memory piece) {
        (Piece memory laid, uint64 laidIn) = _laidAt(position);
        bool deployed = laidIn != 0 && laidIn < cycleNumber;
        SquareRecord storage record = _squares[position];
        uint64 touched = record.cycle;
        if (touched == 0) {
            if (deployed) return laid;
            piece.position = position;
            return piece;
        }

        piece = Piece({
            position: position,
            army: record.army,
            kind: record.kind,
            forward: record.forward,
            moved: record.moved
        });
        if (touched < cycleNumber) {
            uint256 arrivals = record.arrivals;
            Piece memory arriver = Piece({
                position: position,
                army: record.arriverArmy,
                kind: record.arriverKind,
                forward: record.arriverForward,
                moved: true
            });
            if (deployed && laidIn == touched) {
                if (arrivals == 0) arriver = laid;
                arrivals += 1;
            }
            piece = ChessRules.settle(
                piece,
                record.departed,
                arrivals,
                arriver
            );
        }
        if (deployed && laidIn > touched) {
            piece = ChessRules.settle(piece, false, 1, laid);
        }
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
        if (record.arriverArmy != 0) record.arriverArmy = 0;
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
        if (arrivals == 0) {
            target.arriverArmy = player;
            target.arriverKind = piece.kind;
            target.arriverForward = piece.forward;
        }
        target.arrivals = arrivals + 1;
        if (piece.kind == PieceKind.King) {
            target.kingArrived = true;
            ArmyRecord storage army = _armies[player];
            army.kingFrom = move.from;
            army.kingTo = move.to;
            army.kingMovedIn = cycleNumber;
        }
    }

    /// @notice Where `army`'s king stands at the start of `cycleNumber`, given
    ///         where it was deployed.
    /// @dev Only the army's own reveals write where its king went, so this is
    ///      order-free. Kings are not captured yet
    ///      (`work/tasks/backlog/chess-king-capture-merge.md`): this is where
    ///      the king's last move took it.
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

// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.0;

import {UsingGameTypes as T} from "../interfaces/UsingGameTypes.sol";
import {PositionUtils} from "../../utils/PositionUtils.sol";

/// @title The chess rules, as pure functions
/// @notice THE GAME'S RULES LIVE HERE AND ONLY HERE
///         (`docs/adr/0007-rules-live-only-in-the-contract.md`). Every one is
///         `pure`, so a reveal, a resolving view and the simulation route all
///         run the same code, and a client reaches it only by running that
///         route's bytecode, never through a TypeScript copy.
library ChessRules {
    // ------------------------------------------------------------------------
    // THE SPAWN SPIRAL
    // ------------------------------------------------------------------------
    //
    // Spawn points are the points of a grid, numbered in a square spiral out
    // of the origin: 0 is (0,0), and ring r (r >= 1) holds the 8r points at
    // Chebyshev distance r, which are numbered from (2r-1)^2 on, in four sides
    // of 2r points each:
    //
    //   side 0: x =  r, y from -r+1 up to    r
    //   side 1: y =  r, x from  r-1 down to -r
    //   side 2: x = -r, y from  r-1 down to -r
    //   side 3: y = -r, x from -r+1 up to    r
    //
    // So "the free spawn points nearest the origin, in spiral order" is "the
    // free ones with the smallest index". Coordinates here are GRID
    // coordinates; a spawn point is at (i * spacing, j * spacing).

    /// @notice The grid point with spiral index `index`.
    function spiralPoint(
        uint256 index
    ) internal pure returns (int256 i, int256 j) {
        if (index == 0) return (0, 0);
        // The ring is the smallest r with (2r+1)^2 > index.
        uint256 root = _sqrt(index);
        uint256 r = (root + 1) / 2;
        if ((2 * r + 1) * (2 * r + 1) <= index) r += 1;
        uint256 k = index - (2 * r - 1) * (2 * r - 1);
        uint256 side = k / (2 * r);
        int256 t = int256(k % (2 * r));
        int256 ring = int256(r);
        if (side == 0) return (ring, -ring + 1 + t);
        if (side == 1) return (ring - 1 - t, ring);
        if (side == 2) return (-ring, ring - 1 - t);
        return (-ring + 1 + t, -ring);
    }

    /// @notice The spiral index of grid point (`i`, `j`): the inverse of
    ///         {spiralPoint}.
    function spiralIndex(int256 i, int256 j) internal pure returns (uint256) {
        int256 r = _abs(i) > _abs(j) ? _abs(i) : _abs(j);
        if (r == 0) return 0;
        uint256 base = uint256((2 * r - 1) * (2 * r - 1));
        int256 t;
        uint256 side;
        if (i == r && j > -r) {
            side = 0;
            t = j + r - 1;
        } else if (j == r) {
            side = 1;
            t = r - 1 - i;
        } else if (i == -r) {
            side = 2;
            t = r - 1 - j;
        } else {
            side = 3;
            t = i + r - 1;
        }
        return base + side * uint256(2 * r) + uint256(t);
    }

    /// @notice The spawn point with spiral index `index`, as a position.
    function spawnPointAt(
        uint256 index,
        uint32 spacing
    ) internal pure returns (uint64) {
        (int256 i, int256 j) = spiralPoint(index);
        int256 s = int256(uint256(spacing));
        return PositionUtils.fromXY(int32(i * s), int32(j * s));
    }

    /// @notice Whether `position` is on the spawn grid, and its spiral index.
    function spawnIndexOf(
        uint64 position,
        uint32 spacing
    ) internal pure returns (bool onGrid, uint256 index) {
        (int32 x, int32 y) = PositionUtils.toXY(position);
        int256 s = int256(uint256(spacing));
        // Solidity's `%` keeps the sign of the dividend, so this is zero for
        // every multiple of the spacing, negative ones included.
        if (int256(x) % s != 0 || int256(y) % s != 0) return (false, 0);
        return (true, spiralIndex(int256(x) / s, int256(y) / s));
    }

    // ------------------------------------------------------------------------
    // THE ARMY'S LAYOUT
    // ------------------------------------------------------------------------
    //
    // In its horizontal form, facing North (+y), rows going up the board:
    //
    //   row 3   . P P P P .        y = sy + 1
    //   row 2   P K B N R P        y = sy        <- the king's row
    //   row 1   P R N B Q P        y = sy - 1
    //   row 0   . P P P P .        y = sy - 2
    //           x = sx-3 ... sx+2
    //
    // Rotationally symmetric apart from the king and the queen. The other three
    // facings are this one turned by quarter turns about the rectangle's
    // centre, so the king's row is always on the side away from the origin and
    // the long side always faces it. Every pawn advances outward from its side.

    /// @notice How many pieces an army is deployed with.
    uint256 internal constant ARMY_SIZE = 20;

    /// @notice Which way an army deployed at `spawnPoint` faces: away from the
    ///         origin, along the axis on which the spawn point is farther out
    ///         (y when the two are equal). A coordinate of 0 counts as
    ///         positive, so the origin itself faces North.
    function facing(uint64 spawnPoint) internal pure returns (T.Direction) {
        (int32 x, int32 y) = PositionUtils.toXY(spawnPoint);
        if (_abs(y) >= _abs(x)) {
            return y >= 0 ? T.Direction.North : T.Direction.South;
        }
        return x >= 0 ? T.Direction.East : T.Direction.West;
    }

    /// @notice The pieces of an army deployed at `spawnPoint`, none moved.
    function layout(
        uint64 spawnPoint,
        uint256 army
    ) internal pure returns (T.Piece[] memory pieces) {
        pieces = new T.Piece[](ARMY_SIZE);
        T.Direction face = facing(spawnPoint);
        uint256 n = 0;
        for (uint256 r = 0; r < 4; r++) {
            for (uint256 c = 0; c < 6; c++) {
                (T.PieceKind kind, T.Direction forward) = _canonical(r, c);
                if (kind == T.PieceKind.None) continue;
                pieces[n] = T.Piece({
                    position: _place(spawnPoint, face, r, c),
                    army: army,
                    kind: kind,
                    forward: _rotate(forward, face),
                    moved: false
                });
                n++;
            }
        }
    }

    /// @notice Where the king of an army deployed at `spawnPoint` stands.
    function kingOf(uint64 spawnPoint) internal pure returns (uint64) {
        return _place(spawnPoint, facing(spawnPoint), 2, 1);
    }

    /// @dev The canonical (North-facing) piece at row `r`, column `c`, and
    ///      which way a pawn there advances.
    function _canonical(
        uint256 r,
        uint256 c
    ) private pure returns (T.PieceKind, T.Direction) {
        bool edgeRow = r == 0 || r == 3;
        bool edgeColumn = c == 0 || c == 5;
        if (edgeRow && edgeColumn) return (T.PieceKind.None, T.Direction.North);
        if (r == 0) return (T.PieceKind.Pawn, T.Direction.South);
        if (r == 3) return (T.PieceKind.Pawn, T.Direction.North);
        if (c == 0) return (T.PieceKind.Pawn, T.Direction.West);
        if (c == 5) return (T.PieceKind.Pawn, T.Direction.East);
        if (r == 1) {
            // P R N B Q P
            if (c == 1) return (T.PieceKind.Rook, T.Direction.North);
            if (c == 2) return (T.PieceKind.Knight, T.Direction.North);
            if (c == 3) return (T.PieceKind.Bishop, T.Direction.North);
            return (T.PieceKind.Queen, T.Direction.North);
        }
        // P K B N R P
        if (c == 1) return (T.PieceKind.King, T.Direction.North);
        if (c == 2) return (T.PieceKind.Bishop, T.Direction.North);
        if (c == 3) return (T.PieceKind.Knight, T.Direction.North);
        return (T.PieceKind.Rook, T.Direction.North);
    }

    /// @dev Row `r`, column `c` of the canonical layout, turned to `face`,
    ///      anchored on `spawnPoint`. The horizontal forms cover x from sx-3 to
    ///      sx+2 and y from sy-2 to sy+1; the vertical ones are that rectangle
    ///      transposed.
    function _place(
        uint64 spawnPoint,
        T.Direction face,
        uint256 r,
        uint256 c
    ) private pure returns (uint64) {
        (int32 sx, int32 sy) = PositionUtils.toXY(spawnPoint);
        int32 ri = int32(int256(r));
        int32 ci = int32(int256(c));
        if (face == T.Direction.North) {
            return PositionUtils.fromXY(sx - 3 + ci, sy - 2 + ri);
        }
        if (face == T.Direction.East) {
            return PositionUtils.fromXY(sx - 2 + ri, sy + 2 - ci);
        }
        if (face == T.Direction.South) {
            return PositionUtils.fromXY(sx + 2 - ci, sy + 1 - ri);
        }
        return PositionUtils.fromXY(sx + 1 - ri, sy - 3 + ci);
    }

    /// @dev `direction` turned as far clockwise as North is to `face`.
    function _rotate(
        T.Direction direction,
        T.Direction face
    ) private pure returns (T.Direction) {
        return T.Direction((uint8(direction) + uint8(face)) % 4);
    }

    // ------------------------------------------------------------------------

    function _abs(int256 a) private pure returns (int256) {
        return a < 0 ? -a : a;
    }

    /// @dev floor(sqrt(a)), by Newton's method.
    function _sqrt(uint256 a) private pure returns (uint256) {
        if (a == 0) return 0;
        uint256 x = a;
        uint256 y = (x + 1) / 2;
        while (y < x) {
            x = y;
            y = (x + a / x) / 2;
        }
        return x;
    }
}

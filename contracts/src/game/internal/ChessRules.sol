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

    /// @notice The piece an army deployed at `spawnPoint` has on `position`
    ///         before anything moves: kind `None` off its footprint and on its
    ///         four empty corners. The inverse of {layout}, one square at a
    ///         time, which is what lets a square be read without laying the
    ///         whole army out.
    function layoutAt(
        uint64 spawnPoint,
        uint256 army,
        uint64 position
    ) internal pure returns (T.Piece memory piece) {
        piece.position = position;
        (int32 sx, int32 sy) = PositionUtils.toXY(spawnPoint);
        (int32 x, int32 y) = PositionUtils.toXY(position);
        T.Direction face = facing(spawnPoint);
        int256 r;
        int256 c;
        if (face == T.Direction.North) {
            (r, c) = (int256(y) - sy + 2, int256(x) - sx + 3);
        } else if (face == T.Direction.East) {
            (r, c) = (int256(x) - sx + 2, int256(sy) + 2 - y);
        } else if (face == T.Direction.South) {
            (r, c) = (int256(sy) + 1 - y, int256(sx) + 2 - x);
        } else {
            (r, c) = (int256(sx) + 1 - x, int256(y) - sy + 3);
        }
        if (r < 0 || r > 3 || c < 0 || c > 5) return piece;
        (T.PieceKind kind, T.Direction forward) = _canonical(
            uint256(r),
            uint256(c)
        );
        if (kind == T.PieceKind.None) return piece;
        piece.army = army;
        piece.kind = kind;
        piece.forward = _rotate(forward, face);
    }

    // ------------------------------------------------------------------------
    // MOVES
    // ------------------------------------------------------------------------
    //
    // A move is judged against the board as it stood at the START of the
    // cycle, and only that board: what other armies reveal in the same cycle
    // can never make it legal or illegal (story 12). The rule is split in two
    // around what it has to read, so that the reveal (which reads storage) and
    // the simulation route (which is handed the board) run the same code:
    //
    //   1. {moveSquares}: from the piece and the destination alone, whether
    //      the move has a legal SHAPE, and which squares' contents decide the
    //      rest. `squares[0]` is always the destination; a slider's path and a
    //      pawn's skipped square follow it, and a king's eight neighbours of
    //      the destination do.
    //   2. {isLegalMove}: given what stood on each of those squares, whether
    //      the move is legal.
    //
    // No castling, no en passant and no promotion: none of them has a shape
    // here, so all three are simply illegal moves. No check: a king may move
    // onto an attacked square (story 19). But a king may not move next to
    // another army's king, measured on the start-of-cycle board, except onto
    // that king's own square, which is a capture: that is what makes two kings
    // arriving on one square impossible
    // (`docs/adr/0003-collision-table-king-survives-a-crowd.md`).

    /// @notice How far a rook, a bishop or a queen may slide (story 16).
    uint256 internal constant SLIDER_RANGE = 7;

    /// @notice Whether `piece` moving to `to` has a legal shape, and the
    ///         squares whose start-of-cycle contents decide whether it is
    ///         legal. `squares[0]` is `to`.
    function moveSquares(
        T.Piece memory piece,
        uint64 to
    ) internal pure returns (bool shapeOk, uint64[] memory squares) {
        (int32 fx, int32 fy) = PositionUtils.toXY(piece.position);
        (int32 toX, int32 toY) = PositionUtils.toXY(to);
        int256 dx = int256(toX) - fx;
        int256 dy = int256(toY) - fy;
        if (dx == 0 && dy == 0) return (false, squares);
        T.PieceKind kind = piece.kind;
        if (kind == T.PieceKind.Pawn) return _pawnSquares(piece, to, dx, dy);
        int256 ax = _abs(dx);
        int256 ay = _abs(dy);
        if (kind == T.PieceKind.Knight) {
            bool jump = (ax == 1 && ay == 2) || (ax == 2 && ay == 1);
            return jump ? (true, _one(to)) : (false, squares);
        }
        if (kind == T.PieceKind.King) {
            if (ax > 1 || ay > 1) return (false, squares);
            return (true, _kingSquares(to));
        }
        bool straight = dx == 0 || dy == 0;
        bool diagonalLine = ax == ay;
        bool lineOk =
            (kind == T.PieceKind.Rook && straight) ||
                (kind == T.PieceKind.Bishop && diagonalLine) ||
                (kind == T.PieceKind.Queen && (straight || diagonalLine));
        if (!lineOk) return (false, squares);
        int256 distance = ax > ay ? ax : ay;
        if (uint256(distance) > SLIDER_RANGE) return (false, squares);
        return (true, _path(fx, fy, dx / distance, dy / distance, distance));
    }

    /// @dev A pawn's move: one forward, two forward on its first move (the
    ///      skipped square follows the destination), or one diagonally forward.
    function _pawnSquares(
        T.Piece memory piece,
        uint64 to,
        int256 dx,
        int256 dy
    ) private pure returns (bool, uint64[] memory squares) {
        (int256 px, int256 py) = _step(piece.forward);
        if (dx == px && dy == py) return (true, _one(to));
        if (dx == 2 * px && dy == 2 * py) {
            if (piece.moved) return (false, squares);
            squares = new uint64[](2);
            squares[0] = to;
            squares[1] = PositionUtils.offset(
                piece.position,
                int32(px),
                int32(py)
            );
            return (true, squares);
        }
        bool diagonal =
            px == 0 ? (dy == py && _abs(dx) == 1) : (dx == px && _abs(dy) == 1);
        return diagonal ? (true, _one(to)) : (false, squares);
    }

    /// @dev The destination of a king's move, then its eight neighbours.
    function _kingSquares(
        uint64 to
    ) private pure returns (uint64[] memory squares) {
        squares = new uint64[](9);
        squares[0] = to;
        uint256 n = 1;
        for (int32 oy = -1; oy <= 1; oy++) {
            for (int32 ox = -1; ox <= 1; ox++) {
                if (ox == 0 && oy == 0) continue;
                squares[n++] = PositionUtils.offset(to, ox, oy);
            }
        }
    }

    /// @dev A slide of `distance` steps of (`sx`,`sy`) from (`fx`,`fy`): the
    ///      destination, then every square passed over.
    function _path(
        int32 fx,
        int32 fy,
        int256 sx,
        int256 sy,
        int256 distance
    ) private pure returns (uint64[] memory squares) {
        squares = new uint64[](uint256(distance));
        squares[0] = PositionUtils.fromXY(
            int32(fx + sx * distance),
            int32(fy + sy * distance)
        );
        for (int256 k = 1; k < distance; k++) {
            squares[uint256(k)] = PositionUtils.fromXY(
                int32(fx + sx * k),
                int32(fy + sy * k)
            );
        }
    }

    /// @notice Whether `piece` may move to `to`, given `contents`: what stood
    ///         at the start of the cycle on each of {moveSquares}' squares, in
    ///         the same order (kind `None` for an empty square).
    function isLegalMove(
        T.Piece memory piece,
        uint64 to,
        T.Piece[] memory contents
    ) internal pure returns (bool) {
        (bool shapeOk, uint64[] memory squares) = moveSquares(piece, to);
        if (!shapeOk || contents.length != squares.length) return false;
        T.Piece memory target = contents[0];
        bool empty = target.kind == T.PieceKind.None;
        bool enemy = !empty && target.army != piece.army;

        if (piece.kind == T.PieceKind.Pawn) {
            (int256 px, ) = _step(piece.forward);
            (int32 fx, int32 fy) = PositionUtils.toXY(piece.position);
            (int32 toX, int32 toY) = PositionUtils.toXY(to);
            // A diagonal leaves the line the pawn advances along.
            bool diagonal = px == 0 ? toX != fx : toY != fy;
            if (diagonal) return enemy; // it only ever captures
            for (uint256 i = 0; i < contents.length; i++) {
                if (contents[i].kind != T.PieceKind.None) return false;
            }
            return true;
        }
        if (!empty && !enemy) return false; // never onto one's own piece
        if (piece.kind == T.PieceKind.King) {
            for (uint256 i = 1; i < contents.length; i++) {
                if (
                    contents[i].kind == T.PieceKind.King &&
                    contents[i].army != piece.army
                ) {
                    return false;
                }
            }
            return true;
        }
        // A slider's path must be empty; a knight has none.
        for (uint256 i = 1; i < contents.length; i++) {
            if (contents[i].kind != T.PieceKind.None) return false;
        }
        return true;
    }

    /// @notice Every square `piece` could move to by shape alone, before the
    ///         board is consulted: what the simulation route filters with
    ///         {isLegalMove} to list a piece's legal destinations.
    function candidateMoves(
        T.Piece memory piece
    ) internal pure returns (uint64[] memory moves) {
        (int32 fx, int32 fy) = PositionUtils.toXY(piece.position);
        T.PieceKind kind = piece.kind;
        uint256 n = 0;
        if (kind == T.PieceKind.Pawn) {
            (int256 px, int256 py) = _step(piece.forward);
            moves = new uint64[](4);
            moves[n++] = PositionUtils.fromXY(int32(fx + px), int32(fy + py));
            if (!piece.moved) {
                moves[n++] = PositionUtils.fromXY(
                    int32(fx + 2 * px),
                    int32(fy + 2 * py)
                );
            }
            // The two diagonals: forward plus one step across.
            (int256 qx, int256 qy) = (py, px);
            moves[n++] = PositionUtils.fromXY(
                int32(fx + px + qx),
                int32(fy + py + qy)
            );
            moves[n++] = PositionUtils.fromXY(
                int32(fx + px - qx),
                int32(fy + py - qy)
            );
        } else if (kind == T.PieceKind.Knight || kind == T.PieceKind.King) {
            moves = new uint64[](8);
            for (int32 oy = -2; oy <= 2; oy++) {
                for (int32 ox = -2; ox <= 2; ox++) {
                    int32 a = ox < 0 ? -ox : ox;
                    int32 b = oy < 0 ? -oy : oy;
                    bool ok =
                        kind == T.PieceKind.Knight
                            ? (a == 1 && b == 2) || (a == 2 && b == 1)
                            : a <= 1 && b <= 1 && (a + b) > 0;
                    if (ok) moves[n++] = PositionUtils.fromXY(fx + ox, fy + oy);
                }
            }
        } else if (
            kind == T.PieceKind.Rook ||
            kind == T.PieceKind.Bishop ||
            kind == T.PieceKind.Queen
        ) {
            moves = new uint64[](8 * SLIDER_RANGE);
            for (int32 oy = -1; oy <= 1; oy++) {
                for (int32 ox = -1; ox <= 1; ox++) {
                    if (ox == 0 && oy == 0) continue;
                    bool diagonalLine = ox != 0 && oy != 0;
                    if (kind == T.PieceKind.Rook && diagonalLine) continue;
                    if (kind == T.PieceKind.Bishop && !diagonalLine) continue;
                    for (int32 k = 1; k <= int32(int256(SLIDER_RANGE)); k++) {
                        moves[n++] = PositionUtils.fromXY(
                            fx + ox * k,
                            fy + oy * k
                        );
                    }
                }
            }
        }
        assembly {
            mstore(moves, n)
        }
    }

    // ------------------------------------------------------------------------
    // RESOLVING A SQUARE
    // ------------------------------------------------------------------------

    /// @notice What stands on a square once one cycle's accumulated facts are
    ///         applied to what stood there at its start
    ///         (`docs/adr/0002-order-free-lazy-resolution.md`).
    /// @param standing what stood there at the start of the cycle
    /// @param departed whether that piece moved away in the cycle
    /// @param arrivals how many pieces arrived in the cycle
    /// @param arriver the piece that arrived, meaningful when `arrivals` is 1
    /// @dev FROM COUNTS AND IDENTITIES ALONE, so it cannot depend on the order
    ///      the reveals landed in. One arrival takes the square, whatever
    ///      stood there (a capture, or a plain move onto an empty square). Two
    ///      or more arrivals all fail, and the square is left as if none had
    ///      come: empty if its piece moved away, still held if it stayed. A
    ///      piece never bounces back to where it came from. King squares
    ///      behave like any other until the king's rows of the collision table
    ///      are a rule (`work/tasks/backlog/chess-king-capture-merge.md`).
    function settle(
        T.Piece memory standing,
        bool departed,
        uint256 arrivals,
        T.Piece memory arriver
    ) internal pure returns (T.Piece memory) {
        if (arrivals == 1) {
            arriver.position = standing.position;
            return arriver;
        }
        if (departed) {
            T.Piece memory empty;
            empty.position = standing.position;
            return empty;
        }
        return standing;
    }

    /// @dev The unit step a pawn facing `forward` advances by.
    function _step(
        T.Direction forward
    ) private pure returns (int256 x, int256 y) {
        if (forward == T.Direction.North) return (0, 1);
        if (forward == T.Direction.East) return (1, 0);
        if (forward == T.Direction.South) return (0, -1);
        return (-1, 0);
    }

    function _one(uint64 square) private pure returns (uint64[] memory one) {
        one = new uint64[](1);
        one[0] = square;
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

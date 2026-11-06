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
    // One layout for every army, centred on its spawn point (`docs/adr/0015`):
    // a 5 by 5 square without its corners, rows going up the board:
    //
    //   row 4   .  P  P  P  .      y = sy + 2
    //   row 3   P  R  N  B  P      y = sy + 1
    //   row 2   P  Q  K  .  P      y = sy        <- the king on the spawn point
    //   row 1   P  B  N  R  P      y = sy - 1
    //   row 0   .  P  P  P  .      y = sy - 2
    //           x = sx-2 ... sx+2
    //
    // There is no facing: a pawn steps and captures every way. THE FOOTPRINT
    // is the 21 squares of the square without its corners, the empty core
    // square (row 2, column 3) included, so a deployment's king always has
    // its free square.

    /// @notice How many pieces an army is deployed with.
    uint256 internal constant ARMY_SIZE = 20;

    /// @notice How far a footprint reaches from its spawn point on each axis.
    int32 internal constant FOOTPRINT_REACH = 2;

    /// @notice The pieces of an army deployed at `spawnPoint`, none moved.
    function layout(
        uint64 spawnPoint,
        uint256 army
    ) internal pure returns (T.Piece[] memory pieces) {
        pieces = new T.Piece[](ARMY_SIZE);
        uint256 n = 0;
        for (uint256 r = 0; r < 5; r++) {
            for (uint256 c = 0; c < 5; c++) {
                T.PieceKind kind = _canonical(r, c);
                if (kind == T.PieceKind.None) continue;
                pieces[n] = T.Piece({
                    position: layoutSquare(spawnPoint, r, c),
                    army: army,
                    kind: kind
                });
                n++;
            }
        }
    }

    /// @notice The square of row `r`, column `c` of the layout of an army
    ///         deployed at `spawnPoint` (see {layout}): (sx - 2 + c, sy - 2 + r).
    function layoutSquare(
        uint64 spawnPoint,
        uint256 r,
        uint256 c
    ) internal pure returns (uint64) {
        return
            PositionUtils.offset(
                spawnPoint,
                int32(int256(c)) - FOOTPRINT_REACH,
                int32(int256(r)) - FOOTPRINT_REACH
            );
    }

    /// @notice Whether row `r`, column `c` of the 5 by 5 square is on the
    ///         footprint: every cell but the four corners.
    function onFootprint(uint256 r, uint256 c) internal pure returns (bool) {
        return !((r == 0 || r == 4) && (c == 0 || c == 4));
    }

    /// @notice What a piece of `kind` is worth when a table's stakes are
    ///         split by material at its cap: pawn 1, knight 3, bishop 3,
    ///         rook 5, queen 9, and nothing for a king or an empty square.
    function materialOf(T.PieceKind kind) internal pure returns (uint256) {
        if (kind == T.PieceKind.Pawn) return 1;
        if (kind == T.PieceKind.Knight || kind == T.PieceKind.Bishop) return 3;
        if (kind == T.PieceKind.Rook) return 5;
        if (kind == T.PieceKind.Queen) return 9;
        return 0;
    }

    /// @notice Where the king of an army deployed at `spawnPoint` stands: on
    ///         the spawn point itself.
    function kingOf(uint64 spawnPoint) internal pure returns (uint64) {
        return spawnPoint;
    }

    /// @dev The piece at row `r`, column `c` of the layout; `None` on the
    ///      four corners and on the empty core square.
    function _canonical(
        uint256 r,
        uint256 c
    ) private pure returns (T.PieceKind) {
        if (!onFootprint(r, c)) return T.PieceKind.None;
        if (r == 0 || r == 4 || c == 0 || c == 4) return T.PieceKind.Pawn;
        if (r == 2) {
            // P Q K . P
            if (c == 1) return T.PieceKind.Queen;
            if (c == 2) return T.PieceKind.King;
            return T.PieceKind.None;
        }
        // row 3: P R N B P, row 1: P B N R P
        if (c == 2) return T.PieceKind.Knight;
        if ((r == 3) == (c == 1)) return T.PieceKind.Rook;
        return T.PieceKind.Bishop;
    }

    /// @notice The piece an army deployed at `spawnPoint` has on `position`
    ///         before anything moves: kind `None` off its footprint, on the
    ///         corners and on the empty core square. The inverse of {layout},
    ///         one square at a time, which is what lets a square be read
    ///         without laying the whole army out.
    function layoutAt(
        uint64 spawnPoint,
        uint256 army,
        uint64 position
    ) internal pure returns (T.Piece memory piece) {
        piece.position = position;
        (bool on, uint256 r, uint256 c) = footprintCell(spawnPoint, position);
        if (!on) return piece;
        T.PieceKind kind = _canonical(r, c);
        if (kind == T.PieceKind.None) return piece;
        piece.army = army;
        piece.kind = kind;
    }

    /// @notice Whether `position` is on the footprint of a deployment at
    ///         `spawnPoint` (see {onFootprint}), and its row and column.
    function footprintCell(
        uint64 spawnPoint,
        uint64 position
    ) internal pure returns (bool on, uint256 r, uint256 c) {
        (int32 sx, int32 sy) = PositionUtils.toXY(spawnPoint);
        (int32 x, int32 y) = PositionUtils.toXY(position);
        int256 dc = int256(x) - sx + FOOTPRINT_REACH;
        int256 dr = int256(y) - sy + FOOTPRINT_REACH;
        if (dr < 0 || dr > 4 || dc < 0 || dc > 4) return (false, 0, 0);
        r = uint256(dr);
        c = uint256(dc);
        on = onFootprint(r, c);
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
    //      rest. `squares[0]` is always the destination; a slider's path
    //      follows it, and a king's eight neighbours of the destination do.
    //   2. {isLegalMove}: given what stood on each of those squares, whether
    //      the move is legal.
    //
    // No castling, no en passant, no pawn double step and no pawn promotion:
    // none of them has a shape here, so all four are simply illegal moves (the one promotion,
    // of a piece that takes a king, is {settle}'s). No check: a king may move
    // onto an attacked square (story 19). But a king may not move next to
    // another army's king, measured on the start-of-cycle board, except onto
    // that king's own square, which is a capture: that is what makes two kings
    // arriving on one square impossible
    // (`docs/adr/0003-collision-table-king-survives-a-crowd.md`).
    //
    // AN ARMY'S MOVE IS UP TO {MAX_PIECE_MOVES} PIECE-MOVES, each by a different
    // piece, and they are SIMULTANEOUS
    // (`docs/adr/0016-an-army-moves-up-to-three-pieces-a-cycle-simultaneously.md`):
    // each is judged on the start-of-cycle board with the army's own pieces
    // that move this cycle counted as gone ({vacate}), so a piece may move onto
    // or slide through a square its own army leaves, and two may swap. That is
    // for the LEGALITY CHECK ONLY: what a square's record keeps as its standing
    // piece, and what could be captured there, stay the start-of-cycle facts.

    /// @notice How far a rook, a bishop or a queen may slide (story 16).
    uint256 internal constant SLIDER_RANGE = 7;

    /// @notice How many piece-moves an army's move holds at most: none (a
    ///         pass), one, two or three, each by a different piece
    ///         (`docs/adr/0016`).
    uint256 internal constant MAX_PIECE_MOVES = 3;

    /// @notice Whether `moves` can be ONE army's move of at most
    ///         `maxPieceMoves` piece-moves: none moves one piece twice and no
    ///         two go to one square ({joins}). And the squares the move
    ///         vacates, its origins, for {vacate}.
    /// @dev The reveal and the simulation route both ask this, so the cap and
    ///      the two refusals are one rule (`docs/adr/0016`). It judges no
    ///      piece-move: that is {isLegalMove}'s, on {vacate}d contents.
    ///      `calldata`, as the reveal holds its moves: a copy to memory put
    ///      the Reveal route over the code size limit.
    function vacatedBy(
        T.Move[] calldata moves,
        uint256 maxPieceMoves
    ) internal pure returns (bool oneMove, uint64[] memory vacated) {
        uint256 n = moves.length;
        if (n > maxPieceMoves) return (false, vacated);
        vacated = new uint64[](n);
        for (uint256 i = 0; i < n; i++) {
            uint64 from = moves[i].from;
            if (!joins(moves, i, from, moves[i].to)) return (false, vacated);
            vacated[i] = from;
        }
        oneMove = true;
    }

    /// @notice Whether a piece-move from `from` to `to` may be in one move
    ///         with the first `count` of `moves`: it moves a different piece,
    ///         to a different square, from each of them.
    function joins(
        T.Move[] calldata moves,
        uint256 count,
        uint64 from,
        uint64 to
    ) internal pure returns (bool) {
        for (uint256 j = 0; j < count; j++) {
            if (moves[j].from == from || moves[j].to == to) return false;
        }
        return true;
    }

    /// @notice Make `contents` what the legality check judges: every one of
    ///         `squares` that is in `vacated` and holds a piece of `army` reads
    ///         as empty, because that piece moves away in the same cycle.
    /// @param squares {moveSquares}' squares, in order
    /// @param contents what stood on each of them at the start of the cycle,
    ///        whose entries are REPLACED, never changed: a caller that keeps an
    ///        entry (the destination's, which is the start-of-cycle fact a
    ///        square's record keeps, and what could be taken there,
    ///        `docs/adr/0002`) still holds the real piece.
    /// @param army the army whose move this is
    /// @param vacated the origins of every piece-move of the army's move
    /// @dev A set membership, so it cannot depend on the order the piece-moves
    ///      are listed in. A move of ONE piece-move changes nothing, so it
    ///      costs nothing: a piece's own origin is never one of its
    ///      {moveSquares} but a king's, among its destination's neighbours,
    ///      where it is its own king, which the king rule ignores.
    function vacate(
        uint64[] memory squares,
        T.Piece[] memory contents,
        uint256 army,
        uint64[] memory vacated
    ) internal pure {
        if (vacated.length < 2) return;
        for (uint256 i = 0; i < contents.length; i++) {
            // An empty square is army zero, which is never an army's id.
            if (contents[i].army != army) continue;
            for (uint256 k = 0; k < vacated.length; k++) {
                if (vacated[k] != squares[i]) continue;
                T.Piece memory gone;
                gone.position = squares[i];
                contents[i] = gone;
                break;
            }
        }
    }

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
        int256 ax = _abs(dx);
        int256 ay = _abs(dy);
        if (kind == T.PieceKind.Pawn) {
            // One square orthogonally, or one diagonally (a capture).
            if (ax > 1 || ay > 1) return (false, squares);
            return (true, _one(to));
        }
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
            (int32 fx, int32 fy) = PositionUtils.toXY(piece.position);
            (int32 toX, int32 toY) = PositionUtils.toXY(to);
            // A diagonal only ever captures; a step only ever onto an empty
            // square, whichever of the four ways it goes.
            if (toX != fx && toY != fy) return enemy;
            return empty;
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
        if (
            kind == T.PieceKind.Pawn ||
            kind == T.PieceKind.Knight ||
            kind == T.PieceKind.King
        ) {
            // A pawn's and a king's eight neighbours are the same squares:
            // {isLegalMove} tells a pawn's steps from its captures.
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
    /// @param arrivals how many pieces arrived in the cycle, a king included
    /// @param king the king that arrived; kind `None` if none did. At most one
    ///        can: no two kings can reach one square in one cycle
    ///        (`docs/adr/0003-collision-table-king-survives-a-crowd.md`)
    /// @param arriver the first piece other than a king that arrived,
    ///        meaningful when it is the only one
    /// @param captorFell whether the army of the piece that took a king or a
    ///        stone here ({kingCapture}'s captor) lost its own king in the
    ///        same cycle, taken or leaving through an exit, which no one
    ///        square's facts can say: the caller reads it one level deep
    ///        (`docs/adr/0014`). Ignored when nothing was taken.
    /// @dev FROM COUNTS AND IDENTITIES ALONE, so it cannot depend on the order
    ///      the reveals landed in. THE COLLISION TABLE
    ///      (`docs/adr/0003-collision-table-king-survives-a-crowd.md`, its
    ///      moving-king row amended by `docs/adr/0013`), its king rows first:
    ///
    ///      - a moving king and 2+ other pieces: the king lands, capturing a
    ///        piece that stayed, and the others die;
    ///      - a moving king and exactly 1 other piece: the king dies, and that
    ///        piece lands as a QUEEN, capturing whatever stayed there (both
    ///        victims are its army's when a king or a stone stayed);
    ///      - one arrival takes the square, whatever stood there (a capture, or
    ///        a plain move onto an empty square), and lands as a QUEEN if it
    ///        took a king and is not one (`docs/adr/0013`); a stone taken
    ///        gives no promotion;
    ///      - two or more arrivals without a king all fail, and the square is
    ///        left as if none had come: empty if its piece moved away, still
    ///        held if it stayed.
    ///
    ///      A STONE (`docs/adr/0014`): when the captor's king fell in the same
    ///      cycle, the capturing piece is gone with its army, and what it took
    ///      is a stone on the square: the king or stone that stayed there if
    ///      one did, otherwise the moving king it met.
    ///
    ///      A piece never bounces back to where it came from.
    function settle(
        T.Piece memory standing,
        bool departed,
        uint256 arrivals,
        T.Piece memory king,
        T.Piece memory arriver,
        bool captorFell
    ) internal pure returns (T.Piece memory) {
        bool kingCame = king.kind != T.PieceKind.None;
        bool prey = !departed && _isPrey(standing.kind);
        if (kingCame && arrivals == 2) {
            if (captorFell) return _stone(prey ? standing : king, standing);
            return _queen(arriver, standing.position);
        }
        if (arrivals == 1 || (kingCame && arrivals > 2)) {
            T.Piece memory lands = kingCame ? king : arriver;
            lands.position = standing.position;
            if (!prey) return lands;
            if (captorFell) return _stone(standing, standing);
            if (
                standing.kind == T.PieceKind.King &&
                lands.kind != T.PieceKind.King
            ) {
                return _queen(lands, standing.position);
            }
            return lands;
        }
        if (departed) {
            T.Piece memory empty;
            empty.position = standing.position;
            return empty;
        }
        return standing;
    }

    /// @dev Whether a piece of `kind` that stayed carries a stake for whoever
    ///      takes it: a king, or a stone.
    function _isPrey(T.PieceKind kind) private pure returns (bool) {
        return kind == T.PieceKind.King || kind == T.PieceKind.Stone;
    }

    /// @dev `piece` promoted to a queen on `position`.
    function _queen(
        T.Piece memory piece,
        uint64 position
    ) private pure returns (T.Piece memory queen) {
        queen.position = position;
        queen.army = piece.army;
        queen.kind = T.PieceKind.Queen;
    }

    /// @dev A stone of `victim`'s army, on `square`'s position.
    function _stone(
        T.Piece memory victim,
        T.Piece memory square
    ) private pure returns (T.Piece memory stone) {
        stone.position = square.position;
        stone.army = victim.army;
        stone.kind = T.PieceKind.Stone;
    }

    /// @notice What one cycle's facts did to a square, as {settle} resolves
    ///         it: the piece captured there, and how many arriving pieces died
    ///         there in a collision.
    /// @param standing what stood there at the start of the cycle
    /// @param departed whether that piece moved away in the cycle
    /// @param arrivals how many pieces arrived in the cycle, a king included
    /// @param kingCame whether one of them was a king
    /// @return captured the piece that stayed and was taken, by a lone arrival,
    ///         by a king arriving with two or more others, or by the one piece
    ///         a moving king met; kind `None` (at the square) if nothing that
    ///         stayed was taken. A piece that moved away is never captured on
    ///         its old square.
    /// @return died how many of the arriving pieces died there: all of them
    ///         when two or more arrived without a king, the king's two or more
    ///         companions when it survives them, and the king when it met
    ///         exactly one piece
    /// @dev The SAME TABLE as {settle}, read for what it destroyed rather than
    ///      what it left, so the client can show a cycle's captures and
    ///      collisions without a copy of the rule
    ///      (`docs/adr/0007-rules-live-only-in-the-contract.md`). Change the
    ///      two together. Whether what was taken became a stone is what the
    ///      square holds now, which the caller reads with {settle}.
    function outcome(
        T.Piece memory standing,
        bool departed,
        uint256 arrivals,
        bool kingCame
    ) internal pure returns (T.Piece memory captured, uint256 died) {
        captured.position = standing.position;
        bool kingWins = kingCame && arrivals > 2;
        bool kingDies = kingCame && arrivals == 2;
        if (arrivals == 1 || kingWins || kingDies) {
            if (!departed && standing.kind != T.PieceKind.None) {
                captured = standing;
            }
            if (kingWins) died = arrivals - 1;
            if (kingDies) died = 1;
        } else if (arrivals > 1) {
            died = arrivals;
        }
    }

    /// @notice Whose king or stone one cycle's facts on a square took, and by
    ///         which army: zero for all three if nothing was.
    /// @return standingVictim the army of the king or stone that stayed and
    ///         was taken
    /// @return kingVictim the army of the moving king that died meeting
    ///         exactly one other piece
    /// @return captor the army of the piece that took them
    /// @dev The SAME TABLE as {settle} again, read for the captures that move
    ///      a stake (`docs/adr/0013`, `docs/adr/0014`):
    ///
    ///      - a king or stone that stayed, taken by a lone arrival (a king
    ///        included), is the arriver's;
    ///      - a king or stone that stayed, taken by a moving king that arrived
    ///        with two or more others, is the moving king's;
    ///      - a moving king that arrived with exactly one other piece is that
    ///        piece's, and so is a king or stone that stayed there.
    ///
    ///      `army` on the pieces given is the army each one played for at the
    ///      start of the cycle. Whether the captor keeps what it took, or its
    ///      own king fell in the same cycle and what it took is a stone, is
    ///      the caller's to read (`captorFell` of {settle}).
    ///
    ///      Only kinds and armies matter here, so it takes those alone: the
    ///      standing piece's, and the arriving king's and arriver's armies
    ///      (`kingArmy` zero when no king arrived).
    function kingCapture(
        T.PieceKind standingKind,
        uint256 standingArmy,
        bool departed,
        uint256 arrivals,
        uint256 kingArmy,
        uint256 arriverArmy
    )
        internal
        pure
        returns (uint256 standingVictim, uint256 kingVictim, uint256 captor)
    {
        bool kingCame = kingArmy != 0;
        bool prey = !departed && _isPrey(standingKind);
        if (kingCame && arrivals == 2) {
            return (prey ? standingArmy : 0, kingArmy, arriverArmy);
        }
        if (!prey) return (0, 0, 0);
        if (arrivals == 1) {
            return (standingArmy, 0, kingCame ? kingArmy : arriverArmy);
        }
        if (kingCame && arrivals > 2) return (standingArmy, 0, kingArmy);
        return (0, 0, 0);
    }

    function _one(uint64 square) private pure returns (uint64[] memory one) {
        one = new uint64[](1);
        one[0] = square;
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

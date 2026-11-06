// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.0;

import "../internal/UsingGameInternal.sol";
import "../interfaces/IGame.sol";

/// @dev THE GAME'S RULES, CALLABLE WITHOUT A CHAIN. A client runs this route's
///      deployed bytecode in its own sandbox (`web/src/lib/game/simulation/`)
///      to preview what a plan does, so the preview is the rule the board is
///      resolved with and not a copy of it
///      (`docs/adr/0007-rules-live-only-in-the-contract.md`). It reads NO
///      storage, which is what makes that possible: the sandbox holds the code
///      and none of the state.
contract GameSimulation is IGameSimulation, UsingGameInternal {
    constructor(Config memory config) UsingGameInternal(config) {}

    /// @inheritdoc IGameSimulation
    /// @dev `view` and not `pure` only because it reads {SPAWN_SPACING}, an
    ///      immutable, which lives in this contract's code: run from the
    ///      deployed bytes, it is the deployment's grid.
    function previewDeployment(
        uint64 spawnPoint,
        uint256 army
    ) external view returns (Piece[] memory pieces) {
        (bool onGrid, ) = ChessRules.spawnIndexOf(spawnPoint, SPAWN_SPACING);
        if (!onGrid) revert NotASpawnPoint(spawnPoint);
        return ChessRules.layout(spawnPoint, army);
    }

    /// @inheritdoc IGameSimulation
    function legalMoves(
        Piece[] calldata board,
        uint64 from
    ) external pure returns (uint64[] memory destinations) {
        // LOAD, from what the caller handed in rather than from storage: the
        // board as it stood at the start of the cycle, as `getPieces` returns
        // it. Then the reveal's own rule, square by square.
        Piece memory piece = _onBoard(board, from);
        if (piece.kind == PieceKind.None) return destinations;
        uint64[] memory candidates = ChessRules.candidateMoves(piece);
        destinations = new uint64[](candidates.length);
        uint256 n = 0;
        for (uint256 c = 0; c < candidates.length; c++) {
            (bool shapeOk, uint64[] memory squares) = ChessRules.moveSquares(
                piece,
                candidates[c]
            );
            if (!shapeOk) continue;
            Piece[] memory contents = new Piece[](squares.length);
            for (uint256 i = 0; i < squares.length; i++) {
                contents[i] = _onBoard(board, squares[i]);
            }
            if (ChessRules.isLegalMove(piece, candidates[c], contents)) {
                destinations[n++] = candidates[c];
            }
        }
        assembly {
            mstore(destinations, n)
        }
    }

    /// @inheritdoc IGameSimulation
    /// @dev THE REVEAL'S JUDGMENT OF A MOVE ({UsingGameInternal-_reveal} and
    ///      {UsingGameBoard-_judgeMove}), on `board` rather than storage: the
    ///      cap and the refusals ({ChessRules-vacatedBy}), then every
    ///      piece-move by one of `army`'s pieces and legal on the start-of-cycle
    ///      contents with the move's vacated squares masked
    ///      ({ChessRules-vacate}).
    function isLegalWholeMove(
        Piece[] calldata board,
        uint256 army,
        Move[] calldata moves,
        uint256 maxPieceMoves
    ) external pure returns (bool legal) {
        (bool oneMove, uint64[] memory vacated) = ChessRules.vacatedBy(
            moves,
            maxPieceMoves
        );
        if (!oneMove) return false;
        return _allLegal(board, army, moves, vacated);
    }

    /// @inheritdoc IGameSimulation
    /// @dev {isLegalWholeMove} of `others` plus this piece's piece-move, with
    ///      what does not depend on the destination judged once: the cap (room
    ///      for one more, {ChessRules-vacatedBy} at one less), the squares
    ///      vacated (`others`' origins and `from`), and `others` themselves.
    ///      Then per destination, the refusals ({ChessRules-joins}: a piece
    ///      already in `others` is offered nothing) and the piece-move's own
    ///      legality.
    function legalMovesAlongside(
        Piece[] calldata board,
        uint64 from,
        Move[] calldata others,
        uint256 maxPieceMoves
    ) external pure returns (uint64[] memory destinations) {
        Piece memory piece = _onBoard(board, from);
        if (piece.kind == PieceKind.None || maxPieceMoves == 0) {
            return destinations;
        }
        (bool oneMove, uint64[] memory theirs) = ChessRules.vacatedBy(
            others,
            maxPieceMoves - 1
        );
        if (!oneMove) return destinations;
        uint64[] memory vacated = new uint64[](theirs.length + 1);
        for (uint256 i = 0; i < theirs.length; i++) vacated[i] = theirs[i];
        vacated[theirs.length] = from;
        if (!_allLegal(board, piece.army, others, vacated)) return destinations;

        return _offered(board, piece, others, vacated);
    }

    /// @inheritdoc IGameSimulation
    function materialOf(PieceKind kind) external pure returns (uint256) {
        return ChessRules.materialOf(kind);
    }

    /// @dev The destinations {legalMovesAlongside} offers `piece`, once
    ///      `others` are judged legal with `vacated` counted as gone.
    function _offered(
        Piece[] calldata board,
        Piece memory piece,
        Move[] calldata others,
        uint64[] memory vacated
    ) private pure returns (uint64[] memory destinations) {
        uint64[] memory candidates = ChessRules.candidateMoves(piece);
        destinations = new uint64[](candidates.length);
        uint256 n = 0;
        for (uint256 c = 0; c < candidates.length; c++) {
            uint64 to = candidates[c];
            if (
                ChessRules.joins(others, others.length, piece.position, to) &&
                _isLegal(board, piece.army, piece.position, to, vacated)
            ) {
                destinations[n++] = to;
            }
        }
        assembly {
            mstore(destinations, n)
        }
    }

    /// @dev Whether every one of `moves` is legal for `army` with `vacated`
    ///      counted as gone.
    function _allLegal(
        Piece[] calldata board,
        uint256 army,
        Move[] calldata moves,
        uint64[] memory vacated
    ) private pure returns (bool) {
        for (uint256 m = 0; m < moves.length; m++) {
            if (!_isLegal(board, army, moves[m].from, moves[m].to, vacated)) {
                return false;
            }
        }
        return true;
    }

    /// @dev {UsingGameBoard-_judgeMove} on `board`: the piece on `from` is
    ///      `army`'s and may move to `to` on the start-of-cycle contents with
    ///      `army`'s pieces on `vacated` counted as gone ({ChessRules-vacate}).
    function _isLegal(
        Piece[] calldata board,
        uint256 army,
        uint64 from,
        uint64 to,
        uint64[] memory vacated
    ) private pure returns (bool) {
        // An empty square's piece has army zero, which is never an army.
        Piece memory piece = _onBoard(board, from);
        (bool legal, uint64[] memory squares) = ChessRules.moveSquares(
            piece,
            to
        );
        if (!legal || piece.army != army) return false;
        Piece[] memory contents = new Piece[](squares.length);
        for (uint256 i = 0; i < squares.length; i++) {
            contents[i] = _onBoard(board, squares[i]);
        }
        ChessRules.vacate(squares, contents, army, vacated);
        return ChessRules.isLegalMove(piece, to, contents);
    }

    /// @dev What `board` has on `position`: kind `None` if nothing.
    function _onBoard(
        Piece[] calldata board,
        uint64 position
    ) private pure returns (Piece memory piece) {
        for (uint256 i = 0; i < board.length; i++) {
            if (board[i].position == position) return board[i];
        }
        piece.position = position;
    }
}

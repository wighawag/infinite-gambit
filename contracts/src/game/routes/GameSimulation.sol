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
    function materialOf(PieceKind kind) external pure returns (uint256) {
        return ChessRules.materialOf(kind);
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

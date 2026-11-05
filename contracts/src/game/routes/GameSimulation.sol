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
}

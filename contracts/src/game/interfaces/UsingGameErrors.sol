// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {UsingCommitRevealErrors} from "../../commit-reveal/interfaces/UsingCommitRevealErrors.sol";

/// @dev The mechanism's errors are inherited from the commit-reveal base
///      (`src/commit-reveal/`). What is declared here is this game's own.
interface UsingGameErrors is UsingCommitRevealErrors {
    /// @notice The deployment parameters cannot make a board: spawn points
    ///         closer than an army's footprint, or no spawn point ever open.
    error InvalidSpawnGrid();

    /// @notice A deployment's reveal must hold exactly one `Move` whose `from`
    ///         and `to` are both the spawn point, in one chunk.
    error InvalidDeployment();

    /// @notice The position is not on the spawn grid.
    error NotASpawnPoint(uint64 position);

    /// @notice The spawn point was not open at the start of this cycle.
    error SpawnPointNotOpen(uint64 position);

    /// @notice The move is not one this army may make.
    error IllegalMove(uint64 from, uint64 to);
}

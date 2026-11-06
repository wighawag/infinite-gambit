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

    /// @notice The move is not one this army may make on the board as it stood
    ///         at the start of the cycle.
    error IllegalMove(uint64 from, uint64 to);

    /// @notice A submission after an army's deployment is ONE move, in one
    ///         chunk: a pass (nothing) or up to three piece-moves, each by a
    ///         different piece and none two to one square (`docs/adr/0016`).
    error OneMovePerCycle();
    /// @notice The army has not left the board through an exit (yet).
    error NotExited(uint256 army);
    /// @notice The exited army's stake was already paid.
    error AlreadyPaid(uint256 army);

    /// @notice The table was created with `gameOptions` this game cannot read
    ///         (a bit set other than `ChessRules.ONE_PIECE_MOVE`), so nobody
    ///         may take a seat at it.
    error UnreadableGameOptions(bytes32 gameOptions);
    /// @notice A table's seat is bought with exactly one stake.
    error WrongStake(uint256 amount, uint256 stake);
    /// @notice Only the account that owns an army may take its stake back.
    error NotArmyOwner(uint256 army);
    /// @notice Neither one king stands nor is the table's last cycle over.
    error TableNotOver();
    /// @notice The army is owed nothing by the table's outcome.
    error NothingToClaim(uint256 army);
}

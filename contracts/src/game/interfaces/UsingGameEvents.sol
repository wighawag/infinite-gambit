// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "./UsingGameTypes.sol";
import {UsingCommitRevealEvents} from "../../commit-reveal/interfaces/UsingCommitRevealEvents.sol";

/// @dev THE MECHANISM'S EVENTS ARE INHERITED from the commit-reveal base
///      (`src/commit-reveal/`): reserve, commitment, reveal, settlement, cycle
///      and attendance. What is declared here is this game's.
///
///      Events are for history, never for state: the board is read through the
///      resolving views (`docs/adr/0007-rules-live-only-in-the-contract.md`).
interface UsingGameEvents is UsingGameTypes, UsingCommitRevealEvents {
    /// @notice A deployment was committed, which created the army and moved the
    ///         stake from its owner's reserve into its own.
    event ArmyCreated(
        uint256 indexed army,
        address indexed owner,
        uint64 cycleNumber,
        uint256 stake
    );

    /// @notice A deployment was revealed. Whether it lands is decided when the
    ///         cycle is over, by how many deployments revealed the same spawn
    ///         point, so this says nothing about the outcome.
    event DeploymentRevealed(
        uint256 indexed army,
        uint64 indexed spawnPoint,
        uint64 cycleNumber
    );

    /// @notice A deployment that failed (a shared spawn point, a blocked
    ///         footprint) or was cancelled had its stake moved back from the
    ///         army's reserve to its owner's account reserve.
    event DeploymentRefunded(
        uint256 indexed army,
        address indexed owner,
        uint256 amount
    );

    /// @notice A deployment that was never revealed had its stake burned.
    event StakeBurned(uint256 indexed army, uint256 amount);

    /// @notice An exited army's whole stake was paid, in ETH, to its owner.
    event ExitPaid(uint256 indexed army, address indexed owner, uint256 amount);
}

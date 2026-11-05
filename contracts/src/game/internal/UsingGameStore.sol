// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "../interfaces/UsingGameTypes.sol";
import "../interfaces/UsingGameErrors.sol";
import {UsingCommitReveal} from "../../commit-reveal/UsingCommitReveal.sol";

/// @dev THIS GAME'S STATE, AND ONLY THIS GAME'S. The reserve, the commitments,
///      the cycle and who it waits for are the commit-reveal base's
///      (`src/commit-reveal/`), held in its own namespaced storage and reached
///      through {UsingCommitReveal}; what is declared here is the armies and
///      the spawn points.
///
///      WHAT IS STORED IS FACTS, NOT THE BOARD
///      (`docs/adr/0002-order-free-lazy-resolution.md`). A reveal only records
///      what it revealed, by accumulation, and the board (which army stands
///      where, which deployment landed) is worked out from those facts when it
///      is read. Nothing is written at the end of a cycle, because nothing runs
///      then.
abstract contract UsingGameStore is
    UsingGameTypes,
    UsingGameErrors,
    UsingCommitReveal
{
    /// @notice the token players stake
    IERC20 internal immutable TOKENS;
    /// @notice what one army holds
    uint256 internal immutable STAKE;
    /// @notice the distance between two spawn points on each axis
    uint32 internal immutable SPAWN_SPACING;
    /// @notice how many free spawn points are open at once
    uint8 internal immutable OPEN_SPAWN_POINTS;

    /// @notice What the registry keeps of one army.
    /// @dev One slot. Everything else about an army is RESOLVED from the facts
    ///      (its status, its king) or is the base's (its reserve, which is its
    ///      stake).
    struct ArmyRecord {
        address owner;
        /// @notice the cycle its deployment was committed in
        uint64 deployCycle;
        /// @notice the spiral index it revealed, plus one; zero until revealed
        uint32 spawnIndexPlusOne;
        // ---- second slot: where its king went, written by its own reveals
        /// @notice the cycle its king last moved in; zero while it stands
        ///         where it was deployed
        uint64 kingMovedIn;
        /// @notice where that move took it
        uint64 kingTo;
        /// @notice where it stood before that move
        uint64 kingFrom;
        /// @notice whether its deployment was cancelled in its commit phase
        bool cancelled;
    }

    /// @notice What the reveals have recorded about one square.
    /// @dev THE PER-SQUARE LAYER, and it holds facts rather than the board
    ///      (`docs/adr/0002-order-free-lazy-resolution.md`): the piece that
    ///      stood there at the start of `cycle`, and what `cycle`'s reveals
    ///      ACCUMULATED about it (the piece leaving, how many pieces arrived,
    ///      the lone arriver, whether a king arrived). What stands there in any
    ///      later cycle is {ChessRules-settle} of the two, worked out when the
    ///      square is read; `cycle` is the LAST TOUCHED cycle, so idle cycles
    ///      cost nothing. A square no reveal ever touched has no record and
    ///      reads as the layout of the army deployed over it, if any.
    ///
    ///      Three slots: the standing piece's army, everything small, and the
    ///      arriver's army.
    struct SquareRecord {
        uint256 army;
        uint64 cycle;
        PieceKind kind;
        Direction forward;
        bool moved;
        bool departed;
        uint32 arrivals;
        bool kingArrived;
        PieceKind arriverKind;
        Direction arriverForward;
        uint256 arriverArmy;
    }

    /// @notice What the deployments revealed onto one spawn point add up to.
    /// @dev ACCUMULATED: `count` is how many deployments revealed it in
    ///      `cycle`, and `army` is meaningful only when that count is one, which
    ///      is what makes it order-free (see `_revealDeployment`).
    ///
    ///      `blocked` is whether its FOOTPRINT (the squares its layout puts a
    ///      piece on) was not clear in `cycle`: a piece stood on one at the
    ///      start of the cycle, or arrived on one during it. `arrivedIn` is the
    ///      last cycle a piece arrived on the footprint, whether or not anyone
    ///      was deploying here then: it is how an arrival revealed BEFORE the
    ///      cycle's first deployment reveal is still seen by it. Both are only
    ///      ever set, never cleared within a cycle, so they are order-free (see
    ///      `_markArrival`).
    ///
    ///      A deployment LANDS when its cycle is over, the count is one and the
    ///      footprint was not blocked. Once one has landed the record is final:
    ///      the spawn point is never open again. A failed one is overwritten by
    ///      the next cycle that reveals the spawn point, because a failed spawn
    ///      point is free.
    struct SpawnRecord {
        uint64 cycle;
        uint32 count;
        bool blocked;
        uint64 arrivedIn;
        uint256 army;
    }

    /// @notice The army registry.
    mapping(uint256 army => ArmyRecord) internal _armies;
    /// @notice Every army ever created, in order: what the registry pages over.
    uint256[] internal _armyIds;
    /// @notice How many armies each account has created; its next is one more.
    mapping(address owner => uint256 count) internal _armyCountOf;

    /// @notice Deployments, by the spiral index of their spawn point.
    mapping(uint256 index => SpawnRecord) internal _spawns;

    /// @notice The per-square layer, by packed position.
    mapping(uint64 position => SquareRecord) internal _squares;

    /// @notice THE ZONE INDEX: for each 16x16 zone (`PositionUtils.getZone`),
    ///         a bit per square that has a record, so the viewport read finds
    ///         them without reading every square in view.
    /// @dev Only ever OR-ed into, so the set it holds is the same whatever
    ///      order the reveals land in, and so is the order the read lists it.
    mapping(uint64 zone => uint256 squares) internal _touchedSquares;

    /// @notice THE OPEN SET as it was last written: the spiral indices of the
    ///         open spawn points, and the first index never yet open.
    /// @dev Its invariant is what keeps reading it bounded: every index below
    ///      `_nextSpawnIndex` that is not in `_openSpawnIndices` has had a
    ///      deployment land on it, and nothing at or above `_nextSpawnIndex` has
    ///      ever been open, so nothing there has ever been deployed to. So the
    ///      open set at the start of any later cycle is this one with each
    ///      entry that has since been deployed to replaced by the next fresh
    ///      index: K reads, whatever has happened. Written by a deployment's
    ///      reveal whenever that replacement changes it; empty (with
    ///      `_nextSpawnIndex` zero) until the first, which reads as the first K
    ///      indices.
    uint64[] internal _openSpawnIndices;
    uint64 internal _nextSpawnIndex;

    /// @notice THE ARMIES A CYCLE THAT ADVANCES MAY BE WAITING FOR: every army
    ///         created under the `Manual` or `TimedWithEarlyAdvance` policy
    ///         that the advance has not yet found dead (`_sweepDeadArmies`).
    /// @dev Empty under `Timed`, where nothing reads the waited-for count.
    ///      Bounded by the seats a world or a table has, because only those
    ///      policies fill it.
    uint256[] internal _awaitedArmies;

    /// @notice Create an instance of a game
    /// @param config configuration options for the game
    constructor(
        Config memory config
    )
        UsingCommitReveal(
            CommitRevealConfig({
                startTime: config.startTime,
                commitPhaseDuration: config.commitPhaseDuration,
                revealPhaseDuration: config.revealPhaseDuration,
                time: config.time,
                actionsPerReveal: config.actionsPerReveal,
                cyclePolicy: config.cyclePolicy
            })
        )
    {
        // Six is the widest an army stands, so spawn points any closer would
        // let two footprints share a square, and the board read assumes a
        // square belongs to at most one spawn point.
        if (config.spawnSpacing < 6 || config.openSpawnPoints == 0) {
            revert InvalidSpawnGrid();
        }
        TOKENS = config.tokens;
        STAKE = config.stake;
        SPAWN_SPACING = config.spawnSpacing;
        OPEN_SPAWN_POINTS = config.openSpawnPoints;
    }
}

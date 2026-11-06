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
        /// @notice who plays it: the account that created it
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
        /// @notice whether its king has left the board through an exit, once a
        ///         later reveal has folded the exit square's facts; false until
        ///         then (`UsingGameBoard-_exited` reads those facts meanwhile)
        bool exited;
        /// @notice whether the exit's payout has started collecting its tree
        bool collecting;
        /// @notice whether the exit has been paid
        bool paid;
        /// @notice whether a missed reveal of a move has been SETTLED, which
        ///         froze the army for good; false until somebody settles it
        ///         (`UsingGameInternal-_isFrozen` also reads the unsettled
        ///         commitment meanwhile,
        ///         `docs/adr/0005-missed-reveal-freezes-the-army.md`)
        bool frozen;
        /// @notice whether it was created by buying a seat at a TABLE, where
        ///         exits do nothing and the stake is paid out by the table's
        ///         end (`UsingGameTable`); in this slot so that every read of
        ///         `exited` sees it for free
        bool atTable;
        /// @notice whether its king has been TAKEN (it is then dead, and its
        ///         pieces other than a stone read as empty), once a later
        ///         reveal has folded the square it was taken on; false until
        ///         then (`UsingGameBoard-_fellIn` reads those facts meanwhile)
        /// @dev In this slot so that the vanish check of a live army costs
        ///      this slot and its king's square, nothing more.
        bool fallen;
        // ---- third slot: who holds its stake
        /// @notice the army its stake went to once a later reveal has folded
        ///         the capture: the army that took its king, or that took its
        ///         stone; zero until then, for an army whose king was never
        ///         taken, and for a stone nobody has taken
        ///         (`docs/adr/0013`, `docs/adr/0014`)
        /// @dev A CACHE OF A CLOSED CYCLE'S FACTS, written by `_touch` just
        ///      before it overwrites them (`UsingGameBoard-_captureOf`), or by
        ///      an exit's collection (`UsingGameInternal-_collect`).
        uint256 capturedBy;
        // ---- fourth slot: when its king fell
        /// @notice the cycle its king was taken in, once `fallen` is written;
        ///         read only to decide whether a capture by this army leaves a
        ///         stone (`docs/adr/0014`)
        uint64 fellIn;
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
    ///      Four slots: the standing piece's army, everything small, the
    ///      arriver's army and the arriving king's army. The ARRIVER is the
    ///      first piece other than a king to arrive, and the KING is kept apart
    ///      from it, because the king rows of the collision table need both:
    ///      who the king met when it met exactly one piece
    ///      (`docs/adr/0003-collision-table-king-survives-a-crowd.md`).
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
        Direction kingForward;
        uint256 arriverArmy;
        uint256 kingArmy;
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

    /// @notice THE KINGS AND STONES EACH ARMY MAY HAVE TAKEN, for its stake.
    /// @dev A SUPERSET, written at reveal time by the reveal that could make
    ///      the capture (see `UsingGameBoard-_noteCandidate`), and filtered when
    ///      read: an entry counts only if the stake of the army it names really
    ///      went to this one (`UsingGameBoard-_captureOf`), which a stone's
    ///      did not. The ORDER of the
    ///      entries can differ with the order of the reveals, and an army can be
    ///      listed more than once; what they add up to cannot differ.
    mapping(uint256 army => uint256[] victims) internal _capturesBy;

    /// @notice AN EXIT'S PAYOUT IN PROGRESS: the armies whose stakes the
    ///         exited army took, down the tree of captures, still to collect, and what has been collected.
    /// @dev See `UsingGameInternal-_collect`. Only ever written by an exit's
    ///      own transactions, never by a reveal.
    mapping(uint256 army => uint256[] armies) internal _toCollect;
    mapping(uint256 army => uint256 amount) internal _collected;

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

    /// @notice A TABLE'S OWN STATE: its spawn counter and its end.
    /// @dev Untouched in the persistent world. See `UsingGameTable`.
    struct TableState {
        /// @notice how many spawn points its seats have been given: the next
        ///         seat takes this spiral index. ONLY EVER INCREASES, so a
        ///         seat that leaves leaves a gap and moves nobody else.
        uint32 spawned;
        /// @notice how many kings stood at the cap, for an even split when
        ///         nobody has any material left
        uint32 standing;
        /// @notice whether the table's outcome and pot are written
        bool settled;
        /// @notice whether the material at the cap is counted
        bool tallied;
        /// @notice how far the count has got (see `UsingGameTable-_tally`)
        uint64 tallyCursor;
        /// @notice every stake on the table, once settled: what is paid out
        uint256 pot;
        /// @notice the material of every standing army at the cap, summed
        uint256 totalMaterial;
        /// @notice the last king standing, if the table ended that way
        uint256 winner;
    }
    TableState internal _table;

    /// @notice AT A TABLE, every zone a reveal has touched a square of, once
    ///         each, in the order first touched: what the count of material
    ///         at the cap walks (`UsingGameTable-_tally`), since the zone
    ///         index alone cannot be listed.
    /// @dev Written only when a zone's bits go from none to some, and only
    ///      under a roster, so the world's reveals never pay for it.
    uint64[] internal _tableZones;

    /// @notice The material each standing army holds at a table's cap.
    mapping(uint256 army => uint256 material) internal _materialOf;

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

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "solidity-kit/solc_0_8/debug/time/interfaces/ITime.sol";
import "solidity-kit/solc_0_8/ERC20/interfaces/IERC20.sol";
import {UsingCommitRevealTypes} from "../../commit-reveal/interfaces/UsingCommitRevealTypes.sol";

/// @dev THE MECHANISM'S TYPES ARE INHERITED, not declared here: `Cycle`,
///      `Commitment`, `Attendance` and `CyclePolicy` are the commit-reveal
///      base's (`src/commit-reveal/`). What is left is this game: its config,
///      which is the base's plus a token, the stake and the spawn grid, and
///      its board (armies, pieces, spawn points). The words are `CONTEXT.md`'s.
interface UsingGameTypes is UsingCommitRevealTypes {
    // ------------------------------------------------------------------------
    // EXTERNAL TYPES
    // ------------------------------------------------------------------------

    /// @notice Config struct to configure the game instance
    struct Config {
        uint256 startTime;
        uint256 commitPhaseDuration;
        uint256 revealPhaseDuration;
        ITime time;
        /// @notice the token players stake
        IERC20 tokens;
        /// @notice THE STAKE: what one army holds. Moved from the account's
        ///         reserve into the new army's reserve when its deployment is
        ///         committed (`docs/adr/0006-stake-erc20-reserve-exit-only.md`).
        uint256 stake;
        /// @notice The distance between two spawn points on each axis. At least
        ///         6, so that no two armies' footprints can overlap.
        uint32 spawnSpacing;
        /// @notice How many free spawn points are open at once: the ones
        ///         nearest the origin, in spiral order.
        uint8 openSpawnPoints;
        /// @notice THE CHUNK: how many actions one reveal transaction may carry.
        /// @dev A DEPLOYMENT PARAMETER AND NOT A CONSTANT: see the base. This
        ///      game's submission is ONE action (one move, or one deployment),
        ///      so anything above one is never exercised by it. The client
        ///      learns it from here (`web/src/lib/chess/config.ts`).
        uint256 actionsPerReveal;
        /// @notice how the cycle advances
        CyclePolicy cyclePolicy;
    }

    /// @notice This game's action: one piece from one square to another.
    /// @dev ALSO THE DEPLOYMENT'S ACTION. An army's first submission is its
    ///      deployment, and it reveals exactly one `Move` whose `from` and `to`
    ///      are both the chosen spawn point. One action type for both is what
    ///      lets the commitment, the chunked reveal and the client's stored
    ///      submission stay the base's, unchanged (see `UsingGameInternal`).
    ///
    ///      Squares are packed positions (`PositionUtils.fromXY`): y in the high
    ///      32 bits, x in the low 32, both two's complement.
    struct Move {
        uint64 from;
        uint64 to;
    }

    enum PieceKind {
        None,
        Pawn,
        Knight,
        Bishop,
        Rook,
        Queen,
        King
    }

    /// @notice A direction on the board. Only a pawn's is meaningful: it is the
    ///         way it advances, fixed at deployment.
    /// @dev In quarter turns clockwise from North, which is what lets the
    ///      layout rotate a direction by adding.
    enum Direction {
        North, // +y
        East, // +x
        South, // -y
        West // -x
    }

    /// @notice One piece on one square, resolved.
    struct Piece {
        uint64 position;
        /// @notice the army it belongs to
        uint256 army;
        PieceKind kind;
        /// @notice which way a pawn advances; North for every other piece
        Direction forward;
        /// @notice whether the piece has moved since its army was deployed
        bool moved;
    }

    /// @notice What the last closed cycle did to one square: a capture, a
    ///         collision, or both kinds of nothing (never returned).
    /// @dev Resolved by `ChessRules.outcome`, the same table the board is.
    struct SquareOutcome {
        uint64 position;
        /// @notice how many pieces arrived there and died in a collision: all
        ///         of them when two or more arrived, zero otherwise
        uint32 died;
        /// @notice the piece that stayed there and was captured by the only
        ///         piece to arrive; kind `None` if nothing was captured
        Piece captured;
        /// @notice what stands there now: the captor, the piece that stayed
        ///         through a collision, or kind `None`
        Piece piece;
    }

    /// @notice Where an army's deployment is, resolved.
    enum ArmyStatus {
        /// @notice no such army
        None,
        /// @notice committed this cycle, or revealed and the cycle not over yet
        Deploying,
        /// @notice on the board
        Deployed,
        /// @notice revealed onto a spawn point another deployment revealed too
        ///         in the same cycle, or whose footprint was not clear: a piece
        ///         stood on it at the start of the cycle or arrived on it during
        ///         it. Its stake is refunded to its owner's account reserve by
        ///         {IGameCommit-settleDeployment}; until then `stake` still holds
        ///         it, which is how a reader tells a pending refund.
        Failed,
        /// @notice its deployment was never revealed in its cycle; its stake is
        ///         burned when the missed reveal is settled (`stake` is zero once
        ///         it has been)
        Unrevealed,
        /// @notice its deployment was cancelled in its commit phase, and its
        ///         stake went back to its owner's account reserve
        Cancelled,
        /// @notice its king was taken: its pieces and its stake are now those
        ///         of the army in `mergedInto`, which its owner plays
        ///         (`docs/adr/0001-one-move-per-army-merge-on-capture.md`)
        Captured,
        /// @notice its king landed alone on an exit in a cycle that is over:
        ///         its own pieces left the board, those of the armies it had
        ///         merged are rocks, and its whole stake is paid out by
        ///         {IGameExit-exit} (`stake` is what is still to be paid)
        Exited,
        /// @notice on the board, FROZEN for good by a missed reveal: it never
        ///         moves again and its king cannot exit, but it can still be
        ///         captured (then it is `Captured`), and its whole stake stays
        ///         on the board as prey
        ///         (`docs/adr/0005-missed-reveal-freezes-the-army.md`). Frozen
        ///         as soon as its reveal window closed, before anybody settles
        ///         the missed reveal ({IGameRegistry-isFrozen})
        Frozen
    }

    /// @notice One entry of the army registry, resolved.
    struct ArmyView {
        uint256 id;
        /// @notice the account that owns it, and the only one that may act for
        ///         it (directly or through a delegate); for a `Captured` army,
        ///         the owner of the army it merged into
        address owner;
        ArmyStatus status;
        /// @notice the cycle its deployment was committed in
        uint64 deployedIn;
        /// @notice where it was revealed, once it has been
        uint64 spawnPoint;
        /// @notice where its king stands; meaningful while `Deployed`
        uint64 king;
        /// @notice what it holds: its own reserve, plus those of every army
        ///         that merged into it; zero once `Captured`, because its stake is
        ///         then part of the stake of the army in `mergedInto`
        uint256 stake;
        /// @notice the army it plays for: itself, or once `Captured`, the army
        ///         its pieces and stake merged into, at the end of the chain
        uint256 mergedInto;
    }

    /// @notice How a table ended, as far as it has.
    struct TableOutcome {
        /// @notice whether it is over: one king stands, or its last cycle is
        bool over;
        /// @notice whether its outcome and pot are written (by the first claim)
        bool settled;
        /// @notice whether the material at the cap has been counted
        bool tallied;
        /// @notice the last king standing; zero while more than one stands
        uint256 winner;
        /// @notice every stake on the table, once settled
        uint256 pot;
        /// @notice the material of every standing army at the cap, once counted
        uint256 totalMaterial;
    }

    // ------------------------------------------------------------------------
}

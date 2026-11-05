// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.0;

import "./UsingGameStore.sol";
import "../interfaces/UsingGameEvents.sol";
import "../interfaces/UsingGameErrors.sol";
import "../../utils/PositionUtils.sol";
import {ChessRules} from "./ChessRules.sol";
import {CommitReveal} from "../../commit-reveal/CommitReveal.sol";
import {Delegation} from "@etherplay/delegation/contracts/Delegation.sol";

/// @dev THIS GAME, ON THE COMMIT-REVEAL BASE. Everything that is mechanism -
///      the reserve, the bonded commitment, the chain of chunks, the cycle
///      policies, advance, attendance, delegation and both settlements - is
///      {UsingCommitReveal}'s (`src/commit-reveal/`), which this game keeps
///      rather than writes. What is here is what an ARMY is (the identity, at
///      the {_playerOf} seam), what deploying one does, and how the board is
///      resolved from what reveals recorded.
///
///      The rules themselves are {ChessRules}: pure, and shared by the reveal,
///      the resolving views and the simulation route.
abstract contract UsingGameInternal is UsingGameStore, UsingGameEvents {
    constructor(Config memory config) UsingGameStore(config) {}

    // ------------------------------------------------------------------------
    // WHO PLAYS: ARMIES
    // ------------------------------------------------------------------------

    /// @notice Whether `id` is an army's id rather than an account's.
    /// @dev Army ids are `nonce << 160 | owner` with a nonce of at least one,
    ///      so every one of them is above `type(uint160).max`, where no
    ///      address-derived id can be: the two kinds of reserve can never be
    ///      the same reserve.
    function _isArmyId(uint256 id) internal pure returns (bool) {
        return id > type(uint160).max;
    }

    /// @notice The id of `owner`'s `nonce`th army.
    function _armyIdOf(
        address owner,
        uint256 nonce
    ) internal pure returns (uint256) {
        return (nonce << 160) | uint256(uint160(owner));
    }

    /// @notice WHO THE CALLER IS ACTING FOR: an army, through its owner.
    /// @dev THE BASE'S SEAM, overridden for one kind of id. An army is acted
    ///      for by its OWNER, or by a delegate of its owner, through the
    ///      template's delegation. An army that does not exist yet may be named
    ///      only as its owner's NEXT army, which is what a deployment commits
    ///      for (see {_createArmy}). An address-derived id is the base's: an
    ///      account, which is only ever a member at a table.
    function _playerOf(
        address sender,
        uint256 id
    ) internal view override returns (uint256 player) {
        if (!_isArmyId(id)) {
            return super._playerOf(sender, id);
        }
        address owner = _armies[id].owner;
        if (owner == address(0)) {
            owner = address(uint160(id));
            if (owner == address(0) || id >> 160 != _armyCountOf[owner] + 1) {
                revert InvalidPlayer(id);
            }
        }
        Delegation.requireAccountFor(sender, owner);
        return id;
    }

    /// @notice Create the army a deployment is committed for, and fund it.
    /// @param army An id {_playerOf} has resolved to an army not created yet.
    /// @dev THE STAKE MOVES BETWEEN TWO RESERVES and never leaves the
    ///      contract: out of the owner's account reserve (which must hold it,
    ///      or this reverts {ReserveTooLow}) and into the army's, which IS the
    ///      army's stake (`docs/adr/0006-stake-erc20-reserve-exit-only.md`).
    ///      Funding the army's reserve is also what makes it a waited-for
    ///      member, through the base's own rule, in the same cycle as the
    ///      commitment that follows: the denominator and the numerator grow
    ///      together.
    function _createArmy(uint256 army) internal {
        address owner = address(uint160(army));
        (uint64 cycleNumber, ) = _cycleNumber();
        _armyCountOf[owner] = army >> 160;
        _armies[army] = ArmyRecord({
            owner: owner,
            deployCycle: cycleNumber,
            spawnIndexPlusOne: 0
        });
        _armyIds.push(army);
        CommitReveal.withdraw(uint256(uint160(owner)), STAKE);
        _addToReserve(army, STAKE);
        emit ArmyCreated(army, owner, cycleNumber, STAKE);
    }

    // ------------------------------------------------------------------------
    // REVEAL
    // ------------------------------------------------------------------------

    /// @notice Apply one chunk of an army's revealed submission.
    /// @dev THE BASE CHECKS AND CHARGES, THE GAME RESOLVES: {_openChunk}
    ///      refuses a chunk that is not the head of the chain, {_closeChunk}
    ///      moves the chain on and counts the submission. Nothing a submission
    ///      does costs reserve here, so the cost is zero.
    ///
    ///      ORDER INDEPENDENCE. A reveal only ACCUMULATES facts (see
    ///      {_revealDeployment}); every comparison between two players' reveals
    ///      happens when the board is read, once the cycle is over
    ///      (`docs/adr/0002-order-free-lazy-resolution.md`).
    function _reveal(
        uint256 player,
        Move[] calldata moves,
        bytes32 secret,
        bytes24 furtherActions
    ) internal {
        CommitReveal.Chunk memory chunk = _openChunk(
            player,
            _digest(moves, secret, furtherActions),
            moves.length,
            furtherActions
        );

        if (_isDeploying(player, chunk.cycleNumber)) {
            _revealDeployment(player, moves, furtherActions, chunk.cycleNumber);
        } else if (moves.length != 0) {
            // A PASS IS ALL ANY OTHER SUBMISSION CAN BE, for now: moves are the
            // next rule this game gains. An account seated at a table has no
            // pieces at all, so a pass is all it will ever submit.
            revert IllegalMove(moves[0].from, moves[0].to);
        }

        _closeChunk(chunk, 0);
    }

    /// @notice Whether `player`'s submission in `cycleNumber` is its
    ///         deployment: an army whose deployment was committed in that cycle
    ///         and has not been revealed.
    function _isDeploying(
        uint256 player,
        uint64 cycleNumber
    ) internal view returns (bool) {
        if (!_isArmyId(player)) return false;
        ArmyRecord storage army = _armies[player];
        return army.spawnIndexPlusOne == 0 && army.deployCycle == cycleNumber;
    }

    /// @notice Record a deployment's spawn point.
    /// @dev VALIDATED AGAINST THE START OF THE CYCLE: the spawn point must be in
    ///      the open set as it stood when the cycle began, which depends only on
    ///      deployments of earlier cycles and so is the same whichever reveal of
    ///      this cycle lands first.
    ///
    ///      THEN ONLY ACCUMULATED. The spawn point's record counts this cycle's
    ///      deployments onto it, and keeps the army only for the case where the
    ///      count is one. Whether the deployment LANDS is decided when the
    ///      cycle is over and the record is read: one deployment lands, two or
    ///      more all fail, by the count and never by who revealed first or
    ///      last.
    ///
    ///      THE ONE BRANCH ON SHARED STATE, AND WHY IT IS ORDER-FREE. The first
    ///      reveal of a cycle onto a spawn point starts a fresh record (it may
    ///      hold a failed deployment of an earlier cycle, which is free and is
    ///      simply overwritten), and the rest add one. After any set of reveals,
    ///      in any order, the record holds this cycle, the number of reveals,
    ///      and an army that is the only one whenever the number is one. What
    ///      differs with order is which army sits in a record whose count says
    ///      to ignore it, and which reveal pays to start the record. Neither is
    ///      part of the game. `test/js/Deployment.test.ts` replays the reveals
    ///      in both orders.
    function _revealDeployment(
        uint256 player,
        Move[] calldata moves,
        bytes24 furtherActions,
        uint64 cycleNumber
    ) internal {
        if (
            furtherActions != bytes24(0) ||
            moves.length != 1 ||
            moves[0].from != moves[0].to
        ) {
            revert InvalidDeployment();
        }
        uint64 spawnPoint = moves[0].to;
        (bool onGrid, uint256 index) = ChessRules.spawnIndexOf(
            spawnPoint,
            SPAWN_SPACING
        );
        if (!onGrid) revert NotASpawnPoint(spawnPoint);

        (uint64[] memory open, uint64 next, bool changed) = _openSet(
            cycleNumber
        );
        bool isOpen = false;
        for (uint256 i = 0; i < open.length; i++) {
            if (open[i] == index) {
                isOpen = true;
                break;
            }
        }
        if (!isOpen) revert SpawnPointNotOpen(spawnPoint);

        // KEEPING THE OPEN SET CURRENT IS A CACHE OF PAST CYCLES: the set it
        // writes is the start-of-cycle set, which every reveal of this cycle
        // computes identically, so whichever writes it changes nothing anyone
        // gets. It has to be written before a deployment lands on a fresh
        // index, which is why it is a deployment's reveal that writes it.
        if (changed) {
            _openSpawnIndices = open;
            _nextSpawnIndex = next;
        }

        SpawnRecord storage spawn = _spawns[index];
        if (spawn.cycle != cycleNumber) {
            spawn.cycle = cycleNumber;
            spawn.count = 1;
            spawn.army = player;
        } else {
            spawn.count += 1;
        }
        _armies[player].spawnIndexPlusOne = uint32(index + 1);

        emit DeploymentRevealed(player, spawnPoint, cycleNumber);
    }

    /// @notice Settle one chunk of a missed reveal, shown its moves.
    /// @dev A MISSED DEPLOYMENT FORFEITS THE STAKE, which is everything the
    ///      army holds: a deployment that could be watched and then dropped
    ///      for free would make committing one an option rather than a choice
    ///      (`docs/adr/0005-missed-reveal-freezes-the-army.md`). A missed pass
    ///      forfeits nothing here; what a missed move costs is the freeze.
    function _acknowledgeMissedReveal(
        uint256 player,
        Move[] calldata moves,
        bytes32 secret,
        bytes24 furtherActions
    ) internal {
        uint64 committedIn = _commitmentOf(player).cycleNumber;
        CommitReveal.Chunk memory chunk = _openMissedChunk(
            player,
            _digest(moves, secret, furtherActions),
            moves.length,
            furtherActions
        );
        _closeChunk(chunk, _isDeploying(player, committedIn) ? STAKE : 0);
    }

    /// @notice The hash a chunk of moves is committed under.
    /// @dev ONE ENCODING, ALWAYS, the base's, including for the last chunk,
    ///      where `furtherActions` is zero and is hashed in anyway. The client
    ///      builds the same bytes (`web/src/lib/chess/commit-reveal.ts`).
    function _digest(
        Move[] calldata moves,
        bytes32 secret,
        bytes24 furtherActions
    ) internal pure returns (bytes24) {
        return bytes24(keccak256(abi.encode(secret, moves, furtherActions)));
    }

    // ------------------------------------------------------------------------
    // RESOLVING
    // ------------------------------------------------------------------------

    /// @notice Whether a deployment has LANDED on the spawn point with spiral
    ///         index `index` before `cycleNumber`, and which army it was.
    /// @dev Resolved from the accumulated record: one deployment revealed in a
    ///      cycle that is over. The current cycle's reveals are not on the
    ///      board until it ends, so an army acts from the cycle after its
    ///      deployment and no move committed before it can reach it.
    function _landedBefore(
        uint256 index,
        uint64 cycleNumber
    ) internal view returns (bool landed, uint256 army) {
        SpawnRecord storage spawn = _spawns[index];
        uint64 cycle = spawn.cycle;
        if (cycle != 0 && cycle < cycleNumber && spawn.count == 1) {
            return (true, spawn.army);
        }
        return (false, 0);
    }

    /// @notice THE OPEN SET at the start of `cycleNumber`: the spiral indices
    ///         of the free spawn points nearest the origin, and the next fresh
    ///         index after them, and whether that differs from what is
    ///         stored (which a deployment's reveal then writes).
    /// @dev See {_openSpawnIndices} for the invariant that makes this K reads.
    function _openSet(
        uint64 cycleNumber
    ) internal view returns (uint64[] memory open, uint64 next, bool changed) {
        next = _nextSpawnIndex;
        if (next == 0) {
            open = new uint64[](OPEN_SPAWN_POINTS);
            for (uint64 i = 0; i < OPEN_SPAWN_POINTS; i++) open[i] = i;
            next = OPEN_SPAWN_POINTS;
            changed = true;
        } else {
            open = _openSpawnIndices;
        }
        for (uint256 i = 0; i < open.length; i++) {
            (bool landed, ) = _landedBefore(open[i], cycleNumber);
            if (landed) {
                open[i] = next;
                next++;
                changed = true;
            }
        }
    }

    /// @notice One army as the registry shows it, resolved for `cycleNumber`.
    function _armyView(
        uint256 id,
        uint64 cycleNumber
    ) internal view returns (ArmyView memory view_) {
        ArmyRecord memory army = _armies[id];
        view_.id = id;
        if (army.owner == address(0)) return view_;
        view_.owner = army.owner;
        view_.deployedIn = army.deployCycle;
        view_.stake = _reserveOf(id);
        if (army.spawnIndexPlusOne == 0) {
            view_.status =
                army.deployCycle == cycleNumber
                    ? ArmyStatus.Deploying
                    : ArmyStatus.Unrevealed;
            return view_;
        }
        uint256 index = army.spawnIndexPlusOne - 1;
        view_.spawnPoint = ChessRules.spawnPointAt(index, SPAWN_SPACING);
        if (army.deployCycle >= cycleNumber) {
            view_.status = ArmyStatus.Deploying;
            return view_;
        }
        (bool landed, uint256 landedArmy) = _landedBefore(index, cycleNumber);
        if (landed && landedArmy == id) {
            view_.status = ArmyStatus.Deployed;
            view_.king = ChessRules.kingOf(view_.spawnPoint);
        } else {
            // Either more than one deployment revealed this spawn point in the
            // army's cycle, or the record has been started again since, which
            // only a free (so failed) spawn point allows.
            view_.status = ArmyStatus.Failed;
        }
    }

    /// @notice Every piece on the squares from (`minX`,`minY`) to
    ///         (`maxX`,`maxY`), resolved for `cycleNumber`.
    /// @dev A square is covered by at most one spawn point's footprint (the
    ///      spacing is at least the footprint's width), and a footprint reaches
    ///      at most 3 squares left of / below its spawn point and 2 right of /
    ///      above it, so the spawn points to resolve are those within that
    ///      margin of the rectangle.
    function _piecesIn(
        int32 minX,
        int32 minY,
        int32 maxX,
        int32 maxY,
        uint64 cycleNumber
    ) internal view returns (Piece[] memory pieces) {
        Rect memory rect = Rect(minX, minY, maxX, maxY);
        Grid memory grid = _gridAround(rect);
        if (grid.i1 < grid.i0 || grid.j1 < grid.j0) return new Piece[](0);

        // TWO PASSES, so the memory is what the board HOLDS in view rather than
        // twenty pieces for every spawn point the rectangle could reach: an
        // empty viewport costs one read per spawn point and nothing else.
        uint256 points = uint256(
            (grid.i1 - grid.i0 + 1) * (grid.j1 - grid.j0 + 1)
        );
        uint64[] memory spawnPoints = new uint64[](points);
        uint256[] memory armies = new uint256[](points);
        uint256 landed = 0;
        int256 s = int256(uint256(SPAWN_SPACING));
        for (int256 j = grid.j0; j <= grid.j1; j++) {
            for (int256 i = grid.i0; i <= grid.i1; i++) {
                (bool isLanded, uint256 army) = _landedBefore(
                    ChessRules.spiralIndex(i, j),
                    cycleNumber
                );
                if (!isLanded) continue;
                spawnPoints[landed] = PositionUtils.fromXY(
                    int32(i * s),
                    int32(j * s)
                );
                armies[landed] = army;
                landed++;
            }
        }

        pieces = new Piece[](landed * ChessRules.ARMY_SIZE);
        uint256 n = 0;
        for (uint256 k = 0; k < landed; k++) {
            n = _appendArmy(
                pieces,
                n,
                rect,
                ChessRules.layout(spawnPoints[k], armies[k])
            );
        }
        assembly {
            mstore(pieces, n)
        }
    }

    /// @dev The spawn grid points, as grid coordinates, whose footprint can
    ///      reach `rect`.
    struct Grid {
        int256 i0;
        int256 i1;
        int256 j0;
        int256 j1;
    }

    function _gridAround(Rect memory rect) private view returns (Grid memory) {
        int256 s = int256(uint256(SPAWN_SPACING));
        return
            Grid({
                i0: _ceilDiv(int256(rect.minX) - 2, s),
                i1: _floorDiv(int256(rect.maxX) + 3, s),
                j0: _ceilDiv(int256(rect.minY) - 2, s),
                j1: _floorDiv(int256(rect.maxY) + 3, s)
            });
    }

    /// @dev A viewport, inclusive on every side.
    struct Rect {
        int32 minX;
        int32 minY;
        int32 maxX;
        int32 maxY;
    }

    /// @dev Copy the pieces of `army` that stand inside `rect` to `pieces`
    ///      from index `n`, and return the index after the last.
    function _appendArmy(
        Piece[] memory pieces,
        uint256 n,
        Rect memory rect,
        Piece[] memory army
    ) private pure returns (uint256) {
        for (uint256 p = 0; p < army.length; p++) {
            (int32 x, int32 y) = PositionUtils.toXY(army[p].position);
            if (x < rect.minX || x > rect.maxX) continue;
            if (y < rect.minY || y > rect.maxY) continue;
            pieces[n] = army[p];
            n++;
        }
        return n;
    }

    function _floorDiv(int256 a, int256 b) private pure returns (int256) {
        int256 q = a / b;
        if (a % b != 0 && (a < 0) != (b < 0)) q -= 1;
        return q;
    }

    function _ceilDiv(int256 a, int256 b) private pure returns (int256) {
        int256 q = a / b;
        if (a % b != 0 && (a < 0) == (b < 0)) q += 1;
        return q;
    }
}

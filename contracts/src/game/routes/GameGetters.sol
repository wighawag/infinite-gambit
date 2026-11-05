// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.0;

import "../internal/UsingGameInternal.sol";
import "../interfaces/IGame.sol";

contract GameGetters is IGameGetters, UsingGameInternal {
    constructor(Config memory config) UsingGameInternal(config) {}

    /// @inheritdoc IGameGetters
    function getCycleNumber()
        external
        view
        returns (uint64 cycleNumber, bool commiting)
    {
        return _cycleNumber();
    }

    /// @inheritdoc IGameGetters
    function getCycle() external view returns (Cycle memory cycle) {
        return _cycle();
    }

    /// @inheritdoc IGameGetters
    function getAttendance()
        external
        view
        returns (Attendance memory attendance)
    {
        (uint64 cycleNumber, ) = _cycleNumber();
        return _effectiveAttendance(cycleNumber);
    }

    /// @inheritdoc IGameGetters
    function getCommitment(
        uint256 player
    ) external view returns (Commitment memory commitment) {
        return _commitmentOf(player);
    }

    /// @inheritdoc IGameGetters
    function getReserve(uint256 player) external view returns (uint256 amount) {
        return _reserveOf(player);
    }

    /// @inheritdoc IGameGetters
    function getConfig() external view returns (Config memory config) {
        config = Config({
            startTime: START_TIME,
            commitPhaseDuration: COMMIT_PHASE_DURATION,
            revealPhaseDuration: REVEAL_PHASE_DURATION,
            time: TIME,
            tokens: TOKENS,
            stake: STAKE,
            spawnSpacing: SPAWN_SPACING,
            openSpawnPoints: OPEN_SPAWN_POINTS,
            actionsPerReveal: ACTIONS_PER_REVEAL,
            cyclePolicy: CYCLE_POLICY
        });
    }

    /// @inheritdoc IGameGetters
    function getPieces(
        int32 minX,
        int32 minY,
        int32 maxX,
        int32 maxY
    ) external view returns (Piece[] memory pieces, uint64 cycleNumber) {
        (cycleNumber, ) = _cycleNumber();
        pieces = _piecesIn(minX, minY, maxX, maxY, cycleNumber);
    }

    /// @inheritdoc IGameGetters
    function getOpenSpawnPoints()
        external
        view
        returns (uint64[] memory spawnPoints, uint64 cycleNumber)
    {
        (cycleNumber, ) = _cycleNumber();
        (uint64[] memory open, , ) = _openSet(cycleNumber);
        // In spiral order, nearest first: the stored set keeps each index in
        // the slot it replaced, so it is sorted here, for the reader.
        for (uint256 i = 1; i < open.length; i++) {
            uint64 v = open[i];
            uint256 k = i;
            while (k > 0 && open[k - 1] > v) {
                open[k] = open[k - 1];
                k--;
            }
            open[k] = v;
        }
        spawnPoints = new uint64[](open.length);
        for (uint256 i = 0; i < open.length; i++) {
            spawnPoints[i] = ChessRules.spawnPointAt(open[i], SPAWN_SPACING);
        }
    }

    /// @inheritdoc IGameGetters
    function getArmy(uint256 army) external view returns (ArmyView memory) {
        (uint64 cycleNumber, ) = _cycleNumber();
        return _armyView(army, cycleNumber);
    }

    /// @inheritdoc IGameGetters
    function getArmies(
        uint256 offset,
        uint256 limit
    ) external view returns (ArmyView[] memory armies, uint256 total) {
        (uint64 cycleNumber, ) = _cycleNumber();
        total = _armyIds.length;
        uint256 end =
            offset >= total
                ? offset
                : (limit > total - offset ? total : offset + limit);
        armies = new ArmyView[](end - offset);
        for (uint256 i = offset; i < end; i++) {
            armies[i - offset] = _armyView(_armyIds[i], cycleNumber);
        }
    }

    /// @inheritdoc IGameGetters
    function getArmiesOf(
        address owner
    ) external view returns (ArmyView[] memory armies) {
        (uint64 cycleNumber, ) = _cycleNumber();
        uint256 count = _armyCountOf[owner];
        armies = new ArmyView[](count);
        for (uint256 i = 0; i < count; i++) {
            armies[i] = _armyView(_armyIdOf(owner, i + 1), cycleNumber);
        }
    }

    /// @inheritdoc IGameGetters
    function getNextArmy(address owner) external view returns (uint256 army) {
        return _armyIdOf(owner, _armyCountOf[owner] + 1);
    }
}

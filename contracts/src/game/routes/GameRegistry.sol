// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.0;

import "../internal/UsingGameInternal.sol";
import "../interfaces/IGame.sol";

/// @dev THE ARMY REGISTRY, RESOLVED: every army, who plays it and what it
///      holds, through every capture and every chain of captures, whichever
///      squares have been read or folded yet (`UsingGameBoard-_armyOf`,
///      `UsingGameBoard-_stakeOf`).
contract GameRegistry is IGameRegistry, UsingGameInternal {
    constructor(Config memory config) UsingGameInternal(config) {}

    /// @inheritdoc IGameRegistry
    function getArmy(uint256 army) external view returns (ArmyView memory) {
        (uint64 cycleNumber, ) = _cycleNumber();
        return _armyView(army, cycleNumber);
    }

    /// @inheritdoc IGameRegistry
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

    /// @inheritdoc IGameRegistry
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

    /// @inheritdoc IGameRegistry
    function getNextArmy(address owner) external view returns (uint256 army) {
        return _armyIdOf(owner, _armyCountOf[owner] + 1);
    }

    /// @inheritdoc IGameRegistry
    function isFrozen(uint256 army) external view returns (bool) {
        (uint64 cycleNumber, ) = _cycleNumber();
        return _isFrozen(army, cycleNumber);
    }
}

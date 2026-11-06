// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.0;

import "../internal/UsingGameInternal.sol";
import "../interfaces/IGame.sol";

/// @dev THE ONLY WAY A STAKE LEAVES THE WORLD
///      (`docs/adr/0006-stake-erc20-reserve-exit-only.md`). An army whose king
///      landed alone on an exit has left the board at the close of that cycle,
///      whether or not anyone calls anything; these only PAY, in their own
///      transactions and never inside the reveal's gas
///      (`docs/adr/0011-an-exit-removes-its-own-army-and-leaves-rocks.md`).
contract GameExit is IGameExit, UsingGameInternal {
    constructor(Config memory config) UsingGameInternal(config) {}

    /// @inheritdoc IGameExit
    function exit(uint256 army) external returns (uint256 paid) {
        (uint64 cycleNumber, ) = _cycleNumber();
        return _payExit(army, cycleNumber);
    }

    /// @inheritdoc IGameExit
    function collect(
        uint256 army,
        uint256 maxArmies
    ) external returns (bool done) {
        (uint64 cycleNumber, ) = _cycleNumber();
        return _collect(army, cycleNumber, maxArmies);
    }

    /// @inheritdoc IGameExit
    function isExited(uint256 army) external view returns (bool) {
        (uint64 cycleNumber, ) = _cycleNumber();
        return _exited(army, cycleNumber);
    }
}

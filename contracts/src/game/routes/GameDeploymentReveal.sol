// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.0;

import "../internal/UsingGameInternal.sol";
import "../interfaces/IGame.sol";

/// @dev THE DEPLOYMENT'S REVEAL, split off {GameReveal} for size alone: the
///      move rule fills that route, and the deployment's open-set and
///      footprint checks no longer fit beside it under the deployed-size limit.
contract GameDeploymentReveal is IGameDeploymentReveal, UsingGameInternal {
    constructor(Config memory config) UsingGameInternal(config) {}

    /// @inheritdoc IGameDeploymentReveal
    function revealDeployment(
        uint256 player,
        Move[] calldata moves,
        bytes32 secret,
        bytes24 furtherActions,
        address payable payee
    ) external payable {
        _revealDeploymentChunk(player, moves, secret, furtherActions);

        // extra steps for which we do not intend to track via events
        if (payee != address(0) && msg.value != 0) {
            payee.transfer(msg.value);
        }
    }
}

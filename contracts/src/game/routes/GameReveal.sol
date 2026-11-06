// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.0;

import "../internal/UsingGameInternal.sol";
import "../interfaces/IGame.sol";

/// @dev THE MOVE'S REVEAL, and only that: it carries the whole move rule, which
///      is what fills this route. A deployment's reveal is on
///      {GameDeploymentReveal}, and the settlements of a missed reveal and the
///      advance are on {GameCommit}, for size alone.
contract GameReveal is IGameReveal, UsingGameInternal {
    constructor(Config memory config) UsingGameInternal(config) {}

    /// @inheritdoc IGameReveal
    function reveal(
        uint256 player,
        Move[] calldata moves,
        bytes32 secret,
        bytes24 furtherActions,
        address payable payee
    ) external payable {
        ArmyRecord storage army = _armies[player];
        if (army.owner != address(0) && army.spawnIndexPlusOne == 0) {
            // A DEPLOYMENT, revealed by its own route, which this route no
            // longer has room for. Forwarded rather than refused, so a client
            // reveals every submission the same way. Nobody is paid inside:
            // the payee is this call's.
            IGameDeploymentReveal(address(this)).revealDeployment(
                player,
                moves,
                secret,
                furtherActions,
                payable(address(0))
            );
        } else {
            _reveal(player, moves, secret, furtherActions);
        }

        // extra steps for which we do not intend to track via events
        if (payee != address(0) && msg.value != 0) {
            payee.transfer(msg.value);
        }
    }
}

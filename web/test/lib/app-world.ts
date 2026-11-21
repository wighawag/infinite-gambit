import deployToken from 'chess-battleground-contracts/deploy/001_deploy_token.js';
import deployGame from 'chess-battleground-contracts/deploy/010_deploy_game.js';
import deployStakeSale from 'chess-battleground-contracts/deploy/020_deploy_stake_sale.js';
import deployLobby from 'chess-battleground-contracts/deploy/030_deploy_lobby.js';

/**
 * WHAT AN EMBEDDED WORLD MUST DEPLOY for the app's context to work, and the
 * rocketh setup it deploys with, in ONE place, so a descendant that replaces
 * the app's contracts (its own contracts package, its own deploy scripts)
 * edits this file and not every suite that boots a world. Read by
 * `embedded/world.test.ts` and `embedded/deployments.test.ts`. Its e2e twin is
 * `MAIN_PAGE` of `web/e2e/routes.ts`, whose `contract` names the same contract.
 *
 * HERE, CHESS'S CONTRACTS. Its `embedded/world.test.ts` is its own: it boots
 * `OFFLINE_DEPLOYMENT` of `$lib/offline` whole. What reads this file is the
 * stem's `offline-world.test.ts`, which opens a world of these deploy scripts
 * at their default data (every contract the app's records name, so the
 * world's own check passes) and checks the opener, not the game.
 */
export {
	config,
	extensions,
} from 'chess-battleground-contracts/rocketh/config.js';

/** The deploy scripts a world runs, in order (as `OFFLINE_DEPLOYMENT` of `$lib/offline` deploys). */
export const APP_SCRIPTS = [
	{id: '001_deploy_token', module: deployToken},
	{id: '010_deploy_game', module: deployGame},
	{id: '020_deploy_stake_sale', module: deployStakeSale},
	{id: '030_deploy_lobby', module: deployLobby},
];

/** The deployment name of the contract the app's context reads. */
export const APP_CONTRACT = 'Game' as const;

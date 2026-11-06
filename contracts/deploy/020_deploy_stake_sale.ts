import {Abi_GameToken} from '../generated/abis/GameToken.js';
import {Abi_IGame} from '../generated/abis/IGame.js';
import {deployScript, artifacts} from '../rocketh/deploy.js';

export default deployScript(
	async ({get, deploy, execute, namedAccounts, data}) => {
		const {deployer} = namedAccounts;

		const GameToken = get<Abi_GameToken>('GameToken');
		const Game = get<Abi_IGame>('Game');

		const config = {
			price: data.sale.price,
			amount: data.sale.amount,
		};

		const Sale = await deploy(
			'StakeSale',
			{
				account: deployer,
				artifact: artifacts.StakeSale,
				args: [GameToken.address, Game.address, config],
			},
			{
				// The client reads the price off THIS deployment rather than off the
				// Game's, because the price is this contract's to state: `purchase`
				// reverts with `WrongPaymentAmount` unless the value it is sent
				// matches exactly, so a figure copied anywhere else is a figure that
				// can drift into reverting every purchase.
				linkedData: config,
				// Deterministic (CREATE2), like every contract here: see
				// "Deterministic deployments" in README.md.
				deterministic: true,
			},
		);

		// THE ONLY MINTER, which keeps the ETH every token was bought with, so
		// `redeem` (and so an exit) is always solvent. Set once, by the token's
		// owner; guarded so a redeploy, or a LAN box replaying it, repeats
		// nothing.
		await execute(GameToken, {
			account: deployer,
			functionName: 'setMinter',
			args: [Sale.address],
			guard: {kind: 'call', functionName: 'minter', equals: Sale.address},
		});
	},
	{
		tags: ['StakeSale', 'StakeSale_deploy'],
		dependencies: ['GameToken_deploy', 'Game_deploy'],
	},
);

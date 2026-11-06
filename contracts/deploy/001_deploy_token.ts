import {deployScript, artifacts} from '../rocketh/deploy.js';

export default deployScript(
	async ({deploy, namedAccounts}) => {
		const {deployer} = namedAccounts;

		// Deterministic (CREATE2), like every contract here: see "Deterministic
		// deployments" in README.md.
		await deploy(
			'GameToken',
			{
				account: deployer,
				artifact: artifacts.GameToken,
				// THE OWNER, who names the minter once the sale exists
				// (020_deploy_stake_sale.ts). An argument, because under CREATE2
				// `msg.sender` is the factory.
				args: [deployer],
			},
			{deterministic: true},
		);
	},
	{tags: ['GameToken', 'GameToken_deploy']},
);

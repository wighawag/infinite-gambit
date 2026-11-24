import {
	test,
	expect,
	describe,
	drainSignerGas,
	refillSignerGas,
} from '../fixtures/test';
import {
	authoriseToPlay,
	clearAnyMissedReveal,
	planDeployment,
	pressCommit,
	stakeAndWait,
	submissionStep,
	untilStep,
} from '../fixtures/chess-game';

/**
 * The path where a player loses a stake, in a real browser, in chess.
 *
 * THIS GAME'S PORT of the template's `out-of-gas.e2e.ts`, which plans a
 * placement this repo does not have (`.offshoot-omissions`); the turn here is a
 * deployment, planned in the HUD. Every other e2e test funds the signer first,
 * so this is the one suite that runs a turn out of gas. A turn is signed by a
 * local signer the player was never told about, holding only what someone put
 * in it; if the failure is reported generically, or the submission does not
 * pick itself back up when the gas lands, the player finds out by losing their
 * bond.
 *
 * Three claims, in the order they matter:
 *
 * 1. the commit fails as an OUT-OF-GAS failure, named as such
 * 2. the remedy is offered, next to the failure, without being asked for
 * 3. gas arriving from ANYWHERE resumes the submission, all the way to Revealed
 */
describe('A move that runs out of gas', () => {
	test.use({walletAccountIndex: 3});

	test('is named, offers the remedy, and resumes when the gas lands', async ({
		connectedPage,
		authoriseBrowser,
	}) => {
		test.slow();
		const page = connectedPage;

		await authoriseToPlay(page, authoriseBrowser);
		await clearAnyMissedReveal(page);
		await stakeAndWait(page);

		// Take the signer's gas AFTER staking: the stake is the account's own
		// transaction, the turn is the signer's.
		await drainSignerGas(page);

		await planDeployment(page, 9, 12);
		await pressCommit(page, 'commit-deployment');

		await untilStep(page, 'Error', 'a commit with no gas should fail', 60_000);
		await expect(
			page.getByText(/your play key is out of gas/i),
			'the failure should be named as gas, not reported generically',
		).toBeVisible({timeout: 30_000});
		await expect(
			page.getByRole('button', {name: /top up and carry on/i}),
			'the one failure with a remedy should offer it, unprompted',
		).toBeVisible();
		expect(
			(await submissionStep(page)).planned,
			'the plan should survive the failure, ready to be retried',
		).toBe(1);

		// Gas from outside the app's own flow: the submission notices by itself.
		await refillSignerGas(page);

		await untilStep(
			page,
			'Committed',
			'the submission should retry itself once the gas arrives',
			60_000,
		);
		await expect(
			page.getByRole('button', {name: /top up and carry on/i}),
			'the remedy should stop being offered once it has been taken',
		).toBeHidden({timeout: 30_000});
		await untilStep(
			page,
			'Revealed',
			'the reveal should follow, so the stake is not lost',
			120_000,
		);
	});
});

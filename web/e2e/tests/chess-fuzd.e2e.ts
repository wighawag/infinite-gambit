import {type Hex} from 'viem';
import {test, expect, describe} from '../fixtures/test';
import {currentPhase, submissionStep} from '../fixtures/chess-game';
import {fuzdExecution, remoteAccountOf} from '../fixtures/fuzd';
import {
	appFacts,
	chain,
	commitAScheduledTurn,
	missedRevealStep,
	turnOnChain,
} from '../fixtures/chess-fuzd-game';

/**
 * A REVEAL SENT BY FUZD (`with/fuzd`), end to end against a real chain and the
 * real fuzd CLI, in chess.
 *
 * THIS GAME'S PORT of the template's `fuzd.e2e.ts`, which plans placements this
 * repo does not have (`.offshoot-omissions`). The claim is the layer's whole
 * reason to exist: a player who commits and closes the tab still reveals, and
 * keeps their stake. So the page is CLOSED before the reveal phase, and a new
 * page opened after the cycle has turned must find the turn `Revealed` (not
 * `Missed`), the army on the board, and the reveal sent by the player's REMOTE
 * account, which only fuzd holds the key of. The template's second case, a turn
 * of several chunks revealed as one batch, has no chess form: the contract
 * refuses a chained turn (`OneMovePerCycle`), so a chess turn is one chunk.
 *
 * In the `fuzd` project, which runs after every other suite with fuzd live (see
 * `FUZD_SUITE` in playwright.config.ts). The fallback with fuzd down is
 * `chess-fuzd-fallback.e2e.ts`, in a project after this one.
 */
describe('A reveal sent by fuzd', () => {
	// Its own burner account, like every suite that sends transactions.
	test.use({walletAccountIndex: 7});

	test('reveals a turn whose page was closed before the reveal phase', async ({
		connectedPage,
		authoriseBrowser,
	}) => {
		test.setTimeout(300_000);
		const page = connectedPage;
		const facts = await appFacts(page);
		expect(facts.signer, 'the browser key should be ready').toBeTruthy();
		const turn = await commitAScheduledTurn(page, authoriseBrowser, 12);
		expect(turn.schedule.batchSize, 'the whole reveal is one batch').toBe(1);

		// CLOSE THE PAGE before the reveal phase: from here only fuzd can reveal.
		const phase = await currentPhase(page);
		expect(phase.phase, 'the page must close before the reveal phase').not.toBe(
			'reveal',
		);
		const browserContext = page.context();
		await page.close();

		await expect
			.poll(
				async () =>
					Number((await chain.getBlock()).timestamp) >=
					turn.schedule.revealDueAt + turn.schedule.expiryDelta,
				{message: 'the reveal phase should pass', timeout: 120_000},
			)
			.toBe(true);

		const onChain = await turnOnChain(
			facts.game,
			facts.identity,
			turn.cycleNumber,
		);
		expect(onChain.made, 'the commitment is on chain').toBeTruthy();
		expect(onChain.reveals, 'the turn revealed').toHaveLength(1);

		// Sent by the REMOTE account, the one only fuzd holds the key of.
		const remote = await remoteAccountOf(facts.signer);
		expect(turn.schedule.remoteAccount).toBe(remote);
		expect(turn.schedule.account, 'fuzd keys a schedule by its signer').toBe(
			facts.signer,
		);
		const reveal = onChain.reveals[0];
		const transaction = await chain.getTransaction({
			hash: reveal.transactionHash as Hex,
		});
		expect(
			transaction.from.toLowerCase(),
			'the reveal is sent by the remote account',
		).toBe(remote);
		expect(reveal.args.commitmentHash).toBe(onChain.made.args.commitmentHash);
		expect(
			BigInt(reveal.args.furtherActions ?? '0x1'),
			'one chunk closes the turn',
		).toBe(0n);
		const execution = await fuzdExecution(turn.schedule, 0);
		expect(execution?.hash, 'fuzd broadcast the reveal').toBe(
			reveal.transactionHash,
		);

		// A NEW PAGE finds the turn revealed, by somebody else, and the army on
		// the board.
		const later = await browserContext.newPage();
		await later.goto('/play');
		await expect(later.locator('canvas')).toBeVisible({timeout: 30_000});
		await expect
			.poll(async () => (await submissionStep(later)).step, {
				message: 'the turn should be found revealed, by somebody else',
				timeout: 90_000,
			})
			.toBe('Revealed');
		expect(
			await missedRevealStep(later),
			'a reveal by fuzd is not a missed one',
		).toBe('Clear');
		await expect(later.getByTestId('army-status')).toHaveText('On the board.', {
			timeout: 120_000,
		});
	});
});

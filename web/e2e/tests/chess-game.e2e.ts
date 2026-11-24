import {test, expect, describe} from '../fixtures/test';
import {
	armySquares,
	authoriseToPlay,
	clearAnyMissedReveal,
	deploy,
	forgetSubmissionAndReload,
	ghostSquares,
	planDeployment,
	planPieceMove,
	playedArmy,
	pressCommit,
	replanPieceMove,
	stakeAndWait,
	submissionStep,
	untilOnTheBoard,
	untilStep,
	waitForRoomToPlay,
} from '../fixtures/chess-game';

/**
 * The commit-reveal submission, end to end against a real chain, in chess.
 *
 * THIS GAME'S PORT of the template's `game.e2e.ts`, which drives the placement
 * game this repo replaced and is not carried (`.offshoot-omissions`). The same
 * claims, on chess turns: a DEPLOYMENT is planned in the HUD, committed as a
 * hash, and only stands on the board once it is revealed, and the army then
 * plays a MOVE; a missed reveal is reported with what it cost; a move the chain
 * holds and this browser lost is offered back.
 *
 * WHERE CHESS DIFFERS FROM THE PLACEMENT GAME, and the cases with it: an
 * army whose deployment was never revealed is not played again, so the
 * template's notice and its "Acknowledge" (keyed by the army played) give way
 * to the HUD's account of the last deployment once the player stakes again
 * (`lastDeployment`, `$lib/chess/ui/hud.ts`); and a lost submission is
 * recovered here for a MOVE, because a lost DEPLOYMENT cannot be re-entered
 * (`work/notes/observations/a-lost-deployment-cannot-be-recovered.md`). The template's fourth case, a turn bigger than
 * one transaction, has no chess form: the contract refuses a chained turn
 * (`OneMovePerCycle`, `contracts/rocketh/config.ts`), so a chess turn is always
 * one commit and one reveal.
 *
 * THE DESCRIBE TITLES ARE THE TEMPLATE'S, on purpose: `playwright.config.ts`
 * (the stem's) runs this file again in the `fuzd` project and leaves out
 * `A missed reveal` there by its title.
 *
 * Each suite deploys at a spawn point of its own (an index into the HUD's
 * list), so suites running side by side do not deploy onto each other.
 */

describe('Commit-reveal submission', () => {
	// One open commitment per army per cycle: this file's suites each take their
	// own burner account (`test/e2e-account-claims.test.ts`).
	test.use({walletAccountIndex: 0});

	test('plans a deployment, commits it, reveals it onto the board, and plays a move with it', async ({
		connectedPage,
		authoriseBrowser,
	}) => {
		// A deployment waits out a commit phase and a reveal phase, and its first
		// turn a whole cycle more.
		test.setTimeout(360_000);
		const page = connectedPage;

		// WHO OWNS and WHO SENDS are different addresses: the signer is a key this
		// browser made, which sends the turns, and the account owns the stake. And
		// WHO PLAYS is neither: it is an army, which the account owns.
		const senders = await page.evaluate(() => {
			const context = (globalThis as unknown as {context: any}).context;
			const read = <T>(store: {
				subscribe: (run: (v: T) => void) => unknown;
			}) => {
				let value!: T;
				const stop = store.subscribe((v: T) => (value = v)) as
					(() => void) | {unsubscribe(): void};
				if (typeof stop === 'function') stop();
				else stop.unsubscribe();
				return value;
			};
			const signer = read<any>(context.signerExecutor);
			return {
				account: read<string | undefined>(context.account),
				signer: signer.status === 'ready' ? signer.address : undefined,
				identity: read<string | undefined>(context.game.identity),
				hasLocalSigner: context.hasLocalSigner,
			};
		});
		expect(senders.hasLocalSigner, 'the app signs in, so a signer exists').toBe(
			true,
		);
		expect(senders.signer, 'the signer should be ready').toBeTruthy();
		expect(
			senders.signer?.toLowerCase(),
			'the sender must not be the account, or there is nothing to prove',
		).not.toBe(senders.account?.toLowerCase());
		// The account is who is signed in: clearing site data must not destroy
		// the player along with its stake.
		expect(
			senders.identity?.toLowerCase(),
			'the game must be signed in as the account, not as the key that signs',
		).toBe(senders.account?.toLowerCase());

		await authoriseToPlay(page, authoriseBrowser);
		await clearAnyMissedReveal(page);
		await stakeAndWait(page);

		// PLAN, through the HUD's list of open spawn points.
		await planDeployment(page, 0);
		const planned = await submissionStep(page);
		expect(planned.planned, 'the deployment is one action').toBe(1);
		expect(planned.spawnPoint, 'the plan names its spawn point').toBeDefined();
		expect(
			await armySquares(page),
			'nothing of the army is on the board before it is revealed',
		).toEqual([]);

		// WHAT THE PLAN LEADS TO, before anything is sent: the contract's own
		// layout, run in the browser's sandbox. Held to the reveal below.
		await expect
			.poll(async () => (await ghostSquares(page)).length, {
				message: 'the planned deployment should show where it will stand',
				timeout: 30_000,
			})
			.toBeGreaterThan(0);
		const preview = await ghostSquares(page);

		await pressCommit(page, 'commit-deployment');
		await untilStep(page, 'Committed', 'the commitment should reach the chain');
		// A commitment shows nobody where: that is the whole point of committing.
		expect(
			await armySquares(page),
			'a commitment must not put the army on the board',
		).toEqual([]);

		// The reveal is driven by the submission when the phase turns over: a
		// missed reveal costs the bond, so it is never left to the player.
		await untilStep(
			page,
			'Revealed',
			'the submission should reveal itself in the reveal phase',
			120_000,
		);

		// Only once the cycle resolves does the army stand on the board, where
		// the preview said it would.
		await untilOnTheBoard(page);
		await expect
			.poll(() => armySquares(page), {
				message: 'the revealed deployment should do what the preview said',
				timeout: 30_000,
			})
			.toEqual(preview);
		expect(
			(await submissionStep(page)).planned,
			'the planned deployment should have cleared',
		).toBe(0);

		// A TURN OF THE ARMY NOW ON THE BOARD: a piece-move (the online world
		// runs on its clock, so there is no Pass here), committed and revealed
		// like any other turn, and on the board when the cycle resolves.
		await waitForRoomToPlay(page, 12);
		const army = await playedArmy(page);
		const move = await planPieceMove(page);
		await pressCommit(page, 'commit-move');
		await untilStep(page, 'Committed', 'the move should be committed');
		expect(
			await armySquares(page),
			'a committed move must not move the piece yet',
		).toContain(move.from);
		await untilStep(page, 'Revealed', 'the move should be revealed', 120_000);
		expect(await playedArmy(page), 'the same army played the turn').toBe(army);
		await expect
			.poll(() => armySquares(page), {
				message: 'the moved piece should stand on its new square',
				timeout: 120_000,
			})
			.toContain(move.to);
	});
});

/**
 * Missing a reveal, and being told about it.
 *
 * A DEPLOYMENT whose reveal is missed is lost: its stake is burned when the
 * commitment is settled (`$lib/chess/missed-reveal.ts`), and the army is never
 * played (`ARMY_STATUS.Unrevealed`). So the player is back at deployment, and
 * the app has to say why, and what it cost, rather than leave them to wonder
 * where their stake went. The reveal is missed the way it is in real life: the
 * browser forgets the submission before the reveal phase, so the app can only
 * learn it from the CHAIN.
 */
describe('A missed reveal', () => {
	test.use({walletAccountIndex: 4});

	test('is reported with what it cost, and the player can deploy again', async ({
		connectedPage,
		authoriseBrowser,
	}) => {
		test.setTimeout(400_000);
		const page = connectedPage;
		await authoriseToPlay(page, authoriseBrowser);
		await clearAnyMissedReveal(page);
		await stakeAndWait(page);

		await planDeployment(page, 3);
		await pressCommit(page, 'commit-deployment');
		await untilStep(page, 'Committed', 'the commitment should reach the chain');
		const cycle = Number(
			await page.evaluate(`(() => {
				let info;
				const stop = globalThis.context.game.cycleInfo.subscribe((v) => (info = v));
				if (typeof stop === 'function') stop();
				return info.currentCycleNumber;
			})()`),
		);

		// Lose everything this browser knew about the submission, without losing
		// WHO the player is: not a fresh browser context, whose burner would be
		// another player.
		await forgetSubmissionAndReload(page);
		await expect(page.locator('canvas')).toBeVisible({timeout: 30_000});

		// The cycle passes with nothing revealed: the deployment is lost.
		await expect
			.poll(
				async () =>
					Number(
						await page.evaluate(`(() => {
							let info;
							const stop = globalThis.context.game.cycleInfo.subscribe((v) => (info = v));
							if (typeof stop === 'function') stop();
							return info.currentCycleNumber;
						})()`),
					),
				{message: 'the cycle should pass unrevealed', timeout: 180_000},
			)
			.toBeGreaterThan(cycle);

		// The stake went into the lost deployment, so the player stakes again,
		// and is then told what became of the last one, and what it cost.
		await stakeAndWait(page);
		await expect(
			page.getByTestId('last-deployment'),
			'the app should say the deployment was never revealed, from the chain alone',
		).toContainText(/never revealed/i, {timeout: 60_000});
		await expect(page.getByTestId('last-deployment-stake')).toContainText(
			/lost/i,
		);
		// And deploying again is offered.
		await expect(page.getByTestId('spawn-point').first()).toBeVisible();
	});
});

/**
 * A submission this browser has lost, which the chain still holds.
 *
 * A cleared browser, a second device, a private window: the contract holds a
 * commitment, a reveal is owed this cycle, and this client knows nothing about
 * it. While the cycle is still running, the app offers it back: the player
 * re-enters the same move, the app checks it against the commitment's hash,
 * and the ordinary machinery reveals it. IT ALL HAS TO HAPPEN INSIDE ONE CYCLE:
 * one tick later it is a missed reveal.
 *
 * A MOVE, not a deployment: a lost deployment cannot be re-entered, since the
 * army it committed already shows as deploying and the HUD offers no spawn
 * point to pick (`work/notes/observations/a-lost-deployment-cannot-be-recovered.md`).
 *
 * What the happy path proves that no unit test can: that the hash this app
 * builds a candidate plan into is the hash the CONTRACT stored. Were they to
 * differ, the adopted submission's reveal would revert and the last assertion
 * would never be reached.
 */
describe('A submission the chain holds and this browser has lost', () => {
	test.use({walletAccountIndex: 5});

	test('is offered back, and the recovered submission reveals itself', async ({
		connectedPage,
		authoriseBrowser,
	}) => {
		test.setTimeout(400_000);
		const page = connectedPage;

		await authoriseToPlay(page, authoriseBrowser);
		await clearAnyMissedReveal(page);
		// An army on the board, to move.
		await stakeAndWait(page);
		await deploy(page, 6);
		await untilOnTheBoard(page);

		// EVERYTHING AFTER THIS HAS TO FIT IN THE CYCLE, so the plan waits for a
		// play phase with room left in it.
		await waitForRoomToPlay(page, 14);
		const move = await planPieceMove(page);
		await pressCommit(page, 'commit-move');
		await untilStep(
			page,
			'Committed',
			'the commitment should reach the chain',
			60_000,
		);

		await forgetSubmissionAndReload(page);
		await expect(page.locator('canvas')).toBeVisible({timeout: 30_000});
		expect(
			(await submissionStep(page)).step,
			'the submission itself must genuinely know nothing',
		).toBe('Idle');

		const notice = page.getByText(/this browser no longer has the turn/i);
		await expect(
			notice,
			'the app should learn from the chain alone that a reveal is owed',
		).toBeVisible({timeout: 30_000});
		// It must not say the stake is gone. It is not, and that is the point.
		await expect(page.getByText(/can still be revealed/i)).toBeVisible();

		const recover = page.getByRole('button', {name: /recover turn/i});
		await expect(
			recover,
			'recovery needs a plan to check, and there is none yet',
		).toBeDisabled();

		// The same move, re-entered, with no wait for the clock: waiting for the
		// next play phase would be waiting for recovery to be impossible.
		await replanPieceMove(page, move);

		await recover.click();
		await untilStep(
			page,
			'Committed',
			'a recovered submission is a restored submission',
			30_000,
		);
		await expect(notice, 'nothing left to recover').toBeHidden();

		// THE STAKE IS SAVED BY THE ORDINARY MACHINERY: the recovered submission
		// reveals itself on the phase change like any other.
		await untilStep(
			page,
			'Revealed',
			'the recovered submission should reveal itself',
			120_000,
		);
	});
});

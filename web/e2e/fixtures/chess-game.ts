import {expect, type Page} from '@playwright/test';

/**
 * Reading and driving the chess game, for the suites that play it online.
 *
 * THIS GAME'S OWN COPY of what the template's `fixtures/game.ts` does for the
 * placement game, which this repo does not carry (`.offshoot-omissions`): that
 * fixture reads `view.cells` and clicks cells, and a chess board has neither.
 * What a suite needs from it is the same: the submission's step, the reserve,
 * the plan, and a way to make one through the UI. A chess turn is planned in
 * the HUD rather than on the canvas wherever it can be: a deployment is a
 * spawn point picked from the HUD's list and sent with its Deploy button, and
 * a turn of an army already on the board can always be a Pass. Both are what a
 * player does, and neither depends on where a square lands on the canvas.
 *
 * State is read out of the app (`globalThis.context`) rather than off the
 * screen, so an assertion fails on what the game BELIEVES rather than on how it
 * rendered. Every bigint leaves the page as a string: a bigint cannot cross the
 * evaluate boundary.
 */

/** Subscribe, take the value, unsubscribe. Written for the page context. */
const READ = `
	const read = (store) => {
		let value;
		const stop = store.subscribe((v) => (value = v));
		if (typeof stop === 'function') stop();
		else if (stop && typeof stop.unsubscribe === 'function') stop.unsubscribe();
		return value;
	};
`;

export type SubmissionStep = {
	step: string;
	message?: string;
	/** The account's reserve, once it is read. */
	reserve?: string;
	/** The spawn point a planned (or committed) deployment is for. */
	spawnPoint?: string;
	/** How many actions are planned: 1 for a deployment, 0 for none or a pass. */
	planned: number;
};

/** Read the submission out of the app, rather than inferring it from pixels. */
export async function submissionStep(page: Page): Promise<SubmissionStep> {
	return page.evaluate(`(() => {
		${READ}
		const game = globalThis.context.game;
		const submission = read(game.submission);
		const reserve = read(game.reserve);
		const actions = 'actions' in submission ? submission.actions : [];
		// A deployment is ONE action whose from and to are the spawn point
		// (\`deploymentAt\`, \`$lib/chess/commit-reveal\`).
		const spawnPoint =
			actions.length === 1 && actions[0].from === actions[0].to
				? actions[0].to.toString()
				: undefined;
		return {
			step: submission.step,
			message: submission.message,
			reserve: reserve.step === 'Loaded' ? reserve.amount.toString() : undefined,
			spawnPoint,
			planned: read(game.planning.count),
		};
	})()`) as Promise<SubmissionStep>;
}

/** Where the cycle clock currently is. */
export async function currentPhase(
	page: Page,
): Promise<{phase: string; timeLeft: number}> {
	return page.evaluate(`(() => {
		${READ}
		const phase = read(globalThis.context.game.threePhase);
		return {phase: phase.phase, timeLeft: phase.timeLeft};
	})()`) as Promise<{phase: string; timeLeft: number}>;
}

/** The army this client plays (`activeIdentity`), as a decimal string. */
export async function playedArmy(page: Page): Promise<string | undefined> {
	return page.evaluate(`(() => {
		${READ}
		const army = read(globalThis.context.game.activeIdentity);
		return army === undefined ? undefined : army.toString();
	})()`) as Promise<string | undefined>;
}

/**
 * Where the army this client plays stands on the board, as the board reports
 * it: the squares of its pieces, sorted. Empty while it is not on the board.
 */
export async function armySquares(page: Page): Promise<string[]> {
	return page.evaluate(`(() => {
		${READ}
		const view = read(globalThis.context.viewState);
		if (view.step !== 'Loaded' || view.you === undefined) return [];
		return [...view.pieces.values()]
			.filter((piece) => piece.army === view.you)
			.map((piece) => piece.position.toString())
			.sort();
	})()`) as Promise<string[]>;
}

/**
 * Where the planned deployment would stand, by the contract's own layout run in
 * the sandbox (the board's `ghost`): the squares, sorted. Empty until it
 * answers. Held to {@link armySquares} after the reveal, which is the point:
 * the preview is what the chain then does, not a guess beside it.
 */
export async function ghostSquares(page: Page): Promise<string[]> {
	return page.evaluate(`(() => {
		${READ}
		const view = read(globalThis.context.viewState);
		if (view.step !== 'Loaded') return [];
		return view.ghost.map((piece) => piece.position.toString()).sort();
	})()`) as Promise<string[]>;
}

/**
 * Put something at stake, whichever affordance is currently on screen.
 *
 * With an empty reserve the HUD shows the setup gate's own button INSTEAD of
 * the planning controls; once there is a reserve the same action is a
 * secondary button. Both go through the acquisition rail, BY TESTID (the
 * labels say what this game sells).
 */
export async function stake(page: Page): Promise<void> {
	await page
		.locator('[data-testid="acquire-stake"]')
		.or(page.locator('[data-testid="acquire-more-stake"]'))
		.first()
		.click({timeout: 60_000});

	// WHICHEVER PAYER IS OFFERED. With only one method the rail skips the choice.
	const chooser = page.locator('[data-testid="acquire-payment-methods"]');
	if (await chooser.isVisible({timeout: 10_000}).catch(() => false)) {
		await page
			.locator('[data-testid="acquire-pay-with-account"]')
			.or(page.locator('[data-testid="acquire-pay-with-wallet"]'))
			.first()
			.click({timeout: 30_000});
	}

	// The consent step, when this purchase also has something to sign.
	const consent = page.getByRole('button', {name: /^(sign and buy|buy)$/i});
	if (await consent.isVisible({timeout: 10_000}).catch(() => false)) {
		await consent.click({timeout: 30_000});
	}
}

/** Stake, and wait until the reserve has grown: there is then a bond to commit. */
export async function stakeAndWait(page: Page): Promise<void> {
	const before = BigInt((await submissionStep(page)).reserve ?? '0');
	await stake(page);
	await expect
		.poll(
			async () => BigInt((await submissionStep(page)).reserve ?? '0') > before,
			{message: 'the reserve should grow before playing', timeout: 60_000},
		)
		.toBe(true);
}

/**
 * Let this browser play for the account, if the board is asking. Usually a
 * no-op: acquiring a stake authorises the browser in the same transaction.
 */
export async function authoriseToPlay(
	page: Page,
	authoriseBrowser: (page: Page, options?: {via?: string}) => Promise<unknown>,
): Promise<void> {
	const button = page.getByRole('button', {name: /authorise and carry on/i});
	if (!(await button.isVisible({timeout: 10_000}).catch(() => false))) return;
	await button.click();
	await authoriseBrowser(page);
	await expect(button, 'authorising should let the board move on').toBeHidden({
		timeout: 60_000,
	});
}

/**
 * Settle anything an earlier run left unrevealed, exactly as a person would:
 * acknowledging FORFEITS the bond, so the app never does it unasked.
 */
export async function clearAnyMissedReveal(page: Page): Promise<void> {
	const acknowledge = page.getByRole('button', {
		name: /acknowledge missed reveal/i,
	});
	if (await acknowledge.isVisible({timeout: 5_000}).catch(() => false)) {
		await acknowledge.click();
		await expect(acknowledge, 'acknowledging should unblock play').toBeHidden({
			timeout: 60_000,
		});
	}
}

/**
 * Wait for a play phase with at least `secondsNeeded` left in it.
 *
 * A plan made in the wrong part of the cycle is not a bug, it just expires: the
 * submission drops an uncommitted plan when the cycle turns over.
 */
export async function waitForRoomToPlay(
	page: Page,
	secondsNeeded = 8,
): Promise<void> {
	await expect
		.poll(
			async () => {
				const phase = await currentPhase(page);
				return phase.phase === 'play' && phase.timeLeft > secondsNeeded;
			},
			{
				message: `a play phase with at least ${secondsNeeded}s left`,
				timeout: 120_000,
			},
		)
		.toBe(true);
	// A connect dialog on its way out still covers the HUD for a moment, and a
	// click that lands on it is swallowed silently.
	await expect(page.locator('[role="dialog"]')).toHaveCount(0, {
		timeout: 15_000,
	});
}

/**
 * The open spawn points the HUD lists, as their labels (the order is the
 * HUD's: nearest the origin first).
 */
export async function spawnPointLabels(page: Page): Promise<string[]> {
	const list = page.locator('[data-testid="spawn-point"]');
	await expect(list.first()).toBeVisible({timeout: 60_000});
	return (await list.allTextContents()).map((text) => text.trim());
}

/**
 * Pick a spawn point in the HUD's list, by its label, and wait for the plan.
 * With no wait for the clock: see {@link planDeployment}.
 */
export async function pickSpawnPoint(page: Page, label: string): Promise<void> {
	await page
		.locator('[data-testid="spawn-point"]')
		.filter({hasText: label})
		.first()
		.click();
	await expect
		.poll(async () => (await submissionStep(page)).spawnPoint, {
			message: 'picking a spawn point should plan a deployment',
			timeout: 15_000,
		})
		.toBeDefined();
}

/**
 * Plan a deployment through the HUD: wait for room in the play phase, then pick
 * the `index`-th open spawn point, counting round the list.
 *
 * AN INDEX PER SUITE, because suites run in parallel on one board, and two
 * armies deployed on one spawn point in one cycle collide: a suite should not
 * meet another's army at the square it is about. Returns the label, so a suite
 * can pick the same spawn point again (a recovery must re-enter the same plan).
 */
export async function planDeployment(
	page: Page,
	index: number,
	secondsNeeded = 8,
): Promise<string> {
	await waitForRoomToPlay(page, secondsNeeded);
	const labels = await spawnPointLabels(page);
	const label = labels[index % labels.length];
	await pickSpawnPoint(page, label);
	return label;
}

/**
 * Press the button that commits the plan now (Deploy, Commit or Pass), once it
 * is live. A Pass exists only where the cycle waits for everyone (a table, the
 * offline world): the online world runs on its clock, so a turn there is a
 * move (`$lib/chess/ui/hud.ts`, `canPass`).
 */
export async function pressCommit(
	page: Page,
	testid: 'commit-deployment' | 'commit-move' | 'pass',
): Promise<void> {
	const button = page.getByTestId(testid);
	await expect(button, `the ${testid} button should be live`).toBeEnabled({
		timeout: 60_000,
	});
	await button.click();
}

/** Wait for the submission to reach `step`. */
export async function untilStep(
	page: Page,
	step: string,
	message: string,
	timeout = 90_000,
): Promise<void> {
	await expect
		.poll(async () => (await submissionStep(page)).step, {message, timeout})
		.toBe(step);
}

/**
 * Plan a deployment, commit it, and wait until it is revealed: the army is then
 * on the board from the next cycle.
 */
export async function deploy(page: Page, index: number): Promise<string> {
	const label = await planDeployment(page, index);
	await pressCommit(page, 'commit-deployment');
	await untilStep(page, 'Committed', 'the deployment should reach the chain');
	await untilStep(
		page,
		'Revealed',
		'the deployment should reveal itself in the reveal phase',
		120_000,
	);
	return label;
}

/**
 * Wait until the army this client plays stands on the board (the HUD's army
 * status, which is the registry's), and is offered a turn of its own.
 */
export async function untilOnTheBoard(page: Page): Promise<void> {
	await expect(page.getByTestId('army-status')).toHaveText('On the board.', {
		timeout: 120_000,
	});
}

export type PieceMove = {from: string; to: string};

/** Click a square of the board: what the canvas's click handler does with a click. */
async function clickSquare(page: Page, square: string): Promise<void> {
	await page.evaluate(
		`globalThis.context.game.planning.click(BigInt('${square}'))`,
	);
}

/**
 * Plan ONE piece-move of the army this client plays: select a piece of its own
 * that has somewhere to go, and pick its first legal destination.
 *
 * THROUGH THE PLANNING STORE, NOT THE CANVAS: a square's place on the canvas
 * depends on the camera and the viewport, and `planning.click(square)` is what
 * the canvas's click handler calls with the square it hit
 * (`$lib/chess/context.ts`). The legal destinations are the contract's own
 * rule, run in the sandbox, exactly as for a click.
 */
export async function planPieceMove(page: Page): Promise<PieceMove> {
	const pieces = (await page.evaluate(`(() => {
		${READ}
		const view = read(globalThis.context.viewState);
		if (view.step !== 'Loaded' || view.you === undefined) return [];
		return [...view.pieces.values()]
			.filter((piece) => piece.army === view.you)
			.map((piece) => piece.position.toString());
	})()`)) as string[];
	expect(pieces.length, 'the army should stand on the board').toBeGreaterThan(
		0,
	);
	for (const from of pieces) {
		await clickSquare(page, from);
		// The sandbox answers where the piece may go, or that it may go nowhere.
		await expect
			.poll(
				() =>
					page.evaluate(`(() => {
						${READ}
						return read(globalThis.context.game.planning.destinationsLookup).step;
					})()`),
				{
					message: "the piece's destinations should be worked out",
					timeout: 30_000,
				},
			)
			.not.toBe('Pending');
		const destinations = (await page.evaluate(`(() => {
			${READ}
			const plan = read(globalThis.context.game.planning.plan);
			return (plan.destinations ?? []).map((square) => square.toString());
		})()`)) as string[];
		if (destinations.length === 0) {
			await clickSquare(page, from); // let it go, and try the next piece
			continue;
		}
		const move = {from, to: destinations[0]};
		await clickSquare(page, move.to);
		await expect
			.poll(async () => (await submissionStep(page)).planned, {
				message: 'picking a destination should plan the piece-move',
				timeout: 15_000,
			})
			.toBe(1);
		return move;
	}
	throw new Error('no piece of the army has anywhere to go');
}

/** Plan the same piece-move again: select its piece, pick its destination. */
export async function replanPieceMove(
	page: Page,
	move: PieceMove,
): Promise<void> {
	await clickSquare(page, move.from);
	await expect
		.poll(
			() =>
				page.evaluate(`(() => {
					${READ}
					const plan = read(globalThis.context.game.planning.plan);
					return (plan.destinations ?? []).map((square) => square.toString());
				})()`),
			{
				message: 'the piece should be offered its destinations',
				timeout: 30_000,
			},
		)
		.toContain(move.to);
	await clickSquare(page, move.to);
	await expect
		.poll(async () => (await submissionStep(page)).planned, {
			message: 'the same piece-move, re-entered',
			timeout: 15_000,
		})
		.toBe(1);
}

/**
 * Lose everything this browser knows about the submission, without losing WHO
 * the player is, and reload.
 *
 * The submission lives in the ACCOUNT DATA: the `submissions` and
 * `committedTurns` fields of every `__private__` record in `localStorage`.
 * They are emptied by a script that runs BEFORE the app on the reload, once:
 * emptied from the running page instead, the account data still holds them in
 * memory and its next save would write them back.
 */
export async function forgetSubmissionAndReload(page: Page): Promise<void> {
	const once = `__e2e_forget_submission_${Date.now()}`;
	await page.addInitScript((flag) => {
		if (sessionStorage.getItem(flag)) return;
		sessionStorage.setItem(flag, '1');
		for (let i = 0; i < localStorage.length; i++) {
			const key = localStorage.key(i);
			if (!key?.startsWith('__private__')) continue;
			try {
				const blob = JSON.parse(localStorage.getItem(key) ?? '') as {
					data?: Record<string, unknown>;
					$itemTimestamps?: Record<string, unknown>;
				};
				if (!blob?.data) continue;
				blob.data.submissions = {};
				blob.data.committedTurns = {};
				if (blob.$itemTimestamps) {
					blob.$itemTimestamps.submissions = {};
					blob.$itemTimestamps.committedTurns = {};
				}
				localStorage.setItem(key, JSON.stringify(blob));
			} catch {
				// Other things share the prefix; only account data parses this way.
			}
		}
	}, once);
	await page.reload();
}

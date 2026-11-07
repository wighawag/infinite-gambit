import type {Page} from '@playwright/test';
import {test, expect, describe} from '../fixtures/test';

/**
 * THE OFFLINE DEMO PRESETS (`$lib/offline-presets`), in a browser: each preset
 * opens from its URL one move away from the rule it shows, and the scripted
 * decisive move, played by each person at the device through their own
 * submission, does what the hint says once the cycle closes. The browser is
 * taken OFFLINE as soon as the preset is on screen, so every move, every
 * reveal, every advance and the restart run with no network at all.
 *
 * Also: "Restart preset" brings the starting position back, and a preset never
 * touches the player's own offline world (its chain id, its seats, its played
 * turns, its armies).
 *
 * The positions themselves are proven in node against the same contract
 * (`test/lib/offline-presets.test.ts`); this holds the route, the hint, the
 * hotseat around them and the isolation. Squares are the presets' own: the
 * tight grid, the person in seat 1 on (0,0), seat 2 on (6,0), the world's seat
 * on (6,6).
 *
 * Its chain exists only inside the page, so it claims no wallet account from
 * the shared pool.
 */

const READ = `
	const read = (store) => {
		let value;
		const stop = store.subscribe((v) => (value = v));
		if (typeof stop === 'function') stop();
		else if (stop && typeof stop.unsubscribe === 'function') stop.unsubscribe();
		return value;
	};
	const world = globalThis.offlineWorld;
	const square = (x, y) => (BigInt.asUintN(32, BigInt(y)) << 32n) + BigInt.asUintN(32, BigInt(x));
	const game = () => {
		const records = world.world.deployments.get();
		return {address: records.contracts.Game.address, abi: records.contracts.Game.abi};
	};
`;

const KIND = ['.', 'P', 'N', 'B', 'R', 'Q', 'K', 'S'];
/** Where the normal world's seats keep their decided turns. */
const PLAYED = 'offline-world:played-turns';
const CAPTURED = 6;
const EXITED = 7;

type Square = [number, number];
type Move = [Square, Square];

/** What stands on a square: its kind and army id, or nothing. */
async function pieceAt(
	page: Page,
	[x, y]: Square,
): Promise<{kind: string; army: string} | undefined> {
	const found = (await page.evaluate(`(async () => {
		${READ}
		const [pieces] = await world.context.publicClient.readContract({
			...game(),
			functionName: 'getPieces',
			args: [${x}, ${y}, ${x}, ${y}],
		});
		return pieces.length === 0
			? undefined
			: {kind: pieces[0].kind, army: pieces[0].army.toString()};
	})()`)) as {kind: number; army: string} | undefined;
	return found ? {kind: KIND[found.kind], army: found.army} : undefined;
}

/** An army's status and stake, as the registry shows them. */
async function armyOf(
	page: Page,
	army: string,
): Promise<{status: number; stake: string; owner: string}> {
	return page.evaluate(`(async () => {
		${READ}
		const view = await world.context.publicClient.readContract({
			...game(),
			functionName: 'getArmy',
			args: [${army}n],
		});
		return {status: Number(view.status), stake: view.stake.toString(), owner: view.owner};
	})()`) as Promise<{status: number; stake: string; owner: string}>;
}

async function chainId(page: Page): Promise<number> {
	return page.evaluate(
		`globalThis.offlineWorld.world.deployments.get().chain.id`,
	) as Promise<number>;
}

/** The current cycle number. */
async function cycle(page: Page): Promise<number> {
	return page.evaluate(`(async () => {
		${READ}
		const c = await world.context.publicClient.readContract({...game(), functionName: 'getCycle'});
		return Number(c.cycleNumber);
	})()`) as Promise<number>;
}

/** The preset's world is on screen. */
async function presetOnScreen(page: Page): Promise<void> {
	await expect(page.getByTestId('preset-hint')).toBeVisible({
		timeout: 180_000,
	});
}

/**
 * Commit `moves` (a pass when empty) as whoever is signed in, through the
 * game's own submission: what the board's Commit and Pass buttons call.
 */
async function commit(page: Page, moves: readonly Move[]): Promise<void> {
	const list = moves
		.map(
			([[fx, fy], [tx, ty]]) =>
				`{from: square(${fx}, ${fy}), to: square(${tx}, ${ty})}`,
		)
		.join(', ');
	await expect
		.poll(
			() =>
				page.evaluate(`(async () => {
					${READ}
					const submission = world.context.game.submission;
					const state = read(submission);
					if (['Committing', 'Committed', 'Revealing', 'Revealed'].includes(state.step)) return state.step;
					if (${moves.length} > 0) submission.plan([${list}]);
					await submission.commit();
					const after = read(submission);
					if (after.step !== 'Error') return after.step;
					const board = read(world.context.onchainState);
					return 'Error: ' + after.message + ' [board ' + board?.step + ']';
				})()`),
			{timeout: 60_000},
		)
		.toMatch(/Committing|Committed|Revealing|Revealed/);
}

/** Where a square's centre is on the page, through the board's own camera. */
async function onScreen(
	page: Page,
	[x, y]: Square,
): Promise<{x: number; y: number}> {
	const point = (await page.evaluate(`(() => {
		const {transform, screen} = globalThis.offlineWorld.context.render.cameraControl.current;
		return {
			x: screen.width / 2 + (${x} - transform.centerX) * transform.scale,
			y: screen.height / 2 + (${y} - transform.centerY) * transform.scale,
		};
	})()`)) as {x: number; y: number};
	const box = (await page.locator('canvas').first().boundingBox())!;
	return {x: box.x + point.x, y: box.y + point.y};
}

/**
 * PLAY A MOVE THE WAY A PERSON DOES: click the piece on the board, click where
 * it goes, press Commit. Whichever renderer draws the board (`PUBLIC_RENDERER`).
 */
async function clickMove(page: Page, from: Square, to: Square): Promise<void> {
	// As a person would: once the board has loaded.
	await expect
		.poll(
			() =>
				page.evaluate(`(() => {
					${READ}
					return read(world.context.onchainState).step;
				})()`),
			{timeout: 60_000},
		)
		.toBe('Loaded');
	const source = await onScreen(page, from);
	await page.mouse.click(source.x, source.y);

	// Selected: the board asks the rules where it may go, and says so.
	await expect
		.poll(
			() =>
				page.evaluate(`(() => {
					${READ}
					return read(world.context.game.planning.destinationsLookup).step;
				})()`),
			{timeout: 60_000},
		)
		.toBe('Ready');
	const target = await onScreen(page, to);
	await page.mouse.click(target.x, target.y);
	await expect(
		page.getByText(`(${from[0]}, ${from[1]}) to (${to[0]}, ${to[1]})`),
	).toBeVisible({timeout: 30_000});
	await expect(page.getByTestId('commit-move')).toBeEnabled({timeout: 30_000});
	await page.getByTestId('commit-move').click();
}

/** Take the device as `label`, and wait for the board. */
async function begin(page: Page, label: string): Promise<void> {
	await expect(page.getByTestId('handover-to')).toHaveText(
		`Pass the device to ${label}`,
		{timeout: 120_000},
	);
	await page.getByTestId('handover-begin').click();
	await expect(page.getByTestId('handover')).toHaveCount(0, {timeout: 60_000});
	await expect(page.locator('canvas')).toBeVisible({timeout: 30_000});
}

/**
 * One hotseat cycle: Player 1 commits `first`, Player 2 commits `second`, and
 * the world closes the cycle (its seat passes, the revealer reveals both).
 */
async function hotseatCycle(
	page: Page,
	first: readonly Move[],
	second: readonly Move[],
): Promise<void> {
	const before = await cycle(page);
	await begin(page, 'Player 1');
	await commit(page, first);
	await begin(page, 'Player 2');
	await commit(page, second);
	await expect.poll(() => cycle(page), {timeout: 120_000}).toBe(before + 1);
}

/** The first open spawn point, as the contract lists them. */
async function openSpawnPoint(page: Page): Promise<Square> {
	return page.evaluate(`(async () => {
		${READ}
		const [open] = await world.context.publicClient.readContract({...game(), functionName: 'getOpenSpawnPoints'});
		const p = open[0];
		return [Number(BigInt.asIntN(32, p & 0xffffffffn)), Number(BigInt.asIntN(32, p >> 32n))];
	})()`) as Promise<Square>;
}

/** The registry entries of an account's armies. */
async function armiesOf(
	page: Page,
	owner: string,
): Promise<{id: string; status: number}[]> {
	return page.evaluate(`(async () => {
		${READ}
		const list = await world.context.publicClient.readContract({...game(), functionName: 'getArmiesOf', args: ['${owner}']});
		return list.map((a) => ({id: a.id.toString(), status: Number(a.status)}));
	})()`) as Promise<{id: string; status: number}[]>;
}

/** Who is signed in. */
async function whoPlays(page: Page): Promise<string> {
	return page.evaluate(`(() => {
		${READ}
		return read(world.context.account);
	})()`) as Promise<string>;
}

async function goOffline(page: Page): Promise<void> {
	await page.context().setOffline(true);
}

/**
 * Open a preset AS THE DEMO DOES: once online, so the app's service worker
 * holds every file of the build, then with the network off, reloaded, so the
 * preset boots and plays with nothing but what the browser already has.
 */
async function bootPresetOffline(page: Page, id: string): Promise<void> {
	if (process.env.E2E_PRESET_DEBUG) {
		page.on('console', (m) => {
			if (m.type() === 'error' || m.type() === 'warning')
				console.log(`[page ${m.type()}] ${m.text().slice(0, 400)}`);
		});
	}
	await page.goto(`/offline/?preset=${id}`);
	await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, {
		timeout: 120_000,
	});
	// Controlled now: this load is the one the worker keeps.
	await page.reload();
	await presetOnScreen(page);
	if (process.env.E2E_PRESET_SHOTS) {
		await page.waitForTimeout(4000);
		await page.screenshot({path: test.info().outputPath(`${id}-online.png`)});
	}
	await goOffline(page);
	await page.reload();
	await presetOnScreen(page);
	if (process.env.E2E_PRESET_SHOTS) {
		await page.waitForTimeout(4000);
		await page.screenshot({path: test.info().outputPath(`${id}-offline.png`)});
	}
}

describe('Offline demo presets', () => {
	test('showcase: a dodge, a collision and a king capture, back to back, offline', async ({
		page,
	}) => {
		test.setTimeout(10 * 60_000);
		await bootPresetOffline(page, 'showcase');
		if (process.env.E2E_PRESET_SHOTS) {
			// What the board shows as it first appears: the setup's cycles must
			// not play back as a burst of animations.
			await page.getByTestId('handover-begin').click({timeout: 120_000});
			await expect(page.locator('canvas')).toBeVisible({timeout: 30_000});
			for (const ms of [50, 400, 1200]) {
				await page.waitForTimeout(ms);
				await page.screenshot({
					path: test.info().outputPath(`showcase-first-board-${ms}.png`),
				});
			}
			await page.reload();
			await presetOnScreen(page);
		}

		const p1 = (await pieceAt(page, [2, 1]))!.army;
		const p2 = (await pieceAt(page, [3, 0]))!.army;
		expect(await pieceAt(page, [3, 0])).toEqual({kind: 'N', army: p2});
		const world = (await pieceAt(page, [6, 6]))!.army;
		expect(await pieceAt(page, [5, 4])).toEqual({kind: 'N', army: p2});

		// The dodge.
		await hotseatCycle(
			page,
			[
				[
					[2, 1],
					[3, 0],
				],
			],
			[
				[
					[3, 0],
					[4, 2],
				],
			],
		);
		expect(await pieceAt(page, [3, 0])).toEqual({kind: 'P', army: p1});
		expect(await pieceAt(page, [4, 2])).toEqual({kind: 'N', army: p2});

		// The collision.
		await hotseatCycle(
			page,
			[
				[
					[2, -1],
					[3, -1],
				],
			],
			[
				[
					[4, -1],
					[3, -1],
				],
			],
		);
		expect(await pieceAt(page, [3, -1])).toBeUndefined();
		expect(await pieceAt(page, [2, -1])).toBeUndefined();
		expect(await pieceAt(page, [4, -1])).toBeUndefined();

		// The king capture.
		const stakes = {
			p2: BigInt((await armyOf(page, p2)).stake),
			world: BigInt((await armyOf(page, world)).stake),
		};
		await hotseatCycle(
			page,
			[],
			[
				[
					[5, 4],
					[6, 6],
				],
			],
		);
		expect(await pieceAt(page, [6, 6])).toEqual({kind: 'Q', army: p2});
		expect((await armyOf(page, world)).status).toBe(CAPTURED);
		expect(BigInt((await armyOf(page, p2)).stake)).toBe(
			stakes.p2 + stakes.world,
		);
	});

	test('showcase-spawn: a third person chooses a spawn point and deploys on camera, beside the dodge, offline', async ({
		page,
	}) => {
		test.setTimeout(8 * 60_000);
		await bootPresetOffline(page, 'showcase-spawn');
		const p1 = (await pieceAt(page, [2, 1]))!.army;
		const p2 = (await pieceAt(page, [3, 0]))!.army;
		const before = await cycle(page);

		await begin(page, 'Player 1');
		await commit(page, [
			[
				[2, 1],
				[3, 0],
			],
		]);
		await begin(page, 'Player 2');
		await commit(page, [
			[
				[3, 0],
				[4, 2],
			],
		]);
		await begin(page, 'Player 3');
		const player3 = await whoPlays(page);
		expect(await armiesOf(page, player3)).toEqual([]);
		// The deploy controls are offered: this seat has a stake and no army.
		await expect(page.getByTestId('spawn-point').first()).toBeVisible({
			timeout: 60_000,
		});
		const spawn = await openSpawnPoint(page);
		await commit(page, [[spawn, spawn]]);
		await expect.poll(() => cycle(page), {timeout: 120_000}).toBe(before + 1);

		expect(await pieceAt(page, [3, 0])).toEqual({kind: 'P', army: p1});
		expect(await pieceAt(page, [4, 2])).toEqual({kind: 'N', army: p2});
		const deployed = await armiesOf(page, player3);
		expect(deployed.map((a) => a.status)).toEqual([2]);
		expect(await pieceAt(page, spawn)).toEqual({
			kind: 'K',
			army: deployed[0].id,
		});
	});

	test('chase-trade: the king steps away, its queen and the knight land where it stood and both die, offline', async ({
		page,
	}) => {
		test.setTimeout(6 * 60_000);
		await bootPresetOffline(page, 'chase-trade');
		const p1 = (await pieceAt(page, [0, 0]))!.army;
		expect(await pieceAt(page, [0, 0])).toEqual({kind: 'K', army: p1});
		expect(await pieceAt(page, [-1, 0])).toEqual({kind: 'Q', army: p1});
		expect((await pieceAt(page, [2, -1]))?.kind).toBe('N');

		await hotseatCycle(
			page,
			[
				[
					[0, 0],
					[1, 0],
				],
				[
					[-1, 0],
					[0, 0],
				],
			],
			[
				[
					[2, -1],
					[0, 0],
				],
			],
		);
		expect(await pieceAt(page, [1, 0])).toEqual({kind: 'K', army: p1});
		expect(await pieceAt(page, [0, 0])).toBeUndefined();
		expect(await pieceAt(page, [-1, 0])).toBeUndefined();
		expect(await pieceAt(page, [2, -1])).toBeUndefined();
	});

	test('collision: both pawns die on the empty square, offline', async ({
		page,
	}) => {
		test.setTimeout(6 * 60_000);
		await bootPresetOffline(page, 'collision');
		expect((await pieceAt(page, [2, 0]))?.kind).toBe('P');
		expect((await pieceAt(page, [4, 0]))?.kind).toBe('P');

		// Played through the board itself: click, click, Commit.
		const before = await cycle(page);
		await begin(page, 'Player 1');
		await clickMove(page, [2, 0], [3, 0]);
		await begin(page, 'Player 2');
		await clickMove(page, [4, 0], [3, 0]);
		await expect.poll(() => cycle(page), {timeout: 120_000}).toBe(before + 1);
		expect(await pieceAt(page, [3, 0])).toBeUndefined();
		expect(await pieceAt(page, [2, 0])).toBeUndefined();
		expect(await pieceAt(page, [4, 0])).toBeUndefined();
	});

	test('king-capture: the lone knight takes the king that stayed, and its stake, offline', async ({
		page,
	}) => {
		test.setTimeout(6 * 60_000);
		await bootPresetOffline(page, 'king-capture');
		const p2 = (await pieceAt(page, [5, 4]))!.army;
		const world = (await pieceAt(page, [6, 6]))!.army;
		const stakes = {
			p2: BigInt((await armyOf(page, p2)).stake),
			world: BigInt((await armyOf(page, world)).stake),
		};

		await hotseatCycle(
			page,
			[],
			[
				[
					[5, 4],
					[6, 6],
				],
			],
		);
		expect(await pieceAt(page, [6, 6])).toEqual({kind: 'Q', army: p2});
		expect((await armyOf(page, world)).status).toBe(CAPTURED);
		expect(BigInt((await armyOf(page, p2)).stake)).toBe(
			stakes.p2 + stakes.world,
		);
		// Every piece of the captured army has left the board.
		expect(await pieceAt(page, [6, 7])).toBeUndefined();
	});

	test('dodge: the attacker lands on the square the knight left, offline', async ({
		page,
	}) => {
		test.setTimeout(6 * 60_000);
		await bootPresetOffline(page, 'dodge');
		const p1 = (await pieceAt(page, [2, 1]))!.army;
		const p2 = (await pieceAt(page, [3, 0]))!.army;

		await hotseatCycle(
			page,
			[
				[
					[2, 1],
					[3, 0],
				],
			],
			[
				[
					[3, 0],
					[4, 2],
				],
			],
		);
		expect(await pieceAt(page, [3, 0])).toEqual({kind: 'P', army: p1});
		expect(await pieceAt(page, [4, 2])).toEqual({kind: 'N', army: p2});
	});

	test('exit: the king steps onto the exit and its stake is paid out in ETH, offline', async ({
		page,
	}) => {
		test.setTimeout(6 * 60_000);
		await bootPresetOffline(page, 'exit');
		const king = (await pieceAt(page, [2, -2]))!;
		expect(king.kind).toBe('K');
		const owner = (await armyOf(page, king.army)).owner;
		const eth = () =>
			page.evaluate(`(async () => {
				${READ}
				return (await world.context.publicClient.getBalance({address: '${owner}'})).toString();
			})()`) as Promise<string>;

		await expect(page.locator('canvas')).toBeVisible({timeout: 30_000});
		const before = await cycle(page);
		await commit(page, [
			[
				[2, -2],
				[3, -2],
			],
		]);
		await expect.poll(() => cycle(page), {timeout: 120_000}).toBe(before + 1);
		expect((await armyOf(page, king.army)).status).toBe(EXITED);
		expect(await pieceAt(page, [3, -2])).toBeUndefined();

		const ethBeforePayout = BigInt(await eth());
		await page.getByTestId('exit-payout').click({timeout: 60_000});
		// Paid: the army holds nothing, and the sale paid its owner in ETH at
		// the sale's price. Measured against the payout's own receipt, because
		// the offline price (0.00000001 ETH) is smaller than the gas the owner's
		// key paid to send it, so the balance alone would go DOWN.
		await expect
			.poll(async () => (await armyOf(page, king.army)).stake, {
				timeout: 60_000,
			})
			.toBe('0');
		const payout = (await page.evaluate(`(async () => {
			${READ}
			const records = world.world.deployments.get();
			const [log] = await world.context.publicClient.getContractEvents({
				address: records.contracts.StakeSale.address,
				abi: records.contracts.StakeSale.abi,
				eventName: 'Redeemed',
				fromBlock: 0n,
			});
			const receipt = await world.context.publicClient.getTransactionReceipt({hash: log.transactionHash});
			return {
				to: log.args.to,
				paid: log.args.paid.toString(),
				from: receipt.from,
				fee: (receipt.gasUsed * receipt.effectiveGasPrice).toString(),
			};
		})()`)) as {to: string; paid: string; from: string; fee: string};
		expect(payout.to.toLowerCase()).toBe(owner.toLowerCase());
		expect(BigInt(payout.paid)).toBeGreaterThan(0n);
		const fee =
			payout.from.toLowerCase() === owner.toLowerCase()
				? BigInt(payout.fee)
				: 0n;
		expect(BigInt(await eth())).toBe(
			ethBeforePayout - fee + BigInt(payout.paid),
		);
	});

	test('restart brings the position back, and the normal offline world is untouched', async ({
		page,
	}) => {
		test.setTimeout(10 * 60_000);

		// THE PLAYER'S OWN WORLD FIRST, as a returning player has one.
		await page.goto('/offline/');
		await expect(page.getByText('Play offline')).toBeVisible({
			timeout: 60_000,
		});
		await page.getByTestId('seats-3').click();
		await page.getByTestId('level-0-greedy').click();
		await page.getByTestId('sit-down').click();
		await expect(page.locator('canvas')).toBeVisible({timeout: 180_000});
		const normalChain = await chainId(page);
		const kept = () =>
			page.evaluate(() => {
				const out: Record<string, string | null> = {};
				for (let i = 0; i < localStorage.length; i++) {
					const key = localStorage.key(i)!;
					if (key.startsWith('offline-world:')) {
						out[key] = localStorage.getItem(key);
					}
				}
				return out;
			});
		// The greedy seat has decided its turn, so its played turns are kept: the
		// store a preset's seats must never share (it drops other chains' turns).
		await expect
			.poll(async () => JSON.parse((await kept())[PLAYED] ?? '[]').length, {
				timeout: 120_000,
			})
			.toBeGreaterThan(0);
		const keptBefore = await kept();
		expect(keptBefore['offline-world:chain-id']).toBe(String(normalChain));
		const armiesBefore = await page.evaluate(`(async () => {
			${READ}
			const [list] = await world.context.publicClient.readContract({
				...game(), functionName: 'getArmies', args: [0n, 100n],
			});
			return list.map((a) => a.id.toString() + ':' + a.status).sort();
		})()`);

		// A PRESET, from the lobby's list, played one move and restarted.
		await page.goto('/offline/?preset=collision');
		await presetOnScreen(page);
		const firstChain = await chainId(page);
		expect(firstChain).not.toBe(normalChain);
		await goOffline(page);
		await hotseatCycle(
			page,
			[
				[
					[2, 0],
					[3, 0],
				],
			],
			[
				[
					[4, 0],
					[3, 0],
				],
			],
		);
		expect(await pieceAt(page, [2, 0])).toBeUndefined();

		const started = Date.now();
		await page.getByTestId('preset-restart').click();
		await expect
			.poll(
				async () =>
					(await page
						.evaluate(
							`globalThis.offlineWorld?.world.deployments.get().chain.id`,
						)
						.catch(() => undefined)) ?? firstChain,
				{timeout: 120_000},
			)
			.not.toBe(firstChain);
		await presetOnScreen(page);
		await expect
			.poll(async () => (await pieceAt(page, [2, 0]))?.kind, {
				timeout: 60_000,
			})
			.toBe('P');
		expect((await pieceAt(page, [4, 0]))?.kind).toBe('P');
		console.log(`restart took ${Date.now() - started} ms`);
		// The board is a fresh one at the top of a commit phase: Player 1's turn.
		await expect(page.getByTestId('handover-to')).toHaveText(
			'Pass the device to Player 1',
			{timeout: 60_000},
		);

		// BACK TO THE PLAYER'S OWN WORLD: the same chain, the same keys, the
		// same armies.
		await page.context().setOffline(false);
		await page.getByTestId('preset-leave').click();
		await expect(page.locator('canvas')).toBeVisible({timeout: 180_000});
		await expect(page.getByTestId('preset-hint')).toHaveCount(0);
		expect(await chainId(page)).toBe(normalChain);
		const keptAfter = await kept();
		for (const [key, value] of Object.entries(keptBefore)) {
			if (key !== PLAYED) expect(keptAfter[key], key).toBe(value);
		}
		// The seat may have decided again since; nothing it had kept is gone.
		expect(JSON.parse(keptAfter[PLAYED] ?? '[]')).toEqual(
			expect.arrayContaining(JSON.parse(keptBefore[PLAYED]!)),
		);
		const armiesAfter = await page.evaluate(`(async () => {
			${READ}
			const [list] = await world.context.publicClient.readContract({
				...game(), functionName: 'getArmies', args: [0n, 100n],
			});
			return list.map((a) => a.id.toString() + ':' + a.status).sort();
		})()`);
		expect(armiesAfter).toEqual(armiesBefore);
	});

	test('the lobby lists the presets, and starting one there opens it', async ({
		page,
	}) => {
		test.setTimeout(6 * 60_000);
		await page.goto('/offline/');
		await expect(page.getByText('Demo presets')).toBeVisible({
			timeout: 60_000,
		});
		for (const id of [
			'showcase',
			'showcase-spawn',
			'chase-trade',
			'collision',
			'king-capture',
			'dodge',
			'exit',
		]) {
			await expect(page.getByTestId(`preset-${id}`)).toBeVisible();
		}
		await page.getByTestId('preset-king-capture').click();
		await presetOnScreen(page);
		await expect(page.getByTestId('preset-hint')).toContainText('King capture');
		// Hidden for the recording with one key, and back with it.
		await page.keyboard.press('h');
		await expect(page.getByTestId('preset-hint')).toHaveCount(0);
		await page.keyboard.press('h');
		await expect(page.getByTestId('preset-hint')).toBeVisible();
	});
});

import type {Page} from '@playwright/test';
import {mnemonicToAccount} from 'viem/accounts';
import {
	test,
	expect,
	describe,
	chooseTheWorld,
	expectTheReloadToResume,
} from '../fixtures/test';

/**
 * AI SEATS IN THE OFFLINE WORLD: one person against two world seats at the
 * `greedy` level, two cycles (stratagems' port plan, step A1).
 *
 * What it holds: the lobby offers a level per world seat and the world plays
 * them; each greedy seat decides its turn in the commit phase and stores it
 * before committing (`offline-world:played-turns`); and a reload in the reveal
 * phase still closes the cycle, the seats revealing the turns they stored
 * rather than deciding again on a board that has moved.
 *
 * PORTED TO CHESS here (the template's reads cells and plays a placement):
 * every seat stands on the board from the first cycle shown
 * (`$lib/offline-boot`), so the cycle numbers are read off the chain rather
 * than assumed, a seat's stored turn is its piece-moves (an empty one is a
 * pass, also a decision), and the person's turn is a Pass.
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
	const game = world && world.world.deployments.get().contracts.Game;
	const call = (functionName, args = []) =>
		world.context.publicClient.readContract({
			address: game.address,
			abi: game.abi,
			functionName,
			args,
		});
`;

/** Where the cycle is, from the chain. */
async function cycleOnChain(
	page: Page,
): Promise<{cycleNumber: number; commiting: boolean} | undefined> {
	return page.evaluate(`(async () => {
		${READ}
		// Before the world is up (after a reload) there is nothing to read yet.
		if (!world) return undefined;
		const cycle = await call('getCycle');
		return {cycleNumber: Number(cycle.cycleNumber), commiting: cycle.commiting};
	})()`) as Promise<{cycleNumber: number; commiting: boolean} | undefined>;
}

/**
 * The world seats' stored turns for a cycle: one record per seat, as
 * `identity:from-to,...` (nothing after the colon for a pass), sorted.
 */
async function storedTurns(page: Page, cycleNumber: number): Promise<string[]> {
	return page.evaluate(`(() => {
		const raw = localStorage.getItem('offline-world:played-turns');
		const records = raw ? JSON.parse(raw) : [];
		return records
			.filter((record) => record.cycleNumber === ${cycleNumber})
			.map((record) =>
				record.identity + ':' +
				record.actions.map((move) => move.from + '-' + move.to).join(','),
			)
			.sort();
	})()`) as Promise<string[]>;
}

/** The world seats' identities, from their stored turns. */
async function storedIdentities(page: Page): Promise<string[]> {
	return page.evaluate(`(() => {
		const raw = localStorage.getItem('offline-world:played-turns');
		const records = raw ? JSON.parse(raw) : [];
		return [...new Set(records.map((record) => record.identity))];
	})()`) as Promise<string[]>;
}

/** Each seat's commitment cycle on chain. */
async function committedIn(
	page: Page,
	identities: string[],
): Promise<number[]> {
	return page.evaluate(`(async () => {
		${READ}
		const out = [];
		for (const identity of ${JSON.stringify(identities)}) {
			const commitment = await call('getCommitment', [BigInt(identity)]);
			out.push(Number(commitment.cycleNumber));
		}
		return out;
	})()`) as Promise<number[]>;
}

/**
 * The world's first two seats' addresses: the well-known list from index 2
 * (`$lib/game/lobby/seats`), the same on every branch whatever an identity is.
 */
const WORLD_SEATS = [2, 3].map(
	(addressIndex) =>
		mnemonicToAccount(
			'test test test test test test test test test test test junk',
			{addressIndex},
		).address,
);

/**
 * TAKE THE WORLD SEATS' GAS, with the in-tab node's own cheat call: their
 * reveals then fail and are retried every pass, so the cycle stays in its
 * reveal phase. A boot gives every world seat its gas again (provisioning runs
 * on a restore too), which is what a reload does.
 */
async function drainWorldSeatsGas(page: Page): Promise<void> {
	await page.evaluate(`(async () => {
		const provider = globalThis.offlineWorld.world.provider;
		for (const address of ${JSON.stringify(WORLD_SEATS)}) {
			await provider.request({method: 'evm_setBalance', params: [address, '0x0']});
		}
	})()`);
}

/** How many have revealed this cycle. */
async function revealed(page: Page): Promise<number> {
	return page.evaluate(`(async () => {
		${READ}
		const attendance = await call('getAttendance');
		return Number(attendance.revealed);
	})()`) as Promise<number>;
}

/** The person's submission, in the world's own context. */
async function personStep(page: Page): Promise<string | undefined> {
	return page.evaluate(`(() => {
		${READ}
		if (!world) return undefined;
		return read(world.context.game.submission).step;
	})()`) as Promise<string | undefined>;
}

/**
 * Wait for this cycle's commit phase, then for both world seats to have decided
 * and stored their turns for it, still inside the commit phase.
 */
async function greedySeatsDecided(
	page: Page,
	cycleNumber: number,
): Promise<string[]> {
	await expect
		.poll(() => cycleOnChain(page), {timeout: 60_000})
		.toEqual({cycleNumber, commiting: true});
	await expect
		.poll(async () => (await storedTurns(page, cycleNumber)).length, {
			timeout: 30_000,
		})
		.toBe(2);
	expect((await cycleOnChain(page))?.commiting).toBe(true);
	return storedTurns(page, cycleNumber);
}

/** The person's turn: a Pass, committed (and revealed by the world). */
async function pass(page: Page): Promise<void> {
	await expect(page.locator('canvas')).toBeVisible({timeout: 30_000});
	await expect(page.getByTestId('pass')).toBeVisible({timeout: 60_000});
	await page.getByTestId('pass').click();
}

describe('AI seats in the offline world', () => {
	test('one person against two greedy world seats, two cycles, a reload in the reveal phase', async ({
		page,
	}) => {
		test.setTimeout(6 * 60_000);
		await page.goto('/offline/');

		await expect(page.getByText('Play offline')).toBeVisible({
			timeout: 60_000,
		});
		await chooseTheWorld(page);
		await page.getByTestId('seats-3').click();
		// A GAME WHOSE WORLD OFFERS NO LEVELS (its `$lib/offline` exports no
		// `AI_LEVELS`) shows no choice, and this file arrives in it unchanged.
		test.skip(
			(await page.getByTestId('level-0-greedy').count()) === 0,
			"this game's offline world offers no levels",
		);
		await page.getByTestId('level-0-greedy').click();
		await page.getByTestId('level-1-greedy').click();
		await expect(page.getByText('The world (Greedy)')).toHaveCount(2);
		await page.getByTestId('sit-down').click();
		await expect(page.getByText('Runs on a chain inside this tab')).toBeVisible(
			{timeout: 120_000},
		);

		// THE FIRST CYCLE SHOWN, from the chain: the boot deploys every seat
		// before the board first shows, so it is not the world's first cycle.
		await expect
			.poll(async () => (await cycleOnChain(page))?.commiting, {
				timeout: 60_000,
			})
			.toBe(true);
		const start = (await cycleOnChain(page))!.cycleNumber;

		// THE FIRST CYCLE: the seats decide and store first, then commit.
		await greedySeatsDecided(page, start);
		const seats = await storedIdentities(page);
		expect(seats).toHaveLength(2);
		await expect
			.poll(() => committedIn(page, seats), {timeout: 30_000})
			.toEqual([start, start]);
		await pass(page);
		await expect
			.poll(async () => (await cycleOnChain(page))?.cycleNumber, {
				timeout: 60_000,
			})
			.toBe(start + 1);

		// THE SECOND CYCLE, decided on the board the first one left.
		const second = await greedySeatsDecided(page, start + 1);
		await expect
			.poll(() => committedIn(page, seats), {timeout: 30_000})
			.toEqual([start + 1, start + 1]);
		// Committed and still owing: the person has not committed yet.
		expect(await revealed(page)).toBe(0);

		// THE RELOAD LANDS IN THE REVEAL PHASE, BY CONSTRUCTION. A reveal phase
		// left alone lasts less than one poll here, so the seats are left without
		// gas: the person commits and reveals, the cycle waits for the seats, and
		// the page is reloaded with their reveals owed.
		await drainWorldSeatsGas(page);
		await pass(page);
		await expect
			.poll(() => cycleOnChain(page), {timeout: 60_000})
			.toEqual({cycleNumber: start + 1, commiting: false});
		await expect
			.poll(() => personStep(page), {timeout: 60_000})
			.toBe('Revealed');
		await expect.poll(() => revealed(page), {timeout: 30_000}).toBe(1);
		expect(await cycleOnChain(page)).toEqual({
			cycleNumber: start + 1,
			commiting: false,
		});
		await expectTheReloadToResume(page);
		await page.reload();

		// The cycle closes all the same: the seats revealed what they stored.
		await expect
			.poll(async () => (await cycleOnChain(page))?.cycleNumber, {
				timeout: 90_000,
			})
			.toBe(start + 2);
		// AND THE TURNS WERE NOT DECIDED AGAIN: one stored turn per seat and
		// cycle, the very ones stored before the reload.
		expect(await storedTurns(page, start + 1)).toEqual(second);
	});
});

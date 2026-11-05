import type {Page} from '@playwright/test';
import {mnemonicToAccount} from 'viem/accounts';
import {test, expect, describe} from '../fixtures/test';

/**
 * HOTSEAT IN THE OFFLINE WORLD: two people at one device and one world seat,
 * two cycles, the device passed between them (stratagems' port plan, step H1).
 *
 * What it holds: the handover screen REPLACES the game between turns (no canvas
 * is mounted while the device changes hands); the second person is shown
 * nothing of the first person's plan (an empty submission, no planned spawn
 * point, no ghost of the first person's army); both deployments land on the
 * board when the cycle closes, the world waiting for every seat to deploy
 * before it turns over, revealed by the world's own revealer key
 * rather than by either person's; and a reload in the middle of a commit phase
 * lands on the handover for the right person, never on a plan, and the turn
 * committed before it is still revealed (the revealer forgot it; the handover
 * reveals it as that person, behind its screen).
 *
 * Written against the byte-identical route and world only, and the reference
 * game's board through `globalThis.offlineWorld`, so a game that plays hotseat
 * adapts the board reads and nothing else.
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
`;

/** The revealer's well-known key (`localRevealerKey`, index 2 + MOST_SEATS). */
const REVEALER = mnemonicToAccount(
	'test test test test test test test test test test test junk',
	{addressIndex: 12},
).address;

async function whoPlays(page: Page): Promise<string | undefined> {
	return page.evaluate(`(() => {
		${READ}
		if (!world) return undefined;
		const account = read(world.context.account);
		return account ? account.toLowerCase() : undefined;
	})()`) as Promise<string | undefined>;
}

/** What the person at the device has planned: a spawn point, or nothing. */
async function planned(page: Page): Promise<{
	submission: string;
	spawnPoint: string | undefined;
	ghost: number;
}> {
	return page.evaluate(`(() => {
		${READ}
		const submission = read(world.context.game.submission);
		const view = read(world.context.viewState);
		const spawnPoint = 'actions' in submission && submission.actions.length === 1
			? submission.actions[0].to.toString()
			: undefined;
		const ghost = view.step === 'Loaded' ? view.ghost.length : 0;
		return {submission: submission.step, spawnPoint, ghost};
	})()`) as Promise<{
		submission: string;
		spawnPoint: string | undefined;
		ghost: number;
	}>;
}

/** The registry's status of every army, by owner. */
async function armies(page: Page): Promise<Record<string, number>> {
	return page.evaluate(`(async () => {
		${READ}
		const records = world.world.deployments.get();
		const [list] = await world.context.publicClient.readContract({
			address: records.contracts.Game.address,
			abi: records.contracts.Game.abi,
			functionName: 'getArmies',
			args: [0n, 100n],
		});
		const out = {};
		for (const army of list) out[army.owner.toLowerCase()] = Number(army.status);
		return out;
	})()`) as Promise<Record<string, number>>;
}

async function revealerSends(page: Page): Promise<number> {
	return page.evaluate(`(async () => {
		${READ}
		const nonce = await world.world.provider.request({
			method: 'eth_getTransactionCount',
			params: ['${REVEALER}', 'latest'],
		});
		return Number(BigInt(nonce));
	})()`) as Promise<number>;
}

/** Take the device as `label`, and wait for the game to be shown. */
async function begin(page: Page, label: string): Promise<void> {
	await expect(page.getByTestId('handover-to')).toHaveText(
		`Pass the device to ${label}`,
		{timeout: 120_000},
	);
	await expect(page.locator('canvas')).toHaveCount(0);
	await page.getByTestId('handover-begin').click();
	await expect(page.getByTestId('handover')).toHaveCount(0, {timeout: 60_000});
	await expect(page.locator('canvas')).toBeVisible({timeout: 30_000});
	expect(await dataLoadedForWhoPlays(page)).toBe(true);
}

/** Whether the account data loaded is the signed-in person's own. */
async function dataLoadedForWhoPlays(page: Page): Promise<boolean> {
	return page.evaluate(`(() => {
		${READ}
		const lifecycle = read(world.context.accountData.lifecycle$);
		const account = read(world.context.account);
		return (
			lifecycle.status === 'ready' &&
			!!account &&
			lifecycle.account.toLowerCase() === account.toLowerCase()
		);
	})()`) as Promise<boolean>;
}

/** Pick the `index`th open spawn point and deploy there; the spawn point. */
async function deploy(page: Page, index: number): Promise<string> {
	await expect
		.poll(async () => (await planned(page)).submission, {timeout: 60_000})
		.toMatch(/Idle|Planning|Revealed/);
	await page.getByTestId('spawn-point').nth(index).click();
	await expect
		.poll(async () => (await planned(page)).spawnPoint, {timeout: 15_000})
		.toBeDefined();
	const {spawnPoint} = await planned(page);
	await page.getByTestId('commit-deployment').click();
	return spawnPoint!;
}

/** Commit a pass: the army is deployed and the cycle waits for everyone. */
async function pass(page: Page): Promise<void> {
	await expect(page.getByTestId('pass')).toBeVisible({timeout: 60_000});
	await page.getByTestId('pass').click();
}

const DEPLOYED = 2;

describe('Hotseat in the offline world', () => {
	test('two people at one device and one world seat play two cycles, passing the device', async ({
		page,
	}) => {
		test.setTimeout(8 * 60_000);
		await page.goto('/offline/');

		await expect(page.getByText('How many at the table?')).toBeVisible({
			timeout: 60_000,
		});
		await page.getByTestId('seats-3').click();
		// A GAME WHOSE WORLD HAS NO HOTSEAT offers no choice of people (its
		// `$lib/offline` exports no `LOCAL_HUMANS_AT_MOST`), and this file arrives
		// in it unchanged: it says so rather than failing.
		test.skip(
			(await page.getByTestId('humans-2').count()) === 0,
			"this game's offline world offers no hotseat",
		);
		await page.getByTestId('humans-2').click();
		await expect(page.getByText('Player 2', {exact: true})).toBeVisible();
		await page.getByTestId('sit-down').click();

		// CYCLE ONE. Player 1 takes the device and deploys.
		await begin(page, 'Player 1');
		const first = await whoPlays(page);
		expect(first).toBeTruthy();
		const firstSpawn = await deploy(page, 0);

		// Player 2's turn although Player 1 is the only MEMBER so far: the world
		// waits for every seat to deploy before the cycle turns over.
		await begin(page, 'Player 2');
		await expect.poll(() => whoPlays(page), {timeout: 30_000}).not.toBe(first);
		const second = await whoPlays(page);
		// Nothing of Player 1's deployment is shown: the spawn point is hidden.
		const shown = await planned(page);
		expect(shown.spawnPoint).toBeUndefined();
		expect(shown.ghost).toBe(0);
		const secondSpawn = await deploy(page, 1);
		expect(secondSpawn).not.toBe(firstSpawn);

		// Both reveals sent by the world's revealer, and the armies stand.
		await begin(page, 'Player 1');
		await expect.poll(() => whoPlays(page), {timeout: 30_000}).toBe(first);
		await expect
			.poll(async () => (await armies(page))[first!], {timeout: 60_000})
			.toBe(DEPLOYED);
		await expect
			.poll(async () => (await armies(page))[second!], {timeout: 60_000})
			.toBe(DEPLOYED);
		// And the seat the world plays deployed beside them.
		await expect
			.poll(
				async () =>
					Object.values(await armies(page)).filter((s) => s === DEPLOYED)
						.length,
				{timeout: 60_000},
			)
			.toBe(3);
		expect(await revealerSends(page)).toBeGreaterThanOrEqual(2);
		const sentInCycleOne = await revealerSends(page);

		// A cycle of passes, with a reload between the two people.
		await pass(page);
		await expect(page.getByTestId('handover-to')).toHaveText(
			'Pass the device to Player 2',
			{timeout: 60_000},
		);
		await page.reload();
		await begin(page, 'Player 2');
		await expect.poll(() => whoPlays(page), {timeout: 30_000}).toBe(second);
		await pass(page);

		await begin(page, 'Player 1');
		await expect
			.poll(() => revealerSends(page), {timeout: 60_000})
			.toBeGreaterThan(sentInCycleOne);
	});
});

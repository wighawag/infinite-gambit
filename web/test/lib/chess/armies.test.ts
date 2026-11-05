import {describe, it, expect} from 'vitest';
import {get, writable} from 'svelte/store';
import {
	ARMY_STATUS,
	chooseArmy,
	createArmies,
	isLive,
	type ArmyStatus,
} from '$lib/chess/armies';

/**
 * WHICH ARMY THIS CLIENT PLAYS. The identity is a SELECTION over what the
 * registry says the account owns, and before the account's first deployment it
 * is the army that deployment will create, so one identity carries the
 * submission across the army's own creation.
 */

const OWNER = '0x1111111111111111111111111111111111111111' as const;
const army = (nonce: number) => (BigInt(nonce) << 160n) | BigInt(OWNER);
const entry = (nonce: number, status: ArmyStatus) => ({
	id: army(nonce),
	status,
});

describe('choosing the army to play', () => {
	it('plays the next army when the account has none', () => {
		expect(chooseArmy([], army(1))).toBe(army(1));
	});

	it('plays the most recent army that is deploying or on the board', () => {
		expect(
			chooseArmy(
				[entry(1, ARMY_STATUS.Deployed), entry(2, ARMY_STATUS.Deploying)],
				army(3),
			),
		).toBe(army(2));
		expect(
			chooseArmy(
				[entry(1, ARMY_STATUS.Deployed), entry(2, ARMY_STATUS.Failed)],
				army(3),
			),
		).toBe(army(1));
	});

	it('deploys again once every army failed or was never revealed', () => {
		expect(
			chooseArmy(
				[entry(1, ARMY_STATUS.Failed), entry(2, ARMY_STATUS.Unrevealed)],
				army(3),
			),
		).toBe(army(3));
		expect(isLive({status: ARMY_STATUS.Failed})).toBe(false);
		expect(isLive({status: ARMY_STATUS.Deployed})).toBe(true);
	});
});

describe('the armies store', () => {
	function raw(nonce: number, status: number) {
		return {
			id: army(nonce),
			owner: OWNER,
			status,
			deployedIn: 3n,
			spawnPoint: 0n,
			king: 0n,
			stake: 10n,
		};
	}

	it('reads the account’s armies and selects one', async () => {
		const account = writable<`0x${string}` | undefined>(OWNER);
		const calls: string[] = [];
		const armies = createArmies({
			account,
			contract: {
				address: '0x2222222222222222222222222222222222222222',
				abi: [],
			},
			publicClient: {
				readContract: (async ({functionName}: {functionName: string}) => {
					calls.push(functionName);
					if (functionName === 'getArmiesOf') {
						return [raw(1, ARMY_STATUS.Failed), raw(2, ARMY_STATUS.Deploying)];
					}
					return army(3);
				}) as never,
			},
		});
		expect(get(armies.active)).toBeUndefined();
		await armies.update();
		expect(calls.sort()).toEqual(['getArmiesOf', 'getNextArmy']);
		expect(get(armies.active)).toBe(army(2));
		expect(get(armies.activeArmy)?.status).toBe(ARMY_STATUS.Deploying);

		// Signed out: nobody is played.
		account.set(undefined);
		await armies.update();
		expect(get(armies.active)).toBeUndefined();
	});
});

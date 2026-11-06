import {describe, it, expect} from 'vitest';
import {ARMY_STATUS, chooseArmy, type ArmyStatus} from '$lib/chess/armies';
import {stakeNeeded} from '$lib/chess/context';
import {tableClaimOf, type TableOutcome} from '$lib/chess/table-payout';

/**
 * AT A TABLE THE SEAT IS THE ARMY (`chess-tables`): bought in, never deployed.
 * So the client plays the account's seat whatever became of it, never asks for
 * a deployment, asks for a stake only to buy a seat, and offers the table's
 * claim once it is over.
 */

const OWNER = '0x1111111111111111111111111111111111111111' as const;
const army = (nonce: number) => (BigInt(nonce) << 160n) | BigInt(OWNER);
const entry = (nonce: number, status: ArmyStatus) => ({
	id: army(nonce),
	status,
});
const LOADED = {step: 'Loaded', amount: 0n};
const STAKE = 10n;

describe('the seat a table client plays', () => {
	it('plays the seat once captured or frozen, where the world would deploy again', () => {
		for (const status of [ARMY_STATUS.Captured, ARMY_STATUS.Frozen]) {
			expect(chooseArmy([entry(1, status)], army(2), true)).toBe(army(1));
			expect(chooseArmy([entry(1, status)], army(2))).toBe(army(2));
		}
	});

	it('plays the next army after leaving the table, which a purchase creates', () => {
		expect(chooseArmy([entry(1, ARMY_STATUS.Cancelled)], army(2), true)).toBe(
			army(2),
		);
		expect(chooseArmy([], army(1), true)).toBe(army(1));
	});

	it('asks for a stake only to buy a seat, never from the account reserve', () => {
		const need = (army: {status: ArmyStatus} | undefined) =>
			stakeNeeded({
				reserve: {...LOADED, amount: 2n * STAKE},
				army,
				armiesLoaded: true,
				stake: STAKE,
				atTable: true,
			});
		expect(need(undefined)).toEqual({step: 'stake'});
		expect(need({status: ARMY_STATUS.Cancelled})).toEqual({step: 'stake'});
		for (const status of [
			ARMY_STATUS.Deploying,
			ARMY_STATUS.Deployed,
			ARMY_STATUS.Captured,
			ARMY_STATUS.Frozen,
		]) {
			expect(need({status})).toEqual(undefined);
		}
	});
});

describe("a table's claim", () => {
	const outcome = (o: Partial<TableOutcome>): TableOutcome => ({
		over: true,
		settled: false,
		tallied: false,
		winner: 0n,
		pot: 0n,
		totalMaterial: 0n,
		...o,
	});
	const deployed = entry(1, ARMY_STATUS.Deployed);

	it('offers nothing before the table is over, or once paid', () => {
		expect(
			tableClaimOf({
				army: deployed,
				outcome: outcome({over: false}),
				share: 0n,
				paid: false,
			}),
		).toEqual(undefined);
		expect(
			tableClaimOf({
				army: deployed,
				outcome: outcome({settled: true, winner: army(1)}),
				share: 20n,
				paid: true,
			}),
		).toEqual(undefined);
	});

	it('offers every stake to the last king standing, and nothing to the others', () => {
		const won = outcome({winner: army(1)});
		expect(
			tableClaimOf({army: deployed, outcome: won, share: 0n, paid: false}),
		).toEqual({army: army(1), winner: true, share: undefined});
		expect(
			tableClaimOf({
				army: entry(1, ARMY_STATUS.Captured),
				outcome: outcome({winner: army(2)}),
				share: 0n,
				paid: false,
			}),
		).toEqual(undefined);
	});

	it('offers a share at the cap to a standing army, and the settled share once written', () => {
		expect(
			tableClaimOf({
				army: entry(1, ARMY_STATUS.Frozen),
				outcome: outcome({}),
				share: 0n,
				paid: false,
			}),
		).toEqual({army: army(1), winner: false, share: undefined});
		expect(
			tableClaimOf({
				army: entry(1, ARMY_STATUS.Captured),
				outcome: outcome({}),
				share: 0n,
				paid: false,
			}),
		).toEqual(undefined);
		expect(
			tableClaimOf({
				army: deployed,
				outcome: outcome({settled: true}),
				share: 7n,
				paid: false,
			}),
		).toEqual({army: army(1), winner: false, share: 7n});
	});
});

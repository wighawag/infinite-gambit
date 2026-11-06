import {describe, expect, it} from 'vitest';
import {exitsIn, isExitSquare} from '$lib/chess/exits';
import {ARMY_STATUS, unpaidExit} from '$lib/chess/armies';
import {describeExitPayout} from '$lib/chess/ui/hud';

describe('exit squares', () => {
	it('sit at the centre of every spawn-grid cell, negative coordinates too', () => {
		expect(isExitSquare(3, 3, 6)).toBe(true);
		expect(isExitSquare(-3, 9, 6)).toBe(true);
		expect(isExitSquare(0, 0, 6)).toBe(false);
		expect(isExitSquare(8, 8, 16)).toBe(true);
		expect(isExitSquare(-8, 24, 16)).toBe(true);
		expect(isExitSquare(8, 0, 16)).toBe(false);
	});

	it('are listed in a viewport, inclusive on every side', () => {
		expect(exitsIn({minX: -3, minY: -3, maxX: 3, maxY: 3}, 6)).toEqual([
			{x: -3, y: -3},
			{x: 3, y: -3},
			{x: -3, y: 3},
			{x: 3, y: 3},
		]);
		expect(exitsIn({minX: -2, minY: -2, maxX: 2, maxY: 2}, 6)).toEqual([]);
		for (const exit of exitsIn({minX: -40, minY: -7, maxX: 33, maxY: 50}, 16)) {
			expect(isExitSquare(exit.x, exit.y, 16)).toBe(true);
		}
	});
});

describe('the exit payout', () => {
	const army = (id: number, status: number, stake: bigint) => ({
		id: BigInt(id),
		status: status as (typeof ARMY_STATUS)[keyof typeof ARMY_STATUS],
		stake,
	});

	it('is owed to the most recent exited army that has not been paid', () => {
		expect(unpaidExit([army(1, ARMY_STATUS.Deployed, 10n)])).toBeUndefined();
		expect(unpaidExit([army(1, ARMY_STATUS.Exited, 0n)])).toBeUndefined();
		expect(
			unpaidExit([
				army(1, ARMY_STATUS.Exited, 10n),
				army(2, ARMY_STATUS.Deployed, 10n),
			])?.id,
		).toBe(1n);
	});

	it('is offered as the stake redeemed at the sale price, and says when it is in flight', () => {
		const owed = describeExitPayout({
			army: {id: 7n, stake: 20n},
			payout: {busy: false},
			sale: {price: 3n, amount: 10n},
			symbol: 'ETH',
		});
		expect(owed?.army).toBe(7n);
		expect(owed?.busy).toBe(false);
		const busy = describeExitPayout({
			army: {id: 7n, stake: 20n},
			payout: {busy: true},
			sale: {price: 3n, amount: 10n},
			symbol: 'ETH',
		});
		expect(busy?.actionLabel).toBe('Paying out...');
		expect(
			describeExitPayout({
				army: undefined,
				payout: {busy: false},
				sale: {price: 3n, amount: 10n},
				symbol: 'ETH',
			}),
		).toBeUndefined();
	});
});

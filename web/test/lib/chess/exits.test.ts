import {describe, expect, it} from 'vitest';
import {exitsIn, isExitSquare} from '$lib/chess/exits';
import {ARMY_STATUS, unpaidExit} from '$lib/chess/armies';
import {describeExitPayout} from '$lib/chess/ui/hud';

describe('exit squares', () => {
	it('are the 2 by 2 block at the centre of every spawn-grid cell, negative coordinates too', () => {
		// At spacing 9, offsets 4 and 5 off a spawn point on both axes.
		for (const [x, y] of [
			[4, 4],
			[5, 4],
			[4, 5],
			[5, 5],
			[-4, -4],
			[-5, -5],
			[-4, 13],
			[14, -5],
		]) {
			expect(isExitSquare(x, y, 9)).toBe(true);
		}
		for (const [x, y] of [
			[0, 0],
			[3, 4],
			[6, 5],
			[4, 0],
			[2, 2],
			[-3, -4],
		]) {
			expect(isExitSquare(x, y, 9)).toBe(false);
		}
		// The general rule, as the contract's test worlds use it: offsets
		// floor(S/2) and floor(S/2) + 1.
		expect(isExitSquare(3, 4, 6)).toBe(true);
		expect(isExitSquare(-2, -3, 6)).toBe(true);
		expect(isExitSquare(5, 3, 6)).toBe(false);
	});

	it('are listed in a viewport, inclusive on every side', () => {
		expect(exitsIn({minX: -5, minY: -5, maxX: 5, maxY: 5}, 9)).toEqual([
			{x: -5, y: -5},
			{x: -4, y: -5},
			{x: 4, y: -5},
			{x: 5, y: -5},
			{x: -5, y: -4},
			{x: -4, y: -4},
			{x: 4, y: -4},
			{x: 5, y: -4},
			{x: -5, y: 4},
			{x: -4, y: 4},
			{x: 4, y: 4},
			{x: 5, y: 4},
			{x: -5, y: 5},
			{x: -4, y: 5},
			{x: 4, y: 5},
			{x: 5, y: 5},
		]);
		// Half a block: the viewport's edge cuts it.
		expect(exitsIn({minX: 5, minY: 0, maxX: 8, maxY: 4}, 9)).toEqual([
			{x: 5, y: 4},
		]);
		expect(exitsIn({minX: -3, minY: -3, maxX: 3, maxY: 3}, 9)).toEqual([]);
		const listed = exitsIn({minX: -40, minY: -7, maxX: 33, maxY: 50}, 9);
		for (const exit of listed) {
			expect(isExitSquare(exit.x, exit.y, 9)).toBe(true);
		}
		let every = 0;
		for (let y = -7; y <= 50; y++)
			for (let x = -40; x <= 33; x++) if (isExitSquare(x, y, 9)) every++;
		expect(listed.length).toBe(every);
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

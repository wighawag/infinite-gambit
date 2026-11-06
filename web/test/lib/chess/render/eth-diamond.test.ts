import {describe, it, expect} from 'vitest';
import {
	ethDiamond,
	exitDiamonds,
	kingBadge,
} from '$lib/chess/render/eth-diamond';
import {INLAY} from '$lib/chess/render/pixi/piece-art';
import {exitsIn, isExitSquare} from '$lib/chess/exits';

const bounds = {minX: -20, maxX: 20, minY: -20, maxY: 20};

describe('the ETH diamond', () => {
	it('is the pixi inlay: four facets, the left ones light', () => {
		const facets = ethDiamond({x: 0, y: 0}, 1);
		expect(facets.map((f) => f.tone)).toEqual([
			'light',
			'dark',
			'light',
			'dark',
		]);
		expect(facets[0].points).toEqual(INLAY.tl);
		expect(facets[3].points).toEqual(INLAY.br);
	});

	it('is centred and scaled', () => {
		const [top] = ethDiamond({x: 10, y: -3}, 2);
		// INLAY.tl starts at the logo's top point, (0, -0.98).
		expect(top.points[0]).toEqual([10, -3 - 1.96]);
	});
});

describe('exit diamonds', () => {
	it('draws one diamond per 2 x 2 block, at its centre, a square per unit', () => {
		for (const spacing of [6, 9, 16]) {
			const diamonds = exitDiamonds(bounds, spacing);
			const covered = new Set<string>();
			for (const d of diamonds) {
				expect(d.unit).toBe(1);
				// the centre is the shared corner of the block's four squares
				for (const [x, y] of [
					[d.centre.x - 0.5, d.centre.y - 0.5],
					[d.centre.x + 0.5, d.centre.y - 0.5],
					[d.centre.x - 0.5, d.centre.y + 0.5],
					[d.centre.x + 0.5, d.centre.y + 0.5],
				]) {
					expect(isExitSquare(x, y, spacing)).toBe(true);
					covered.add(`${x},${y}`);
				}
			}
			// every exit square in view is in exactly one drawn block
			for (const {x, y} of exitsIn(bounds, spacing)) {
				expect(covered.has(`${x},${y}`)).toBe(true);
			}
			expect(covered.size).toBe(diamonds.length * 4);
		}
	});

	it('keeps a block whole when only part of it is in view', () => {
		// At spacing 9 the blocks sit on 4 and 5: a view that starts at 5 cuts
		// every block in half.
		const cut = {minX: 5, maxX: 20, minY: 5, maxY: 20};
		const diamonds = exitDiamonds(cut, 9);
		expect(diamonds).toContainEqual({centre: {x: 4.5, y: 4.5}, unit: 1});
		expect(diamonds.every((d) => d.unit === 1)).toBe(true);
	});

	it('draws none without a spawn grid (a table)', () => {
		expect(exitDiamonds(bounds, undefined)).toEqual([]);
	});
});

describe('the king badge', () => {
	it('sits on the lower right of the king, inside its square', () => {
		const {centre, unit} = kingBadge({x: 3, y: 7});
		expect(centre.x).toBeGreaterThan(3);
		expect(centre.y).toBeGreaterThan(7);
		for (const facet of ethDiamond(centre, unit)) {
			for (const [x, y] of facet.points) {
				expect(Math.abs(x - 3)).toBeLessThanOrEqual(0.5);
				expect(Math.abs(y - 7)).toBeLessThanOrEqual(0.5);
			}
		}
	});
});

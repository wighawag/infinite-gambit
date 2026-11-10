import {describe, expect, it} from 'vitest';
import {ARMY_STATUS} from '$lib/chess/armies';
import {squareAt} from '$lib/chess/squares';
import {
	ARMY_PALETTE,
	NEAR_SPAWN,
	YOUR_COLOUR,
	armyColour,
	armyColoursOf,
} from '$lib/chess/render/style';

const army = (id: bigint, x: number, y: number) => ({
	id,
	spawnPoint: squareAt(x, y),
	status: ARMY_STATUS.Deployed,
});

describe('army colours', () => {
	it('come from a palette of distinct colours, none the player gold', () => {
		expect(new Set(ARMY_PALETTE).size).toBe(ARMY_PALETTE.length);
		expect(ARMY_PALETTE).not.toContain(YOUR_COLOUR);
		for (let id = 1n; id < 50n; id++) {
			expect(ARMY_PALETTE).toContain(armyColour(id));
		}
	});

	it('give nearby armies different colours, even when their ids share a slot', () => {
		const n = BigInt(ARMY_PALETTE.length);
		// same slot by id: both 3 mod the palette size
		const armies = [army(3n, 0, 0), army(3n + n, 10, 0)];
		expect(armyColour(3n)).toBe(armyColour(3n + n));
		const colours = armyColoursOf(armies);
		expect(colours.get(3n)).toBeDefined();
		expect(colours.get(3n + n)).toBeDefined();
		expect(colours.get(3n)).not.toBe(colours.get(3n + n));
	});

	it('use every colour before repeating one among nearby armies', () => {
		const armies = ARMY_PALETTE.map((_, i) => army(BigInt(i * 7 + 1), i, i));
		const colours = armyColoursOf(armies);
		expect(new Set(colours.values()).size).toBe(ARMY_PALETTE.length);
	});

	it('let far-apart armies keep their own colour', () => {
		const n = BigInt(ARMY_PALETTE.length);
		const colours = armyColoursOf([
			army(3n, 0, 0),
			army(3n + n, NEAR_SPAWN * 4, 0),
		]);
		expect(colours.get(3n + n)).toBe(armyColour(3n + n));
	});

	it("never change an army's colour when later armies arrive", () => {
		const first = [army(5n, 0, 0), army(14n, 4, 4), army(23n, 8, 8)];
		const before = armyColoursOf(first);
		const after = armyColoursOf([...first, army(32n, 2, 2), army(41n, 6, 6)]);
		for (const {id} of first) expect(after.get(id)).toBe(before.get(id));
	});

	it('skip armies not revealed yet, but not one at the origin', () => {
		const colours = armyColoursOf([
			{id: 9n, spawnPoint: 0n, status: ARMY_STATUS.Deploying},
			army(10n, 0, 0),
		]);
		expect(colours.has(9n)).toBe(false);
		expect(colours.has(10n)).toBe(true);
	});
});

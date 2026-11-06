import {describe, expect, it} from 'vitest';
import {readFileSync} from 'node:fs';
import {MAPLE, ROSEWOOD, woodPixels} from '$lib/chess/render/pixi/wood';
import {
	EXIT_QUIET_BELOW,
	GLYPHS_BELOW,
	TURNED_BELOW,
	cellHash,
	exitInlay,
	exitLook,
	pieceMode,
	isLight,
} from '$lib/chess/render/pixi/squares';
import {
	FINISHES,
	KINDS,
	partRoles,
	pieceKey,
	svgFor,
} from '$lib/chess/render/pixi/piece-art';
import pieces from '$lib/chess/render/pixi/pieces.json';

// The wooden board's pure half (`$lib/chess/render/pixi/`), ported from
// `spikes/pixi-wood-board/`. The pixi half needs a GPU and is not tested here.

describe('the squares', () => {
	it('are light where x + y is even, negative coordinates too', () => {
		expect(isLight(0, 0)).toBe(true);
		expect(isLight(1, 0)).toBe(false);
		expect(isLight(-1, 0)).toBe(false);
		expect(isLight(-1, -1)).toBe(true);
		expect(isLight(-3, 8)).toBe(false);
	});

	it('hash deterministically, so a square keeps its cut of veneer', () => {
		expect(cellHash(5, -7, 3)).toBe(cellHash(5, -7, 3));
		expect(cellHash(5, -7, 3)).not.toBe(cellHash(-7, 5, 3));
		expect(cellHash(5, -7, 3)).toBeGreaterThanOrEqual(0);
	});
});

describe('low zoom', () => {
	it('draws pieces turned, then as glyphs on discs, then as dots', () => {
		expect(pieceMode(TURNED_BELOW)).toBe('pieces');
		expect(pieceMode(TURNED_BELOW - 0.1)).toBe('glyphs');
		expect(pieceMode(GLYPHS_BELOW)).toBe('glyphs');
		expect(pieceMode(GLYPHS_BELOW - 0.1)).toBe('dots');
		// The glyphs reach as far down as the canvas board draws them.
		expect(GLYPHS_BELOW).toBe(6);
	});

	it('quiets the exits when zoomed far out', () => {
		// Normally the inlay glows and breathes, at full colour.
		expect(exitLook(EXIT_QUIET_BELOW)).toEqual({glow: true, dimmed: false});
		// Further out a glowing inlay took the board's focus: no glow, no
		// breath, tinted like the board.
		expect(exitLook(EXIT_QUIET_BELOW - 0.1)).toEqual({
			glow: false,
			dimmed: true,
		});
	});
});

describe('the exit inlay', () => {
	it('centres on its square for a 1-square exit', () => {
		expect(exitInlay({x: 8, y: 8}, 1)).toEqual({
			cx: 8,
			cy: 8,
			topLeftLight: true,
		});
	});

	it('centres on the shared corner of a 2 x 2 block', () => {
		expect(exitInlay({x: 4, y: 4}, 2)).toMatchObject({cx: 4.5, cy: 4.5});
		expect(exitInlay({x: -5, y: 4}, 2)).toMatchObject({cx: -4.5, cy: 4.5});
	});

	it('knows the top-left colour, which alternates on an odd spacing', () => {
		// spacing 9, blocks at offsets 4 and 5 (ADR 0015)
		expect(exitInlay({x: 4, y: 4}, 2).topLeftLight).toBe(true);
		expect(exitInlay({x: 13, y: 4}, 2).topLeftLight).toBe(false);
		expect(exitInlay({x: 13, y: 13}, 2).topLeftLight).toBe(true);
	});
});

describe('the wood', () => {
	it('is deterministic for a seed and opaque', () => {
		const a = woodPixels(MAPLE, 32, 7);
		expect(a.length).toBe(32 * 32 * 4);
		expect(a).toEqual(woodPixels(MAPLE, 32, 7));
		expect(a).not.toEqual(woodPixels(MAPLE, 32, 8));
		for (let i = 3; i < a.length; i += 4) expect(a[i]).toBe(255);
	});

	it('makes maple lighter than rosewood', () => {
		const mean = (p: Uint8ClampedArray) => {
			let sum = 0;
			for (let i = 0; i < p.length; i += 4) sum += p[i] + p[i + 1] + p[i + 2];
			return sum / (p.length / 4);
		};
		expect(mean(woodPixels(MAPLE, 32, 1))).toBeGreaterThan(
			mean(woodPixels(ROSEWOOD, 32, 1)),
		);
	});
});

describe('the piece art', () => {
	it('is a faithful copy of the brand data that pieces.py writes', () => {
		const brand = JSON.parse(
			readFileSync(
				new URL(
					'../../../../../../assets/brand/game/pieces.json',
					import.meta.url,
				),
				'utf8',
			),
		);
		expect(pieces).toEqual(brand);
	});

	it('has every chess kind, each with wood and band parts, and a prism only on the king', () => {
		expect([...KINDS].sort()).toEqual(
			['bishop', 'king', 'knight', 'pawn', 'queen', 'rook'].sort(),
		);
		for (const kind of KINDS) {
			const roles = partRoles(kind);
			expect(roles).toContain('wood');
			expect(roles).toContain('band');
			expect(roles.includes('prism')).toBe(kind === 'king');
			for (const role of roles)
				expect(['wood', 'band', 'prism']).toContain(role);
		}
	});

	it('paints the band parts in the army colour, or in the finish without one', () => {
		const bands = partRoles('rook').filter((r) => r === 'band').length;
		const coloured = svgFor('rook', 'sheesham', 'hsl(210, 70%, 50%)');
		expect(coloured.split('fill="hsl(210, 70%, 50%)"').length - 1).toBe(bands);
		const plain = svgFor('rook', 'stone');
		expect(plain).not.toContain('hsl(');
		expect(plain).toContain(FINISHES.stone.light);
	});

	it('caches one texture per kind, finish and band', () => {
		expect(pieceKey('pawn', 'boxwood', '#fff')).not.toBe(
			pieceKey('pawn', 'sheesham', '#fff'),
		);
		expect(pieceKey('pawn', 'stone')).not.toBe(
			pieceKey('pawn', 'stone', '#fff'),
		);
	});
});

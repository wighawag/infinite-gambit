import {describe, expect, it} from 'vitest';
import {PIECE_KIND, type PieceKind} from '$lib/chess/board';
import {exitsIn} from '$lib/chess/exits';
import {squareAt} from '$lib/chess/squares';
import type {BoardView, PieceView} from '$lib/chess/view';
import {armyColour, YOUR_COLOUR} from '$lib/chess/render/style';
import {
	attackedThatMatter,
	cssColourToHex,
	exitBlocks,
	labelsOf,
	lookOf,
	looksDiffer,
	overlayModel,
	pieceLooks,
	silhouetteOf,
} from '$lib/chess/render/pixi/view-model';

/**
 * THE WOODEN BOARD'S MAPPING FROM THE VIEW STATE TO THE SCREEN, which is all
 * of it that can be tested without a GPU. It decides nothing (ADR 0007): these
 * tests pin how each fact the view state carries is drawn.
 */

const ME = 11n;
const THEM = 22n;

// Built by cast, with only the fields the renderer reads, so a field the board
// task removes (a facing) does not break these tests.
const piece = (x: number, y: number, army: bigint, kind: PieceKind) =>
	({
		position: squareAt(x, y),
		army,
		kind,
		position2d: {x, y},
	}) as PieceView;

function viewOf(over: Partial<BoardView> = {}): BoardView {
	return {
		pieces: new Map(),
		spawnPoints: [],
		ghost: [],
		outcomes: [],
		outcomesCycle: 0,
		you: ME,
		...over,
	} as BoardView;
}

describe('colours as tints', () => {
	it('converts hex and hsl, as style.ts writes them', () => {
		expect(cssColourToHex('#ffd166')).toBe(0xffd166);
		expect(cssColourToHex('#fff')).toBe(0xffffff);
		expect(cssColourToHex('hsl(0, 100%, 50%)')).toBe(0xff0000);
		expect(cssColourToHex('hsl(120, 100%, 50%)')).toBe(0x00ff00);
		expect(cssColourToHex('hsl(240, 100%, 25%)')).toBe(0x000080);
		expect(cssColourToHex('hsl(0, 0%, 100%)')).toBe(0xffffff);
		expect(() => cssColourToHex(armyColour(123456789n))).not.toThrow();
	});
});

describe('pieces', () => {
	it('draw every kind as a turned piece, a stone as a king', () => {
		expect(silhouetteOf(PIECE_KIND.Pawn)).toBe('pawn');
		expect(silhouetteOf(PIECE_KIND.Knight)).toBe('knight');
		expect(silhouetteOf(PIECE_KIND.Queen)).toBe('queen');
		expect(silhouetteOf(PIECE_KIND.King)).toBe('king');
		expect(silhouetteOf(PIECE_KIND.Stone)).toBe('king');
		expect(silhouetteOf(PIECE_KIND.None)).toBeUndefined();
	});

	it("draw the player's army in boxwood, every other in sheesham, with its colour on the band", () => {
		const view = viewOf();
		expect(lookOf(piece(0, 0, ME, PIECE_KIND.Rook), view)).toMatchObject({
			finish: 'boxwood',
			band: YOUR_COLOUR,
			glow: 1,
			alpha: 1,
		});
		expect(lookOf(piece(0, 0, THEM, PIECE_KIND.Rook), view)).toMatchObject({
			finish: 'sheesham',
			band: armyColour(THEM),
		});
	});

	it('draw a stone in stone, keeping the band of the army it was, without a glow', () => {
		const look = lookOf(piece(3, 4, THEM, PIECE_KIND.Stone), viewOf());
		expect(look).toMatchObject({
			kind: 'king',
			finish: 'stone',
			band: armyColour(THEM),
			glow: 0,
			stone: true,
		});
	});

	it('draw a frozen army in ice, apart from stones and live armies', () => {
		const view = viewOf({frozen: new Set([THEM])});
		const frozen = lookOf(piece(0, 0, THEM, PIECE_KIND.Pawn), view)!;
		const stone = lookOf(piece(0, 0, THEM, PIECE_KIND.Stone), view)!;
		expect(frozen.finish).toBe('ice');
		expect(stone.finish).toBe('stone');
		expect(frozen.tone).not.toBe(armyColour(THEM));
	});

	it('draw the planned army as a translucent ghost, under keys of its own', () => {
		const view = viewOf({
			pieces: new Map([[squareAt(1, 1), piece(1, 1, THEM, PIECE_KIND.Pawn)]]),
			ghost: [piece(1, 1, 0n, PIECE_KIND.King)],
		});
		const looks = pieceLooks(view);
		expect(looks.size).toBe(2);
		const ghost = looks.get(`g:${squareAt(1, 1)}`)!;
		expect(ghost.alpha).toBeLessThan(1);
		expect(ghost.finish).toBe('boxwood');
		expect(looks.get(`p:${squareAt(1, 1)}`)!.finish).toBe('sheesham');
	});

	it('are redrawn exactly when their look changes', () => {
		const view = viewOf();
		const a = lookOf(piece(0, 0, THEM, PIECE_KIND.Pawn), view)!;
		const same = lookOf(piece(0, 0, THEM, PIECE_KIND.Pawn), view)!;
		expect(looksDiffer(a, same)).toBe(false);
		const frozen = lookOf(
			piece(0, 0, THEM, PIECE_KIND.Pawn),
			viewOf({frozen: new Set([THEM])}),
		)!;
		expect(looksDiffer(a, frozen)).toBe(true);
		expect(looksDiffer(a, {...a, x: 1})).toBe(true);
	});
});

describe('exits', () => {
	it("group today's 1-square exits one each", () => {
		const squares = exitsIn({minX: -10, minY: -10, maxX: 10, maxY: 10}, 16);
		expect(exitBlocks(squares)).toEqual(
			squares.map(({x, y}) => ({x, y, span: 1})),
		);
	});

	it('group a 2 x 2 block into one exit named by its top-left square', () => {
		const block = [
			{x: 4, y: 4},
			{x: 5, y: 4},
			{x: 4, y: 5},
			{x: 5, y: 5},
			{x: -5, y: 4},
			{x: -4, y: 4},
			{x: -5, y: 5},
			{x: -4, y: 5},
		];
		expect(exitBlocks(block)).toEqual([
			{x: 4, y: 4, span: 2},
			{x: -5, y: 4, span: 2},
		]);
	});
});

describe('highlights', () => {
	it('mark a destination onto a piece as a capture', () => {
		const view = viewOf({
			pieces: new Map([[squareAt(2, 0), piece(2, 0, THEM, PIECE_KIND.Pawn)]]),
			selected: {x: 0, y: 0},
			destinations: [
				{x: 1, y: 0},
				{x: 2, y: 0},
			],
		});
		expect(overlayModel(view).destinations).toEqual([
			{x: 1, y: 0, capture: false},
			{x: 2, y: 0, capture: true},
		]);
	});

	it('show attacked squares only around your king, on your destinations and on the planned target', () => {
		const view = viewOf({
			kings: [
				{
					army: ME,
					position2d: {x: 0, y: 0},
					stake: 1n,
					stakeLabel: '1',
					frozen: false,
				},
			],
			destinations: [{x: 5, y: 5}],
			plannedMove: {from: {x: 9, y: 9}, to: {x: 8, y: 8}},
			attacked: [
				{x: 1, y: 1},
				{x: 3, y: 3},
				{x: 5, y: 5},
				{x: 8, y: 8},
			],
		});
		expect(attackedThatMatter(view)).toEqual([
			{x: 1, y: 1},
			{x: 5, y: 5},
			{x: 8, y: 8},
		]);
	});

	it('show every attacked square while you have no king on the board', () => {
		const view = viewOf({attacked: [{x: 3, y: 3}]});
		expect(attackedThatMatter(view)).toEqual([{x: 3, y: 3}]);
	});

	it('flag the picked spawn point and every outcome the contract reports', () => {
		const view = viewOf({
			spawnPoints: [
				{spawnPoint: 1n, position: {x: 0, y: 0}, nearest: []},
				{spawnPoint: 2n, position: {x: 9, y: 0}, nearest: []},
			],
			planned: {spawnPoint: 2n, position: {x: 9, y: 0}, nearest: []},
			outcomes: [
				{
					position: squareAt(1, 1),
					position2d: {x: 1, y: 1},
					died: 2,
				},
				{
					position: squareAt(2, 2),
					position2d: {x: 2, y: 2},
					died: 0,
					captured: piece(2, 2, THEM, PIECE_KIND.King),
					piece: piece(2, 2, ME, PIECE_KIND.Queen),
				},
			],
		});
		const model = overlayModel(view);
		expect(model.spawns.map((s) => s.picked)).toEqual([false, true]);
		expect(model.outcomes).toEqual([
			{
				x: 1,
				y: 1,
				collision: true,
				captured: false,
				promoted: false,
				stoneMade: false,
			},
			{
				x: 2,
				y: 2,
				collision: false,
				captured: true,
				promoted: true,
				stoneMade: false,
			},
		]);
	});
});

describe('labels', () => {
	it('carry every king and stone stake, toned by what it is', () => {
		const view = viewOf({
			kings: [
				{
					army: ME,
					position2d: {x: 0, y: 0},
					stake: 1n,
					stakeLabel: 'a',
					frozen: false,
				},
				{
					army: THEM,
					position2d: {x: 4, y: 0},
					stake: 1n,
					stakeLabel: 'b',
					frozen: true,
				},
			],
			stones: [
				{army: 33n, position2d: {x: 7, y: 7}, stake: 1n, stakeLabel: 'c'},
			],
		});
		expect(labelsOf(view)).toEqual([
			{x: 0, y: 0, text: 'a', tone: 'live'},
			{x: 4, y: 0, text: 'b', tone: 'frozen'},
			{x: 7, y: 7, text: 'c', tone: 'stone'},
		]);
	});
});

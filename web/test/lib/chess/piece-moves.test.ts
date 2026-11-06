import {describe, it, expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {
	MAX_PIECE_MOVES,
	ONE_PIECE_MOVE_OPTION,
	maxPieceMovesOf,
	readMaxPieceMoves,
	wholeMoveRoute,
} from '$lib/chess/piece-moves';
import {chessLobby} from '$lib/chess/table';
import {
	NO_GAME_OPTIONS,
	defaultOptionValues,
	encodeTableOptions,
} from '$lib/game/lobby/table';

/**
 * A TABLE CHOOSES ITS PIECE-MOVES (`docs/adr/0016`): one bit of the table's
 * `gameOptions`, and a SET bit means OFF. The client encodes it when a table
 * is created, says it in the table list, and passes the cap the contract
 * reports to the whole-move route, which reads no storage.
 */

const CHESS_RULES = fileURLToPath(
	new URL(
		'../../../../contracts/src/game/internal/ChessRules.sol',
		import.meta.url,
	),
);

const hex = (bits: bigint) =>
	`0x${bits.toString(16).padStart(64, '0')}` as `0x${string}`;

describe('the piece-moves bit', () => {
	it("is the contract's: ChessRules.ONE_PIECE_MOVE and MAX_PIECE_MOVES", () => {
		const source = readFileSync(CHESS_RULES, 'utf8');
		const bit = source.match(
			/bytes32 internal constant ONE_PIECE_MOVE = bytes32\(uint256\((\d+)\)\);/,
		);
		const max = source.match(
			/uint256 internal constant MAX_PIECE_MOVES = (\d+);/,
		);
		expect(bit, 'ChessRules.ONE_PIECE_MOVE not found').not.toBeNull();
		expect(max, 'ChessRules.MAX_PIECE_MOVES not found').not.toBeNull();
		expect(BigInt(bit![1])).toBe(ONE_PIECE_MOVE_OPTION);
		expect(Number(max![1])).toBe(MAX_PIECE_MOVES);
	});

	it('reads three with no options, one with the bit, nothing with any other bit', () => {
		expect(maxPieceMovesOf(NO_GAME_OPTIONS)).toBe(3);
		expect(maxPieceMovesOf(hex(ONE_PIECE_MOVE_OPTION))).toBe(1);
		expect(maxPieceMovesOf(hex(2n))).toBeUndefined();
		expect(maxPieceMovesOf(hex(ONE_PIECE_MOVE_OPTION | (1n << 255n)))).toBe(
			undefined,
		);
	});
});

describe("the table's options", () => {
	const options = chessLobby.options!;

	it('asks for one field, 0 or 1, three piece-moves by default', () => {
		expect(options.fields).toHaveLength(1);
		const [field] = options.fields;
		expect([field.min, field.max, field.default]).toEqual([0, 1, 0]);
		expect(encodeTableOptions(options, defaultOptionValues(options))).toBe(
			NO_GAME_OPTIONS,
		);
	});

	it('sets the bit for one piece-move, and clamps anything else into 0 or 1', () => {
		const [field] = options.fields;
		expect(encodeTableOptions(options, {[field.id]: 1})).toBe(
			hex(ONE_PIECE_MOVE_OPTION),
		);
		expect(encodeTableOptions(options, {[field.id]: 7})).toBe(
			hex(ONE_PIECE_MOVE_OPTION),
		);
		expect(encodeTableOptions(options, {[field.id]: -3})).toBe(NO_GAME_OPTIONS);
	});

	it('says which a table plays, and nothing for options it cannot read', () => {
		expect(options.describe(NO_GAME_OPTIONS)).toEqual([
			{label: 'Piece-moves a cycle', value: 'up to 3'},
		]);
		expect(options.describe(hex(ONE_PIECE_MOVE_OPTION))).toEqual([
			{label: 'Piece-moves a cycle', value: '1'},
		]);
		expect(options.describe(hex(4n))).toEqual([]);
	});
});

describe('the cap, from the contract to the whole-move route', () => {
	it("reads the game's getMaxPieceMoves", async () => {
		const asked: string[] = [];
		const cap = await readMaxPieceMoves(async (functionName) => {
			asked.push(functionName);
			return 1n;
		});
		expect(asked).toEqual(['getMaxPieceMoves']);
		expect(cap).toBe(1);
	});

	it('passes the cap to isLegalWholeMove and legalMovesAlongside', async () => {
		const calls: {functionName: string; args: readonly unknown[]}[] = [];
		const route = wholeMoveRoute({
			maxPieceMoves: 1,
			call: async (functionName, args) => {
				calls.push({functionName, args});
				return functionName === 'isLegalWholeMove' ? false : [7n];
			},
		});
		const board = [{position: 1n, army: 1n << 160n, kind: 1 as const}];
		const moves = [{from: 1n, to: 2n}];
		expect(await route.isLegal(board, 1n << 160n, moves)).toBe(false);
		expect(await route.alongside(board, 1n, [])).toEqual([7n]);
		expect(calls).toEqual([
			{functionName: 'isLegalWholeMove', args: [board, 1n << 160n, moves, 1n]},
			{functionName: 'legalMovesAlongside', args: [board, 1n, [], 1n]},
		]);
	});
});

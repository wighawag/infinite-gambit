import {describe, it, expect} from 'vitest';
import {decodeFunctionResult, encodeFunctionData, type Abi} from 'viem';
import deployments from '$lib/deployments';
import {chessLobby} from '$lib/chess/table';
import type {TypedDeployments} from '$lib/deployments-store';

/**
 * THE CLIENT DECODES THE WHOLE-MOVE ROUTE. The Simulation route judges a whole
 * move of up to three piece-moves (`isLegalWholeMove`) and offers one piece its
 * destinations alongside the others (`legalMovesAlongside`), and the client
 * reaches both through the ABI it already runs `legalMoves` with: the Game's,
 * in the world and at a table (whose route is the lobby implementation's,
 * `$lib/chess/table`). Nothing calls them yet; the planner will.
 */

const records = deployments as unknown as TypedDeployments;
const TABLE = '0x00000000000000000000000000000000000000aa' as const;

const board = [{position: 1n, army: 1n << 160n, kind: 1}];
const moves = [{from: 1n, to: 2n}];

for (const [where, abi] of [
	['the world', records.contracts.Game.abi],
	['a table', chessLobby.deploymentsAt(records, TABLE).contracts.Game.abi],
] as const) {
	describe(`the whole-move route, at ${where}`, () => {
		it('encodes a whole move and decodes its verdict', () => {
			const data = encodeFunctionData({
				abi: abi as Abi,
				functionName: 'isLegalWholeMove',
				args: [board, 1n << 160n, moves, 3n],
			});
			expect(data.startsWith('0x')).toBe(true);
			const verdict = decodeFunctionResult({
				abi: abi as Abi,
				functionName: 'isLegalWholeMove',
				data: `0x${'1'.padStart(64, '0')}`,
			});
			expect(verdict).toBe(true);
		});

		it('encodes a piece alongside a move and decodes its destinations', () => {
			encodeFunctionData({
				abi: abi as Abi,
				functionName: 'legalMovesAlongside',
				args: [board, 1n, moves, 1n],
			});
			// One destination, 7: offset, length, value.
			const data =
				`0x${['20', '1', '7'].map((w) => w.padStart(64, '0')).join('')}` as const;
			expect(
				decodeFunctionResult({
					abi: abi as Abi,
					functionName: 'legalMovesAlongside',
					data,
				}),
			).toEqual([7n]);
		});
	});
}

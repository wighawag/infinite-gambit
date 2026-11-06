import {describe, it, expect, afterEach} from 'vitest';
import {createNode} from 'webevm';
import {createEmbeddedWorld, type EmbeddedWorld} from '$lib/embedded';
import {
	config,
	extensions,
} from 'chess-battleground-contracts/rocketh/config.js';
import {OFFLINE_DEPLOYMENT} from '$lib/offline';
import {createBytecodeSandbox} from '$lib/game/simulation';
import {attackedSquares, attackersOf} from '$lib/chess/attacked';
import {PIECE_KIND, type Piece} from '$lib/chess/board';
import {ARMY_STATUS, type ArmyView} from '$lib/chess/armies';
import {positionOf, squareAt} from '$lib/chess/squares';

/**
 * THE OVERLAY IS THE CONTRACT'S RULE: the attacked squares of a board, worked
 * out by the Simulation route's DEPLOYED bytecode run in the sandbox
 * (`docs/adr/0007-rules-live-only-in-the-contract.md`), are exactly where the
 * enemy's pieces may legally move on the board the cycle started with.
 */

const CHAIN_ID = 9007199254740125;

const YOU = 1n << 160n;
const THEM = 2n << 160n;
const FROZEN = 3n << 160n;
const STONE = 4n << 160n;

let world: EmbeddedWorld | undefined;
afterEach(async () => {
	await world?.dispose();
	world = undefined;
});

const piece = (
	army: bigint,
	x: number,
	y: number,
	kind: Piece['kind'],
): Piece => ({position: squareAt(x, y), army, kind});

const army = (id: bigint, status: number): ArmyView => ({
	id,
	owner: '0x1111111111111111111111111111111111111111',
	status: status as ArmyView['status'],
	deployedIn: 2n,
	spawnPoint: 0n,
	king: 0n,
	stake: 10n,
	capturedBy: 0n,
});

describe('the attacked squares, by the deployed rule', () => {
	it('mark where an enemy may legally move, and nothing a frozen army or a stone could', async () => {
		world = await createEmbeddedWorld({
			chainId: CHAIN_ID,
			chain: {
				name: 'Offline',
				nativeCurrency: {name: 'Ether', symbol: 'ETH', decimals: 18},
				properties: {...config.chains[31337].properties},
			},
			rocketh: {config, extensions},
			environment: OFFLINE_DEPLOYMENT.environment,
			scripts: [...OFFLINE_DEPLOYMENT.scripts],
			data: {...OFFLINE_DEPLOYMENT.data},
			accounts: {...OFFLINE_DEPLOYMENT.accounts},
			initialBalances: {...OFFLINE_DEPLOYMENT.initialBalances},
		});
		const deployments = world.deployments.get();
		const sandbox = createBytecodeSandbox({
			provider: world.provider as never,
			node: () => createNode({}) as never,
			contracts: {
				rules: {
					address:
						deployments.contracts.Game_Implementation_Router_Simulation_Route
							.address,
				},
			},
		});

		const board = [
			// Yours: a pawn the knight can take, and two on the diagonals of the
			// enemy pawn, on opposite sides of it.
			piece(YOU, 0, 0, PIECE_KIND.Pawn),
			piece(YOU, 6, 4, PIECE_KIND.Pawn),
			piece(YOU, 4, 6, PIECE_KIND.Pawn),
			// The enemy: a knight, and a pawn, which steps and captures every way.
			piece(THEM, 2, 1, PIECE_KIND.Knight),
			piece(THEM, 5, 5, PIECE_KIND.Pawn),
			// A frozen army's rook and a stone: neither moves again.
			piece(FROZEN, -3, 0, PIECE_KIND.Rook),
			piece(STONE, -5, -5, PIECE_KIND.Stone),
		];
		const pieces = new Map(board.map((p) => [p.position, p]));
		const attackers = attackersOf({
			pieces,
			armies: [
				army(YOU, ARMY_STATUS.Deployed),
				army(THEM, ARMY_STATUS.Deployed),
				army(FROZEN, ARMY_STATUS.Frozen),
				army(STONE, ARMY_STATUS.Captured),
			],
			you: YOU,
		});
		const squares = await attackedSquares({
			pieces,
			attackers,
			legalMoves: async (around, from) => [
				...((await sandbox.call({
					contract: 'rules',
					abi: deployments.contracts.Game.abi,
					functionName: 'legalMoves',
					args: [around, from],
				})) as unknown as readonly bigint[]),
			],
		});
		sandbox.dispose();

		const marked = squares.map(positionOf);
		expect(marked).toEqual(
			expect.arrayContaining([
				// The knight's eight jumps, your pawn's square included.
				{x: 3, y: 3},
				{x: 1, y: 3},
				{x: 4, y: 2},
				{x: 0, y: 2},
				{x: 4, y: 0},
				{x: 0, y: 0},
				{x: 3, y: -1},
				{x: 1, y: -1},
				// The pawn's four steps, and its two diagonals onto your pawns.
				{x: 5, y: 4},
				{x: 5, y: 6},
				{x: 4, y: 5},
				{x: 6, y: 5},
				{x: 6, y: 4},
				{x: 4, y: 6},
			]),
		);
		// Not its other diagonals, onto empty squares: it may not move there
		// this cycle. Nor anything the frozen rook or the stone could reach.
		expect(marked).toHaveLength(14);
		expect(marked).not.toContainEqual({x: 4, y: 4});
		expect(marked).not.toContainEqual({x: 6, y: 6});
		expect(marked).not.toContainEqual({x: -2, y: 0});
	}, 60_000);
});

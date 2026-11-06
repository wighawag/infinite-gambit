import {describe, it, expect} from 'vitest';
import {get, writable} from 'svelte/store';
import {
	attackedSquares,
	attackersOf,
	createAttackedSquares,
	withAttacked,
} from '$lib/chess/attacked';
import {
	DIRECTION,
	PIECE_KIND,
	type BoardState,
	type Piece,
} from '$lib/chess/board';
import {ARMY_STATUS, type ArmyView} from '$lib/chess/armies';
import {squareAt} from '$lib/chess/squares';
import {mergeBoardView, type LocalPlan} from '$lib/chess/view';
import {noOutcomes} from '$lib/chess/outcomes';
import type {OnchainStateValue} from '$lib/game/core/seams';

/**
 * THE ATTACKED SQUARES (story 21): the union of the contract's `legalMoves`
 * over the pieces of every army that may move against the player. The rule is
 * faked here by whatever a test says it answers; `attacked-offline.test.ts`
 * runs the deployed one.
 */

const YOU = 1n << 160n;
const THEM = 2n << 160n;
const FROZEN = 3n << 160n;
const STONE = 4n << 160n;

const piece = (
	army: bigint,
	x: number,
	y: number,
	kind: Piece['kind'] = PIECE_KIND.Pawn,
): Piece => ({
	position: squareAt(x, y),
	army,
	kind,
	forward: DIRECTION.North,
	moved: false,
});

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

const board = (pieces: Piece[], armies: ArmyView[]) =>
	({
		step: 'Loaded',
		pieces: new Map(pieces.map((p) => [p.position, p])),
		spawnPoints: [],
		armies,
		outcomes: noOutcomes(),
	}) as OnchainStateValue<BoardState>;

const settle = () => new Promise((r) => setTimeout(r, 0));

describe('whose pieces attack', () => {
	it('is every piece of another army that may move: not yours, not a frozen army, not a stone', () => {
		const pieces = [
			piece(YOU, 0, 0),
			piece(THEM, 1, 1),
			piece(THEM, 2, 2, PIECE_KIND.King),
			piece(FROZEN, 3, 3),
			piece(STONE, 4, 4, PIECE_KIND.Stone),
			// A stone attacks nothing whatever its army's record says.
			piece(THEM, 5, 5, PIECE_KIND.Stone),
		];
		const attackers = attackersOf({
			pieces: new Map(pieces.map((p) => [p.position, p])),
			armies: [
				army(YOU, ARMY_STATUS.Deployed),
				army(THEM, ARMY_STATUS.Deployed),
				army(FROZEN, ARMY_STATUS.Frozen),
				army(STONE, ARMY_STATUS.Captured),
			],
			you: YOU,
		});
		expect(attackers.map((p) => p.position)).toEqual([
			squareAt(1, 1),
			squareAt(2, 2),
		]);
	});
});

describe('the attacked squares', () => {
	it("are every square the contract's rule lets an attacker move to, each once", async () => {
		const asked: bigint[] = [];
		const answers = new Map<bigint, bigint[]>([
			[squareAt(1, 1), [squareAt(1, 2), squareAt(0, 0)]],
			[squareAt(5, 5), [squareAt(0, 0), squareAt(6, 6)]],
		]);
		const attackers = [piece(THEM, 1, 1), piece(THEM, 5, 5)];
		const squares = await attackedSquares({
			pieces: new Map(attackers.map((p) => [p.position, p])),
			attackers,
			legalMoves: async (_pieces, from) => {
				asked.push(from);
				return answers.get(from) ?? [];
			},
		});
		expect(asked).toEqual([squareAt(1, 1), squareAt(5, 5)]);
		expect(new Set(squares)).toEqual(
			new Set([squareAt(1, 2), squareAt(0, 0), squareAt(6, 6)]),
		);
		expect(squares).toHaveLength(3);
	});

	it('hands the rule only the neighbourhood of each attacker', async () => {
		const far = piece(YOU, 40, 40);
		const near = piece(YOU, 2, 2);
		const attacker = piece(THEM, 0, 0);
		let handed: readonly Piece[] = [];
		await attackedSquares({
			pieces: new Map([far, near, attacker].map((p) => [p.position, p])),
			attackers: [attacker],
			legalMoves: async (pieces) => {
				handed = pieces;
				return [];
			},
		});
		expect(handed.map((p) => p.position)).toContain(near.position);
		expect(handed.map((p) => p.position)).not.toContain(far.position);
	});
});

describe('the attacked squares, as a store', () => {
	it('works them out while your army stands on the board, and reaches the view', async () => {
		const state = writable(
			board(
				[piece(YOU, 0, 0), piece(THEM, 1, 2)],
				[army(YOU, ARMY_STATUS.Deployed), army(THEM, ARMY_STATUS.Deployed)],
			),
		);
		let calls = 0;
		const attacked = createAttackedSquares({
			board: state,
			you: writable(YOU),
			legalMoves: async () => {
				calls++;
				return [squareAt(0, 0)];
			},
		});
		const plan = withAttacked(writable<LocalPlan>({army: YOU}), attacked);
		const stop = plan.subscribe(() => {});
		await settle();
		expect(get(plan).attacked).toEqual([squareAt(0, 0)]);

		// The same board read again does not ask again.
		state.set(
			board(
				[piece(YOU, 0, 0), piece(THEM, 1, 2)],
				[army(YOU, ARMY_STATUS.Deployed), army(THEM, ARMY_STATUS.Deployed)],
			),
		);
		await settle();
		expect(calls).toBe(1);

		const current = get(state);
		if (current.step !== 'Loaded') throw new Error('unloaded');
		const view = mergeBoardView({
			onchain: {...current, cycleNumber: 3},
			local: get(plan),
		} as never);
		expect(view.attacked).toEqual([{x: 0, y: 0}]);
		stop();
	});

	it('is nothing while your army is not on the board, or frozen', async () => {
		for (const status of [ARMY_STATUS.Deploying, ARMY_STATUS.Frozen]) {
			const attacked = createAttackedSquares({
				board: writable(
					board(
						[piece(YOU, 0, 0), piece(THEM, 1, 2)],
						[army(YOU, status), army(THEM, ARMY_STATUS.Deployed)],
					),
				),
				you: writable(YOU),
				legalMoves: async () => [squareAt(0, 0)],
			});
			const stop = attacked.subscribe(() => {});
			await settle();
			expect(get(attacked).step).toBe('Idle');
			stop();
		}
	});

	it('is not attached to a plan for another army', async () => {
		const attacked = createAttackedSquares({
			board: writable(
				board(
					[piece(YOU, 0, 0), piece(THEM, 1, 2)],
					[army(YOU, ARMY_STATUS.Deployed), army(THEM, ARMY_STATUS.Deployed)],
				),
			),
			you: writable(YOU),
			legalMoves: async () => [squareAt(0, 0)],
		});
		const plan = withAttacked(writable<LocalPlan>({army: THEM}), attacked);
		const stop = plan.subscribe(() => {});
		await settle();
		expect(get(plan).attacked).toBeUndefined();
		stop();
	});
});

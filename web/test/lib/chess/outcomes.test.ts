import {describe, it, expect} from 'vitest';
import {
	accumulateOutcomes,
	describeOutcomes,
	noOutcomes,
	outcomeOf,
	type SquareOutcome,
} from '$lib/chess/outcomes';
import {createBoardReader, PIECE_KIND, type BoardState} from '$lib/chess/board';
import {mergeBoardView} from '$lib/chess/view';
import {describeLastCycle} from '$lib/chess/ui/hud';
import {positionOf, squareAt, zonesInRect} from '$lib/chess/squares';

/**
 * WHAT THE LAST CYCLE DID, on the client: the contract's `getOutcomes` answer
 * normalised, kept across reads, merged into the view and worded for the HUD.
 * Who died and who captured is the contract's to say (`Collisions.test.ts`);
 * none of this decides it.
 */

const YOU = 7n << 160n;
const THEM = 9n << 160n;
const NONE = {position: 0n, army: 0n, kind: 0, forward: 0, moved: false};

const raw = (
	x: number,
	y: number,
	died: number,
	captured?: {army: bigint; kind: number},
	piece?: {army: bigint; kind: number},
) => {
	const position = squareAt(x, y);
	const at = (p?: {army: bigint; kind: number}) =>
		p ? {position, army: p.army, kind: p.kind, forward: 0, moved: true} : NONE;
	return {position, died, captured: at(captured), piece: at(piece)};
};

const capture = outcomeOf(
	raw(3, 1, 0, {army: THEM, kind: PIECE_KIND.Queen}, {army: YOU, kind: 1}),
);
const collision = outcomeOf(raw(3, 0, 2));
const held = outcomeOf(
	raw(5, 5, 3, undefined, {army: THEM, kind: PIECE_KIND.Rook}),
);

describe('an outcome', () => {
	it('drops the pieces the contract reports as kind None', () => {
		expect(collision).toEqual({position: squareAt(3, 0), died: 2});
		expect(capture.captured?.kind).toBe(PIECE_KIND.Queen);
		expect(capture.piece?.army).toBe(YOU);
		expect(held.captured).toBeUndefined();
	});
});

describe('keeping the outcomes across reads', () => {
	it('keeps the union of every read of one cycle, since a later read can only have lost squares', () => {
		let kept = accumulateOutcomes(noOutcomes(), {
			cycleNumber: 4,
			outcomes: [capture, collision],
		});
		// A reveal of cycle 5 touched (3,1): the read no longer has it.
		kept = accumulateOutcomes(kept, {cycleNumber: 4, outcomes: [collision]});
		expect([...kept.bySquare.keys()]).toEqual([squareAt(3, 1), squareAt(3, 0)]);
	});

	it('starts again for a newer cycle, and ignores an older read that lands late', () => {
		const four = accumulateOutcomes(noOutcomes(), {
			cycleNumber: 4,
			outcomes: [capture],
		});
		const five = accumulateOutcomes(four, {cycleNumber: 5, outcomes: []});
		expect(five).toEqual({cycleNumber: 5, bySquare: new Map()});
		expect(
			accumulateOutcomes(five, {cycleNumber: 4, outcomes: [collision]}),
		).toBe(five);
	});

	it('is what the board reader does with `getOutcomes`, over the rectangle in view, pinned to the block', async () => {
		const calls: {functionName: string; args: unknown[]; block: bigint}[] = [];
		let answer: readonly [unknown[], bigint] = [
			[raw(3, 1, 0, {army: THEM, kind: 5}, {army: YOU, kind: 1}), raw(3, 0, 2)],
			4n,
		];
		const read = createBoardReader({
			deployments: {
				contracts: {
					Game: {
						address: '0x2222222222222222222222222222222222222222',
						abi: [],
					},
				},
			} as never,
			publicClient: {
				readContract: async (request: {
					functionName: string;
					args: unknown[];
					blockNumber: bigint;
				}) => {
					calls.push({
						functionName: request.functionName,
						args: request.args,
						block: request.blockNumber,
					});
					if (request.functionName === 'getOutcomes') return answer;
					return [[], 0n];
				},
			} as never,
		});
		const zones = zonesInRect({left: 0, top: 0, right: 10, bottom: 10});
		const first = await read({
			zones,
			fromBlock: 0,
			toBlock: 42,
			expectedCycleNumber: 5,
		});
		const call = calls.find((c) => c.functionName === 'getOutcomes');
		expect(call?.args).toEqual([0, 0, 15, 15]);
		expect(call?.block).toBe(42n);
		expect(first?.outcomes.cycleNumber).toBe(4);
		expect(first?.outcomes.bySquare.size).toBe(2);

		// The capture's square was touched since: the next read still shows it.
		answer = [[raw(3, 0, 2)], 4n];
		const second = await read({
			zones,
			fromBlock: 42,
			toBlock: 43,
			expectedCycleNumber: 5,
		});
		expect(second?.outcomes.bySquare.size).toBe(2);
	});
});

describe('showing the outcomes', () => {
	const onchain = (outcomes: SquareOutcome[]): BoardState => ({
		pieces: new Map(),
		spawnPoints: [],
		armies: [],
		outcomes: accumulateOutcomes(noOutcomes(), {cycleNumber: 4, outcomes}),
	});

	it('puts them in the view with their coordinates', () => {
		const view = mergeBoardView({
			onchain: onchain([capture, collision]),
			local: {army: YOU},
			cycleNumber: 5,
		});
		expect(view.outcomesCycle).toBe(4);
		expect(view.outcomes.map((o) => [o.position2d, o.died])).toEqual([
			[{x: 3, y: 1}, 0],
			[{x: 3, y: 0}, 2],
		]);
	});

	it("words them from the player's side, and says nothing for a quiet cycle", () => {
		const lines = describeOutcomes([capture, collision, held], positionOf, YOU);
		expect(lines).toEqual([
			{label: '2 pieces collided on (3, 0) and died.', tone: 'idle'},
			{label: 'Your pawn captured a queen on (3, 1).', tone: 'good'},
			{
				label:
					'3 pieces collided on (5, 5) and died; the rook there held its square.',
				tone: 'idle',
			},
		]);
		expect(describeOutcomes([capture], positionOf, THEM)).toEqual([
			{label: 'Your queen on (3, 1) was captured by a pawn.', tone: 'bad'},
		]);
		expect(describeOutcomes([capture], positionOf)).toEqual([
			{label: 'A queen on (3, 1) was captured by a pawn.', tone: 'idle'},
		]);

		const view = (outcomes: SquareOutcome[]) => ({
			step: 'Loaded' as const,
			cycleNumber: 5,
			...mergeBoardView({
				onchain: onchain(outcomes),
				local: {army: YOU},
				cycleNumber: 5,
			}),
		});
		expect(describeLastCycle(view([collision]))).toEqual({
			cycleNumber: 4,
			lines: [{label: '2 pieces collided on (3, 0) and died.', tone: 'idle'}],
		});
		expect(describeLastCycle(view([]))).toBeUndefined();
		expect(describeLastCycle({step: 'Unloaded'} as never)).toBeUndefined();
	});
});

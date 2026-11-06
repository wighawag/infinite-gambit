import {expect} from 'earl';
import {describe, it} from 'node:test'; // using node:test as hardhat v3 do not support vitest
import {network} from 'hardhat';
import {toHex} from 'viem';
import {setupFixtures, deployGameWith, CYCLE_POLICY} from './utils/index.js';
import {move} from './utils/moves-world.js';
import {tableWorld} from './utils/table-world.js';
import {OFFLINE_OPEN_SPAWN_POINTS} from '../../rocketh/config.js';

/**
 * A TABLE CHOOSES ITS PIECE-MOVES (`docs/adr/0016`): one bit of the
 * framework's `gameOptions`, and a SET bit means OFF. The worlds never open a
 * roster, so they read zero and play three piece-moves a cycle; a table
 * created with no options plays three as well; a creator who sets the bit
 * plays one, the game before three piece-moves.
 *
 * A table whose options carry any other bit is one this game cannot read: it
 * is refused at the SEAT, so nobody can stake at it, and never at the reveal,
 * where a refusal would freeze the members who had already staked
 * (`docs/adr/0005-missed-reveal-freezes-the-army.md`).
 *
 * The tables are `utils/table-world.ts`'s: seat 0 at (0,0) and seat 1 at
 * (6,0), each the one layout, whose pawns stand on y = 2 above their king.
 */

const {provider, networkHelpers} = await network.connect();
const {deployAll} = setupFixtures(provider);
const world = tableWorld({deployAll, loadFixture: networkHelpers.loadFixture});

/** `ChessRules.ONE_PIECE_MOVE`: the bit that turns three piece-moves off. */
const ONE_PIECE_MOVE = 1n;
const options = (bits: bigint) => toHex(bits, {size: 32});

/** Three of alice's pawns one step up: three piece-moves of one move. */
const THREE = [
	move([-1, 2], [-1, 3]),
	move([0, 2], [0, 3]),
	move([1, 2], [1, 3]),
];

/** A started table of alice and bob, with `gameOptions`. */
async function startedTable(gameOptions: `0x${string}`) {
	const w = await world();
	const t = await w.create(2, 100, gameOptions);
	const a = await t.buy(w.alice);
	const b = await t.buy(w.bob);
	await t.start();
	return {w, t, a, b};
}

describe('three piece-moves, or one, by the table', function () {
	it('plays three piece-moves in both worlds, which read no options', async function () {
		const {env, Game, GameToken} = await networkHelpers.loadFixture(deployAll);
		expect(
			await env.read(Game, {functionName: 'getMaxPieceMoves', args: []}),
		).toEqual(3n);
		// The offline world is the same game with more spawn points open.
		const Offline = await deployGameWith(
			{env, GameToken},
			{
				name: 'OfflineToggleGame',
				cyclePolicy: CYCLE_POLICY.Timed,
				commitPhaseDuration: 60n,
				revealPhaseDuration: 30n,
				openSpawnPoints: OFFLINE_OPEN_SPAWN_POINTS,
			},
		);
		expect(
			await env.read(
				Offline as never,
				{
					functionName: 'getMaxPieceMoves',
					args: [],
				} as never,
			),
		).toEqual(3n);
	});

	it('plays three piece-moves at a table created with no options', async function () {
		const {w, t, a, b} = await startedTable(options(0n));
		expect(await t.read<bigint>('getMaxPieceMoves')).toEqual(3n);
		await t.play([
			{owner: w.alice, army: a, moves: THREE},
			{owner: w.bob, army: b, moves: []},
		]);
		for (const x of [-1, 0, 1]) {
			expect(await t.pieceAt(x, 3)).toEqual(`P@${x},3#${a}`);
		}
	});

	it('plays one piece-move at a table whose creator set the bit, and refuses two', async function () {
		const {w, t, a, b} = await startedTable(options(ONE_PIECE_MOVE));
		expect(await t.read<bigint>('getMaxPieceMoves')).toEqual(1n);

		// Two piece-moves, each legal alone, are not one move here, nor three.
		for (const moves of [THREE.slice(0, 2), THREE]) {
			const snapshot = await networkHelpers.takeSnapshot();
			await t.commit(w.alice, a, moves);
			await t.byTheClock();
			await expect(t.reveal(w.alice, a, moves)).toBeRejectedWith(
				'OneMovePerCycle',
			);
			await snapshot.restore();
		}

		// One is.
		await t.play([
			{owner: w.alice, army: a, moves: [THREE[0]]},
			{owner: w.bob, army: b, moves: []},
		]);
		expect(await t.pieceAt(-1, 3)).toEqual(`P@-1,3#${a}`);
		expect(await t.pieceAt(-1, 2)).toEqual(undefined);
	});

	it('refuses a seat at a table whose options carry any other bit, so no reveal ever has to', async function () {
		for (const bits of [2n, ONE_PIECE_MOVE | 4n, 1n << 255n]) {
			const w = await world();
			const t = await w.create(2, 100, options(bits));
			await expect(t.buy(w.alice)).toBeRejectedWith('UnreadableGameOptions');
			expect(await t.members()).toEqual([]);
		}
	});
});

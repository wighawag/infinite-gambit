import {expect} from 'earl';
import {describe, it} from 'node:test'; // using node:test as hardhat v3 do not support vitest
import {network} from 'hardhat';
import {setupFixtures} from './utils/index.js';
import {movesWorld, move} from './utils/moves-world.js';

/**
 * A FROZEN ARMY UNDER EARLY ADVANCE (`TimedWithEarlyAdvance`, the clock of a
 * table): it never commits again, so a cycle that waited for it would never
 * advance early again. The advance's sweep stops waiting for it, like any dead
 * army (`docs/adr/0005-missed-reveal-freezes-the-army.md`).
 *
 * Its own file because it deploys a game on another clock: a second timed
 * fixture in one suite would start from a chain the first has moved on.
 */

const {provider, networkHelpers} = await network.connect();
const {deployAll} = setupFixtures(provider);
const world = movesWorld({
	deployAll,
	loadFixture: networkHelpers.loadFixture,
	earlyAdvance: true,
});

type World = Awaited<ReturnType<typeof world>>;
type Cycle = {commiting: boolean; cycleNumber: bigint};

function read<T>(w: World, functionName: string, args: unknown[] = []) {
	return w.env.read(w.Game, {functionName, args} as never) as Promise<T>;
}

const attendance = (w: World) =>
	read<{waitedFor: bigint; committed: bigint; revealed: bigint}>(
		w,
		'getAttendance',
	);

describe('a frozen army at a table (early advance)', function () {
	it('stops being waited for at the next advance, so the table advances early again', async function () {
		const w = await world();
		const [a, b] = await w.deploy([
			[w.alice, [0, 0]],
			[w.bob, [1, 0]],
		]);
		expect((await attendance(w)).waitedFor).toEqual(2n);

		// alice commits a move and never reveals it; bob passes and reveals.
		await w.commit(w.alice, a, [move([0, 2], [0, 3])]);
		await w.commit(w.bob, b, []);
		await w.toRevealPhase();
		await w.reveal(w.bob, b, []);
		await w.toNextCycle();
		expect(await read<boolean>(w, 'isFrozen', [a])).toEqual(true);

		// The attendance already counts only bob, as the advance will, before
		// anybody has settled alice's missed reveal.
		expect((await attendance(w)).waitedFor).toEqual(1n);
		await w.commit(w.bob, b, []);
		await w.advance();
		const reveal = await read<Cycle>(w, 'getCycle');
		expect(reveal.commiting).toEqual(false);
		await w.reveal(w.bob, b, []);
		await w.advance();
		const next = await read<Cycle>(w, 'getCycle');
		expect([next.commiting, next.cycleNumber]).toEqual([
			true,
			reveal.cycleNumber + 1n,
		]);

		// And alice is never waited for again.
		expect((await attendance(w)).waitedFor).toEqual(1n);
		await expect(w.commit(w.alice, a, [])).toBeRejectedWith('NotInGame');
		await w.commit(w.bob, b, []);
		await w.advance();
		expect((await read<Cycle>(w, 'getCycle')).commiting).toEqual(false);
	});
});

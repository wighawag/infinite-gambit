import {expect} from 'earl';
import {describe, it} from 'node:test'; // using node:test as hardhat v3 do not support vitest
import {network} from 'hardhat';
import {
	setupFixtures,
	fundAccount,
	commitDeployment,
	revealDeployment,
	squareAt,
} from './utils/index.js';

/**
 * THE SIMULATION ROUTE IS THE BOARD'S RULE, and the board is its oracle.
 *
 * A client previews a deployment by running `previewDeployment` from the
 * deployed bytecode in its own sandbox (`web/src/lib/game/simulation/`), so the
 * army it draws for a planned spawn point is the one the chain will resolve
 * there (`docs/adr/0007-rules-live-only-in-the-contract.md`). That preview is
 * only worth anything if it is what the board then shows, so these tests
 * preview a deployment, make it, and compare.
 */

const {provider, networkHelpers} = await network.connect();
const {deployAll} = setupFixtures(provider);

const SECRET =
	'0x0000000000000000000000000000000000000000000000000000000000000a11';

type Piece = {position: bigint; army: bigint; kind: number; forward: number};

const byPosition = (a: Piece, b: Piece) =>
	a.position < b.position ? -1 : a.position > b.position ? 1 : 0;

describe('the simulation route', function () {
	it('previews exactly what the board then shows', async function () {
		const f = await networkHelpers.loadFixture(deployAll);
		const {cycleNumber} = f.getCycleNumber(await f.getTimestamp());
		await f.advanceToCycleNumber(cycleNumber + 2, true);
		const owner = f.unnamedAccounts[0] as `0x${string}`;
		// East-facing, so the preview is not the unrotated layout.
		const spawnPoint = squareAt(16, 0);

		await fundAccount(f, owner);
		const {army} = await commitDeployment(f, {
			owner,
			spawnPoint,
			secret: SECRET,
			actionsPerReveal: f.actionsPerReveal,
		});
		const preview = (await f.env.read(f.Game, {
			functionName: 'previewDeployment',
			args: [spawnPoint, army],
		})) as readonly Piece[];

		await f.advanceToRevealPhase(cycleNumber + 2, true);
		await revealDeployment(f, {
			account: owner,
			army,
			spawnPoint,
			secret: SECRET,
			actionsPerReveal: f.actionsPerReveal,
		});
		await f.advanceToCycleNumber(cycleNumber + 3, true);

		const [board] = (await f.env.read(f.Game, {
			functionName: 'getPieces',
			args: [0, -16, 32, 16],
		})) as readonly [readonly Piece[], bigint];
		expect([...board].sort(byPosition)).toEqual([...preview].sort(byPosition));
	});

	it('reads no storage, so it answers the same before anything is deployed', async function () {
		const f = await networkHelpers.loadFixture(deployAll);
		const route = f.env.get('Game_Implementation_Router_Simulation_Route');
		const army = 1n << 160n;
		// Called on the ROUTE itself, which holds none of the game's state:
		// what a client's sandbox has.
		const fromRoute = await f.env.read(
			{address: route.address, abi: f.Game.abi},
			{functionName: 'previewDeployment', args: [squareAt(0, 16), army]},
		);
		const fromGame = await f.env.read(f.Game, {
			functionName: 'previewDeployment',
			args: [squareAt(0, 16), army],
		});
		expect(fromRoute).toEqual(fromGame);
		expect((fromRoute as readonly Piece[]).length).toEqual(20);
	});

	it('values material as the table payout does, from the route alone', async function () {
		const f = await networkHelpers.loadFixture(deployAll);
		const route = f.env.get('Game_Implementation_Router_Simulation_Route');
		// None, Pawn, Knight, Bishop, Rook, Queen, King.
		const values: bigint[] = [];
		for (let kind = 0; kind <= 6; kind++) {
			values.push(
				(await f.env.read(
					{address: route.address, abi: f.Game.abi},
					{functionName: 'materialOf', args: [kind]},
				)) as bigint,
			);
		}
		expect(values).toEqual([0n, 1n, 3n, 3n, 5n, 9n, 0n]);
	});
});

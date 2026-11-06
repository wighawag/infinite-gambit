import {expect} from 'earl';
import {describe, it} from 'node:test'; // using node:test as hardhat v3 do not support vitest
import {network} from 'hardhat';
import {
	setupFixtures,
	idOf,
	armyIdOf,
	fundAccount,
	mintTokens,
	commitDeployment,
	revealDeployment,
	commitmentChain,
	commitmentHashFor,
	revealTurn,
	deploymentAt,
	squareAt,
	xyOf,
	type Move,
} from './utils/index.js';
import {parseEther, zeroAddress} from 'viem';

/**
 * DEPLOYING AN ARMY: the stake, the hidden spawn point, the spiral of open
 * spawn points, the layout and its orientation, the registry, and the board
 * read over a viewport. The words are `CONTEXT.md`'s; the decisions are
 * `docs/adr/0002`, `0006` and `0007`.
 */

const {provider, networkHelpers} = await network.connect();
const {deployAll} = setupFixtures(provider);

const SECRET_A =
	'0x0000000000000000000000000000000000000000000000000000000000000a11';
const SECRET_B =
	'0x0000000000000000000000000000000000000000000000000000000000000b22';

/** The deployment's spawn grid (`data.Game.spawnSpacing`). */
const S = 9;
const spawn = (i: number, j: number) => squareAt(i * S, j * S);

const STATUS = {
	None: 0,
	Deploying: 1,
	Deployed: 2,
	Failed: 3,
	Unrevealed: 4,
} as const;
const KIND = ['.', 'P', 'N', 'B', 'R', 'Q', 'K'] as const;

type Piece = {
	position: bigint;
	army: bigint;
	kind: number;
};
type ArmyView = {
	id: bigint;
	owner: string;
	status: number;
	deployedIn: bigint;
	spawnPoint: bigint;
	king: bigint;
	stake: bigint;
};

/** The deployed game, at the top of a commit phase, with helpers. */
async function world() {
	const f = await networkHelpers.loadFixture(deployAll);
	const {cycleNumber: start} = f.getCycleNumber(await f.getTimestamp());
	await f.advanceToCycleNumber(start + 2, true);
	let cycle = start + 2;
	const [alice, bob, carol] = f.unnamedAccounts as `0x${string}`[];

	return {
		...f,
		alice,
		bob,
		carol,
		cycle: () => cycle,
		async toRevealPhase() {
			await f.advanceToRevealPhase(cycle, true);
		},
		async toNextCycle() {
			cycle += 1;
			await f.advanceToCycleNumber(cycle, true);
		},
		/** Fund `owner` and commit a deployment at `spawnPoint`. */
		async deploy(
			owner: `0x${string}`,
			spawnPoint: bigint,
			secret: `0x${string}` = SECRET_A,
		) {
			await fundAccount(f, owner);
			const {army} = await commitDeployment(f, {
				owner,
				spawnPoint,
				secret,
				actionsPerReveal: f.actionsPerReveal,
			});
			return army;
		},
		reveal(
			owner: `0x${string}`,
			army: bigint,
			spawnPoint: bigint,
			secret: `0x${string}` = SECRET_A,
		) {
			return revealDeployment(f, {
				account: owner,
				army,
				spawnPoint,
				secret,
				actionsPerReveal: f.actionsPerReveal,
			});
		},
		async army(id: bigint): Promise<ArmyView> {
			return (await f.env.read(f.Game, {
				functionName: 'getArmy',
				args: [id],
			})) as ArmyView;
		},
		async armies(offset: number, limit: number) {
			return (await f.env.read(f.Game, {
				functionName: 'getArmies',
				args: [BigInt(offset), BigInt(limit)],
			})) as [ArmyView[], bigint];
		},
		async pieces(minX: number, minY: number, maxX: number, maxY: number) {
			const [pieces] = (await f.env.read(f.Game, {
				functionName: 'getPieces',
				args: [minX, minY, maxX, maxY],
			})) as [Piece[], bigint];
			return pieces;
		},
		async open(): Promise<{x: number; y: number}[]> {
			const [points] = (await f.env.read(f.Game, {
				functionName: 'getOpenSpawnPoints',
			})) as [bigint[], bigint];
			return points.map(xyOf);
		},
		async reserve(id: bigint) {
			return (await f.env.read(f.Game, {
				functionName: 'getReserve',
				args: [id],
			})) as bigint;
		},
		async attendance() {
			return (await f.env.read(f.Game, {
				functionName: 'getAttendance',
			})) as {waitedFor: bigint; committed: bigint; revealed: bigint};
		},
	};
}

/**
 * The squares of a rectangle as text, top row (highest y) first, so a test
 * can say what the board looks like rather than list coordinates.
 */
function picture(
	pieces: readonly Piece[],
	rect: {minX: number; minY: number; maxX: number; maxY: number},
): string[] {
	const at = new Map<string, Piece>();
	for (const piece of pieces) {
		const {x, y} = xyOf(piece.position);
		at.set(`${x},${y}`, piece);
	}
	const lines: string[] = [];
	for (let y = rect.maxY; y >= rect.minY; y--) {
		const row: string[] = [];
		for (let x = rect.minX; x <= rect.maxX; x++) {
			const piece = at.get(`${x},${y}`);
			row.push(piece ? KIND[piece.kind] : '.');
		}
		lines.push(row.join(' '));
	}
	return lines;
}

/**
 * THE LAYOUT, the same for every army (`docs/adr/0015`): a 5 by 5 square
 * without its corners, centred on the spawn point, top row (highest y) first.
 */
const LAYOUT = {
	rect: (sx: number, sy: number) => ({
		minX: sx - 2,
		maxX: sx + 2,
		minY: sy - 2,
		maxY: sy + 2,
	}),
	picture: ['. P P P .', 'P R N B P', 'P Q K . P', 'P B N R P', '. P P P .'],
	king: (sx: number, sy: number) => ({x: sx, y: sy}),
} as const;

/**
 * What every layout must satisfy, wherever it spawned: twenty pieces in the
 * square, the picture above, every one of the army's, and the king on the
 * spawn point.
 */
function expectLayout(
	pieces: readonly Piece[],
	spawnPoint: {x: number; y: number},
	army: bigint,
) {
	const rect = LAYOUT.rect(spawnPoint.x, spawnPoint.y);
	expect(pieces.length).toEqual(20);
	expect(picture(pieces, rect)).toEqual([...LAYOUT.picture]);
	for (const piece of pieces) {
		expect(piece.army).toEqual(army);
		if (KIND[piece.kind] === 'K') {
			expect(xyOf(piece.position)).toEqual(
				LAYOUT.king(spawnPoint.x, spawnPoint.y),
			);
		}
	}
}

describe('Deploying an army', function () {
	it('buys stake into the ACCOUNT reserve, which makes nobody a member', async function () {
		const w = await world();
		await fundAccount(w, w.alice);

		expect(await w.reserve(idOf(w.alice))).toEqual(w.stake);
		// Only armies are waited for: an account that became a member by buying
		// stake would stall every policy that waits for everyone.
		expect((await w.attendance()).waitedFor).toEqual(0n);
		await expect(
			w.env.execute(w.Game, {
				account: w.alice,
				functionName: 'makeCommitment',
				args: [
					idOf(w.alice),
					commitmentHashFor([], SECRET_A, w.actionsPerReveal),
					0n,
					zeroAddress,
				],
			}),
		).toBeRejectedWith(/NotInGame/);
	});

	it('moves the stake into a NEW ARMY reserve when the deployment is committed', async function () {
		const w = await world();
		await fundAccount(w, w.alice, {amount: w.stake * 2n});
		const {army} = await commitDeployment(w, {
			owner: w.alice,
			spawnPoint: spawn(0, 0),
			secret: SECRET_A,
			actionsPerReveal: w.actionsPerReveal,
		});

		expect(army).toEqual(armyIdOf(w.alice, 1));
		expect(army > (1n << 160n) - 1n).toEqual(true);
		expect(await w.reserve(idOf(w.alice))).toEqual(w.stake);
		expect(await w.reserve(army)).toEqual(w.stake);
		const attendance = await w.attendance();
		// The army is waited for, in the same cycle as the commitment it made.
		expect(attendance.waitedFor).toEqual(1n);
		expect(attendance.committed).toEqual(1n);

		expect(
			await w.env.read(w.Game, {
				functionName: 'getNextArmy',
				args: [w.alice],
			}),
		).toEqual(armyIdOf(w.alice, 2));
	});

	it('refuses a deployment the account reserve cannot pay for', async function () {
		const w = await world();
		await fundAccount(w, w.alice, {amount: w.stake - 1n});
		await expect(
			commitDeployment(w, {
				owner: w.alice,
				spawnPoint: spawn(0, 0),
				secret: SECRET_A,
				actionsPerReveal: w.actionsPerReveal,
			}),
		).toBeRejectedWith(/ReserveTooLow/);
	});

	it('lets the account reserve be withdrawn, and never the army reserve', async function () {
		const w = await world();
		await fundAccount(w, w.alice, {amount: w.stake + parseEther('3')});
		const {army} = await commitDeployment(w, {
			owner: w.alice,
			spawnPoint: spawn(0, 0),
			secret: SECRET_A,
			actionsPerReveal: w.actionsPerReveal,
		});

		// What is left in the account is stake not deployed: freely withdrawn.
		await w.env.execute(w.Game, {
			account: w.alice,
			functionName: 'withdrawFromReserve',
			args: [parseEther('3')],
		});
		expect(await w.reserve(idOf(w.alice))).toEqual(0n);

		// The army's stake has no withdrawal of its own: `withdrawFromReserve`
		// only ever reaches the caller's ACCOUNT, which is now empty.
		await expect(
			w.env.execute(w.Game, {
				account: w.alice,
				functionName: 'withdrawFromReserve',
				args: [1n],
			}),
		).toBeRejectedWith(/ReserveTooLow/);
		expect(await w.reserve(army)).toEqual(w.stake);
	});

	it('refuses to credit an army id through addToReserve', async function () {
		const w = await world();
		const future = armyIdOf(w.alice, 1);
		await mintTokens(w, w.bob, w.stake);
		await w.env.execute(w.GameToken, {
			account: w.bob,
			functionName: 'approve',
			args: [w.Game.address, w.stake],
		});
		// Neither a future army (pre-funding it) nor an existing one (slipping
		// extra stake into it): an army reserve is funded by its deployment.
		await expect(
			w.env.execute(w.Game, {
				account: w.bob,
				functionName: 'addToReserve',
				args: [future, w.stake],
			}),
		).toBeRejectedWith(/InvalidPlayer/);

		const army = await w.deploy(w.alice, spawn(0, 0));
		await expect(
			w.env.execute(w.Game, {
				account: w.bob,
				functionName: 'addToReserve',
				args: [army, w.stake],
			}),
		).toBeRejectedWith(/InvalidPlayer/);
	});

	it("refuses an army id that is not the owner's next, and a sender who may not act for its owner", async function () {
		const w = await world();
		await fundAccount(w, w.alice);
		const hash = commitmentHashFor(
			deploymentAt(spawn(0, 0)),
			SECRET_A,
			w.actionsPerReveal,
		);
		await expect(
			w.env.execute(w.Game, {
				account: w.alice,
				functionName: 'makeCommitment',
				args: [armyIdOf(w.alice, 2), hash, w.stake, zeroAddress],
				gas: 1_000_000n,
			}),
		).toBeRejectedWith(`custom error 'InvalidPlayer(`);
		// A stranger cannot spend Alice's reserve on an army of hers.
		await expect(
			w.env.execute(w.Game, {
				account: w.bob,
				functionName: 'makeCommitment',
				args: [armyIdOf(w.alice, 1), hash, w.stake, zeroAddress],
			}),
		).toBeRejected();
		expect(await w.reserve(idOf(w.alice))).toEqual(w.stake);
	});

	it('keeps the spawn point hidden until the reveal, and places the army only once the cycle is over', async function () {
		const w = await world();
		const army = await w.deploy(w.alice, spawn(0, 0));
		const rect = LAYOUT.rect(0, 0);

		let view = await w.army(army);
		expect(view.status).toEqual(STATUS.Deploying);
		expect(view.owner.toLowerCase()).toEqual(w.alice.toLowerCase());
		expect(view.spawnPoint).toEqual(0n);
		expect(view.stake).toEqual(w.stake);
		expect(await w.pieces(rect.minX, rect.minY, rect.maxX, rect.maxY)).toEqual(
			[],
		);

		await w.toRevealPhase();
		await w.reveal(w.alice, army, spawn(0, 0));
		// Revealed, and still not on the board: other deployments of this cycle
		// may yet reveal the same spawn point.
		view = await w.army(army);
		expect(view.status).toEqual(STATUS.Deploying);
		expect(await w.pieces(rect.minX, rect.minY, rect.maxX, rect.maxY)).toEqual(
			[],
		);

		await w.toNextCycle();
		view = await w.army(army);
		expect(view.status).toEqual(STATUS.Deployed);
		expect(xyOf(view.king)).toEqual({x: 0, y: 0});
		expectLayout(
			await w.pieces(rect.minX, rect.minY, rect.maxX, rect.maxY),
			{x: 0, y: 0},
			army,
		);
	});

	it('lays every army out the same, on its spawn point, with exactly 4 empty squares to its neighbours', async function () {
		const w = await world();
		const deployments = [
			{owner: w.alice, at: {i: 1, j: 0}},
			{owner: w.bob, at: {i: 0, j: 0}},
			{owner: w.carol, at: {i: 0, j: -1}},
			{owner: w.unnamedAccounts[3] as `0x${string}`, at: {i: 1, j: 1}},
		] as const;
		const armies: bigint[] = [];
		for (const d of deployments) {
			armies.push(await w.deploy(d.owner, spawn(d.at.i, d.at.j)));
		}
		await w.toRevealPhase();
		for (let k = 0; k < deployments.length; k++) {
			const d = deployments[k];
			await w.reveal(d.owner, armies[k], spawn(d.at.i, d.at.j));
		}
		await w.toNextCycle();

		for (let k = 0; k < deployments.length; k++) {
			const d = deployments[k];
			const sp = {x: d.at.i * S, y: d.at.j * S};
			const rect = LAYOUT.rect(sp.x, sp.y);
			expectLayout(
				await w.pieces(rect.minX, rect.minY, rect.maxX, rect.maxY),
				sp,
				armies[k],
			);
		}

		// Side by side (bob at (0,0), alice at (9,0)) and one above the other
		// (bob above carol at (0,-9)): x 3..6 and y -3..-6 are empty, four
		// squares on each axis, and the next column or row is an army's edge
		// (three pawns each side).
		expect(await w.pieces(3, -2, 6, 2)).toEqual([]);
		expect((await w.pieces(2, -2, 7, 2)).length).toEqual(6);
		expect(await w.pieces(-2, -6, 2, -3)).toEqual([]);
		expect((await w.pieces(-2, -7, 2, -2)).length).toEqual(6);
	});

	it('lays the same layout in every quadrant, by the rule the board uses', async function () {
		// The simulation route runs the same pure layout the board is resolved
		// with, so every quadrant is checked without deploying sixteen armies.
		const w = await world();
		const cases: [number, number][] = [
			[0, 0],
			[1, 2],
			[2, 1],
			[-1, 2],
			[-2, 1],
			[-1, -2],
			[-2, -1],
			[1, -2],
			[2, -1],
			[1, 1],
			[-1, -1],
			[3, 0],
			[0, -3],
		];
		const army = armyIdOf(w.alice, 1);
		for (const [i, j] of cases) {
			const pieces = (await w.env.read(w.Game, {
				functionName: 'previewDeployment',
				args: [spawn(i, j), army],
			})) as Piece[];
			expectLayout(pieces, {x: i * S, y: j * S}, army);
		}
		await expect(
			w.env.read(w.Game, {
				functionName: 'previewDeployment',
				args: [squareAt(3, 0), army],
			}),
		).toBeRejectedWith(/NotASpawnPoint/);
	});

	it('opens the K free spawn points nearest the origin, in spiral order, and advances as they are used', async function () {
		const w = await world();
		const first = [
			{x: 0, y: 0},
			{x: 9, y: 0},
			{x: 9, y: 9},
			{x: 0, y: 9},
			{x: -9, y: 9},
			{x: -9, y: 0},
			{x: -9, y: -9},
			{x: 0, y: -9},
		];
		expect(await w.open()).toEqual(first);

		const a = await w.deploy(w.alice, spawn(1, 1));
		const b = await w.deploy(w.bob, spawn(0, 0));
		await w.toRevealPhase();
		await w.reveal(w.alice, a, spawn(1, 1));
		await w.reveal(w.bob, b, spawn(0, 0));
		// Still the set the cycle started with: the reveals land at its end.
		expect(await w.open()).toEqual(first);

		await w.toNextCycle();
		expect(await w.open()).toEqual([
			{x: 9, y: 0},
			{x: 0, y: 9},
			{x: -9, y: 9},
			{x: -9, y: 0},
			{x: -9, y: -9},
			{x: 0, y: -9},
			{x: 9, y: -9},
			{x: 18, y: -9},
		]);
	});

	it('checks a reveal against the open set as it stood at the START of the cycle', async function () {
		const w = await world();
		// Spiral index 8, (9,-9): not open in this cycle, and it WILL be open
		// in the next, once the deployment below has landed.
		const a = await w.deploy(w.alice, spawn(0, 0));
		const b = await w.deploy(w.bob, spawn(1, -1), SECRET_B);
		await w.toRevealPhase();
		await w.reveal(w.alice, a, spawn(0, 0));
		await expect(w.reveal(w.bob, b, spawn(1, -1), SECRET_B)).toBeRejectedWith(
			/SpawnPointNotOpen/,
		);

		await w.toNextCycle();
		// And a spawn point used in an earlier cycle is never open again.
		const c = await w.deploy(w.carol, spawn(0, 0));
		await w.toRevealPhase();
		await expect(w.reveal(w.carol, c, spawn(0, 0))).toBeRejectedWith(
			/SpawnPointNotOpen/,
		);
	});

	it('refuses a deployment that is not one move from and to a spawn point', async function () {
		const w = await world();
		const army = armyIdOf(w.alice, 1);
		const bad: [Move[], RegExp][] = [
			[[{from: squareAt(0, 0), to: squareAt(9, 0)}], /InvalidDeployment/],
			[[], /InvalidDeployment/],
			// A DEPLOYMENT IS THE WHOLE MOVE OF ITS CYCLE, though a move may hold
			// three piece-moves and the chunk is three (`docs/adr/0016`): a
			// piece-move beside it, in the same chunk, is refused.
			[
				[
					...deploymentAt(squareAt(0, 0)),
					{from: squareAt(-1, 2), to: squareAt(-1, 3)},
				],
				/InvalidDeployment/,
			],
			[deploymentAt(squareAt(1, 0)), /NotASpawnPoint/],
		];
		for (const [moves, error] of bad) {
			const snapshot = await networkHelpers.takeSnapshot();
			await fundAccount(w, w.alice);
			await w.env.execute(w.Game, {
				account: w.alice,
				functionName: 'makeCommitment',
				args: [
					army,
					commitmentHashFor(moves, SECRET_A, w.actionsPerReveal),
					w.stake,
					zeroAddress,
				],
			});
			await w.toRevealPhase();
			// Through either entry point: `reveal` forwards a deployment to
			// `revealDeployment`, on a route of its own.
			await expect(
				revealTurn(w, {
					account: w.alice,
					identity: army,
					moves,
					secret: SECRET_A,
					actionsPerReveal: w.actionsPerReveal,
				}),
			).toBeRejectedWith(error);
			await expect(
				revealTurn(w, {
					account: w.alice,
					identity: army,
					moves,
					secret: SECRET_A,
					actionsPerReveal: w.actionsPerReveal,
					deployment: true,
				}),
			).toBeRejectedWith(error);
			await snapshot.restore();
		}
	});

	it('lets a deployed army pass, and move once it stands on the board', async function () {
		const w = await world();
		const army = await w.deploy(w.alice, spawn(0, 0));
		await w.toRevealPhase();
		await w.reveal(w.alice, army, spawn(0, 0));
		await w.toNextCycle();

		for (const moves of [[], [{from: squareAt(-2, 1), to: squareAt(-2, 2)}]]) {
			await w.env.execute(w.Game, {
				account: w.alice,
				functionName: 'makeCommitment',
				args: [
					army,
					commitmentHashFor(moves, SECRET_A, w.actionsPerReveal),
					0n,
					zeroAddress,
				],
			});
			await w.toRevealPhase();
			const reveal = revealTurn(w, {
				account: w.alice,
				identity: army,
				moves,
				secret: SECRET_A,
				actionsPerReveal: w.actionsPerReveal,
			});
			await reveal;
			await w.toNextCycle();
		}
	});

	it('pages the army registry, resolved', async function () {
		const w = await world();
		const owners = [w.alice, w.bob, w.carol];
		const armies: bigint[] = [];
		for (let k = 0; k < owners.length; k++) {
			armies.push(await w.deploy(owners[k], spawn(k, 0)));
		}
		await w.toRevealPhase();
		// Carol never reveals.
		await w.reveal(w.alice, armies[0], spawn(0, 0));
		await w.reveal(w.bob, armies[1], spawn(1, 0));
		await w.toNextCycle();

		const [page1, total] = await w.armies(0, 2);
		const [page2] = await w.armies(2, 2);
		const [beyond] = await w.armies(5, 2);
		expect(total).toEqual(3n);
		expect(beyond).toEqual([]);
		const all = [...page1, ...page2];
		expect(all.map((a) => a.id)).toEqual(armies);
		expect(all.map((a) => a.owner.toLowerCase())).toEqual(
			owners.map((o) => o.toLowerCase()),
		);
		expect(all.map((a) => a.status)).toEqual([
			STATUS.Deployed,
			STATUS.Deployed,
			STATUS.Unrevealed,
		]);
		expect(all.map((a) => a.stake)).toEqual([w.stake, w.stake, w.stake]);
		expect(xyOf(all[0].king)).toEqual(LAYOUT.king(0, 0));
		expect(xyOf(all[1].king)).toEqual(LAYOUT.king(9, 0));
		expect(all[1].spawnPoint).toEqual(spawn(1, 0));

		const ofAlice = (await w.env.read(w.Game, {
			functionName: 'getArmiesOf',
			args: [w.alice],
		})) as ArmyView[];
		expect(ofAlice).toEqual([all[0]]);
	});

	it('fails both deployments revealing one spawn point, by count and never by order', async function () {
		for (const order of [
			[0, 1],
			[1, 0],
		]) {
			const w = await world();
			const owners = [w.alice, w.bob];
			const secrets = [SECRET_A, SECRET_B] as const;
			const armies: bigint[] = [];
			for (let k = 0; k < 2; k++) {
				armies.push(await w.deploy(owners[k], spawn(0, 0), secrets[k]));
			}
			await w.toRevealPhase();
			for (const k of order) {
				await w.reveal(owners[k], armies[k], spawn(0, 0), secrets[k]);
			}
			await w.toNextCycle();

			for (const army of armies) {
				expect((await w.army(army)).status).toEqual(STATUS.Failed);
			}
			const rect = LAYOUT.rect(0, 0);
			expect(
				await w.pieces(rect.minX, rect.minY, rect.maxX, rect.maxY),
			).toEqual([]);
			// A failed spawn point is free, so it is still open.
			expect((await w.open())[0]).toEqual({x: 0, y: 0});

			// And the next deployment there lands, while the failed ones stay
			// failed.
			const carol = await w.deploy(w.carol, spawn(0, 0));
			await w.toRevealPhase();
			await w.reveal(w.carol, carol, spawn(0, 0));
			await w.toNextCycle();
			expect((await w.army(carol)).status).toEqual(STATUS.Deployed);
			for (const army of armies) {
				expect((await w.army(army)).status).toEqual(STATUS.Failed);
			}
		}
	});

	it('reaches the same board and registry whichever order the deployments reveal in', async function () {
		// THE COMMIT-REVEAL RULE (AGENTS.md): the same commitments, revealed in
		// two orders, must give the same board, ownership and stakes. The two
		// spawn points share a reveal phase and the first reveal of a cycle is
		// the one that writes the open set, so the order changes which pays for
		// it and nothing anyone gets.
		const outcomes: unknown[] = [];
		for (const order of [
			[0, 1, 2],
			[2, 1, 0],
			[1, 2, 0],
		]) {
			const w = await world();
			const owners = [w.alice, w.bob, w.carol];
			const at = [spawn(0, 0), spawn(1, 1), spawn(0, 0)];
			const secrets = [SECRET_A, SECRET_B, SECRET_A] as const;
			const armies: bigint[] = [];
			for (let k = 0; k < 3; k++) {
				// Carol's deployment collides with Alice's: both must fail.
				armies.push(await w.deploy(owners[k], at[k], secrets[k]));
			}
			await w.toRevealPhase();
			for (const k of order) {
				await w.reveal(owners[k], armies[k], at[k], secrets[k]);
			}
			await w.toNextCycle();

			const [registry] = await w.armies(0, 10);
			// Each run starts at whatever cycle the clock is in, so the cycle a
			// deployment was committed in is compared relative to the run.
			for (const army of registry) {
				expect(army.deployedIn).toEqual(BigInt(w.cycle() - 1));
			}
			outcomes.push({
				board: await w.pieces(-40, -40, 40, 40),
				registry: registry.map(({deployedIn: _, ...rest}) => rest),
				open: await w.open(),
				reserves: await Promise.all(armies.map((a) => w.reserve(a))),
			});
		}
		expect(outcomes[1]).toEqual(outcomes[0]);
		expect(outcomes[2]).toEqual(outcomes[0]);
		const first = outcomes[0] as {board: Piece[]; registry: ArmyView[]};
		expect(first.board.length).toEqual(20);
		expect(first.registry.map((a) => a.status)).toEqual([
			STATUS.Failed,
			STATUS.Deployed,
			STATUS.Failed,
		]);
	});

	it('reads only the area asked for', async function () {
		const w = await world();
		const a = await w.deploy(w.alice, spawn(0, 0));
		const b = await w.deploy(w.bob, spawn(-1, 0));
		await w.toRevealPhase();
		await w.reveal(w.alice, a, spawn(0, 0));
		await w.reveal(w.bob, b, spawn(-1, 0));
		await w.toNextCycle();

		const both = await w.pieces(-40, -40, 40, 40);
		expect(both.length).toEqual(40);
		// The middle of Alice's army only: x from -1 to 1, y from -1 to 0.
		const middle = await w.pieces(-1, -1, 1, 0);
		expect(picture(middle, {minX: -1, minY: -1, maxX: 1, maxY: 0})).toEqual([
			'Q K .',
			'B N R',
		]);
		expect(middle.every((p) => p.army === a)).toEqual(true);
		// An empty area is empty, however far out.
		expect(await w.pieces(1000, 1000, 1100, 1100)).toEqual([]);
	});

	it('forfeits the stake of a deployment that is never revealed', async function () {
		const w = await world();
		const army = await w.deploy(w.alice, spawn(0, 0));
		await w.toRevealPhase();
		await w.toNextCycle();
		expect((await w.army(army)).status).toEqual(STATUS.Unrevealed);

		// Settled by anyone, shown the deployment: the whole stake goes.
		const {chunks} = commitmentChain(
			deploymentAt(spawn(0, 0)),
			SECRET_A,
			w.actionsPerReveal,
		);
		await w.env.execute(w.Game, {
			account: w.bob,
			functionName: 'acknowledgeMissedReveal',
			args: [army, chunks[0].moves, SECRET_A, chunks[0].furtherActions],
		});
		expect(await w.reserve(army)).toEqual(0n);
	});
});

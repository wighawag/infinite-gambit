import {zeroAddress} from 'viem';
import {
	setupFixtures,
	deployGameWith,
	cycleClock,
	fundAccount,
	commitDeployment,
	revealDeployment,
	commitmentHashFor,
	revealTurn,
	squareAt,
	xyOf,
	CYCLE_POLICY,
	TURN_BOND,
	type Move,
} from './index.js';

/**
 * THE TIGHT-GRID WORLD the move suites play in: a game on the tightest spawn
 * grid (spacing 6), so that armies stand next to each other and meet in a
 * cycle, with helpers to deploy, commit, reveal in a chosen order and read the
 * resolved board. Shared by `Moves.test.ts` and `Collisions.test.ts`.
 *
 *   alice, spawn (0,0), facing North        bob, spawn (6,0), facing East
 *
 *   y= 1  . P P P P .     x = -3 .. 2      x = 4: pawns facing West, y 1..-2
 *   y= 0  P K B N R P                      x = 5: P R N B Q P, y 2..-3
 *   y=-1  P R N B Q P                      x = 6: P K B N R P, y 2..-3
 *   y=-2  . P P P P .                      x = 7: pawns facing East, y 1..-2
 *
 *   carol, spawn (0,6), facing North: alice's picture moved up 6.
 */

const COMMIT_PHASE = 60n;
const REVEAL_PHASE = 30n;
const clock = cycleClock({
	startTime: 0,
	commitPhaseDuration: Number(COMMIT_PHASE),
	revealPhaseDuration: Number(REVEAL_PHASE),
});

export const SECRET =
	'0x00000000000000000000000000000000000000000000000000000000000c0de1';

export const KIND = ['.', 'P', 'N', 'B', 'R', 'Q', 'K'] as const;
const DIRECTION = ['N', 'E', 'S', 'W'] as const;

export type Piece = {
	position: bigint;
	army: bigint;
	kind: number;
	forward: number;
	moved: boolean;
};

export const at = (x: number, y: number) => squareAt(x, y);
export const move = (from: [number, number], to: [number, number]): Move => ({
	from: at(...from),
	to: at(...to),
});

/** A piece as one comparable line: kind, square, army, forward, moved. */
export function describePiece(piece: Piece): string {
	const {x, y} = xyOf(piece.position);
	return `${KIND[piece.kind]}@${x},${y}#${piece.army}:${DIRECTION[piece.forward]}${piece.moved ? '*' : ''}`;
}

type Fixtures = ReturnType<typeof setupFixtures>;

/**
 * The tight-grid game for a suite, given that suite's network connection.
 * Returns `world()`, which loads a fresh copy of the game (one shared fixture,
 * so every call after the first is a snapshot revert) at the top of a commit
 * phase, with helpers.
 */
export function movesWorld(params: {
	deployAll: Fixtures['deployAll'];
	loadFixture: <T>(fixture: () => Promise<T>) => Promise<T>;
	/**
	 * The OFFLINE world: a manual cycle policy, where a phase ends when
	 * somebody calls `advanceCycle` and everyone it waits for has acted.
	 */
	manual?: boolean;
}) {
	const {deployAll, loadFixture, manual = false} = params;

	async function deployMovesWorld() {
		const f = await deployAll();
		const Game = await deployGameWith(f, {
			name: manual ? 'Game_moves_manual' : 'Game_moves',
			cyclePolicy: manual ? CYCLE_POLICY.Manual : CYCLE_POLICY.Timed,
			commitPhaseDuration: manual ? 0n : COMMIT_PHASE,
			revealPhaseDuration: manual ? 0n : REVEAL_PHASE,
			spawnSpacing: 6n,
		});
		return {...f, Game};
	}

	return world;

	/** The tight-grid game, at the top of a commit phase, with helpers. */
	async function world() {
		const f = await loadFixture(deployMovesWorld);
		let cycle = clock.getCycleNumber(await f.getTimestamp()).cycleNumber + 1;
		if (!manual) await f.advanceToTime(clock.cycleStartTime(cycle), true);
		const [alice, bob, carol, dave] = f.unnamedAccounts as `0x${string}`[];
		const actionsPerReveal = 1;

		const w = {
			...f,
			alice,
			bob,
			carol,
			dave,
			cycle: () => cycle,
			/** End the phase, in the offline world: anyone may call it. */
			async advance() {
				await f.env.execute(f.Game, {
					account: alice,
					functionName: 'advanceCycle',
					args: [],
				});
			},
			async toRevealPhase() {
				if (manual) return w.advance();
				await f.advanceToTime(clock.revealStartTime(cycle), true);
			},
			async toNextCycle() {
				cycle += 1;
				if (manual) return w.advance();
				await f.advanceToTime(clock.cycleStartTime(cycle), true);
			},
			/** Commit deployments for `owners` at their spawn points, in one cycle. */
			async commitDeployments(
				deployments: readonly [`0x${string}`, [number, number]][],
			): Promise<bigint[]> {
				const armies: bigint[] = [];
				for (const [owner, [i, j]] of deployments) {
					await fundAccount(f, owner);
					const {army} = await commitDeployment(f, {
						owner,
						spawnPoint: at(i * 6, j * 6),
						secret: SECRET,
						actionsPerReveal,
					});
					armies.push(army);
				}
				return armies;
			},
			revealDeployment(
				owner: `0x${string}`,
				army: bigint,
				[i, j]: [number, number],
			) {
				return revealDeployment(f, {
					account: owner,
					army,
					spawnPoint: at(i * 6, j * 6),
					secret: SECRET,
					actionsPerReveal,
				});
			},
			/** Deploy armies in one cycle and move on to the cycle they act in. */
			async deploy(
				deployments: readonly [`0x${string}`, [number, number]][],
			): Promise<bigint[]> {
				const armies = await w.commitDeployments(deployments);
				await w.toRevealPhase();
				for (let k = 0; k < deployments.length; k++) {
					await w.revealDeployment(
						deployments[k][0],
						armies[k],
						deployments[k][1],
					);
				}
				await w.toNextCycle();
				return armies;
			},
			async commit(owner: `0x${string}`, army: bigint, moves: readonly Move[]) {
				await f.env.execute(f.Game, {
					account: owner,
					functionName: 'makeCommitment',
					args: [
						army,
						commitmentHashFor(moves, SECRET, actionsPerReveal),
						TURN_BOND,
						zeroAddress,
					],
				});
			},
			reveal(owner: `0x${string}`, army: bigint, moves: readonly Move[]) {
				return revealTurn(f, {
					account: owner,
					identity: army,
					moves,
					secret: SECRET,
					actionsPerReveal,
				});
			},
			/**
			 * Play one cycle: commit every submission, reveal them in the order
			 * given (or reversed), and move on to the next cycle.
			 */
			async play(
				submissions: readonly {
					owner: `0x${string}`;
					army: bigint;
					moves: readonly Move[];
				}[],
				order: 'forward' | 'reverse' = 'forward',
			) {
				for (const s of submissions) await w.commit(s.owner, s.army, s.moves);
				await w.toRevealPhase();
				const reveals =
					order === 'forward' ? submissions : [...submissions].reverse();
				for (const s of reveals) await w.reveal(s.owner, s.army, s.moves);
				await w.toNextCycle();
			},
			/** The board around the armies, as sorted lines. */
			async board(): Promise<string[]> {
				const [pieces] = (await f.env.read(f.Game, {
					functionName: 'getPieces',
					args: [-12, -12, 18, 18],
				})) as [Piece[], bigint];
				return pieces.map(describePiece).sort();
			},
			async pieces(): Promise<Piece[]> {
				const [pieces] = (await f.env.read(f.Game, {
					functionName: 'getPieces',
					args: [-12, -12, 18, 18],
				})) as [Piece[], bigint];
				return [...pieces];
			},
			async pieceAt(x: number, y: number): Promise<string | undefined> {
				const [pieces] = (await f.env.read(f.Game, {
					functionName: 'getPieces',
					args: [x, y, x, y],
				})) as [Piece[], bigint];
				return pieces.length === 0 ? undefined : describePiece(pieces[0]);
			},
			async registry() {
				const [armies] = (await f.env.read(f.Game, {
					functionName: 'getArmies',
					args: [0n, 10n],
				})) as readonly [
					readonly {
						id: bigint;
						owner: `0x${string}`;
						status: number;
						king: bigint;
						stake: bigint;
						mergedInto: bigint;
					}[],
					bigint,
				];
				return armies.map((a) => ({
					id: a.id,
					owner: a.owner.toLowerCase(),
					status: a.status,
					king: xyOf(a.king),
					stake: a.stake,
					mergedInto: a.mergedInto,
				}));
			},
			async legalMoves(from: [number, number]): Promise<string[]> {
				const pieces = await w.pieces();
				const destinations = (await f.env.read(f.Game, {
					functionName: 'legalMoves',
					args: [pieces, at(...from)],
				})) as bigint[];
				return destinations
					.map((d) => {
						const {x, y} = xyOf(d);
						return `${x},${y}`;
					})
					.sort();
			},
			/**
			 * What the last closed cycle did on the squares around the armies
			 * (`getOutcomes`), one sorted line per square: where, how many arriving
			 * pieces died there, the piece captured there (`-` for none) and what
			 * stands there now (`-` for nothing).
			 */
			async outcomes(): Promise<{cycle: number; lines: string[]}> {
				const [outcomes, cycleNumber] = (await f.env.read(f.Game, {
					functionName: 'getOutcomes',
					args: [-12, -12, 18, 18],
				})) as [
					readonly {
						position: bigint;
						died: number;
						captured: Piece;
						piece: Piece;
					}[],
					bigint,
				];
				return {
					cycle: Number(cycleNumber),
					lines: outcomes
						.map((o) => {
							const {x, y} = xyOf(o.position);
							const captured =
								o.captured.kind === 0 ? '-' : describePiece(o.captured);
							const piece = o.piece.kind === 0 ? '-' : describePiece(o.piece);
							return `${x},${y} died=${o.died} captured=${captured} now=${piece}`;
						})
						.sort(),
				};
			},
		};
		return w;
	}
}

import {parseEventLogs, zeroAddress, type Abi} from 'viem';
import {artifacts} from '../../../rocketh/environment.js';
import {
	setupFixtures,
	commitmentHashFor,
	revealTurn,
	squareAt,
	xyOf,
	CYCLE_POLICY,
	DEFAULT_ACTIONS_PER_REVEAL,
	DEFAULT_STAKE,
	TURN_BOND,
	type Move,
} from './index.js';
import {SECRET, describePiece, type Piece} from './moves-world.js';

/**
 * TABLES ON THE TIGHTEST GRID: a lobby implementation built like
 * `deploy/030_deploy_lobby.ts`'s (the world's routes plus the base's
 * `CommitRevealLobby`, `TimedWithEarlyAdvance`), but with the spawn spacing at
 * 6, the move suites' grid, so a table's seats stand where
 * `utils/moves-world.ts`'s armies do and meet in a cycle:
 *
 *   seat 0 at (0,0), seat 1 at (6,0), seat 2 at (6,6), seat 3 at (0,6),
 *   each army the one layout centred on its spawn point.
 *
 * The spacing is the table's parameter; the deployed tables use 9.
 */

const COMMIT_PHASE = 60n;
const REVEAL_PHASE = 30n;

type Fixtures = ReturnType<typeof setupFixtures>;

export function tableWorld(params: {
	deployAll: Fixtures['deployAll'];
	loadFixture: <T>(fixture: () => Promise<T>) => Promise<T>;
}) {
	const {deployAll, loadFixture} = params;

	async function deployTables() {
		const f = await deployAll();
		const config = {
			startTime: 0n,
			commitPhaseDuration: COMMIT_PHASE,
			revealPhaseDuration: REVEAL_PHASE,
			time: zeroAddress,
			tokens: f.GameToken.address,
			stake: DEFAULT_STAKE,
			spawnSpacing: 6n,
			openSpawnPoints: 8n,
			actionsPerReveal: DEFAULT_ACTIONS_PER_REVEAL,
			cyclePolicy: BigInt(CYCLE_POLICY.TimedWithEarlyAdvance),
		};
		const route = (name: string, artifact: unknown) => ({
			name,
			artifact,
			args: [config],
		});
		const implementation = await f.env.deployViaRouter(
			'TestTableImplementation',
			{account: f.env.namedAccounts.deployer},
			[
				route('Getters', artifacts.GameGetters),
				route('Registry', artifacts.GameRegistry),
				route('Commit', artifacts.GameCommit),
				route('Table', artifacts.GameTable),
				route('Reveal', artifacts.GameReveal),
				route('DeploymentReveal', artifacts.GameDeploymentReveal),
				route('Exit', artifacts.GameExit),
				route('Simulation', artifacts.GameSimulation),
				{name: 'Delegation', artifact: artifacts.GameDelegation, args: []},
				{
					name: 'Lobby',
					artifact: artifacts.CommitRevealLobby,
					args: [
						{
							startTime: config.startTime,
							commitPhaseDuration: config.commitPhaseDuration,
							revealPhaseDuration: config.revealPhaseDuration,
							time: config.time,
							actionsPerReveal: config.actionsPerReveal,
							cyclePolicy: config.cyclePolicy,
						},
					],
				},
			] as never,
		);
		const Factory = await f.env.deploy('TestTableFactory', {
			account: f.env.namedAccounts.deployer,
			artifact: artifacts.CommitRevealGameFactory,
			args: [implementation.address],
		} as never);
		return {...f, Implementation: implementation, Factory};
	}

	return world;

	async function world() {
		const f = await loadFixture(deployTables);
		const [alice, bob, carol, dave] = f.unnamedAccounts as `0x${string}`[];
		const {price} = f.StakeSale.linkedData as {price: string};

		/** Create a table of `seats` seats playing `cycles` cycles, by alice. */
		async function create(seats: number, cycles = 100) {
			const receipt = await f.env.execute(
				f.Factory as never,
				{
					account: alice,
					functionName: 'createGame',
					args: [seats, cycles, `0x${'00'.repeat(32)}`],
				} as never,
			);
			const [created] = parseEventLogs({
				abi: (f.Factory as {abi: Abi}).abi,
				logs: (receipt as unknown as {logs: never}).logs,
				eventName: 'GameCreated',
			}) as unknown as {args: {game: `0x${string}`}}[];
			const Table = {
				address: created.args.game,
				abi: (f.Implementation as {abi: Abi}).abi,
			};
			return table(Table);
		}

		function table(Table: {address: `0x${string}`; abi: Abi}) {
			const read = <T>(functionName: string, args: unknown[] = []) =>
				f.env.read(Table as never, {functionName, args} as never) as Promise<T>;
			const execute = (
				account: `0x${string}`,
				functionName: string,
				args: unknown[] = [],
			) =>
				f.env.execute(Table as never, {account, functionName, args} as never);

			const t = {
				Table,
				read,
				execute,
				price: BigInt(price),
				/** Buy a seat for `owner` through the sale: returns its army. */
				async buy(owner: `0x${string}`, payer = owner): Promise<bigint> {
					const army = await read<bigint>('getNextArmy', [owner]);
					await f.env.execute(f.StakeSale, {
						account: payer,
						functionName: 'purchaseAt',
						args: [Table.address, owner, zeroAddress, 0n],
						value: BigInt(price),
					});
					return army;
				},
				start: () => execute(alice, 'start'),
				cycle: () =>
					read<{cycleNumber: bigint; commiting: boolean; phaseEnd: bigint}>(
						'getCycle',
					),
				attendance: () =>
					read<{waitedFor: bigint; committed: bigint; revealed: bigint}>(
						'getAttendance',
					),
				/** Move on to the next phase by the clock. */
				async byTheClock() {
					const {phaseEnd} = await t.cycle();
					await f.advanceToTime(Number(phaseEnd), true);
				},
				/** Move on to the next phase early, by unanimity. */
				advance: () => execute(carol, 'advanceCycle'),
				commit(owner: `0x${string}`, army: bigint, moves: readonly Move[]) {
					return execute(owner, 'makeCommitment', [
						army,
						commitmentHashFor(
							moves,
							SECRET,
							Number(DEFAULT_ACTIONS_PER_REVEAL),
						),
						TURN_BOND,
						zeroAddress,
					]);
				},
				reveal(owner: `0x${string}`, army: bigint, moves: readonly Move[]) {
					return revealTurn(
						{env: f.env, Game: Table},
						{
							account: owner,
							identity: army,
							moves,
							secret: SECRET,
							actionsPerReveal: Number(DEFAULT_ACTIONS_PER_REVEAL),
						},
					);
				},
				/**
				 * Play one cycle by the clock: commit every submission (a pass is
				 * an empty one), reveal them, and move on to the next cycle.
				 */
				async play(
					submissions: readonly {
						owner: `0x${string}`;
						army: bigint;
						moves: readonly Move[];
					}[],
				) {
					for (const s of submissions) await t.commit(s.owner, s.army, s.moves);
					await t.byTheClock();
					for (const s of submissions) await t.reveal(s.owner, s.army, s.moves);
					await t.byTheClock();
				},
				async pieces(): Promise<Piece[]> {
					const [pieces] = await read<[Piece[], bigint]>(
						'getPieces',
						[-12, -12, 18, 18],
					);
					return [...pieces];
				},
				async board(): Promise<string[]> {
					return (await t.pieces()).map(describePiece).sort();
				},
				async pieceAt(x: number, y: number): Promise<string | undefined> {
					const [pieces] = await read<[Piece[], bigint]>('getPieces', [
						x,
						y,
						x,
						y,
					]);
					return pieces.length === 0 ? undefined : describePiece(pieces[0]);
				},
				async army(id: bigint) {
					const army = await read<{
						owner: `0x${string}`;
						status: number;
						spawnPoint: bigint;
						king: bigint;
						stake: bigint;
					}>('getArmy', [id]);
					return {
						owner: army.owner.toLowerCase(),
						status: army.status,
						spawnPoint: xyOf(army.spawnPoint),
						king: xyOf(army.king),
						stake: army.stake,
					};
				},
				members: async () => (await read<[unknown, bigint[]]>('getRoster'))[1],
				outcome: () =>
					read<{
						over: boolean;
						settled: boolean;
						tallied: boolean;
						winner: bigint;
						pot: bigint;
						totalMaterial: bigint;
					}>('getTableOutcome'),
				share: async (army: bigint) =>
					(await read<[bigint, boolean]>('getTableShare', [army]))[0],
				claim: (army: bigint, sender: `0x${string}` = carol) =>
					execute(sender, 'claim', [army]),
				ethOf: async (account: `0x${string}`) =>
					BigInt(
						(await f.env.network.provider.request({
							method: 'eth_getBalance',
							params: [account, 'latest'],
						})) as string,
					),
				tokensOf: (account: `0x${string}`) =>
					f.env.read(f.GameToken, {
						functionName: 'balanceOf',
						args: [account],
					}) as Promise<bigint>,
			};
			return t;
		}

		return {...f, alice, bob, carol, dave, create, at: squareAt};
	}
}

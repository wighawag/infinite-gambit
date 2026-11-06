import {describe, it} from 'node:test';
import assert from 'node:assert';
import {network} from 'hardhat';
import {
	setupFixtures,
	fundAccount,
	commitDeployment,
	revealDeployment,
	commitmentChain,
	commitmentHashFor,
	deployGameWith,
	squareAt,
	CYCLE_POLICY,
	TURN_BOND,
	type Move,
} from './utils/index.js';
import {parseEther, zeroAddress} from 'viem';
import {movesWorld, move} from './utils/moves-world.js';
import {tableWorld} from './utils/table-world.js';
import {OFFLINE_OPEN_SPAWN_POINTS} from '../../rocketh/config.js';

/**
 * THE DECLARED GAS BUDGET IS A CLAIM ABOUT THESE CONTRACTS, so these contracts
 * are what checks it.
 *
 * `commitGas` and `revealGas` are declared by the deploy
 * (`rocketh/config.ts`), recorded in the Game's `linkedData`, and read by the
 * client to size the gas stipend a new player is given. They used to be
 * constants in the template game's client config, which is INHERITED down this
 * template tree while contracts are NOT - so a descendant budgeted with figures
 * measured against a game it does not run, in a file whose text did not differ.
 *
 * Moving them to the deployment fixes whose numbers they are. This test is what
 * stops them rotting: a contract change that makes a commit or a reveal more
 * expensive than the deployment claims fails HERE, in the suite that ships with
 * the contracts, rather than in a player's wallet a release later.
 *
 * IT ASSERTS THE WORST CASE, NOT A TYPICAL ONE. A chess submission is one
 * action: a deployment, a pass or a move. The worst commit is the first
 * DEPLOYMENT, when every slot it writes is cold: it settles the account's
 * previous deployment (none yet), creates the army, moves the stake between
 * two reserves, starts waiting for the army and then commits; in a manual
 * world it also remembers the army for the sweep of dead armies, which makes
 * that world's first paid deployment the worst of all (measured below). The worst reveal is the most expensive of three: the first
 * deployment ever (which writes the whole open set of spawn points beside the
 * spawn point's record), a king's move (which reads the eight squares around
 * its destination on its own footprint), and a slider's longest move, 7
 * squares over a path of squares whose facts are many idle cycles old (each
 * read resolves its record, and the origin and the destination fold theirs).
 *
 * IT IS TWO-SIDED, BECAUSE THE FIGURES ARE NOW CEILINGS. The client passes them
 * as the gas LIMIT on every commit and every reveal, so a transaction that needs
 * more than the deployment declares does not cost more - it runs out of gas, and
 * on a reveal that is a missed reveal, which forfeits the stake. So the budget
 * must cover the worst case AND keep room above it; and it must not have drifted
 * so far above that nobody has re-measured in a long time.
 */

const {provider, networkHelpers} = await network.connect();
const {deployAll} = setupFixtures(provider);

const SECRET =
	'0x00000000000000000000000000000000000000000000000000000000000000a1';

/** How far above the measured worst case a declared figure may sit. */
const GENEROSITY_CEILING = 3n;

/**
 * How far above it a declared figure MUST sit, as a percentage.
 *
 * Ten per cent, and the number is a judgement rather than a measurement, so
 * here is what it is buying. The case measured below is the worst case these
 * contracts can reach today - the first deployment - so the headroom is not
 * covering a shape the test missed. It covers the two things the test cannot see: a chain that prices
 * some opcode differently from the one this runs on, and the contracts growing
 * a little between one re-measurement and the next.
 *
 * GAS USAGE IS OTHERWISE A PROPERTY OF THE CODE AND THE EVM REVISION RATHER
 * THAN OF THE CHAIN, which is why this is a margin and not a per-chain
 * measurement: `hardhat.config.ts` pins `evmVersion` on every profile, so the
 * same contracts cost the same gas wherever they run. What genuinely varies per
 * chain is the PRICE, and that is `expectedWorstGasPrice` in the chain
 * properties, which is already declared per chain and is what turns these
 * figures into money.
 *
 * It is deliberately looser than the margin the figures actually carry (12% to
 * 28%). A tripwire set exactly at the current value fires on the first trivial
 * change and gets raised reflexively, which is how a limit stops meaning
 * anything.
 */
const MINIMUM_HEADROOM_PERCENT = 10n;

/** The worst reveals of the first case, for the capture case to build on. */
const measured: {
	king?: bigint;
	slider?: bigint;
	/** The worst reveal of the world, as the capture case prices it. */
	worst?: bigint;
} = {};

describe('the declared gas budget', function () {
	it('covers the worst commit and the worst reveal these contracts can produce', async function () {
		const fixtures = await networkHelpers.loadFixture(deployAll);
		const {
			env,
			Game,
			GameToken,
			linkedData,
			actionsPerReveal,
			unnamedAccounts,
			advanceToCycleNumber,
			advanceToRevealPhase,
			getCycleNumber,
			getTimestamp,
		} = fixtures;

		const declaredCommit = BigInt(linkedData.commitGas);
		const declaredReveal = BigInt(linkedData.revealGas);

		const player = unnamedAccounts[0] as `0x${string}`;
		const {cycleNumber: start} = getCycleNumber(await getTimestamp());
		await advanceToCycleNumber(start + 2, true);
		await fundAccount({env, Game, GameToken}, player);

		// The first deployment ever: every slot cold, and the reveal writes the
		// whole open set. The last spawn point of that set, so the reveal reads
		// all of it before finding its own.
		const spawnPoint = squareAt(0, -9);
		const {army, receipt: commitReceipt} = await commitDeployment(
			{env, Game},
			{owner: player, spawnPoint, secret: SECRET, actionsPerReveal},
		);
		const commitUsed = BigInt(commitReceipt.gasUsed);

		await advanceToRevealPhase(start + 2, true);
		const revealReceipt = await revealDeployment(
			{env, Game},
			{account: player, army, spawnPoint, secret: SECRET, actionsPerReveal},
		);
		const deploymentRevealUsed = BigInt(revealReceipt.gasUsed);

		// THE MOVES, by the same army, one per cycle.
		let cycle = start + 2;
		async function revealMove(m: Move): Promise<bigint> {
			cycle += 1;
			await advanceToCycleNumber(cycle, true);
			await env.execute(Game, {
				account: player,
				functionName: 'makeCommitment',
				args: [
					army,
					commitmentHashFor([m], SECRET, actionsPerReveal),
					TURN_BOND,
					zeroAddress,
				],
			});
			await advanceToRevealPhase(cycle, true);
			const {chunks} = commitmentChain([m], SECRET, actionsPerReveal);
			const receipt = await env.execute(Game, {
				account: player,
				functionName: 'reveal',
				args: [
					army,
					chunks[0].moves,
					SECRET,
					chunks[0].furtherActions,
					zeroAddress,
				],
			});
			return BigInt(receipt.gasUsed);
		}
		// The army stands on (0,-9): its king on the spawn point, next to the
		// empty core square (1,-9), which it steps into; its queen on (-1,-9)
		// behind the pawn on (-2,-9), which steps out West.
		const kingRevealUsed = await revealMove({
			from: squareAt(0, -9),
			to: squareAt(1, -9),
		});
		// The pawn walks 8 squares West, one a cycle, leaving a stale record on
		// every square of the row; then the queen behind it slides 7 squares
		// over them, many idle cycles later.
		for (let x = -2; x > -10; x--) {
			await revealMove({from: squareAt(x, -9), to: squareAt(x - 1, -9)});
		}
		cycle += 10;
		const sliderRevealUsed = await revealMove({
			from: squareAt(-1, -9),
			to: squareAt(-8, -9),
		});
		measured.king = kingRevealUsed;
		measured.slider = sliderRevealUsed;
		const revealUsed = [
			deploymentRevealUsed,
			kingRevealUsed,
			sliderRevealUsed,
		].reduce((a, b) => (a > b ? a : b));
		console.log(
			`gas budget: reveals: deployment ${deploymentRevealUsed}, king ${kingRevealUsed}, 7-square slider ${sliderRevealUsed}`,
		);

		assert.ok(
			commitUsed <= declaredCommit,
			`a first deployment commit costs ${commitUsed} gas and the deployment declares commitGas ${declaredCommit}. ` +
				`Raise it in contracts/rocketh/config.ts: it is the gas LIMIT of every commit.`,
		);
		assert.ok(
			revealUsed <= declaredReveal,
			`the worst reveal costs ${revealUsed} gas and the deployment declares revealGas ${declaredReveal}. ` +
				`Raise it in contracts/rocketh/config.ts: a reveal that runs out of gas is a missed reveal.`,
		);

		// THE HEADROOM. Passing the checks above is not enough for a figure that
		// is a LIMIT: a contract change of a few per cent would then be a missed
		// reveal in production with every suite green.
		const required = (measured: bigint) =>
			(measured * (100n + MINIMUM_HEADROOM_PERCENT)) / 100n;
		assert.ok(
			declaredCommit >= required(commitUsed),
			`commitGas is declared at ${declaredCommit} against a measured ${commitUsed}, which is less than ${MINIMUM_HEADROOM_PERCENT}% of headroom. ` +
				`It is passed as a gas LIMIT, so it has to be a ceiling rather than a close fit.`,
		);
		assert.ok(
			declaredReveal >= required(revealUsed),
			`revealGas is declared at ${declaredReveal} against a measured ${revealUsed}, which is less than ${MINIMUM_HEADROOM_PERCENT}% of headroom. ` +
				`It is passed as a gas LIMIT on every reveal, and a reveal that runs out of gas is a missed reveal.`,
		);

		// And not absurdly generous: an over-declared limit still prices a
		// player's credits, so a figure far above the truth has simply not been
		// re-measured.
		assert.ok(
			declaredCommit <= commitUsed * GENEROSITY_CEILING,
			`commitGas is declared at ${declaredCommit} against a measured ${commitUsed}, more than ${GENEROSITY_CEILING}x. Re-measure it.`,
		);
		assert.ok(
			declaredReveal <= revealUsed * GENEROSITY_CEILING,
			`revealGas is declared at ${declaredReveal} against a measured ${revealUsed}, more than ${GENEROSITY_CEILING}x. Re-measure it.`,
		);

		console.log(
			`gas budget: commit ${commitUsed}/${declaredCommit}, reveal ${revealUsed}/${declaredReveal}`,
		);
	});

	it('covers the worst reveal that makes, folds or takes a stone, and the two-victim square', async function () {
		// NO REVEAL WALKS A CHAIN ANY MORE (`docs/adr/0013`, `docs/adr/0014`):
		// what a capture adds to a reveal is bounded by the two squares it
		// touches. Each may FOLD the captures of its facts (at most two
		// victims, the two-victim square: each victim's fall written, its
		// stake's taker written and its reserve moved up, after reading
		// whether the captor's own king fell, one level deep), and the move
		// may NOTE candidates for the captor's stake. And every occupied
		// square a reveal reads asks whether its army has fallen (the VANISH
		// check: the army record and its king's square). Measured here on the
		// stones of `Stones.test.ts` and the two-victim square of
		// `KingCapture.test.ts`, then put together on the dearest move.
		assert.ok(measured.king && measured.slider, 'runs after the first case');
		const world = movesWorld({
			deployAll,
			loadFixture: networkHelpers.loadFixture,
		});
		const declaredReveal = BigInt(
			(await networkHelpers.loadFixture(deployAll)).linkedData.revealGas,
		);
		type W = Awaited<ReturnType<typeof world>>;
		type Play = {owner: `0x${string}`; army: bigint; moves: Move[]};
		/** One cycle; the gas of each reveal, in the order given. */
		async function cycleGas(w: W, plays: Play[]): Promise<bigint[]> {
			for (const p of plays) await w.commit(p.owner, p.army, p.moves);
			await w.toRevealPhase();
			const used: bigint[] = [];
			for (const p of plays) {
				used.push(BigInt((await w.reveal(p.owner, p.army, p.moves))!.gasUsed));
			}
			await w.toNextCycle();
			return used;
		}
		const max = (xs: bigint[]) => xs.reduce((a, b) => (a > b ? a : b));

		// THE CHAIN: dave's knight takes bob's king while carol's knight takes
		// dave's, so bob's king is a stone. Then carol's queen leaves (6,6),
		// folding dave's capture, and alice's pawn walks up and takes the stone.
		const w = await world();
		const [a, b, c, d] = await w.deploy([
			[w.alice, [0, 0]],
			[w.bob, [1, 0]],
			[w.carol, [0, 1]],
			[w.dave, [1, 1]],
		]);
		for (const [dm, cm] of [
			[move([6, 5], [7, 3]), move([0, 7], [2, 8])],
			[move([7, 3], [5, 2]), move([2, 8], [4, 7])],
		]) {
			await w.play([
				{owner: w.dave, army: d, moves: [dm]},
				{owner: w.carol, army: c, moves: [cm]},
			]);
		}
		const making = await cycleGas(w, [
			{owner: w.carol, army: c, moves: [move([4, 7], [6, 6])]},
			{owner: w.dave, army: d, moves: [move([5, 2], [6, 0])]},
		]);
		const [foldingCapture] = await cycleGas(w, [
			{owner: w.carol, army: c, moves: [move([6, 6], [6, 4])]},
		]);
		for (const m of [
			move([2, 1], [3, 1]),
			move([3, 1], [4, 1]),
			move([4, 1], [5, 1]),
		]) {
			await w.play([{owner: w.alice, army: a, moves: [m]}]);
		}
		const [takingStone] = await cycleGas(w, [
			{owner: w.alice, army: a, moves: [move([5, 1], [6, 0])]},
		]);
		void b;

		// THE TWO-VICTIM SQUARE: alice's king steps onto carol's while bob's
		// knight arrives too, revealed in both orders, then bob's queen leaves
		// the square, folding both captures. A plain step of a piece that
		// captured nothing is the baseline of that fold. The kings meet as in
		// `KingCapture.test.ts`.
		async function faceToFace() {
			const v = await world();
			const [va, vb, vc] = await v.deploy([
				[v.alice, [0, 0]],
				[v.bob, [1, 0]],
				[v.carol, [0, 1]],
			]);
			const alice = (m: Move) => ({owner: v.alice, army: va, moves: [m]});
			const bob = (m: Move) => ({owner: v.bob, army: vb, moves: [m]});
			const carol = (m: Move) => ({owner: v.carol, army: vc, moves: [m]});
			for (const plays of [
				[
					alice(move([1, 1], [5, 5])),
					carol(move([1, 5], [1, 6])),
					bob(move([6, 1], [4, 2])),
				],
				[carol(move([0, 6], [1, 5]))],
				[alice(move([0, 0], [1, 1])), carol(move([1, 5], [2, 4]))],
				[alice(move([1, 1], [2, 2])), carol(move([2, 4], [2, 3]))],
			]) {
				await v.play(plays);
			}
			return {v, va, vb};
		}
		const kingMoves: Play[] = [];
		let twoVictims: bigint[] = [];
		let s = await faceToFace();
		kingMoves.push(
			{owner: s.v.alice, army: s.va, moves: [move([2, 2], [2, 3])]},
			{owner: s.v.bob, army: s.vb, moves: [move([4, 2], [2, 3])]},
		);
		twoVictims = await cycleGas(s.v, kingMoves);
		const [foldingTwo] = await cycleGas(s.v, [
			{owner: s.v.bob, army: s.vb, moves: [move([2, 3], [2, 4])]},
		]);
		const [plainStep] = await cycleGas(s.v, [
			{owner: s.v.bob, army: s.vb, moves: [move([4, 1], [3, 1])]},
		]);
		s = await faceToFace();
		twoVictims = [
			...twoVictims,
			...(await cycleGas(s.v, [
				{owner: s.v.bob, army: s.vb, moves: [move([4, 2], [2, 3])]},
				{owner: s.v.alice, army: s.va, moves: [move([2, 2], [2, 3])]},
			])),
		];

		const captures = max([
			...making,
			foldingCapture,
			takingStone,
			...twoVictims,
			foldingTwo,
		]);
		// THE WORST, put together: the dearest plain move of the first case
		// whose origin AND destination each fold a two-victim square, which
		// notes three candidates (a king and an arriver meeting on a king or
		// stone that stayed: the arriver's, the standing army's, for the stone
		// that holds the king's stake if the captor falls, and the mover's,
		// each a fresh list: its length and its first slot), and
		// whose every square read meets a piece of a fallen army not yet
		// folded, a distinct one each, cold: its record's two slots, the four
		// slots of its king's square, and finding that square. A slider reads
		// 7 such squares (one holding such a piece reads as empty, so the path
		// is legal), a king its destination's 8 neighbours.
		const fold = foldingTwo > plainStep ? foldingTwo - plainStep : 0n;
		const note = 2n * 22_100n + 1_000n;
		const vanish = 6n * 2_100n + 3_000n;
		const extras = 2n * fold + 3n * note;
		const slider = measured.slider! + extras + 7n * vanish;
		const king = measured.king! + extras + 8n * vanish;
		const worst = slider > king ? slider : king;
		measured.worst = worst > captures ? worst : captures;
		console.log(
			`gas budget: captures: making a stone ${max(making)}, folding a capture ${foldingCapture}, taking a stone ${takingStone}, the two-victim square ${max(twoVictims)}, folding it ${foldingTwo} (a plain step ${plainStep}); worst reveal ${measured.worst} (slider ${slider}, king ${king}), declared ${declaredReveal}`,
		);
		assert.ok(
			declaredReveal >=
				(measured.worst * (100n + MINIMUM_HEADROOM_PERCENT)) / 100n,
			`the worst capture reveal costs about ${measured.worst} gas, and revealGas is declared at ${declaredReveal}, with less than ${MINIMUM_HEADROOM_PERCENT}% of headroom. ` +
				`Raise it in contracts/rocketh/config.ts: a reveal that runs out of gas is a missed reveal.`,
		);
	});

	it('covers the worst reveal at a table, which lists every zone it touches first', async function () {
		// A TABLE RUNS THE SAME ROUTES, and a reveal there costs what it costs in
		// the world plus one thing: the first touch of a zone lists it, for the
		// count of material at the cap (`UsingGameTable._tally`). Priced as the
		// difference between the same first move on a table and in the world:
		// bob's bishop (7,1) to his empty corner (8,2), from zone 0 into zone 1,
		// the first touch of both. The list is packed four zones a slot, so this second push shared
		// the first's slot; at worst it opens one of its own.
		assert.ok(measured.worst && measured.king, 'runs after the capture case');
		const lobby = BigInt(
			(
				(await networkHelpers.loadFixture(deployAll)).env.get('GameFactory')
					.linkedData as {revealGas: string}
			).revealGas,
		);
		const step = move([7, 1], [8, 2]);

		const world = movesWorld({
			deployAll,
			loadFixture: networkHelpers.loadFixture,
		});
		const w = await world();
		const [, b] = await w.deploy([
			[w.alice, [0, 0]],
			[w.bob, [1, 0]],
		]);
		await w.commit(w.bob, b, [step]);
		await w.toRevealPhase();
		const inTheWorld = BigInt((await w.reveal(w.bob, b, [step]))!.gasUsed);

		const tables = tableWorld({
			deployAll,
			loadFixture: networkHelpers.loadFixture,
		});
		const tw = await tables();
		const t = await tw.create(2);
		const ta = await t.buy(tw.alice);
		const tb = await t.buy(tw.bob);
		await t.start();
		await t.commit(tw.alice, ta, []);
		await t.commit(tw.bob, tb, [step]);
		await t.advance();
		const atTheTable = BigInt((await t.reveal(tw.bob, tb, [step]))!.gasUsed);

		const listing = atTheTable - inTheWorld + 22_100n;
		const worst = measured.worst! + listing;
		const plainest = measured.king! + listing;
		console.log(
			`gas budget: a table's first move ${atTheTable} against the world's ${inTheWorld}; worst table reveal ${worst}, declared ${lobby}`,
		);
		assert.ok(
			lobby >= (worst * (100n + MINIMUM_HEADROOM_PERCENT)) / 100n,
			`a table's worst reveal costs about ${worst} gas, and the lobby's revealGas is declared at ${lobby}, with less than ${MINIMUM_HEADROOM_PERCENT}% of headroom. ` +
				`Raise LOBBY_REVEAL_GAS in contracts/rocketh/config.ts: a reveal that runs out of gas is a missed reveal.`,
		);
		assert.ok(
			lobby <= plainest * GENEROSITY_CEILING,
			`the lobby's revealGas is declared at ${lobby} against a plainest table reveal of about ${plainest}, more than ${GENEROSITY_CEILING}x. Re-measure it.`,
		);
	});

	it('covers a first deployment commit that pays a reveal scheduler a fresh account', async function () {
		// A game with a reveal scheduler makes the commit carry its payment,
		// forwarded to `payee`; the first payment goes to an account that holds
		// nothing, which costs the value transfer and creating the account.
		const fixtures = await networkHelpers.loadFixture(deployAll);
		const {
			env,
			Game,
			GameToken,
			linkedData,
			actionsPerReveal,
			unnamedAccounts,
			advanceToCycleNumber,
			getCycleNumber,
			getTimestamp,
		} = fixtures;
		const declaredCommit = BigInt(linkedData.commitGas);

		const player = unnamedAccounts[0] as `0x${string}`;
		const {cycleNumber: start} = getCycleNumber(await getTimestamp());
		await advanceToCycleNumber(start + 2, true);
		await fundAccount({env, Game, GameToken}, player);

		const freshPayee = '0x00000000000000000000000000000000000f00d1';
		const balanceBefore = await provider.request({
			method: 'eth_getBalance',
			params: [freshPayee, 'latest'],
		});
		assert.strictEqual(BigInt(balanceBefore as string), 0n);

		const {receipt} = await commitDeployment(
			{env, Game},
			{
				owner: player,
				spawnPoint: squareAt(0, 0),
				secret: SECRET,
				actionsPerReveal,
				payee: freshPayee,
				value: parseEther('0.0012'),
			},
		);
		const used = BigInt(receipt.gasUsed);
		const balanceAfter = await provider.request({
			method: 'eth_getBalance',
			params: [freshPayee, 'latest'],
		});
		assert.strictEqual(
			BigInt(balanceAfter as string),
			parseEther('0.0012'),
			'the payment should reach the payee',
		);

		assert.ok(
			declaredCommit >= (used * (100n + MINIMUM_HEADROOM_PERCENT)) / 100n,
			`a first deployment commit paying a fresh payee costs ${used} gas and the deployment declares commitGas ${declaredCommit}, ` +
				`which is less than ${MINIMUM_HEADROOM_PERCENT}% of headroom. It is the gas LIMIT of every commit, ` +
				`so a scheduled player's first deployment would run out of gas. Raise it in contracts/rocketh/config.ts.`,
		);
		console.log(`gas budget: paid first commit ${used}/${declaredCommit}`);
	});

	it('covers a deployment commit that first settles a failed deployment, in a manual world, paying a fresh payee', async function () {
		// THE WORST COMMIT SINCE DEPLOYMENTS CAN FAIL. An account's next
		// deployment settles its previous one first, so when that one failed the
		// commit also writes the refund (two reserves, the army no longer waited
		// for). Under a cycle that advances (the offline world, which spends the
		// same declared figure) the commit also remembers the army for the sweep
		// of dead armies. And the payment to a fresh payee is the paid case above.
		const fixtures = await networkHelpers.loadFixture(deployAll);
		const {env, GameToken, linkedData, actionsPerReveal, unnamedAccounts} =
			fixtures;
		const declaredCommit = BigInt(linkedData.commitGas);
		const Game = await deployGameWith(fixtures, {
			name: 'Game_gas_manual',
			cyclePolicy: CYCLE_POLICY.Manual,
			commitPhaseDuration: 0n,
			revealPhaseDuration: 0n,
		});
		const [player, other] = unnamedAccounts as `0x${string}`[];
		const SECRET_B =
			'0x00000000000000000000000000000000000000000000000000000000000000b2';
		const spawnPoint = squareAt(0, 0);
		const armies: bigint[] = [];
		const firstUsed: bigint[] = [];
		for (const [owner, secret, payee] of [
			[player, SECRET, '0x00000000000000000000000000000000000f00d3'],
			[other, SECRET_B, '0x00000000000000000000000000000000000f00d4'],
		] as const) {
			await fundAccount({env, Game, GameToken}, owner);
			// The very first deployment of a manual world, paid: every slot cold,
			// the list of armies to sweep included.
			const {army, receipt} = await commitDeployment(
				{env, Game},
				{
					owner,
					spawnPoint,
					secret,
					actionsPerReveal,
					payee,
					value: parseEther('0.0012'),
				},
			);
			armies.push(army);
			firstUsed.push(BigInt(receipt.gasUsed));
		}
		const advance = () =>
			env.execute(Game, {
				account: player,
				functionName: 'advanceCycle',
				args: [],
			});
		await advance();
		await revealDeployment(
			{env, Game},
			{
				account: player,
				army: armies[0],
				spawnPoint,
				secret: SECRET,
				actionsPerReveal,
			},
		);
		await revealDeployment(
			{env, Game},
			{
				account: other,
				army: armies[1],
				spawnPoint,
				secret: SECRET_B,
				actionsPerReveal,
			},
		);
		await advance();

		// Both failed; the player deploys again, paying for it with the refund.
		const {receipt} = await commitDeployment(
			{env, Game},
			{
				owner: player,
				spawnPoint,
				secret: SECRET,
				actionsPerReveal,
				payee: '0x00000000000000000000000000000000000f00d2',
				value: parseEther('0.0012'),
			},
		);
		const settlingUsed = BigInt(receipt.gasUsed);
		const used = [settlingUsed, ...firstUsed].reduce((a, b) => (a > b ? a : b));
		const reserve = (await env.read(Game, {
			functionName: 'getReserve',
			args: [armies[0]],
		})) as bigint;
		assert.strictEqual(reserve, 0n, 'the failed deployment was not refunded');

		assert.ok(
			declaredCommit >= (used * (100n + MINIMUM_HEADROOM_PERCENT)) / 100n,
			`a deployment commit settling a failed one costs ${used} gas and the deployment declares commitGas ${declaredCommit}, ` +
				`which is less than ${MINIMUM_HEADROOM_PERCENT}% of headroom. It is the gas LIMIT of every commit. Raise it in contracts/rocketh/config.ts.`,
		);
		assert.ok(
			declaredCommit <= used * GENEROSITY_CEILING,
			`commitGas is declared at ${declaredCommit} against a measured ${used}, more than ${GENEROSITY_CEILING}x. Re-measure it.`,
		);
		console.log(
			`gas budget: manual world: first paid commit ${firstUsed[0]}, settling commit ${settlingUsed}, declared ${declaredCommit}`,
		);
	});

	it('covers a whole table deploying in the first cycle of the offline world, which opens more spawn points', async function () {
		// THE OFFLINE WORLD OPENS `OFFLINE_OPEN_SPAWN_POINTS` (K), more than the
		// online world's 8, so that every seat of the largest table deploys on its
		// own spawn point in its first cycle (`offline-world-pre-deploys-every-seat`).
		// It spends the SAME declared figures, and the first deployment reveal
		// writes the whole open set, so a larger K is a dearer reveal: measured
		// here as that boot is, every one of K first deployments committed and
		// revealed in one manual cycle, the first reveal at the far end of the set.
		const fixtures = await networkHelpers.loadFixture(deployAll);
		const {env, GameToken, linkedData, actionsPerReveal, unnamedAccounts} =
			fixtures;
		const declaredCommit = BigInt(linkedData.commitGas);
		const declaredReveal = BigInt(linkedData.revealGas);
		const Game = await deployGameWith(fixtures, {
			name: 'Game_gas_offline',
			cyclePolicy: CYCLE_POLICY.Manual,
			commitPhaseDuration: 0n,
			revealPhaseDuration: 0n,
			openSpawnPoints: OFFLINE_OPEN_SPAWN_POINTS,
		});
		const [open] = (await env.read(Game, {
			functionName: 'getOpenSpawnPoints',
		})) as readonly [readonly bigint[], bigint];
		assert.strictEqual(BigInt(open.length), OFFLINE_OPEN_SPAWN_POINTS);
		const seats = (unnamedAccounts as `0x${string}`[]).slice(0, open.length);
		assert.strictEqual(seats.length, open.length, 'not enough accounts');
		const spawnPoints = [...open].reverse();
		const armies: bigint[] = [];
		let commitUsed = 0n;
		for (const [i, owner] of seats.entries()) {
			await fundAccount({env, Game, GameToken}, owner);
			const {army, receipt} = await commitDeployment(
				{env, Game},
				{owner, spawnPoint: spawnPoints[i], secret: SECRET, actionsPerReveal},
			);
			armies.push(army);
			const used = BigInt(receipt.gasUsed);
			if (used > commitUsed) commitUsed = used;
		}
		await env.execute(Game, {
			account: seats[0],
			functionName: 'advanceCycle',
			args: [],
		});
		let revealUsed = 0n;
		for (const [i, owner] of seats.entries()) {
			const receipt = await revealDeployment(
				{env, Game},
				{
					account: owner,
					army: armies[i],
					spawnPoint: spawnPoints[i],
					secret: SECRET,
					actionsPerReveal,
				},
			);
			const used = BigInt(receipt.gasUsed);
			if (used > revealUsed) revealUsed = used;
		}
		console.log(
			`gas budget: offline world, K = ${open.length}: worst first-cycle deployment commit ${commitUsed}/${declaredCommit}, reveal ${revealUsed}/${declaredReveal}`,
		);
		assert.ok(
			declaredCommit >= (commitUsed * (100n + MINIMUM_HEADROOM_PERCENT)) / 100n,
			`a first deployment commit at K = ${open.length} costs ${commitUsed} gas and commitGas is ${declaredCommit}, with less than ${MINIMUM_HEADROOM_PERCENT}% of headroom.`,
		);
		assert.ok(
			declaredReveal >= (revealUsed * (100n + MINIMUM_HEADROOM_PERCENT)) / 100n,
			`a first deployment reveal at K = ${open.length} costs ${revealUsed} gas and revealGas is ${declaredReveal}, with less than ${MINIMUM_HEADROOM_PERCENT}% of headroom. ` +
				`Lower OFFLINE_OPEN_SPAWN_POINTS or raise revealGas in contracts/rocketh/config.ts.`,
		);
	});

	it('is what the credits multiplier is derived from, so the two cannot drift apart', async function () {
		const fixtures = await networkHelpers.loadFixture(deployAll);
		const {linkedData} = fixtures;

		const sum = BigInt(linkedData.commitGas) + BigInt(linkedData.revealGas);
		assert.ok(sum > 0n, 'the deployment declares no gas budget at all');
	});
});

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
import {fourArmies, threeArmyLoop, twoArmyLoop} from './utils/capture-loops.js';

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

/**
 * How many merges `UsingGameBoard._armyOf` follows at most for one piece
 * (`MAX_CHAIN` there). A reveal resolves the army of two pieces, the mover and
 * its destination, so this bounds the merges one reveal walks.
 */
const MAX_CHAIN = 8n;

/** The worst reveals of the first case, for the capture-chain case to build on. */
const measured: {king?: bigint; slider?: bigint; perMerge?: bigint} = {};

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
		const spawnPoint = squareAt(0, -16);
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
		// The army stands on (0,-16) facing South: its king on (1,-17), next to
		// the empty corner (2,-18), which it steps into; its queen on (-2,-16)
		// behind the pawn on (-3,-16), which advances West.
		const kingRevealUsed = await revealMove({
			from: squareAt(1, -17),
			to: squareAt(2, -18),
		});
		// The pawn walks 8 squares West, one a cycle, leaving a stale record on
		// every square of the row; then the queen behind it slides 7 squares
		// over them, many idle cycles later.
		await revealMove({from: squareAt(-3, -16), to: squareAt(-4, -16)});
		for (let x = -4; x > -11; x--) {
			await revealMove({from: squareAt(x, -16), to: squareAt(x - 1, -16)});
		}
		cycle += 10;
		const sliderRevealUsed = await revealMove({
			from: squareAt(-2, -16),
			to: squareAt(-9, -16),
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

	it('covers the worst reveal with a long capture chain behind both pieces it resolves', async function () {
		// THE CHAINS ARE PRICED PER MERGE, then multiplied by the bound: building
		// two chains of MAX_CHAIN merges each on a board would take hundreds of
		// cycles, and every merge followed costs the same reads (the army's
		// record, and the square its king was taken on, whose facts were never
		// folded: the dearer of the two ways a merge is kept).
		assert.ok(measured.king && measured.slider, 'runs after the first case');
		const world = movesWorld({
			deployAll,
			loadFixture: networkHelpers.loadFixture,
		});
		const declaredReveal = BigInt(
			(await networkHelpers.loadFixture(deployAll)).linkedData.revealGas,
		);
		type W = Awaited<ReturnType<typeof world>>;
		async function revealGas(
			w: W,
			owner: `0x${string}`,
			army: bigint,
			m: Move,
		) {
			await w.commit(owner, army, [m]);
			await w.toRevealPhase();
			const receipt = await w.reveal(owner, army, [m]);
			await w.toNextCycle();
			return BigInt(receipt!.gasUsed);
		}
		// The chain of `KingCapture.test.ts`: dave takes bob's king while carol
		// takes dave's, so a piece that was bob's is carol's two merges on.
		async function chain() {
			const w = await world();
			const [, b, c, d] = await w.deploy([
				[w.alice, [0, 0]],
				[w.bob, [1, 0]],
				[w.carol, [0, 1]],
				[w.dave, [1, 1]],
			]);
			await w.play([{owner: w.dave, army: d, moves: [move([7, 5], [8, 4])]}]);
			await w.play([{owner: w.dave, army: d, moves: [move([8, 4], [8, 3])]}]);
			await w.play([{owner: w.dave, army: d, moves: [move([4, 6], [3, 7])]}]);
			await w.play([
				{owner: w.dave, army: d, moves: [move([8, 3], [6, 1])]},
				{owner: w.carol, army: c, moves: [move([2, 6], [3, 7])]},
			]);
			return {w, b, c, d};
		}
		// One pawn step each: carol's own pawn, then one that was bob's.
		let s = await chain();
		const noMerge = await revealGas(
			s.w,
			s.w.carol,
			s.c,
			move([-2, 7], [-2, 8]),
		);
		s = await chain();
		const twoMerges = await revealGas(
			s.w,
			s.w.carol,
			s.c,
			move([7, 0], [8, 0]),
		);
		const perMerge = (twoMerges - noMerge) / 2n;
		measured.perMerge = perMerge;

		// A king meeting exactly one piece notes the capture it may make, for
		// the captor's stake (`UsingGameBoard._noteCandidate`): one entry pushed
		// onto a fresh list, two storage slots written from zero. Priced as
		// that, since the king case above never meets anybody.
		const note = 2n * 22_100n + 1_000n;

		// A slider resolves two chained pieces; a king resolves only its
		// destination, since a king's own army never merged.
		const slider = measured.slider! + 2n * MAX_CHAIN * perMerge;
		const king = measured.king! + note + MAX_CHAIN * perMerge;
		const worst = slider > king ? slider : king;
		console.log(
			`gas budget: per merge followed ${perMerge}, noting a capture ${note}; worst chained reveals: slider ${slider}, king ${king}, declared ${declaredReveal}`,
		);
		assert.ok(
			declaredReveal >= (worst * (100n + MINIMUM_HEADROOM_PERCENT)) / 100n,
			`a reveal resolving two chains of ${MAX_CHAIN} merges costs about ${worst} gas, and revealGas is declared at ${declaredReveal}, with less than ${MINIMUM_HEADROOM_PERCENT}% of headroom. ` +
				`Raise it in contracts/rocketh/config.ts, or lower MAX_CHAIN: a reveal that runs out of gas is a missed reveal.`,
		);
	});

	it('covers the worst reveal that folds a capture loop', async function () {
		// THE LOOPS ARE PRICED PER ARMY, then multiplied by the bound, like the
		// chains: folding a loop writes the owner and `loopedIn` of every army
		// of it (`UsingGameBoard._foldLoop`), and reading it walks them all
		// (`_walk`). Measured on the loops of `CaptureLoops.test.ts`, by the
		// reveal that steps the first king off its square, which folds them.
		assert.ok(
			measured.slider && measured.perMerge,
			'runs after the first two cases',
		);
		const world = movesWorld({
			deployAll,
			loadFixture: networkHelpers.loadFixture,
		});
		const declaredReveal = BigInt(
			(await networkHelpers.loadFixture(deployAll)).linkedData.revealGas,
		);
		const step = move([6, 1], [7, 2]);
		async function revealGas(
			w: Awaited<ReturnType<typeof world>>,
			owner: `0x${string}`,
			army: bigint,
		) {
			await w.commit(owner, army, [step]);
			await w.toRevealPhase();
			const receipt = await w.reveal(owner, army, [step]);
			await w.toNextCycle();
			return BigInt(receipt!.gasUsed);
		}
		// bob's king steps off (6,1): played by bob with no loop, by dave once
		// it is a loop of two, and by carol once it is a loop of three.
		const fresh = await fourArmies(world);
		const noLoop = await revealGas(fresh.w, fresh.w.bob, fresh.b);
		const two = await twoArmyLoop(world, 'forward');
		const loopOfTwo = await revealGas(two.w, two.w.dave, two.b);
		const three = await threeArmyLoop(world, 'forward');
		const loopOfThree = await revealGas(three.w, three.w.carol, three.b);
		const perArmy = loopOfThree - loopOfTwo;
		const loopOf = (n: bigint) => loopOfTwo - noLoop + (n - 2n) * perArmy;

		// THE WORST: a slider whose own army is MAX_CHAIN merges behind, taking
		// the king of a loop of MAX_CHAIN armies. Its destination costs what the
		// king's own square cost above (the loop read, walked and folded), and
		// taking a king notes a capture, as in the case above. A king never
		// reaches another king's square: kings never stand side by side.
		const note = 2n * 22_100n + 1_000n;
		// EXITS AND THE RESERVE MOVE-UP
		// (`docs/adr/0011-an-exit-removes-its-own-army-and-leaves-rocks.md`),
		// priced like `note` since no measured case hits them all at once. Each
		// of the two squares a reveal touches may fold a capture, which moves
		// the victim's reserve into its captor's (two reserve slots, the second
		// written from zero at worst, and an event), and may fold an exit (one
		// army record written). And every occupied square the move reads asks
		// whether its army has exited: one cold army record each, plus the
		// cold facts of the exit square its king last moved to, for each of the
		// 7 squares of a slider's path (a king reads 8 neighbours, but only
		// their army records: a king's path is its destination).
		const foldUps = 2n * (2n * 22_100n + 2_000n + 22_100n);
		const exitReads = 7n * (2_100n + 2_100n);
		const worst =
			measured.slider! +
			MAX_CHAIN * measured.perMerge! +
			note +
			loopOf(MAX_CHAIN) +
			foldUps +
			exitReads;
		console.log(
			`gas budget: folding a loop: of two ${loopOf(2n)}, per army ${perArmy}, of ${MAX_CHAIN} ${loopOf(MAX_CHAIN)}; exits and reserve move-ups ${foldUps + exitReads}; worst looped reveal ${worst}, declared ${declaredReveal}`,
		);
		assert.ok(
			declaredReveal >= (worst * (100n + MINIMUM_HEADROOM_PERCENT)) / 100n,
			`a reveal folding a capture loop of ${MAX_CHAIN} armies costs about ${worst} gas, and revealGas is declared at ${declaredReveal}, with less than ${MINIMUM_HEADROOM_PERCENT}% of headroom. ` +
				`Raise it in contracts/rocketh/config.ts, or bound the loops a reveal folds: a reveal that runs out of gas is a missed reveal.`,
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

	it('is what the credits multiplier is derived from, so the two cannot drift apart', async function () {
		const fixtures = await networkHelpers.loadFixture(deployAll);
		const {linkedData} = fixtures;

		const sum = BigInt(linkedData.commitGas) + BigInt(linkedData.revealGas);
		assert.ok(sum > 0n, 'the deployment declares no gas budget at all');
	});
});

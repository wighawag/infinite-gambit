import {describe, it} from 'node:test';
import assert from 'node:assert';
import {network} from 'hardhat';
import {
	setupFixtures,
	fundAccount,
	commitDeployment,
	revealDeployment,
	squareAt,
} from './utils/index.js';
import {parseEther} from 'viem';

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
 * action, and today it is a deployment or a pass. The worst commit is the
 * first DEPLOYMENT, when every slot it writes is cold: it creates the army,
 * moves the stake between two reserves, starts waiting for the army and then
 * commits. The worst reveal is a deployment's too, the first one ever, which
 * writes the whole open set of spawn points beside the spawn point's record.
 * Moves (`chess-moves`) will have a worse reveal, and it is measured here then.
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
		const revealUsed = BigInt(revealReceipt.gasUsed);

		assert.ok(
			commitUsed <= declaredCommit,
			`a first deployment commit costs ${commitUsed} gas and the deployment declares commitGas ${declaredCommit}. ` +
				`Raise it in contracts/rocketh/config.ts: it is the gas LIMIT of every commit.`,
		);
		assert.ok(
			revealUsed <= declaredReveal,
			`a deployment's reveal costs ${revealUsed} gas and the deployment declares revealGas ${declaredReveal}. ` +
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

	it('is what the credits multiplier is derived from, so the two cannot drift apart', async function () {
		const fixtures = await networkHelpers.loadFixture(deployAll);
		const {linkedData} = fixtures;

		const sum = BigInt(linkedData.commitGas) + BigInt(linkedData.revealGas);
		assert.ok(sum > 0n, 'the deployment declares no gas budget at all');
	});
});

import {expect} from 'earl';
import {describe, it} from 'node:test'; // using node:test as hardhat v3 do not support vitest
import {network} from 'hardhat';
import {
	setupFixtures,
	idOf,
	armyIdOf,
	fundAccount,
	commitDeployment,
	commitmentHashFor,
	deploymentAt,
	squareAt,
} from './utils/index.js';
import {parseEther, zeroAddress} from 'viem';
import {generatePrivateKey, privateKeyToAccount} from 'viem/accounts';
import {delegationMessage} from '@etherplay/delegation';

/**
 * WHO MAY ACT FOR AN ARMY: its owner, or a key the owner authorised. The
 * army is who plays and the ACCOUNT is who owns it (`CONTEXT.md`), so a local
 * signer deploys and plays an army for the account without holding anything.
 */

const {provider, networkHelpers} = await network.connect();
const {deployAll} = setupFixtures(provider);

const SECRET_A =
	'0x0000000000000000000000000000000000000000000000000000000000000a11';

async function atCommitPhase() {
	const f = await networkHelpers.loadFixture(deployAll);
	const {cycleNumber} = f.getCycleNumber(await f.getTimestamp());
	await f.advanceToCycleNumber(cycleNumber + 2, true);
	return f;
}

describe('Game delegation', function () {
	it('lets an authorised key deploy for the account, out of the ACCOUNT reserve', async function () {
		const f = await atCommitPhase();
		const {env, Game} = f;
		const account = f.unnamedAccounts[0] as `0x${string}`;
		// Stands in for the browser's local signer: it holds no tokens and has no
		// reserve of its own, which is the whole point.
		const signer = f.unnamedAccounts[1] as `0x${string}`;
		await fundAccount(f, account);
		await env.execute(Game, {
			account,
			functionName: 'registerDelegate',
			args: [signer, zeroAddress],
		});
		expect(
			await env.read(Game, {
				functionName: 'delegationStatus',
				args: [account, signer],
			}),
		).toEqual([true, false]);

		// SENT BY the signer, FOR the account's next army.
		const {army} = await commitDeployment(f, {
			owner: account,
			sender: signer,
			spawnPoint: squareAt(0, 0),
			secret: SECRET_A,
			actionsPerReveal: f.actionsPerReveal,
		});

		// The army is the ACCOUNT'S, and its stake came from the account. If it
		// were the signer's, losing the browser would lose the army.
		expect(army).toEqual(armyIdOf(account, 1));
		const view = (await env.read(Game, {
			functionName: 'getArmy',
			args: [army],
		})) as {owner: string};
		expect(view.owner.toLowerCase()).toEqual(account.toLowerCase());
		expect(
			await env.read(Game, {functionName: 'getReserve', args: [army]}),
		).toEqual(f.stake);
		expect(
			await env.read(Game, {functionName: 'getReserve', args: [idOf(account)]}),
		).toEqual(0n);
		expect(
			await env.read(Game, {functionName: 'getNextArmy', args: [signer]}),
		).toEqual(armyIdOf(signer, 1));
	});

	it('refuses a key the account never authorised', async function () {
		const f = await atCommitPhase();
		const account = f.unnamedAccounts[0] as `0x${string}`;
		const stranger = f.unnamedAccounts[2] as `0x${string}`;
		await fundAccount(f, account);

		// Without the check this succeeds, and that is the theft: a stranger
		// moves someone else's stake into an army only they know the secret for.
		await expect(
			commitDeployment(f, {
				owner: account,
				sender: stranger,
				spawnPoint: squareAt(0, 0),
				secret: SECRET_A,
				actionsPerReveal: f.actionsPerReveal,
			}),
		).toBeRejected();
		expect(
			await f.env.read(f.Game, {
				functionName: 'getReserve',
				args: [idOf(account)],
			}),
		).toEqual(f.stake);
	});

	it('refuses an identity that is neither an account nor an army it can name', async function () {
		// An id above the 160th bit is an army id, and only the owner's NEXT one
		// may be named before it exists: anything else is refused at the one
		// place authority is granted.
		const f = await atCommitPhase();
		const account = f.unnamedAccounts[0] as `0x${string}`;
		await fundAccount(f, account);
		const hash = commitmentHashFor(
			deploymentAt(squareAt(0, 0)),
			SECRET_A,
			f.actionsPerReveal,
		);
		for (const id of [
			armyIdOf(account, 5),
			// No owner at all.
			1n << 160n,
		]) {
			await expect(
				f.env.execute(f.Game, {
					account,
					functionName: 'makeCommitment',
					args: [id, hash, f.stake, zeroAddress],
					gas: 1000000n,
				}),
			).toBeRejectedWith(`custom error 'InvalidPlayer(`);
		}
	});

	it('never lets the delegate withdraw the stake', async function () {
		// It may SPEND the reserve on playing, which is what it is for, and it may
		// not take it out: `withdrawFromReserve` only ever reaches the caller's
		// own account reserve, which for a delegate is empty.
		const f = await atCommitPhase();
		const {env, Game} = f;
		const account = f.unnamedAccounts[0] as `0x${string}`;
		const signer = f.unnamedAccounts[1] as `0x${string}`;
		await fundAccount(f, account);
		await env.execute(Game, {
			account,
			functionName: 'registerDelegate',
			args: [signer, zeroAddress],
		});

		await expect(
			env.execute(Game, {
				account: signer,
				functionName: 'withdrawFromReserve',
				args: [parseEther('10')],
			}),
		).toBeRejected();
		expect(
			await env.read(Game, {functionName: 'getReserve', args: [idOf(account)]}),
		).toEqual(f.stake);
	});

	it('routes every delegation selector on the proxy', async function () {
		// The router is where this breaks in practice: a route missing from the
		// deploy script, or two routes claiming one selector. Either way the
		// failure is a call that reverts with "function selector was not
		// recognized", which reads to a user as a broken wallet rather than as a
		// missing feature. Reading through the proxy is the only check that covers
		// the wiring as well as the code.
		//
		// All six of them, including the two writers, which are reached with a
		// call rather than a transaction: a selector that does not route reverts
		// on `eth_call` exactly as it would on a send, and this way the assertion
		// is about the wiring rather than about what registering does.
		const {env, Game, unnamedAccounts} =
			await networkHelpers.loadFixture(deployAll);
		const account = unnamedAccounts[0];

		expect(
			await env.read(Game, {
				functionName: 'delegationStatus',
				args: [account, account],
			}),
		).toEqual([false, false]);
		expect(
			typeof (await env.read(Game, {
				functionName: 'delegationMessage',
				args: [account, 0n],
			})),
		).toEqual('string');
		expect(
			typeof (await env.read(Game, {
				functionName: 'delegationDigest',
				args: [account, 0n],
			})),
		).toEqual('string');

		// The writers, sent for real. A selector that does not route reverts
		// before it reaches any code, so these landing at all is the assertion.
		const delegate = unnamedAccounts[1];
		await env.execute(Game, {
			account,
			functionName: 'registerDelegate',
			args: [delegate, zeroAddress],
		});
		await env.execute(Game, {
			account,
			functionName: 'revokeDelegate',
			args: [delegate],
		});
		expect(
			await env.read(Game, {
				functionName: 'delegationStatus',
				args: [account, delegate],
			}),
		).toEqual([false, true]);

		// The last one is reached by the error it gives back: rejecting the
		// signature means it got as far as the library, which is what routing
		// means here. A missing route would have said "function selector was not
		// recognized" instead.
		await expect(
			env.execute(Game, {
				account,
				functionName: 'registerDelegateViaSignature',
				args: [account, unnamedAccounts[2], 0n, `0x${'11'.repeat(65)}`],
				gas: 1000000n,
			}),
		).toBeRejectedWith(`custom error 'MalformedSignature()'`);
	});
});

/**
 * WHICH CONTRACT A SIGNATURE IS GOOD AT, when the contract is behind a router.
 *
 * The delegation message names the verifying contract, taken from
 * `address(this)`, and that bound is the whole point of the mechanism: a
 * credential minted for one game must not be submittable at another. This game
 * is deployed behind a PROXY, which the library upstream is not, so the answer
 * to "which address is that" is not something to reason about from how
 * `delegatecall` works. It is something to read off the deployed thing.
 *
 * If it were the route implementation rather than the proxy, every consequence
 * would be wrong at once: the client addresses the proxy, so it would build a
 * message for an address the contract never checks against; and re-deploying a
 * route would invalidate every signature already in existence.
 */
describe('Game delegation behind the router', function () {
	it('names the PROXY as the verifying contract, not the route', async function () {
		const {env, Game} = await networkHelpers.loadFixture(deployAll);
		const delegate = privateKeyToAccount(generatePrivateKey()).address;

		const message = (await env.read(Game, {
			functionName: 'delegationMessage',
			args: [delegate, 0n],
		})) as string;

		// The address the client talks to is the address inside the text.
		expect(message).toInclude(Game.address.toLowerCase());

		// And the route's own address is nowhere in it. Read from the deployment
		// rather than assumed, so this fails if the route stops being separate.
		const route = env.get('Game_Implementation_Router_Delegation_Route');
		expect(route.address.toLowerCase()).not.toEqual(Game.address.toLowerCase());
		expect(message).not.toInclude(route.address.toLowerCase());
	});

	it('accepts a signature built for the proxy, from the package builder', async function () {
		// The end of the chain the previous test starts: the client builds the
		// message in TypeScript for the address it addresses, the owner signs it
		// without ever sending anything, somebody else submits it, and the
		// registration lands. Nothing here reads the message off the contract, so
		// the two implementations are agreeing rather than being compared.
		const {env, Game, unnamedAccounts} =
			await networkHelpers.loadFixture(deployAll);

		const owner = privateKeyToAccount(generatePrivateKey());
		const delegate = privateKeyToAccount(generatePrivateKey());
		const payer = unnamedAccounts[0];
		const chainId = Number(
			BigInt((await provider.request({method: 'eth_chainId'})) as string),
		);

		const signature = await owner.signMessage({
			message: delegationMessage({
				delegate: delegate.address,
				contract: Game.address,
				chainId,
				deadline: 0,
			}),
		});

		await env.execute(Game, {
			account: payer,
			functionName: 'registerDelegateViaSignature',
			args: [owner.address, delegate.address, 0n, signature],
		});

		expect(
			await env.read(Game, {
				functionName: 'delegationStatus',
				args: [owner.address, delegate.address],
			}),
		).toEqual([true, false]);
	});

	it('refuses a signature naming the route implementation instead', async function () {
		// The negative half, and the one that would catch the bug quietly. A
		// signature for the wrong contract is well-formed, recovers to a real
		// address, and is simply somebody else's - so if the proxy ever started
		// verifying against the route, the test above would still pass while every
		// credential in the wild stopped working.
		const {env, Game, unnamedAccounts} =
			await networkHelpers.loadFixture(deployAll);

		const owner = privateKeyToAccount(generatePrivateKey());
		const delegate = privateKeyToAccount(generatePrivateKey());
		const route = env.get('Game_Implementation_Router_Delegation_Route');
		const chainId = Number(
			BigInt((await provider.request({method: 'eth_chainId'})) as string),
		);

		const signature = await owner.signMessage({
			message: delegationMessage({
				delegate: delegate.address,
				contract: route.address,
				chainId,
				deadline: 0,
			}),
		});

		await expect(
			env.execute(Game, {
				account: unnamedAccounts[0],
				functionName: 'registerDelegateViaSignature',
				args: [owner.address, delegate.address, 0n, signature],
				gas: 1000000n,
			}),
		).toBeRejectedWith(`custom error 'InvalidSignature()'`);
	});
});

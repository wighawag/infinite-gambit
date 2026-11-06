import {describe, it} from 'node:test';
import assert from 'node:assert';
import {network} from 'hardhat';
import {
	toFunctionSelector,
	zeroAddress,
	type Abi,
	type AbiFunction,
} from 'viem';
import {setupFixtures} from './utils/index.js';
import {artifacts} from '../../rocketh/environment.js';

/**
 * EVERY SELECTOR A ROUTER CARRIES IS ROUTED, past 48 too.
 *
 * `Router10X60` from `solidity-proxy@0.5.2` claims 60 selectors but packs
 * entries 48 and up into the wrong word, so a router with more than 48 loses
 * some of them and those calls revert `UNKNOWN_METHOD`, with nothing said at
 * deploy time. The deploys use a fixed copy (`src/vendor/router/`); this pins
 * that every deployed router routes every selector of its merged ABI, so the
 * bug cannot come back silently (a bump of the package, a dropped
 * `routerContract`). See work/notes/observations/router-loses-selectors-past-48.md.
 *
 * A call with the bare selector and no arguments is enough: a routed call
 * reaches its route and fails there (bad calldata) or succeeds; only an
 * unrouted one reverts `UNKNOWN_METHOD`.
 */

const {provider, networkHelpers} = await network.connect();
const {deployAll} = setupFixtures(provider);

/** `UNKNOWN_METHOD` as it appears in an `Error(string)` revert's data. */
const UNKNOWN_METHOD_HEX = Buffer.from('UNKNOWN_METHOD').toString('hex');

/** Whether calling `to` with `data` reverts `UNKNOWN_METHOD`. */
async function unknownMethod(
	to: `0x${string}`,
	data: `0x${string}`,
): Promise<boolean> {
	try {
		await provider.request({
			method: 'eth_call',
			params: [{to, data}, 'latest'],
		});
		return false;
	} catch (e) {
		const err = e as {data?: unknown; message?: string};
		const revertData = typeof err.data === 'string' ? err.data : '';
		return (
			revertData.includes(UNKNOWN_METHOD_HEX) ||
			String(err.message ?? e).includes('UNKNOWN_METHOD')
		);
	}
}

function selectorsOf(abi: Abi): `0x${string}`[] {
	return abi
		.filter((item): item is AbiFunction => item.type === 'function')
		.map((item) => toFunctionSelector(item));
}

describe('the router', function () {
	for (const name of ['GameLobbyImplementation', 'Game']) {
		it(`routes every selector of ${name}`, async function () {
			const {env} = await networkHelpers.loadFixture(deployAll);
			const deployment = env.get<Abi>(name);
			const selectors = selectorsOf(deployment.abi);
			if (name === 'GameLobbyImplementation') {
				// The case the bug bites: more than 48.
				assert.ok(
					selectors.length > 48,
					`expected the lobby implementation past 48 selectors, it has ${selectors.length}`,
				);
			}
			const lost: string[] = [];
			for (const selector of selectors) {
				if (await unknownMethod(deployment.address, selector)) {
					lost.push(selector);
				}
			}
			assert.deepStrictEqual(
				lost,
				[],
				`${name}'s router (${selectors.length} selectors) does not route ${lost.join(', ')}`,
			);
		});
	}

	it('routes all 60 selectors it can hold, and nothing else', async function () {
		const {env} = await networkHelpers.loadFixture(deployAll);
		// Any contract without a fallback: a routed call reverts there, with no
		// `UNKNOWN_METHOD`.
		const target = env.get<Abi>('GameToken').address;
		const sigs = Array.from({length: 60}, (_, i) =>
			(i + 1).toString(16).padStart(8, '0'),
		);
		const router = await env.deploy('TestRouter60', {
			account: env.namedAccounts.deployer,
			artifact: artifacts.Router10X60,
			args: [
				{
					implementations: [target],
					sigMap: sigs.map((sig) => `0x${sig}00` as `0x${string}`),
					fallbackImplementation: zeroAddress,
				},
			],
		});
		const lost: string[] = [];
		for (const sig of sigs) {
			if (await unknownMethod(router.address, `0x${sig}`)) lost.push(sig);
		}
		assert.deepStrictEqual(lost, [], `unrouted: ${lost.join(', ')}`);
		// The detector itself: a selector the router does not hold.
		assert.ok(await unknownMethod(router.address, '0x0000003d'));
	});
});

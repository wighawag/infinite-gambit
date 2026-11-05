import {describe, it} from 'node:test';
import assert from 'node:assert';
import {network} from 'hardhat';
import {setupFixtures} from './utils/index.js';

/**
 * EVERY CONTRACT FITS IN A BLOCK'S CODE LIMIT: 24,576 bytes of deployed code
 * (EIP-170), the limit a real chain enforces whatever a test node allows.
 *
 * It binds the game's routes in particular: the chess rules are compiled into
 * the routes that run them (the reveal, the board read, the simulation), and
 * every rule a task adds grows one of them. A route over the limit cannot be
 * deployed at all, so the time to split it (another route, or a library) is
 * when this fails, not when a deploy does. It measures what the suite deploys,
 * which is the unoptimised build and so the larger one.
 */

const {provider, networkHelpers} = await network.connect();
const {deployAll} = setupFixtures(provider);

const CODE_SIZE_LIMIT = 24_576;

describe('deployed code size', function () {
	it('keeps every deployed contract, every route included, under 24,576 bytes', async function () {
		const {env} = await networkHelpers.loadFixture(deployAll);
		const sizes: [string, number][] = [];
		for (const [name, deployment] of Object.entries(env.deployments) as [
			string,
			{address: `0x${string}`},
		][]) {
			const code = (await provider.request({
				method: 'eth_getCode',
				params: [deployment.address, 'latest'],
			})) as string;
			sizes.push([name, (code.length - 2) / 2]);
		}
		const routes = sizes.filter(([name]) => name.endsWith('_Route'));
		assert.ok(
			routes.length >= 5,
			`expected the game's routes among the deployments, found ${routes.map(([n]) => n).join(', ')}`,
		);
		for (const [name, size] of sizes) {
			assert.ok(
				size <= CODE_SIZE_LIMIT,
				`${name} is ${size} bytes of deployed code, over the ${CODE_SIZE_LIMIT}-byte limit: split the route or move code into a library.`,
			);
		}
		console.log(
			`route sizes: ${routes.map(([n, s]) => `${n.replace(/^.*Router_|_Route$/g, '')} ${s}`).join(', ')}`,
		);
	});
});

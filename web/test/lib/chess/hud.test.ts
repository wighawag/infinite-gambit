import {describe, it, expect} from 'vitest';
import {
	describeArmy,
	describeDeployment,
	describeSubmission,
} from '$lib/chess/ui/hud';
import {ARMY_STATUS} from '$lib/chess/armies';
import {squareAt} from '$lib/chess/squares';

/** What the HUD says about an army and its deployment, as plain functions. */

describe('the HUD', () => {
	it('says where the army is', () => {
		expect(describeArmy(undefined)).toBeUndefined();
		expect(
			describeArmy({status: ARMY_STATUS.Deploying, stake: 10n})?.tone,
		).toBe('busy');
		expect(
			describeArmy({status: ARMY_STATUS.Deployed, stake: 10n})?.label,
		).toBe('On the board.');
		expect(describeArmy({status: ARMY_STATUS.Failed, stake: 10n})?.tone).toBe(
			'bad',
		);
	});

	it('lists the open spawn points while the army still has to be deployed', () => {
		const view = {
			step: 'Loaded' as const,
			cycleNumber: 3,
			pieces: new Map(),
			ghost: [],
			spawnPoints: [
				{spawnPoint: squareAt(0, 0), position: {x: 0, y: 0}, nearest: []},
				{spawnPoint: squareAt(16, 0), position: {x: 16, y: 0}, nearest: [5]},
			],
			planned: {
				spawnPoint: squareAt(16, 0),
				position: {x: 16, y: 0},
				nearest: [5],
			},
		};
		const deployment = describeDeployment({needsDeployment: true, view});
		expect(deployment?.picked).toBe('(16, 0)');
		expect(deployment?.spawnPoints.map((p) => p.picked)).toEqual([false, true]);
		expect(deployment?.spawnPoints[1].nearest).toBe('nearest army: 5 squares');
		expect(describeDeployment({needsDeployment: false, view})).toBeUndefined();
	});

	it('names a committed deployment for what it is', () => {
		expect(
			describeSubmission({
				step: 'Planning',
				cycleNumber: 3,
				actions: [{from: 0n, to: 0n}],
			} as never).label,
		).toBe('Deployment picked, not yet committed');
	});
});

/**
 * Where a planned army would stand, by the contract's own rule.
 *
 * The rule is `ChessRules.layout`, exposed by the Simulation route as
 * `previewDeployment` and run from its deployed bytecode in this client's
 * sandbox (`$lib/game/simulation`), never a TypeScript copy of it
 * (`docs/adr/0007-rules-live-only-in-the-contract.md`). The view merge is
 * synchronous and the sandbox is not, so the plan feeds `latestResult` and the
 * merge reads the last answer for the plan as it is NOW.
 */
import {derived, type Readable} from 'svelte/store';
import {latestResult, type LatestResult} from '$lib/game/simulation';
import {pieceOf, type Piece} from './board';
import type {LocalPlan} from './view';

type PreviewInput = {spawnPoint: bigint; army: bigint};

export type DeploymentPreviewStore = Readable<
	LatestResult<PreviewInput, readonly Piece[]>
>;

export function createDeploymentPreview(params: {
	plan: Readable<LocalPlan>;
	/** `previewDeployment`, run in the sandbox. */
	simulate: (
		spawnPoint: bigint,
		army: bigint,
	) => Promise<readonly Parameters<typeof pieceOf>[0][]>;
}): DeploymentPreviewStore {
	const inputs = derived(params.plan, ($plan): PreviewInput | undefined =>
		$plan.spawnPoint === undefined || $plan.army === undefined
			? undefined
			: {spawnPoint: $plan.spawnPoint, army: $plan.army},
	);
	return latestResult(
		inputs,
		async ({spawnPoint, army}) =>
			(await params.simulate(spawnPoint, army)).map(pieceOf),
		{
			equal: (a, b) => a.spawnPoint === b.spawnPoint && a.army === b.army,
		},
	);
}

/**
 * The plan with its preview, attached only when it was computed for exactly
 * the spawn point and army planned NOW.
 */
export function withPreview(
	plan: Readable<LocalPlan>,
	preview: DeploymentPreviewStore,
): Readable<LocalPlan> {
	return derived([plan, preview], ([$plan, $preview]): LocalPlan => {
		if ($preview.step !== 'Ready') return $plan;
		const current =
			$preview.input.spawnPoint === $plan.spawnPoint &&
			$preview.input.army === $plan.army;
		return current ? {...$plan, preview: $preview.result} : $plan;
	});
}

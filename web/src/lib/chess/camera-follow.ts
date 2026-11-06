/**
 * THE CAMERA FOLLOWS THE PLAYER'S ARMY by default (user story 44), and lets go
 * the moment the player looks somewhere else.
 *
 * What it follows is the played army's KING, as the contract's registry
 * resolves it (`getArmies`, read with the board): the king is the army, and
 * the registry is already read whole, so following costs no extra fetch
 * (`docs/adr/0007-rules-live-only-in-the-contract.md`).
 *
 * The camera is the template's (`$lib/game/render/camera`) and is not changed:
 * this only calls `follow` on it, and watches its transform to notice a move it
 * did not make. ANY such move lets go (a drag, a key, a zoom about the pointer),
 * so whatever input the host grows, the player is never dragged back to their
 * army against a pan. `recentre` comes back.
 */
import {derived, writable, type Readable} from 'svelte/store';
import type {CameraControl} from '$lib/game/render/camera';
import type {OnchainStateValue} from '$lib/game/core/seams';
import {ARMY_STATUS, type ArmyView} from './armies';
import {positionOf, type Position} from './squares';

/**
 * Where the played army's king stands, while it is on the board; undefined
 * before it lands, and once it failed, was cancelled or was captured.
 */
export function followTargetOf(params: {
	board: OnchainStateValue<{armies: readonly ArmyView[]}>;
	you: bigint | undefined;
}): Position | undefined {
	const {board, you} = params;
	if (board.step !== 'Loaded' || you === undefined) return undefined;
	const army = board.armies.find((entry) => entry.id === you);
	if (!army || army.status !== ARMY_STATUS.Deployed) return undefined;
	return positionOf(army.king);
}

/** The played army's king, as a store, for {@link createCameraFollow}. */
export function followTarget(params: {
	board: Readable<OnchainStateValue<{armies: readonly ArmyView[]}>>;
	you: Readable<bigint | undefined>;
}): Readable<Position | undefined> {
	let last: Position | undefined;
	return derived([params.board, params.you], ([$board, $you], set) => {
		const next = followTargetOf({board: $board, you: $you});
		// Every poll is a new board; only a king that MOVED is news.
		if (next?.x === last?.x && next?.y === last?.y) return;
		last = next;
		set(next);
	});
}

export type CameraFollowState = {
	/** Whether the camera is on the army and stays on it as it moves. */
	following: boolean;
	/** Whether there is an army to follow (and so to come back to). */
	hasTarget: boolean;
};

export type CameraFollowStore = Readable<CameraFollowState> & {
	/** Back to the army, and follow it again. */
	recentre(): void;
	/** Look at a square (the minimap does), letting go of the army. */
	lookAt(position: Position): void;
	/** Begin following. Returns the teardown. */
	start(): () => void;
};

export function createCameraFollow(params: {
	cameraControl: Pick<CameraControl, 'follow' | 'transform'>;
	target: Readable<Position | undefined>;
}): CameraFollowStore {
	const {cameraControl, target} = params;
	const state = writable<CameraFollowState>({
		following: true,
		hasTarget: false,
	});
	let following = true;
	let current: Position | undefined;
	/** Set while THIS module moves the camera, so the move is not a pan. */
	let steering = false;

	function steer(position: Position) {
		steering = true;
		try {
			cameraControl.follow(position.x, position.y);
		} finally {
			steering = false;
		}
	}

	function publish() {
		state.set({following, hasTarget: current !== undefined});
	}

	return {
		subscribe: state.subscribe,
		recentre() {
			following = true;
			if (current) steer(current);
			publish();
		},
		lookAt(position) {
			following = false;
			steer(position);
			publish();
		},
		start() {
			steering = true;
			const stopTransform = cameraControl.transform.subscribe(() => {
				// A move this module did not make is the player looking elsewhere.
				// With no army there is nothing to let go of: the player is still
				// looking for a spawn point, and the army it lands is followed.
				if (steering || current === undefined || !following) return;
				following = false;
				publish();
			});
			steering = false;
			const stopTarget = target.subscribe((next) => {
				const landed = current === undefined && next !== undefined;
				current = next;
				// An army that has just come onto the board is where the player
				// wants to look, wherever they were looking for a spawn point.
				if (landed) following = true;
				if (following && next) steer(next);
				publish();
			});
			return () => {
				stopTarget();
				stopTransform();
			};
		},
	};
}

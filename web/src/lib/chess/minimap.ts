/**
 * THE MINIMAP: the spawn spiral and every army on the board, with the camera on
 * it, so a player can find the fighting on an infinite board (user story 45).
 *
 * Read off what the board reader already reads WHOLE: the open spawn points
 * (`getOpenSpawnPoints`) and the army registry (`getArmies`), both resolved by
 * the contract. Never the pieces, which stay fetched only for the area in view,
 * and no indexer (`docs/adr/0007-rules-live-only-in-the-contract.md`). Nothing
 * here is a rule: which spawn points are open is the contract's answer, and a
 * spawn point is TAKEN when the registry says an army landed on it.
 *
 * The map is in SQUARES, so a component can draw it with its own coordinates
 * as the view box and nothing to project; a point on it comes back as a
 * fraction of its size ({@link minimapPoint}).
 */
import {derived, get, type Readable} from 'svelte/store';
import type {Camera, CameraWatcher} from '$lib/game/render/camera';
import type {OnchainStateValue} from '$lib/game/core/seams';
import {ARMY_STATUS, type ArmyView} from './armies';
import {positionOf, type Position} from './squares';
import {armyColour, YOUR_COLOUR} from './render/style';
import {exitsIn} from './exits';

/** A rectangle of the board, in squares: top-left corner and extent. */
export type Rect = {x: number; y: number; width: number; height: number};

export type MinimapModel = {
	/** The square of board the map covers. */
	bounds: Rect;
	/** Spawn points: open ones, then those an army landed on. */
	spawnPoints: readonly {x: number; y: number; open: boolean}[];
	/** Every army on the board, at its king. */
	armies: readonly {
		id: bigint;
		x: number;
		y: number;
		you: boolean;
		colour: string;
	}[];
	/**
	 * The exits on the map, where a king may leave with its stake: none
	 * without a spawn grid (a table), or when they would be too dense to tell
	 * apart ({@link MAX_MINIMAP_EXITS}).
	 */
	exits: readonly Position[];
	/** What the camera sees. */
	view: Rect;
};

/**
 * Past this many exits on the map they are not drawn: the map is zoomed out
 * so far that they would merge into a texture, and drawing them costs a node
 * each.
 */
export const MAX_MINIMAP_EXITS = 1024;

/**
 * How much board to leave around everything marked, in squares: an army's
 * footprint reaches three squares out from its spawn point, so this keeps a
 * whole army on the map rather than its centre.
 */
const MARGIN = 8;

/** Statuses of an army that stood on its spawn point. */
const LANDED: ReadonlySet<number> = new Set([
	ARMY_STATUS.Deployed,
	ARMY_STATUS.Captured,
	ARMY_STATUS.Frozen,
]);

/**
 * Statuses of an army whose king stands on the board: a frozen one stays
 * there, with its stake, as loot (story 37).
 */
const ON_THE_BOARD: ReadonlySet<number> = new Set([
	ARMY_STATUS.Deployed,
	ARMY_STATUS.Frozen,
]);

export function minimapOf(params: {
	spawnPoints: readonly bigint[];
	armies: readonly ArmyView[];
	you: bigint | undefined;
	camera: Camera;
	/** The spawn grid's spacing, which places the exits; none when absent. */
	spawnSpacing?: number;
}): MinimapModel {
	const {camera, you} = params;
	const open = params.spawnPoints.map((point) => ({
		...positionOf(point),
		open: true,
	}));
	const seen = new Set(params.spawnPoints);
	const taken: {x: number; y: number; open: boolean}[] = [];
	for (const army of params.armies) {
		if (!LANDED.has(army.status) || seen.has(army.spawnPoint)) continue;
		seen.add(army.spawnPoint);
		taken.push({...positionOf(army.spawnPoint), open: false});
	}
	const armies = params.armies
		.filter((army) => ON_THE_BOARD.has(army.status))
		.map((army) => ({
			id: army.id,
			...positionOf(army.king),
			you: army.id === you,
			colour: army.id === you ? YOUR_COLOUR : armyColour(army.id),
		}));
	const view = {
		x: camera.x - camera.width / 2,
		y: camera.y - camera.height / 2,
		width: camera.width,
		height: camera.height,
	};
	const spawnPoints = [...open, ...taken];
	const bounds = squareAround([...spawnPoints, ...armies], view);
	return {
		bounds,
		spawnPoints,
		armies,
		exits: exitsOn(bounds, params.spawnSpacing),
		view,
	};
}

/** The exits within `bounds`, unless there are too many to draw. */
function exitsOn(bounds: Rect, spacing: number | undefined): Position[] {
	if (!spacing) return [];
	const across = (bounds.width / spacing + 1) * (bounds.height / spacing + 1);
	if (across > MAX_MINIMAP_EXITS) return [];
	return exitsIn(
		{
			minX: Math.ceil(bounds.x),
			minY: Math.ceil(bounds.y),
			maxX: Math.floor(bounds.x + bounds.width),
			maxY: Math.floor(bounds.y + bounds.height),
		},
		spacing,
	);
}

/** The smallest square holding every point and the view, with a margin. */
function squareAround(points: readonly Position[], view: Rect): Rect {
	let minX = view.x;
	let minY = view.y;
	let maxX = view.x + view.width;
	let maxY = view.y + view.height;
	for (const {x, y} of points) {
		minX = Math.min(minX, x);
		minY = Math.min(minY, y);
		maxX = Math.max(maxX, x);
		maxY = Math.max(maxY, y);
	}
	const side = Math.max(maxX - minX, maxY - minY) + 2 * MARGIN;
	return {
		x: (minX + maxX) / 2 - side / 2,
		y: (minY + maxY) / 2 - side / 2,
		width: side,
		height: side,
	};
}

/**
 * The square at a point on the map, given as a fraction of the map's width
 * and height from its top-left corner.
 */
export function minimapPoint(map: MinimapModel, at: Position): Position {
	return {
		x: map.bounds.x + at.x * map.bounds.width,
		y: map.bounds.y + at.y * map.bounds.height,
	};
}

export type MinimapStore = Readable<MinimapModel | undefined> & {
	/** Send the camera to a point on the map, as a fraction of its size. */
	navigate(at: Position): void;
};

export function createMinimap(params: {
	board: Readable<
		OnchainStateValue<{
			spawnPoints: readonly bigint[];
			armies: readonly ArmyView[];
		}>
	>;
	you: Readable<bigint | undefined>;
	camera: CameraWatcher;
	/** Where the camera goes: the follower, so the army is let go of. */
	lookAt(position: Position): void;
	/** The spawn grid's spacing, which places the exits; none at a table. */
	spawnSpacing?: number;
}): MinimapStore {
	const model = derived(
		[params.board, params.you, params.camera],
		([$board, $you, $camera]) =>
			$board.step === 'Loaded'
				? minimapOf({
						spawnPoints: $board.spawnPoints,
						armies: $board.armies,
						you: $you,
						camera: $camera,
						spawnSpacing: params.spawnSpacing,
					})
				: undefined,
	);
	return {
		subscribe: model.subscribe,
		navigate(at) {
			// Read on demand rather than held by a subscription of its own, which
			// would keep the board's poller running with no minimap mounted.
			const current = get(model);
			if (current) params.lookAt(minimapPoint(current, at));
		},
	};
}

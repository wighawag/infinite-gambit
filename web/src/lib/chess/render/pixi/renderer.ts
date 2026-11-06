/**
 * The chess board on the pixi host, drawn as the Devcon wooden set.
 *
 * STATEFUL rendering (`$lib/game/render/stateful`): pieces are keyed entities
 * the reconciler adds, updates and removes as the view state changes. The board
 * and the exits are not entities: they follow the camera from `tick`. The
 * highlights and the stake labels are redrawn when the view state changes.
 *
 * Like the canvas renderer (`../board.ts`) it draws what the view state says
 * and decides nothing (`docs/adr/0007-rules-live-only-in-the-contract.md`):
 * every mapping from the view to the screen is in `view-model.ts`.
 *
 * NOT THE DEFAULT YET: `../index.ts` selects it only with `PUBLIC_RENDERER=pixi`
 * (see `web/.env`). Making it the default is `chess-pixi-switch` in
 * `work/tasks/`.
 */
import {Container, Sprite, Text, Texture} from 'pixi.js';
import type {Frame, GameRenderer} from '$lib/game/core/seams';
import {createStatefulRenderer} from '$lib/game/render/stateful';
import {visibleCells} from '$lib/game/render/view-transform';
import type {ViewStateStore} from '$lib/view';
import {exitsIn} from '../../exits';
import type {BoardView} from '../../view';
import {WoodBoard} from './board';
import {ARRIVE_MS, EffectLayer} from './effects';
import {ExitLayer} from './exits';
import {Overlays} from './overlays';
import {FOOT} from './piece-art';
import {PieceTextures} from './pieces';
import {pieceMode, type PieceMode} from './squares';
import {kingBadge} from '../eth-diamond';
import type {Position} from '../../squares';
import {
	createTransitionTracker,
	MOVE_MS,
	noTransition,
	type BoardFrame,
	type Transition,
} from './transitions';
import {
	cssColourToHex,
	exitBlocks,
	glyphOfLook,
	labelsOf,
	looksDiffer,
	overlayModel,
	pieceLooks,
	type Label,
	type PieceLook,
} from './view-model';

/** Screen pixels per square below which the stake labels are hidden. */
const LABELS_BELOW = 18;

const LABEL_TEXT = {live: 0xffffff, frozen: 0xcfe8ff, stone: 0xd9d2c5};

type PieceObject = {
	glow: Sprite;
	/** The army-coloured felt pad the piece stands on: who it belongs to. */
	pad: Sprite;
	sprite: Sprite;
	dot: Sprite;
	/** The glyph on the dot, when zoomed out (`pieceMode` 'glyphs'). */
	glyph: Sprite;
	/** The ETH diamond on a king or stone: click it for the stake. */
	badge: Sprite;
	look: PieceLook;
	/** Sliding in from another square: a move (`./transitions.ts`). */
	motion?: {from: Position; start?: number};
	/** Rising into place after `delayMs`: a deployment. */
	arrival?: {delayMs: number; start?: number};
};

const easeInOut = (t: number) =>
	t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;

/** How high a moving piece is lifted at the middle of its slide, in squares. */
const HOP = 0.3;

export function createChessPixiRenderer(params: {
	viewState: ViewStateStore<BoardView>;
	/** The spawn grid's spacing, which places the exits; none at a table. */
	spawnSpacing?: number;
	/** Pixels per square at 1:1, as the host is mounted with (`cellSize`). */
	cellSize: number;
	/** Half the side of a spawn point's frame, in squares (the footprint). */
	spawnFrameHalf: number;
}): GameRenderer<Container> {
	const {cellSize} = params;
	const c = cellSize;

	let board: WoodBoard | undefined;
	let exits: ExitLayer | undefined;
	let overlays: Overlays | undefined;
	let textures: PieceTextures | undefined;
	let effects: EffectLayer | undefined;
	const tracker = createTransitionTracker({spawnSpacing: params.spawnSpacing});
	/** What the change being reconciled animates, read by `add` and `update`. */
	let pending: Transition = noTransition();
	const pieces = new Container();
	pieces.sortableChildren = true;
	const labels = new Container();
	let labelPool: Text[] = [];
	let latestLabels: Label[] = [];
	let mode: PieceMode = 'pieces';
	let unsubscribe: (() => void) | undefined;

	function texture(look: PieceLook): Texture {
		return textures!.peek(look.kind, look.finish, look.band) ?? Texture.EMPTY;
	}

	function apply(object: PieceObject, look: PieceLook): void {
		object.look = look;
		const {glow, pad, sprite, dot, glyph, badge} = object;
		const tone = cssColourToHex(look.tone);

		glow.tint = tone;
		glow.width = c * 0.95;
		glow.height = c * 0.42;

		// The pad: solid, rimmed, in the army colour, so whose piece it is
		// reads at a glance without the thin band on the wood.
		pad.tint = tone;
		pad.width = c * 0.82;
		pad.height = c * 0.34;

		sprite.texture = texture(look);
		sprite.width = sprite.height = c * 0.94;
		if (sprite.texture === Texture.EMPTY) {
			// rasterising is async: set the texture when it lands, if this object
			// still wants it
			void textures!.get(look.kind, look.finish, look.band).then((t) => {
				if (object.look === look && !sprite.destroyed) {
					sprite.texture = t;
					sprite.width = sprite.height = c * 0.94;
				}
			});
		}

		dot.tint = tone;
		dot.width = dot.height = c * 0.86;

		glyph.texture = textures!.glyph(glyphOfLook(look));
		glyph.width = glyph.height = c * 0.7;

		const at = kingBadge({x: 0, y: 0});
		// the texture's diamond is 0.44 of its side per unit
		badge.width = badge.height = (at.unit / 0.44) * c;
		if (object.motion) place(object, object.motion.from, 0, 1);
		else if (object.arrival) place(object, look, 0, 0);
		else place(object, look, 0, 1);
		showMode(object);
	}

	/**
	 * Put a piece at `at` (in squares, fractional while it moves), `lift`
	 * squares above its pad and at `fade` of its opacity.
	 */
	function place(
		object: PieceObject,
		at: Position,
		lift: number,
		fade: number,
	): void {
		const {glow, pad, sprite, dot, glyph, badge, look} = object;
		const px = at.x * c;
		const py = at.y * c;
		const alpha = look.alpha * fade;
		const z = at.y * 3;
		const up = lift * c;

		glow.alpha = look.glow * alpha;
		glow.position.set(px, py + c * 0.34);
		glow.zIndex = z;

		pad.alpha = alpha;
		pad.position.set(px, py + c * 0.33);
		pad.zIndex = z + 0.5;

		sprite.alpha = alpha;
		sprite.position.set(px, py + c * 0.44 - up);
		sprite.zIndex = z + 1;

		dot.alpha = alpha;
		dot.position.set(px, py - up);
		dot.zIndex = z;

		glyph.alpha = alpha;
		glyph.position.set(px, py - up);
		glyph.zIndex = z + 0.5;

		const badgeAt = kingBadge(at);
		badge.alpha = alpha;
		badge.position.set(badgeAt.centre.x * c, badgeAt.centre.y * c - up);
		badge.zIndex = z + 2;
	}

	/** Advance a piece's slide or rise, if it has one. */
	function animate(object: PieceObject, nowMs: number): void {
		const {motion, arrival, look} = object;
		if (motion) {
			motion.start ??= nowMs;
			const t = (nowMs - motion.start) / MOVE_MS;
			if (t >= 1) {
				object.motion = undefined;
				place(object, look, 0, 1);
				return;
			}
			const m = easeInOut(Math.max(0, t));
			const at = {
				x: motion.from.x + (look.x - motion.from.x) * m,
				y: motion.from.y + (look.y - motion.from.y) * m,
			};
			place(object, at, Math.sin(Math.PI * m) * HOP, 1);
		} else if (arrival) {
			arrival.start ??= nowMs + arrival.delayMs;
			const t = (nowMs - arrival.start) / ARRIVE_MS;
			if (t >= 1) {
				object.arrival = undefined;
				place(object, look, 0, 1);
				return;
			}
			const q = Math.max(0, t);
			place(object, look, (1 - easeInOut(q)) * 0.6, q);
		}
	}

	/** Take what the change being reconciled says about this piece. */
	function takeAnimation(object: PieceObject, key: string): void {
		const from = pending.moves.get(key);
		if (from) {
			object.motion = {from};
			object.arrival = undefined;
		}
		const delayMs = pending.arrivals.get(key);
		if (delayMs !== undefined) object.arrival = {delayMs};
	}

	function showMode(object: PieceObject): void {
		const turned = mode === 'pieces';
		object.sprite.visible = turned;
		object.pad.visible = turned;
		object.glow.visible = turned && !object.look.stone;
		object.dot.visible = !turned;
		object.glyph.visible = mode === 'glyphs';
		// kings and stones (a stone is the king's silhouette)
		object.badge.visible = mode !== 'dots' && object.look.kind === 'king';
	}

	function drawLabels(scale: number): void {
		const shown = scale >= LABELS_BELOW;
		labels.visible = shown;
		if (!shown) return;
		// constant on screen: undo the world's zoom
		const k = cellSize / scale;
		latestLabels.forEach((label, i) => {
			let text = labelPool[i];
			if (!text) {
				text = new Text({
					text: '',
					resolution: 2,
					style: {
						fontFamily: 'sans-serif',
						fontSize: 13,
						fontWeight: 'bold',
						fill: 0xffffff,
						// bare text vanished on the wood
						stroke: {color: 0x0b1020, width: 4, join: 'round'},
					},
				});
				text.anchor.set(0.5, 1);
				labelPool.push(text);
				labels.addChild(text);
			}
			text.text = label.text;
			text.style.fill = LABEL_TEXT[label.tone];
			text.visible = true;
			text.scale.set(k);
			text.position.set(label.x * c, (label.y - 0.55) * c);
		});
		for (let i = latestLabels.length; i < labelPool.length; i++) {
			labelPool[i].visible = false;
		}
	}

	const stateful = createStatefulRenderer<
		Container,
		BoardView,
		string,
		PieceLook,
		PieceObject
	>({
		viewState: params.viewState,
		entities: (view) => pieceLooks(view),
		changed: looksDiffer,
		add: ({key, entity}) => {
			const object: PieceObject = {
				glow: new Sprite(textures!.glow),
				pad: new Sprite(textures!.dot),
				sprite: new Sprite(),
				dot: new Sprite(textures!.dot),
				glyph: new Sprite(),
				badge: new Sprite(textures!.badge),
				look: entity,
			};
			takeAnimation(object, key);
			object.badge.anchor.set(0.5);
			object.glow.anchor.set(0.5);
			object.pad.anchor.set(0.5);
			object.glyph.anchor.set(0.5);
			// the piece stands on the lower part of its square
			object.sprite.anchor.set(0.5, FOOT);
			object.dot.anchor.set(0.5);
			pieces.addChild(
				object.glow,
				object.pad,
				object.sprite,
				object.dot,
				object.glyph,
				object.badge,
			);
			apply(object, entity);
			return object;
		},
		update: ({key, object, entity}) => {
			takeAnimation(object, key);
			apply(object, entity);
		},
		remove: ({object}) => {
			object.glow.destroy();
			object.pad.destroy();
			object.sprite.destroy();
			object.dot.destroy();
			object.glyph.destroy();
			object.badge.destroy();
		},

		onStarted(surface) {
			board = new WoodBoard(cellSize);
			exits = new ExitLayer(board, cellSize);
			overlays = new Overlays(cellSize, params.spawnFrameHalf);
			textures = new PieceTextures();
			effects = new EffectLayer(pieces, textures, cellSize);
			surface.addChild(
				board.container,
				exits.under,
				exits.container,
				overlays.under,
				pieces,
				overlays.over,
				effects.over,
				labels,
			);
			unsubscribe = params.viewState.subscribe((view) => {
				// before the reconciler's own subscription (it subscribes after
				// `onStarted`), so `add` and `update` read this change's animations
				if (view.step === 'Unloaded') {
					tracker.reset();
					effects?.clear();
					pending = noTransition();
					overlays?.set({
						spawns: [],
						destinations: [],
						threatened: [],
						attacked: [],
						planned: [],
						outcomes: [],
					});
					latestLabels = [];
					return;
				}
				pending = tracker.step(view as BoardFrame, performance.now());
				effects?.play(pending, mode);
				overlays?.set(overlayModel(view));
				latestLabels = labelsOf(view);
			});
		},

		onStopped() {
			unsubscribe?.();
			unsubscribe = undefined;
			labelPool = [];
			latestLabels = [];
			effects?.clear();
			tracker.reset();
			pending = noTransition();
			board = exits = overlays = textures = effects = undefined;
		},

		tick({frame, objects}) {
			tickBoard(frame);
			const now = pieceMode(frame.transform.scale);
			// an iterator: walk it once
			const changedMode = now !== mode;
			mode = now;
			for (const object of objects) {
				if (changedMode) showMode(object);
				animate(object, frame.timeMs);
			}
			effects?.tick(frame.timeMs, frame.transform.scale);
		},
	});

	function tickBoard(frame: Frame): void {
		if (!board || !exits) return;
		const scale = frame.transform.scale;
		const cells = visibleCells(frame.transform, frame.screen);
		board.update({
			left: cells.minX,
			top: cells.minY,
			right: cells.maxX,
			bottom: cells.maxY,
		});
		if (params.spawnSpacing) {
			// a margin of 2, so a block cut by the view's edge keeps its top-left
			const around = {
				minX: cells.minX - 2,
				minY: cells.minY - 2,
				maxX: cells.maxX + 2,
				maxY: cells.maxY + 2,
			};
			exits.update(
				exitBlocks(exitsIn(around, params.spawnSpacing)),
				scale,
				frame.timeMs / 1000,
			);
		}
		drawLabels(scale);
	}

	return stateful;
}

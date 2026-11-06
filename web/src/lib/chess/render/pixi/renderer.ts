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
 * NOT SELECTED YET: `../index.ts` still names the canvas-2d host. Switching is
 * `chess-pixi-switch` in `work/tasks/`.
 */
import {Container, Sprite, Text, Texture} from 'pixi.js';
import type {Frame, GameRenderer} from '$lib/game/core/seams';
import {createStatefulRenderer} from '$lib/game/render/stateful';
import {visibleCells} from '$lib/game/render/view-transform';
import type {ViewStateStore} from '$lib/view';
import {exitsIn} from '../../exits';
import type {BoardView} from '../../view';
import {WoodBoard} from './board';
import {ExitLayer} from './exits';
import {Overlays} from './overlays';
import {FOOT} from './piece-art';
import {PieceTextures} from './pieces';
import {isDots} from './squares';
import {
	cssColourToHex,
	exitBlocks,
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
	sprite: Sprite;
	dot: Sprite;
	look: PieceLook;
};

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
	const pieces = new Container();
	pieces.sortableChildren = true;
	const labels = new Container();
	let labelPool: Text[] = [];
	let latestLabels: Label[] = [];
	let dots = false;
	let unsubscribe: (() => void) | undefined;

	function texture(look: PieceLook): Texture {
		return textures!.peek(look.kind, look.finish, look.band) ?? Texture.EMPTY;
	}

	function apply(object: PieceObject, look: PieceLook): void {
		object.look = look;
		const {glow, sprite, dot} = object;
		const tone = cssColourToHex(look.tone);
		const px = look.x * c;
		const py = look.y * c;

		glow.tint = tone;
		glow.alpha = look.glow * look.alpha;
		glow.width = c * 0.95;
		glow.height = c * 0.42;
		glow.position.set(px, py + c * 0.34);
		glow.zIndex = look.y * 3;

		sprite.texture = texture(look);
		sprite.alpha = look.alpha;
		sprite.width = sprite.height = c * 0.94;
		sprite.position.set(px, py + c * 0.44);
		sprite.zIndex = look.y * 3 + 1;
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
		dot.alpha = look.alpha;
		dot.width = dot.height = c * 0.78;
		dot.position.set(px, py);
		dot.zIndex = look.y * 3;
		showDots(object);
	}

	function showDots(object: PieceObject): void {
		object.sprite.visible = !dots;
		object.glow.visible = !dots && !object.look.stone;
		object.dot.visible = dots;
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
					style: {fontFamily: 'sans-serif', fontSize: 12, fill: 0xffffff},
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
		add: ({entity}) => {
			const object: PieceObject = {
				glow: new Sprite(textures!.glow),
				sprite: new Sprite(),
				dot: new Sprite(textures!.dot),
				look: entity,
			};
			object.glow.anchor.set(0.5);
			// the piece stands on the lower part of its square
			object.sprite.anchor.set(0.5, FOOT);
			object.dot.anchor.set(0.5);
			pieces.addChild(object.glow, object.sprite, object.dot);
			apply(object, entity);
			return object;
		},
		update: ({object, entity}) => apply(object, entity),
		remove: ({object}) => {
			object.glow.destroy();
			object.sprite.destroy();
			object.dot.destroy();
		},

		onStarted(surface) {
			board = new WoodBoard(cellSize);
			exits = new ExitLayer(board, cellSize);
			overlays = new Overlays(cellSize, params.spawnFrameHalf);
			textures = new PieceTextures();
			surface.addChild(
				board.container,
				exits.under,
				exits.container,
				overlays.under,
				pieces,
				overlays.over,
				labels,
			);
			unsubscribe = params.viewState.subscribe((view) => {
				if (view.step === 'Unloaded') {
					overlays?.set({
						spawns: [],
						destinations: [],
						attacked: [],
						outcomes: [],
					});
					latestLabels = [];
					return;
				}
				overlays?.set(overlayModel(view));
				latestLabels = labelsOf(view);
			});
		},

		onStopped() {
			unsubscribe?.();
			unsubscribe = undefined;
			labelPool = [];
			latestLabels = [];
			board = exits = overlays = textures = undefined;
		},

		tick({frame, objects}) {
			tickBoard(frame);
			const nowDots = isDots(frame.transform.scale);
			if (nowDots !== dots) {
				dots = nowDots;
				for (const object of objects) showDots(object);
			}
		},
	});

	function tickBoard(frame: Frame): void {
		if (!board || !exits) return;
		const scale = frame.transform.scale;
		const cells = visibleCells(frame.transform, frame.screen);
		board.update(
			{
				left: cells.minX,
				top: cells.minY,
				right: cells.maxX,
				bottom: cells.maxY,
			},
			scale,
		);
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

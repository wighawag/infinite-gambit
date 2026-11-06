/**
 * The board, drawn from scratch every frame.
 *
 * IMMEDIATE rendering (`$lib/game/render/immediate`): no scene graph, nothing
 * remembered between frames. It draws what the view state says and decides
 * nothing: no rule of the game is here, only colours and glyphs.
 *
 * Squares are centred on their integer coordinates, as the host's grid is. The
 * glyphs are drawn in SCREEN space, sized from the camera's scale, because a
 * font sized in game units (a fraction of a pixel before the transform) is
 * rounded by browsers into nothing.
 */
import type {Frame, GameRenderer} from '$lib/game/core/seams';
import {createImmediateRenderer} from '$lib/game/render/immediate';
import {visibleCells} from '$lib/game/render/view-transform';
import type {ViewStateStore} from '$lib/view';
import type {BoardView, PieceView} from '../view';
import {
	glyphOf,
	armyColour,
	frozenColour,
	FROZEN_RING,
	isStone,
	plannedMoveColour,
	STONE_COLOUR,
	YOUR_COLOUR,
} from './style';
import {captureEffectsOf} from '../outcomes';
import {PIECE_KIND} from '../board';
import {PICK_RADIUS} from '../planning';
import {
	BADGE_OUTLINE,
	ETH_TONES,
	ethDiamond,
	exitDiamonds,
	kingBadge,
	type Facet,
} from './eth-diamond';
import {breath, breathPhase, labelsOf, type Label} from './pixi/view-model';

const SPAWN_COLOUR = '#ffd166';
const OPEN_GHOST_COLOUR = '#d9d2c5';
/** Half the side of a spawn point's footprint (5 x 5), in squares. */
const SPAWN_FRAME_HALF = PICK_RADIUS + 0.5;
/**
 * An exit, where a king may leave with its stake: the ETH diamond, in two
 * tones like the logo (`./eth-diamond`). The same mark sits on every king.
 */
const EXIT_ALPHA = 0.55;
/** Below this many pixels per square a king has no room for its badge. */
const MIN_BADGE_SCALE = 14;
const SELECTED_COLOUR = '#ffd166';
const DESTINATION_COLOUR = 'rgba(120, 220, 140, 0.45)';
const LIGHT_SQUARE = 'rgba(255, 255, 255, 0.05)';
/** A square an enemy piece may move to this cycle. */
const ATTACKED_COLOUR = 'rgba(239, 71, 111, 0.22)';
/** The stake label over a king. */
const LABEL_BACKGROUND = 'rgba(11, 16, 32, 0.8)';
const LABEL_TONES: Record<Label['tone'], string> = {
	live: '#ffffff',
	frozen: '#cfe8ff',
	stone: '#d9d2c5',
};
/** A square where the last cycle's arrivals collided and died. */
const COLLISION_COLOUR = '#ef476f';
/** A square where the last cycle captured a piece. */
const CAPTURE_COLOUR = '#f78c6b';
/** A square where the piece that took a king landed as a queen. */
const PROMOTION_COLOUR = '#ffd166';
/** A square where a capture left a stone. */
const STONE_MADE_COLOUR = '#d9d2c5';
/** Below this many pixels per square there is no room for a glyph. */
const MIN_GLYPH_SCALE = 6;

function toScreen(frame: Frame, x: number, y: number) {
	const {transform, screen} = frame;
	return {
		x: (x - transform.centerX) * transform.scale + screen.width / 2,
		y: (y - transform.centerY) * transform.scale + screen.height / 2,
	};
}

export function createChessBoardRenderer(params: {
	viewState: ViewStateStore<BoardView>;
	/** The spawn grid's spacing, which places the exits; none when absent. */
	spawnSpacing?: number;
}): GameRenderer<CanvasRenderingContext2D> {
	return createImmediateRenderer<CanvasRenderingContext2D, BoardView>({
		viewState: params.viewState,

		draw({surface: context, view, frame}) {
			if (view.step === 'Unloaded') return;
			const bounds = visibleCells(frame.transform, frame.screen);
			const scale = frame.transform.scale;

			// The checkerboard, in game units under the host's camera transform.
			if (scale >= MIN_GLYPH_SCALE) {
				context.fillStyle = LIGHT_SQUARE;
				for (let y = bounds.minY; y <= bounds.maxY; y++) {
					for (let x = bounds.minX; x <= bounds.maxX; x++) {
						if ((x + y) % 2 === 0) context.fillRect(x - 0.5, y - 0.5, 1, 1);
					}
				}
			}

			// Exits: one ETH diamond across each 2 by 2 block, under everything
			// else. In game units, under the camera transform.
			context.globalAlpha = EXIT_ALPHA;
			for (const {centre, unit} of exitDiamonds(bounds, params.spawnSpacing)) {
				fillFacets(context, ethDiamond(centre, unit), (x, y) => ({x, y}));
			}
			context.globalAlpha = 1;

			// Open spawn points are their ghost armies (drawn with the pieces).
			// Under them, the footprint of the one picked or the one a click
			// would pick, and a faint outline where no ghost is known yet.
			const half = SPAWN_FRAME_HALF;
			for (const point of view.spawnPoints) {
				const {x, y} = point.position;
				const picked = view.planned?.spawnPoint === point.spawnPoint;
				const hovered = view.hovered === point.spawnPoint;
				if (picked || hovered) {
					context.globalAlpha = picked ? 0.15 : 0.1;
					context.fillStyle = SPAWN_COLOUR;
					context.fillRect(x - half, y - half, 2 * half, 2 * half);
					context.globalAlpha = 1;
				} else if (!view.spawnGhosts?.has(point.spawnPoint)) {
					context.globalAlpha = 0.35;
					context.strokeStyle = SPAWN_COLOUR;
					context.lineWidth = 1 / scale;
					context.strokeRect(x - half, y - half, 2 * half, 2 * half);
					context.globalAlpha = 1;
				}
			}

			// Where an enemy piece may move this cycle, by the contract's rule:
			// under the player's own destinations, so both stay readable.
			context.fillStyle = ATTACKED_COLOUR;
			for (const {x, y} of view.attacked ?? []) {
				context.fillRect(x - 0.5, y - 0.5, 1, 1);
			}

			// The selected piece and where the contract says it may go.
			if (view.selected) {
				context.strokeStyle = SELECTED_COLOUR;
				context.lineWidth = 3 / scale;
				context.strokeRect(view.selected.x - 0.5, view.selected.y - 0.5, 1, 1);
			}
			context.fillStyle = DESTINATION_COLOUR;
			for (const {x, y} of view.destinations ?? []) {
				context.fillRect(x - 0.5, y - 0.5, 1, 1);
			}
			// Each planned piece-move: both squares outlined, joined by a line, in
			// the colour of its place in the move. The pieces themselves stay
			// where the chain has them until the cycle is over.
			for (const {from, to, index} of view.plannedMoves ?? []) {
				context.strokeStyle = plannedMoveColour(index);
				context.lineWidth = 3 / scale;
				context.strokeRect(from.x - 0.5, from.y - 0.5, 1, 1);
				context.strokeRect(to.x - 0.5, to.y - 0.5, 1, 1);
				context.beginPath();
				context.moveTo(from.x, from.y);
				context.lineTo(to.x, to.y);
				context.stroke();
			}

			// What the last cycle did, as the contract resolved it: a tinted
			// square with a cross where pieces died colliding, an outline where a
			// piece was captured, a second outline where the captor landed as a
			// queen, and a dashed one where a capture left a stone. Under the
			// pieces, so a survivor stays readable.
			for (const outcome of view.outcomes) {
				const {x, y} = outcome.position2d;
				const effects = captureEffectsOf(outcome);
				if (effects.promoted) {
					context.strokeStyle = PROMOTION_COLOUR;
					context.lineWidth = 2 / scale;
					context.strokeRect(x - 0.3, y - 0.3, 0.6, 0.6);
				}
				if (effects.stoneMade) {
					context.strokeStyle = STONE_MADE_COLOUR;
					context.lineWidth = 2 / scale;
					context.setLineDash([0.12, 0.08]);
					context.strokeRect(x - 0.48, y - 0.48, 0.96, 0.96);
					context.setLineDash([]);
				}
				if (outcome.died > 0) {
					context.globalAlpha = 0.25;
					context.fillStyle = COLLISION_COLOUR;
					context.fillRect(x - 0.5, y - 0.5, 1, 1);
					context.globalAlpha = 1;
					context.strokeStyle = COLLISION_COLOUR;
					context.lineWidth = 2 / scale;
					context.beginPath();
					context.moveTo(x - 0.35, y - 0.35);
					context.lineTo(x + 0.35, y + 0.35);
					context.moveTo(x + 0.35, y - 0.35);
					context.lineTo(x - 0.35, y + 0.35);
					context.stroke();
				}
				if (outcome.captured) {
					context.strokeStyle = CAPTURE_COLOUR;
					context.lineWidth = 3 / scale;
					context.strokeRect(x - 0.45, y - 0.45, 0.9, 0.9);
				}
			}

			// From here on in screen space: see the file comment.
			context.save();
			context.setTransform(
				frame.devicePixelRatio,
				0,
				0,
				frame.devicePixelRatio,
				0,
				0,
			);
			const visible = (piece: PieceView) =>
				piece.position2d.x >= bounds.minX &&
				piece.position2d.x <= bounds.maxX &&
				piece.position2d.y >= bounds.minY &&
				piece.position2d.y <= bounds.maxY;

			for (const piece of view.pieces.values()) {
				if (!visible(piece)) continue;
				// A stone is a square tile edged in the colour of the army it
				// was: nobody plays it, and it holds that army's stake. A frozen
				// army is greyed, in its own drained hue and ringed.
				const ownColour =
					piece.army === view.you
						? YOUR_COLOUR
						: armyColour(piece.army, view.colours);
				if (isStone(piece.kind)) {
					drawPiece(context, frame, piece, {
						colour: STONE_COLOUR,
						alpha: 1,
						ring: ownColour,
						square: true,
					});
					drawBadge(context, frame, piece, 1);
					continue;
				}
				const frozen = view.frozen?.has(piece.army) ?? false;
				drawPiece(context, frame, piece, {
					colour: frozen ? frozenColour(piece.army) : ownColour,
					alpha: frozen ? 0.55 : 1,
					...(frozen ? {ring: FROZEN_RING} : {}),
				});
				// A king carries its army's stake out through an exit: it wears the
				// exits' mark, which a click on it opens into the amount.
				if (piece.kind === PIECE_KIND.King) {
					drawBadge(context, frame, piece, frozen ? 0.55 : 1);
				}
			}
			// Each open spawn point's ghost army, barely there; the one under the
			// mouse as the player's own, half-way to a planned one.
			// The open ones breathe, in a wave across the grid (`breath`).
			for (const [spawnPoint, pieces] of view.spawnGhosts ?? []) {
				const hovered = spawnPoint === view.hovered;
				const at = view.spawnPoints.find(
					(point) => point.spawnPoint === spawnPoint,
				)?.position;
				const alpha = hovered
					? 0.3
					: 0.26 * breath(frame.timeMs, breathPhase(at ?? {x: 0, y: 0}));
				for (const piece of pieces) {
					if (!visible(piece)) continue;
					drawPiece(context, frame, piece, {
						colour: hovered ? YOUR_COLOUR : OPEN_GHOST_COLOUR,
						alpha,
					});
				}
			}
			// The planned army, as a ghost: never mistaken for one on chain.
			for (const piece of view.ghost) {
				if (!visible(piece)) continue;
				drawPiece(context, frame, piece, {colour: YOUR_COLOUR, alpha: 0.4});
			}
			// The stake of the king or stone the player clicked, over it: what a
			// player judges a target by. Only that one (`labelsOf`): drawn over
			// every king, the labels covered the pieces around them.
			if (scale >= MIN_GLYPH_SCALE) {
				for (const label of labelsOf(view)) {
					drawLabel(context, frame, label, label.text, {
						text: LABEL_TONES[label.tone],
					});
				}
			}
			context.restore();
		},
	});
}

function drawPiece(
	context: CanvasRenderingContext2D,
	frame: Frame,
	piece: PieceView,
	style: {colour: string; alpha: number; ring?: string; square?: boolean},
) {
	const scale = frame.transform.scale;
	const centre = toScreen(frame, piece.position2d.x, piece.position2d.y);
	context.globalAlpha = style.alpha;
	context.fillStyle = style.colour;
	context.beginPath();
	if (style.square) {
		const half = scale * 0.4;
		context.rect(centre.x - half, centre.y - half, half * 2, half * 2);
	} else {
		context.arc(centre.x, centre.y, scale * 0.42, 0, Math.PI * 2);
	}
	context.fill();
	if (style.ring) {
		context.strokeStyle = style.ring;
		context.lineWidth = Math.max(1, scale * 0.06);
		context.stroke();
	}
	if (scale >= MIN_GLYPH_SCALE) {
		context.fillStyle = '#0b1020';
		context.font = `${Math.round(scale * 0.7)}px serif`;
		context.textAlign = 'center';
		context.textBaseline = 'middle';
		context.fillText(glyphOf(piece.kind), centre.x, centre.y + scale * 0.04);
	}
	context.globalAlpha = 1;
}

/**
 * The ETH diamond on a piece that holds a stake (a king, a stone): what says
 * "click me for the amount", since the amount itself is shown only on a click.
 */
function drawBadge(
	context: CanvasRenderingContext2D,
	frame: Frame,
	piece: PieceView,
	alpha: number,
) {
	const scale = frame.transform.scale;
	if (scale < MIN_BADGE_SCALE) return;
	const badge = kingBadge(piece.position2d);
	context.globalAlpha = alpha;
	fillFacets(
		context,
		ethDiamond(badge.centre, badge.unit),
		(x, y) => toScreen(frame, x, y),
		{outline: BADGE_OUTLINE, width: Math.max(1, scale * 0.04)},
	);
	context.globalAlpha = 1;
}

/**
 * The ETH diamond's facets in its two tones, through `at` (identity in game
 * units, `toScreen` in screen space). Outlined first when asked, so the
 * outline frames the shape rather than cutting into it.
 */
function fillFacets(
	context: CanvasRenderingContext2D,
	facets: Facet[],
	at: (x: number, y: number) => {x: number; y: number},
	outline?: {outline: string; width: number},
) {
	const trace = (facet: Facet) => {
		context.beginPath();
		facet.points.forEach(([px, py], i) => {
			const p = at(px, py);
			if (i === 0) context.moveTo(p.x, p.y);
			else context.lineTo(p.x, p.y);
		});
		context.closePath();
	};
	if (outline) {
		context.strokeStyle = outline.outline;
		context.lineWidth = outline.width * 2;
		context.lineJoin = 'round';
		for (const facet of facets) {
			trace(facet);
			context.stroke();
		}
	}
	for (const facet of facets) {
		trace(facet);
		context.fillStyle = ETH_TONES[facet.tone];
		context.fill();
	}
}

/** A short label in a dark box, just above a square, in screen space. */
function drawLabel(
	context: CanvasRenderingContext2D,
	frame: Frame,
	at: {x: number; y: number},
	label: string,
	style: {text: string},
) {
	const scale = frame.transform.scale;
	const centre = toScreen(frame, at.x, at.y);
	const size = Math.max(10, Math.min(16, Math.round(scale * 0.35)));
	context.font = `${size}px sans-serif`;
	context.textAlign = 'center';
	context.textBaseline = 'middle';
	const width = context.measureText(label).width + size;
	const top = centre.y - scale * 0.5 - size * 1.4;
	context.fillStyle = LABEL_BACKGROUND;
	context.fillRect(centre.x - width / 2, top, width, size * 1.4);
	context.fillStyle = style.text;
	context.fillText(label, centre.x, top + size * 0.7);
}

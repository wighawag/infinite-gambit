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
import {glyphOf, armyColour, YOUR_COLOUR} from './style';

const SPAWN_COLOUR = '#ffd166';
const SELECTED_COLOUR = '#ffd166';
const DESTINATION_COLOUR = 'rgba(120, 220, 140, 0.45)';
const PLANNED_COLOUR = '#7ee08a';
const LIGHT_SQUARE = 'rgba(255, 255, 255, 0.05)';
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

			// Open spawn points: a ring where a deployment may land, filled for the
			// one the player picked.
			for (const point of view.spawnPoints) {
				const {x, y} = point.position;
				const picked = view.planned?.spawnPoint === point.spawnPoint;
				context.strokeStyle = SPAWN_COLOUR;
				context.lineWidth = 2 / scale;
				context.strokeRect(x - 3.5, y - 3.5, 7, 7);
				if (picked) {
					context.globalAlpha = 0.15;
					context.fillStyle = SPAWN_COLOUR;
					context.fillRect(x - 3.5, y - 3.5, 7, 7);
					context.globalAlpha = 1;
				}
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
			// The planned move: both squares outlined, joined by a line. The piece
			// itself stays where the chain has it until the cycle is over.
			if (view.plannedMove) {
				const {from, to} = view.plannedMove;
				context.strokeStyle = PLANNED_COLOUR;
				context.lineWidth = 3 / scale;
				context.strokeRect(from.x - 0.5, from.y - 0.5, 1, 1);
				context.strokeRect(to.x - 0.5, to.y - 0.5, 1, 1);
				context.beginPath();
				context.moveTo(from.x, from.y);
				context.lineTo(to.x, to.y);
				context.stroke();
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
				drawPiece(context, frame, piece, {
					colour:
						piece.army === view.you ? YOUR_COLOUR : armyColour(piece.army),
					alpha: 1,
				});
			}
			// The planned army, as a ghost: never mistaken for one on chain.
			for (const piece of view.ghost) {
				if (!visible(piece)) continue;
				drawPiece(context, frame, piece, {colour: YOUR_COLOUR, alpha: 0.4});
			}
			context.restore();
		},
	});
}

function drawPiece(
	context: CanvasRenderingContext2D,
	frame: Frame,
	piece: PieceView,
	style: {colour: string; alpha: number},
) {
	const scale = frame.transform.scale;
	const centre = toScreen(frame, piece.position2d.x, piece.position2d.y);
	context.globalAlpha = style.alpha;
	context.fillStyle = style.colour;
	context.beginPath();
	context.arc(centre.x, centre.y, scale * 0.42, 0, Math.PI * 2);
	context.fill();
	if (scale >= MIN_GLYPH_SCALE) {
		context.fillStyle = '#0b1020';
		context.font = `${Math.round(scale * 0.7)}px serif`;
		context.textAlign = 'center';
		context.textBaseline = 'middle';
		context.fillText(glyphOf(piece.kind), centre.x, centre.y + scale * 0.04);
	}
	context.globalAlpha = 1;
}

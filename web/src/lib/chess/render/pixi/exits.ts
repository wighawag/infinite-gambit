/**
 * Exits, drawn as the Devcon inlay: the Ethereum logo in marquetry, glowing and
 * slowly breathing, so the one symbol on the board means one thing: ETH leaves
 * here. Ported from `spikes/pixi-wood-board/src/exits.ts`.
 *
 * WHERE exits are is NOT decided here. The caller passes each exit's top-left
 * square and span (`view-model.ts`'s `exitBlocks`, over `$lib/chess/exits.ts`,
 * which mirrors `UsingGameBoard._isExit`). The spike computed exit squares
 * itself, with a 2 x 2 block at offsets half - 1 and half; ADR 0015 puts it at
 * half and half + 1, so that formula is deliberately not ported.
 *
 * The inlay (wood cut along four triangles) is too costly to build per exit,
 * so it is BAKED once per variant into a texture, and an exit costs three
 * sprites: the inlay, an additive copy of it that breathes, and a soft glow
 * under it. Variants: the span (1 square, or the 2 x 2 block with one triangle
 * per square) and whether the top-left square is light. The spike baked one 2 x
 * 2 variant because at spacing 16 every block's top-left square is light; at an
 * odd spacing (9, ADR 0015) it alternates.
 *
 * The spike baked with pixi masks and `renderer.generateTexture`; the game's
 * pixi host hands a renderer only its world `Container`, not pixi's `Renderer`,
 * so this bakes on a 2d canvas instead: clip to each triangle, draw the wood.
 */
import {CanvasSource, Container, Sprite, Texture} from 'pixi.js';
import {BOARD_DIM, type WoodBoard} from './board';
import {INLAY, type Quadrant} from './piece-art';
import {cellHash, exitInlay, exitLook, isLight, type ExitSpan} from './squares';

const QUADRANTS: Array<[Quadrant, number, number]> = [
	['tl', -1, -1],
	['tr', 0, -1],
	['bl', -1, 0],
	['br', 0, 0],
];

/** Texture pixels per square of inlay. */
const BAKE = 128;

function glowTexture(): Texture {
	const size = 128;
	const canvas = document.createElement('canvas');
	canvas.width = canvas.height = size;
	const c = canvas.getContext('2d')!;
	const g = c.createRadialGradient(
		size / 2,
		size / 2,
		0,
		size / 2,
		size / 2,
		size / 2,
	);
	g.addColorStop(0, 'rgba(255,236,170,1)');
	g.addColorStop(0.35, 'rgba(255,214,120,0.55)');
	g.addColorStop(1, 'rgba(255,200,90,0)');
	c.fillStyle = g;
	c.fillRect(0, 0, size, size);
	return new Texture({
		source: new CanvasSource({resource: canvas, scaleMode: 'linear'}),
	});
}

/**
 * The inlay as a texture. Span 2: the 2 x 2 block, each triangle in the
 * OPPOSITE wood to its square, grain turned 90 degrees. Span 1: the logo inside
 * one square, in the opposite wood, two facets darker so they still read.
 */
function bakeInlay(
	board: WoodBoard,
	span: ExitSpan,
	topLeftLight: boolean,
): Texture {
	const size = span * BAKE;
	const canvas = document.createElement('canvas');
	canvas.width = canvas.height = size;
	const c = canvas.getContext('2d')!;
	// a triangle's coordinates are in units of `unit` pixels about the centre
	const unit = span === 2 ? BAKE : BAKE / 2;
	const centre = size / 2;
	for (const [quadrant, sx, sy] of QUADRANTS) {
		const squareLight =
			span === 2 ? isLight(sx, sy) === topLeftLight : topLeftLight;
		const wood = squareLight ? board.rosewoodCanvas : board.mapleCanvas;
		const points = INLAY[quadrant].map(
			([x, y]) => [centre + x * unit, centre + y * unit] as const,
		);
		c.save();
		c.beginPath();
		points.forEach(([x, y], i) => (i === 0 ? c.moveTo(x, y) : c.lineTo(x, y)));
		c.closePath();
		c.clip();
		// a window of the wood, rotated about the triangle's square
		const window = wood.width / 4;
		const wx = cellHash(sx + 101, sy + 57, 3) % (wood.width - window);
		const wy = cellHash(sx + 101, sy + 57, 4) % (wood.height - window);
		c.translate(centre + (sx + 0.5) * unit, centre + (sy + 0.5) * unit);
		c.rotate(
			span === 2
				? Math.PI / 2
				: quadrant === 'tl' || quadrant === 'br'
					? Math.PI / 3
					: -Math.PI / 3,
		);
		// oversized, so the rotated window still covers the triangle
		const cover = unit * 2.2;
		c.drawImage(
			wood,
			wx,
			wy,
			window,
			window,
			-cover / 2,
			-cover / 2,
			cover,
			cover,
		);
		if (span === 1 && (quadrant === 'tr' || quadrant === 'bl')) {
			c.fillStyle = 'rgba(40, 20, 10, 0.22)';
			c.fillRect(-cover / 2, -cover / 2, cover, cover);
		}
		c.restore();
		c.beginPath();
		points.forEach(([x, y], i) => (i === 0 ? c.moveTo(x, y) : c.lineTo(x, y)));
		c.closePath();
		c.strokeStyle = 'rgba(26, 12, 6, 0.45)';
		c.lineWidth = Math.max(1, BAKE / 48);
		c.stroke();
	}
	return new Texture({
		source: new CanvasSource({
			resource: canvas,
			autoGenerateMipmaps: true,
			scaleMode: 'linear',
		}),
	});
}

type ExitSprites = {inlay: Sprite; breath: Sprite; glow: Sprite};

export class ExitLayer {
	/** The glows: add it over the board, under the inlays. */
	readonly under = new Container();
	/** The inlays: add it over the glows, under the pieces. */
	readonly container = new Container();
	private readonly baked = new Map<string, Texture>();
	private readonly glow = glowTexture();
	private readonly pool: ExitSprites[] = [];

	constructor(
		private readonly board: WoodBoard,
		private readonly cellSize: number,
	) {}

	private inlayTexture(span: ExitSpan, topLeftLight: boolean): Texture {
		const key = `${span}|${topLeftLight}`;
		let texture = this.baked.get(key);
		if (!texture) {
			texture = bakeInlay(this.board, span, topLeftLight);
			this.baked.set(key, texture);
		}
		return texture;
	}

	/**
	 * Place the exits in view, each named by its top-left square and span.
	 * `scale` is screen pixels per square, so the glow stays a beacon when zoomed
	 * far out; `time` in seconds drives the breathing.
	 */
	update(
		exits: ReadonlyArray<{x: number; y: number; span: ExitSpan}>,
		scale: number,
		time: number,
	): void {
		const {cellSize} = this;
		const breath = 0.5 + 0.5 * Math.sin(time * 2.2);
		// fainter as the camera pulls back, so a field of exits never becomes a
		// polka-dot pattern
		const far = Math.min(1, scale / 40);
		const look = exitLook(scale);
		// Dimmed, the inlay is the board's colour and half seen: one quiet
		// diamond, not a beacon.
		const DIMMED_ALPHA = 0.5;
		exits.forEach((exit, i) => {
			let e = this.pool[i];
			if (!e) {
				e = {
					inlay: new Sprite(),
					breath: new Sprite(),
					glow: new Sprite(this.glow),
				};
				for (const s of [e.inlay, e.breath, e.glow]) s.anchor.set(0.5);
				e.breath.blendMode = 'add';
				e.glow.blendMode = 'add';
				this.pool.push(e);
				this.under.addChild(e.glow);
				this.container.addChild(e.inlay, e.breath);
			}
			const {span} = exit;
			const {cx, cy, topLeftLight} = exitInlay(exit, span);
			const px = cx * cellSize;
			const py = cy * cellSize;
			e.inlay.texture = e.breath.texture = this.inlayTexture(
				span,
				topLeftLight,
			);
			for (const s of [e.inlay, e.breath]) {
				s.width = s.height = span * cellSize;
				s.position.set(px, py);
			}
			e.inlay.visible = true;
			e.inlay.tint = look.dimmed ? BOARD_DIM : 0xffffff;
			e.inlay.alpha = look.dimmed ? DIMMED_ALPHA : 1;
			e.breath.visible = look.glow;
			e.breath.alpha = 0.04 + 0.14 * breath;
			const glowCells = Math.max(span * 1.7, 30 / scale);
			e.glow.visible = look.glow;
			e.glow.width = e.glow.height = glowCells * cellSize;
			e.glow.position.set(px, py);
			e.glow.alpha = (0.25 + 0.25 * breath) * (0.45 + 0.55 * far);
		});
		for (let i = exits.length; i < this.pool.length; i++) {
			const e = this.pool[i];
			e.inlay.visible = e.breath.visible = e.glow.visible = false;
		}
	}
}

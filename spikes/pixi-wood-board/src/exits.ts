/**
 * Exits, drawn as the Devcon inlay: the Ethereum logo in inverted marquetry,
 * glowing, so the one symbol on the board means one thing: ETH leaves here.
 *
 * Where exits are follows the game (`web/src/lib/chess/exits.ts`,
 * `UsingGameBoard._isExit`): the centre of each spawn-grid cell, half the
 * spacing off a spawn point on both axes. Two sizes, to compare:
 *
 *   - `4`: the exit is the 2 x 2 block of squares meeting at that centre, and
 *     the inlay spans it exactly as on the Devcon board (one triangle per
 *     square). This is a RULE change: `_isExit` would accept two offsets per
 *     axis instead of one.
 *   - `1`: today's rule, a single square, with the logo inside it.
 *
 * The inlay is baked once into a texture (wood sprites masked by triangles are
 * too costly to repeat per exit), so an exit costs three sprites: the inlay, an
 * additive copy of it that breathes, and a soft glow under it.
 */
import {CanvasSource, Container, Graphics, Rectangle, Sprite, Texture, type Renderer} from 'pixi.js';
import {isLight, type VisibleCells, type WoodBoard} from './board';
import data from './pieces.json';

export type ExitSize = 1 | 4;

type Quadrant = keyof typeof data.inlay;
const QUADRANTS: Array<[Quadrant, number, number]> = [
	['tl', -1, -1],
	['tr', 0, -1],
	['bl', -1, 0],
	['br', 0, 0],
];

function glowTexture(): Texture {
	const size = 128;
	const canvas = document.createElement('canvas');
	canvas.width = canvas.height = size;
	const c = canvas.getContext('2d')!;
	const g = c.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
	g.addColorStop(0, 'rgba(255,236,170,1)');
	g.addColorStop(0.35, 'rgba(255,214,120,0.55)');
	g.addColorStop(1, 'rgba(255,200,90,0)');
	c.fillStyle = g;
	c.fillRect(0, 0, size, size);
	return new Texture({source: new CanvasSource({resource: canvas, scaleMode: 'linear'})});
}

/**
 * The inlay as a texture. `size` 4: the 2 x 2 block, triangles in the opposite
 * wood to their square. `size` 1: the logo inside one (light) square, all of it
 * in rosewood, the two halves cut with the grain at different angles so the
 * facets still read.
 */
function bakeInlay(renderer: Renderer, board: WoodBoard, cellSize: number, size: ExitSize): Texture {
	const layer = new Container();
	const span = size === 4 ? 2 : 1;
	const scale = size === 4 ? cellSize : cellSize / 2;
	const corner = {x: (span * cellSize) / 2, y: (span * cellSize) / 2};
	for (const [quadrant, sx, sy] of QUADRANTS) {
		// size 4: the square this triangle sits in; every exit block has the same
		// colouring (its top-left square is always light), so the bake is shared
		const light = size === 4 ? !isLight(sx, sy) : false;
		const wood = new Sprite(board.frameFor(sx + 101, sy + 57, light));
		wood.anchor.set(0.5);
		wood.width = scale;
		wood.height = scale;
		wood.rotation = size === 4 ? Math.PI / 2 : quadrant === 'tl' || quadrant === 'br' ? Math.PI / 3 : -Math.PI / 3;
		wood.position.set(corner.x + (sx + 0.5) * scale, corner.y + (sy + 0.5) * scale);
		if (size === 1 && (quadrant === 'tr' || quadrant === 'bl')) wood.tint = 0xc4b4a8;
		const points = data.inlay[quadrant].flatMap(([x, y]) => [corner.x + x * scale, corner.y + y * scale]);
		const mask = new Graphics().poly(points).fill(0xffffff);
		wood.mask = mask;
		const edge = new Graphics().poly(points).stroke({color: 0x1a0c06, alpha: 0.45, width: Math.max(1, cellSize / 48)});
		layer.addChild(mask, wood, edge);
	}
	const texture = renderer.generateTexture({
		target: layer,
		frame: new Rectangle(0, 0, span * cellSize, span * cellSize),
		resolution: 2,
		antialias: true,
	});
	// the game's pixi assets.ts makes `nearest` the default for every texture
	// (its art is pixel art); this art is smooth
	texture.source.scaleMode = 'linear';
	layer.destroy({children: true});
	return texture;
}

/** Exit centres (in squares) in the view, on a spawn grid `spacing` apart. */
export function exitCentres(view: VisibleCells, spacing: number, size: ExitSize): {x: number; y: number}[] {
	const half = Math.trunc(spacing / 2);
	// size 4: the block's centre is the corner between squares half - 1 and half
	const offset = size === 4 ? half - 0.5 : half;
	const first = (min: number) => Math.ceil((min - offset) / spacing) * spacing + offset;
	const out: {x: number; y: number}[] = [];
	for (let y = first(view.top - 1); y <= view.bottom + 1; y += spacing) {
		for (let x = first(view.left - 1); x <= view.right + 1; x += spacing) out.push({x, y});
	}
	return out;
}

/** Whether square (x, y) is an exit, for the given size (mirrors `_isExit`). */
export function isExitSquare(x: number, y: number, spacing: number, size: ExitSize): boolean {
	const half = Math.trunc(spacing / 2);
	const m = (v: number) => (((v - half) % spacing) + spacing) % spacing;
	const ok = (v: number) => m(v) === 0 || (size === 4 && m(v) === spacing - 1);
	return ok(x) && ok(y);
}

type ExitSprites = {inlay: Sprite; breath: Sprite; glow: Sprite};

export class ExitLayer {
	readonly under = new Container();
	readonly container = new Container();
	private readonly textures: Record<ExitSize, Texture>;
	private readonly glow = glowTexture();
	private readonly pool: ExitSprites[] = [];
	size: ExitSize = 4;

	constructor(
		renderer: Renderer,
		board: WoodBoard,
		private readonly cellSize: number,
		private readonly spacing: number,
	) {
		this.textures = {1: bakeInlay(renderer, board, cellSize, 1), 4: bakeInlay(renderer, board, cellSize, 4)};
	}

	/**
	 * Place the exits in view. `time` in seconds drives the breathing; `scale` is
	 * screen pixels per square, so the glow can stay visible as a beacon when
	 * zoomed far out.
	 */
	update(view: VisibleCells, scale: number, time: number): void {
		const {cellSize} = this;
		const centres = exitCentres(view, this.spacing, this.size);
		const span = this.size === 4 ? 2 : 1;
		const breath = 0.5 + 0.5 * Math.sin(time * 2.2);
		centres.forEach(({x, y}, i) => {
			let e = this.pool[i];
			if (!e) {
				e = {inlay: new Sprite(), breath: new Sprite(), glow: new Sprite(this.glow)};
				for (const s of [e.inlay, e.breath, e.glow]) s.anchor.set(0.5);
				e.breath.blendMode = 'add';
				e.glow.blendMode = 'add';
				this.pool.push(e);
				this.under.addChild(e.glow);
				this.container.addChild(e.inlay, e.breath);
			}
			const px = x * cellSize;
			const py = y * cellSize;
			e.inlay.texture = e.breath.texture = this.textures[this.size];
			for (const s of [e.inlay, e.breath]) {
				s.visible = true;
				s.width = s.height = span * cellSize;
				s.position.set(px, py);
			}
			e.breath.alpha = 0.04 + 0.14 * breath;
			// the glow: a little wider than the inlay, and never smaller than ~30
			// screen pixels, so a far-away exit still reads as a beacon; fainter as
			// the camera pulls back, so a field of exits never becomes a pattern
			const far = Math.min(1, scale / 40);
			const glowCells = Math.max(span * 1.7, 30 / scale);
			e.glow.visible = true;
			e.glow.width = e.glow.height = glowCells * cellSize;
			e.glow.position.set(px, py);
			e.glow.alpha = (0.25 + 0.25 * breath) * (0.45 + 0.55 * far);
		});
		for (let i = centres.length; i < this.pool.length; i++) {
			const e = this.pool[i];
			e.inlay.visible = e.breath.visible = e.glow.visible = false;
		}
	}
}

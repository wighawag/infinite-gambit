/**
 * The infinite wooden board: a pool of square sprites reused as the camera
 * moves, the joins between squares, and the Ethereum inlay at the centre of
 * the world.
 *
 * Coordinates follow the game: a square is centred on its integer coordinate
 * (it spans x - 0.5 to x + 0.5), and (x + y) even is a light square. Pixi
 * content is in PIXELS at `cellSize` per square, as in the game's pixi host
 * (`web/src/lib/game/render/pixi/world.ts`), so a square's top-left corner sits
 * at ((x - 0.5) * cellSize, (y - 0.5) * cellSize).
 */
import {CanvasSource, Container, Graphics, Rectangle, Sprite, Texture} from 'pixi.js';
import {MAPLE, ROSEWOOD, woodCanvas} from './wood';
import data from './pieces.json';

/** Windows cut from each wood texture: enough that neighbours rarely repeat. */
const FRAMES = 24;

export type VisibleCells = {left: number; top: number; right: number; bottom: number};

function cellHash(x: number, y: number, salt: number): number {
	let h = Math.imul(x | 0, 73856093) ^ Math.imul(y | 0, 19349663) ^ Math.imul(salt, 83492791);
	h = Math.imul(h ^ (h >>> 15), 2246822519);
	return (h ^ (h >>> 13)) >>> 0;
}

function framesOf(canvas: HTMLCanvasElement, seed: number): Texture[] {
	const source = new CanvasSource({resource: canvas, autoGenerateMipmaps: true, scaleMode: 'linear'});
	const size = canvas.width;
	const window = size / 4;
	const frames: Texture[] = [];
	for (let i = 0; i < FRAMES; i++) {
		const x = (cellHash(i, 1, seed) % (size - window)) | 0;
		const y = (cellHash(i, 2, seed) % (size - window)) | 0;
		frames.push(new Texture({source, frame: new Rectangle(x, y, window, window)}));
	}
	return frames;
}

export class WoodBoard {
	readonly container = new Container();
	private readonly squares = new Container();
	private readonly joins = new Graphics();
	private readonly pool: Sprite[] = [];
	private readonly maple: Texture[];
	private readonly rosewood: Texture[];

	constructor(private readonly cellSize: number) {
		this.maple = framesOf(woodCanvas(MAPLE, 512, 7), 1);
		this.rosewood = framesOf(woodCanvas(ROSEWOOD, 512, 11), 2);
		this.container.addChild(this.squares, this.joins, this.buildInlay());
	}

	/** Light squares are maple, dark ones rosewood, as on the Devcon board. */
	private isLight(x: number, y: number): boolean {
		return (((x + y) % 2) + 2) % 2 === 0;
	}

	private frameFor(x: number, y: number, light: boolean): Texture {
		const frames = light ? this.maple : this.rosewood;
		return frames[cellHash(x, y, 3) % frames.length];
	}

	/**
	 * Lay out the squares the camera can see. Called every frame the view
	 * changes; it allocates only when the visible area grows.
	 */
	update(view: VisibleCells): void {
		const {cellSize} = this;
		let used = 0;
		for (let y = view.top; y <= view.bottom; y++) {
			for (let x = view.left; x <= view.right; x++) {
				let sprite = this.pool[used];
				if (!sprite) {
					sprite = new Sprite();
					this.pool.push(sprite);
					this.squares.addChild(sprite);
				}
				used++;
				const light = this.isLight(x, y);
				sprite.texture = this.frameFor(x, y, light);
				sprite.visible = true;
				// a mirrored cut on some squares, and a slightly different tone per
				// square, as between two pieces of veneer
				const flip = cellHash(x, y, 5) & 1 ? -1 : 1;
				sprite.anchor.set(0.5);
				sprite.width = cellSize;
				sprite.height = cellSize;
				sprite.scale.x *= flip;
				sprite.position.set(x * cellSize, y * cellSize);
				const shade = 236 + (cellHash(x, y, 9) % 20);
				sprite.tint = (shade << 16) | (shade << 8) | shade;
			}
		}
		for (let i = used; i < this.pool.length; i++) this.pool[i].visible = false;

		// the joins: a thin dark line between squares, as the veneer meets
		const j = this.joins.clear();
		const x0 = (view.left - 0.5) * cellSize;
		const x1 = (view.right + 0.5) * cellSize;
		const y0 = (view.top - 0.5) * cellSize;
		const y1 = (view.bottom + 0.5) * cellSize;
		for (let x = view.left; x <= view.right + 1; x++) j.moveTo((x - 0.5) * cellSize, y0).lineTo((x - 0.5) * cellSize, y1);
		for (let y = view.top; y <= view.bottom + 1; y++) j.moveTo(x0, (y - 0.5) * cellSize).lineTo(x1, (y - 0.5) * cellSize);
		j.stroke({color: 0x1a0c06, alpha: 0.35, width: Math.max(1, cellSize / 64)});
	}

	/**
	 * The Devcon inlay: the Ethereum logo as four triangles, one in each square
	 * around the corner where squares (-1,-1), (0,-1), (-1,0) and (0,0) meet,
	 * i.e. the point (-0.5, -0.5). Each triangle is cut from the OPPOSITE wood to
	 * its square (inverted marquetry), so it is a wood sprite masked by the
	 * triangle rather than a flat fill: the grain shows through, as in real
	 * marquetry, and the grain runs across the square's so the piece reads as
	 * separately cut.
	 */
	private buildInlay(): Container {
		const {cellSize} = this;
		const layer = new Container();
		const corner = {x: -0.5 * cellSize, y: -0.5 * cellSize};
		const quadrants: Array<[keyof typeof data.inlay, number, number]> = [
			['tl', -1, -1],
			['tr', 0, -1],
			['bl', -1, 0],
			['br', 0, 0],
		];
		for (const [quadrant, sx, sy] of quadrants) {
			const oppositeIsLight = !this.isLight(sx, sy);
			const wood = new Sprite(this.frameFor(sx + 101, sy + 101, oppositeIsLight));
			wood.anchor.set(0.5);
			wood.width = cellSize;
			wood.height = cellSize;
			wood.rotation = Math.PI / 2;
			wood.position.set(sx * cellSize, sy * cellSize);
			const points = data.inlay[quadrant].flatMap(([x, y]) => [corner.x + x * cellSize, corner.y + y * cellSize]);
			const mask = new Graphics().poly(points).fill(0xffffff);
			wood.mask = mask;
			const edge = new Graphics().poly(points).stroke({color: 0x1a0c06, alpha: 0.35, width: Math.max(1, cellSize / 64)});
			layer.addChild(mask, wood, edge);
		}
		return layer;
	}
}

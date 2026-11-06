/**
 * Everything the board shows that is not wood or a piece: open spawn points,
 * the selection and its destinations, attacked squares, what the last cycle
 * did, and the planned move.
 *
 * The same information the canvas-2d renderer draws today
 * (`web/src/lib/chess/render/board.ts`), restyled for the wooden board:
 * marquetry frames instead of plain outlines, lichess-style destination dots,
 * an arrow for the planned move. `under` sits under the pieces, `over` above
 * them (only the arrow, which must stay readable across pieces).
 */
import {Container, Graphics} from 'pixi.js';

export type Square = {x: number; y: number};

export type OverlayState = {
	/** Open spawn points (their centre square); the footprint is 7 x 7 around it. */
	spawns: Array<Square & {picked?: boolean}>;
	selected?: Square;
	destinations: Array<Square & {capture: boolean}>;
	/** Squares an enemy piece can reach next cycle. */
	attacked: Square[];
	/** What the last cycle did, as the contract resolved it. */
	outcomes: Array<Square & {kind: 'collision' | 'capture'}>;
	planned?: {from: Square; to: Square};
};

const GOLD = 0xffd166;
const MAPLE = 0xe2cba0;
const ROSEWOOD = 0x5a3018;
const INK = 0x1a0c06;
const RED = 0xd63b3b;
const ORANGE = 0xf2994a;

export class Overlays {
	readonly under = new Container();
	readonly over = new Container();
	private readonly g = new Graphics();
	private readonly arrow = new Graphics();

	constructor(private readonly cellSize: number) {
		this.under.addChild(this.g);
		this.over.addChild(this.arrow);
	}

	set(state: OverlayState): void {
		const c = this.cellSize;
		const g = this.g.clear();
		const at = (v: number) => v * c;

		// Open spawn points: a marquetry frame around the 7 x 7 footprint, a maple
		// stripe with a rosewood line inside it and gold diamonds at the corners.
		for (const s of state.spawns) {
			const x0 = at(s.x - 3.5);
			const y0 = at(s.y - 3.5);
			const w = 7 * c;
			if (s.picked) g.rect(x0, y0, w, w).fill({color: GOLD, alpha: 0.12});
			g.rect(x0 + c * 0.05, y0 + c * 0.05, w - c * 0.1, w - c * 0.1).stroke({color: MAPLE, width: c * 0.1, alpha: 0.95});
			g.rect(x0 + c * 0.14, y0 + c * 0.14, w - c * 0.28, w - c * 0.28).stroke({color: ROSEWOOD, width: c * 0.035, alpha: 0.9});
			for (const [cx, cy] of [
				[x0, y0],
				[x0 + w, y0],
				[x0, y0 + w],
				[x0 + w, y0 + w],
			]) {
				const r = c * 0.16;
				g.poly([cx, cy - r, cx + r, cy, cx, cy + r, cx - r, cy]).fill(GOLD).stroke({color: INK, width: c * 0.02, alpha: 0.6});
			}
		}

		// What the last cycle did: a red burst where pieces died colliding, an
		// orange ring where a piece was captured.
		for (const o of state.outcomes) {
			const cx = at(o.x);
			const cy = at(o.y);
			if (o.kind === 'collision') {
				const pts: number[] = [];
				for (let i = 0; i < 16; i++) {
					const r = (i % 2 ? 0.2 : 0.44) * c;
					const a = (i / 16) * Math.PI * 2;
					pts.push(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
				}
				g.poly(pts).fill({color: RED, alpha: 0.35}).stroke({color: RED, width: c * 0.03, alpha: 0.8});
			} else {
				g.circle(cx, cy, c * 0.4).stroke({color: ORANGE, width: c * 0.07, alpha: 0.85});
			}
		}

		// Attacked squares: a red inner border, so a king does not walk into one by
		// accident (rule 21), without hiding the wood.
		for (const a of state.attacked) {
			const inset = c * 0.08;
			g.roundRect(at(a.x - 0.5) + inset, at(a.y - 0.5) + inset, c - 2 * inset, c - 2 * inset, c * 0.1).stroke({
				color: RED,
				width: c * 0.05,
				alpha: 0.7,
			});
		}

		// The selection, and where it may go: a dot on an empty square, four
		// corner wedges on a capture (as lichess does).
		if (state.selected) {
			const {x, y} = state.selected;
			g.rect(at(x - 0.5), at(y - 0.5), c, c).fill({color: GOLD, alpha: 0.28});
			g.rect(at(x - 0.5) + c * 0.04, at(y - 0.5) + c * 0.04, c * 0.92, c * 0.92).stroke({color: GOLD, width: c * 0.07});
		}
		for (const d of state.destinations) {
			const cx = at(d.x);
			const cy = at(d.y);
			if (d.capture) {
				const h = c / 2;
				const k = c * 0.26;
				for (const [sx, sy] of [
					[-1, -1],
					[1, -1],
					[-1, 1],
					[1, 1],
				]) {
					const px = cx + sx * h;
					const py = cy + sy * h;
					g.poly([px, py, px - sx * k, py, px, py - sy * k]).fill({color: INK, alpha: 0.45});
				}
			} else {
				g.circle(cx, cy, c * 0.15).fill({color: INK, alpha: 0.38});
			}
		}

		// The planned move: an arrow from square to square, over the pieces.
		const a = this.arrow.clear();
		if (state.planned) {
			const {from, to} = state.planned;
			const fx = at(from.x);
			const fy = at(from.y);
			const tx = at(to.x);
			const ty = at(to.y);
			const len = Math.hypot(tx - fx, ty - fy);
			const ux = (tx - fx) / len;
			const uy = (ty - fy) / len;
			const head = c * 0.42;
			const width = c * 0.17;
			const bx = tx - ux * head;
			const by = ty - uy * head;
			const nx = -uy;
			const ny = ux;
			const shaft = [
				fx + nx * width * 0.5, fy + ny * width * 0.5,
				bx + nx * width * 0.5, by + ny * width * 0.5,
				bx + nx * head * 0.62, by + ny * head * 0.62,
				tx, ty,
				bx - nx * head * 0.62, by - ny * head * 0.62,
				bx - nx * width * 0.5, by - ny * width * 0.5,
				fx - nx * width * 0.5, fy - ny * width * 0.5,
			];
			a.poly(shaft).fill({color: GOLD, alpha: 0.9}).stroke({color: INK, width: c * 0.03, alpha: 0.7});
		}
	}
}

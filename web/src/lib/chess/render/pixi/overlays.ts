/**
 * Everything the board shows that is not wood or a piece: open spawn points,
 * the selection and its destinations, attacked squares, what the last cycle
 * did, and the planned move. Ported from `spikes/pixi-wood-board/src/overlays.ts`,
 * fed from `view-model.ts`'s `OverlayModel` rather than the spike's own state.
 *
 * `under` sits under the pieces, `over` above them (only the arrow, which must
 * stay readable across pieces). Redrawn when the view state changes, never per
 * frame.
 */
import {Container, Graphics} from 'pixi.js';
import type {OverlayModel} from './view-model';

const GOLD = 0xffd166;
const MAPLE = 0xe2cba0;
const ROSEWOOD = 0x5a3018;
const INK = 0x1a0c06;
const RED = 0xd63b3b;
const ORANGE = 0xf2994a;
const STONE = 0xd9d2c5;

export class Overlays {
	readonly under = new Container();
	readonly over = new Container();
	private readonly g = new Graphics();
	private readonly arrow = new Graphics();

	constructor(
		private readonly cellSize: number,
		/**
		 * Half the side of an open spawn point's frame, in squares: the army's
		 * footprint. The canvas renderer frames 7 x 7 (3.5) today; the 9-grid
		 * board's footprint is 5 x 5 (2.5).
		 */
		private readonly spawnFrameHalf: number,
	) {
		this.under.addChild(this.g);
		this.over.addChild(this.arrow);
	}

	set(state: OverlayModel): void {
		const c = this.cellSize;
		const g = this.g.clear();
		const at = (v: number) => v * c;

		// Open spawn points: a marquetry frame around the footprint, a maple
		// stripe with a rosewood line inside it and gold diamonds at the corners.
		const half = this.spawnFrameHalf;
		for (const s of state.spawns) {
			const x0 = at(s.x - half);
			const y0 = at(s.y - half);
			const w = 2 * half * c;
			if (s.picked) g.rect(x0, y0, w, w).fill({color: GOLD, alpha: 0.12});
			g.rect(x0 + c * 0.05, y0 + c * 0.05, w - c * 0.1, w - c * 0.1).stroke({
				color: MAPLE,
				width: c * 0.1,
				alpha: 0.95,
			});
			g.rect(x0 + c * 0.14, y0 + c * 0.14, w - c * 0.28, w - c * 0.28).stroke({
				color: ROSEWOOD,
				width: c * 0.035,
				alpha: 0.9,
			});
			for (const [cx, cy] of [
				[x0, y0],
				[x0 + w, y0],
				[x0, y0 + w],
				[x0 + w, y0 + w],
			]) {
				const r = c * 0.16;
				g.poly([cx, cy - r, cx + r, cy, cx, cy + r, cx - r, cy])
					.fill(GOLD)
					.stroke({color: INK, width: c * 0.02, alpha: 0.6});
			}
		}

		// What the last cycle did, as the contract resolved it: a red burst where
		// pieces died colliding, an orange ring where a piece was captured, a gold
		// crown-ring where the captor landed as a queen, and a dashed stone ring
		// where a capture left a stone.
		for (const o of state.outcomes) {
			const cx = at(o.x);
			const cy = at(o.y);
			if (o.collision) {
				const pts: number[] = [];
				for (let i = 0; i < 16; i++) {
					const r = (i % 2 ? 0.2 : 0.44) * c;
					const a = (i / 16) * Math.PI * 2;
					pts.push(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
				}
				g.poly(pts)
					.fill({color: RED, alpha: 0.35})
					.stroke({color: RED, width: c * 0.03, alpha: 0.8});
			}
			if (o.captured) {
				g.circle(cx, cy, c * 0.4).stroke({
					color: ORANGE,
					width: c * 0.07,
					alpha: 0.85,
				});
			}
			if (o.promoted) {
				g.circle(cx, cy, c * 0.3).stroke({
					color: GOLD,
					width: c * 0.05,
					alpha: 0.9,
				});
			}
			if (o.stoneMade) {
				for (let i = 0; i < 12; i++) {
					const a0 = (i / 12) * Math.PI * 2;
					const r = c * 0.47;
					g.moveTo(cx + Math.cos(a0) * r, cy + Math.sin(a0) * r);
					g.arc(cx, cy, r, a0, a0 + Math.PI / 12).stroke({
						color: STONE,
						width: c * 0.05,
						alpha: 0.9,
					});
				}
			}
		}

		// Attacked squares: a red inner border, without hiding the wood.
		for (const a of state.attacked) {
			const inset = c * 0.08;
			g.roundRect(
				at(a.x - 0.5) + inset,
				at(a.y - 0.5) + inset,
				c - 2 * inset,
				c - 2 * inset,
				c * 0.1,
			).stroke({color: RED, width: c * 0.05, alpha: 0.7});
		}

		// The selection, and where it may go: a dot on an empty square, four
		// corner wedges on a capture.
		if (state.selected) {
			const {x, y} = state.selected;
			g.rect(at(x - 0.5), at(y - 0.5), c, c).fill({color: GOLD, alpha: 0.28});
			g.rect(
				at(x - 0.5) + c * 0.04,
				at(y - 0.5) + c * 0.04,
				c * 0.92,
				c * 0.92,
			).stroke({color: GOLD, width: c * 0.07});
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
					g.poly([px, py, px - sx * k, py, px, py - sy * k]).fill({
						color: INK,
						alpha: 0.45,
					});
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
			if (len === 0) return;
			const ux = (tx - fx) / len;
			const uy = (ty - fy) / len;
			const head = c * 0.42;
			const width = c * 0.17;
			const bx = tx - ux * head;
			const by = ty - uy * head;
			const nx = -uy;
			const ny = ux;
			// prettier-ignore
			const shaft = [
				fx + nx * width * 0.5, fy + ny * width * 0.5,
				bx + nx * width * 0.5, by + ny * width * 0.5,
				bx + nx * head * 0.62, by + ny * head * 0.62,
				tx, ty,
				bx - nx * head * 0.62, by - ny * head * 0.62,
				bx - nx * width * 0.5, by - ny * width * 0.5,
				fx - nx * width * 0.5, fy - ny * width * 0.5,
			];
			a.poly(shaft)
				.fill({color: GOLD, alpha: 0.9})
				.stroke({color: INK, width: c * 0.03, alpha: 0.7});
		}
	}
}

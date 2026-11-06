import {describe, it, expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {rendererChoice} from '$lib/chess/render/choice';

describe('PUBLIC_RENDERER', () => {
	it('defaults to the canvas board when unset or empty', () => {
		expect(rendererChoice(undefined)).toBe('canvas');
		expect(rendererChoice('')).toBe('canvas');
		expect(rendererChoice('  ')).toBe('canvas');
	});

	it('reads canvas and pixi, ignoring case and spaces', () => {
		expect(rendererChoice('canvas')).toBe('canvas');
		expect(rendererChoice('pixi')).toBe('pixi');
		expect(rendererChoice(' PIXI ')).toBe('pixi');
	});

	it('refuses anything else rather than guess', () => {
		expect(() => rendererChoice('pixijs')).toThrow(
			/expected one of canvas, pixi/,
		);
	});
});

/**
 * `web/test/render-host-boundary.test.ts` (from upstream) checks the play
 * page's props against the FIRST host `index.ts` names. This game names two,
 * so this checks every one of them.
 */
describe('every host the selector can load', () => {
	const root = new URL('../../../../', import.meta.url).pathname;
	const read = (path: string) => readFileSync(`${root}${path}`, 'utf8');

	const hosts = [
		...read('src/lib/chess/render/index.ts').matchAll(
			/import\('\$lib\/(.*?\.svelte)'\)/g,
		),
	].map((m) => `src/lib/${m[1]}`);

	const passed = [
		...read('src/routes/play/+page.svelte')
			.match(/<GameCanvas\b([\s\S]*?)\/>/)![1]
			.matchAll(/(?:^|\s)([a-zA-Z][a-zA-Z0-9]*)=\{/g),
	].map((m) => m[1]);

	it('finds both hosts and the props the page passes', () => {
		expect(hosts).toEqual([
			'src/lib/chess/render/pixi/WoodenBoardCanvas.svelte',
			'src/lib/game/render/canvas2d/Canvas2DCanvas.svelte',
		]);
		expect(passed.length).toBeGreaterThanOrEqual(5);
	});

	it.each(hosts)('%s declares every prop the page passes', (host) => {
		const block = read(host).match(/interface Props \{([\s\S]*?)\n\t\}/)![1];
		const declared = [
			...block.matchAll(/^\t\t([a-zA-Z][a-zA-Z0-9]*)\??:/gm),
		].map((m) => m[1]);
		expect(passed.filter((prop) => !declared.includes(prop))).toEqual([]);
	});
});

import {describe, it, expect, vi} from 'vitest';
import type {Frame, GameRenderer} from '$lib/game/core/seams';
import {lazyRenderer} from '$lib/chess/render/lazy';

function fake() {
	return {
		onAppStarted: vi.fn(),
		onAppStopped: vi.fn(),
		tick: vi.fn(),
	} satisfies GameRenderer<string>;
}

const frame = {} as Frame;
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('lazyRenderer', () => {
	it('starts the real renderer once loaded, then forwards frames and stop', async () => {
		const real = fake();
		const renderer = lazyRenderer(async () => real);
		renderer.onAppStarted('surface');
		renderer.tick(frame);
		expect(real.tick).not.toHaveBeenCalled();

		await settle();
		expect(real.onAppStarted).toHaveBeenCalledWith('surface');
		renderer.tick(frame);
		expect(real.tick).toHaveBeenCalledWith(frame);

		renderer.onAppStopped();
		expect(real.onAppStopped).toHaveBeenCalledOnce();
		renderer.tick(frame);
		expect(real.tick).toHaveBeenCalledOnce();
	});

	it('never starts the real renderer if stopped while it was loading', async () => {
		const real = fake();
		const renderer = lazyRenderer(async () => real);
		renderer.onAppStarted('surface');
		renderer.onAppStopped();
		await settle();
		expect(real.onAppStarted).not.toHaveBeenCalled();
		expect(real.onAppStopped).not.toHaveBeenCalled();
	});

	it('loads nothing until it is first started', () => {
		const load = vi.fn(async () => fake());
		const renderer = lazyRenderer(load);
		renderer.tick(frame);
		renderer.onAppStopped();
		expect(load).not.toHaveBeenCalled();
	});

	it('starts only the latest of two starts made while loading', async () => {
		const real = fake();
		const load = vi.fn(async () => real);
		const renderer = lazyRenderer(load);
		renderer.onAppStarted('a');
		renderer.onAppStopped();
		renderer.onAppStarted('b');
		await settle();
		expect(load).toHaveBeenCalledOnce();
		expect(real.onAppStarted).toHaveBeenCalledOnce();
		expect(real.onAppStarted).toHaveBeenCalledWith('b');
	});

	it('survives a failed load and tries again on the next start', async () => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => {});
		const real = fake();
		const load = vi
			.fn<() => Promise<GameRenderer<string>>>()
			.mockRejectedValueOnce(new Error('chunk failed'))
			.mockResolvedValueOnce(real);
		const renderer = lazyRenderer(load);

		renderer.onAppStarted('a');
		await settle();
		expect(error).toHaveBeenCalledOnce();
		renderer.tick(frame);
		renderer.onAppStopped();

		renderer.onAppStarted('b');
		await settle();
		expect(load).toHaveBeenCalledTimes(2);
		expect(real.onAppStarted).toHaveBeenCalledWith('b');
		error.mockRestore();
	});

	it('loads once, however many times it is started', async () => {
		const load = vi.fn(async () => fake());
		const renderer = lazyRenderer(load);
		renderer.onAppStarted('a');
		await settle();
		renderer.onAppStopped();
		renderer.onAppStarted('b');
		await settle();
		expect(load).toHaveBeenCalledOnce();
	});
});

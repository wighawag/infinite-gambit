/**
 * Which renderer `PUBLIC_RENDERER` asks for, read from its raw value.
 *
 * Empty or unset means the canvas-2d board, which is the default. An unknown
 * value throws instead of falling back, so a typo in `.env.local` cannot
 * silently show the board you did not ask for.
 */
export const RENDERERS = ['canvas', 'pixi'] as const;

export type RendererChoice = (typeof RENDERERS)[number];

export function rendererChoice(raw: string | undefined): RendererChoice {
	const value = (raw ?? '').trim().toLowerCase();
	if (value === '') return 'canvas';
	if ((RENDERERS as readonly string[]).includes(value)) {
		return value as RendererChoice;
	}
	throw new Error(
		`PUBLIC_RENDERER is '${raw}', expected one of ${RENDERERS.join(', ')} (or empty for canvas)`,
	);
}

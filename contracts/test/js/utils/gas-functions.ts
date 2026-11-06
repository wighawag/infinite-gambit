import {readdirSync, readFileSync, statSync} from 'node:fs';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {artifacts} from '../../../rocketh/environment.js';

/**
 * WHICH SOLIDITY FUNCTION A STEP OF A TRACE RAN IN, from the compiler's source
 * map, so that `gas-profile.ts` can say what the "compute" of a transaction
 * was spent on, not only that it was spent.
 *
 * The legacy code generator marks a JUMP into an internal function with `i`
 * and the JUMP back out with `o`; a frame keeps a stack of the functions it is
 * in, pushed on `i` (named from the function whose definition the destination
 * maps to) and popped on `o`. A step's gas is the function's SELF gas, and the
 * INCLUSIVE gas of every distinct function on the stack. Under the optimiser
 * (`--build-profile production`) inlining blurs this: a function that was
 * inlined is counted in its caller.
 */

export type CodeMap = {
	/** the source location of each instruction, by program counter */
	locations: Map<number, {s: number; l: number; f: number; j: string}>;
};

export type FunctionIndex = {
	/** artifact name -> its code map */
	code: Map<string, CodeMap>;
	/** `start:length:file` of a function definition -> `Contract.function` */
	functions: Map<string, string>;
};

const here = dirname(fileURLToPath(import.meta.url));
const BUILD_INFO = join(here, '../../../artifacts/build-info');

/** The functions of the newest build, and the code maps of `artifactNames`. */
export function loadFunctionIndex(artifactNames: string[]): FunctionIndex {
	const outputs = readdirSync(BUILD_INFO)
		.filter((f) => f.endsWith('.output.json'))
		.map((f) => join(BUILD_INFO, f))
		.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
	const functions = new Map<string, string>();
	if (outputs.length > 0) {
		const output = JSON.parse(readFileSync(outputs[0], 'utf8')).output as {
			sources: Record<string, {ast: AstNode}>;
		};
		for (const {ast} of Object.values(output.sources))
			collect(ast, '', functions);
	}
	const code = new Map<string, CodeMap>();
	for (const name of artifactNames) {
		const artifact = (artifacts as any)[name];
		if (!artifact?.evm?.deployedBytecode?.sourceMap) continue;
		code.set(
			name,
			codeMap(
				artifact.evm.deployedBytecode.object,
				artifact.evm.deployedBytecode.sourceMap,
			),
		);
	}
	return {code, functions};
}

type AstNode = {
	nodeType: string;
	name?: string;
	kind?: string;
	src: string;
	nodes?: AstNode[];
};

function collect(node: AstNode, contract: string, out: Map<string, string>) {
	if (node.nodeType === 'ContractDefinition') contract = node.name!;
	if (
		node.nodeType === 'FunctionDefinition' ||
		node.nodeType === 'ModifierDefinition'
	) {
		out.set(node.src, `${contract}.${node.name || node.kind}`);
	}
	for (const child of node.nodes ?? []) collect(child, contract, out);
}

/** Decompress a source map and line it up with the instructions it maps. */
function codeMap(object: string, sourceMap: string): CodeMap {
	const hex = object.startsWith('0x') ? object.slice(2) : object;
	const entries = sourceMap.split(';');
	const locations: CodeMap['locations'] = new Map();
	let s = 0;
	let l = 0;
	let f = 0;
	let j = '-';
	let pc = 0;
	for (let k = 0; k < entries.length && pc * 2 < hex.length; k++) {
		const [ss, ll, ff, jj] = entries[k].split(':');
		if (ss) s = Number(ss);
		if (ll) l = Number(ll);
		if (ff) f = Number(ff);
		if (jj) j = jj;
		locations.set(pc, {s, l, f, j});
		const op = parseInt(hex.slice(pc * 2, pc * 2 + 2), 16);
		pc += op >= 0x60 && op <= 0x7f ? op - 0x5e : 1;
	}
	return {locations};
}

/** The functions a frame is in, and what each has spent. */
export class FunctionTracker {
	readonly self = new Map<string, number>();
	readonly inclusive = new Map<string, number>();
	private stacks: string[][] = [];

	constructor(private index: FunctionIndex) {}

	enter(artifact: string | undefined) {
		this.stacks.push([artifact ? `${artifact} (dispatch)` : '(no source map)']);
	}

	leave() {
		this.stacks.pop();
	}

	/** Book `cost` on the functions the current frame is in. */
	book(cost: number) {
		const stack = this.stacks[this.stacks.length - 1];
		if (!stack) return;
		const top = stack[stack.length - 1];
		this.self.set(top, (this.self.get(top) ?? 0) + cost);
		for (const name of new Set(stack))
			this.inclusive.set(name, (this.inclusive.get(name) ?? 0) + cost);
	}

	/** Follow a JUMP at `pc` of `artifact` that lands on `destination`. */
	jump(artifact: string | undefined, pc: number, destination: number) {
		const map = artifact ? this.index.code.get(artifact) : undefined;
		const stack = this.stacks[this.stacks.length - 1];
		if (!map || !stack) return;
		const j = map.locations.get(pc)?.j;
		if (j === 'i') {
			const at = map.locations.get(destination);
			const name = at
				? this.index.functions.get(`${at.s}:${at.l}:${at.f}`)
				: undefined;
			stack.push(name ?? '(compiler-generated helper)');
		} else if (j === 'o' && stack.length > 1) {
			stack.pop();
		}
	}
}

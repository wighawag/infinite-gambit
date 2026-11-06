import {keccak256, toHex, hexToBytes} from 'viem';
import {artifacts} from '../../../rocketh/environment.js';
import {FunctionTracker, type FunctionIndex} from './gas-functions.js';

/**
 * WHERE A TRANSACTION'S GAS GOES, folded from the node's struct-log trace
 * (`debug_traceTransaction`): by contract frame, by storage slot, and into the
 * handful of buckets `docs/gas.md` reports. Used by `GasProfile.test.ts`.
 *
 * MEASURES, NEVER ASSUMES. Every step's own cost is read off the trace (the
 * gas left before it minus the gas left after it, with a call's child frame
 * subtracted from the call), so the buckets add up to the execution gas
 * exactly, and the profile checks that intrinsic + execution - refund is the
 * receipt's `gasUsed` before it reports anything.
 *
 * SLOTS ARE NAMED FROM THE HASHES THE TRANSACTION ITSELF COMPUTED. Solidity
 * addresses a mapping entry by hashing the key and the mapping's slot in the
 * scratch space (memory 0x00 to 0x3f), so the profile shadows the MSTOREs
 * there and, at each KECCAK256 over it, keeps the preimage it saw if (and only
 * if) its hash is the one the EVM pushed. A slot is then the hash of a key and
 * a base, plus a field offset; the base is a state variable of the game's
 * storage layout (read from the compiled artifact) or of one of the ERC-7201
 * namespaces below.
 */

type Step = {
	pc: number;
	op: string;
	gas: number;
	gasCost: number;
	depth: number;
	stack?: string[];
	refund?: number;
};

/** A storage slot's use within one transaction. */
export type SlotUse = {
	/** where the slot lives: the storage context's name */
	contract: string;
	slot: bigint;
	/** e.g. `_squares[(1,2)].army` */
	label: string;
	/** the bucket it is reported under, e.g. `game: squares` */
	group: string;
	reads: number;
	readGas: number;
	writes: number;
	writeGas: number;
	/**
	 * What its first write cost, by EIP-2929/3529 pricing: `fresh` a zero slot
	 * made non-zero (20,000), `update` a non-zero slot changed (2,900), `same`
	 * a write of the value it already held or a slot already written this
	 * transaction (100); `cold` when it also paid the first access (2,100).
	 */
	firstWrite?: string;
	/** refund it earned (positive) or gave back (negative) */
	refund: number;
};

export type Profile = {
	gasUsed: number;
	intrinsic: number;
	calldata: number;
	execution: number;
	/** the refund counter at the end, before the cap */
	refundCounter: number;
	/** the refund actually applied: the counter, capped at a fifth */
	refund: number;
	/** execution gas by bucket */
	groups: Map<string, number>;
	/** execution gas by the contract whose CODE ran */
	contracts: Map<string, number>;
	slots: SlotUse[];
	/** how many storage operations of each price: `cold read`, `fresh`, ... */
	storageOps: Map<string, {count: number; gas: number}>;
	/** gas by Solidity function of the game's routes, if source maps were given */
	functions?: {self: Map<string, number>; inclusive: Map<string, number>};
};

/** The ERC-7201 namespace of the commit-reveal base (`CommitReveal.sol`). */
const COMMIT_REVEAL_NS =
	0xadc5f43ba75b96408298ed0e334b2a1fd450d7199af4cc31fa65c6246d8b9300n;
/** The ERC-7201 namespace of `@etherplay/delegation`. */
const DELEGATION_NS =
	0xe3a6fc8979f365f798ce92a5c63aa15935638389b80320c807252f142f884200n;
/** EIP-1967's implementation slot, where the proxy finds the router. */
const IMPLEMENTATION_SLOT =
	0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbcn;

/**
 * A state variable: where it starts, what it is called, and what the slots of
 * one VALUE of it are called (a mapping's entry, an array's element, or the
 * variable itself), by offset.
 */
type Root = {
	slot: bigint;
	name: string;
	group: string;
	kind: 'value' | 'mapping' | 'array';
	fields: string[];
	formatKey?: (key: bigint) => string;
};

const position = (key: bigint) => {
	const x = Number(BigInt.asIntN(32, key & 0xffffffffn));
	const y = Number(BigInt.asIntN(32, (key >> 32n) & 0xffffffffn));
	return `(${x},${y})`;
};
const shortId = (key: bigint) => {
	const hex = key.toString(16);
	return hex.length > 12
		? `0x${hex.slice(0, 6)}..${hex.slice(-4)}`
		: key.toString();
};

/** The bucket each of the game's own state variables is reported under. */
const GAME_GROUPS: Record<string, string> = {
	_armies: 'game: army record',
	_armyIds: 'game: army list',
	_armyCountOf: 'game: army count',
	_capturesBy: 'game: capture candidates',
	_spawns: 'game: spawn records',
	_squares: 'game: square records',
	_touchedSquares: 'game: zone index',
	_openSpawnIndices: 'game: open spawn set',
	_nextSpawnIndex: 'game: open spawn set',
	_awaitedArmies: 'game: awaited armies',
	_tableZones: 'game: table zones',
};

type LayoutType = {
	encoding: string;
	label: string;
	numberOfBytes: string;
	value?: string;
	base?: string;
	members?: {label: string; slot: string; type: string}[];
};

/** The names of the slots of one value of `type`, by offset. */
function fieldsOf(types: Record<string, LayoutType>, type: string): string[] {
	const t = types[type];
	if (!t.members) return [''];
	const bySlot: string[][] = [];
	for (const m of t.members) (bySlot[Number(m.slot)] ??= []).push(m.label);
	// A packed slot of many fields is named by its first and last.
	return [...bySlot].map((labels) =>
		!labels
			? ''
			: labels.length > 3
				? `.{${labels[0]}..${labels[labels.length - 1]}}`
				: `.${labels.join(',')}`,
	);
}

/** Every state variable the profile can name a slot of. */
function roots(): Root[] {
	const layout = (artifacts.GameReveal as any).storageLayout as {
		storage: {label: string; slot: string; type: string}[];
		types: Record<string, LayoutType>;
	};
	const list: Root[] = [];
	for (const v of layout.storage) {
		const t = layout.types[v.type];
		const group = GAME_GROUPS[v.label] ?? `game: ${v.label}`;
		const formatKey =
			v.label === '_squares'
				? position
				: v.label === '_touchedSquares' || v.label === '_spawns'
					? (k: bigint) => k.toString()
					: shortId;
		if (t.encoding === 'mapping') {
			list.push({
				slot: BigInt(v.slot),
				name: v.label,
				group,
				kind: 'mapping',
				fields: fieldsOf(layout.types, t.value!),
				formatKey,
			});
		} else if (t.encoding === 'dynamic_array') {
			list.push({
				slot: BigInt(v.slot),
				name: v.label,
				group,
				kind: 'array',
				fields: fieldsOf(layout.types, t.base!),
			});
		} else {
			list.push({
				slot: BigInt(v.slot),
				name: v.label,
				group,
				kind: 'value',
				fields: fieldsOf(layout.types, v.type),
			});
		}
	}
	const cr = (
		offset: number,
		name: string,
		group: string,
		kind: Root['kind'],
		fields: string[],
	) =>
		list.push({
			slot: COMMIT_REVEAL_NS + BigInt(offset),
			name: `commitReveal.${name}`,
			group,
			kind,
			fields,
			formatKey: shortId,
		});
	// `CommitReveal.Layout`, in declaration order (`src/commit-reveal/CommitReveal.sol`).
	cr(0, 'reserve', 'commit-reveal: reserve', 'mapping', ['']);
	cr(1, 'commitments', 'commit-reveal: commitment', 'mapping', [
		'.hash,cycleNumber',
		'.bond',
	]);
	cr(2, 'cycleState', 'commit-reveal: cycle state', 'value', [
		'.anchor..,earlyReveal..',
		'.commiting,lastCycleNumber',
	]);
	cr(4, 'tally', 'commit-reveal: attendance', 'value', [
		'.cycleNumber,committed,revealed',
	]);
	cr(5, 'waitedFor', 'commit-reveal: attendance', 'value', ['']);
	cr(6, 'isWaitedFor', 'commit-reveal: attendance', 'mapping', ['']);
	cr(7, 'roster', 'commit-reveal: roster', 'value', ['']);
	cr(8, 'members', 'commit-reveal: roster', 'array', ['']);
	cr(9, 'seatOf', 'commit-reveal: roster', 'mapping', ['']);
	cr(10, 'gameOptions', 'commit-reveal: roster', 'value', ['']);
	list.push({
		slot: DELEGATION_NS,
		name: 'delegation.status',
		group: 'delegation',
		kind: 'mapping',
		fields: [''],
		formatKey: shortId,
	});
	list.push({
		slot: IMPLEMENTATION_SLOT,
		name: 'eip1967.implementation',
		group: 'dispatch: proxy + router',
		kind: 'value',
		fields: [''],
	});
	return list;
}

const ROOTS = roots();

/** What `slot` is, given the preimages of the hashes the transaction computed. */
function nameSlot(
	slot: bigint,
	preimages: Map<bigint, bigint[]>,
	depth = 0,
): {label: string; group: string; fields?: string[]} {
	for (const r of ROOTS) {
		const offset = slot - r.slot;
		if (offset < 0n) continue;
		if (offset === 0n && r.kind !== 'value')
			return {label: r.name, group: r.group};
		if (r.kind === 'value' && offset < BigInt(r.fields.length)) {
			return {
				label: `${r.name}${r.fields[Number(offset)] ?? ''}`,
				group: r.group,
			};
		}
	}
	if (depth < 3) {
		for (let offset = 0n; offset < 8n; offset++) {
			const pre = preimages.get(slot - offset);
			if (!pre) continue;
			const [first, base] = pre;
			if (pre.length === 1) {
				// An array's element: its data starts at the hash of its slot.
				const root = ROOTS.find((r) => r.slot === first && r.kind === 'array');
				if (root) {
					const size = root.fields.length;
					const field = root.fields[Number(offset) % size] ?? '';
					return {
						label: `${root.name}[${(Number(offset) / size) | 0}]${field}`,
						group: root.group,
					};
				}
				continue;
			}
			const root = ROOTS.find((r) => r.slot === base && r.kind === 'mapping');
			if (root) {
				const key = (root.formatKey ?? shortId)(first);
				return {
					label: `${root.name}[${key}]${root.fields[Number(offset)] ?? `+${offset}`}`,
					group: root.group,
				};
			}
			// A mapping of mappings: name the outer entry, then this key.
			const outer = nameSlot(base, preimages, depth + 1);
			if (outer.group !== 'unknown') {
				return {label: `${outer.label}[${shortId(first)}]`, group: outer.group};
			}
		}
	}
	return {label: `0x${slot.toString(16)}`, group: 'unknown'};
}

const CALLS = new Set(['CALL', 'DELEGATECALL', 'STATICCALL', 'CALLCODE']);
const word = (hex: string) => BigInt(hex);
const pad = (v: bigint) => toHex(v, {size: 32}).slice(2);

/** What the profile needs to know about the contracts a trace runs through. */
export type Contracts = {
	/** a name per address, lower-case */
	names: Map<string, string>;
	/** the addresses whose code only forwards the call: the proxy and the router */
	dispatch: Set<string>;
	/** the addresses whose code is the game's own (its routes) */
	game: Set<string>;
	/** the artifact of each of those, for its source map */
	artifacts?: Map<string, string>;
	/** the source maps, to say which function the gas was spent in */
	functions?: FunctionIndex;
};

type Frame = {
	code: string;
	storage: string;
	scratch: Map<number, bigint>;
	acc: number;
	call: number;
};

const add = (m: Map<string, number>, k: string, v: number) =>
	m.set(k, (m.get(k) ?? 0) + v);

/** The profile of the mined transaction `hash`. */
export async function profileTransaction(
	provider: {
		request(args: {method: string; params?: unknown[]}): Promise<unknown>;
	},
	hash: `0x${string}`,
	contracts: Contracts,
): Promise<Profile> {
	const tx = (await provider.request({
		method: 'eth_getTransactionByHash',
		params: [hash],
	})) as {
		to: string;
		gas: string;
		input: `0x${string}`;
	};
	const receipt = (await provider.request({
		method: 'eth_getTransactionReceipt',
		params: [hash],
	})) as {gasUsed: string};
	const trace = (await provider.request({
		method: 'debug_traceTransaction',
		params: [hash, {disableMemory: true, disableStorage: true}],
	})) as {structLogs: Step[]};
	const steps = trace.structLogs;

	const nameOf = (a: string) => contracts.names.get(a) ?? a;
	const preimages = new Map<bigint, bigint[]>();
	const groups = new Map<string, number>();
	const byContract = new Map<string, number>();
	const slots = new Map<
		string,
		SlotUse & {raw: bigint; storageAddress: string}
	>();
	const priced = new Map<string, {count: number; gas: number}>();
	const price = (kind: string, cost: number) => {
		const p = priced.get(kind) ?? {count: 0, gas: 0};
		p.count++;
		p.gas += cost;
		priced.set(kind, p);
	};
	const storageOps: {
		key: string;
		raw: bigint;
		storage: string;
		cost: number;
	}[] = [];
	const to = tx.to.toLowerCase();
	const frames: Frame[] = [
		{code: to, storage: to, scratch: new Map(), acc: 0, call: -1},
	];
	let execution = 0;
	const tracker = contracts.functions
		? new FunctionTracker(contracts.functions)
		: undefined;
	const artifactOf = (a: string) => contracts.artifacts?.get(a);
	tracker?.enter(artifactOf(to));

	function useOf(storage: string, slot: bigint) {
		const key = `${storage}:${slot}`;
		let use = slots.get(key);
		if (!use) {
			use = {
				contract: nameOf(storage),
				slot,
				label: '',
				group: '',
				reads: 0,
				readGas: 0,
				writes: 0,
				writeGas: 0,
				refund: 0,
				raw: slot,
				storageAddress: storage,
			};
			slots.set(key, use);
		}
		return use;
	}

	/** Book `cost`, spent by `step` in `frame`. */
	function book(step: Step, frame: Frame, cost: number, i: number) {
		execution += cost;
		if (contracts.game.has(frame.code)) tracker?.book(cost);
		add(byContract, nameOf(frame.code), cost);
		let group: string;
		if (contracts.dispatch.has(frame.code)) group = 'dispatch: proxy + router';
		else if (!contracts.game.has(frame.code))
			group = `external: ${nameOf(frame.code)}`;
		else if (step.op === 'SLOAD' || step.op === 'SSTORE') group = 'storage';
		else if (step.op.startsWith('LOG')) group = 'events';
		else if (CALLS.has(step.op)) group = 'calls out';
		else if (step.op === 'KECCAK256') group = 'hashing';
		else group = 'compute';
		const stack = step.stack ?? [];
		if (step.op === 'SLOAD' || step.op === 'SSTORE') {
			const use = useOf(frame.storage, word(stack[stack.length - 1]));
			if (step.op === 'SLOAD') {
				price(cost >= 2100 ? 'read, cold' : 'read, warm', cost);
				use.reads++;
				use.readGas += cost;
			} else {
				use.writes++;
				use.writeGas += cost;
				const next = steps[i + 1];
				use.refund += (next?.refund ?? step.refund ?? 0) - (step.refund ?? 0);
				const cold = cost >= 2100 && [20000, 2900, 100].includes(cost - 2100);
				const base = cold ? cost - 2100 : cost;
				const kind =
					base === 20000
						? 'fresh'
						: base === 2900
							? 'update'
							: base === 100
								? 'same'
								: `${base}?`;
				price(`write, ${kind}${cold ? ' (cold)' : ''}`, cost);
				if (!use.firstWrite) use.firstWrite = cold ? `${kind} cold` : kind;
			}
			if (group === 'storage')
				storageOps.push({
					key: `${frame.storage}:${use.raw}`,
					raw: use.raw,
					storage: frame.storage,
					cost,
				});
		}
		if (group !== 'storage') add(groups, group, cost);
	}

	for (let i = 0; i < steps.length; i++) {
		const step = steps[i];
		const next = steps[i + 1];
		const frame = frames[frames.length - 1];
		const stack = step.stack ?? [];
		const top = (k: number) => word(stack[stack.length - 1 - k]);

		// THE SCRATCH SPACE, shadowed, for the preimages of mapping slots.
		if (step.op === 'MSTORE') {
			const offset = Number(top(0));
			if (offset === 0 || offset === 32) frame.scratch.set(offset, top(1));
			else if (offset < 64) frame.scratch.clear();
		} else if (
			/^(CALLDATACOPY|CODECOPY|RETURNDATACOPY|EXTCODECOPY|MCOPY|MSTORE8)$/.test(
				step.op,
			)
		) {
			if (Number(top(step.op === 'EXTCODECOPY' ? 1 : 0)) < 64)
				frame.scratch.clear();
		} else if (step.op === 'KECCAK256' && next && top(0) === 0n) {
			const size = Number(top(1));
			const words =
				size === 32
					? [frame.scratch.get(0)]
					: size === 64
						? [frame.scratch.get(0), frame.scratch.get(32)]
						: [];
			if (words.length && words.every((w) => w !== undefined)) {
				const hashed = word(
					keccak256(`0x${words.map((w) => pad(w!)).join('')}`),
				);
				const result = word(next.stack![next.stack!.length - 1]);
				if (hashed === result) preimages.set(result, words as bigint[]);
			}
		}

		if (next && next.depth > step.depth) {
			// A call entered: its own cost is known when it returns.
			const target = `0x${top(1).toString(16).padStart(40, '0')}`;
			const delegated = step.op === 'DELEGATECALL' || step.op === 'CALLCODE';
			frames.push({
				code: target,
				storage: delegated ? frame.storage : target,
				scratch: new Map(),
				acc: 0,
				call: i,
			});
			tracker?.enter(artifactOf(target));
			continue;
		}
		const cost =
			next && next.depth === step.depth ? step.gas - next.gas : step.gasCost;
		book(step, frame, cost, i);
		frame.acc += cost;
		if (step.op === 'JUMP' && next && next.depth === step.depth)
			tracker?.jump(artifactOf(frame.code), step.pc, next.pc);
		if (next && next.depth < step.depth) {
			const child = frames.pop()!;
			tracker?.leave();
			const parent = frames[frames.length - 1];
			const call = steps[child.call];
			const inclusive = call.gas - next.gas;
			book(call, parent, inclusive - child.acc, child.call);
			parent.acc += inclusive;
		}
	}

	for (const use of slots.values()) {
		const named = nameSlot(use.raw, preimages);
		use.label = named.label;
		use.group =
			contracts.game.has(use.storageAddress) ||
			contracts.dispatch.has(use.storageAddress)
				? named.group
				: `external: ${use.contract}`;
	}
	for (const r of storageOps) add(groups, slots.get(r.key)!.group, r.cost);

	const bytes = hexToBytes(tx.input);
	const calldata = bytes.reduce((sum, b) => sum + (b === 0 ? 4 : 16), 0);
	const intrinsic = Number(BigInt(tx.gas)) - steps[0].gas;
	const refundCounter = steps[steps.length - 1].refund ?? 0;
	const refund = Math.min(
		refundCounter,
		Math.floor((intrinsic + execution) / 5),
	);
	const gasUsed = Number(BigInt(receipt.gasUsed));
	if (intrinsic !== 21000 + calldata) {
		throw new Error(
			`intrinsic gas ${intrinsic} is not 21000 + calldata ${calldata}: an access list or a creation?`,
		);
	}
	if (intrinsic + execution - refund !== gasUsed) {
		throw new Error(
			`the profile does not add up: ${intrinsic} + ${execution} - ${refund} != gasUsed ${gasUsed}`,
		);
	}
	return {
		gasUsed,
		intrinsic: 21000,
		calldata,
		execution,
		refundCounter,
		refund,
		groups,
		contracts: byContract,
		slots: [...slots.values()],
		storageOps: priced,
		functions: tracker && {self: tracker.self, inclusive: tracker.inclusive},
	};
}

/** The order buckets are printed in; any other bucket follows, dearest first. */
const GROUP_ORDER = [
	'dispatch: proxy + router',
	'delegation',
	'commit-reveal: commitment',
	'commit-reveal: reserve',
	'commit-reveal: attendance',
	'commit-reveal: cycle state',
	'commit-reveal: roster',
	'game: square records',
	'game: spawn records',
	'game: zone index',
	'game: army record',
	'game: army count',
	'game: army list',
	'game: awaited armies',
	'game: capture candidates',
	'game: open spawn set',
	'events',
	'hashing',
	'calls out',
	'compute',
];

/** `profile` as text: the buckets, then every slot with what it cost. */
export function formatProfile(
	title: string,
	profile: Profile,
	options?: {slots?: boolean; functions?: number},
): string {
	const lines = [`${title}: gasUsed ${profile.gasUsed}`];
	const row = (name: string, gas: number) =>
		`  ${name.padEnd(30)} ${String(gas).padStart(8)}  ${((100 * gas) / profile.gasUsed).toFixed(1).padStart(5)}%`;
	lines.push(row('intrinsic (21000)', profile.intrinsic));
	lines.push(row('calldata', profile.calldata));
	const names = [...profile.groups.keys()].sort((a, b) => {
		const ia = GROUP_ORDER.indexOf(a);
		const ib = GROUP_ORDER.indexOf(b);
		if (ia >= 0 || ib >= 0) return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
		return profile.groups.get(b)! - profile.groups.get(a)!;
	});
	for (const name of names) lines.push(row(name, profile.groups.get(name)!));
	lines.push(row('refund', -profile.refund));
	const ops = [...profile.storageOps].sort(([a], [b]) => a.localeCompare(b));
	lines.push(
		`  storage ops: ${ops.map(([k, v]) => `${k} ${v.count}x = ${v.gas}`).join('; ')}`,
	);
	if (profile.functions && options?.functions) {
		const {self, inclusive} = profile.functions;
		const top = [...inclusive]
			.sort(([, a], [, b]) => b - a)
			.slice(0, options.functions);
		lines.push('  functions (inclusive / self):');
		for (const [name, gas] of top)
			lines.push(
				`    ${name.padEnd(56)} ${String(gas).padStart(8)} ${String(self.get(name) ?? 0).padStart(8)}`,
			);
	}
	if (options?.slots) {
		lines.push('  slots (reads/gas, writes/gas, first write, refund):');
		const slots = [...profile.slots].sort(
			(a, b) =>
				a.group.localeCompare(b.group) || a.label.localeCompare(b.label),
		);
		for (const s of slots) {
			const write = s.writes
				? `w${s.writes}/${s.writeGas} ${s.firstWrite}`
				: '';
			const refund = s.refund ? ` refund ${s.refund}` : '';
			lines.push(
				`    ${s.group.padEnd(28)} ${s.label.padEnd(44)} r${s.reads}/${s.readGas} ${write}${refund}`,
			);
		}
	}
	return lines.join('\n');
}

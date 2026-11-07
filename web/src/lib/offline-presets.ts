import {squareAt} from '$lib/chess/squares';
import type {Move} from '$lib/chess/commit-reveal';
import {tableOf, type Table} from '$lib/game/lobby/seats';

/**
 * OFFLINE DEMO PRESETS: named starting positions for the offline world, so a
 * given rule is ONE MOVE AWAY when the board first shows. Built for recording
 * the demo video with the network off, where a recorded move cannot be undone
 * and walking two armies into contact by hand takes many cycles.
 *
 * A PRESET IS DATA, and every piece of it is reached by LEGAL PLAY. The world
 * deploys the armies on the spawn points named here and plays the setup cycles
 * through the real contract, with the same calls a player makes
 * (`$lib/offline-preset-setup`): no cheat setter, no storage write, no demo
 * contract (`docs/adr/0007-rules-live-only-in-the-contract.md`). If a position
 * could not be reached by legal play the setup reverts, and the position is
 * what changes, never the rules.
 *
 * THE TIGHT GRID. Every preset deploys with `spawnSpacing` 6, the grid the
 * contract tests play on (`contracts/test/js/utils/moves-world.ts`), so armies
 * spawn next to each other: one empty column (x = 3) between the army on (0,0)
 * and the one on (6,0), one empty row (y = 3) between (0,0) and (0,6). An army
 * is the 5 by 5 square without its corners around its king on the spawn point
 * (`docs/adr/0015`):
 *
 *   y+2   .  P  P  P  .
 *   y+1   P  R  N  B  P
 *   y     P  Q  K  .  P      (the king on the spawn point, its east square empty)
 *   y-1   P  B  N  R  P
 *   y-2   .  P  P  P  .
 *
 * The positions are the ones the contract tests already prove:
 * `Collisions.test.ts` (two pawns stepping into the gap at (3,0)),
 * `KingCapture.test.ts` ("a capture in the offline world": a knight by (7,3)
 * and a pawn it takes, onto a king that stays) and `Exits.test.ts` (the king
 * walking by its rook's square and its empty corner onto the exit block
 * (3..4, -3..-2)).
 *
 * NO MERGES. A king taken by a lone piece makes its whole army vanish from the
 * board; the piece that took it becomes a queen and its army takes the whole
 * stake (`docs/adr/0013`).
 */

/** A square, as the tests write it. */
export type Square = readonly [number, number];

/** One piece-move of a preset, from and to. */
export type PresetMove = readonly [from: Square, to: Square];

/** What one army plays in one cycle; an army a cycle does not name passes. */
export type PresetTurn = {army: number; moves: readonly PresetMove[]};

/** A preset's army: which seat of its table owns it, and where it deploys. */
export type PresetArmy = {seat: number; spawn: Square};

export type OfflinePreset = {
	id: string;
	name: string;
	/** One line, for the preset list. */
	summary: string;
	/** How many seats are people at this device; the rest are world seats. */
	humans: number;
	/** How many seats in all (at least 3, like every offline table). */
	seats: number;
	/** Every seat's army, in seat order: one army per seat. */
	armies: readonly PresetArmy[];
	/** The cycles the world plays after the deployment, before showing the board. */
	setup: readonly (readonly PresetTurn[])[];
	/**
	 * THE MOVE TO MAKE, for the person recording: each line one move by one
	 * seat. Shown in the demo hint panel and in the preset list.
	 */
	hint: readonly string[];
	/**
	 * The same decisive move as data, what the tests play: each entry is one
	 * outcome (the hint's lines, in order) as the turns that make it.
	 */
	decisive: readonly {shows: string; turns: readonly PresetTurn[]}[];
	/**
	 * Seats that hold an army's stake and have NOT deployed: the person in one
	 * chooses a spawn point and deploys on camera. They own no army in
	 * `armies`, and the cycle waits for their deployment like every seat's.
	 */
	undeployed?: readonly number[];
};

/** Army indices, by where they deploy: the spiral's first four spawn points. */
const AT_ORIGIN: Square = [0, 0];
const EAST: Square = [6, 0];
const NORTH_EAST: Square = [6, 6];

/** Bring army 1's south knight (6,-1) into the gap at (3,0), in two cycles. */
const KNIGHT_INTO_THE_GAP: readonly PresetMove[] = [
	[
		[6, -1],
		[4, -2],
	],
	[
		[4, -2],
		[3, 0],
	],
];

/**
 * Bring army 1's north knight (6,1) by (7,3) onto the pawn (5,4) of the army on
 * (6,6), which it takes: from there it reaches that army's king (6,6).
 */
const KNIGHT_ONTO_THE_PAWN: readonly PresetMove[] = [
	[
		[6, 1],
		[7, 3],
	],
	[
		[7, 3],
		[5, 4],
	],
];

const DODGE = {
	shows: 'dodge',
	turns: [
		{
			army: 0,
			moves: [
				[
					[2, 1],
					[3, 0],
				],
			],
		},
		{
			army: 1,
			moves: [
				[
					[3, 0],
					[4, 2],
				],
			],
		},
	],
} as const satisfies OfflinePreset['decisive'][number];

const COLLISION_BELOW = {
	shows: 'collision',
	turns: [
		{
			army: 0,
			moves: [
				[
					[2, -1],
					[3, -1],
				],
			],
		},
		{
			army: 1,
			moves: [
				[
					[4, -1],
					[3, -1],
				],
			],
		},
	],
} as const satisfies OfflinePreset['decisive'][number];

const KING_CAPTURE = {
	shows: 'king-capture',
	turns: [
		{
			army: 1,
			moves: [
				[
					[5, 4],
					[6, 6],
				],
			],
		},
	],
} as const satisfies OfflinePreset['decisive'][number];

export const OFFLINE_PRESETS: readonly OfflinePreset[] = [
	{
		id: 'showcase',
		name: 'Showcase',
		summary:
			'A dodge, a collision and a king capture, each one move away, for one take.',
		humans: 2,
		seats: 3,
		armies: [
			{seat: 0, spawn: AT_ORIGIN},
			{seat: 1, spawn: EAST},
			{seat: 2, spawn: NORTH_EAST},
		],
		setup: [
			[
				{
					army: 1,
					moves: [KNIGHT_INTO_THE_GAP[0], KNIGHT_ONTO_THE_PAWN[0]],
				},
			],
			[
				{
					army: 1,
					moves: [KNIGHT_INTO_THE_GAP[1], KNIGHT_ONTO_THE_PAWN[1]],
				},
			],
		],
		hint: [
			"Dodge: Player 1's pawn (2,1) takes diagonally onto Player 2's knight in the gap (3,0), and Player 2's knight jumps away to (4,2). The pawn lands on the empty square, nothing is captured.",
			"Collision: Player 1's pawn (2,-1) and Player 2's pawn (4,-1) both step into the gap (3,-1). Both die.",
			"King capture (play it last): Player 2's knight (5,4) takes the world's king (6,6), which stays. The world's army leaves the board, the knight becomes a queen, and Player 2 takes the whole stake.",
		],
		decisive: [DODGE, COLLISION_BELOW, KING_CAPTURE],
	},
	{
		id: 'showcase-spawn',
		name: 'Showcase, with a spawn choice',
		summary:
			'The showcase, plus a third person who has a stake and still chooses where to deploy, on camera.',
		humans: 3,
		seats: 4,
		armies: [
			{seat: 0, spawn: AT_ORIGIN},
			{seat: 1, spawn: EAST},
			{seat: 3, spawn: NORTH_EAST},
		],
		undeployed: [2],
		setup: [
			[
				{
					army: 1,
					moves: [KNIGHT_INTO_THE_GAP[0], KNIGHT_ONTO_THE_PAWN[0]],
				},
			],
			[
				{
					army: 1,
					moves: [KNIGHT_INTO_THE_GAP[1], KNIGHT_ONTO_THE_PAWN[1]],
				},
			],
		],
		hint: [
			'Spawn choice: Player 3 has a stake and no army yet. On their turn, choose a spawn point and press Deploy. The cycle waits for that deployment; Players 1 and 2 may play the dodge or the collision in the same cycle, or pass.',
			"Dodge: Player 1's pawn (2,1) takes diagonally onto Player 2's knight in the gap (3,0), and Player 2's knight jumps away to (4,2). The pawn lands on the empty square, nothing is captured.",
			"Collision: Player 1's pawn (2,-1) and Player 2's pawn (4,-1) both step into the gap (3,-1). Both die.",
			"King capture (play it last): Player 2's knight (5,4) takes the world's king (6,6), which stays. The world's army leaves the board, the knight becomes a queen, and Player 2 takes the whole stake.",
		],
		decisive: [DODGE, COLLISION_BELOW, KING_CAPTURE],
	},
	{
		id: 'chase-trade',
		name: 'Chase and trade',
		summary:
			'Three piece-moves at once: the king steps away from a knight, its queen takes its square, and the queen and the knight both die there.',
		humans: 2,
		seats: 3,
		armies: [
			{seat: 0, spawn: AT_ORIGIN},
			{seat: 1, spawn: EAST},
			{seat: 2, spawn: NORTH_EAST},
		],
		// `ThreePieceMoves.test.ts`, `knightOnTheCorner` then the first cycle of
		// `chaseTrade`: Player 2's knight (6,-1) to its corner (4,-2), then onto
		// Player 1's pawn (2,-1), which it takes: one jump from the king (0,0).
		setup: [
			[{army: 1, moves: [KNIGHT_INTO_THE_GAP[0]]}],
			[
				{
					army: 1,
					moves: [
						[
							[4, -2],
							[2, -1],
						],
					],
				},
			],
		],
		hint: [
			"Player 1, one move of two piece-moves: the king (0,0) steps to its empty square (1,0) and the queen (-1,0) moves onto the king's square (0,0). Player 2's knight (2,-1) jumps onto (0,0). The queen and the knight arrive together with no king there: both die, and the king is safe on (1,0).",
		],
		decisive: [
			{
				shows: 'chase-trade',
				turns: [
					{
						army: 0,
						moves: [
							[
								[0, 0],
								[1, 0],
							],
							[
								[-1, 0],
								[0, 0],
							],
						],
					},
					{
						army: 1,
						moves: [
							[
								[2, -1],
								[0, 0],
							],
						],
					},
				],
			},
		],
	},
	{
		id: 'collision',
		name: 'Collision',
		summary: 'Two pawns step onto one empty square, and both die.',
		humans: 2,
		seats: 3,
		armies: [
			{seat: 0, spawn: AT_ORIGIN},
			{seat: 1, spawn: EAST},
			{seat: 2, spawn: NORTH_EAST},
		],
		setup: [],
		hint: [
			"Player 1's pawn (2,0) and Player 2's pawn (4,0) both step into the gap (3,0). Both die.",
		],
		decisive: [
			{
				shows: 'collision',
				turns: [
					{
						army: 0,
						moves: [
							[
								[2, 0],
								[3, 0],
							],
						],
					},
					{
						army: 1,
						moves: [
							[
								[4, 0],
								[3, 0],
							],
						],
					},
				],
			},
		],
	},
	{
		id: 'king-capture',
		name: 'King capture',
		summary:
			'A lone knight takes a king that stays: the army vanishes and its stake is the captor’s.',
		humans: 2,
		seats: 3,
		armies: [
			{seat: 0, spawn: AT_ORIGIN},
			{seat: 1, spawn: EAST},
			{seat: 2, spawn: NORTH_EAST},
		],
		setup: [
			[{army: 1, moves: [KNIGHT_ONTO_THE_PAWN[0]]}],
			[{army: 1, moves: [KNIGHT_ONTO_THE_PAWN[1]]}],
		],
		hint: [
			"Player 2's knight (5,4) takes the world's king (6,6), which stays. Player 1 passes. The world's army leaves the board, the knight becomes a queen, and Player 2 takes the whole stake.",
		],
		decisive: [KING_CAPTURE],
	},
	{
		id: 'dodge',
		name: 'Dodge',
		summary:
			'A pawn attacks a knight that steps away: it lands on the empty square.',
		humans: 2,
		seats: 3,
		armies: [
			{seat: 0, spawn: AT_ORIGIN},
			{seat: 1, spawn: EAST},
			{seat: 2, spawn: NORTH_EAST},
		],
		setup: [
			[{army: 1, moves: [KNIGHT_INTO_THE_GAP[0]]}],
			[{army: 1, moves: [KNIGHT_INTO_THE_GAP[1]]}],
		],
		hint: [
			"Player 1's pawn (2,1) takes diagonally onto Player 2's knight (3,0), and Player 2's knight jumps away to (4,2). The pawn lands on the empty square, nothing is captured.",
		],
		decisive: [DODGE],
	},
	{
		id: 'exit',
		name: 'Exit',
		summary: 'A king steps onto an exit, and its stake is paid out in ETH.',
		humans: 1,
		seats: 3,
		armies: [
			{seat: 0, spawn: AT_ORIGIN},
			{seat: 1, spawn: EAST},
			{seat: 2, spawn: NORTH_EAST},
		],
		// `Exits.test.ts`: the rook steps into the empty core square, the king
		// goes by the rook's square to the empty corner (2,-2), beside the exit
		// block (3..4, -3..-2).
		setup: [
			[
				{
					army: 0,
					moves: [
						[
							[1, -1],
							[1, 0],
						],
					],
				},
			],
			[
				{
					army: 0,
					moves: [
						[
							[0, 0],
							[1, -1],
						],
					],
				},
			],
			[
				{
					army: 0,
					moves: [
						[
							[1, -1],
							[2, -2],
						],
					],
				},
			],
		],
		hint: [
			'Your king (2,-2) steps onto the exit (3,-2). Once the cycle closes the army has left, and the payout button pays its stake in ETH.',
		],
		decisive: [
			{
				shows: 'exit',
				turns: [
					{
						army: 0,
						moves: [
							[
								[2, -2],
								[3, -2],
							],
						],
					},
				],
			},
		],
	},
];

/** The preset of this id, if there is one. */
export function presetById(
	id: string | null | undefined,
): OfflinePreset | undefined {
	if (!id) return undefined;
	return OFFLINE_PRESETS.find((preset) => preset.id === id);
}

/** The table a preset seats: its people first, then the world's seats, all `random`. */
export function presetTable(preset: OfflinePreset): Table {
	return tableOf(preset.seats, preset.humans);
}

/**
 * Who owns each seat's army: a person's account from the world's wallet (`you`
 * is the first, a `local-human` the one at its index), a world seat's own key.
 */
export function seatOwners(
	table: Table,
	humanAccounts: readonly `0x${string}`[],
): `0x${string}`[] {
	return table.map((seat, index) => {
		const occupant = seat.occupant;
		const owner =
			occupant.kind === 'you'
				? humanAccounts[0]
				: occupant.kind === 'local-human'
					? humanAccounts[occupant.account]
					: occupant.kind === 'the-world'
						? occupant.address
						: undefined;
		if (!owner) throw new Error(`preset seat ${index} has no account`);
		return owner;
	});
}

/** A preset's piece-moves, as the contract's moves. */
export function movesOf(moves: readonly PresetMove[]): Move[] {
	return moves.map(([[fx, fy], [tx, ty]]) => ({
		from: squareAt(fx, fy),
		to: squareAt(tx, ty),
	}));
}

/**
 * THE SPAWN SPACING EVERY PRESET DEPLOYS WITH: the tight grid of the contract
 * tests. The only number a preset's deployment changes.
 */
export const PRESET_SPAWN_SPACING = 6n;

/**
 * THE PRESET WALLET'S MNEMONIC, FIXED, so a preset gives the same accounts and
 * so the same army ids every time, in every browser. It holds nothing: the
 * chain it signs for exists only in the tab, for the length of one take. NOT
 * hardhat's well-known one, whose first accounts are the world's deployer and
 * admin.
 */
export const PRESET_MNEMONIC =
	'egg bone stone apart ocean outside number beyond menu confirm library require';

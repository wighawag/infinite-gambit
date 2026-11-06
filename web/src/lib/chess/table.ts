/**
 * THIS GAME'S TABLES: where its factory is, and what a table's
 * deployment record is (`$lib/game/lobby/table`'s `TableLobby`).
 *
 * A table is the world's record with the game at the table's address: the ABI
 * of the lobby implementation it is a clone of (the world's routes plus
 * the base's `CommitRevealLobby`), and the config every table plays by, which
 * `contracts/deploy/030_deploy_lobby.ts` records on the factory. The simulation
 * route the preview runs is the lobby implementation's, built with that config.
 * Everything else (the token, the sale) is the world's.
 *
 * WHAT A CREATOR CHOOSES FOR THE GAME is how many piece-moves a move holds:
 * up to three, the default and the worlds' rule, or one (`./piece-moves.ts`,
 * one bit of the table's `gameOptions`, `docs/adr/0016`).
 */
import type {TypedDeployments} from '$lib/deployments-store';
import type {TableLobby, TableOptions} from '$lib/game/lobby/table';
import {gameOptionsFor, maxPieceMovesOf} from './piece-moves';

/** The field the lobby asks for: 1 for one piece-move a cycle, 0 for up to three. */
const ONE_PIECE_MOVE_FIELD = 'onePieceMove';

const pieceMovesOptions: TableOptions = {
	fields: [
		{
			id: ONE_PIECE_MOVE_FIELD,
			label: 'One piece-move a cycle? 1 for one, 0 for up to three',
			min: 0,
			max: 1,
			default: 0,
		},
	],
	encode: (values) => gameOptionsFor(values[ONE_PIECE_MOVE_FIELD] === 1),
	describe(gameOptions) {
		const cap = maxPieceMovesOf(gameOptions);
		if (cap === undefined) return [];
		return [
			{label: 'Piece-moves a cycle', value: cap === 1 ? '1' : `up to ${cap}`},
		];
	},
};

export const chessLobby: TableLobby = {
	factory: (deployments) => deployments.contracts.GameFactory,
	options: pieceMovesOptions,
	deploymentsAt(deployments, table) {
		const {contracts} = deployments;
		return {
			...deployments,
			contracts: {
				...contracts,
				Game: {
					...contracts.GameLobbyImplementation,
					address: table,
					linkedData: contracts.GameFactory.linkedData,
				},
				Game_Implementation_Router_Simulation_Route:
					contracts.GameLobbyImplementation_Router_Simulation_Route,
			},
		} as unknown as TypedDeployments;
	},
};

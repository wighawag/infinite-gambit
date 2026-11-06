import {describe, it} from 'node:test';
import assert from 'node:assert';
import {artifacts} from '../../rocketh/environment.js';

/**
 * THE RECORDS' SHAPE IN STORAGE, which is what a move pays for
 * (`docs/gas.md`). Read from the compiled storage layout, so a field added
 * to a record that pushes it over a slot fails here rather than showing up
 * later as a dearer reveal.
 *
 * A square record and a spawn record are ONE slot each: they name armies by
 * their compact index (`UsingGameStore-ArmyRecord.index`), never by the
 * 256-bit id. An army record keeps everything a reveal or a commit reads in
 * its first two slots; the third holds what only a capture's fold and the
 * stake views read.
 */

type Member = {label: string; slot: string; offset: number; type: string};
type LayoutType = {
	encoding: string;
	label: string;
	numberOfBytes: string;
	members?: Member[];
	value?: string;
};
type Layout = {
	storage: {label: string; type: string}[];
	types: Record<string, LayoutType>;
};

const layout = (artifacts.GameReveal as any).storageLayout as Layout;

function recordOf(mapping: string): LayoutType {
	const v = layout.storage.find((s) => s.label === mapping);
	assert.ok(v, `no state variable ${mapping}`);
	return layout.types[layout.types[v.type].value!];
}

function slotOf(record: LayoutType, field: string): number {
	const m = record.members!.find((x) => x.label === field);
	assert.ok(m, `no field ${field} in ${record.label}`);
	return Number(m.slot);
}

describe('the storage layout of the records', function () {
	it('keeps a square record in one slot', function () {
		assert.strictEqual(Number(recordOf('_squares').numberOfBytes), 32);
	});

	it('lays a square record out as the one-store write packs it', function () {
		// `UsingGameBoard-_storeSquare` writes the record in one store, at
		// these byte offsets.
		const record = recordOf('_squares');
		const offsets = Object.fromEntries(
			record.members!.map((m) => [m.label, m.offset]),
		);
		assert.deepStrictEqual(offsets, {
			cycle: 0,
			kind: 8,
			departed: 9,
			arrivals: 10,
			kingArrived: 14,
			arriverKind: 15,
			armyIndex: 16,
			arriverIndex: 20,
			kingIndex: 24,
		});
	});

	it('keeps a spawn record in one slot', function () {
		assert.strictEqual(Number(recordOf('_spawns').numberOfBytes), 32);
	});

	it('keeps what a reveal and a commit read of an army in its first two slots', function () {
		const army = recordOf('_armies');
		assert.ok(
			Number(army.numberOfBytes) <= 96,
			'an army record is three slots at most',
		);
		for (const field of [
			'owner',
			'deployCycle',
			'spawnIndexPlusOne',
			'index',
			'kingMovedIn',
			'kingTo',
			'kingFrom',
			'cancelled',
			'exited',
			'frozen',
			'atTable',
			'fallen',
		]) {
			assert.ok(
				slotOf(army, field) <= 1,
				`${field} is read by every reveal and commit`,
			);
		}
	});
});

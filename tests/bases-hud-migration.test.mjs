import { test } from 'node:test';
import assert from 'node:assert/strict';
import { migrateBm5eHudPreferences } from '../scripts/bases-hud-migration.mjs';

function fixture(saved = {}) {
	const values = { bm5eHudMigrated: false, hudEnabled: false, hudColumns: 3, hudClearEffectsEnabled: false };
	const writes = [];
	const game = {
		system: { id: 'dnd5e' }, userId: 'user-a',
		settings: {
			get: (namespace, key) => { assert.equal(namespace, 'bases'); return values[key]; },
			set: async (namespace, key, value) => { assert.equal(namespace, 'bases'); writes.push(key); values[key] = value; },
			storage: new Map([['world', { getSetting: (key, user) => {
				assert.equal(user, 'user-a');
				return Object.hasOwn(saved, key) ? { _source: { value: JSON.stringify(saved[key]) } } : undefined;
			} }]]),
		},
	};
	return { game, values, writes };
}

test('copies saved BM5E preferences and restores a previously disabled BASES HUD', async () => {
	const { game, values, writes } = fixture({
		'bm5e.hudEnabled': true, 'bm5e.hudColumns': 4, 'bm5e.hudFlowMode': 'columns',
		'bm5e.hudScaleEnabled': false, 'bm5e.hudScale': 80, 'bm5e.hudFilterEnabled': true,
	});
	await migrateBm5eHudPreferences(game);
	assert.equal(values.hudEnabled, true);
	assert.equal(values.hudColumns, 4);
	assert.equal(values.hudFlowMode, 'columns');
	assert.equal(values.hudScaleEnabled, false);
	assert.equal(values.hudScale, 80);
	assert.equal(values.hudFilterEnabled, true);
	assert.equal(values.hudClearEffectsEnabled, false);
	assert.equal(writes.at(-1), 'bm5eHudMigrated');
	values.hudColumns = 6;
	const count = writes.length;
	await migrateBm5eHudPreferences(game);
	assert.equal(values.hudColumns, 6);
	assert.equal(writes.length, count);
});

test('does not overwrite preferences without a saved BM5E value', async () => {
	const { game, values } = fixture({ 'bm5e.hudFilterEnabled': false });
	values.hudEnabled = true;
	await migrateBm5eHudPreferences(game);
	assert.equal(values.hudEnabled, true);
	assert.equal(values.hudColumns, 3);
	assert.equal(values.hudFilterEnabled, false);
});

test('does nothing for other systems or users with no saved BM5E preferences', async () => {
	const { game, writes } = fixture();
	await migrateBm5eHudPreferences(game);
	assert.deepEqual(writes, []);
	game.system.id = 'draw-steel';
	game.settings.storage = null;
	await migrateBm5eHudPreferences(game);
	assert.deepEqual(writes, []);
});

test('does not mark migration complete when saving fails', async () => {
	const { game, values } = fixture({ 'bm5e.hudColumns': 4 });
	game.settings.set = async () => { throw new Error('save failed'); };
	await assert.rejects(migrateBm5eHudPreferences(game), /save failed/);
	assert.equal(values.bm5eHudMigrated, false);
});

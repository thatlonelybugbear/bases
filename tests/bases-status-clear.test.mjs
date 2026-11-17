import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clearDnd5eHudEffects, supportsHudEffectClearing } from '../scripts/bases-status-clear.mjs';

function fixture() {
	const actor = { isOwner: true, effects: new Map(), calls: [] };
	actor.effects[Symbol.iterator] = function* () { yield* this.values(); };
	actor.deleteEmbeddedDocuments = async (type, ids) => actor.calls.push({ type, ids });
	const add = (id, statuses = [], extra = {}) => {
		const effect = { id, statuses: new Set(statuses), documentName: 'ActiveEffect', parent: actor, ...extra };
		actor.effects.set(id, effect);
		return effect;
	};
	return { actor, add };
}

test('clears every duplicate and leveled condition, including disabled copies, in one batch', async () => {
	const { actor, add } = fixture();
	add('poison-1', ['poisoned']);
	add('poison-2', ['poisoned'], { disabled: true });
	add('exhaustion', ['exhaustion'], { system: { level: 4 } });
	add('compound', ['poisoned', 'blinded']);
	add('unrelated');
	actor.toggleStatusEffect = () => assert.fail('Must not toggle or increment conditions');
	await clearDnd5eHudEffects(actor, ['poisoned', 'exhaustion']);
	assert.deepEqual(actor.calls, [{ type: 'ActiveEffect', ids: ['poison-1', 'poison-2', 'exhaustion', 'compound'] }]);
});

test('preserves falling even in disabled, compound, or custom HUD effects', async () => {
	const { actor, add } = fixture();
	const falling = add('falling', ['falling']);
	const disabled = add('disabled-falling', ['falling'], { disabled: true });
	const compound = add('compound-falling', ['falling', 'prone']);
	add('prone', ['prone']);
	await clearDnd5eHudEffects(actor, ['falling', 'prone'], [falling, disabled, compound]);
	assert.deepEqual(actor.calls, [{ type: 'ActiveEffect', ids: ['prone'] }]);
});

test('custom HUD effects must be actual effects directly owned by this actor', async () => {
	const { actor, add } = fixture();
	const custom = add('custom');
	const foreign = { ...custom, id: 'foreign', parent: {} };
	const itemOwned = { ...custom, id: 'item', parent: { actor } };
	await clearDnd5eHudEffects(actor, [], [custom, custom, foreign, itemOwned, { ...custom }, null]);
	assert.deepEqual(actor.calls, [{ type: 'ActiveEffect', ids: ['custom'] }]);
});

test('does nothing without ownership or when there is nothing to clear', async () => {
	const { actor, add } = fixture();
	await clearDnd5eHudEffects(actor, ['prone']);
	add('prone', ['prone']);
	actor.isOwner = false;
	await clearDnd5eHudEffects(actor, ['prone']);
	await clearDnd5eHudEffects(null, ['prone']);
	assert.deepEqual(actor.calls, []);
});

test('propagates deletion failures for the HUD error handler', async () => {
	const { actor, add } = fixture();
	add('prone', ['prone']);
	actor.deleteEmbeddedDocuments = async () => { throw new Error('denied'); };
	await assert.rejects(clearDnd5eHudEffects(actor, ['prone']), /denied/);
});

test('only D&D 5e is currently supported', () => {
	assert.equal(supportsHudEffectClearing('dnd5e'), true);
	for (const id of ['draw-steel', 'pf2e', 'daggerheart', 'dc20rpg', undefined]) {
		assert.equal(supportsHudEffectClearing(id), false);
	}
});

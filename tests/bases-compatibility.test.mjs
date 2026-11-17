import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canUseBasesHud } from '../scripts/bases-compatibility.mjs';
import { supportsHudEffectClearing } from '../scripts/bases-status-clear.mjs';
import { migrateBm5eHudPreferences } from '../scripts/bases-hud-migration.mjs';

test('5e integration requires inactive BM5E or a version strictly above the cutoff', async () => {
	const previous = globalThis.foundry;
	const calls = [];
	globalThis.foundry = { utils: { isNewerVersion: (version, cutoff) => {
		calls.push([version, cutoff]);
		return version.localeCompare(cutoff, undefined, { numeric: true }) > 0;
	} } };
	try {
		for (const [bm5e, allowed] of [
			[undefined, true],
			[{ active: false, version: '14.600' }, true],
			[{ active: true, version: '14.610.1' }, false],
			[{ active: true, version: '14.610.1.1' }, false],
			[{ active: true, version: '14.610.1.2' }, true],
			[{ active: true, version: '14.611.0' }, true],
		]) {
			const game = { system: { id: 'dnd5e' }, modules: new Map([['bm5e', bm5e]]) };
			assert.equal(canUseBasesHud(game), allowed);
			assert.equal(supportsHudEffectClearing('dnd5e', game), allowed);
			if (!allowed) {
				game.settings = { get: () => assert.fail('Blocked migration must not read or change preferences') };
				await migrateBm5eHudPreferences(game);
			}
			game.system.id = 'draw-steel';
			assert.equal(canUseBasesHud(game), true);
			assert.equal(supportsHudEffectClearing('draw-steel', game), false);
		}
		assert.ok(calls.length > 0);
		assert.ok(calls.every(([, cutoff]) => cutoff === '14.610.1.1'));
	} finally {
		if (previous === undefined) delete globalThis.foundry;
		else globalThis.foundry = previous;
	}
});

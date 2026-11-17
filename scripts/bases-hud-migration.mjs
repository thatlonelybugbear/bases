import { canUseBasesHud } from './bases-compatibility.mjs';

const HUD_PREFERENCES = ['hudEnabled', 'hudFlowMode', 'hudColumns', 'hudScaleEnabled', 'hudScale', 'hudFilterEnabled'];

export async function migrateBm5eHudPreferences(game) {
	if (game.system.id !== 'dnd5e' || !canUseBasesHud(game) || game.settings.get('bases', 'bm5eHudMigrated')) return;
	const storage = game.settings.storage.get('world');
	const preferences = [];
	for (const key of HUD_PREFERENCES) {
		// User settings remain in world storage even when BM5E is inactive.
		const document = storage.getSetting(`bm5e.${key}`, game.userId);
		if (!document) continue;
		preferences.push([key, JSON.parse(document._source.value)]);
	}
	if (!preferences.length) return;
	for (const [key, value] of preferences) {
		if (game.settings.get('bases', key) !== value) await game.settings.set('bases', key, value);
	}
	// Only mark success after every preference has been saved.
	await game.settings.set('bases', 'bm5eHudMigrated', true);
}

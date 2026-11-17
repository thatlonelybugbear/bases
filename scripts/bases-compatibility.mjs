export function canUseBasesHud(game) {
	if (game.system.id !== 'dnd5e') return true;
	const bm5e = game.modules?.get('bm5e');
	return !bm5e?.active || foundry.utils.isNewerVersion(bm5e.version, '14.610.1.1');
}

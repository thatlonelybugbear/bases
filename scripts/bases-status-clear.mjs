import { canUseBasesHud } from './bases-compatibility.mjs';

export function supportsHudEffectClearing(systemId, game) {
	return systemId === 'dnd5e' && (!game || canUseBasesHud(game));
}

export async function clearDnd5eHudEffects(actor, statusIds, customEffects = []) {
	if (!actor?.isOwner) return;
	const statuses = new Set(statusIds);
	const ids = new Set();
	// Snapshot all copies, including disabled effects and leveled conditions.
	// Delete documents rather than toggling: 5e toggles can increase levels.
	for (const effect of actor.effects) {
		// Falling is maintained automatically by 5e's movement rules.
		if (effect.statuses?.has('falling')) continue;
		if (Array.from(effect.statuses ?? []).some((id) => statuses.has(id))) ids.add(effect.id);
	}
	for (const effect of customEffects) {
		if (effect?.statuses?.has('falling')) continue;
		if (effect?.documentName === 'ActiveEffect' && effect.parent === actor && actor.effects.get(effect.id) === effect) ids.add(effect.id);
	}
	if (ids.size) return actor.deleteEmbeddedDocuments('ActiveEffect', [...ids]);
}

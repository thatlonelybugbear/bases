import Constants from './bases-constants.mjs';
import { registerSettings } from './bases-settings.mjs';

Hooks.once('init', registerSettings);

Hooks.once('ready', basesReady);
Hooks.on('renderSettingsConfig', statusesRenderSettingsConfigHook);
Hooks.on('renderTokenHUD', statusesRenderTokenHUDHook);

function ensureHudStyle() {
	let el = document.getElementById(Constants.STYLE_ID);
	if (!el) {
		el = document.createElement('style');
		el.id = Constants.STYLE_ID;
		document.head.appendChild(el);
	}

	const dnd5eOverrides =
		game.system.id === 'dnd5e' ?
			`
		#token-hud.bases-hud-enabled .status-effects .effect-control[data-status-id="exhaustion"] {
			background: none !important;
		}
	`
		:	'';
	el.textContent = `
        #token-hud.bases-hud-enabled .status-effects {
            --effect-size: 48px;
            display: grid;

            grid-auto-flow: var(--bases-grid-auto-flow, row);
            grid-template-rows: var(--bases-grid-template-rows, none);
            grid-template-columns: var(--bases-grid-template-columns, none);
        }
        #token-hud.bases-hud-enabled .status-effects .effect-control {
            display: flex;
            width: auto;
        }
        #token-hud.bases-hud-enabled .status-effects .effect-control p {
            margin-left: 5px;
            font-size: x-large;
			overflow: hidden;
			white-space: nowrap;
			text-overflow: ellipsis;
			pointer-events: none;
        }
		${dnd5eOverrides}
    `;
}

function applyHudGridSettings({ mode, cols } = {}) {
	const root = document.documentElement;

	mode ??= game.settings.get(Constants.MODULE_ID, 'hudFlowMode');
	cols ??= Number(game.settings.get(Constants.MODULE_ID, 'hudColumns')) || 3;

	const statusLength = CONFIG.statusEffects.filter((s) => s.hud !== false).length;
	const rows = Math.ceil(statusLength / cols);

	// columns are always defined
	root.style.setProperty('--bases-grid-template-columns', `repeat(${cols}, minmax(200px, 1fr))`);

	if (mode === 'rows') {
		root.style.setProperty('--bases-grid-auto-flow', 'row');
		root.style.setProperty('--bases-grid-template-rows', 'none');
	} else {
		root.style.setProperty('--bases-grid-auto-flow', 'column');
		root.style.setProperty('--bases-grid-template-rows', `repeat(${rows}, auto)`);
	}
}

function compareStatusKeys(aEl, bEl) {
	const displayLabel = (raw = '') => raw.replace('Three-Quarters', '3/4').replace('Half', '1/2');
	const sortKey = (raw = '') => displayLabel(raw).trim().replace(/\s+/g, ' ').toLowerCase();

	const rank = (key) => {
		if (key === '1/2 cover') return [0, 0];
		if (key === '3/4 cover') return [0, 1];
		if (key === 'total cover') return [0, 2];
		if (key === 'bonus action used') return [0, 3];
		if (key === 'reaction used') return [0, 4];
		return [1, 0];
	};

	const aKey = sortKey(aEl.name); // Fallback for other systems
	const bKey = sortKey(bEl.name); // Fallback for other systems

	const [aGroup, aOrder] = rank(aKey);
	const [bGroup, bOrder] = rank(bKey);

	if (aGroup !== bGroup) return aGroup - bGroup;
	if (aOrder !== bOrder) return aOrder - bOrder;

	return aKey.localeCompare(bKey, undefined, { numeric: true });
}

function getSortedStatusIds() {
	globalThis.bases ??= {};
	if (globalThis.bases.sortedStatusesIndex) return globalThis.bases.sortedStatusesIndex;

	// Build once
	const ids = CONFIG.statusEffects
		.filter((s) => s.hud !== false)
		.sort(compareStatusKeys)
		.map((s) => s.id)
		.filter(Boolean);
	globalThis.bases.sortedStatusesIndex = ids;

	return ids;
}

function getEffectSrc({ app, img }) {
	let src = img.src;
	let level = false;

	if (game.system.id === 'dnd5e' && img.dataset.statusId === 'exhaustion') {
		const actor = app.object?.actor;
		level = foundry.utils.getProperty(actor, 'system.attributes.exhaustion');
		if (Number.isFinite(level) && level > 0) {
			src = dnd5e.documents.ActiveEffect5e._getExhaustionImage(level);
		}
	}

	return { src, exhaustionLevel: level };
}

function onClickTokenHUD(event) {
	const target = event.target?.closest?.('.effect-control');
	if (!target?.classList?.contains('effect-control')) return;

	const actor = canvas.hud.token.object?.actor;
	if (!actor) return;

	const id = target.dataset?.statusId;
	if (id === 'exhaustion') dnd5e.documents.ActiveEffect5e._manageExhaustion(event, actor);
	else if (id === 'concentrating') dnd5e.documents.ActiveEffect5e._manageConcentration(event, actor);
}

function rebuildStatusEffects({ app, container, enabled }) {
	// Vanilla images (what Foundry renders initially)
	const elements = Array.from(container.querySelectorAll('img.effect-control[data-action="effect"], img.effect-control'));
	if (!elements.length) return;

	const orderedIds = getSortedStatusIds();

	const byId = new Map();
	for (const el of elements) {
		const id = el.dataset.statusId;
		if (id) byId.set(id, el);
	}

	const opinionatedOrder = [];
	const used = new Set();

	for (const id of orderedIds) {
		const el = byId.get(id);
		if (!el) continue;
		opinionatedOrder.push(el);
		used.add(el);
	}

	// Could there be unknown effects?
	for (const el of elements) {
		if (!used.has(el)) opinionatedOrder.push(el);
	}
	const ordered =
		enabled ?
			opinionatedOrder // enabled: Ranked sort
		:	orderByConfig(elements, byId); // disabled: CONFIG.statusEffects order

	container.replaceChildren();

	const frag = document.createDocumentFragment();

	if (!enabled) {
		// Disabled: bare images only
		for (const img of ordered) frag.appendChild(img);
		container.appendChild(frag);
		return;
	}

	// Enabled: wrapper with <img> + <p>
	for (const img of ordered) {
		const wrapper = document.createElement('div');
		wrapper.classList.add('effect-control');
		if (img.classList.contains('active')) wrapper.classList.add('active');

		wrapper.classList.add(...img.classList);
		wrapper.dataset.action = img.dataset.action;
		wrapper.dataset.statusId = img.dataset.statusId;

		const { src, exhaustionLevel } = getEffectSrc({ app, img }) || {};

		const icon = document.createElement('img');
		icon.src = src;
		icon.alt = '';

		const text = (img.dataset.tooltipText ?? img.dataset.tooltip ?? '').replace('Three-Quarters', '3/4').replace('Half', '1/2');

		const label = document.createElement('p');
		label.textContent = text; // Fallback for other systems
		if (exhaustionLevel) label.textContent += ` ${exhaustionLevel}`;
		wrapper.append(icon, label);
		frag.appendChild(wrapper);
	}

	container.appendChild(frag);
	requestAnimationFrame(() => {
		for (const wrapper of container.querySelectorAll('div.effect-control')) {
			const p = wrapper.querySelector('p');
			if (!p) continue;

			const truncated = p.scrollWidth > p.clientWidth + 1;
			if (truncated) wrapper.dataset.tooltipText = p.textContent?.trim() ?? '';
			else wrapper.removeAttribute('data-tooltip-text'); // keep it clean
		}
	});
}

function updateOpenTokenHUDIfAny() {
	const hudApp = canvas.hud.token;
	const el = hudApp?.element;
	if (!el) return;

	const enabled = game.settings.get(Constants.MODULE_ID, 'hudEnabled');
	const hud = el.querySelector('.status-effects') ?? el;
	hud.classList.toggle('bases-hud-enabled', enabled); // Toggle CSS scope class immediately
	const container = el.querySelector('#token-hud .status-effects');
	if (!container) return;

	rebuildStatusEffects({ app: hudApp, container, enabled }); // Rebuild contents immediately (no re-render)
}

export function statusesApplySettings() {
	const enabled = game.settings.get(Constants.MODULE_ID, 'hudEnabled');
	ensureHudStyle();
	if (enabled) applyHudGridSettings();
	updateOpenTokenHUDIfAny();
}

async function setIfChanged(key, value) {
	const current = game.settings.get(Constants.MODULE_ID, key);
	if (current === value) return;
	await game.settings.set(Constants.MODULE_ID, key, value);
}

function shouldRebuildOnce(container, enabled) {
	const prev = container.dataset.basesBuilt;
	const next = enabled ? 'on' : 'off';
	return prev !== next;
}

function basesReady() {
	globalThis.bases = { info: { version: game.modules.get(Constants.MODULE_ID).version } };
	ensureHudStyle();
	applyHudGridSettings(); // apply saved values
}

function markBuilt(container, enabled) {
	container.dataset.basesBuilt = enabled ? 'on' : 'off';
}

function orderByConfig(imgs, byId) {
	const configIds = CONFIG.statusEffects
		.filter((s) => s.hud !== false)
		.map((s) => s.id)
		.filter(Boolean);

	const ordered = [];
	const used = new Set();

	for (const id of configIds) {
		const img = byId.get(id);
		if (!img) continue;
		ordered.push(img);
		used.add(img);
	}

	// Append anything that didn't match CONFIG ids
	for (const img of imgs) {
		if (!used.has(img)) ordered.push(img);
	}

	return ordered;
}

function statusesRenderSettingsConfigHook(app, html) {
	if (html.dataset.basesHudSettingsBound === '1') return;
	html.dataset.basesHudSettingsBound = '1';

	const enabledInput = game.settings.get(Constants.MODULE_ID, 'hudEnabled'); //hidden setting to turn off if needed programatically
	if (!enabledInput) return;

	const modeSel = html.querySelector(`select[name="${Constants.MODULE_ID}.hudFlowMode"]`);
	const colsPicker = html.querySelector(`range-picker[name="${Constants.MODULE_ID}.hudColumns"]`);

	const flowGroup = modeSel?.closest('.form-group');
	const colsGroup = colsPicker?.closest('.form-group');

	const setVisibility = (isOn) => {
		if (flowGroup) flowGroup.style.display = isOn ? '' : 'none';
		if (colsGroup) colsGroup.style.display = isOn ? '' : 'none';
	};

	setVisibility(game.settings.get(Constants.MODULE_ID, 'hudEnabled')); //initial

	/* This is here be included if at some point there are more settings and we need
	 * to have a way to listen to the hudEnabled setting too
	 * enabledInput.addEventListener('change', async () => {
	 *	  const isOn = enabledInput;
	 *	  setVisibility(isOn);
	 *    await setIfChanged('hudEnabled', isOn);
	 *    canvas.hud?.token?.render?.();
	 * });
	 */

	modeSel?.addEventListener('change', async () => {
		if (!enabledInput) return;
		await setIfChanged('hudFlowMode', modeSel.value);
	});
	const saveCols = foundry.utils.debounce(async () => {
		if (!enabledInput) return;
		const cols = Number(colsPicker?.value);
		await setIfChanged('hudColumns', cols);
	}, 50);

	colsPicker?.addEventListener('input', saveCols);
}

export function statusesRenderTokenHUDHook(app, html) {
	const container = html.querySelector('#token-hud .status-effects');
	if (!container) return;

	const enabled = game.settings.get(Constants.MODULE_ID, 'hudEnabled');
	const hud = html.querySelector('#token-hud') ?? html;
	hud.classList.toggle('bases-hud-enabled', enabled);

	if (!shouldRebuildOnce(container, enabled)) return;

	rebuildStatusEffects({ app, container, enabled });
	markBuilt(container, enabled);

	if (game.system.id === 'dnd5e') {
		// && !html.dataset.basesHudBound) {
		// html.dataset.basesHudBound = '1';
		html.addEventListener('click', onClickTokenHUD, { capture: true });
		html.addEventListener('contextmenu', onClickTokenHUD, { capture: true });
	}
}

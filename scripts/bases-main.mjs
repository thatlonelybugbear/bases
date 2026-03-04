import Constants from './bases-constants.mjs';
import { registerSettings } from './bases-settings.mjs';

Hooks.once('init', registerSettings);

Hooks.once('ready', basesReady);

function markHudSystemClass(hudRoot = document.querySelector('#token-hud')) {
	if (!hudRoot) return;
	hudRoot.dataset.basesSystem = game.system.id;
}
function findStatusPalette(root) {
	return root.querySelector('.palette.status-effects[data-palette="effects"]') ?? root.querySelector('#token-hud .status-effects') ?? root.querySelector('.status-effects');
}

function getHost(palette) {
	// Draw Steel typed
	return palette.querySelector('.effect-pane') ?? palette;
}

function collectStatusElements(palette) {
	const host = getHost(palette);
	const sourceNodes = Array.from(host.querySelectorAll('[data-status-id]'));
	const lifted = new Map();

	const liftToHostChild = (el) => {
		if (!el) return null;
		if (el.parentElement === host) return el;
		let current = el.parentElement;
		while (current && current !== host) {
			if (current.parentElement === host) return current;
			current = current.parentElement;
		}
		return el;
	};

	for (const src of sourceNodes) {
		const node = liftToHostChild(src);
		if (!node) continue;
		if (!lifted.has(node)) lifted.set(node, src);
	}

	const candidates = Array.from(lifted.keys());
	for (const el of candidates) {
		const src = lifted.get(el);
		if (!el.dataset.statusId && src?.dataset?.statusId) el.dataset.statusId = src.dataset.statusId;
		if (!el.dataset.action) el.dataset.action = src?.dataset?.action || 'effect';
		if (!el.dataset.basesSourceLabel) {
			const sourceLabel = getLabel(src);
			if (sourceLabel) el.dataset.basesSourceLabel = sourceLabel;
		}
		// Enable full-row click target for wrapper-based systems (e.g., DC20 status-wrapper).
		if (!el.classList.contains('effect-control')) {
			const hasNestedControl = Boolean(el.querySelector?.('.effect-control[data-status-id], .effect-control'));
			if (hasNestedControl) el.classList.add('effect-control', 'bases-effect-proxy');
		}
	}

	return candidates.filter((el) => {
		if (el.classList.contains('effect-control')) return true;
		if (el.classList.contains('effect-group')) return true;
		if (el.querySelector?.('[data-status-id], .effect-control, img')) return true;
		return false;
	});
}

function getLabel(el) {
	return (
		el.dataset.basesSourceLabel ||
		el.dataset.tooltipText ||
		el.dataset.tooltip ||
		el.getAttribute('data-tooltip') ||
		el.getAttribute('aria-label') ||
		el.getAttribute('title') ||
		el.querySelector?.('.title')?.textContent?.trim() ||
		el.querySelector?.('span')?.textContent?.trim() ||
		el.textContent?.trim() ||
		''
	);
}

function normalizeStatusLabel(raw = '') {
	return raw.replace('Three-Quarters', '3/4').replace('Half', '1/2').trim();
}

function normalizeFilterText(raw = '') {
	return normalizeStatusLabel(String(raw)).trim().replace(/\s+/g, ' ').toLowerCase();
}

function getEffectSearchText(el) {
	const id = el?.dataset?.statusId ?? '';
	const label = el?.dataset?.basesLabel ?? getLabel(el) ?? '';
	return `${id} ${label}`;
}

function getFilterableStatusElements(host, orderedElements = []) {
	if (orderedElements.length) return orderedElements;
	return Array.from(host.querySelectorAll(':scope > [data-status-id]'));
}

function applyHudFilter(host, value, orderedElements = []) {
	if (!host) return;
	const query = normalizeFilterText(value);
	const tokens = query ? query.split(' ').filter(Boolean) : [];
	const elements = getFilterableStatusElements(host, orderedElements);

	for (const el of elements) {
		const haystack = normalizeFilterText(getEffectSearchText(el));
		const match = !tokens.length || tokens.every((t) => haystack.includes(t));
		el.classList.toggle('bases-hidden', !match);
	}
}

function ensureHudFilterUI(palette, enabled) {
	const existing = palette.querySelector(':scope > fieldset.bases-filter');
	if (!enabled) {
		existing?.remove();
		palette.dataset.basesFilterValue = '';
		return null;
	}

	let fieldset = existing;
	if (!fieldset) {
		fieldset = document.createElement('fieldset');
		fieldset.className = 'bases-filter';
		fieldset.innerHTML = `
			<input type="text" class="bases-filter-input" placeholder="${game.i18n.localize('BASES.AssignStatusHUDSorting.Filter.Placeholder')}" />
			<button type="button" class="bases-filter-clear">${game.i18n.localize('BASES.AssignStatusHUDSorting.Filter.Clear')}</button>
		`;
		palette.prepend(fieldset);
	}

	if (fieldset.dataset.basesBound === '1') return fieldset;
	fieldset.dataset.basesBound = '1';

	const host = getHost(palette);
	const input = fieldset.querySelector('.bases-filter-input');
	const clear = fieldset.querySelector('.bases-filter-clear');
	if (input) input.value = palette.dataset.basesFilterValue ?? '';

	const run = foundry.utils.debounce(() => {
		const value = input?.value ?? '';
		palette.dataset.basesFilterValue = value;
		applyHudFilter(host, value);
	}, 25);

	input?.addEventListener('input', run);
	clear?.addEventListener('click', () => {
		if (!input) return;
		input.value = '';
		palette.dataset.basesFilterValue = '';
		applyHudFilter(host, '');
		input.focus();
	});

	return fieldset;
}

function relaxHudBounds(palette) {
	const hudRoot = document.querySelector('#token-hud');
	const hudContainer = document.querySelector('#hud');
	const targets = [hudRoot, hudRoot?.querySelector('.col.right'), hudRoot?.querySelector('.col.left'), palette, palette?.parentElement, palette?.closest('.palette')].filter(Boolean);
	for (const el of targets) {
		el.style.maxHeight = 'none';
		el.style.height = 'auto';
		el.style.overflow = 'visible';
	}
	if (hudContainer) {
		hudContainer.style.maxHeight = 'none';
		hudContainer.style.height = 'auto';
		hudContainer.style.overflow = 'visible';
	}

	// Some systems constrain intermediate wrappers; uncap every ancestor up to HUD root.
	let current = palette?.parentElement;
	while (current && current !== hudRoot) {
		current.style.maxHeight = 'none';
		current.style.height = 'auto';
		current.style.overflow = 'visible';
		current = current.parentElement;
	}
	if (hudRoot) {
		hudRoot.style.maxHeight = 'none';
		hudRoot.style.height = 'auto';
		hudRoot.style.overflow = 'visible';
	}
}

function enforceHudContentHeight(palette) {
	const hudRoot = document.querySelector('#token-hud');
	if (!hudRoot || !palette) return;
	const needed = Math.max(hudRoot.scrollHeight, palette.scrollHeight) + 8;
	if (Number.isFinite(needed) && needed > 0) {
		hudRoot.style.height = `${needed}px`;
		hudRoot.style.maxHeight = 'none';
	}
}

function refreshHudBounds(palette) {
	requestAnimationFrame(() => {
		relaxHudBounds(palette);
		enforceHudContentHeight(palette);
	});
}

function reorderForColumnMajorDisplay(arr, columnCount, mode) {
	if (mode !== 'columns') return arr;
	const safeCols = Math.max(1, Number(columnCount) || 1);
	const n = arr.length;
	const rows = Math.ceil(n / safeCols);
	if (!rows || n <= 1) return arr;

	// We render with row-flow; this places sorted items so visual reading down columns remains sorted.
	const rowFlow = new Array(n);
	let src = 0;
	for (let col = 0; col < safeCols; col++) {
		for (let row = 0; row < rows; row++) {
			const pos = row * safeCols + col;
			if (pos >= n) continue;
			rowFlow[pos] = arr[src++];
			if (src >= n) break;
		}
	}
	return rowFlow.filter(Boolean);
}

function reorderBySystemEffectForDaggerheart(host, elements) {
	const separator = host.querySelector(':scope > .palette-category-title');
	if (!separator) return null;
	const mode = game.settings.get(Constants.MODULE_ID, 'hudFlowMode');
	const cols = Number(game.settings.get(Constants.MODULE_ID, 'hudColumns')) || 3;

	const statusCfg = CONFIG.statusEffects.filter((s) => s.hud !== false);
	const systemIds = statusCfg.filter((s) => s.systemEffect).map((s) => s.id).filter(Boolean);
	const foundryIds = statusCfg.filter((s) => !s.systemEffect).map((s) => s.id).filter(Boolean);

	const systemIndex = new Map(systemIds.map((id, idx) => [id, idx]));
	const foundryIndex = new Map(foundryIds.map((id, idx) => [id, idx]));

	const systemEls = [];
	const foundryEls = [];
	const unknown = [];

	for (const el of elements) {
		const id = el.dataset.statusId;
		if (id && systemIndex.has(id)) systemEls.push(el);
		else if (id && foundryIndex.has(id)) foundryEls.push(el);
		else unknown.push(el);
	}

	// Sort by display label inside each section so ordering is name-based.
	systemEls.sort((a, b) => compareStatusKeys(getLabel(a), getLabel(b)));
	foundryEls.sort((a, b) => compareStatusKeys(getLabel(a), getLabel(b)));
	unknown.sort((a, b) => compareStatusKeys(getLabel(a), getLabel(b)));

	const systemOrdered = reorderForColumnMajorDisplay(systemEls, cols, mode);
	const foundryOrdered = reorderForColumnMajorDisplay([...foundryEls, ...unknown], cols, mode);

	const beforeFrag = document.createDocumentFragment();
	for (const el of systemOrdered) beforeFrag.appendChild(el);
	host.insertBefore(beforeFrag, separator);

	const afterFrag = document.createDocumentFragment();
	for (const el of foundryOrdered) afterFrag.appendChild(el);
	host.insertBefore(afterFrag, separator.nextSibling);

	return [...systemOrdered, ...foundryOrdered];
}

const SYSTEM_ADAPTERS = {
	default: {
		shouldEmulateColumns() {
			return false;
		},
		syncLayoutVars() {},
		reorderStatuses() {
			return null;
		},
	},
	daggerheart: {
		shouldEmulateColumns(mode) {
			return mode === 'columns';
		},
		syncLayoutVars(palette, { cols } = {}) {
			if (!palette) return;
			const normalizedCols = Math.max(1, Number(cols) || 1);
			palette.style.setProperty('--effect-columns', `${normalizedCols}`);

			// Daggerheart CSS can keep column-flow behavior; force row-flow rendering so visual order is stable.
			palette.style.setProperty('grid-auto-flow', 'row', 'important');
			palette.style.setProperty('grid-template-rows', 'none', 'important');
			palette.style.setProperty('grid-template-columns', `repeat(${normalizedCols}, minmax(200px, 1fr))`, 'important');
		},
		reorderStatuses(host, elements) {
			return reorderBySystemEffectForDaggerheart(host, elements);
		},
	},
};

function getSystemAdapter() {
	return SYSTEM_ADAPTERS[game.system.id] ?? SYSTEM_ADAPTERS.default;
}

function applyHudGridSettings({ mode, cols } = {}) {
	const root = document.documentElement;
	const adapter = getSystemAdapter();

	mode ??= game.settings.get(Constants.MODULE_ID, 'hudFlowMode');
	cols ??= Number(game.settings.get(Constants.MODULE_ID, 'hudColumns')) || 3;

	const statusLength = CONFIG.statusEffects.filter((s) => s.hud !== false).length;
	const rows = Math.ceil(statusLength / cols);

	// columns are always defined
	root.style.setProperty('--bases-grid-template-columns', `repeat(${cols}, minmax(160px, 1fr))`);

	if (mode === 'rows' || adapter.shouldEmulateColumns(mode)) {
		root.style.setProperty('--bases-grid-auto-flow', 'row');
		root.style.setProperty('--bases-grid-template-rows', 'none');
	} else {
		root.style.setProperty('--bases-grid-auto-flow', 'column');
		root.style.setProperty('--bases-grid-template-rows', `repeat(${rows}, auto)`);
	}

	return { mode, cols };
}

function compareStatusKeys(aEl, bEl) {
	const getComparableText = (value) => {
		if (typeof value === 'string') return value;
		return value?.name ?? value?.label ?? '';
	};
	const sortKey = (raw = '') => normalizeStatusLabel(raw).replace(/\s+/g, ' ').toLowerCase();

	const rank = (key) => {
		if (key === '1/2 cover') return [0, 0];
		if (key === '3/4 cover') return [0, 1];
		if (key === 'total cover') return [0, 2];
		if (key === 'bonus action used') return [0, 3];
		if (key === 'reaction used') return [0, 4];
		return [1, 0];
	};

	const aKey = sortKey(getComparableText(aEl)); // Works for CONFIG entries and plain labels
	const bKey = sortKey(getComparableText(bEl)); // Works for CONFIG entries and plain labels

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

function rebuildAndApply(palette) {
	const enabled = game.settings.get(Constants.MODULE_ID, 'hudEnabled');
	const filterEnabled = game.settings.get(Constants.MODULE_ID, 'hudFilterEnabled');
	const tokenHud = document.querySelector('#token-hud');
	const adapter = getSystemAdapter();
	if (tokenHud) {
		tokenHud.classList.toggle('bases-hud-enabled', enabled);
		markHudSystemClass(tokenHud);
	}

	if (!enabled) return;

	const host = getHost(palette);
	const layout = applyHudGridSettings();
	relaxHudBounds(palette);
	adapter.syncLayoutVars(palette, layout);
	const filterFieldset = ensureHudFilterUI(palette, filterEnabled);
	const elements = collectStatusElements(palette);
	if (!elements.length) return;

	const orderedIds = getSortedStatusIds();
	const ordered = adapter.reorderStatuses(host, elements) ?? reorderStatusElementsInRuns(host, elements, orderedIds);
	for (const el of ordered) decorateStatusElement(el);
	const filterValue = filterFieldset?.querySelector('.bases-filter-input')?.value ?? palette.dataset.basesFilterValue ?? '';
	applyHudFilter(host, filterEnabled ? filterValue : '', ordered);
	refreshHudBounds(palette);
}

function sortStatusElements(elements, orderedIds) {
	const orderedIndex = new Map((orderedIds ?? []).map((id, idx) => [id, idx]));
	const withKnownOrder = [];
	const unknown = [];

	for (const el of elements) {
		const id = el.dataset.statusId;
		const idx = id ? orderedIndex.get(id) : undefined;
		if (Number.isInteger(idx)) withKnownOrder.push({ el, idx });
		else unknown.push(el);
	}

	withKnownOrder.sort((a, b) => a.idx - b.idx);
	unknown.sort((a, b) => compareStatusKeys(getLabel(a), getLabel(b)));

	return [...withKnownOrder.map((entry) => entry.el), ...unknown];
}

function reorderStatusElementsInRuns(host, allStatusElements, orderedIds) {
	const childElements = Array.from(host.children);
	const statusSet = new Set(allStatusElements);

	// Systems with wrapped/nested structures fall back to whole-host ordering.
	if (!childElements.some((el) => statusSet.has(el))) {
		const ordered = sortStatusElements(allStatusElements, orderedIds);
		const frag = document.createDocumentFragment();
		for (const el of ordered) frag.appendChild(el);
		host.appendChild(frag);
		return ordered;
	}

	const orderedAll = [];
	let run = [];

	const flushRun = () => {
		if (!run.length) return;
		const sortedRun = sortStatusElements(run, orderedIds);
		const ref = run[run.length - 1].nextSibling;
		const frag = document.createDocumentFragment();
		for (const el of sortedRun) frag.appendChild(el);
		host.insertBefore(frag, ref);
		orderedAll.push(...sortedRun);
		run = [];
	};

	for (const child of childElements) {
		if (statusSet.has(child)) {
			run.push(child);
			continue;
		}
		flushRun();
	}
	flushRun();

	return orderedAll;
}

function upgradeImageStatusElement(img, text) {
	if (img.tagName !== 'IMG') return img;

	const existingWrapper = img.parentElement?.classList?.contains('bases-effect-control') ? img.parentElement : null;
	if (existingWrapper) {
		let p = existingWrapper.querySelector(':scope > p.bases-label');
		if (!p) {
			p = document.createElement('p');
			p.classList.add('bases-label');
			existingWrapper.appendChild(p);
		}
		p.textContent = text;
		return existingWrapper;
	}

	const wrapper = document.createElement('div');
	wrapper.classList.add('effect-control', 'bases-effect-control');
	for (const cls of img.classList) wrapper.classList.add(cls);

	for (const [key, value] of Object.entries(img.dataset)) {
		wrapper.dataset[key] = value;
	}
	const title = img.getAttribute('title');
	const ariaLabel = img.getAttribute('aria-label');
	if (title) wrapper.setAttribute('title', title);
	if (ariaLabel) wrapper.setAttribute('aria-label', ariaLabel);

	const p = document.createElement('p');
	p.classList.add('bases-label');
	p.textContent = text;

	img.classList.remove('effect-control', 'active', 'overlay', 'effect-control-container');
	delete img.dataset.action;
	delete img.dataset.statusId;
	delete img.dataset.tooltipText;
	delete img.dataset.tooltip;

	img.parentElement?.insertBefore(wrapper, img);
	wrapper.append(img, p);
	return wrapper;
}

function decorateStatusElement(element) {
	const text = normalizeStatusLabel(getLabel(element));

	if (!text) return;

	const node = element.tagName === 'IMG' ? upgradeImageStatusElement(element, text) : element;
	// Keep native element shape untouched when possible; add normalized label metadata.
	node.dataset.basesLabel = text;

	const hasNativeLabel = Boolean(node.querySelector?.(':scope > .title, :scope > .label'));
	if (hasNativeLabel) return;

	let p = node.querySelector(':scope > p.bases-label');
	if (!p) {
		p = document.createElement('p');
		p.classList.add('bases-label');
		node.appendChild(p);
	}
	p.textContent = text;
}

function onDnd5eTokenHudClick(event) {
	const target = event.target?.closest?.('.effect-control');
	if (!target?.classList?.contains('effect-control')) return;

	const id = target.dataset?.statusId;
	if (!id) return;
	if (id !== 'exhaustion' && id !== 'concentrating') return;

	const actor = canvas?.hud?.token?.object?.actor;
	if (!actor) return;
	if (!globalThis.dnd5e?.documents?.ActiveEffect5e) return;

	// Mirror dnd5e's dedicated handlers for special status controls.
	if (id === 'exhaustion') dnd5e.documents.ActiveEffect5e._manageExhaustion(event, actor);
	else dnd5e.documents.ActiveEffect5e._manageConcentration(event, actor);
}

function bindDnd5eHudHandlers(html) {
	if (game.system.id !== 'dnd5e') return;
	if (html.dataset.basesDnd5eHudBound === '1') return;
	html.dataset.basesDnd5eHudBound = '1';

	html.addEventListener('click', onDnd5eTokenHudClick, { capture: true });
	html.addEventListener('contextmenu', onDnd5eTokenHudClick, { capture: true });
}

function updateOpenTokenHUDIfAny({ force = false } = {}) {
	const hudRoot = document.querySelector('#token-hud');
	if (!hudRoot) return;

	const palette = findStatusPalette(hudRoot);
	if (!palette) return;

	if (force) palette.dataset.basesBuilt = '0';

	// Re-run if enabled
	if (!game.settings.get(Constants.MODULE_ID, 'hudEnabled')) {
		hudRoot.classList.remove('bases-hud-enabled');
		return;
	}

	palette.dataset.basesBuilt = '1';
	rebuildAndApply(palette);
}

export function statusesApplySettings() {
	const enabled = game.settings.get(Constants.MODULE_ID, 'hudEnabled');
	if (enabled) applyHudGridSettings();
	updateOpenTokenHUDIfAny();
}

async function setIfChanged(key, value) {
	const current = game.settings.get(Constants.MODULE_ID, key);
	if (current === value) return;
	await game.settings.set(Constants.MODULE_ID, key, value);
}

function basesReady() {
	if (game.system.id === 'draw-steel') {
		ui.notifications.error(game.i18n.localize('BASES.IncompatibleSystemError'));
		game.settings.set(Constants.MODULE_ID, 'hudEnabled', false);
		return;
	}

	globalThis.bases = { info: { version: game.modules.get(Constants.MODULE_ID).version } };
	applyHudGridSettings(); // apply saved values

	Hooks.on('renderSettingsConfig', statusesRenderSettingsConfigHook);
	Hooks.on('renderTokenHUD', statusesRenderTokenHUDHook);
}


function statusesRenderSettingsConfigHook(app, html) {
	if (html.dataset.basesHudSettingsBound === '1') return;
	html.dataset.basesHudSettingsBound = '1';

	const enabledInput = game.settings.get(Constants.MODULE_ID, 'hudEnabled'); //hidden setting to turn off if needed programatically
	if (!enabledInput) return;

	const modeSel = html.querySelector(`select[name="${Constants.MODULE_ID}.hudFlowMode"]`);
	const colsPicker = html.querySelector(`range-picker[name="${Constants.MODULE_ID}.hudColumns"]`);
	const filterInput = html.querySelector(`input[name="${Constants.MODULE_ID}.hudFilterEnabled"]`);

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
	filterInput?.addEventListener('change', async () => {
		if (!enabledInput) return;
		await setIfChanged('hudFilterEnabled', Boolean(filterInput.checked));
	});
	const saveCols = foundry.utils.debounce(async () => {
		if (!enabledInput) return;
		const cols = Number(colsPicker?.value);
		await setIfChanged('hudColumns', cols);
	}, 50);

	colsPicker?.addEventListener('input', saveCols);
}

function statusesRenderTokenHUDHook(app, html) {
	const enabled = game.settings.get(Constants.MODULE_ID, 'hudEnabled');
	const hudRoot = html.querySelector('#token-hud') ?? html;
	hudRoot.classList.toggle('bases-hud-enabled', enabled);
	markHudSystemClass(hudRoot);
	bindDnd5eHudHandlers(html);

	if (!enabled) return;

	const palette = findStatusPalette(html);
	if (!palette) return;

	// Build once per HUD instance
	if (palette.dataset.basesBuilt === '1') return;
	palette.dataset.basesBuilt = '1';

	rebuildAndApply(palette);
}

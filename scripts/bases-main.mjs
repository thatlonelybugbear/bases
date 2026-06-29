import Constants from './bases-constants.mjs';
import { registerSettings } from './bases-settings.mjs';

Hooks.once('init', registerSettings);

Hooks.once('ready', basesReady);

let hudMutationObserver = null;
let hudObservedHost = null;
let pendingHudScaleFrame = null;
let pendingHudScalePercent = undefined;
let pendingFilterRefocusUntil = 0;
let pendingFilterRefocusTimer = null;
const FILTER_FOCUS_RETRY_MS = [0, 30, 90];
const FILTER_REFOCUS_SETTLE_MS = 120;
const MIN_USER_HUD_SCALE = 0.3;
const MAX_USER_HUD_SCALE = 1.2;
const MIN_EFFECTIVE_HUD_SCALE = 0.5;
const MAX_EFFECTIVE_HUD_SCALE = 2.5;

function getHudScale(scalePercent) {
	const percent = Number.isFinite(Number(scalePercent)) ? Number(scalePercent) : Number(game.settings.get(Constants.MODULE_ID, 'hudScale')) || 100;
	return Math.clamp(percent / 100, MIN_USER_HUD_SCALE, MAX_USER_HUD_SCALE);
}

function getCanvasZoomScale() {
	const zoom = Number(canvas?.stage?.scale?.x) || 1;
	return Math.max(0.1, zoom);
}

function applyHudScale(scalePercent, hudRoot = document.querySelector('#token-hud')) {
	if (!hudRoot) return null;
	if (!game.settings.get(Constants.MODULE_ID, 'hudEnabled')) return null;

	const scale = Math.clamp(getHudScale(scalePercent) / getCanvasZoomScale(), MIN_EFFECTIVE_HUD_SCALE, MAX_EFFECTIVE_HUD_SCALE);
	const value = scale.toFixed(3);
	if (hudRoot.dataset.basesHudScaleValue === value) return scale;
	hudRoot.dataset.basesHudScaleValue = value;
	hudRoot.style.setProperty('--bases-current-hud-scale', value);
	return scale;
}

function scheduleHudScale(scalePercent) {
	pendingHudScalePercent = scalePercent;
	if (pendingHudScaleFrame) return;

	pendingHudScaleFrame = requestAnimationFrame(() => {
		pendingHudScaleFrame = null;
		const percent = pendingHudScalePercent;
		pendingHudScalePercent = undefined;
		applyHudScale(percent);
	});
}

function markHudSystemClass(hudRoot = document.querySelector('#token-hud')) {
	if (!hudRoot) return;
	hudRoot.dataset.basesSystem = game.system.id;
}
function findStatusPalette(root) {
	if (!root) return null;
	return root.querySelector('.palette.status-effects[data-palette="effects"]') ?? root.querySelector('#token-hud .status-effects') ?? root.querySelector('.status-effects');
}

function getHost(palette) {
	// Draw Steel typed
	return palette.querySelector('.effect-pane') ?? palette;
}

function getStatusId(element) {
	return element?.dataset?.statusId ?? element?.querySelector?.(':scope > [data-status-id]')?.dataset?.statusId ?? '';
}

function getEffectId(element) {
	return element?.dataset?.effectId ?? element?.querySelector?.(':scope > [data-effect-id]')?.dataset?.effectId ?? '';
}

function getEffectUuid(element) {
	return element?.dataset?.effectUuid ?? element?.querySelector?.(':scope > [data-effect-uuid]')?.dataset?.effectUuid ?? '';
}

function isHudStatusElement(element) {
	if (!(element instanceof HTMLElement)) return false;
	if (element.matches('fieldset.bases-filter')) return false;
	if (getStatusId(element)) return true;
	if (getEffectId(element)) return true;
	if (getEffectUuid(element)) return true;
	if (element.classList.contains('effect-control')) return true;
	if (element.classList.contains('effect-group')) return true;
	return Boolean(
		element.querySelector?.(':scope > [data-status-id], :scope > [data-effect-id], :scope > [data-effect-uuid], :scope > .effect-control, :scope > img'),
	);
}

function collectHudStatusElements(host) {
	if (!host) return [];
	return Array.from(host.children).filter(isHudStatusElement);
}

function getFirstVisibleHudEffect(host) {
	return collectHudStatusElements(host).find((el) => !el.classList.contains('bases-hidden')) ?? null;
}

function liftToHostChild(host, element) {
	if (!host || !element) return null;
	if (element.parentElement === host) return element;
	let current = element.parentElement;
	while (current && current !== host) {
		if (current.parentElement === host) return current;
		current = current.parentElement;
	}
	return null;
}

function focusFilterInput(palette = undefined) {
	const candidates = [];
	if (palette?.isConnected) candidates.push(palette);
	const canvasPalette = findStatusPalette(canvas?.hud?.token?.element);
	if (canvasPalette?.isConnected) candidates.push(canvasPalette);
	const domPalette = findStatusPalette(document.querySelector('#token-hud'));
	if (domPalette?.isConnected) candidates.push(domPalette);

	let input = null;
	for (const candidate of candidates) {
		const found = candidate?.querySelector?.(':scope > fieldset.bases-filter .bases-filter-input');
		if (found?.isConnected) {
			input = found;
			break;
		}
	}
	input ??= document.querySelector('#token-hud fieldset.bases-filter .bases-filter-input');
	if (!input) return false;
	input.focus({ preventScroll: true });
	const end = input.value?.length ?? 0;
	input.setSelectionRange?.(end, end);
	return document.activeElement === input;
}

function hasActiveFilterValue() {
	const openPalette = findStatusPalette(canvas?.hud?.token?.element) ?? findStatusPalette(document.querySelector('#token-hud'));
	const input = openPalette?.querySelector?.(':scope > fieldset.bases-filter .bases-filter-input');
	return Boolean(input?.value?.trim().length);
}

function queueFilterRefocusIfFiltering() {
	if (!game.settings.get(Constants.MODULE_ID, 'hudFilterEnabled')) return;
	if (!hasActiveFilterValue()) return;
	// Keep this short-lived so we do not steal focus on unrelated later renders.
	pendingFilterRefocusUntil = Date.now() + 2500;
}

function schedulePendingFilterRefocusAfterSettle() {
	if (!game.settings.get(Constants.MODULE_ID, 'hudFilterEnabled')) return;
	if (pendingFilterRefocusUntil <= Date.now()) {
		pendingFilterRefocusUntil = 0;
		if (pendingFilterRefocusTimer) clearTimeout(pendingFilterRefocusTimer);
		pendingFilterRefocusTimer = null;
		return;
	}

	if (pendingFilterRefocusTimer) clearTimeout(pendingFilterRefocusTimer);
	pendingFilterRefocusTimer = setTimeout(() => {
		pendingFilterRefocusTimer = null;
		if (pendingFilterRefocusUntil <= Date.now()) return;
		focusFilterInput();
	}, FILTER_REFOCUS_SETTLE_MS);
}

function closeStatusPaletteIfOpen() {
	const hudElement = canvas?.hud?.token?.element ?? document.querySelector('#token-hud');
	const btn = hudElement?.querySelector?.('button.control-icon[data-action="togglePalette"][data-palette="effects"]');
	if (!btn?.classList?.contains('active')) return false;
	btn.click();
	return true;
}

function onClickStatusPaletteToggle(event) {
	const btn = event.target?.closest?.('button.control-icon[data-action="togglePalette"][data-palette="effects"]');
	if (!btn) return;
	for (const delay of FILTER_FOCUS_RETRY_MS) {
		setTimeout(() => {
			focusFilterInput();
		}, delay);
	}
}

function collectStatusElements(palette) {
	const host = getHost(palette);
	const sourceNodes = Array.from(
		host.querySelectorAll('[data-status-id], [data-effect-id], [data-effect-uuid], .effect-control, img.effect-control'),
	);
	const lifted = new Map();

	for (const src of sourceNodes) {
		const node = liftToHostChild(host, src) ?? src;
		if (!node) continue;
		if (!lifted.has(node)) {
			lifted.set(node, src);
			continue;
		}
		const existing = lifted.get(node);
		const score = (element) => Number(Boolean(getStatusId(element))) + Number(Boolean(getEffectId(element))) + Number(Boolean(getEffectUuid(element)));
		if (score(src) > score(existing)) lifted.set(node, src);
	}

	const candidates = Array.from(lifted.keys());
	for (const el of candidates) {
		const src = lifted.get(el);
		const statusId = getStatusId(src);
		const effectId = getEffectId(src);
		const effectUuid = getEffectUuid(src);
		if (!el.dataset.statusId && statusId) el.dataset.statusId = statusId;
		if (!el.dataset.effectId && effectId) el.dataset.effectId = effectId;
		if (!el.dataset.effectUuid && effectUuid) el.dataset.effectUuid = effectUuid;
		if ((statusId || effectId || effectUuid) && !el.dataset.action) el.dataset.action = src?.dataset?.action || 'effect';
		if (!el.dataset.basesSourceLabel) {
			const sourceLabel = getLabel(src);
			if (sourceLabel) el.dataset.basesSourceLabel = sourceLabel;
		}
		// Enable full-row click target for wrapper-based systems (e.g., DC20 status-wrapper).
		if (!el.classList.contains('effect-control')) {
			const hasNestedControl = Boolean(
				el.querySelector?.(
					'.effect-control[data-status-id], .effect-control, [data-status-id], [data-effect-id], [data-effect-uuid]',
				),
			);
			if (hasNestedControl) el.classList.add('effect-control', 'bases-effect-proxy');
		}
	}

	return candidates.filter(isHudStatusElement);
}

function getLabel(el) {
	const status = getStatusConfig(getStatusId(el));
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
		status?.name ||
		status?.label ||
		''
	);
}

function normalizeStatusLabel(raw = '') {
	return raw.replace('Three-Quarters', '3/4').replace('Half', '1/2').trim();
}

function normalizeFilterText(raw = '') {
	const base = foundry.applications.ux.SearchFilter.cleanQuery(String(raw ?? ''));
	return normalizeStatusLabel(base).replace(/\s+/g, ' ').toLowerCase();
}

function getEffectSearchText(el) {
	const id = getStatusId(el) || getEffectId(el) || getEffectUuid(el) || '';
	const label = el?.dataset?.basesLabel ?? getLabel(el) ?? '';
	return `${id} ${label}`;
}

function getFilterableStatusElements(host, orderedElements = []) {
	if (orderedElements.length) return orderedElements;
	return collectHudStatusElements(host);
}

function getStatusEffectConfigs() {
	const effects = CONFIG.statusEffects;
	if (!effects) return [];
	if (typeof foundry?.utils?.iterateValues === 'function') return Array.from(foundry.utils.iterateValues(effects));
	if (Array.isArray(effects)) return effects;
	return Object.values(effects);
}

function getStatusConfig(id) {
	if (!id) return null;
	const effects = CONFIG.statusEffects;
	const status = typeof effects?.get === 'function' ? effects.get(id) : effects?.[id];
	if (status) return status;
	return getStatusEffectConfigs().find((effect) => effect.id === id) ?? null;
}

function getHudEnabledStatusConfigs(actorType = undefined) {
	const statuses = [];
	for (const status of getStatusEffectConfigs()) {
		if ((status?.hud === false) || (status?.hud?.actorTypes?.includes(actorType) === false)) continue;
		statuses.push(status);
	}
	return statuses;
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

function syncHudFilterClearState(fieldset, input, clear) {
	if (!fieldset || !input || !clear) return;
	const hasValue = Boolean(input.value?.length);
	clear.hidden = !hasValue;
}

function ensureHudFilterUI(palette, enabled) {
	const existing = palette.querySelector(':scope > fieldset.bases-filter');
	if (!enabled) {
		if (existing) {
			existing._basesSearchFilter?.unbind?.();
			delete existing._basesSearchFilter;
		}
		existing?.remove();
		palette.dataset.basesFilterValue = '';
		const host = getHost(palette);
		for (const el of collectHudStatusElements(host)) el.classList.remove('bases-hidden');
		return null;
	}

	let fieldset = existing;
	if (!fieldset) {
		fieldset = document.createElement('fieldset');
		fieldset.className = 'bases-filter';
		fieldset.innerHTML = `
			<div class="bases-filter-input-wrap">
				<input type="text" class="bases-filter-input" placeholder="${game.i18n.localize('BASES.AssignStatusHUDSorting.Filter.Placeholder')}" />
				<button
					type="button"
					class="bases-filter-clear"
					aria-label="${game.i18n.localize('BASES.AssignStatusHUDSorting.Filter.Clear')}"
					title="${game.i18n.localize('BASES.AssignStatusHUDSorting.Filter.Clear')}"
					hidden
				>&times;</button>
			</div>
		`;
		palette.prepend(fieldset);
	}

	const input = fieldset.querySelector('.bases-filter-input');
	const clear = fieldset.querySelector('.bases-filter-clear');
	const host = getHost(palette);
	if (input) input.value = palette.dataset.basesFilterValue ?? input.value ?? '';
	syncHudFilterClearState(fieldset, input, clear);
	const applyFilterNow = (value = '') => {
		if (!input) return;
		input.value = value;
		palette.dataset.basesFilterValue = value;
		applyHudFilter(host, value);
		syncHudFilterClearState(fieldset, input, clear);
	};

	if (fieldset.dataset.basesBound === '1') return fieldset;
	fieldset.dataset.basesBound = '1';

	if (!input) return fieldset;
	const SearchFilter = foundry.applications.ux.SearchFilter;
	const search = new SearchFilter({
		inputSelector: '.bases-filter-input',
		contentSelector: '',
		initial: input.value ?? '',
		delay: 25,
		callback: (_event, query) => {
			palette.dataset.basesFilterValue = query;
			applyHudFilter(host, query);
			syncHudFilterClearState(fieldset, input, clear);
		},
	});
	search.bind(fieldset);
	fieldset._basesSearchFilter = search;

	input?.addEventListener('keydown', (event) => {
		if (event.key === 'Escape') {
			event.preventDefault();
			event.stopPropagation();
			if (input.value) {
				applyFilterNow('');
				fieldset._basesSearchFilter?.filter?.(null, '');
			} else {
				closeStatusPaletteIfOpen();
			}
			return;
		}

		if (event.key !== 'Enter') return;
		if (!input.value.trim()) return;

		event.preventDefault();
		event.stopPropagation();

		// Apply latest typed value before triggering first visible match.
		applyFilterNow(input.value);
		fieldset._basesSearchFilter?.filter?.(null, input.value);

		const firstVisible = getFirstVisibleHudEffect(host);
		if (!firstVisible) return;

		queueFilterRefocusIfFiltering();
		const control = firstVisible.querySelector(
			':scope > .effect-control, :scope > [data-status-id], :scope > [data-effect-id], :scope > [data-effect-uuid], :scope > img.effect-control, :scope > img',
		);
		(control ?? firstVisible).dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, composed: true }));
	});
	clear?.addEventListener('click', (event) => {
		event.preventDefault();
		event.stopPropagation();
		if (!input) return;
		applyFilterNow('');
		fieldset._basesSearchFilter?.filter?.(null, '');
		input.focus({ preventScroll: true });
	});

	return fieldset;
}

function relaxHudBounds(palette) {
	const targets = [palette, palette?.closest('.palette')].filter(Boolean);
	for (const el of targets) {
		el.style.maxHeight = 'none';
		if (el.matches?.('.palette.status-effects.active')) el.style.height = 'auto';
		el.style.overflow = 'visible';
	}
}

function enforceHudContentHeight(palette) {
	if (!palette) return;
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

	const statusCfg = getHudEnabledStatusConfigs();
	const systemIds = statusCfg.filter((s) => s.systemEffect).map((s) => s.id).filter(Boolean);
	const foundryIds = statusCfg.filter((s) => !s.systemEffect).map((s) => s.id).filter(Boolean);

	const systemIndex = new Map(systemIds.map((id, idx) => [id, idx]));
	const foundryIndex = new Map(foundryIds.map((id, idx) => [id, idx]));

	const systemEls = [];
	const foundryEls = [];
	const unknown = [];

	for (const el of elements) {
		const id = getStatusId(el);
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
		syncLayoutVars(palette, { mode, cols, rows } = {}) {
			if (!palette) return;
			const normalizedCols = Math.max(1, Number(cols) || 1);
			palette.style.setProperty('--effect-columns', `${normalizedCols}`);
			palette.style.setProperty('grid-auto-flow', mode === 'columns' ? 'column' : 'row', 'important');
			palette.style.setProperty('grid-template-rows', mode === 'columns' ? `repeat(${Math.max(1, Number(rows) || 1)}, auto)` : 'none', 'important');
			palette.style.setProperty(
				'grid-template-columns',
				`repeat(${normalizedCols}, max-content)`,
				'important',
			);
		},
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
			palette.style.setProperty(
				'grid-template-columns',
				`repeat(${normalizedCols}, minmax(var(--bases-daggerheart-status-column-min), 1fr))`,
				'important',
			);
		},
		reorderStatuses(host, elements) {
			return reorderBySystemEffectForDaggerheart(host, elements);
		},
	},
};

function getSystemAdapter() {
	return SYSTEM_ADAPTERS[game.system.id] ?? SYSTEM_ADAPTERS.default;
}

function applyHudGridSettings({ mode, cols, statusLength } = {}) {
	const root = document.documentElement;
	const adapter = getSystemAdapter();
	applyHudScale();

	mode ??= game.settings.get(Constants.MODULE_ID, 'hudFlowMode');
	cols ??= Number(game.settings.get(Constants.MODULE_ID, 'hudColumns')) || 3;
	const filterEnabled = game.settings.get(Constants.MODULE_ID, 'hudFilterEnabled');

	if (!Number.isInteger(statusLength)) {
		const openPalette = findStatusPalette(document.querySelector('#token-hud'));
		statusLength = openPalette ? collectStatusElements(openPalette).length : getHudEnabledStatusConfigs().length;
	}
	const rows = Math.ceil(statusLength / cols) + (filterEnabled ? 1 : 0);

	// columns are always defined
	root.style.setProperty('--bases-grid-column-count', String(cols));
	root.style.setProperty('--bases-grid-template-columns', `repeat(${cols}, minmax(var(--bases-status-column-min), 1fr))`);

	if (mode === 'rows' || adapter.shouldEmulateColumns(mode)) {
		root.style.setProperty('--bases-grid-auto-flow', 'row');
		root.style.setProperty('--bases-grid-template-rows', 'none');
	} else {
		root.style.setProperty('--bases-grid-auto-flow', 'column');
		root.style.setProperty('--bases-grid-template-rows', `repeat(${rows}, auto)`);
	}

	return { mode, cols, rows };
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
	const ids = getHudEnabledStatusConfigs()
		.sort(compareStatusKeys)
		.map((s) => s.id)
		.filter(Boolean);
	globalThis.bases.sortedStatusesIndex = ids;

	return ids;
}

function rebuildAndApply(palette) {
	const host = getHost(palette);
	if (!palette?.isConnected || !host?.isConnected) return;
	if (host.dataset.basesReconciling === '1') return;
	host.dataset.basesReconciling = '1';
	host.dataset.basesSkipObserver = '1';

	try {
		const enabled = game.settings.get(Constants.MODULE_ID, 'hudEnabled');
		const filterEnabled = game.settings.get(Constants.MODULE_ID, 'hudFilterEnabled');
		const tokenHud = document.querySelector('#token-hud');
		const adapter = getSystemAdapter();
		if (tokenHud) {
			tokenHud.classList.toggle('bases-hud-enabled', enabled);
			markHudSystemClass(tokenHud);
		}

		if (!enabled) return;

		const elements = collectStatusElements(palette);
		const layout = applyHudGridSettings({ statusLength: elements.length });
		relaxHudBounds(palette);
		adapter.syncLayoutVars(palette, layout);
		const filterFieldset = ensureHudFilterUI(palette, filterEnabled);
		if (!elements.length) return;

		const orderedIds = getSortedStatusIds();
		const ordered = adapter.reorderStatuses(host, elements) ?? reorderStatusElementsInRuns(host, elements, orderedIds);
		for (const el of ordered) decorateStatusElement(el);
		const filterValue = filterFieldset?.querySelector('.bases-filter-input')?.value ?? palette.dataset.basesFilterValue ?? '';
		applyHudFilter(host, filterEnabled ? filterValue : '', ordered);
		refreshHudBounds(palette);
	} finally {
		delete host.dataset.basesReconciling;
		setTimeout(() => {
			if (!host?.isConnected) return;
			delete host.dataset.basesSkipObserver;
		}, 0);
	}
}

function sortStatusElements(elements, orderedIds) {
	const orderedIndex = new Map((orderedIds ?? []).map((id, idx) => [id, idx]));
	const withKnownOrder = [];
	const unknown = [];

	for (const el of elements) {
		const id = getStatusId(el);
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
		if (allStatusElements.every((el, idx) => el === ordered[idx])) return ordered;
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
		if (!run.every((el, idx) => el === sortedRun[idx])) {
			const ref = run[run.length - 1].nextSibling;
			const frag = document.createDocumentFragment();
			for (const el of sortedRun) frag.appendChild(el);
			host.insertBefore(frag, ref);
		}
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
	const isStatusEffect = Boolean(img.dataset.statusId);

	const existingWrapper = img.parentElement?.classList?.contains('bases-effect-control') ? img.parentElement : null;
	if (existingWrapper) {
		existingWrapper.classList.add('effect-control', 'bases-effect-control');
		if (isStatusEffect) {
			if (!existingWrapper.dataset.action && img.dataset.action) existingWrapper.dataset.action = img.dataset.action;
			if (!existingWrapper.dataset.statusId && img.dataset.statusId) existingWrapper.dataset.statusId = img.dataset.statusId;
		} else {
			delete existingWrapper.dataset.action;
			delete existingWrapper.dataset.statusId;
		}
		let p = existingWrapper.querySelector(':scope > p.bases-label');
		if (!p) {
			p = document.createElement('p');
			p.classList.add('bases-label');
			existingWrapper.appendChild(p);
		}
		if (p.textContent !== text) p.textContent = text;
		return existingWrapper;
	}

	const wrapper = document.createElement('div');
	wrapper.classList.add('effect-control', 'bases-effect-control');
	for (const cls of img.classList) {
		if (!isStatusEffect && cls === 'effect-control') continue;
		wrapper.classList.add(cls);
	}

	for (const [key, value] of Object.entries(img.dataset)) {
		if (!(key in wrapper.dataset)) wrapper.dataset[key] = value;
	}
	if (isStatusEffect) {
		wrapper.dataset.action ??= img.dataset.action ?? 'effect';
		if (img.dataset.statusId) wrapper.dataset.statusId ??= img.dataset.statusId;
	} else {
		delete wrapper.dataset.action;
		delete wrapper.dataset.statusId;
	}
	const title = img.getAttribute('title');
	const ariaLabel = img.getAttribute('aria-label');
	if (title) wrapper.setAttribute('title', title);
	if (ariaLabel) wrapper.setAttribute('aria-label', ariaLabel);

	const p = document.createElement('p');
	p.classList.add('bases-label');
	p.textContent = text;

	if (isStatusEffect) {
		img.classList.remove('effect-control', 'active', 'overlay', 'effect-control-container');
		delete img.dataset.action;
		delete img.dataset.statusId;
		delete img.dataset.tooltipText;
		delete img.dataset.tooltip;
	} else {
		img.classList.remove('overlay', 'effect-control-container');
	}

	img.parentElement?.insertBefore(wrapper, img);
	wrapper.append(img, p);
	return wrapper;
}

function decorateStatusElement(element) {
	const text = normalizeStatusLabel(getLabel(element));

	if (!text) return;

	const node = element.tagName === 'IMG' ? upgradeImageStatusElement(element, text) : element;
	// Keep native element shape untouched when possible; add normalized label metadata.
	if (node.dataset.basesLabel !== text) node.dataset.basesLabel = text;

	const hasNativeLabel = Boolean(node.querySelector?.(':scope > .title, :scope > .label'));
	if (hasNativeLabel) return;

	let p = node.querySelector(':scope > p.bases-label');
	if (!p) {
		p = document.createElement('p');
		p.classList.add('bases-label');
		node.appendChild(p);
	}
	if (p.textContent !== text) p.textContent = text;
}

function findHudStatusInteractionTarget(event) {
	const source = event.target;
	if (!(source instanceof Element)) return null;
	const rawTarget = source.closest(
		'.effect-control, .bases-effect-control, .bases-effect-proxy, [data-status-id], [data-effect-id], [data-effect-uuid]',
	);
	if (!rawTarget) return null;

	const hudRoot = source.closest('#token-hud') ?? canvas?.hud?.token?.element ?? document.querySelector('#token-hud');
	const palette = findStatusPalette(hudRoot);
	const host = getHost(palette);
	if (!host || !host.contains(rawTarget)) return null;

	const target = liftToHostChild(host, rawTarget) ?? rawTarget;
	if (!isHudStatusElement(target)) return null;
	return target;
}

function onTokenHudClick(event) {
	const target = findHudStatusInteractionTarget(event);
	if (!target) return;
	if (event.isTrusted) queueFilterRefocusIfFiltering();

	const id = getStatusId(target);
	if (target.classList.contains('bases-effect-control') || target.classList.contains('bases-effect-proxy')) {
		const icon = target.querySelector(
			':scope > .effect-control, :scope > [data-status-id], :scope > [data-effect-id], :scope > [data-effect-uuid], :scope > img.effect-control, :scope > img',
		);
		if (icon && event.target !== icon) {
			event.preventDefault();
			event.stopPropagation();
			icon.dispatchEvent(
				new MouseEvent(event.type, {
					bubbles: true,
					cancelable: true,
					composed: true,
					button: event.button,
					buttons: event.buttons,
					ctrlKey: event.ctrlKey,
					shiftKey: event.shiftKey,
					altKey: event.altKey,
					metaKey: event.metaKey,
				}),
			);
			return;
		}
	}

	if (!target.classList?.contains('effect-control')) return;

	if (game.system.id !== 'dnd5e') return;
	if (id !== 'exhaustion' && id !== 'concentrating') return;

	const actor = canvas?.hud?.token?.object?.actor;
	if (!actor) return;
	if (!globalThis.dnd5e?.documents?.ActiveEffect5e) return;

	// Mirror dnd5e's dedicated handlers for special status controls.
	if (id === 'exhaustion') dnd5e.documents.ActiveEffect5e._manageExhaustion(event, actor);
	else dnd5e.documents.ActiveEffect5e._manageConcentration(event, actor);
}

function bindHudHandlers(html) {
	if (html.dataset.basesHudBound === '1') return;
	html.dataset.basesHudBound = '1';

	html.addEventListener('click', onTokenHudClick, { capture: true });
	html.addEventListener('contextmenu', onTokenHudClick, { capture: true });
	html.addEventListener('click', onClickStatusPaletteToggle, { capture: true });
}

function disconnectHudMutationObserver() {
	hudMutationObserver?.disconnect();
	hudMutationObserver = null;
	hudObservedHost = null;
}

function isRelevantHudMutation(mutation) {
	if (mutation.type !== 'childList') return false;
	if (mutation.target === hudObservedHost) return true;
	const nodes = [...mutation.addedNodes, ...mutation.removedNodes];
	return nodes.some((node) => node instanceof HTMLElement && (isHudStatusElement(node) || node.querySelector?.('[data-status-id], [data-effect-id], [data-effect-uuid], .effect-control, img.effect-control')));
}

function ensureHudMutationObserver(palette) {
	const host = getHost(palette);
	if (!host) return;
	if (hudObservedHost === host && hudMutationObserver) return;

	disconnectHudMutationObserver();
	hudObservedHost = host;
	const reconcile = foundry.utils.debounce(() => {
		if (!palette?.isConnected || !host?.isConnected) {
			disconnectHudMutationObserver();
			return;
		}
		rebuildAndApply(palette);
		schedulePendingFilterRefocusAfterSettle();
	}, 35);
	hudMutationObserver = new MutationObserver((mutations) => {
		if (!palette?.isConnected || !host?.isConnected) {
			disconnectHudMutationObserver();
			return;
		}
		if (host.dataset.basesReconciling === '1' || host.dataset.basesSkipObserver === '1') return;
		if (!mutations.some(isRelevantHudMutation)) return;
		reconcile();
	});
	hudMutationObserver.observe(host, { childList: true, subtree: true });
}

function updateOpenTokenHUDIfAny({ force = false } = {}) {
	const hudRoot = document.querySelector('#token-hud');
	if (!hudRoot) {
		disconnectHudMutationObserver();
		return;
	}

	const palette = findStatusPalette(hudRoot);
	if (!palette) {
		disconnectHudMutationObserver();
		return;
	}

	if (force) {
		const host = getHost(palette);
		if (host?.dataset) {
			delete host.dataset.basesReconciling;
			delete host.dataset.basesSkipObserver;
		}
	}

	if (!game.settings.get(Constants.MODULE_ID, 'hudEnabled')) {
		hudRoot.classList.remove('bases-hud-enabled');
		disconnectHudMutationObserver();
		return;
	}

	rebuildAndApply(palette);
	ensureHudMutationObserver(palette);
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

	globalThis.bases = { ...globalThis.bases, info: { version: game.modules.get(Constants.MODULE_ID).version } };
	applyHudGridSettings(); // apply saved values

	Hooks.on('renderSettingsConfig', statusesRenderSettingsConfigHook);
	Hooks.on('renderTokenHUD', statusesRenderTokenHUDHook);
	Hooks.on('canvasPan', scheduleHudScale);
}


function statusesRenderSettingsConfigHook(app, html) {
	if (html.dataset.basesHudSettingsBound === '1') return;
	html.dataset.basesHudSettingsBound = '1';

	const enabledInput = game.settings.get(Constants.MODULE_ID, 'hudEnabled'); //hidden setting to turn off if needed programatically
	if (!enabledInput) return;

	const modeSel = html.querySelector(`select[name="${Constants.MODULE_ID}.hudFlowMode"]`);
	const colsPicker = html.querySelector(`range-picker[name="${Constants.MODULE_ID}.hudColumns"]`);
	const scalePicker = html.querySelector(`range-picker[name="${Constants.MODULE_ID}.hudScale"]`);
	const filterInput = html.querySelector(`input[name="${Constants.MODULE_ID}.hudFilterEnabled"]`);

	const flowGroup = modeSel?.closest('.form-group');
	const colsGroup = colsPicker?.closest('.form-group');
	const scaleGroup = scalePicker?.closest('.form-group');

	const setVisibility = (isOn) => {
		if (flowGroup) flowGroup.style.display = isOn ? '' : 'none';
		if (colsGroup) colsGroup.style.display = isOn ? '' : 'none';
		if (scaleGroup) scaleGroup.style.display = isOn ? '' : 'none';
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
		if (!Number.isFinite(cols)) return;
		await setIfChanged('hudColumns', cols);
	}, 50);

	colsPicker?.addEventListener('input', saveCols);
	const saveScale = foundry.utils.debounce(async () => {
		if (!enabledInput) return;
		const scale = Number(scalePicker?.value);
		if (!Number.isFinite(scale)) return;
		applyHudScale(scale);
		await setIfChanged('hudScale', scale);
	}, 50);

	scalePicker?.addEventListener('input', saveScale);
}

function statusesRenderTokenHUDHook(app, html) {
	const enabled = game.settings.get(Constants.MODULE_ID, 'hudEnabled');
	const hudRoot = html.querySelector('#token-hud') ?? html;
	hudRoot.classList.toggle('bases-hud-enabled', enabled);
	markHudSystemClass(hudRoot);
	applyHudScale(undefined, hudRoot);
	bindHudHandlers(html);

	if (!enabled) {
		disconnectHudMutationObserver();
		return;
	}

	const palette = findStatusPalette(html);
	if (!palette) {
		disconnectHudMutationObserver();
		return;
	}

	rebuildAndApply(palette);
	ensureHudMutationObserver(palette);

	const filterEnabled = game.settings.get(Constants.MODULE_ID, 'hudFilterEnabled');
	if (filterEnabled) schedulePendingFilterRefocusAfterSettle();
}

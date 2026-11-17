import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../scripts/bases-main.mjs', import.meta.url), 'utf8');
function load(name, globals) {
	const start = source.indexOf(`function ${name}(`);
	const end = source.indexOf('\nfunction ', start + 1);
	const context = vm.createContext(globals);
	vm.runInContext(source.slice(start, end < 0 ? undefined : end), context);
	return context[name];
}

test('viewport cap includes borders for fitting lists and still limits oversized lists at different scales', () => {
	for (const scale of [0.5, 1, 2]) {
		for (const rowCount of [2, 3]) {
			const height = 44 + rowCount * 100;
			const values = {};
			const palette = {
				offsetHeight: height, clientHeight: height - 2, scrollHeight: height - 2,
				style: { setProperty: (key, value) => { values[key] = value; } },
				getBoundingClientRect: () => ({ top: 0, height: height * scale }),
			};
			const statuses = Array.from({ length: 6 }, (_, index) => {
				const row = Math.floor(index / (6 / rowCount));
				return {
					classList: { contains: () => false },
					getBoundingClientRect: () => ({ top: (40 + row * 100) * scale, bottom: (140 + row * 100) * scale }),
				};
			});
			palette.children = statuses;
			const window = { innerHeight: 1000 };
			const enforce = load('enforceHudContentHeight', { window, collectStatusElements: () => statuses });
			enforce(palette);
			assert.equal(values['--bases-status-max-height'], '244px');
			if (rowCount === 2) assert.ok(parseFloat(values['--bases-status-max-height']) >= height);
			else assert.ok(parseFloat(values['--bases-status-max-height']) < height);
			window.innerHeight = 100;
			enforce(palette);
			assert.equal(parseFloat(values['--bases-status-max-height']), 92 / scale);
		}
	}
});

test('sorting cache refreshes on additions, renames and removals', () => {
	let statuses = [{ id: 'a', name: 'Alpha' }, { id: 'b', name: 'Beta' }];
	const getIds = load('getSortedStatusIds', {
		getHudEnabledStatusConfigs: () => [...statuses],
		compareStatusKeys: (a, b) => a.name.localeCompare(b.name),
	});
	const first = getIds();
	assert.equal(getIds(), first);
	statuses[0].name = 'Zulu';
	assert.deepEqual([...getIds()], ['b', 'a']);
	statuses.push({ id: 'c', name: 'Charlie' });
	assert.deepEqual([...getIds()], ['b', 'c', 'a']);
	statuses = statuses.filter((status) => status.id !== 'b');
	assert.deepEqual([...getIds()], ['c', 'a']);
});

test('tooltips batch reads before writes and preserve native tooltips', () => {
	const events = [];
	function node(native = false) {
		const label = { textContent: 'Long label', get scrollWidth() { events.push('read'); return 100; }, clientWidth: 40 };
		const target = { classList: { contains: () => false }, label,
			dataset: new Proxy(native ? { tooltipText: 'System description' } : {}, {
				set(obj, key, value) { events.push('write'); obj[key] = value; return true; },
			}),
			querySelector: (selector) => selector.includes('p.bases-label') ? label : null,
			hasAttribute: (key) => key === 'data-tooltip-text' && target.dataset.tooltipText !== undefined,
		};
		return target;
	}
	const refresh = load('refreshStatusLabelTooltips', {});
	const a = node(), b = node(true);
	refresh([a, b]);
	assert.deepEqual(events.slice(0, 2), ['read', 'read']);
	assert.equal(a.dataset.tooltipText, 'Long label');
	assert.equal(b.dataset.tooltipText, 'System description');
	a.label.clientWidth = 120;
	refresh([a]);
	assert.equal(a.dataset.tooltipText, undefined);
});

test('5e condition images follow level changes and reset without styling the wrapper', () => {
	const actor = { effects: [{ img: 'exhaustion-3.svg', system: { hasLevels: true, type: 'exhaustion' } }] };
	const cleared = [];
	const style = { removeProperty: (key) => cleared.push(key) };
	let src = 'exhaustion.svg';
	const img = { style, getAttribute: () => src, setAttribute: (_, value) => { src = value; } };
	const node = { style, dataset: {}, querySelector: () => img };
	const sync = load('syncDnd5eConditionIcon', {
		game: { system: { id: 'dnd5e' } }, canvas: { hud: { token: { object: { actor } } } },
		getStatusId: () => 'exhaustion', getStatusConfig: () => ({ img: 'exhaustion.svg' }),
	});
	sync(node);
	assert.equal(src, 'exhaustion-3.svg');
	actor.effects[0].img = 'exhaustion-1.svg';
	sync(node);
	assert.equal(src, 'exhaustion-1.svg');
	actor.effects = [];
	sync(node);
	assert.equal(src, 'exhaustion.svg');
	assert.equal(node.dataset.basesConditionIcon, undefined);
	assert.ok(cleared.includes('background'));
});

// 0.5.0 pure-logic tests: 自拟外挂 data model + prompt, status-bar mode decision (terminal is the default).
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePlugin, pluginPrompt, BUILTIN, GRADES } from '../src/hub-plugins.js';
import { StatusBarHost } from '../src/statusbar-host.js';
import { ENGINE_TABS, NAV } from '../src/hub.js';

test('custom 外挂: unusable entries rejected, fields clamped', () => {
    assert.equal(normalizePlugin(null), null);
    assert.equal(normalizePlugin({ name: '   ' }), null);
    const p = normalizePlugin({ id: 'BAD ID!', name: 'x'.repeat(40), grade: '超神', type: 'weird', daily: 500, rule: 'r'.repeat(900), cost: { kind: 'points', amount: -5, cooldown: 5000 } });
    assert.equal(p.name.length, 24);
    assert.equal(p.grade, '凡品');
    assert.equal(p.type, 'passive');
    assert.equal(p.daily, 99);
    assert.equal(p.rule.length, 600);
    assert.equal(p.cost.amount, 0);
    assert.equal(p.cost.cooldown, 999);
    assert.match(p.id, /^p-[a-z0-9]+$/);
});

test('custom 外挂: macros and markup in user text become inert', () => {
    const p = normalizePlugin({ name: '{{char}}<b>', rule: '<script>x</script>{{user}}' });
    assert.ok(!p.name.includes('{{') && !p.name.includes('<'));
    assert.ok(!p.rule.includes('<script>') && !p.rule.includes('{{'));
});

test('custom 外挂: resource cost keeps a known resource only', () => {
    assert.equal(normalizePlugin({ name: 'a', cost: { kind: 'resource', res: '因果筹码', amount: 3 } }).cost.res, '因果筹码');
    assert.equal(normalizePlugin({ name: 'a', cost: { kind: 'resource', res: '灵石', amount: 3 } }).cost.res, '天命印记');
    assert.equal(normalizePlugin({ name: 'a', cost: { kind: 'gold' } }).cost.kind, 'none');
});

test('外挂 prompt: loaded list with limits and costs; switched-off originals forbidden', () => {
    const a = normalizePlugin({ name: '时停怀表', grade: '仙品', type: 'daily', daily: 2, rule: '时间静止三秒', cost: { kind: 'points', amount: 5000 } });
    const b = normalizePlugin({ name: '天眼', type: 'active', cost: { kind: 'resource', res: '名望', amount: 2, cooldown: 3 } });
    const text = pluginPrompt([a, b], ['诸天打手']);
    assert.match(text, /宿主已装载的自拟外挂/);
    assert.match(text, /时停怀表（仙品·每日次数，每日 2 次；每次 5000 系统点）：时间静止三秒/);
    assert.match(text, /天眼（凡品·主动，冷却 3 回合；每次 2 名望）/);
    assert.match(text, /不要重复扣费/);
    assert.match(text, /宿主当前关闭了：诸天打手。剧情中不得出现或使用/);
    assert.equal(pluginPrompt([], []), '');
});

test('original 外挂 and grades are the six/five of the 3.1 bar', () => {
    assert.deepEqual(BUILTIN, ['无限口袋', '诸天打手', '洞察之眼', '分身派遣', '随身洞天', '万物熔炉']);
    assert.deepEqual(GRADES, ['凡品', '灵品', '仙品', '神品', '禁忌']);
});

test('terminal navigation covers all 8 original pages exactly once', () => {
    const tabs = Object.values(ENGINE_TABS).sort();
    assert.deepEqual(tabs, [1, 2, 3, 4, 5, 6, 7, 8]);
    const ids = NAV.flatMap(g => g.items.map(i => i[0]));
    for (const id of Object.keys(ENGINE_TABS)) assert.ok(ids.includes(id), id);
    assert.equal(new Set(ids).size, ids.length);
});

const mode = (want, ctx = {}) => StatusBarHost.prototype.decideMode.call({ settings: { get: () => want }, ctx: () => ctx }).mode;
test('status bar mode: terminal by default, native only as compatibility, off honoured', () => {
    globalThis.document ??= { querySelector: () => null };
    assert.equal(mode(undefined), 'terminal');
    assert.equal(mode('terminal'), 'terminal');
    assert.equal(mode('native'), 'native');
    assert.equal(mode('off'), 'off');
});

test('status bar mode: yields to an active legacy regex + Tavern Helper', () => {
    const ctx = { extensionSettings: { regex: [{ scriptName: '诸天状态栏', findRegex: '<ZhuTianPanel>([\\s\\S]*?)</ZhuTianPanel>', replaceString: '<html><body>…</body></html>' }] } };
    globalThis.TavernHelper = {};
    try { assert.equal(mode('terminal', ctx), 'yield'); assert.equal(mode('native', ctx), 'native'); }
    finally { delete globalThis.TavernHelper; }
});

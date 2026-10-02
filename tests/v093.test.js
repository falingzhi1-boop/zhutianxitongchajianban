// 0.9.3: 规则 → 额外世界背景 reads worldbooks again (native getWorldbookNames / getWorldbook), the 星图 can correct a
// wrongly detected world, and the 新手引导 wizard. Browser side: tests/native_v093.py.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import original from '../vendor/original/runtime.js';
import { Bridge, toWorldbookEntries } from '../src/th-bridge.js';
import { World, correctFootprint, forgetFootprint, recordFootprint, classifyWorld, WORLD_TYPES } from '../src/world.js';
import { buildStars } from '../src/hub-atlas.js';
import { guideSteps, shouldAutoOpen } from '../src/onboarding.js';
import { CAPABILITIES } from '../src/contracts.js';

const src = f => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const B = original.ZhuTianWorkbenchCore;

// ---------- worldbook read ----------
const ST_BOOK = { entries: {
    5: { uid: 5, comment: '第二条', key: ['剑', 9, '宗门'], content: 'B', constant: false, disable: false, displayIndex: 1 },
    2: { uid: 2, comment: '第一条', key: ['仙'], content: 'A', constant: true, disable: false, displayIndex: 0 },
    7: { uid: 7, comment: '关掉的', key: [], content: 'C', disable: true, displayIndex: 2 },
    8: 'junk',
} };
test('toWorldbookEntries: ST {uid: entry} → TH-style list in editor order, copies only, strings only in keys', () => {
    const rows = toWorldbookEntries(ST_BOOK.entries);
    assert.deepEqual(rows.map(r => r.name), ['第一条', '第二条', '关掉的']);
    assert.deepEqual(rows[1].key, ['剑', '宗门']);
    assert.deepEqual(rows[1].strategy.keys, ['剑', '宗门']);
    assert.equal(rows[2].enabled, false); assert.equal(rows[2].disable, true);
    rows[0].key.push('x'); assert.deepEqual(ST_BOOK.entries[2].key, ['仙'], 'ST cache untouched');
    assert.deepEqual(toWorldbookEntries(null), []);
    assert.deepEqual(toWorldbookEntries([{ comment: 'a', content: 'x' }]).map(r => r.comment), ['a']);
});
test('toWorldbookEntries output is accepted by the original normalizeBook (disabled entries dropped, keys kept)', () => {
    const book = B.normalizeBook(toWorldbookEntries(ST_BOOK.entries), '我的世界书');
    assert.equal(book.name, '我的世界书');
    assert.deepEqual(book.entries.map(e => [e.id, e.title, e.keys, e.content]), [['2', '第一条', ['仙'], 'A'], ['5', '第二条', ['剑', '宗门'], 'B']]);
});
const fakeBridge = ctx => { const b = new Bridge({ context: () => ctx }, { get: () => undefined }); b.loadWorldInfoModule = async () => { throw Error('no module in node'); }; return b; };
test('Bridge.getWorldbookNames: SillyTavern 1.19 getContext().getWorldInfoNames, synchronous, strings only', () => {
    const b = fakeBridge({ getWorldInfoNames: () => ['诸天万界最强系统', 3, '我的书'] });
    assert.deepEqual(b.getWorldbookNames(), ['诸天万界最强系统', '我的书']);
});
test('Bridge.getWorldbookNames without getWorldInfoNames: world-info module list, else /api/settings/get, friendly errors meanwhile', async () => {
    const live = ['A'];
    const b = fakeBridge({ getRequestHeaders: () => ({}) }); b.loadWorldInfoModule = async () => ({ world_names: live });
    assert.throws(() => b.getWorldbookNames(), /正在读取/);
    await b.prefetchWorldbooks();
    live.push('B'); assert.deepEqual(b.getWorldbookNames(), ['A', 'B'], 'live module binding');
    const realFetch = globalThis.fetch;
    try {
        globalThis.fetch = async (url, init) => { assert.equal(url, '/api/settings/get'); assert.equal(init.method, 'POST'); return { ok: true, json: async () => ({ world_names: ['甲', '乙'] }) }; };
        const c = fakeBridge({ getRequestHeaders: () => ({}) });
        await c.prefetchWorldbooks(); assert.deepEqual(c.getWorldbookNames(), ['甲', '乙']);
        globalThis.fetch = async () => { throw Error('offline'); };
        const d = fakeBridge({ getRequestHeaders: () => ({}) });
        await d.prefetchWorldbooks(); assert.throws(() => d.getWorldbookNames(), /读取不到世界书列表/);
    } finally { globalThis.fetch = realFetch; }
});
test('Bridge.getWorldbook: context.loadWorldInfo → entries; missing book → clear error; never writes', async () => {
    let saved = 0;
    const b = fakeBridge({ loadWorldInfo: async n => (n === '我的书' ? ST_BOOK : null), saveWorldInfo: async () => { saved++; } });
    const rows = await b.getWorldbook('我的书');
    assert.equal(rows.length, 3);
    await assert.rejects(b.getWorldbook('没有'), /读取不到世界书「没有」/);
    await assert.rejects(b.getWorldbook(''), /请先选择/);
    assert.equal(saved, 0);
});
test('Bridge.getWorldbook: SillyTavern answers a missing file with an empty dummy book — reported as missing, a real empty book is []', async () => {
    const b = fakeBridge({ getWorldInfoNames: () => ['空书'], loadWorldInfo: async () => ({ entries: {} }) });
    assert.deepEqual(await b.getWorldbook('空书'), []);
    await assert.rejects(b.getWorldbook('不存在'), /读取不到世界书「不存在」/);
});
test('assistant host hands getWorldbookNames / getWorldbook to the original page (the toast text came from their absence)', () => {
    const host = src('src/assistant-host.js');
    assert.match(host, /getWorldbookNames: \(\) => b\.getWorldbookNames\(\), getWorldbook: name => b\.getWorldbook\(name\)/);
    assert.match(src('vendor/original/assistant-runtime.js'), /typeof root\.getWorldbookNames!=='function'\)throw Error\('当前助手缺少世界书读取接口/);
});

// ---------- 星图 correction ----------
test('classifyWorld: 灵笼 guesses 仙侠 from the name (why a correction is needed); an explicit type wins', () => {
    assert.equal(classifyWorld({ name: '灵笼' }), 'xianxia');
    assert.equal(classifyWorld({ name: '灵笼', type: '末世' }), 'default');
    assert.ok(WORLD_TYPES.includes('末世'));
});
test('correctFootprint: rename + type without counting a visit; merges into an existing record of the new name', () => {
    let list = recordFootprint([], { name: '灵笼', theme: 'xianxia', floor: 3, t: 100 });
    list = recordFootprint(list, { name: '夜之城', theme: 'cyber', floor: 9, t: 200 });
    const a = correctFootprint(list, '灵笼', { name: '灵笼', type: '末世', theme: 'default' });
    assert.deepEqual(a.map(x => [x.名称, x.类型, x.主题, x.次数]), [['灵笼', '末世', 'default', 1], ['夜之城', '', 'cyber', 1]]);
    assert.equal(list[0].类型, '', 'input not mutated');
    const b = correctFootprint(list, '灵笼', { name: '夜之城', type: '赛博', theme: 'cyber' });
    assert.equal(b.length, 1);
    assert.deepEqual([b[0].名称, b[0].次数, b[0].首次, b[0].首次楼层, b[0].最近楼层, b[0].类型], ['夜之城', 2, 100, 3, 9, '赛博']);
    assert.deepEqual(correctFootprint(list, '不存在', { name: 'x' }).map(x => x.名称), ['灵笼', '夜之城']);
    assert.deepEqual(forgetFootprint(list, '灵笼').map(x => x.名称), ['夜之城']);
});
test('buildStars: name guesses are marked「?」, explicit types shown as written; the current world follows the live 世界类型', () => {
    const z = { 当前世界: '灵笼', 世界类型: '科幻', 万界足迹: [{ 名称: '灵笼', 类型: '', 主题: 'xianxia', 次数: 1, 首次: 1 }, { 名称: '青云山', 类型: '', 主题: 'xianxia', 次数: 2, 首次: 0 }, { 名称: '夜之城', 类型: '赛博', 主题: 'default', 次数: 1, 首次: 2 }] };
    const g = buildStars(z), by = id => g.nodes.find(n => n.id === 'world:' + id);
    assert.equal(by('灵笼').theme, 'cyber', 'same as the top badge (全息), not the frozen 仙侠');
    assert.equal(by('灵笼').sub, '科幻'); assert.equal(by('灵笼').guess, false);
    assert.equal(by('青云山').sub, '仙侠? · 2次'); assert.equal(by('青云山').guess, true);
    assert.equal(by('夜之城').theme, 'cyber', 'explicit 类型 beats the stored 主题');
    const s = buildStars({ 当前世界: '灵笼' }).nodes[0];
    assert.equal(s.sub, '仙侠?'); assert.equal(s.current, true);
});
function worldWith(ledger) {
    const vars = { 诸天系统: ledger }, notes = [];
    const bridge = {
        getVariables: () => structuredClone(vars),
        updateVariablesWith: async fn => { const next = fn(structuredClone(vars)); Object.assign(vars, next); notes.push('w'); },
    };
    const w = new World({ bridge, settings: { get: () => ({}) }, adapter: { context: () => ({ chat: [1, 2, 3] }) } });
    return { w, vars, notes };
}
test('World.correct: current world — 当前世界 / 世界类型 / footprint in one commit, no visit added', async () => {
    const { w, vars, notes } = worldWith({ 当前世界: '灵笼', 世界类型: '', 万界足迹: [{ 名称: '灵笼', 类型: '', 主题: 'xianxia', 次数: 1, 首次: 1 }] });
    const r = await w.correct('灵笼', { name: '灵笼', type: '末世' });
    assert.deepEqual([r.current, r.to, r.type, r.theme], [true, '灵笼', '末世', 'default']);
    assert.equal(vars.诸天系统.世界类型, '末世');
    assert.deepEqual(vars.诸天系统.万界足迹.map(x => [x.名称, x.类型, x.次数]), [['灵笼', '末世', 1]]);
    assert.equal(notes.length, 1);
    assert.equal(w.lastName, '灵笼'); assert.equal(w.lastType, '末世');
    await w.correct('灵笼', { name: '灵笼·地表' });
    assert.equal(vars.诸天系统.当前世界, '灵笼·地表'); assert.equal(vars.诸天系统.世界类型, '');
});
test('World.correct / forget: other worlds only touch the footprint; current world cannot be deleted', async () => {
    const { w, vars } = worldWith({ 当前世界: '夜之城', 世界类型: '赛博', 万界足迹: [{ 名称: '错世界', 次数: 1 }, { 名称: '夜之城', 类型: '赛博', 次数: 1 }] });
    await w.correct('错世界', { name: '斗罗大陆', type: '' });
    assert.equal(vars.诸天系统.当前世界, '夜之城'); assert.equal(vars.诸天系统.世界类型, '赛博');
    assert.deepEqual(vars.诸天系统.万界足迹.map(x => x.名称), ['斗罗大陆', '夜之城']);
    await assert.rejects(w.correct('不存在', { name: 'x' }), /已经没有这个世界/);
    await assert.rejects(w.forget('夜之城'), /当前世界，不能删除/);
    await w.forget('斗罗大陆');
    assert.deepEqual(vars.诸天系统.万界足迹.map(x => x.名称), ['夜之城']);
});
test('星图 UI: 更正 form on world nodes, 删除 only for non-current worlds, travel form with the current name = correction', () => {
    const a = src('src/hub-atlas.js');
    assert.match(a, /识别错了？更正这个世界/);
    assert.match(a, /\$\{n\.current \? '' : `<button[^`]*data-forget=/);
    assert.match(a, /=== str\(this\.ledger\(\)\?\.当前世界\)\) return this\.fix\(/);
});

// ---------- 新手引导 ----------
test('guideSteps: ticks come from the real state; chat step needs an open chat, a ledger and memory (or no assistant)', () => {
    const none = guideSteps({ wb: { exists: false, current: false, count: 0 }, api: { model: '' }, chat: { open: false } });
    assert.deepEqual(none.map(s => [s.id, s.done]), [['wb', false], ['api', false], ['chat', false]]);
    assert.match(none[2].text, /先打开一个单角色聊天/);
    const stale = guideSteps({ wb: { exists: true, current: false, count: 40 } });
    assert.match(stale[0].text, /不是插件最新版/);
    const all = guideSteps({ wb: { exists: true, current: true, count: 60, chatBound: true }, api: { model: '酒馆当前主API', main: true }, chat: { open: true, ledger: true, memory: true, assistant: true } });
    assert.ok(all.every(s => s.done));
    assert.match(all[1].text, /酒馆当前的主模型/);
    assert.equal(guideSteps({ chat: { open: true, ledger: true, memory: false, assistant: true } })[2].done, false);
    assert.equal(guideSteps({ chat: { open: true, ledger: true, memory: false, assistant: false } })[2].done, true);
    assert.match(guideSteps({ wb: null })[0].text, /读取不到世界书状态/);
});
test('shouldAutoOpen: only once (nothing saved) and only when a step is missing', () => {
    const missing = [{ done: true }, { done: false }], done = [{ done: true }, { done: true }];
    assert.equal(shouldAutoOpen(null, missing), true);
    assert.equal(shouldAutoOpen(null, done), false);
    assert.equal(shouldAutoOpen({ state: 'skipped' }, missing), false);
});
test('新手引导 wiring: settings default, 设置 → 上手 entry, started after the 连接 page hook, steps reuse existing code', () => {
    assert.match(src('src/settings.js'), /guide: null,/);
    assert.match(src('src/hub-settings.js'), /act\('guide', '新手引导…'/);
    assert.match(src('src/hub-settings.js'), /guide: \(\) => app\.guide\?\.open\(\)/);
    const idx = src('index.js');
    assert.ok(idx.indexOf("p==='api'") < idx.indexOf('new Onboarding(this)'), 'strip lands on the mounted form');
    const o = src('src/onboarding.js');
    for (const call of ['f.installWorldbook(', 'f.updateWorldbook(', 'app.features.initChat(', 'saveConfigs(', "getElementById('save-chat')"]) assert.ok(o.includes(call), call);
    assert.ok(src('package.json').includes('node --check src/onboarding.js'));
});
test('capabilities list the three 0.9.3 items as implemented', () => {
    for (const n of ['额外世界背景读取世界书', '星图更正当前世界', '新手引导']) assert.equal(CAPABILITIES.find(c => c.name === n)?.state, 'implemented', n);
});

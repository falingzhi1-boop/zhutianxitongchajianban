// 1.1.1 audit fixes: atomic 保留/分解/回收 · 补记 never overwrites a finished transaction · 补记 pinned to its chat ·
// full-length 还原原文 · strict stacking · nothing written after stop · 重roll does not stack assets · honest gacha message.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PanelGuard, backupComplete, ledgerStamp, repairMessage } from '../src/panel-guard.js';
import { STORAGE } from '../src/contracts.js';
import * as L from '../src/ledger-ops.js';
import { planFromButton, applyItemPlan, recycleValue, keptItem, ITEM_BUTTONS } from '../src/item-actions.js';
import { rollbackFloor, rerollTarget, panelValues, resourceLine, SNAP_KEYS, RerollGuard } from '../src/reroll-guard.js';
import { Commerce } from '../src/commerce.js';
import { isUncertain } from '../src/action-support.js';

const src = f => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const F = '系统点: 1000\n子系统: 1\n好感度: 20\n当前任务: 暂无任务\n功法修炼: 无\n系统播报: 补记';
const P = inner => `<ZhuTianPanel>\n${inner}\n</ZhuTianPanel>`;
const tick = async (n = 10) => { for (let i = 0; i < n; i++) await new Promise(setImmediate); };

// ---------- 补记 / 还原 (panel-guard) ----------
function twoChats() {
    const make = id => ({ chat: [{ is_user: true, mes: id + '输入' }, { mes: id + '正文', swipe_id: 0, swipes: [id + '正文'], extra: {} }], chatMetadata: { variables: { 诸天系统: { 系统点: 1000, 背包: [] } } } });
    const a = make('A'), b = make('B'); let current = a; const saves = [], requests = [], listeners = {};
    for (const [id, c] of [['A', a], ['B', b]]) { c.saveChat = () => { saves.push(id); return Promise.resolve(); }; c.eventTypes = { CHAT_CHANGED: 'cc' }; c.eventSource = { on: (e, f) => (listeners[e] ||= []).push(f), removeListener: (e, f) => { listeners[e] = (listeners[e] || []).filter(x => x !== f); } }; }
    const app = { adapter: { context: () => current, currentIdentity: () => (current === a ? 'A' : 'B'), isGenerating: () => false, subscribe: () => () => {} },
        settings: { get: () => ({}), onChange: () => () => {} }, bridge: { getVariables: () => ({}), generateRaw: async o => { requests.push(o.user_input); return P(F); }, uninjectPrompts() {}, injectPrompts() {} },
        statusbar: { latestPanel: () => null, schedule() {} }, hub: { isOpen: false } };
    const g = new PanelGuard(app); g.template = () => F; g.syncPrompt = () => {}; g.toast = () => {};
    return { a, b, g, app, saves, requests, listeners, switch: () => { current = b; (listeners.cc || []).forEach(f => f()); } };
}
test('audit #3: a 补记 queued in chat A never runs in chat B (pinned target + CHAT_CHANGED)', async () => {
    const f = twoChats(), old = globalThis.setTimeout; let cb;
    globalThis.setTimeout = fn => { cb = fn; return 1; };
    try { f.g.start(); f.g.scheduleBackfill(1, 'auto'); f.switch(); cb?.(); await tick(); }
    finally { globalThis.setTimeout = old; f.g.dispose(); }
    assert.deepEqual(f.saves, []); assert.equal(f.requests.length, 0);
    assert.equal(f.b.chat[1].mes, 'B正文'); assert.equal(f.a.chat[1].mes, 'A正文');
    // even without the CHAT_CHANGED event, the pinned chat array decides
    const f2 = twoChats(); globalThis.setTimeout = fn => { cb = fn; return 1; };
    try { f2.g.scheduleBackfill(1, 'auto'); f2.listeners.cc = []; f2.switch(); cb(); await tick(); }
    finally { globalThis.setTimeout = old; f2.g.dispose(); }
    assert.deepEqual(f2.saves, []); assert.equal(f2.requests.length, 0);
});
test('audit #3b: a running 补记 whose chat switches mid-request writes nothing', async () => {
    const f = twoChats(); f.g.start(); let finish; f.app.bridge.generateRaw = () => new Promise(r => { finish = r; });
    const p = f.g.backfill(1, 'manual'); while (!finish) await tick(1);
    f.switch(); finish(P(F)); await p;
    assert.deepEqual(f.saves, []); assert.equal(f.a.chat[1].mes, 'A正文'); assert.equal(f.b.chat[1].mes, 'B正文'); f.g.dispose();
});
test('audit #6: a 补记 pending when the plugin stops writes and saves nothing', async () => {
    const f = twoChats(); let finish; f.app.bridge.generateRaw = () => new Promise(r => { finish = r; });
    const p = f.g.backfill(1, 'manual'); while (!finish) await tick(1);
    f.g.dispose(); finish(P(F)); await p;
    assert.deepEqual(f.saves, []); assert.equal(f.a.chat[1].mes, 'A正文');
    const f2 = twoChats(); f2.app.bridge.generateRaw = () => new Promise(r => { finish = r; }); finish = null;
    const p2 = f2.g.backfill(1, 'manual'); while (!finish) await tick(1);
    f2.app.bridge.dead = true; finish(P(F)); await p2;
    assert.deepEqual(f2.saves, [], 'bridge stopped → no write either'); f2.g.dispose();
});
test('audit #2: a transaction booked during the 补记 wait is never overwritten by the stale template balance', async () => {
    const f = twoChats(); let finish; f.app.bridge.generateRaw = () => new Promise(r => { finish = r; });
    const p = f.g.backfill(1, 'manual'); while (!finish) await tick(1);
    f.a.chatMetadata.variables.诸天系统.系统点 = 800; finish(P(F));
    await assert.rejects(p, /账本有变化/);
    assert.deepEqual(f.saves, []); assert.ok(!f.a.chat[1].mes.includes('<ZhuTianPanel>')); assert.equal(f.a.chatMetadata.variables.诸天系统.系统点, 800);
    // engine bookkeeping alone (render clock / floor table / folds) is not a transaction
    const f2 = twoChats(); f2.app.bridge.generateRaw = () => new Promise(r => { finish = r; }); finish = null;
    const p2 = f2.g.backfill(1, 'manual'); while (!finish) await tick(1);
    Object.assign(f2.a.chatMetadata.variables.诸天系统, { 界面渲染时间: Date.now(), 面板账本: { 0: { h: 'x' } }, 待处理折叠: { 凡品: true } }); finish(P(F)); await p2;
    assert.deepEqual(f2.saves, ['A']); assert.ok(f2.a.chat[1].mes.endsWith(P(F)));
    assert.equal(ledgerStamp({ b: 1, a: { y: 1, x: 2 } }), ledgerStamp({ a: { x: 2, y: 1 }, b: 1, 界面渲染时间: 5 }));
    f.g.dispose(); f2.g.dispose();
});
test('audit #4: 还原原文 restores a long reply completely; partial (old) backups are refused, never written', async () => {
    const f = twoChats(), m = f.a.chat[1];
    m.mes = '长正文'.repeat(21000) + '\n<zhutianpanel>\n' + F + '\n</zhutianpanel>'; m.swipes = [m.mes]; const raw = m.mes;
    f.g.last = {}; f.g.apply(1, m, repairMessage(raw));
    assert.equal(m.extra[STORAGE].panelRepair.raw.length, raw.length); assert.equal(m.extra[STORAGE].panelRepair.len, raw.length);
    globalThis.confirm = () => true;
    try { await f.g.restore(); } finally { delete globalThis.confirm; }
    assert.equal(m.mes, raw); assert.equal(m.mes.length, 63084); assert.equal(m.extra[STORAGE].panelRepair, undefined);
    // a backup written by the pre-fix build (60000-char prefix, no len) is kept and NOT restored
    const fixed = m.mes = '已修复'; m.extra[STORAGE] = { panelRepair: { v: 1, raw: 'x'.repeat(60000), swipe: 0, issues: ['polluted'] } };
    let asked = false; const toasts = []; f.g.toast = t => toasts.push(t); globalThis.confirm = () => { asked = true; return true; };
    try { await f.g.restore(); } finally { delete globalThis.confirm; }
    assert.equal(asked, false); assert.equal(m.mes, fixed); assert.ok(m.extra[STORAGE].panelRepair); assert.match(toasts[0], /备份不完整/);
    // another swipe is on screen: refused as well
    m.extra[STORAGE] = { panelRepair: { v: 1, raw: '原文', len: 2, swipe: 1, issues: [] } };
    try { globalThis.confirm = () => true; await f.g.restore(); } finally { delete globalThis.confirm; }
    assert.equal(m.mes, fixed); assert.match(toasts[1], /不是被修复的那一条/);
    assert.equal(backupComplete({ raw: 'abc', len: 3 }), true); assert.equal(backupComplete({ raw: 'abc', len: 4 }), false); assert.equal(backupComplete({ raw: 'a'.repeat(60000) }), false);
    f.g.dispose();
});

// ---------- 物品：一次写入 + 严格堆叠 ----------
const btn = (cls, data = {}) => ({ dataset: data, matches: s => s.split(',').some(x => x.trim() === '.' + cls) });
test('audit #5: rows stack only when name, grade, price, source, category and effect match', () => {
    const z = { 背包: [] };
    L.bagAdd(z, { 名称: '玉净瓶', 品级: '仙品', 来源: '剧情', 价格: 1 }, 1);
    L.bagAdd(z, { 名称: '玉净瓶', 品级: '仙品', 来源: '盲盒', 价格: 1e7 }, 1);
    assert.equal(z.背包.length, 2); assert.equal(recycleValue(z.背包[0]) + recycleValue(z.背包[1]), 1000000 + 1, '1 + 1,000,000 — not 2');
    L.bagAdd(z, { 名称: '玉净瓶', 品级: '仙品', 来源: '盲盒', 价格: 1e7 }, 2); assert.equal(z.背包.length, 2); assert.equal(z.背包[1].数量, 3);
    L.bagAdd(z, { 名称: '玉净瓶', 品级: '仙品', 来源: '盲盒', 价格: 1e7, 效果: '不同效果' }, 1); assert.equal(z.背包.length, 3);
    L.bagAdd(z, { 名称: '草', 品级: '凡品' }, 1); L.bagAdd(z, { 名称: '草', 品级: '凡品', 价格: 100 }, 1); assert.equal(z.背包.at(-1).数量, 2, 'missing price = tier price');
    L.bagAdd(z, { 名称: '草', 品级: '凡品', 鉴定: { at: 1 } }, 1); assert.equal(z.背包.length, 5, 'appraised rows never stack');
});
test('audit #1: 保留 / 分解 / 品阶分解 / 全部保留 / 回收 are one plan applied in one write', () => {
    const story = { 名称: '玉净瓶', 品级: '仙品', 来源: '剧情', 价格: 1, 数量: 1 }, box = { 名称: '玉净瓶', 品级: '仙品', 来源: '盲盒', 价格: 1e7, 数量: 1 };
    const fresh = () => ({ 系统点: 0, 背包: [structuredClone(story)], 待处理物品: [structuredClone(box), { 名称: '草', 品级: '凡品', 来源: '盲盒', 价格: 100, 数量: 2 }, { 名称: '果', 品级: '灵品', 来源: '盲盒', 价格: 1e4, 数量: 1 }] });
    let z = fresh(); let plan = planFromButton(btn('btn-keep-item', { idx: '0' }), z);
    let r = applyItemPlan(z, plan); assert.equal(r.kept, 1); assert.equal(z.待处理物品.length, 2); assert.equal(z.背包.length, 2, 'blind-box 仙品 is not merged into the story 仙品');
    assert.throws(() => applyItemPlan(z, plan), /已变化/, 'the same click cannot be booked twice');
    plan = planFromButton(btn('btn-recycle-item', { idx: '1' }), z, { querySelector: () => ({ value: '1' }) });
    r = applyItemPlan(z, plan); assert.equal(r.gain, 1e6); assert.equal(z.系统点, 1e6);
    z = fresh(); plan = planFromButton(btn('btn-decomp-item', { idx: '1' }), z); r = applyItemPlan(z, plan);
    assert.equal(r.gain, 20); assert.equal(z.系统点, 20); assert.equal(z.待处理物品.length, 2);
    z = fresh(); plan = planFromButton(btn('btn-decomp-grade', { grade: '仙品' }), z); r = applyItemPlan(z, plan);
    assert.equal(r.gain, 1e6); assert.ok(z.待处理物品.every(x => x.品级 !== '仙品'));
    z = fresh(); plan = planFromButton(btn('btn-keep-all'), z); r = applyItemPlan(z, plan);
    assert.equal(r.kept, 4); assert.deepEqual(z.待处理物品, []); assert.equal(z.背包.length, 4);
    assert.throws(() => applyItemPlan(z, plan), /已变化/, '全部保留 twice → the second click books nothing');
    // a stale index finds the identical row, never a look-alike
    z = fresh(); plan = planFromButton(btn('btn-keep-item', { idx: '2' }), z); z.待处理物品.unshift({ 名称: '新', 品级: '凡品', 数量: 1 });
    applyItemPlan(z, plan); assert.equal(z.背包.at(-1).名称, '果');
    assert.deepEqual(keptItem({ 名称: 'x', 品级: '灵品' }), { 名称: 'x', 品级: '灵品', 来源: '盲盒', 价格: 1e4, 分类: '其他', 效果: '' });
    assert.equal(ITEM_BUTTONS.split(',').length, 5);
});
function commerceApp({ failSaveAfter = Infinity, uncertainOnFail = true } = {}) {
    const ledger = { 系统点: 0, 背包: [], 待处理物品: [{ 名称: '果', 品级: '灵品', 来源: '盲盒', 价格: 1e4, 数量: 1 }] };
    const ctx = { chat: [{ mes: 'x', swipe_id: 0 }], chatMetadata: { variables: { 诸天系统: ledger } } }; const uncertain = new Set(); let writes = 0; const toasts = [];
    const app = { adapter: { context: () => ctx, currentIdentity: () => 'c1', ledger: () => ctx.chatMetadata.variables.诸天系统, isGenerating: () => false, transactions: { uncertain } },
        bridge: { dead: false, async updateVariablesWith(fn) {
            const draft = structuredClone(ctx.chatMetadata.variables); const next = fn(draft) ?? draft;
            if (++writes > failSaveAfter) { if (uncertainOnFail) uncertain.add('c1'); throw Error('服务器读回不一致'); }
            ctx.chatMetadata.variables = next; return next; } },
        hub: { toast: t => toasts.push(t), engineFrame: null, scheduleEngineView() {} }, settings: { get: () => ({}) } };
    return { app, ctx, toasts, get writes() { return writes; } };
}
test('audit #1: the commerce takeover books 保留 with ONE verified write; a failed write changes nothing', async () => {
    const frame = { contentDocument: { querySelector: () => null }, contentWindow: {} };
    const ok = commerceApp(); await new Commerce(ok.app).item(btn('btn-keep-item', { idx: '0' }), frame);
    assert.equal(ok.writes, 1); assert.equal(ok.ctx.chatMetadata.variables.诸天系统.背包.length, 1); assert.equal(ok.ctx.chatMetadata.variables.诸天系统.待处理物品.length, 0);
    const bad = commerceApp({ failSaveAfter: 0, uncertainOnFail: false });
    await assert.rejects(new Commerce(bad.app).item(btn('btn-decomp-item', { idx: '0' }), frame), /物品与系统点都没有变化/);
    assert.equal(bad.ctx.chatMetadata.variables.诸天系统.待处理物品.length, 1); assert.equal(bad.ctx.chatMetadata.variables.诸天系统.系统点, 0);
    const unk = commerceApp({ failSaveAfter: 0 });
    await assert.rejects(new Commerce(unk.app).item(btn('btn-keep-all'), frame), /未能确认，交易已冻结/);
    assert.equal(isUncertain(unk.app, { id: 'c1' }), true);
});
test('audit P2: an unverified gacha save is reported as unconfirmed, never as 未扣系统点', () => {
    const c = src('src/commerce.js');
    const i = c.indexOf('isUncertain(this.app, token)) throw Error(`${doneCount'), j = c.indexOf("'。未扣系统点，保底未变化。'");
    assert.ok(i > 0 && j > i, 'the uncertain branch is checked before the 未扣 message');
    assert.match(c.slice(i, j), /保存结果未能确认（可能已扣点并写入待处理）/);
});

// ---------- #7 重roll ----------
test('audit #7: vendor snapshot keys are the ones the reroll rollback restores', () => {
    for (const f of ['vendor/original/statusbar-v3.1-part2.js', 'vendor/original/ledger-kernel.js']) {
        const m = /ZT_SNAP_KEYS=(\[[^\]]*\])/.exec(src(f)); assert.ok(m, f);
        assert.deepEqual(JSON.parse(m[1]), [...SNAP_KEYS], f);
    }
});
test('audit #7: a reroll puts the floor back to its snapshot first, so assets are not stacked twice', () => {
    const pre = { 天命印记: 1, 血脉结晶: 0, 因果筹码: 2, 名望: 100, 岁月沉淀: 0 };
    const z = { 系统点: 500, 专属资源: { ...pre, 名望: 200, 因果筹码: 4 }, 金币: 900, 持有金额: '1500', 当前货币: '灵石', 模块变量键: ['金币'],
        面板账本: { 3: { h: 'abc', snap: { 专属资源: pre, 功法库: [], 模块变量键: [], __vars: { 金币: 400 } }, t: 1 } } };
    const old = `正文${P('系统点: 500\n当前货币: 灵石\n持有金额: 1500\n专属资源: 名望200')}`, prev = `上一层${P('系统点: 500\n当前货币: 灵石\n持有金额: 500')}`;
    const chat = [{ is_user: true, mes: 'a' }, { mes: prev }, { is_user: true, mes: 'b' }, { mes: old, swipes: [old], swipe_id: 0 }];
    const t = rerollTarget(chat, 'regenerate'); assert.equal(t.idx, 3); assert.equal(t.previous, prev);
    const r = rollbackFloor(z, t.idx, t);
    assert.ok(r.changed); assert.deepEqual(z.专属资源, pre); assert.equal(z.金币, 400); assert.equal(z.持有金额, '500'); assert.equal(z.系统点, 500, '系统点 untouched');
    assert.equal(z.面板账本[3].h, 'abc', 'the hash stays: the old reply\'s live frame must not re-book itself while the new one streams');
    assert.equal(z.资源行, resourceLine(z)); assert.match(z.资源行, /名望100/);
    assert.equal(rollbackFloor(z, 3, t).changed, false, 'idempotent');
    // a manual edit after that reply is never reverted; 神豪 keeps ∞
    const z2 = { 持有金额: '777', 面板账本: {} }; rollbackFloor(z2, 3, t); assert.equal(z2.持有金额, '777');
    const z3 = { 持有金额: '∞', 神豪模式: true, 面板账本: {} }; rollbackFloor(z3, 3, { replaced: [old.replace('1500', '∞')], previous: prev }); assert.equal(z3.持有金额, '∞');
    // swipe: the replaced replies are the other swipes; the new one is '...'
    const s = { mes: '...', swipes: [old, '...'], swipe_id: 1 };
    assert.deepEqual(rerollTarget([...chat.slice(0, 3), s], 'swipe').replaced, [old]);
    assert.equal(rerollTarget([...chat.slice(0, 3)], 'regenerate'), null, 'nothing to replace after a user message');
    assert.equal(rerollTarget(chat, 'normal'), null);
    assert.deepEqual(panelValues(old).持有金额, '1500');
});
test('audit #7: RerollGuard runs first on GENERATION_STARTED (awaited before the prompt) and writes through the bridge', async () => {
    const listeners = {}; const pre = { 名望: 100 };
    const ctx = { chat: [{ is_user: true, mes: 'a' }, { mes: `x${P('系统点: 1')}` }], eventTypes: { GENERATION_STARTED: 'gs' },
        eventSource: { makeFirst: (e, f) => (listeners[e] ||= []).unshift(f), on: (e, f) => (listeners[e] ||= []).push(f), removeListener: (e, f) => { listeners[e] = listeners[e].filter(x => x !== f); } },
        chatMetadata: { variables: { 诸天系统: { 专属资源: { 名望: 300 }, 面板账本: { 1: { h: 'q', snap: { 专属资源: pre } } } } } } };
    let writes = 0; const hub = { engineSig: 'old', scheduleEngine() {} };
    const app = { adapter: { context: () => ctx, currentIdentity: () => 'c1', isGenerating: () => false }, hub,
        bridge: { async updateVariablesWith(fn) { writes++; const d = structuredClone(ctx.chatMetadata.variables); ctx.chatMetadata.variables = fn(d) ?? d; } } };
    const g = new RerollGuard(app).start();
    await listeners.gs[0]('normal', {}, false); assert.equal(writes, 0);
    await listeners.gs[0]('regenerate', {}, true); assert.equal(writes, 0, 'dry runs never write');
    await listeners.gs[0]('regenerate', {}, false);
    assert.equal(writes, 1); assert.deepEqual(ctx.chatMetadata.variables.诸天系统.专属资源, pre); assert.equal(hub.engineSig, 'old');
    await listeners.gs[0]('regenerate', {}, false); assert.equal(writes, 1, 'already rolled back → no second write');
    // generation over, nothing new booked (h unchanged), the reply on screen has a block → it is booked again
    assert.ok(g.pending); await g.settle();
    assert.equal(writes, 2); assert.equal(ctx.chatMetadata.variables.诸天系统.面板账本[1].h, ''); assert.equal(hub.engineSig, ''); assert.equal(g.stats.rebooked, 1);
    // a new reply was booked meanwhile (hash changed) → nothing to do
    g.pending = { id: 'c1', idx: 1, h: 'q', chat: ctx.chat }; ctx.chatMetadata.variables.诸天系统.面板账本[1].h = 'new'; await g.settle(); assert.equal(writes, 2);
    // the reply was deleted (regenerate failed) → rolled back is right
    g.pending = { id: 'c1', idx: 1, h: 'new', chat: ctx.chat }; ctx.chat.pop(); await g.settle(); assert.equal(writes, 2);
    g.dispose(); assert.equal(listeners.gs.length, 0);
    assert.match(src('index.js'), /new RerollGuard\(this\)\.start\(\)/);
});

test('audit QA: a frame the host already released refuses new writes silently (no uncaught page error)', async () => {
    const { Bridge } = await import('../src/th-bridge.js');
    const { identity } = await import('../src/contracts.js');
    const ctx = { characterId: 0, characters: [{ avatar: 'qa.png' }], getCurrentChatId: () => 'a', chat: [{ mes: 'a' }],
        chatMetadata: { variables: { 诸天系统: { 系统点: 1000 } } }, extensionSettings: { variables: { global: {} } }, saveSettingsDebounced() {} };
    let saves = 0; ctx.saveMetadata = async () => { saves++; };
    const adapter = { context: () => ctx, currentIdentity: () => identity(ctx), isGenerating: () => false, subscribe: () => () => {} };
    const bridge = new Bridge(adapter, { scriptVariables: () => ({}), setScriptVariables() {} });
    try {
        const api = bridge.frameApi(() => 0); api.dispose();
        let settled = false, calls = 0;
        api.updateVariablesWith(v => { calls++; v.诸天系统.系统点 = 1; return v; }).then(() => { settled = true; }, () => { settled = true; });
        await tick(20);
        assert.equal(settled, false); assert.equal(calls, 0); assert.equal(saves, 0);
        assert.equal(ctx.chatMetadata.variables.诸天系统.系统点, 1000);
        assert.throws(() => api.getVariables(), /失效/);
    } finally { bridge.dispose(); }
});

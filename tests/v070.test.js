// 0.7.0 pure logic: ledger diff → performances, read-back check, world classification + footprints, atlas builders,
// Lilith reaction lines, settings migration (terminal-only UI).
import test from 'node:test';
import assert from 'node:assert/strict';
import { diffLedger, stillBooked, describe, FX_KINDS } from '../src/fx.js';
import { classifyWorld, recordFootprint, worldPrompt, THEMES } from '../src/world.js';
import { buildEvents, buildBonds, buildStars, buildTree, stageOf } from '../src/hub-atlas.js';
import { REACT } from '../src/lilith-stage.js';
import { Settings } from '../src/settings.js';
import { ID, VERSION, CAPABILITIES } from '../src/contracts.js';
import { readFileSync } from 'node:fs';

const base = () => ({ 系统点: 1000, 当前世界: '太初仙域', 任务库: { T1: { 名称: '引气入体', 状态: '进行中', 完成度: 30 } }, 任务结算凭据: {}, 背包: [], 累计抽数: 0, 神品次数: 0, 仙品次数: 0, 功法待播报: [], 宿主实力档: 2, 恋爱目标: { 姓名: '暂无' }, 聊天群: { 成员: [] } });
const kinds = evs => evs.map(e => e.kind);

test('diff: nothing changed → no performance', () => { assert.deepEqual(diffLedger(base(), base()), []); });
test('diff: no previous ledger → nothing (the watcher handles creation separately)', () => { assert.deepEqual(diffLedger(null, base()), []); });
test('diff: travel, contract, breakthrough, task, draw, reward in play order', () => {
    const a = base(), b = base();
    b.当前世界 = '夜之城'; b.世界类型 = '赛博';
    b.恋爱目标 = { 姓名: '柳如烟' }; b.聊天群 = { 成员: [{ id: 'm1', 名称: '韩立', 世界: '凡人修仙界' }] };
    b.功法待播报 = [{ 名称: '青云诀', 阶段: '熟练', 奖励: '', 楼层: 3 }]; b.宿主实力档 = 3;
    b.任务结算凭据 = { T1: { 点数: 5000, 楼层: 3, 任务名: '引气入体' } }; b.任务库.T1.状态 = '已完成';
    b.累计抽数 = 10; b.神品次数 = 1; b.待处理物品 = [{ 名称: '混沌珠' }];
    b.背包 = [{ 名称: '回春丹', 品级: '灵品', 数量: 2 }];
    const evs = diffLedger(a, b);
    assert.deepEqual(kinds(evs), ['travel', 'contract', 'contract', 'breakthrough', 'breakthrough', 'task', 'draw', 'reward']);
    assert.equal(evs[0].to, '夜之城'); assert.equal(evs[0].from, '太初仙域');
    assert.equal(evs.find(e => e.kind === 'task').points, 5000);
    assert.equal(evs.find(e => e.kind === 'draw').best, '神品');
    assert.deepEqual(evs.find(e => e.kind === 'draw').items, ['混沌珠']);
    assert.equal(evs.find(e => e.kind === 'reward').items[0].n, 2);
    assert.ok(evs.every(e => e.key && FX_KINDS[e.kind]));
});
test('diff: a receipt is the settlement; a status flip without points still completes; failure is its own event', () => {
    const a = base(), b = base(); a.任务库.T2 = { 名称: '夺回玉佩', 状态: '进行中' }; b.任务库.T2 = { 名称: '夺回玉佩', 状态: '已失败' }; b.任务库.T1.状态 = '已完成';
    const evs = diffLedger(a, b);
    assert.deepEqual(kinds(evs), ['task', 'fail']); assert.equal(evs[0].points, 0);
});
test('diff: a receipt that already existed does not replay; placeholder names are not a contract', () => {
    const a = base(); a.任务结算凭据 = { T1: { 点数: 1 } }; const b = structuredClone(a); b.恋爱目标 = { 姓名: '无' };
    assert.deepEqual(diffLedger(a, b), []);
});
test('diff: bag decrease (use / sell) is not a reward', () => {
    const a = base(); a.背包 = [{ 名称: '回春丹', 数量: 3 }]; const b = structuredClone(a); b.背包 = [{ 名称: '回春丹', 数量: 1 }];
    assert.deepEqual(diffLedger(a, b), []);
});
test('stillBooked: a rolled-back change never plays', () => {
    const a = base(), b = base(); b.累计抽数 = 10;
    const [ev] = diffLedger(a, b);
    assert.equal(stillBooked(ev, b), true); assert.equal(stillBooked(ev, a), false); assert.equal(stillBooked(ev, null), false);
    const c = base(); c.任务结算凭据 = { T1: { 点数: 9 } }; const [t] = diffLedger(base(), c);
    assert.equal(stillBooked(t, c), true); assert.equal(stillBooked(t, base()), false);
    const d = base(); d.当前世界 = '夜之城'; const [w] = diffLedger(base(), d);
    assert.equal(stillBooked(w, d), true); assert.equal(stillBooked(w, base()), false);
});
test('describe gives a clear result line for every kind', () => {
    assert.match(describe({ kind: 'task', name: '引气入体', points: 5000 }).detail, /引气入体.*5,000/);
    assert.match(describe({ kind: 'travel', from: 'A', to: 'B' }).detail, /A → B/);
    assert.equal(describe({ kind: 'fail', name: 'X' }).title, '任务失败');
    for (const k of Object.keys(FX_KINDS)) assert.ok(describe({ kind: k, name: 'n', to: 't', items: [], n: 1 }).title);
});

test('world: explicit type first, then name, then currency; unknown → default', () => {
    assert.equal(classifyWorld({ type: '赛博', name: '太初仙域' }), 'cyber');
    assert.equal(classifyWorld({ name: '太初仙域' }), 'xianxia');
    assert.equal(classifyWorld({ name: '夜之城' }), 'cyber');
    assert.equal(classifyWorld({ name: '雾隐镇' }), 'eerie');
    assert.equal(classifyWorld({ type: '规则怪谈' }), 'eerie');
    assert.equal(classifyWorld({ name: '某地', currency: '信用点' }), 'cyber');
    assert.equal(classifyWorld({ type: '都市', name: '青云宗' }), 'default');
    assert.equal(classifyWorld({ name: '伦敦' }), 'default');
    assert.deepEqual(Object.keys(THEMES), ['default', 'xianxia', 'cyber', 'eerie']);
});
test('world: footprints count visits, keep newest last, cap 40, strip markup', () => {
    let l = recordFootprint([], { name: 'A', floor: 1, t: 1 });
    l = recordFootprint(l, { name: 'B<x>', floor: 2, t: 2 });
    l = recordFootprint(l, { name: 'A', floor: 5, t: 3 });
    assert.deepEqual(l.map(x => x.名称), ['Bx', 'A']); assert.equal(l[1].次数, 2); assert.equal(l[1].首次楼层, 1); assert.equal(l[1].最近楼层, 5);
    for (let i = 0; i < 50; i++) l = recordFootprint(l, { name: 'W' + i });
    assert.equal(l.length, 40);
    assert.match(worldPrompt({ 当前世界: '夜之城' }), /当前世界=世界名；世界类型=/);
});

const rich = () => ({
    ...base(), 当前世界: '太初仙域',
    任务库: { T1: { 名称: '引气入体', 状态: '已完成', 来源: '系统发布', 更新楼层: 1 }, T2: { 名称: '拜入青云门', 状态: '进行中', 来源: '引气入体', 更新楼层: 3, 奖励: '青云诀' }, T3: { 名称: '夺回玉佩', 状态: '已失败', 来源: '柳如烟请求', 更新楼层: 3 } },
    任务结算凭据: { T1: { 点数: 5000, 楼层: 2 } }, 恋爱目标: { 姓名: '柳如烟', 好感度: 60 }, 打手: [{ 名称: '石敢当', 忠诚: 80 }],
    聊天群: { 成员: [{ id: 'm1', 名称: '韩立', 世界: '凡人修仙界', 好感: 40 }] },
    万界足迹: [{ 名称: '诸天空间', 首次楼层: 0, 首次: 1 }, { 名称: '太初仙域', 首次楼层: 1, 首次: 2 }],
    功法库: [{ 名称: '青云诀', 熟练度: 620, 上限: 2000 }], 功法: { 名称: '青云诀' }, 神通记录: [{ 摘要: '确认实力档' }],
});
test('atlas 事件线: cause → task → result, chains between tasks, every node has its ledger path', () => {
    const g = buildEvents(rich());
    assert.ok(g.nodes.find(n => n.id === 'result:T1' && n.type === 'receipt'));
    assert.ok(g.nodes.find(n => n.id === 'result:T3' && n.type === 'fail'));
    assert.ok(g.edges.find(e => e.kind === 'chain' && e.from === 'task:T1' && e.to === 'task:T2'));
    assert.ok(g.nodes.every(n => n.src && n.rec));
    assert.equal(g.bands[0].world, '太初仙域');
    assert.deepEqual(buildEvents({}).nodes, []);
});
test('atlas 羁绊图 / 星图 / 能力树 are built from records only', () => {
    const b = buildBonds(rich());
    assert.deepEqual(b.nodes.map(n => n.type).sort(), ['host', 'lilith', 'love', 'member', 'summon']);
    assert.deepEqual(b.nodes.find(n => n.type === 'love').tasks.map(t => t.id), ['T3']);
    const s = buildStars(rich());
    assert.ok(s.nodes.find(n => n.name === '太初仙域').current);
    assert.ok(s.nodes.find(n => n.type === 'rumor' && n.name === '凡人修仙界'));
    assert.equal(s.edges.length, 1);
    assert.ok(buildStars({ 当前世界: '新世界' }).nodes[0].current, 'current world shows even without a footprint');
    const t = buildTree(rich(), { off: ['万物熔炉'], custom: [{ id: 'p-1', name: '自拟', grade: '灵品' }] });
    assert.equal(t.nodes.find(n => n.id === 'skill:青云诀').sub, '熟练 · 主修');
    assert.ok(t.nodes.find(n => n.id === 'plug:万物熔炉').dim);
    assert.ok(t.nodes.find(n => n.id === 'plug:c:p-1'));
    assert.equal(stageOf({ 熟练度: 2000, 上限: 2000 }), '精通·圆满');
    assert.equal(stageOf({ 入道: true }), '入道');
});
test('Lilith reactions only use original zones', () => {
    const zones = new Set(['wing', 'horn', 'cheek', 'chest', 'lower', 'thigh']);
    for (const [k, r] of Object.entries(REACT)) { assert.ok(zones.has(r.zone), k); assert.ok(r.lines.length); }
});
test('settings: stored native status bar moves to terminal once; explicit later choice stays', () => {
    const store = { [ID]: { statusbar: 'native' } };
    const s = new Settings({ context: () => ({ extensionSettings: store, saveSettingsDebounced() {} }) });
    assert.equal(s.get('statusbar'), 'terminal'); assert.equal(store[ID].migrated070, true);
    store[ID].statusbar = 'native'; assert.equal(s.get('statusbar'), 'native');
    assert.deepEqual(s.get('fx'), { mode: 'full', outside: true }); assert.equal(s.get('world').theme, 'auto'); assert.equal(s.get('lilith').camera, true);
});
test('version files agree and 0.7.0 capabilities are declared', () => {
    const m = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url))), p = JSON.parse(readFileSync(new URL('../package.json', import.meta.url))), l = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url)));
    assert.equal(VERSION, '0.7.0'); assert.equal(m.version, VERSION); assert.equal(p.version, VERSION); assert.equal(l.version, VERSION); assert.equal(l.packages[''].version, VERSION);
    for (const f of ['world.js', 'fx.js', 'hub-atlas.js', 'lilith-stage.js']) assert.match(p.scripts.check, new RegExp('src/' + f.replace('.', '\\.')));
    assert.ok(CAPABILITIES.some(c => c.name.startsWith('演出')) && CAPABILITIES.some(c => c.name.startsWith('图谱')));
});

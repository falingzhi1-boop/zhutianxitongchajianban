// 1.1.2: 抽卡模式切换（经典折叠 / 十抽一结算）· 羁绊页重做与群员拉入 · 管理员控制台新页面.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Commerce, foldGrades, foldedRow, gachaMode, GACHA_MODES, classicTokens } from '../src/commerce.js';
import { listBonds, pullMember, dropPulled, sortBonds, pulledEntry } from '../src/bonds-data.js';
import { relKind, favorStage, filterPeople } from '../src/bonds.js';
import { buildBonds } from '../src/hub-atlas.js';
import { planAdmin, applyAdmin, readField, ADMIN_FIELDS } from '../src/admin.js';
import { TIER_PRICE } from '../src/ledger-ops.js';
import { recycleValue } from '../src/item-actions.js';

const src = f => readFileSync(new URL('../' + f, import.meta.url), 'utf8');

// ---------- 抽卡模式 ----------
test('1.1.2 gacha mode: 经典折叠 is the default, 十抽一结算 only when chosen', () => {
    assert.equal(gachaMode({ get: () => undefined }), 'classic');
    assert.equal(gachaMode({ get: () => 'classic' }), 'classic');
    assert.equal(gachaMode({ get: () => 'chunk' }), 'chunk');
    assert.equal(gachaMode(null), 'classic');
    assert.match(src('src/settings.js'), /gachaMode: 'classic'/);
    assert.deepEqual(Object.keys(GACHA_MODES), ['classic', 'chunk']);
});
test('1.1.2 fold thresholds: <50 nothing, ≥50 凡品, ≥100 凡品 + 灵品; 仙品 / 神品 never fold', () => {
    assert.deepEqual(foldGrades(1), []); assert.deepEqual(foldGrades(49), []);
    assert.deepEqual(foldGrades(50), ['凡品']); assert.deepEqual(foldGrades(99), ['凡品']);
    assert.deepEqual(foldGrades(100), ['凡品', '灵品']); assert.deepEqual(foldGrades(200), ['凡品', '灵品']);
});
test('1.1.2 a folded row is worth exactly its single items (price × 数量 → 回收 / 分解 unchanged)', () => {
    const r = foldedRow('灵品', 37);
    assert.deepEqual([r.名称, r.品级, r.数量, r.价格, r.来源], ['灵品杂物', '灵品', 37, TIER_PRICE.灵品, '盲盒']);
    assert.equal(recycleValue(r) * r.数量, recycleValue({ 品级: '灵品', 价格: TIER_PRICE.灵品 }) * 37);
});

const uniq = (id, base) => Array.from({ length: 10 }, (_, k) => String.fromCharCode(base + id * 13 + k * 7)).join('');
function gachaApp({ points = 5e6, failWrite = false } = {}) {
    const ledger = { 系统点: points, 背包: [], 待处理物品: [], 盲盒状态: {}, 商品历史: [] };
    const chat = [{ mes: 'x', swipe_id: 0 }], ctx = { chat, chatMetadata: { variables: { 诸天系统: ledger } } };
    const calls = []; let writes = 0;
    const app = {
        adapter: { context: () => ctx, currentIdentity: () => 'c1', ledger: () => ctx.chatMetadata.variables.诸天系统, isGenerating: () => false, transactions: { uncertain: new Set() } },
        bridge: { dead: false, getVariables: () => ({}),
            async generateRaw({ user_input, max_tokens }) {
                const ids = [...user_input.matchAll(/"id":(\d+)/g)].map(m => +m[1]); calls.push(ids.length); calls.tokens = [...(calls.tokens || []), max_tokens];
                const slots = JSON.parse(user_input.split('槽位：')[1].split('\n')[0]);
                return JSON.stringify(slots.map(s => ({ slot: s.id, name: uniq(s.id, 0x4e00), effect: uniq(s.id, 0x5e00) + '的效果', world: '原创宇宙', theme: s.theme, origin: '原创' })));
            },
            async updateVariablesWith(fn) { const draft = structuredClone(ctx.chatMetadata.variables); const next = fn(draft) ?? draft; writes++; if (failWrite) throw Error('写入失败'); ctx.chatMetadata.variables = next; return next; } },
        hub: { toast() {}, engineFrame: null, scheduleEngineView() {} }, settings: { get: () => undefined },
    };
    const token = { id: 'c1', chat, tail: JSON.stringify(chat.map(m => [m.mes, m.swipe_id])) };
    const frame = { contentDocument: { querySelector: () => null }, contentWindow: {} };
    return { app, ctx, calls, token, frame, get writes() { return writes; }, get z() { return ctx.chatMetadata.variables.诸天系统; } };
}
const button = () => ({ textContent: '' });
for (const count of [10, 50, 120]) test(`1.1.2 经典折叠 ${count} 抽: one write, one charge, every pull accounted for, folded grades never sent to the model`, async () => {
    const f = gachaApp();
    await new Commerce(f.app).classic(count, (await import('../src/commerce-plan.js')).preferences(), f.token, button(), f.frame);
    const z = f.z, folded = foldGrades(count);
    assert.equal(f.writes, 1, 'whole draw = one verified write');
    assert.equal(z.系统点, 5e6 - count * 1e4);
    assert.equal(z.待处理物品.reduce((n, r) => n + r.数量, 0), count, 'Σ 数量 = pulls');
    assert.equal(z.盲盒状态.累计抽数, count);
    const singles = z.待处理物品.filter(r => r.数量 === 1 && !r.名称.endsWith('杂物'));
    assert.ok(singles.every(r => !folded.includes(r.品级)), 'no single item of a folded grade');
    assert.equal(f.calls.reduce((a, b) => a + b, 0), singles.length, 'only unfolded items reach the model');
    assert.equal(f.calls.length, singles.length ? 1 : 0, '1.1.3: the whole draw is one API call: ' + f.calls.join(','));
    if (singles.length) assert.deepEqual(f.calls.tokens, [classicTokens(singles.length)], 'output budget scales with the item count');
    for (const g of folded) assert.ok(z.待处理物品.filter(r => r.品级 === g).length <= 1, g + ' folded into at most one row');
    if (count >= 100) assert.ok(singles.length >= 1, 'the 100th pull is a 仙品 (pity) and is generated on its own');
    assert.equal(z.商品历史.length, singles.length);
    assert.match(z.操作日志.at(-1).text, /经典折叠/);
});
test('1.1.2 经典折叠: a failed write charges nothing and the pity is unchanged', async () => {
    const f = gachaApp({ failWrite: true });
    await assert.rejects(new Commerce(f.app).classic(20, (await import('../src/commerce-plan.js')).preferences(), f.token, button(), f.frame), /未扣系统点，保底未变化/);
    assert.equal(f.z.系统点, 5e6); assert.deepEqual(f.z.盲盒状态, {}); assert.equal(f.z.待处理物品.length, 0);
});
test('1.1.2 经典折叠: not enough points → nothing is generated', async () => {
    const f = gachaApp({ points: 1e4 });
    await assert.rejects(new Commerce(f.app).classic(2, (await import('../src/commerce-plan.js')).preferences(), f.token, button(), f.frame), /系统点不足/);
    assert.equal(f.calls.length, 0);
});
test('1.1.2 the gacha button follows the chosen mode; the mode switch is painted next to the original buttons', () => {
    const c = src('src/commerce.js');
    assert.match(c, /if \(gachaMode\(this\.app\.settings\) === 'classic'\) return await this\.classic\(/);
    assert.match(c, /this\.paintShenPity\(doc\); this\.paintGachaMode\(doc\);/);
    assert.match(c, /data-zt-gacha-mode/);
});

// ---------- 羁绊 ----------
const world = () => ({ 当前世界: '斗罗', 羁绊库: [{ id: 'person:%E6%96%97%E7%BD%97:%E5%B0%8F%E8%88%9E', 姓名: '小舞', 世界: '斗罗', 关系: '恋人', 好感度: 60 }, { id: 'p2', 姓名: '雪女', 世界: '秦时', 关系: '朋友', 好感度: 30 }],
    当前羁绊ID: 'person:%E6%96%97%E7%BD%97:%E5%B0%8F%E8%88%9E', 打手: [{ 名称: '甲士', 忠诚: 70 }],
    聊天群: { 成员: [{ id: 'g1', 名称: '鸣人', 世界: '火影', 好感: 45, 身份: '管理员', 档: 4, 性格: '热血', 特产: '拉面' }, { id: 'g2', 名称: '小舞', 世界: '斗罗', 好感: 10 }] } });
test('1.1.2 group members are not 羁绊 by default; the current world comes first', () => {
    const z = world(), list = listBonds(z);
    assert.deepEqual(list.map(p => p.姓名), ['小舞', '甲士', '雪女'], 'members hidden; 斗罗 (and 打手 of the current world) first');
    assert.equal(list.some(p => p.source === 'group'), false);
    assert.deepEqual(sortBonds([{ 世界: 'a' }, { 世界: 'b' }, { 世界: 'a' }], 'b').map(p => p.世界), ['b', 'a', 'a']);
});
test('1.1.2「拉入羁绊」: a member becomes a 群友 with the group 好感; live group data shown; idempotent', () => {
    const z = world(); const p = pullMember(z, 'g1');
    assert.deepEqual([p.姓名, p.世界, p.关系, p.好感度, p.群员ID, p.群员拉入], ['鸣人', '火影', '群友', 45, 'g1', true]);
    assert.equal(pullMember(z, 'g1').id, p.id); assert.equal(z.羁绊库.length, 3, 'second pull adds nothing');
    const shown = listBonds(z).find(x => x.姓名 === '鸣人');
    assert.deepEqual(shown.群内, { 在群: true, 好感: 45, 身份: '管理员', 实力档: 4, 特产: '拉面' });
    z.聊天群.成员.shift(); assert.deepEqual(listBonds(z).find(x => x.姓名 === '鸣人').群内, { 在群: false }, 'kicked: the 羁绊 stays');
    assert.throws(() => pullMember(z, 'nope'), /没有这个群员/);
});
test('1.1.2 a member who already is a 羁绊 (same name + world) is linked, never duplicated or deleted', () => {
    const z = world(); const p = pullMember(z, 'g2');
    assert.equal(z.羁绊库.length, 2); assert.equal(p.id, z.当前羁绊ID); assert.equal(p.群员ID, 'g2'); assert.equal(p.群员拉入, undefined);
    assert.throws(() => dropPulled(z, p.id), /当前攻略目标不能移出/);
    z.当前羁绊ID = 'p2'; const r = dropPulled(z, p.id);
    assert.equal(r.removed, false); assert.equal(z.羁绊库.length, 2, 'only the link goes'); assert.equal(pulledEntry(z, 'g2'), null);
});
test('1.1.2「移出羁绊」removes a pulled 群友 only; the group is untouched', () => {
    const z = world(); const p = pullMember(z, 'g1'); const r = dropPulled(z, p.id);
    assert.equal(r.removed, true); assert.equal(z.羁绊库.some(x => x.姓名 === '鸣人'), false); assert.equal(z.聊天群.成员.length, 2);
    assert.throws(() => dropPulled(z, 'p2'), /只有从聊天群拉进来的群友可以移出/);
});
test('1.1.2 bond page filters and labels', () => {
    const z = world(); pullMember(z, 'g1'); const list = listBonds(z);
    assert.deepEqual(filterPeople(list, 'here', '斗罗').map(p => p.姓名), ['小舞', '甲士']);
    assert.deepEqual(filterPeople(list, 'group').map(p => p.姓名), ['鸣人']);
    assert.deepEqual(filterPeople(list, 'love').map(p => p.姓名), ['小舞']);
    assert.deepEqual(filterPeople(list, 'summon').map(p => p.姓名), ['甲士']);
    assert.equal(filterPeople(list, 'all').length, 4);
    assert.deepEqual(list.map(relKind), ['love', 'summon', 'bond', 'group']);
    assert.deepEqual([0, 19, 20, 40, 60, 80, 100].map(favorStage), ['陌生', '陌生', '熟识', '友好', '亲密', '挚爱', '挚爱']);
});
test('1.1.2 关系图: a pulled member is drawn once (as a 羁绊); the others keep a「拉入羁绊」button', () => {
    const z = world(); pullMember(z, 'g1'); const g = buildBonds(z);
    assert.equal(g.nodes.some(n => n.id === 'bond:m:g1'), false); assert.ok(g.nodes.some(n => n.type === 'love' && n.name === '鸣人'));
    assert.ok(g.nodes.some(n => n.id === 'bond:m:g2'));
    assert.match(src('src/hub-atlas.js'), /data-pull-bond=/); assert.match(src('src/hub-group.js'), /data-bond-pull=/);
});

// ---------- 管理员控制台 ----------
const adminLedger = () => ({ 系统点: 1000, 专属资源: { 天命印记: 1, 血脉结晶: 0, 因果筹码: 2, 名望: 100, 岁月沉淀: 0 }, 宿主实力档: 2, 功法: { 名称: '基础剑法', 熟练度: 3, 上限: 10 },
    盲盒状态: { 保底计数: 10, 累计抽数: 50, 神品次数: 0 }, 羁绊库: [{ id: 'a', 姓名: '甲', 世界: 'w', 好感度: 20 }, { id: 'b', 姓名: '乙', 世界: 'w', 好感度: 5 }], 当前羁绊ID: 'a', 恋爱目标: { 姓名: '甲', 好感度: 20 },
    聊天群: { 成员: [{ id: 'g1', 名称: '鸣人', 好感: 45 }] }, 面板账本: { 3: { h: 'x', snap: { 专属资源: { 名望: 60, 天命印记: 1 } } }, 4: { h: 'y', snap: { 专属资源: { 名望: 100 } } } } });
test('1.1.2 admin: only edited fields become changes; invalid values are refused with the field name', () => {
    const z = adminLedger();
    assert.deepEqual(planAdmin(z, { 'f:系统点': '1000', 'f:宿主实力档': '2', 'f:当前货币': '' }), []);
    const c = planAdmin(z, { 'f:系统点': '5,000', 'p:b:好感度': '80', 'm:g1': '90', 'f:盲盒状态.神品保底计数': '998' });
    assert.deepEqual(c.map(x => [x.label, x.from, x.to]), [['系统点', 1000, 5000], ['乙（w）好感度', 5, 80], ['群员 鸣人 好感', 45, 90], ['神品保底计数', 50, 998]]);
    assert.throws(() => planAdmin(z, { 'f:宿主实力档': '9' }), /宿主实力档 须在 1–8 之间/);
    assert.throws(() => planAdmin(z, { 'f:系统点': '1e5' }), /系统点 须为整数/);
    assert.throws(() => planAdmin(z, { 'p:a:好感度': '101' }), /好感度 须在 0–100 之间/);
    assert.throws(() => planAdmin(z, { 'f:盲盒状态.保底计数': '100' }), /仙品保底计数 须在 0–99 之间/);
    assert.equal(readField({ 盲盒状态: { 累计抽数: 30 } }, '盲盒状态.神品保底计数'), 30, 'old saves: derived like the gacha does');
    assert.ok(ADMIN_FIELDS.length >= 20);
});
test('1.1.2 admin: one apply writes every change; the active target mirrors into 恋爱目标', () => {
    const z = adminLedger(), changes = planAdmin(z, { 'f:系统点': '5000', 'p:a:好感度': '70', 'p:a:黑化值': '5', 'm:g1': '90', 'f:盲盒状态.神品保底计数': '998' });
    applyAdmin(z, changes);
    assert.equal(z.系统点, 5000); assert.equal(z.羁绊库[0].好感度, 70); assert.equal(z.恋爱目标.好感度, 70); assert.equal(z.恋爱目标.黑化值, 5);
    assert.equal(z.聊天群.成员[0].好感, 90); assert.equal(z.盲盒状态.神品保底计数, 998); assert.equal(z.盲盒状态.保底计数, 10);
});
test('1.1.2 admin: a field that changed since the page was read is a conflict — nothing is applied', () => {
    const loaded = adminLedger(), changes = planAdmin(loaded, { 'f:系统点': '5000', 'f:宿主实力档': '5' });
    const live = adminLedger(); live.系统点 = 800;
    assert.throws(() => applyAdmin(live, changes), /账本已变化：系统点 现在是 800/);
    assert.equal(live.宿主实力档, 2, 'the other change was not applied either');
    const gone = adminLedger(); gone.聊天群.成员 = []; assert.throws(() => applyAdmin(gone, planAdmin(adminLedger(), { 'm:g1': '1' })), /已不在群里/);
});
test('1.1.2 admin: 专属资源 edits also shift every floor snapshot, so a reroll keeps them', () => {
    const z = adminLedger(); applyAdmin(z, planAdmin(z, { 'f:专属资源.名望': '1100' }));
    assert.equal(z.专属资源.名望, 1100);
    assert.equal(z.面板账本[3].snap.专属资源.名望, 1060); assert.equal(z.面板账本[4].snap.专属资源.名望, 1100);
    assert.equal(z.面板账本[3].snap.专属资源.天命印记, 1, 'untouched keys stay');
});
test('1.1.2 admin: 功法 goes through the original ztAdminSyncSkill, without its snapshot 专属资源 overwrite', () => {
    const z = adminLedger(), changes = planAdmin(z, { 'f:功法.熟练度': '9' });
    assert.throws(() => applyAdmin(structuredClone(z), changes), /需要诸天系统页面已加载/);
    let called = 0;
    applyAdmin(z, changes, { syncSkill: t => { called++; for (const r of Object.values(t.面板账本)) r.snap.专属资源 = structuredClone(t.专属资源); } });
    assert.equal(called, 1); assert.equal(z.功法.熟练度, 9);
    assert.equal(z.面板账本[3].snap.专属资源.名望, 60, 'snapshot kept (a reroll must not stack gains again)');
});
test('1.1.2 admin page is the 设置 entry; the original overlay stays reachable', () => {
    assert.match(src('src/hub.js'), /if \(this\.pages\.has\('admin'\)\) \{ this\.go\('admin'\); return true; \}/);
    assert.match(src('src/hub.js'), /async openOriginalAdmin\(\)/);
    assert.match(src('src/admin.js'), /openOriginalAdmin\(\)/);
    assert.match(src('index.js'), /\['adminConsole', AdminConsole\]/);
    assert.match(src('src/admin.js'), /currentIdentity\(\) !== this\.id\) \{ this\.render\(\); return this\.message\('聊天已切换/, 'a form read in chat A is never applied to chat B');
    assert.match(src('src/admin.js'), /dispose\(\) \{ this\.off\?\.\(\)/, 'listener paired with cleanup');
});

test('1.1.3 经典折叠: output budget for the single call', () => {
    assert.equal(classicTokens(0), 8192); assert.equal(classicTokens(10), 8192);
    assert.equal(classicTokens(49), 1024 + 240 * 49); assert.equal(classicTokens(500), 32768);
    assert.match(GACHA_MODES.classic.note, /一次 API 调用/); assert.match(GACHA_MODES.classic.note, /只计数/);
});

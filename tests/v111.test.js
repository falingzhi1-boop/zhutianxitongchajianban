// 1.1.1 feedback fixes: 神品保底 · 群红包 · 剧情功法 · 状态栏消失 / 数据块污染 · 页面上移 · 十连失败 · 手机头像进状态栏.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PANEL_FIELDS, cleanPanel, repairMessage, normalizeSkillLine, storySkillHints, parseBackfill, backfillPrompt, panelTemplate, stripPanels, displayPanel, reminderText, PanelGuard } from '../src/panel-guard.js';
import { splitPanels } from '../src/statusbar-host.js';
import { stripOldPanels } from '../src/prompt-filter.js';
import { parseGroupReply, parsePacketBody, parseAmount, rebookable, PACKET_BROKEN } from '../src/hub-group.js';
import { rollGacha, shenCounter, shenPityLeft, SHEN_PITY, parseObjectsLoose, fitSlot, validateProduct, preferences } from '../src/commerce-plan.js';
import { Commerce, looksTruncated, GACHA_BATCH } from '../src/commerce.js';
import { resetPageScroll, scrollWithin, withoutFocusScroll, guardPageScroll, pageScrolled } from '../src/page-scroll.js';
import { latestRules, WORLDBOOK_REV } from '../src/worldbook.js';
import { ROUTES } from '../src/api-routes.js';
import { HubSettings } from '../src/hub-settings.js';
import { dockShift, WindowControls } from '../src/window-controls.js';
import original from '../vendor/original/runtime.js';

const src = f => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const F = '系统点: 100\n子系统: 1\n好感度: 20\n当前任务: 暂无任务\n功法修炼: 无\n系统播报: 宿主加油';
const P = inner => `<ZhuTianPanel>\n${inner}\n</ZhuTianPanel>`;

// ---------- #7 / #4 数据块格式守卫 ----------
test('1.1.1 panel fields equal the original kernel list', () => {
    const m = /const ZT_FIELDS=(\[[^\]]*\])/.exec(src('vendor/original/ledger-kernel.js'));
    assert.deepEqual([...PANEL_FIELDS], JSON.parse(m[1]));
});
test('1.1.1 a healthy block is returned byte-identical (engine keys floors on the block hash)', () => {
    const mes = `正文。\n\n${P(F)}`;
    const r = repairMessage(mes);
    assert.equal(r.changed, false); assert.equal(r.mes, mes); assert.deepEqual(r.issues, []);
    const inner = `\n${F}\n`; assert.equal(cleanPanel(inner).panel, inner);
    assert.equal(splitPanels(mes).panels[0], inner);
    // multi-line 任务更新 JSON and 键: 值 continuation stay inside
    const json = `\n${F}\n任务更新: [\n  {"id":"T1","进度":30}\n]\n`; assert.equal(cleanPanel(json).changed, false);
});
test('1.1.1 story and <think> inside the block move out; the block keeps its place', () => {
    const r = repairMessage(`正文。\n\n${P(`他走进了房间。\n\n${F}\n\n林动看着远方，心中暗想。`)}`);
    assert.ok(r.changed && r.issues.includes('polluted'));
    assert.match(r.mes, /^正文。\n\n他走进了房间。\n\n林动看着远方，心中暗想。\n\n<ZhuTianPanel>\n系统点: 100/);
    assert.ok(r.mes.trimEnd().endsWith('</ZhuTianPanel>'));
    const t = repairMessage(`正文<ZhuTianPanel>\n<think>想一想</think>\n${F}\n<UpdateVariable>_.set('a',1)</UpdateVariable>\n</ZhuTianPanel>`);
    assert.deepEqual(t.thoughts, ['想一想']); assert.ok(!t.mes.includes('<think>'));
    assert.ok(t.issues.includes('foreign')); assert.ok(t.mes.indexOf('<UpdateVariable>') < t.mes.indexOf('<ZhuTianPanel>'));
    // dialogue after a blank line is story, a short 键: 值 line is panel
    const d = cleanPanel(`${F}\n\n当前世界: 斗破苍穹\n\n林动：“走吧。”`);
    assert.deepEqual(d.spill, ['林动：“走吧。”']); assert.ok(d.panel.includes('当前世界: 斗破苍穹'));
});
test('1.1.1 missing / odd tags: unclosed, stray close, case + spacing, fence, nested, untagged, reasoning', () => {
    const want = s => assert.ok(/<ZhuTianPanel>\n系统点: 100[\s\S]*系统播报: 宿主加油\n<\/ZhuTianPanel>/.test(s), s);
    let r = repairMessage(`正文。\n\n<ZhuTianPanel>\n${F}\n\n然后故事继续。`); assert.ok(r.issues.includes('unclosed')); want(r.mes); assert.ok(r.mes.indexOf('然后故事继续') < r.mes.indexOf('<ZhuTianPanel>'));
    r = repairMessage(`正文。\n\n${F}\n</ZhuTianPanel>`); assert.ok(r.issues.includes('unopened')); want(r.mes);
    r = repairMessage(`正文。\n\n< zhutianpanel >\n${F}\n</ZhuTianPanel >`); assert.deepEqual(r.issues, ['tag']); want(r.mes);
    r = repairMessage('正文。\n\n```\n' + P(F) + '\n```'); assert.ok(r.issues.includes('fence')); want(r.mes); assert.ok(!r.mes.includes('```'));
    r = repairMessage(`<ZhuTianPanel>\n${F}\n<ZhuTianPanel>\n${F}\n</ZhuTianPanel>`); assert.equal((r.mes.match(/<ZhuTianPanel>/g) || []).length, 1);
    r = repairMessage(`正文。\n\n${F}`); assert.ok(r.issues.includes('untagged')); want(r.mes);
    r = repairMessage('只有正文。', { reasoning: `思考…\n${P(F)}` }); assert.ok(r.issues.includes('reasoning')); want(r.mes); assert.ok(r.mes.startsWith('只有正文。'));
    r = repairMessage('只是正文'); assert.equal(r.changed, false); assert.deepEqual(r.issues, ['missing']);
    // a block without a single field is story, not a data block
    r = repairMessage(`前文\n${P('这是一段被包起来的正文。')}`); assert.ok(r.issues.includes('empty')); assert.ok(!r.mes.includes('<ZhuTianPanel>')); assert.ok(r.mes.includes('被包起来的正文'));
    // two blocks with fields: the last one stays
    r = repairMessage(`${P('系统点: 1')}\n正文\n${P(F)}`); assert.ok(r.issues.includes('multiple')); assert.ok(!r.mes.includes('系统点: 1\n')); want(r.mes);
});
test('1.1.1 #3 功法修炼 wording the original ignored becomes 收录:名[品阶]', () => {
    assert.equal(normalizeSkillLine('激活:天罡三十六变；领悟《独孤九剑》[仙品]；九阳神功+30；新收录：收录:太极剑[灵品]').value, '收录:天罡三十六变；收录:独孤九剑[仙品]；九阳神功+30；收录:太极剑[灵品]');
    for (const ok of ['无', '九阳神功+30', '收录:独孤九剑[仙品]', '习得:凌波微步', '主修:九阳神功', '升品:九阳神功[仙品]', '结算:九阳神功']) assert.equal(normalizeSkillLine(ok).changed, false, ok);
    const r = repairMessage(`正文${P(F.replace('功法修炼: 无', '功法修炼: 学会了《降龙十八掌》'))}`);
    assert.deepEqual(r.issues, ['skill']); assert.ok(r.mes.includes('功法修炼: 收录:降龙十八掌'));
    assert.deepEqual(storySkillHints('你获得了功法《独孤九剑》，又学会「凌波微步」，还掌握了【九阳神功】', '功法修炼: 收录:凌波微步', [{ 名称: '九阳神功' }]), ['独孤九剑']);
});
test('1.1.1 display / prompt fallback keeps the story of never-repaired floors', () => {
    const mes = `开头\n${P(`藏在块里的正文\n\n${F}`)}`;
    const s = splitPanels(mes); assert.equal(s.panels.length, 1); assert.ok(s.stripped.includes('藏在块里的正文')); assert.ok(!s.panels[0].includes('藏在块里'));
    assert.equal(splitPanels(`x${P('只是正文')}`).panels.length, 0);
    const chat = [{ mes }, { mes: 'a' }, { mes: 'b' }];
    assert.equal(stripOldPanels(chat, 2), 1); assert.ok(chat[0].mes.includes('藏在块里的正文') && !chat[0].mes.includes('系统点'));
    assert.equal(stripPanels(`a${P(F)}b`).replace(/\s/g, ''), 'ab');
    assert.equal(displayPanel(`\n${F}\n`).ok, true);
});
test('1.1.1 补记: template from the worldbook, prompt bounded, answer validated', () => {
    const tpl = panelTemplate(latestRules(original.ZhuTianBuiltinRules).rules);
    assert.ok(tpl.startsWith('系统点: {{get_chat_variable::诸天系统.系统点}}') && tpl.includes('系统播报:'));
    const p = backfillPrompt({ story: 'x'.repeat(9000), userText: 'y'.repeat(3000), template: tpl, previous: F });
    assert.ok(p.includes('（已截断）') && p.length < 9000 + 3000 && p.includes('上一轮已记账'));
    assert.equal(parseBackfill('<think>嗯</think>\n' + P(F)), F);
    assert.equal(parseBackfill(F), F);
    assert.throws(() => parseBackfill('系统点: 1\n好感度: 2'), /不是完整的数据块/);
    assert.throws(() => parseBackfill('子系统: 1\n子嗣: 0\n好感度: 2\n当前任务: 无\n系统播报: 嗯'), /缺少系统点/);
    assert.ok(ROUTES.some(r => r.id === 'panel' && r.base === 'status'));
    assert.match(reminderText(['unclosed']), /没有结束标签/);
});

function guardApp(chat, extra = {}) {
    const listeners = {}, saved = [], toasts = [], injected = [];
    const ctx = { chat, chatMetadata: { variables: { 诸天系统: { 系统点: 1, 功法库: [] } } }, eventTypes: { MESSAGE_RECEIVED: 'mr', GENERATION_ENDED: 'ge' },
        eventSource: { on: (e, f) => (listeners[e] ||= []).push(f), makeFirst: (e, f) => (listeners[e] ||= []).unshift(f), removeListener: (e, f) => { listeners[e] = (listeners[e] || []).filter(x => x !== f); } },
        saveChat: async () => { saved.push(1); }, ...extra };
    const settings = { v: {}, get: k => settings.v[k], onChange: () => () => {} };
    const app = { adapter: { context: () => ctx, currentIdentity: () => 'c1', subscribe: () => () => {}, isGenerating: () => false },
        settings, bridge: { injectPrompts: p => injected.push(p), uninjectPrompts: () => {}, livePrompt: () => null }, hub: { isOpen: true, toast: t => toasts.push(t) },
        original, hubSettings: { addSection(s) { app.section = s; } } };
    return { app, ctx, listeners, saved, toasts, injected };
}
test('1.1.1 guard: a new broken reply is repaired once, backed up, saved, and can be restored', async () => {
    const raw = `正文。\n\n<ZhuTianPanel>\n${F}\n\n后续剧情。`;
    const chat = [{ is_user: true, mes: '走' }, { mes: raw, swipes: [raw], swipe_id: 0, extra: {} }];
    const h = guardApp(chat); const g = new PanelGuard(h.app).start();
    assert.ok(h.app.section.items.some(i => i.k === 'panelGuard.backfill'));
    h.listeners.mr[0](1, 'normal');
    assert.ok(chat[1].mes.endsWith('</ZhuTianPanel>') && chat[1].mes.includes('后续剧情'));
    assert.equal(chat[1].swipes[0], chat[1].mes);
    assert.equal(chat[1].extra.zhutianCovenantTerminal.panelRepair.raw, raw);
    assert.equal(h.saved.length, 1); assert.match(h.toasts[0], /已自动整理第 1 层/);
    assert.match(h.injected.at(-1)[0].content, /上一轮的数据块有问题/);
    h.listeners.ge[0](); assert.equal(h.saved.length, 1, 'same text is not checked twice');
    globalThis.confirm = () => true; await g.restore(); delete globalThis.confirm;
    assert.equal(chat[1].mes, raw); assert.equal(chat[1].extra.zhutianCovenantTerminal.panelRepair, undefined);
    g.dispose(); assert.equal(h.listeners.mr.length, 0);
});
test('1.1.1 guard: repair off leaves the text; healthy replies are untouched; greeting never backfilled', () => {
    const raw = `正文${P(`前言\n${F}`)}`, chat = [{ is_user: true, mes: '走' }, { mes: raw, extra: {} }];
    const h = guardApp(chat); h.app.settings.v.panelGuard = { repair: false, backfill: 'off' };
    const g = new PanelGuard(h.app).start(); h.listeners.mr[0](1);
    assert.equal(chat[1].mes, raw); assert.equal(h.saved.length, 0); assert.ok(g.last.issues.includes('polluted'));
    const ok = `正文${P(F)}`, chat2 = [{ is_user: true, mes: '走' }, { mes: ok }];
    const h2 = guardApp(chat2); new PanelGuard(h2.app).start(); h2.listeners.mr[0](1); assert.equal(chat2[1].mes, ok); assert.equal(h2.saved.length, 0);
    const chat3 = [{ mes: '开场白，没有数据块' }]; const h3 = guardApp(chat3); const g3 = new PanelGuard(h3.app).start();
    h3.listeners.mr[0](0, 'first_message'); assert.equal(g3.tried.size, 0);
    g.dispose(); g3.dispose();
});
test('1.1.1 guard: backfill writes only when floor, swipe and text are unchanged', async () => {
    const chat = [{ is_user: true, mes: '出发' }, { mes: '只有正文', swipes: ['只有正文'], swipe_id: 0, extra: {} }];
    const h = guardApp(chat); const g = new PanelGuard(h.app);
    h.app.bridge.generateRaw = async () => P(F); h.app.bridge.getVariables = () => ({});
    await g.backfill(1, 'manual');
    assert.ok(chat[1].mes.endsWith(P(F))); assert.equal(chat[1].swipes[0], chat[1].mes); assert.equal(chat[1].extra.zhutianCovenantTerminal.panelBackfill.via, 'manual');
    const chat2 = [{ is_user: true, mes: '出发' }, { mes: '只有正文', swipe_id: 0 }];
    const h2 = guardApp(chat2); const g2 = new PanelGuard(h2.app);
    h2.app.bridge.generateRaw = async () => { chat2[1].mes = '玩家改了正文'; return P(F); }; h2.app.bridge.getVariables = () => ({});
    await assert.rejects(g2.backfill(1, 'manual'), /楼层已变化/); assert.equal(chat2[1].mes, '玩家改了正文');
});

// ---------- #2 群红包 ----------
const mem = [{ id: 'a', 名称: '鹧鸪哨', 世界: '鬼吹灯', 档: 2 }];
test('1.1.1 red packets in the formats models really write become packets', () => {
    const one = s => parseGroupReply(s, mem, { cap: '灵品', shop: 2 })[0];
    for (const s of ['鹧鸪哨: [红包] 浸血古铜钱/凡品/辟邪法器/镇水鬼 5枚 | 愿群主平安', '鹧鸪哨: [红包] 物品 浸血古铜钱/凡品/辟邪法器/镇水鬼 ×5 | 愿', '**鹧鸪哨**: 【红包】物品 浸血古铜钱/凡品/辟邪法器/镇水鬼 5 | 愿', '@鹧鸪哨（鬼吹灯）: ［红包］ 物品：浸血古铜钱/凡品/辟邪法器/镇水鬼 5个 | 愿']) {
        const p = one(s).packet; assert.equal(p?.kind, 'item', s); assert.equal(p.item.名称, '浸血古铜钱'); assert.equal(p.qty, 5);
    }
    for (const s of ['鹧鸪哨: 【红包】系统点 500 3 | 恭喜', '鹧鸪哨: [红包] 500系统点 3个 | 恭喜', '鹧鸪哨: [红包] 积分 500 3']) { const p = one(s).packet; assert.equal(p.kind, 'points', s); assert.equal(p.amount, 500); assert.equal(p.count, 3); }
    assert.equal(parseAmount('1.5万'), 15000); assert.equal(parseAmount('2亿'), 2e8); assert.equal(parseAmount('10,000'), 10000);
    assert.deepEqual(parsePacketBody('1.5万 点 4'), { kind: 'points', amount: 15000, count: 4 });
    assert.deepEqual(parsePacketBody('物品 摸金符/灵品/护身法器/辟邪镇煞 3'), { kind: 'item', spec: '摸金符/灵品/护身法器/辟邪镇煞', qty: 3 });
    const bad = one('鹧鸪哨: [红包] | 空的'); assert.ok(!bad.packet && bad.text.endsWith(PACKET_BROKEN));
    assert.equal(one('鹧鸪哨: [赠礼] 古钱/仙品/法器/辟邪 | 送你').gift.item.品级, '灵品', 'grade still clamped');
});
test('1.1.1 补登: old plain-text packets are offered once; broken / own / done ones are not', () => {
    assert.equal(rebookable({ from: 'a', text: '[红包] 物品 古钱/凡品 2 | x' }), true);
    for (const m of [{ from: 'me', text: '[红包] 1' }, { from: 'a', kind: 'packet', text: '[红包]' }, { from: 'a', rebooked: true, text: '[红包] 1' }, { from: 'a', text: '[红包] x' + PACKET_BROKEN }, { from: 'a', text: '普通' }]) assert.equal(rebookable(m), false);
    assert.match(src('src/hub-group.js'), /data-rebook=/);
    assert.match(src('src/hub-group.js'), /摸金符\/灵品\/护身法器\/辟邪镇煞 3/);
});

// ---------- #1 神品保底 ----------
test('1.1.1 神品 pity at 1000 pulls; 仙品 pity and rand order unchanged', () => {
    assert.equal(SHEN_PITY, 1000);
    let st = {}, shen = 0; for (let i = 0; i < 5; i++) { const r = rollGacha(st, 200, () => .9); st = r.state; shen += r.grades.filter(g => g === '神品').length; }
    assert.equal(shen, 1); assert.equal(st.神品保底计数, 0); assert.equal(st.仙品次数, 9);
    const r = rollGacha({ 神品保底计数: 999, 保底计数: 99 }, 2, () => .9);
    assert.deepEqual(r.grades, ['神品', '仙品'], '神品 pity first, 仙品 pity next pull');
    assert.equal(r.state.保底计数, 0); assert.equal(r.state.神品保底计数, 1);
    const n = rollGacha({ 神品保底计数: 10 }, 1, () => 0).state; assert.equal(n.神品保底计数, 0); assert.equal(n.保底计数, 1, '神品 does not reset 仙品 pity');
    assert.equal(shenCounter({ 累计抽数: 300 }), 300); assert.equal(shenCounter({ 累计抽数: 5000 }), 999); assert.equal(shenCounter({ 累计抽数: 300, 神品次数: 1 }), 0);
    assert.equal(shenPityLeft({}), 1000); assert.equal(shenPityLeft({ 神品保底计数: 999 }), 1);
    assert.throws(() => rollGacha({}, 201));
});
test('1.1.1 worldbook: 神品保底 line + rule, rev bumped, previous install not taken for a user edit', () => {
    assert.equal(WORLDBOOK_REV, '1.1.1');
    const c = latestRules(original.ZhuTianBuiltinRules).rules.find(r => r.comment === '11｜商城｜万界盲盒').content;
    assert.ok(c.includes('{{get_chat_variable::诸天系统.盲盒状态.神品保底计数}}/1000') && c.includes('第 1000 抽必出神品'));
    const prev = latestRules(original.ZhuTianBuiltinRules, { previous: true }).rules.find(r => r.comment === '11｜商城｜万界盲盒').content;
    assert.ok(!prev.includes('神品保底计数')); assert.match(src('src/features.js'), /previous: true/);
    assert.match(src('src/commerce.js'), /1000 抽必出神品/);
});

// ---------- #6 十连 / 盲盒截断 ----------
test('1.1.1 truncated JSON: detection, salvage of complete objects, slot-owned fields', () => {
    assert.equal(looksTruncated('[{"slot":0}', ''), true); assert.equal(looksTruncated('[{"slot":0}]', 'length'), true); assert.equal(looksTruncated('[{"slot":0}]', 'stop'), false);
    assert.deepEqual(parseObjectsLoose('```json\n[{"slot":0,"name":"a\\"}b"},{"slot":1,"na'), [{ slot: 0, name: 'a"}b' }]);
    const slot = { id: 0, grade: '神品', category: '装备', theme: '科幻', world: '', price: 1e8, acquisition: null };
    const row = { slot: 0, name: '航道镜', effect: '实时标注星际跃迁安全路径与障碍位置', world: '测试原创宇宙', theme: '修仙玄幻', category: '其他', grade: '凡品', origin: '原创' };
    assert.throws(() => validateProduct(row, slot, preferences()), 'validateProduct itself stays strict');
    assert.equal(validateProduct(fitSlot(row, slot), slot, preferences()).grade, '神品');
});
test('1.1.1 generate: a cut-off batch keeps complete items and halves the batch', async () => {
    const slots = Array.from({ length: 6 }, (_, i) => ({ id: i, grade: '凡品', category: '装备', theme: '科幻', world: '', price: 1, acquisition: null }));
    const item = i => ({ slot: i, name: '物品' + '甲乙丙丁戊己'[i], effect: ['照亮', '加速', '隐身', '护盾', '定位', '翻译'][i] + '周围十米范围内的目标' + '一二三四五六'[i] + '号', world: '原创宇宙', origin: '原创' });
    const asked = [];
    const app = { bridge: { getVariables: () => ({}), dead: false, generateRaw: async ({ user_input }) => {
        const ids = [...user_input.matchAll(/"id":(\d+)/g)].map(m => +m[1]); asked.push(ids.length);
        const rows = ids.map(item); if (asked.length === 1) { app.bridge.lastFinish = { reason: 'length' }; return JSON.stringify(rows).slice(0, -40); }
        return JSON.stringify(rows);
    } }, adapter: { currentIdentity: () => 'c', context: () => ({ chat }), isGenerating: () => false }, hub: { toast() {} } };
    const chat = []; const token = { id: 'c', chat, tail: '[]' };
    const out = await new Commerce(app).generate('gacha', slots, preferences(), [], token);
    assert.equal(out.length, 6); assert.deepEqual(out.map(x => x.slot), [0, 1, 2, 3, 4, 5]);
    assert.equal(asked[0], GACHA_BATCH); assert.ok(asked.slice(1).every(n => n <= Math.floor(GACHA_BATCH / 2)), asked.join(','));
    assert.match(src('src/commerce.js'), /GACHA_CHUNK/); assert.match(src('src/commerce.js'), /剩余 \$\{count - doneCount\} 抽未扣费/);
    assert.match(src('src/th-bridge.js'), /this\.lastFinish = \{ reason:/);
});

// ---------- #5 页面上移 ----------
function fakeDoc() {
    const html = { scrollTop: 0, scrollLeft: 0 }, body = { scrollTop: 0, scrollLeft: 0 }, win = { scrollX: 0, scrollY: 0, scrollTo(x, y) { this.scrollX = x; this.scrollY = y; }, listeners: [], addEventListener(t, f) { this.listeners.push(f); }, removeEventListener(t, f) { this.listeners = this.listeners.filter(x => x !== f); }, requestAnimationFrame: f => { f(); return 1; }, cancelAnimationFrame() {}, getComputedStyle: el => ({ overflowY: el.ov || 'visible' }) };
    const doc = { scrollingElement: html, documentElement: html, body, defaultView: win, activeElement: body };
    return { doc, html, body, win };
}
test('1.1.1 page scroll: reset, scroll only inside, guard while the terminal is open, focus without scrolling', () => {
    const { doc, html, body, win } = fakeDoc();
    html.scrollTop = 180; body.scrollTop = 20; assert.equal(pageScrolled(doc), true);
    assert.equal(resetPageScroll(doc), true); assert.equal(html.scrollTop + body.scrollTop, 0); assert.equal(resetPageScroll(doc), false);
    const box = { nodeType: 1, ov: 'auto', scrollTop: 0, scrollHeight: 1000, clientHeight: 200, getBoundingClientRect: () => ({ top: 0, bottom: 200 }), scrollTo({ top }) { this.scrollTop = top; } };
    box.parentNode = body; const el = { isConnected: true, ownerDocument: doc, parentNode: box, getBoundingClientRect: () => ({ top: 500, bottom: 540, height: 40 }) };
    assert.equal(scrollWithin(el, { block: 'start' }), 1); assert.equal(box.scrollTop, 492); assert.equal(html.scrollTop, 0);
    let open = true; const off = guardPageScroll(() => open, doc);
    html.scrollTop = 150; win.listeners[0]({ target: doc }); assert.equal(html.scrollTop, 0);
    open = false; html.scrollTop = 150; win.listeners[0]({ target: doc }); assert.equal(html.scrollTop, 150);
    off(); assert.equal(win.listeners.length, 0);
    const calls = []; const proto = { focus(o) { calls.push(o); } }; const ta = Object.create(proto);
    withoutFocusScroll(ta, () => ta.focus()); assert.deepEqual(calls, [{ preventScroll: true }]); assert.equal(Object.hasOwn(ta, 'focus'), false);
    withoutFocusScroll(ta, () => ta.focus(), { skipFocus: true }); assert.equal(calls.length, 1);
});
test('1.1.1 no scrollIntoView left; the engine input write cannot move the page', () => {
    for (const f of ['src/hub-plugins.js', 'src/assistant-host.js', 'src/hub-atlas.js', 'src/statusbar-host.js', 'src/mobile.js', 'src/hub.js']) assert.doesNotMatch(src(f), /\.scrollIntoView\(/, f);
    const hub = src('src/hub.js');
    assert.match(hub, /withoutFocusScroll\(ta, \(\) => orig\.apply\(this, args\), \{ skipFocus: hub\.isOpen \}\)/);
    assert.match(hub, /guardPageScroll\(\(\) => this\.isOpen\)/);
});
test('1.1.1 settings: module sections can bring their own buttons', () => {
    let ran = 0; const hs = new HubSettings({ hub: null }); hs.addSection({ title: 't', items: [], actions: { 'pg-x': () => { ran++; } } });
    hs.run('pg-x'); assert.equal(ran, 1);
    assert.match(src('index.js'), /new PanelGuard\(this\)\.start\(\)/);
    assert.match(src('src/settings.js'), /panelGuard: \{ repair: true, backfill: 'missing', remind: true, skillHint: true \}/);
});

test('1.1.1 phone: docked avatar is placed from the HEADER, not from the window top (status bar inset)', () => {
    // full-screen phone window: dialog top 0, padded 40 px for the status bar; header 40–95. The original placer put the
    // avatar at top ≈ 5 (inside the status bar): it must move down to the header centre.
    assert.deepEqual(dockShift({ left: 13, top: 5.5 }, { left: 0, top: 40, h: 55 }), { dx: 0, dy: 40 });
    // already right (desktop, no inset) → nothing to do; a 1 px rounding difference is ignored
    assert.equal(dockShift({ left: 194, top: 70 }, { left: 181, top: 61, h: 62 }), null);
    assert.equal(dockShift({ left: 194, top: 71 }, { left: 181, top: 61, h: 62 }), null);
    // a position taken mid open-animation (+8 px) is corrected too
    assert.deepEqual(dockShift({ left: 197, top: 78 }, { left: 181, top: 61, h: 62 }), { dx: -3, dy: -8 });
    // landscape notch: the header starts right of the notch, so does the avatar
    assert.deepEqual(dockShift({ left: 13, top: 9 }, { left: 36, top: 0, h: 62 }), { dx: 36, dy: 0 });
    // 私聊 sheet: sit exactly on the header's own avatar picture (no double ring)
    assert.deepEqual(dockShift({ left: 13, top: 46 }, { left: 0, top: 40, h: 67 }, 18, 44, { cx: 33, cy: 74 }), { dx: -2, dy: 6 });
    // hidden header (landscape + keyboard) → leave it to the original placer
    assert.equal(dockShift({ left: 13, top: 5 }, { left: 0, top: 0, h: 0 }), null);
    assert.equal(dockShift({ left: 13, top: 5 }, null), null);
    // wiring: docked branch calls placeDocked; insets come off the floating-window / launcher area; re-dock after animations
    const w = src('src/window-controls.js');
    assert.match(w, /dataset\.docked === 'true'\) \{ delete this\.entry\.dataset\.ztTucked; this\.placeDocked\(\); \}/);
    assert.match(w, /env\(safe-area-inset-top,0px\)/);
    assert.match(w, /this\.on\(this\.sh, 'animationend', schedule\)/);
    assert.equal(typeof WindowControls.prototype.placeDocked, 'function');
});

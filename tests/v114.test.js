// 1.1.4: 聊天群 删除 / 重roll / 截断 / 生成设置 · 假冻结与「核对并解冻账本」· 记忆键清洗 · 思维链保护 · 楼层检查.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
    normGroup, groupGen, autoTokens, dropLastLine, roundBlocked, undoRound, deleteMessage, parseGroupReply,
    GROUP_SPEAKERS, GROUP_CHARS, GROUP_CONTEXT, GROUP_TOKENS, MAX_ROUNDS,
} from '../src/hub-group.js';
import { protectThoughts, repairMessage, floorReport, reminderText, outsideThoughts, stripPanels } from '../src/panel-guard.js';
import { splitPanels } from '../src/statusbar-host.js';
import { stripOldPanels } from '../src/prompt-filter.js';
import { memoryKey, normalizeMemory } from '../src/model-response.js';
import { readbackDiff, variablesDiff } from '../src/th-bridge.js';
import { extractVoices, hasVoice } from '../src/voice-box.js';
import { ID, STORAGE } from '../src/contracts.js';

const src = f => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const today = () => new Date().toLocaleDateString('sv-SE');
const F = ['系统点: 1200', '子系统: 无', '当前任务: 无', '任务内容: 无', '任务奖励: 无', '目标心声: 无'].join('\n');
const P = inner => `<ZhuTianPanel>\n${inner}\n</ZhuTianPanel>`;

// ---------- 聊天群 ----------
const member = (id, 名称, extra = {}) => ({ id, 名称, 世界: '某界', 档: 3, 性格: '直爽', 特产: '灵石', 好感: 20, ...extra });
function groupWithRound({ grabbed = false, claimed = false } = {}) {
    const g = normGroup({ 成员: [member('m1', '甲'), member('m2', '乙', { 禁言轮: 1 })], 日计: { day: today(), 收: 1, 发: 0 }, 节奏: { 距上次: 0, 间隔: 4 } });
    g.消息.push({ id: 'g0', from: 'me', text: '大家好' }, { id: 'g1', from: 'm1', text: '群主好' },
        { id: 'g2', from: 'm1', text: '恭喜发财', kind: 'packet', ref: 'rp1' }, { id: 'g3', from: 'm1', text: '送你', kind: 'gift', gift: 'gf1' });
    g.红包.rp1 = { id: 'rp1', from: 'm1', kind: 'points', total: 100, shares: [60, 40], grabs: grabbed ? [{ who: 'me', v: 60 }] : [], t: Date.now() };
    if (!claimed) g.待领取.push({ id: 'gf1', from: 'm1', 名称: '甲', 世界: '某界', item: { 名称: '灵石', 品级: '凡品' } });
    g.成员[1].禁言轮 = 0;     // the round used up the last mute turn
    g.轮次.push({ id: 'rd1', t: Date.now(), user: '大家好', story: '', cut: false, msgs: ['g1', 'g2', 'g3'], packets: ['rp1'], gifts: ['gf1'], prev: { 距上次: 3, 间隔: 3, day: today(), 禁言: { m2: 1 } } });
    return normGroup(g);
}

test('1.1.4 群聊生成设置: defaults, only listed values, lo ≤ hi, auto tokens', () => {
    const g = normGroup({});
    assert.deepEqual([g.设置.发言下限, g.设置.发言上限, g.设置.单条字数, g.设置.上下文, g.设置.输出上限], [1, 6, 300, 16, 0], '1.1.3 behaviour by default');
    assert.deepEqual(groupGen({ 发言下限: 8, 发言上限: 2 }), { lo: 2, hi: 8, chars: 300, ctx: 16, tokens: 0 });
    assert.deepEqual(groupGen({ 发言下限: 7, 单条字数: 'x', 上下文: 999, 输出上限: 123 }), { lo: 1, hi: 6, chars: 300, ctx: 16, tokens: 0 });
    for (const list of [GROUP_SPEAKERS, GROUP_CHARS, GROUP_CONTEXT, GROUP_TOKENS]) assert.ok(list.length >= 4);
    assert.ok(GROUP_TOKENS.includes(0), '0 = 自动');
    assert.equal(autoTokens(1, 120), 1200, 'never below 1200');
    assert.equal(autoTokens(10, 800), 6000, 'never above 6000');
    assert.ok(autoTokens(6, 300) > 1200 && autoTokens(6, 300) < 4000);
    assert.ok(normGroup({ 轮次: Array.from({ length: 9 }, (_, i) => ({ id: 'r' + i, msgs: [] })) }).轮次.length === MAX_ROUNDS);
});
test('1.1.4 单条字数 reaches the parser; 发言上限 caps the lines', () => {
    const ms = [member('a', '甲'), member('b', '乙'), member('c', '丙')];
    const long = '啊'.repeat(700);
    assert.equal(parseGroupReply(`@甲: ${long}`, ms).at(0).text.length, 300, '1.1.3 default');
    assert.equal(parseGroupReply(`@甲: ${long}`, ms, { chars: 600 }).at(0).text.length, 600);
    assert.equal(parseGroupReply('@甲: 1\n@乙: 2\n@丙: 3', ms, { max: 2 }).length, 2);
});
test('1.1.4 截断: the half line is dropped', () => {
    assert.equal(dropLastLine('@甲: 完整\n@乙: 说到一半'), '@甲: 完整');
    assert.equal(dropLastLine('@甲: 完整\n@乙: 说到一半\n\n'), '@甲: 完整');
    assert.equal(dropLastLine('@甲: 只有一行'), '');
});
test('1.1.4 重roll: blocked once a packet was grabbed or a gift claimed; otherwise everything comes back', () => {
    assert.match(roundBlocked(groupWithRound({ grabbed: true }), groupWithRound({ grabbed: true }).轮次.at(-1)), /红包你已经抢过/);
    assert.match(roundBlocked(groupWithRound({ claimed: true }), groupWithRound({ claimed: true }).轮次.at(-1)), /赠礼你已经领取/);
    assert.match(roundBlocked(normGroup({}), undefined), /没有可以重新生成/);
    const g = groupWithRound(), r = g.轮次.at(-1);
    assert.equal(roundBlocked(g, r), '');
    undoRound(g, r);
    assert.deepEqual(g.消息.map(m => m.id), ['g0'], 'your own message stays');
    assert.equal(g.红包.rp1, undefined); assert.equal(g.待领取.length, 0);
    assert.equal(g.日计.收, 0, "today's packet count is given back");
    assert.deepEqual([g.节奏.距上次, g.节奏.间隔], [3, 3], 'rhythm restored');
    assert.equal(g.成员[1].禁言轮, 1, 'the mute turn the round used is restored');
    assert.equal(g.轮次.length, 0);
});
test('1.1.4 删除单条: ledger records stay, unclaimed packets / gifts go with their message', () => {
    let g = groupWithRound({ grabbed: true });
    assert.throws(() => deleteMessage(g, 'g2'), /已经抢过/);
    g = groupWithRound({ claimed: true });
    assert.throws(() => deleteMessage(g, 'g3'), /已经领取入库/);
    g = groupWithRound();
    g.消息.push({ id: 'g9', from: 'me', text: '发红包', kind: 'packet', ref: 'rp9' }); g.红包.rp9 = { id: 'rp9', from: 'me', grabs: [{ who: 'm1', v: 1 }], shares: [1] };
    assert.throws(() => deleteMessage(g, 'g9'), /已经扣账/, 'a packet you paid for');
    deleteMessage(g, 'g2');
    assert.equal(g.红包.rp1, undefined); assert.equal(g.日计.收, 0);
    assert.deepEqual(g.轮次[0].packets, [], 'the round forgets the packet');
    deleteMessage(g, 'g3');
    assert.equal(g.待领取.length, 0); assert.deepEqual(g.轮次[0].gifts, []);
    assert.equal(roundBlocked(g, g.轮次[0]), '', 'a deleted gift is not a claimed gift');
    deleteMessage(g, 'g0'); deleteMessage(g, 'g1');
    assert.equal(g.轮次.length, 1, 'round kept while it still has your input to re-ask');
    assert.throws(() => deleteMessage(g, 'nope'), /不在了/);
});
test('1.1.4 group wiring: round records, own output limit, UI hooks', () => {
    const s = src('src/hub-group.js');
    assert.match(s, /async round\(userText, story = '', token = capture\(this\.app\), opts = \{\}\)/);
    assert.match(s, /if \(opts\.replace\) \{[\s\S]{0,400}undoRound\(g, r\);/, 'the old round is removed in the same write that books the new one');
    assert.match(s, /this\.bridge\.lastFinish[\s\S]{0,200}length\|max_tokens/);
    assert.match(s, /own_limit: !!own/);
    assert.match(s, /data-g="reroll"/); assert.match(s, /data-g="manage"/); assert.match(s, /data-gdel=/); assert.match(s, /data-g-set="\$\{k\}"/);
    assert.match(s, /case 'reroll': return run\(\(\) => this\.reroll\(\)\);/);
    assert.match(s, /slice\(-gen\.ctx\)/);
    const b = src('src/th-bridge.js');
    assert.match(b, /own_limit = false/);
    assert.match(b, /Number\(over\?\.maxTokens\) \|\| \(!own_limit &&/, 'a per-feature route still wins');
});

// ---------- 假冻结 ----------
test('1.1.4 read-back compares only what this write changed, after a JSON round trip', () => {
    const before = { 诸天系统: { 系统点: 1 }, 其他卡: { x: 1 } }, next = { 诸天系统: { 系统点: 2, 备注: undefined, 比例: NaN }, 其他卡: { x: 1 } };
    assert.deepEqual(readbackDiff(before, next, { 诸天系统: { 系统点: 2, 比例: null }, 其他卡: { x: 99 } }), [], 'other scripts / undefined / NaN no longer freeze');
    assert.deepEqual(readbackDiff(before, next, { 诸天系统: { 系统点: 1 }, 其他卡: { x: 1 } }), ['诸天系统'], 'a write that did not land is still caught');
    assert.deepEqual(readbackDiff({ a: 1 }, {}, { a: 1 }), ['a'], 'a deleted key must be gone on disk');
    assert.deepEqual(variablesDiff({ a: { b: 1, c: 2 } }, { a: { c: 2, b: 1 } }), [], 'key order does not matter');
    assert.deepEqual(variablesDiff({ a: 1 }, { a: 1, b: 2 }), ['b']);
});
test('1.1.4 核对并解冻: read-only check, retry before freezing, settings button, error hint', () => {
    const b = src('src/th-bridge.js');
    assert.match(b, /async verifyFrozen\(\)/);
    assert.match(b, /if \(keys\.length\) return \{ state: 'differs', keys \};\s*set\.delete\(expected\)/, 'only an identical server copy lifts the freeze');
    assert.match(b, /if \(diff\.length\) \{ await new Promise\(r => setTimeout\(r, 700\)\); await c\.saveMetadata\(\);/);
    assert.match(src('src/hub-settings.js'), /act\('unfreeze', '核对并解冻账本'/);
    assert.match(src('src/hub-settings.js'), /unfreeze: async \(\) => \{\s*const r = await app\.bridge\.verifyFrozen\(\);/);
    assert.match(src('src/ledger-service.js'), /1\.1\.4: one more read/);
    assert.match(src('src/errors.js'), /核对并解冻账本[\s\S]*回滚/);
});

// ---------- 记忆键 ----------
test('1.1.4 记忆键: cleaned to the original alphabet, duplicates merged (later wins)', () => {
    const ok = /^[A-Za-z0-9_\-\u3400-\u9fff/]{1,64}$/;
    for (const k of ['林雪·关系', 'Lin Xue', '任务：取钥匙', 'ｍｅｍｏ１', '承诺 #3', 'リリス', '__proto__', '', 'a'.repeat(90), 'constructor.x']) {
        const out = memoryKey(k, 'mem_x');
        assert.ok(ok.test(out), `${k} → ${out}`); assert.ok(!/__proto__|constructor|prototype/.test(out));
    }
    assert.equal(memoryKey('林雪·关系'), '林雪_关系'); assert.equal(memoryKey('ｍｅｍｏ１'), 'memo1');
    const raw = JSON.stringify({ upserts: [
        { key: '林雪 关系', kind: 'relationship', status: '进行中', text: '旧', evidence: '证据一' },
        { key: '林雪_关系', kind: 'relationship', status: '进行中', text: '新', evidence: '证据二' },
        { key: 'リリス', kind: 'event', status: '已完成', text: '甲', evidence: '证据三' },
        { key: 'ルル', kind: 'event', status: '已完成', text: '乙', evidence: '证据四' },
    ] });
    const o = JSON.parse(normalizeMemory(raw));
    assert.equal(o.upserts.length, 3);
    assert.equal(o.upserts[0].text, '新');
    assert.notEqual(o.upserts[1].key, o.upserts[2].key, 'two unusable keys get different fallbacks');
    assert.ok(o.upserts.every(x => ok.test(x.key)));
    assert.equal(normalizeMemory('不是 JSON'), '不是 JSON');
});

// ---------- 思维链保护 ----------
test('1.1.4 思维链保护: reasoning outside the block keeps its tags; a draft block in it is made inert', () => {
    const think = '<thinking>\n先想想：<ZhuTianPanel>\n系统点: 草稿\n下一步…\n</thinking>';
    const mes = `${think}\n正文。\n${P(F)}`;
    const r = repairMessage(mes);
    assert.ok(r.mes.startsWith('<thinking>\n先想想：＜ZhuTianPanel＞\n系统点: 草稿\n下一步…\n</thinking>\n正文。\n<ZhuTianPanel>'), r.mes.slice(0, 80));
    assert.ok(r.issues.includes('cotpanel')); assert.ok(!r.issues.includes('unclosed'), 'the draft is not "repaired" into a block');
    assert.equal(r.panel, `\n${F}\n`, 'the real block is the one kept');
    const healthy = `<think>\n只是想想\n</think>\n正文。\n${P(F)}`;
    assert.equal(repairMessage(healthy).changed, false, 'reasoning without a draft: byte for byte');
    // prefill: the reply starts inside the reasoning
    const pre = `我在想 <ZhuTianPanel> 怎么写\n</think>\n正文\n${P(F)}`;
    assert.equal(repairMessage(pre).mes, pre.replace('<ZhuTianPanel> 怎么写', '＜ZhuTianPanel＞ 怎么写'));
    // a cut reply: the reasoning never closes → draft made inert, nothing else, no 补记
    const open = `<think>\n想到一半 ${P(F)}`;
    const o = repairMessage(open);
    assert.equal(o.mes, open.replace('<ZhuTianPanel>', '＜ZhuTianPanel＞').replace('</ZhuTianPanel>', '＜/ZhuTianPanel＞'));
    assert.equal(o.skip, true); assert.ok(o.issues.includes('cotopen'));
    // the only block is inside the reasoning → moved out after the story, the reasoning keeps its tags
    const only = `<think>\n草稿\n${P(F)}\n</think>\n正文。`;
    const m = repairMessage(only);
    assert.ok(m.issues.includes('reasoning'));
    assert.match(m.mes, /^<think>\n草稿\n<\/think>\n正文。\n\n<ZhuTianPanel>/);
    // 1.1.1 unchanged: a <think> INSIDE the block still goes to the reasoning box
    const t = repairMessage(`正文<ZhuTianPanel>\n<think>想一想</think>\n${F}\n</ZhuTianPanel>`);
    assert.deepEqual(t.thoughts, ['想一想']);
    assert.deepEqual(protectThoughts('没有思维链').blocks, []);
    assert.equal(protectThoughts('<思考>嗯</思考>正文').blocks[0], '<思考>嗯</思考>', 'Chinese tag names');
});
test('1.1.4 old floors (saved before 1.1.4 / repair off): display, engine binding and prompt filter skip the reasoning', () => {
    const mes = `<think>\n草稿：<ZhuTianPanel>\n系统点: 草稿\n</think>\n夜色渐深。\n\n${P(F)}`;
    const sp = splitPanels(mes);
    assert.equal(sp.panels.length, 1); assert.match(sp.panels[0], /系统点: 1200/);
    assert.ok(sp.stripped.includes('</think>\n夜色渐深。'), 'the closing tag and the story are not swallowed');
    assert.ok(stripPanels(mes).includes('</think>\n夜色渐深。'));
    const chat = [{ mes }, { mes: 'u' }, { mes: 'x' }];
    stripOldPanels(chat, 1);
    assert.ok(chat[0].mes.includes('</think>\n夜色渐深。') && !chat[0].mes.includes('系统点: 1200'), chat[0].mes);
    assert.equal(outsideThoughts('<think>a</think>b', t => t.toUpperCase()), '<think>a</think>B');
});
test('1.1.4 思维链保护 in the voice box and the reminder', () => {
    const think = '<think>\n莉莉丝：这句是草稿\n</think>\n莉莉丝：这句是正文。';
    const { voices, text } = extractVoices(think);
    assert.equal(voices.length, 1); assert.match(text, /莉莉丝：这句是草稿/);
    assert.equal(hasVoice('<thinking>莉莉丝：只在思维链里</thinking>'), false);
    assert.ok(!/思考过程/.test(reminderText([])), 'the reminder no longer talks about reasoning');
    const pg = src('src/panel-guard.js');
    assert.match(pg, /depth: this\.remindDepth\(\)/);
    assert.match(pg, /remindDepth\(\) \{ const d = Number\(this\.cfg\.remindDepth \?\? 1\)/, 'default depth 1');
    assert.match(pg, /!r\.panel && !r\.skip && this\.cfg\.backfill/);
});
test('1.1.4 楼层检查: says whether the plugin rewrote / rendered the floor and lists every live prompt', () => {
    const m = { mes: '<think>x</think>正文', swipe_id: 0, extra: { reasoning: '', [STORAGE]: { panelRepair: { issues: ['polluted'] } } } };
    const prompts = { [`${ID}/panelguard`]: { value: '提醒', position: 1, depth: 1, role: 0 }, 'other-ext/x': { value: '别的扩展', position: 1, depth: 0, role: 0 }, [`${ID}/group`]: { value: '' } };
    const text = floorReport({ floor: 7, m, zhutian: true, prompts, rendered: false, voices: 0 });
    assert.match(text, /第 7 层/); assert.match(text, /被数据块守卫改写过/); assert.match(text, /正文里 1 段/);
    assert.match(text, /\[诸天\] zhutian-covenant-terminal\/panelguard — 聊天中 深度 1/);
    assert.match(text, /other-ext\/x — 聊天中 深度 0/);
    assert.ok(!text.includes(`${ID}/group`), 'empty prompts are not listed');
    assert.match(floorReport({ floor: 1, m: { mes: 'x' }, zhutian: false }), /不会动这个聊天[\s\S]*插件没有改写过/);
    assert.match(src('src/panel-guard.js'), /id: 'pg-inspect', tier: 'diag'/);
});

// ---------- integration (fake SillyTavern host, same fixture shape as v110-patch3) ----------
import { Bridge } from '../src/th-bridge.js';
import { HubGroup } from '../src/hub-group.js';
import { identity } from '../src/contracts.js';
const copy = structuredClone;
function globals(values) {
    const old = Object.fromEntries(Object.keys(values).map(k => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
    for (const [k, value] of Object.entries(values)) Object.defineProperty(globalThis, k, { value, writable: true, configurable: true });
    return () => { for (const [k, d] of Object.entries(old)) d ? Object.defineProperty(globalThis, k, d) : delete globalThis[k]; };
}
function fixture() {
    const c = { characterId: 0, characters: [{ avatar: 'a.png' }], getCurrentChatId: () => 'a', chat: [{ mes: 'x', swipe_id: 0 }],
        chatMetadata: { variables: { 诸天系统: { 系统点: 100, 背包: [], 聊天群: { 成员: [{ id: 'm1', 名称: '群员', 世界: '某界', 档: 1, 好感: 20 }] } } }, [STORAGE]: { ledgerSchema: 2 } },
        extensionSettings: { variables: { global: {} } }, getRequestHeaders: () => ({}), saveSettingsDebounced() {} };
    const f = { c, disk: copy(c.chatMetadata), saves: 0, stale: 0 };
    c.saveMetadata = async () => { f.saves++; if (f.stale > 0) { f.stale--; return; } f.disk = copy(c.chatMetadata); };
    f.adapter = { context: () => c, currentIdentity: () => identity(c), ledger: () => c.chatMetadata.variables.诸天系统, isGenerating: () => false, transactions: { uncertain: new Set() }, notify() {} };
    f.bridge = new Bridge(f.adapter, { scriptVariables: () => ({}) });
    f.restore = globals({ isSecureContext: true, confirm: () => true, navigator: { locks: { request: async (_n, _o, fn) => fn() } }, SillyTavern: { getContext: () => c },
        fetch: async () => Response.json([{ chat_metadata: copy(f.disk) }]) });
    f.group = () => { const g = new HubGroup({ adapter: f.adapter, bridge: f.bridge }); g.paint = () => {}; g.syncPrompt = () => {}; g.toast = () => {}; return g; };
    f.diskGroup = () => f.disk.variables.诸天系统.聊天群;
    return f;
}
test('1.1.4 重roll end to end: same input, new answer, your message kept; a failed request keeps the old round', async () => {
    const f = fixture(); try {
        const g = f.group(); const answers = ['@群员: 第一次', '@群员: 第二次'];
        g.ask = async () => answers.shift();
        await g.send('你好');
        assert.deepEqual(f.diskGroup().消息.map(m => m.text), ['你好', '第一次']);
        assert.equal(f.diskGroup().轮次.length, 1); assert.equal(f.diskGroup().轮次[0].user, '你好');
        await g.reroll();
        assert.deepEqual(f.diskGroup().消息.map(m => m.text), ['你好', '第二次']);
        assert.equal(f.diskGroup().轮次.length, 1);
        g.ask = async () => { throw Error('HTTP 503'); };
        await assert.rejects(g.reroll(), /503/);
        assert.deepEqual(f.diskGroup().消息.map(m => m.text), ['你好', '第二次'], 'nothing lost when the new answer never came');
        assert.equal(f.adapter.transactions.uncertain.size, 0);
    } finally { f.restore(); }
});
test('1.1.4 截断 end to end: the half line is dropped and a notice offers 重roll', async () => {
    const f = fixture(); try {
        const g = f.group();
        g.ask = async () => { f.bridge.lastFinish = { reason: 'length', maxTokens: 1200, at: Date.now() }; return '@群员: 完整的一句\n@群员: 说到一'; };
        await g.round('你好');
        const msgs = f.diskGroup().消息;
        assert.deepEqual(msgs.map(m => m.text.slice(0, 5)), ['完整的一句', '⚠ 这一轮']);
        assert.equal(f.diskGroup().轮次[0].cut, true);
        g.ask = async () => { f.bridge.lastFinish = { reason: 'stop', at: Date.now() }; return '@群员: 好的'; };
        await g.reroll();
        assert.deepEqual(f.diskGroup().消息.map(m => m.text), ['好的'], 'the notice goes with the round');
    } finally { f.restore(); }
});
test('1.1.4 删除单条 end to end', async () => {
    const f = fixture(); try {
        const g = f.group(); g.ask = async () => '@群员: 一\n@群员: 二';
        await g.send('你好');
        const id = f.diskGroup().消息[1].id;
        await g.removeMessage(id);
        assert.deepEqual(f.diskGroup().消息.map(m => m.text), ['你好', '二']);
        assert.equal(f.diskGroup().轮次[0].msgs.length, 1);
    } finally { f.restore(); }
});
test('1.1.4 假冻结: a stale in-flight save is re-saved once instead of freezing; a write that never lands still freezes', async () => {
    const f = fixture(); try {
        f.stale = 1;
        await f.bridge.updateVariablesWith(v => { v.诸天系统.系统点 = 90; return v; }, { verify: true });
        assert.equal(f.disk.variables.诸天系统.系统点, 90); assert.equal(f.adapter.transactions.uncertain.size, 0);
        f.stale = 2;
        await assert.rejects(f.bridge.updateVariablesWith(v => { v.诸天系统.系统点 = 80; return v; }, { verify: true }), /已冻结[\s\S]*服务器读回不一致（诸天系统）/);
        assert.equal(f.adapter.transactions.uncertain.size, 1);
        await assert.rejects(f.bridge.updateVariablesWith(v => v, { verify: true }), /核对并解冻账本/);
        // 核对: the server still has 90, the page shows 80 → reload needed, still frozen
        let r = await f.bridge.verifyFrozen();
        assert.equal(r.state, 'differs'); assert.deepEqual(r.keys, ['诸天系统']); assert.equal(f.adapter.transactions.uncertain.size, 1);
        // SillyTavern saved it later after all → identical → unfrozen without reload
        f.disk = copy(f.c.chatMetadata);
        r = await f.bridge.verifyFrozen();
        assert.equal(r.state, 'unfrozen'); assert.equal(f.adapter.transactions.uncertain.size, 0);
        assert.equal((await f.bridge.verifyFrozen()).state, 'clear');
    } finally { f.restore(); }
});
test('1.1.4 假冻结: another script changing its own variable during the write no longer freezes', async () => {
    const f = fixture(); try {
        const save = f.c.saveMetadata;
        f.c.saveMetadata = async () => { await save(); f.disk.variables.其他卡 = { 变了: true }; };
        await f.bridge.updateVariablesWith(v => { v.诸天系统.系统点 = 70; return v; }, { verify: true });
        assert.equal(f.adapter.transactions.uncertain.size, 0);
    } finally { f.restore(); }
});
test('1.1.4 说明书: docs/MANUAL.md renders to escaped HTML with a table of contents', async () => {
    const { renderManual } = await import('../src/hub-manual.js');
    const { readFileSync } = await import('node:fs');
    const md = readFileSync(new URL('../docs/MANUAL.md', import.meta.url), 'utf8');
    assert.match(md.split('\n')[0], /1\.1\.4/);
    const { html, toc } = renderManual(md);
    assert.ok(toc.length >= 15, 'every chapter is in the table of contents');
    for (const k of ['↻ 重roll', '核对并解冻账本', '检查最新楼层', '群聊生成', '说明书']) assert.ok(html.includes(k), k);
    assert.ok(!/<script|<ZhuTianPanel>/i.test(html), 'tags written in the manual are shown as text');
    const evil = renderManual('## a\n<img src=x onerror=alert(1)> **b** [x](javascript:alert(1)) [y](#a)\n\n| h |\n|---|\n| <b>c</b> |');
    assert.ok(!evil.html.includes('<img') && !evil.html.includes('javascript:') && !evil.html.includes('<b>c</b>'), evil.html);
    assert.ok(evil.html.includes('<b>b</b>') && evil.html.includes('data-anchor="a"'));
    assert.equal((html.match(/<div class="zt-man-sec"/g) || []).length, (html.match(/<\/div>/g) || []).length - (html.match(/zt-man-table|zt-man-sub/g) || []).length, 'sections are balanced');
});

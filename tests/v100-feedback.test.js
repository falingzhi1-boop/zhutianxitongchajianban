// 1.0.0 (player feedback round, version unchanged): 分功能 API + 接口预设, 品阶鉴定 (剧情功法 / 物品不再锁死凡品),
// 一键关闭插件, 关闭悬浮莉莉丝. Browser side: tests/native_v100_feedback.py.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as R from '../src/api-routes.js';
import { candidates, appraisePrompt, parseAppraisal, regrade, gradeRaises, isOutside, APPRAISE_GRADES, GRADE_RULE } from '../src/appraise.js';
import { pluginName, hostModule, disablePlugin } from '../src/plugin-switch.js';
import { CLOSE_TEXT, CLOSED_TEXT } from '../src/lilith-float.js';
import { TIER_PRICE } from '../src/ledger-ops.js';

const src = f => readFileSync(new URL('../' + f, import.meta.url), 'utf8');

// ---------- 接口预设 ----------
test('preset: a name is required, the address too; same name replaces', () => {
    assert.throws(() => R.withPreset({}, '', { url: 'https://a.example/v1' }), /预设名称/);
    assert.throws(() => R.withPreset({}, '   ', { url: 'https://a.example/v1' }), /预设名称/);
    assert.throws(() => R.withPreset({}, '公益站', { url: '' }), /接口地址/);
    let s = R.withPreset({}, '公益站A', { url: 'https://a.example/v1', key: 'k1', model: 'm1' });
    s = R.withPreset(s, '公益站A', { url: 'https://b.example/v1', key: 'k2', model: 'm2' });
    assert.equal(s.presets.length, 1); assert.equal(s.presets[0].url, 'https://b.example/v1');
    s = R.withPreset(s, ' <b>备用</b> ', { url: 'https://c.example/v1' });
    assert.deepEqual(s.presets.map(p => p.name), ['公益站A', 'b备用/b']);
});
test('preset: at most MAX_PRESETS, broken ones dropped on read', () => {
    let s = {};
    for (let i = 0; i < R.MAX_PRESETS; i++) s = R.withPreset(s, 'p' + i, { url: 'https://x.example/' + i });
    assert.throws(() => R.withPreset(s, 'one more', { url: 'https://y.example' }), /最多/);
    const n = R.normalizeStore({ presets: [{ name: '', url: 'https://a' }, { name: 'ok', url: 'https://a' }, { name: 'ok', url: 'https://b' }, { name: 'nourl' }], routes: { nope: '@main', chat: '@main', shop: 'preset:ok', gacha: { url: '' } } });
    assert.deepEqual(n.presets.map(p => p.name), ['ok']);
    assert.deepEqual(n.routes, { chat: '@main', shop: 'preset:ok' });
});
// ---------- 分功能 ----------
test('routes: every model-calling feature is listed', () => {
    const ids = R.ROUTES.map(r => r.id);
    for (const id of ['shop', 'gacha', 'wish', 'recruit', 'bag', 'assess', 'appraise', 'group', 'chat', 'memory', 'workbench']) assert.ok(ids.includes(id), id);
    assert.equal(new Set(ids).size, ids.length);
});
test('routes: default / 酒馆主 API / preset / own config, deleted preset falls back', () => {
    let s = R.withPreset({}, '公益站A', { url: 'https://a.example/v1', key: 'sk-a', model: 'm-a' });
    assert.equal(R.resolveRoute(s, 'gacha'), null);
    s = R.withRoute(s, 'gacha', 'preset:公益站A');
    assert.deepEqual(R.resolveRoute(s, 'gacha'), { url: 'https://a.example/v1', key: 'sk-a', model: 'm-a', via: '预设「公益站A」' });
    s = R.withRoute(s, 'chat', R.MAIN); assert.equal(R.resolveRoute(s, 'chat').main, true);
    s = R.withRoute(s, 'group', { url: 'https://g.example/v1', key: 'sk-g', model: 'big', maxTokens: 4096 });
    assert.equal(R.resolveRoute(s, 'group').maxTokens, 4096);
    assert.throws(() => R.withRoute(s, 'shop', 'preset:没有'), /没有名为/);
    assert.throws(() => R.withRoute(s, 'xx', R.MAIN), /未知/);
    s = R.withoutPreset(s, '公益站A');
    assert.equal(R.resolveRoute(s, 'gacha'), null);
    assert.equal(R.routeText(s, 'gacha'), '跟随默认');
    s = R.withRoute(s, 'group', ''); assert.equal(R.resolveRoute(s, 'group'), null);
});
test('routes: the key never appears in the description text', () => {
    let s = R.withPreset({}, 'A', { url: 'https://a.example/v1', key: 'sk-secret-123456789', model: 'm' });
    s = R.withRoute(s, 'shop', 'preset:A'); s = R.withRoute(s, 'wish', { url: 'https://w.example/v1', key: 'sk-other-123456789' });
    for (const id of ['shop', 'wish']) assert.doesNotMatch(R.routeText(s, id), /sk-/);
    assert.match(R.routeText(s, 'shop'), /a\.example · m/);
});
test('classify: every original status-bar prompt maps to its feature; the connection test stays default', () => {
    const vendor = src('vendor/original/statusbar-v3.1-part2.js');
    const found = [...vendor.matchAll(/sysFetchAPI\(\w+,"([^"]+)"/g)].map(m => m[1]);
    assert.ok(found.length >= 8, String(found.length));
    for (const p of found) if (p !== '你是一个测试助手。') assert.ok(R.classifyStatus(p), p);
    assert.equal(R.classifyStatus('你是一个测试助手。'), '');
    assert.equal(R.classifyStatus('严格执行格式要求，只输出一行'), 'assess');
    assert.equal(R.classifyStatus('严格执行格式要求'), 'wish');
    assert.equal(R.classifyAssistant([{ role: 'system', content: '你是诸天系统外挂世界书的事实记录员……' }]), 'memory');
    assert.equal(R.classifyAssistant([{ role: 'system', content: '你是诸天系统的独立助手莉莉丝，……' }]), 'workbench');
    assert.equal(R.classifyAssistant([{ role: 'user', content: 'hi' }]), 'chat');
    assert.equal(R.classifyAssistant([{ role: 'user', content: '只回复：成功' }]), '');   // original 测试连接 → default
});
test('routes live in a global variable — never in backups (data-io) or the chat', () => {
    assert.equal(R.ROUTES_KEY, '诸天系统_API路由');
    assert.doesNotMatch(src('src/data-io.js'), /type:\s*'global'/);
    assert.match(src('src/th-bridge.js'), /route/);
    assert.match(src('src/hub-group.js'), /route:\s*'group'/);
    assert.match(src('src/assistant-host.js'), /classifyAssistant/);
});
test('API page: preset save button starts disabled and needs a name', () => {
    const s = src('src/api-center.js');
    assert.match(s, /data-act="preset-save"[^>]*disabled/);
    assert.match(s, /data-f="preset-name"/);
    assert.match(s, /data-route-sel/);
});

// ---------- 品阶鉴定 ----------
const ledger = () => ({
    功法库: [
        { 名称: '太虚剑意', 品阶: '凡品', 上限: 100, 熟练度: 100, 圆满: true, 来源: '收录', 描述: '一剑开天门' },
        { 名称: '基础吐纳', 品阶: '凡品', 上限: 100, 熟练度: 5, 来源: '商城' },
        { 名称: '角色卡神功', 熟练度: 30, 来源: '角色卡' },
    ],
    背包: [
        { 名称: '古剑', 品级: '凡品', 数量: 1, 来源: '', 价格: 0, 效果: '剑身有龙纹' },
        { 名称: '古剑', 品级: '仙品', 数量: 2, 来源: '', 价格: 0 },
        { 名称: '引气丹', 品级: '凡品', 数量: 3, 来源: '商城', 价格: 500 },
        { 名称: '盲盒宝物', 品级: '灵品', 数量: 1, 来源: '盲盒', 价格: 10000 },
        { 名称: '群员赠礼', 品级: '灵品', 数量: 1, 来源: '聊天群·白浅@青丘·赠礼' },
        { 名称: '任务奖品', 品级: '凡品', 数量: 1, 来源: '任务奖励·t1' },
    ],
    面板账本: { 3: { h: 'x', snap: { 功法库: [{ 名称: '太虚剑意', 品阶: '凡品', 上限: 100, 熟练度: 90, 来源: '收录' }], 背包: [] } } },
});
test('appraise: only things the system did not make are candidates', () => {
    const c = candidates(ledger());
    assert.deepEqual(c.skills.map(s => s.name), ['太虚剑意', '角色卡神功']);
    assert.deepEqual(c.items.map(i => i.name), ['古剑', '古剑']);
    for (const s of ['商城', '万界商城', '盲盒', '万物熔炉', '随身洞天', '分身探宝', '任务奖励·x', '聊天群·a·b', '聊天群求助 · x', '图鉴复刻', '管理员', '修炼']) assert.equal(isOutside({ 来源: s }), false, s);
    for (const s of ['', '收录', '数据块', '旧存档', '角色卡', '剧情']) assert.equal(isOutside({ 来源: s }), true, s);
    assert.deepEqual(APPRAISE_GRADES, ['凡品', '灵品', '仙品', '神品']);
});
test('appraise: the prompt states the scale, the entry and asks for one line', () => {
    const e = candidates(ledger()).skills[0], p = appraisePrompt(e, { 当前世界: '斗破' });
    assert.match(p.system, /品阶鉴定官/); assert.match(p.system, /只输出一行/); assert.doesNotMatch(p.system, /禁忌/);
    assert.match(p.user, /太虚剑意/); assert.match(p.user, /一剑开天门/); assert.match(p.user, /斗破/); assert.match(p.user, /神品：行星级/);
    assert.match(src('tests/qa/mock_model.py'), /品阶鉴定官/);
});
test('appraise: the answer is parsed, 禁忌 is capped at 神品, garbage throws', () => {
    assert.deepEqual(parseAppraisal('仙品|大陆级剑意'), { grade: '仙品', reason: '大陆级剑意' });
    assert.deepEqual(parseAppraisal('思考中……\n**灵品**｜宗师级'), { grade: '灵品', reason: '宗师级' });
    assert.equal(parseAppraisal('禁忌|毁天灭地').grade, '神品');
    assert.throws(() => parseAppraisal('我不知道'), /没有给出品阶/);
    assert.throws(() => parseAppraisal(''), /没有改动/);
});
test('regrade skill: raise only, cap follows, 圆满 cleared, receipt stamped; system skills refused', () => {
    const z = ledger(), e = candidates(z).skills[0];
    const r = regrade(z, e, '仙品', { how: 'AI 鉴定', reason: '大陆级', at: 1 });
    assert.deepEqual(r, { changed: true, from: '凡品', to: '仙品', name: '太虚剑意' });
    const s = z.功法库[0]; assert.equal(s.品阶, '仙品'); assert.equal(s.上限, 2000); assert.equal(s.圆满, undefined);
    assert.deepEqual(s.鉴定, { 品阶: '仙品', 原品阶: '凡品', 方式: 'AI 鉴定', 时间: 1, 理由: '大陆级' });
    assert.equal(regrade(z, { ...e, grade: '仙品' }, '灵品').changed, false);           // never down
    assert.equal(z.功法库[0].品阶, '仙品');
    assert.throws(() => regrade(z, { kind: 'skill', key: '基础吐纳', name: '基础吐纳' }, '神品'), /系统给的/);
    assert.throws(() => regrade(z, e, '禁忌'), /只能是/);
});
test('regrade item: raise only, recycle value frozen, does not absorb differently valued stacks', () => {
    const z = ledger(), [low] = candidates(z).items;
    const r = regrade(z, low, '仙品', { how: '手动修正', at: 2 });
    assert.equal(r.changed, true);
    const left = z.背包.filter(i => i.名称 === '古剑');
    assert.equal(left.length, 2); assert.equal(left[0].品级, '仙品'); assert.equal(left[0].数量, 1);
    assert.equal(left[0].价格, TIER_PRICE.凡品); assert.equal(left[1].数量, 2); assert.equal(left[1].价格, 0);
    assert.equal(left[0].鉴定.方式, '手动修正');
    const z2 = ledger(), [l2] = candidates(z2).items;
    regrade(z2, l2, '灵品');
    const it = z2.背包[0]; assert.equal(it.品级, '灵品'); assert.equal(it.价格, TIER_PRICE.凡品);   // recycles like the 凡品 it was
    assert.throws(() => regrade(z2, { kind: 'item', key: '引气丹|凡品', name: '引气丹' }, '神品'), /系统给的/);
});
test('收录 line with a higher grade raises an outside skill (never a system one, never down)', () => {
    const z = ledger();
    assert.deepEqual(gradeRaises(z, '收录:太虚剑意[仙品]；收录:基础吐纳[神品]；收录:新功法[灵品]').map(u => [u.name, u.from, u.to]), [['太虚剑意', '凡品', '仙品']]);
    assert.deepEqual(gradeRaises(z, '收录:太虚剑意'), []);
    assert.deepEqual(gradeRaises(z, '收录:太虚剑意【凡品】'), []);
    assert.match(GRADE_RULE, /收录:功法名\[品阶\]/);
});

// ---------- 一键关闭插件 ----------
test('plugin name and host module come from where the file is served', () => {
    const u = 'http://127.0.0.1:8000/scripts/extensions/third-party/zhutianxitongchajianban/src/plugin-switch.js';
    assert.equal(pluginName(u), 'third-party/zhutianxitongchajianban');
    assert.equal(hostModule(u), 'http://127.0.0.1:8000/scripts/extensions.js');
    assert.equal(pluginName('http://x/other/place.js'), '');
});
test('disablePlugin: asks first; cancel does nothing; calls disableExtension with the name; manual hint without it', async () => {
    const u = 'http://h/scripts/extensions/third-party/zt/src/plugin-switch.js', calls = [];
    const load = async () => ({ disableExtension: async (n, r) => calls.push([n, r]) });
    let asked = '';
    assert.deepEqual(await disablePlugin(null, { moduleUrl: u, load, ask: async t => { asked = t; return false; } }), { done: false, cancelled: true });
    assert.match(asked, /管理扩展/); assert.equal(calls.length, 0);
    assert.deepEqual(await disablePlugin(null, { moduleUrl: u, load, reload: false, ask: async () => true }), { done: true, name: 'third-party/zt' });
    assert.deepEqual(calls, [['third-party/zt', false]]);
    const r = await disablePlugin(null, { moduleUrl: u, load: async () => ({}), ask: async () => true });
    assert.equal(r.manual, true); assert.match(r.reason, /管理扩展/);
});
// ---------- 关闭悬浮莉莉丝 ----------
test('closing the float says the console is reachable from the SillyTavern extensions panel', () => {
    assert.match(CLOSE_TEXT(false), /「扩展」面板/); assert.match(CLOSE_TEXT(false), /打开诸天终端/);
    assert.match(CLOSE_TEXT(), /头像都不再显示/);   // 1.1.3: 关闭 closes every floating entry; 切换 is separate
    assert.match(CLOSED_TEXT, /扩展/);
    const f = src('src/lilith-float.js');
    assert.match(f, /拖到这里关闭悬浮窗/); assert.match(f, /'floatLilith', 'none'/);
    assert.match(src('src/settings.js'), /data-act="float"/);
});
test('settings: 品阶鉴定 and 一键关闭插件 are reachable', () => {
    const s = src('src/hub-settings.js');
    assert.match(s, /act\('appraise'/); assert.match(s, /act\('plugin-off'/); assert.match(s, /'plugin-off': \(\) => disablePlugin\(app\)/);
    assert.match(src('index.js'), /new Appraise\(this\)/);
});
test('phone layout: fixed boxes outside the terminal are not placed with bottom (SillyTavern gives <html> a transform, height 0)', () => {
    const rule = (text, sel) => { const i = text.indexOf(sel + '{'); assert.ok(i >= 0, sel); return text.slice(i, text.indexOf('}', i)); };
    for (const [f, sel] of [['styles/fx.css', '.zt-fx-out'], ['styles/hub.css', '.zt-fb-entry'], ['src/lilith-float.js', '.bin'], ['styles/host.css', '#zt-covenant-launcher']]) {
        const r = rule(src(f), sel);
        assert.match(r, /position:fixed/, f + ' ' + sel);
        assert.doesNotMatch(r.replace(/bottom:auto/g, ''), /(^|[;{])bottom:/, f + ' ' + sel + ' must use top');
    }
    assert.doesNotMatch(src('styles/fx.css').match(/@media \(max-width:720px\)\{[^}]*\}/)[0], /bottom:84px/);
    assert.match(src('src/lilith-float.js'), /function showBinAt\(b\) \{[\s\S]{0,200}innerHeight/);
});

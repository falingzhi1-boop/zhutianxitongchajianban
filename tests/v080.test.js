// 0.8.0 pure logic: 功法实效 prompt, 实战积累, 角色卡功法 scan + merge (raise only), Lilith story lines, terminal wiring
// (engine refresh after outside writes, Lilith row hidden, 自拟外挂 in the navigation), 自拟外挂 charge bookkeeping.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { masteryPrompt, practiceGains, practiceLog, scanSkills, mergeSkills, stageOf, nextTarget, effectsOf, panelField, storyText, fixSkill, STAGE_EFFECT } from '../src/skill-sync.js';
import { storyLines, IDLE } from '../src/lilith-stage.js';
import { NAV, ENGINE_CSS } from '../src/hub.js';
import { HubPlugins } from '../src/hub-plugins.js';
import { Settings } from '../src/settings.js';
import { ID, VERSION, CAPABILITIES, STORAGE } from '../src/contracts.js';

const lib = () => [
    { 名称: '青云诀', 品阶: '灵品', 上限: 500, 熟练度: 480 },
    { 名称: '太极拳', 品阶: '凡品', 上限: 100, 熟练度: 40 },
    { 名称: '九阳神功', 品阶: '神品', 上限: 10000, 熟练度: 2100 },
];
const ledger = () => ({ 系统点: 100, 功法库: lib(), 功法: { 名称: '青云诀', 熟练度: 480, 上限: 500 }, 功法记录: [], 功法待播报: [] });

test('stages, next target and cumulative effects follow the original 3.1 rules', () => {
    assert.equal(stageOf({ 熟练度: 99 }), '未入门'); assert.equal(stageOf({ 熟练度: 100 }), '入门'); assert.equal(stageOf({ 熟练度: 500 }), '熟练');
    assert.equal(stageOf({ 熟练度: 2000 }), '精通'); assert.equal(stageOf({ 熟练度: 10000 }), '宗师'); assert.equal(stageOf({ 熟练度: 1, 入道: true }), '入道');
    assert.equal(nextTarget(fixSkill({ 熟练度: 40, 品阶: '凡品' })), 100);
    assert.equal(nextTarget(fixSkill({ 熟练度: 100, 品阶: '凡品' })), null, '凡品 caps at 100: no 熟练 target');
    assert.deepEqual(effectsOf({ 熟练度: 2100 }), [STAGE_EFFECT.入门, STAGE_EFFECT.熟练, STAGE_EFFECT.精通]);
    assert.match(effectsOf({ 熟练度: 0 })[0], /尚未入门/);
});
test('功法实效 prompt: main skill first, effects and next stage stated, empty library → no prompt', () => {
    const p = masteryPrompt(ledger());
    const lines = p.split('\n');
    assert.match(lines[0], /功法实效/);
    assert.match(lines[1], /^- 青云诀〔灵品〕480\/500【入门】/);
    assert.match(p, /九阳神功〔神品〕2100\/10000【精通】：.*消耗永久降低30%.*威力提升100%/);
    assert.match(p, /下一阶段「熟练」需 500/);
    assert.match(p, /功法修炼.*功法名\+N/);
    assert.equal(masteryPrompt({ 功法库: [] }), '');
    assert.ok(!/海量系统点/.test(masteryPrompt({ 功法库: [{ 名称: '道', 熟练度: 1, 入道: true }] })), 'the one-off reward is not a standing effect');
});
test('实战积累: used in the story but not in 功法修炼 → small grade-based gain, max 2, never past the cap', () => {
    const z = ledger();
    const story = '他运转青云诀，一记太极拳推开来敌，随后九阳神功护体。';
    const g = practiceGains(z, story, '');
    assert.equal(g.length, 2);
    assert.deepEqual(g.map(x => [x.name, x.gain]), [['青云诀', 2], ['太极拳', 3]]);
    assert.equal(practiceGains(z, story, '青云诀+5(苦修)').map(x => x.name).join(), '太极拳,九阳神功', 'already in 功法修炼 → not added again');
    z.功法库[1].熟练度 = 99; const top = practiceGains(z, '太极拳', '');
    assert.equal(top[0].gain, 1); assert.equal(top[0].to, '入门');
    z.功法库[1].熟练度 = 100; assert.equal(practiceGains(z, '太极拳', '').length, 0, 'at the grade cap nothing is added');
    assert.equal(practiceGains(ledger(), '今天天气不错。', '').length, 0);
});
test('panel field + story text helpers', () => {
    const panel = '系统点：120\n功法修炼：青云诀+3(练剑)\n主修功法：青云诀';
    assert.equal(panelField(panel, '功法修炼'), '青云诀+3(练剑)');
    assert.equal(storyText('前文<ZhuTianPanel>功法修炼：太极拳</ZhuTianPanel>后文').includes('太极拳'), false);
    const z = { 功法记录: [{ 名称: '太极拳', 变化: '+3(实战积累)', 楼层: 5, 时间: 1 }, { 名称: 'x', 变化: '收录' }] };
    assert.deepEqual(practiceLog(z), [{ 名称: '太极拳', 增加: 3, 楼层: 5, 时间: 1 }]);
});
test('角色卡功法 scan: MVU pairs, arrays, keyed objects, strings; records the source path', () => {
    const mvu = { 角色: { 主角: { 功法: { 独孤九剑: [{ 熟练度: [600, '熟练度'], 品阶: ['仙品', ''] }, '剑法'], 吐纳术: [35, '基础'] }, 技能: ['轻功', '暗器（入门）'] } } };
    const items = scanSkills(mvu, 'stat_data');
    const by = Object.fromEntries(items.map(i => [i.名称, i]));
    assert.equal(by['独孤九剑'].熟练度, 600); assert.equal(by['独孤九剑'].品阶, '仙品'); assert.equal(by['独孤九剑'].path, 'stat_data.角色.主角.功法.独孤九剑');
    assert.equal(by['吐纳术'].熟练度, 35);
    assert.equal(by['轻功'].熟练度, null);
    assert.equal(by['暗器'].熟练度, 100, 'stage word in brackets → threshold');
    const arr = scanSkills({ skills: [{ name: 'Fireball', level: '大成', grade: '灵品' }] });
    assert.equal(arr[0].名称, 'Fireball'); assert.equal(arr[0].熟练度, 2000);
    assert.equal(scanSkills({ 功法记录: [{ 名称: '不该读' }], 背包: ['剑'] }).length, 0, 'logs and unrelated keys are ignored');
    assert.equal(scanSkills({ 功法: '<script>x</script>' })[0].名称.includes('<'), false, 'card text is made inert');
});
test('角色卡功法 merge: adds new skills, only ever raises 熟练度 / 品阶, never lowers', () => {
    const items = [{ 名称: '青云诀', 熟练度: 300, 品阶: '' }, { 名称: '九阳神功', 熟练度: 5000, 品阶: '' }, { 名称: '太极拳', 熟练度: 50, 品阶: '仙品' }, { 名称: '独孤九剑', 熟练度: 600, 品阶: '' }];
    const { lib: out, changes } = mergeSkills(lib(), items, '角色卡');
    const by = Object.fromEntries(out.map(s => [s.名称, s]));
    assert.equal(by['青云诀'].熟练度, 480, 'lower value ignored');
    assert.equal(by['九阳神功'].熟练度, 5000);
    assert.equal(by['太极拳'].品阶, '仙品'); assert.equal(by['太极拳'].上限, 2000); assert.equal(by['太极拳'].熟练度, 50);
    assert.equal(by['独孤九剑'].品阶, '仙品', 'grade inferred from mastery (600 needs a 仙品 cap)'); assert.equal(by['独孤九剑'].来源, '角色卡');
    assert.deepEqual(changes.map(c => c.kind).sort(), ['升品', '收录', '熟练度', '熟练度'].sort());
    assert.equal(mergeSkills(out, items).changes.length, 0, 'second import is a no-op');
    assert.equal(lib()[0].熟练度, 480, 'input not mutated');
});
test('Lilith story lines come from the ledger (pending breakthrough first), idle lines without a ledger', () => {
    const z = { ...ledger(), 当前世界: '太初仙域', 任务库: { T1: { 名称: '引气入体', 状态: '进行中', 完成度: 40 } }, 功法待播报: [{ 名称: '青云诀', 阶段: '熟练', 奖励: '消耗降低30%' }], 恋爱目标: { 姓名: '柳如烟', 好感度: 60, 黑化值: 40 } };
    const lines = storyLines(z).map(l => l.text);
    assert.match(lines[0], /青云诀到「熟练」/);
    assert.ok(lines.some(t => /引气入体.*进度 40%/.test(t)));
    assert.ok(lines.some(t => /青云诀离「熟练」还差 20/.test(t)));
    assert.ok(lines.some(t => /太初仙域/.test(t)) && lines.some(t => /柳如烟.*黑化值也有 40/.test(t)));
    assert.deepEqual(storyLines(null).map(l => l.text), IDLE);
});
test('terminal wiring: 自拟外挂 is in the navigation, the engine Lilith row is hidden in the terminal', () => {
    assert.ok(NAV.find(g => g.group === '能力').items.some(([id]) => id === 'plugmgr'));
    assert.match(ENGINE_CSS, /html\[data-zt-hub\] \.mvu-msg\{display:none!important\}/);
    const src = readFileSync(new URL('../src/hub.js', import.meta.url), 'utf8');
    assert.match(src, /bridge\.onChange\(\(\) => \{ this\.refreshTop\(\); this\.scheduleEngineView\(\); \}\)/, 'outside writes refresh the engine page too');
    assert.match(src, /w\.applyVarsToDisplay\?\.\(root\)/);
    assert.match(readFileSync(new URL('../src/hub-settings.js', import.meta.url), 'utf8'), /admin: \(\) => app\.hub\.openAdmin\(\)/);
});
test('自拟外挂 charge stamps 界面记账时间 so the next AI panel cannot refund it', async () => {
    const store = new Map(); globalThis.localStorage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) };
    const ta = { value: '', dispatchEvent() {} }; globalThis.document = { getElementById: id => id === 'send_textarea' ? ta : null };
    let vars = { 诸天系统: { 系统点: 500, 界面记账时间: 1, 专属资源: { 因果筹码: 9 } } };
    const ctx = { chatMetadata: { [STORAGE]: { plugins: { on: ['p-test1', 'p-test2'], off: [], uses: {} } } }, saveMetadata: async () => {} };
    const app = { adapter: { context: () => ctx, isGenerating: () => false, ledger: () => vars.诸天系统, currentIdentity: () => 'c|x' },
        bridge: { getVariables: () => structuredClone(vars), updateVariablesWith: async f => { vars = f(structuredClone(vars)); } , injectPrompts() {} },
        hub: { toast() {}, setEngineTab() {}, engineFrame: null }, fx: null };
    store.set('zhutian.customPlugins.v1', JSON.stringify([{ id: 'p-test1', name: '时停', type: 'active', cost: { kind: 'points', amount: 200 } }, { id: 'p-test2', name: '因果', type: 'active', cost: { kind: 'resource', res: '因果筹码', amount: 3 } }]));
    const p = new HubPlugins(app);
    const t0 = Date.now();
    await p.activate('p-test1');
    assert.equal(vars.诸天系统.系统点, 300); assert.ok(vars.诸天系统.界面记账时间 >= t0);
    vars.诸天系统.界面记账时间 = 1;
    await p.activate('p-test2');
    assert.equal(vars.诸天系统.专属资源.因果筹码, 6); assert.ok(vars.诸天系统.界面记账时间 >= t0);
    assert.match(ta.value, /发动外挂：时停/);
    delete globalThis.localStorage; delete globalThis.document;
});
test('0.8.0 settings defaults and version files', () => {
    const store = {}; const s = new Settings({ context: () => ({ extensionSettings: store, saveSettingsDebounced() {} }) });
    assert.deepEqual(s.get('skills'), { prompt: true, practice: true, cardAuto: false });
    assert.equal(s.get('lilith').story, true); assert.equal(store[ID].lilith.camera, true);
    const m = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url))), p = JSON.parse(readFileSync(new URL('../package.json', import.meta.url))), l = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url)));
    assert.equal(VERSION, '0.8.5'); assert.equal(m.version, VERSION); assert.equal(p.version, VERSION); assert.equal(l.version, VERSION); assert.equal(l.packages[''].version, VERSION);
    assert.match(p.scripts.check, /src\/skill-sync\.js/);
    for (const n of ['修行 · 熟练度', '莉莉丝气泡播报', '管理员控制台入口']) assert.ok(CAPABILITIES.some(c => c.name.startsWith(n)), n);
});

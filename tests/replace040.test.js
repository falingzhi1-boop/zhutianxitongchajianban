// 0.4.0 — the plugin replaces every piece of the v1.1 install. Pure-logic tests (node, no browser).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MacroLike, toYaml, getPath, tavernHelperMacrosActive } from '../src/macro-like.js';
import { extractVoices, VOICE_SOURCE, VOICE_FLAGS, inlineMarkdown } from '../src/voice-box.js';
import { splitPanels, compactSummary, panelFields, legacyRegexActive } from '../src/statusbar-host.js';
import { stripOldPanels, PANEL_BLOCK } from '../src/prompt-filter.js';
import { Bridge, isMainApi, MAIN_API_URL } from '../src/th-bridge.js';
import { detectLegacy, applyState, isLegacyScript, LEGACY_REGEX } from '../src/takeover.js';
import { classifyStroke, STROKE_LINES, HOLD_LINES } from '../src/touch.js';
import { validateUrl } from '../src/api-center.js';
import { LEGACY_SCRIPT_ID, CAPABILITIES } from '../src/contracts.js';

const V11 = '/var/tmp/v11/zip/未改动-已安装者无需重复导入/';
const tryJson = f => { try { return JSON.parse(readFileSync(V11 + f, 'utf8')); } catch { return null; } };

test('macro-like: get_chat_variable reads 诸天系统 paths like Tavern Helper', () => {
    const vars = { 诸天系统: { 系统点: 1200, 任务: { 名称: '初入江湖' }, 背包: [{ 名称: '引气丹' }], $meta: { x: 1 } } };
    const m = new MacroLike(() => ({ chatMetadata: { variables: vars }, extensionSettings: {} }));
    assert.equal(m.replace('点数 {{get_chat_variable::诸天系统.系统点}}'), '点数 1200');
    assert.equal(m.replace('{{get_chat_variable::诸天系统.任务.名称}}'), '初入江湖');
    assert.equal(m.replace('{{get_chat_variable::诸天系统.背包[0].名称}}'), '引气丹');
    assert.equal(m.replace('{{get_chat_variable::诸天系统.不存在}}'), 'null');
    assert.equal(m.replace('{{get_chat_variable::诸天系统.任务}}'), JSON.stringify({ 名称: '初入江湖' }));
    assert.ok(!m.replace('{{get_chat_variable::诸天系统}}').includes('$meta'), 'omits $ keys');
    assert.ok(m.has('x {{get_chat_variable::a}}') && !m.has('plain'));
    assert.equal(getPath({ a: { 'b.c': 1 } }, 'a.b.c', 'no'), 'no');
    assert.match(toYaml({ a: 1, b: ['x'] }), /a: 1/);
});
test('macro-like: every worldbook use of get_chat_variable resolves', () => {
    const book = tryJson('诸天万界最强系统.json'); if (!book) return;
    const text = Object.values(book.entries).map(e => e.content).join('\n');
    const uses = text.match(/\{\{get_chat_variable::[^}]+\}\}/g) || [];
    assert.ok(uses.length >= 60, 'worldbook uses the macro');
    const m = new MacroLike(() => ({ chatMetadata: { variables: { 诸天系统: { 系统点: 5 } } }, extensionSettings: {} }));
    assert.ok(!m.replace(text).includes('{{get_chat_variable::'));
});
test('macro-like yields to an enabled Tavern Helper macro engine', () => {
    const had = globalThis.TavernHelper;
    try {
        delete globalThis.TavernHelper; assert.equal(tavernHelperMacrosActive({ extensionSettings: {} }), false);
        globalThis.TavernHelper = {}; assert.equal(tavernHelperMacrosActive({ extensionSettings: {} }), true);
        assert.equal(tavernHelperMacrosActive({ extensionSettings: { tavern_helper: { macro: { enabled: false } } } }), false);
    } finally { if (had === undefined) delete globalThis.TavernHelper; else globalThis.TavernHelper = had; }
});

test('voice box: pattern is byte-identical to the v1.1 regex and extracts cue/text like $1$2$4 / $3$5', () => {
    const r = tryJson('regex-莉莉丝专属语音框.json');
    if (r) assert.equal(`/${VOICE_SOURCE}/${VOICE_FLAGS}`, r.findRegex);
    const t = '门开了。\n\n莉莉丝：“宿主大人，欢迎回来～”\n莉莉丝（害羞）：“才不是担心你呢……”\n萧炎：“莉莉丝？”';
    const { text, voices } = extractVoices(t);
    assert.equal(voices.length, 2);
    assert.deepEqual(voices[1], { cue: '害羞', text: '才不是担心你呢……' });
    assert.ok(text.includes('萧炎：“莉莉丝？”') && text.includes('ZTVOICESLOT0ZT'));
    if (r) { // same result as applying the original regex's capture layout
        const re = new RegExp(VOICE_SOURCE, VOICE_FLAGS), orig = [];
        t.replace(re, (_m, a, b, c, d, e) => { orig.push({ cue: (a || '') + (b || '') + (d || ''), text: (c || '') + (e || '') }); return ''; });
        assert.deepEqual(voices, orig);
    }
    assert.equal(inlineMarkdown('**强** <b>x</b>'), '<strong>强</strong> &lt;b&gt;x&lt;/b&gt;');
});

test('compact floor summary matches the original fields (either colon)', () => {
    const panel = '\n系统点: 1,200\n好感度：35/100\n当前任务: 初入江湖\n';
    assert.deepEqual(compactSummary(panel), { points: '1,200', favor: '35/100', task: '初入江湖' });
    assert.equal(compactSummary('随便写点'), null);
    assert.equal(panelFields('系统点：1\n系统点：2').系统点, '1');
    const { panels, stripped } = splitPanels('正文<ZhuTianPanel>系统点: 1</ZhuTianPanel>尾');
    assert.equal(panels.length, 1); assert.ok(stripped.includes('ZTPANELSLOT0ZT'));
});

test('prompt filter strips panels at depth >= 2 only, never mutating the saved chat', () => {
    const msgs = [0, 1, 2, 3].map(i => ({ mes: `第${i}楼<ZhuTianPanel>系统点: ${i}</ZhuTianPanel>`, name: 'x' }));
    const saved = msgs.slice(), chat = msgs.slice();
    assert.equal(stripOldPanels(chat, 2), 2);
    assert.deepEqual(chat.map(m => m.mes.includes('<ZhuTianPanel>')), [false, false, true, true]);
    assert.ok(saved.every(m => m.mes.includes('<ZhuTianPanel>')), 'originals untouched');
    const r = tryJson('regex-诸天状态栏-旧楼层不发给AI.json');
    if (r) { assert.equal(r.minDepth, 2); assert.equal(`/${PANEL_BLOCK.source}/${PANEL_BLOCK.flags}`, r.findRegex); }
    assert.equal(stripOldPanels(null), 0);
});

test('legacy status-bar detection ignores the prompt-only and compact regexes', () => {
    const c = ch => ({ extensionSettings: { regex: ch }, characters: [], characterId: undefined });
    const strip = tryJson('regex-诸天状态栏-旧楼层不发给AI.json'), compact = tryJson('regex-诸天状态栏-旧楼层精简显示.json'), bar = tryJson('regex-诸天万界最强系统状态栏3_1_通用版.json');
    if (!strip) return;
    assert.equal(legacyRegexActive(c([strip, compact])), false);
    assert.equal(legacyRegexActive(c([strip, compact, bar])), true);
    assert.equal(legacyRegexActive(c([{ ...bar, disabled: true }])), false);
});

function fakeBridge(capture) {
    const adapter = { context: () => ({}), host: { generateRaw: async o => { capture.main = o; return '主API回复'; } } };
    return new Bridge(adapter, { scriptVariables: () => ({}), setScriptVariables() {} });
}
test('bridge.generateRaw honours custom_api max_tokens and temperature (v1.1 bug fix)', async () => {
    const cap = {}, b = fakeBridge(cap), realFetch = globalThis.fetch;
    globalThis.fetch = async (url, init) => { cap.url = String(url); cap.body = JSON.parse(init.body); return new Response(JSON.stringify({ choices: [{ message: { content: '成功' } }] }), { status: 200, headers: { 'Content-Type': 'application/json' } }); };
    try {
        const out = await b.generateRaw({ user_input: '许愿', ordered_prompts: [{ role: 'system', content: '严格执行格式要求' }, 'user_input'], custom_api: { apiurl: 'https://api.example.com/v1', key: 'k', model: 'm', source: 'openai', temperature: 0.7, max_tokens: 3000 } });
        assert.equal(out, '成功');
        assert.equal(cap.body.max_tokens, 3000); assert.equal(cap.body.temperature, 0.7); assert.equal(cap.body.model, 'm');
        assert.match(cap.url, /\/chat\/completions$/);
    } finally { globalThis.fetch = realFetch; }
});
test('main-API sentinel is routed to SillyTavern generateRaw and never fetched', async () => {
    const cap = {}, b = fakeBridge(cap), realFetch = globalThis.fetch;
    globalThis.fetch = async () => { throw Error('network must not be used'); };
    try {
        assert.ok(isMainApi(MAIN_API_URL) && !isMainApi('https://api.example.com/v1') && !isMainApi('garbage'));
        assert.equal(await b.generateRaw({ user_input: 'hi', ordered_prompts: [{ role: 'system', content: 'SYS' }, 'user_input'], custom_api: { apiurl: MAIN_API_URL, key: 'st-main', max_tokens: 900 } }), '主API回复');
        assert.deepEqual(cap.main, { prompt: 'hi', systemPrompt: 'SYS', responseLength: 900 });
        assert.equal((await b.customChat({ url: MAIN_API_URL, key: 'x' }, [{ role: 'user', content: '回复两个字：成功' }])).text, '主API回复');
        assert.deepEqual(await b.listModels(MAIN_API_URL, ''), ['酒馆当前主API']);
        assert.equal(validateUrl(MAIN_API_URL), '');
        assert.notEqual(validateUrl('http://evil.example/v1'), '');
    } finally { globalThis.fetch = realFetch; }
});

function legacyContext() {
    const regs = Object.keys(LEGACY_REGEX).map(id => ({ id, scriptName: LEGACY_REGEX[id], findRegex: '/<ZhuTianPanel>/g', replaceString: '', disabled: false }));
    return {
        extensionSettings: {
            regex: [...regs, { id: 'other', scriptName: '别的正则', findRegex: '/x/', disabled: false }],
            tavern_helper: { script: { scripts: [{ type: 'folder', id: 'f', name: '文件夹', enabled: true, scripts: [{ type: 'script', id: LEGACY_SCRIPT_ID, name: '诸天系统 · 莉莉丝契约空间 v1.1', content: '', enabled: true }] }, { type: 'script', id: 'x', name: '别的脚本', content: '', enabled: true }] } },
        },
        characterId: 0,
        characters: [{ data: { extensions: { regex_scripts: [{ id: 'copy1', scriptName: '诸天万界最强系统状态栏 3.1', findRegex: '/<ZhuTianPanel>([\\s\\S]*?)<\\/ZhuTianPanel>/gm', replaceString: '<div>', disabled: false }], tavern_helper: [['scripts', [{ type: 'script', id: 'c1', name: '诸天系统 · 独立记忆助手', content: 'zt-memory-assistant-v1', enabled: true }]], ['variables', {}]] } } }],
    };
}
test('takeover finds all v1.1 regexes and scripts (global, folder, character) and restores exactly them', () => {
    const c = legacyContext();
    const found = detectLegacy(c);
    assert.equal(found.filter(i => i.kind === 'regex').length, 5);
    assert.equal(found.filter(i => i.kind === 'script').length, 2);
    assert.ok(!found.some(i => i.id === 'other' || i.id === 'x'));
    const touched = applyState(c, found, false);
    assert.ok(touched.global && touched.character.has('regex_scripts') && touched.character.has('tavern_helper'));
    assert.equal(detectLegacy(c).length, 0);
    assert.ok(c.extensionSettings.regex.find(r => r.id === 'other').disabled === false);
    assert.equal(c.extensionSettings.tavern_helper.script.scripts[0].enabled, true, 'folder itself untouched');
    assert.ok(!Array.isArray(c.characters[0].data.extensions.tavern_helper), 'entries array normalised to object');
    applyState(c, found, true);
    assert.equal(detectLegacy(c).length, 7);
    assert.ok(isLegacyScript({ type: 'script', id: LEGACY_SCRIPT_ID }) && !isLegacyScript({ type: 'folder', id: LEGACY_SCRIPT_ID }));
});

test('touch strokes: rubbing escalates, a straight short move is not a stroke', () => {
    const rub = n => Array.from({ length: n }, (_, i) => [100 + (i % 2 ? 40 : 0), 200 + i]);
    assert.equal(classifyStroke([[0, 0], [20, 0]]).level, null);
    assert.equal(classifyStroke(rub(4)).level, 0);
    assert.ok(classifyStroke(rub(30)).level >= 1);
    assert.equal(classifyStroke(rub(200)).level, 2);
    for (const z of ['wing', 'horn', 'tail', 'arm', 'thigh', 'lower', 'chest', 'cheek']) { assert.equal(STROKE_LINES[z].length, 3); assert.ok(HOLD_LINES[z].length >= 1); }
});

test('capability list declares the replaced v1.1 pieces', () => {
    for (const n of ['原版 4 个正则全部原生取代', '世界书变量宏 {{get_chat_variable::…}}', '真实触摸互动', 'API 中心与酒馆主 API', '一键接管 / 恢复旧版']) assert.ok(CAPABILITIES.some(c => c.name === n), n);
});

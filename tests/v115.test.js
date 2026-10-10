// 1.1.5 正式版: 系统助手人设 · 功能开关 · 聊天群 × 世界书.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
    resolvePersona, storyRule, chatPersona, renameText, rewriteMessages, rewriteEntries, cleanAvatar, cleanCode, orbAvatar,
    PRESETS, PERSONA_DEFAULTS, ZT_BOOK, LILITH_PERSONA_HEAD, LILITH_RULE_COMMENT, AVATAR_MAX,
} from '../src/persona.js';
import { setVoicePersona, extractVoices } from '../src/voice-box.js';
import { personaFromForm } from '../src/hub-persona.js';
import { SWITCH_GROUPS, switchOn, switchWrite, switchSummary } from '../src/hub-switches.js';
import { hiddenPages, ALWAYS_PAGES } from '../src/hub.js';
import {
    searchEntries, summonPrompt, entryKeys, entryTitle, matchKeys, groupWorldBlock, worldMemoryPrompt, mentions, activeBooks, memberSourceLine,
} from '../src/group-world.js';
import { WORLD_NAME } from '../src/features.js';
import { Settings } from '../src/settings.js';
import { proxiedFetch } from '../src/assistant-host.js';
import { parseRecruit } from '../src/hub-group.js';

const ID = 'zhutian-covenant-terminal';
const settings = (stored = {}) => { const store = { [ID]: stored }; return { s: new Settings({ context: () => ({ extensionSettings: store, saveSettingsDebounced() {} }) }), store }; };

test('1.1.5 persona: default is Lilith and every helper is the identity', () => {
    const p = resolvePersona(null);
    assert.equal(p.lilith, true); assert.equal(p.name, '莉莉丝');
    assert.equal(storyRule(p), null); assert.equal(chatPersona(p), null);
    assert.equal(renameText('莉莉丝说 LILITH', p), '莉莉丝说 LILITH');
    const msgs = [{ role: 'system', content: LILITH_PERSONA_HEAD + '…' }];
    assert.equal(rewriteMessages(msgs, p), msgs);
    const lists = { globalLore: [{ world: ZT_BOOK, comment: LILITH_RULE_COMMENT, content: 'orig' }] };
    assert.equal(rewriteEntries(lists, p, ZT_BOOK), 0); assert.equal(lists.globalLore[0].content, 'orig');
    assert.equal(ZT_BOOK, WORLD_NAME);
    assert.deepEqual(PRESETS.map(x => x.id), ['lilith', 'orb', 'custom']);
});

test('1.1.5 persona: numbered orb preset and custom persona', () => {
    const orb = resolvePersona({ preset: 'orb', code: '0 0-7x!' });
    assert.equal(orb.lilith, false); assert.equal(orb.code, '00-7x'); assert.equal(orb.name, '系统00-7x'); assert.equal(orb.call, '宿主');
    assert.match(orb.avatar, /^data:image\/svg\+xml;base64,/);
    assert.match(Buffer.from(orb.avatar.split(',')[1], 'base64').toString(), /00-7/);
    const c = resolvePersona({ preset: 'custom', name: '小九', call: '老大', personality: '毒舌护短', style: '自称本座' });
    assert.equal(c.name, '小九');
    const rule = storyRule(c);
    assert.match(rule, /【小九】：“具体的说话内容”/); assert.match(rule, /称呼\{\{user\}\}为「老大」/); assert.match(rule, /毒舌护短/); assert.match(rule, /自称本座/);
    const chat = chatPersona(c);
    for (const must of ['你是小九', '不是主剧情', '不要声称自己执行了游戏操作', '不要角色前缀', '不代表接取任务']) assert.ok(chat.includes(must), must);
    assert.ok(storyRule({ ...c, story: 'OWN' }).startsWith('OWN\n【称呼对照】')); assert.equal(chatPersona({ ...c, chat: 'OWNC' }), 'OWNC');
    assert.equal(resolvePersona({ preset: 'weird' }).lilith, true);
    assert.equal(cleanCode(''), '001');
});

test('1.1.5 persona: rename text / messages / worldbook entries (copies only)', () => {
    const p = resolvePersona({ preset: 'orb', code: '007' });
    assert.equal(renameText('莉莉丝和莉莉絲 · LILITH · Lilith', p), '系统007和系统007 · SYSTEM-007 · SYSTEM-007');
    // a persona whose name contains 莉莉丝 is not renamed (no runaway replacement)
    assert.equal(renameText('莉莉丝', resolvePersona({ preset: 'custom', name: '小莉莉丝' })), '莉莉丝');
    const msgs = [{ role: 'system', content: LILITH_PERSONA_HEAD + '，也是…' }, { role: 'system', content: '你是诸天系统的独立助手莉莉丝。' }, { role: 'user', content: '莉莉丝你好' }];
    const out = rewriteMessages(msgs, p);
    assert.equal(out[0].content, chatPersona(p)); assert.equal(out[1].content, '你是诸天系统的独立助手系统007。');
    assert.equal(out[2].content, '莉莉丝你好', 'user text is never rewritten'); assert.equal(msgs[0].content.startsWith(LILITH_PERSONA_HEAD), true, 'input untouched');
    const lists = { globalLore: [
        { world: ZT_BOOK, comment: LILITH_RULE_COMMENT, content: '莉莉丝专属', key: ['莉莉丝'] },
        { world: ZT_BOOK, comment: '05｜商城', content: '莉莉丝播报', key: ['商城'] },
        { world: 'Other', comment: 'x', content: '莉莉丝在别的书里', key: ['莉莉丝'] },
    ], chatLore: [] };
    assert.equal(rewriteEntries(lists, p, ZT_BOOK), 2);
    assert.equal(lists.globalLore[0].content, storyRule(p)); assert.equal(lists.globalLore[1].content, '系统007播报');
    assert.equal(lists.globalLore[2].content, '莉莉丝在别的书里', 'other books are not touched');
});

test('1.1.5 persona: avatars are small inline images only', () => {
    assert.equal(cleanAvatar('https://x/y.png'), '');
    assert.equal(cleanAvatar('data:text/html;base64,AAAA'), '');
    assert.equal(cleanAvatar('data:image/png;base64,iVBORw0KGgo='), 'data:image/png;base64,iVBORw0KGgo=');
    assert.equal(cleanAvatar('data:image/png;base64,' + 'A'.repeat(AVATAR_MAX)), '');
    assert.match(orbAvatar('A', 10), /^data:image\/svg\+xml;base64,/);
    const v = personaFromForm({ preset: 'custom', name: '  小九  ', avatar: 'javascript:alert(1)', junk: 1 }, {});
    assert.equal(v.name, '小九'); assert.equal(v.avatar, ''); assert.equal('junk' in v, false);
    assert.deepEqual(Object.keys(v).sort(), Object.keys(PERSONA_DEFAULTS).sort());
    assert.equal(personaFromForm({ preset: 'nope' }).preset, 'lilith');
});

test('1.1.5 persona: the voice box follows the persona name', () => {
    try {
        setVoicePersona(resolvePersona({ preset: 'orb', code: '001' }));
        const r = extractVoices('正文\n【系统001】：“检测到宿主突破。”\n【莉莉丝】：“不该被抽出”');
        assert.deepEqual(r.voices.map(v => v.text), ['检测到宿主突破。']);
        setVoicePersona(null);
        assert.deepEqual(extractVoices('【莉莉丝】：“回来了”').voices.map(v => v.text), ['回来了']);
    } finally { setVoicePersona(null); }
});

test('1.1.5 persona: assistant requests are classified first, then rewritten', async () => {
    const real = globalThis.fetch; const sent = [];
    globalThis.location ??= { href: 'http://127.0.0.1:8000/', origin: 'http://127.0.0.1:8000' };
    globalThis.fetch = async (url, init) => { sent.push(JSON.parse(init.body)); return new Response('{"choices":[{"message":{"content":"ok"}}]}', { status: 200 }); };
    try {
        let who = resolvePersona({ preset: 'orb', code: '009' });
        const bridge = { getVariables: () => ({}), ctx: () => ({ getRequestHeaders: () => ({}) }) };
        const f = proxiedFetch(bridge, () => who);
        const body = { model: 'm', messages: [{ role: 'system', content: LILITH_PERSONA_HEAD + '…' }, { role: 'user', content: 'hi' }] };
        await f('http://127.0.0.1:5001/v1/chat/completions', { method: 'POST', body: JSON.stringify(body) }).catch(() => {});
        assert.ok(sent.length >= 1);
        assert.ok(sent[0].messages[0].content.startsWith('你是系统009'), sent[0].messages[0].content.slice(0, 20));
        who = resolvePersona(null); sent.length = 0;
        await f('http://127.0.0.1:5001/v1/chat/completions', { method: 'POST', body: JSON.stringify(body) }).catch(() => {});
        assert.ok(sent[0].messages[0].content.startsWith(LILITH_PERSONA_HEAD));
    } finally { globalThis.fetch = real; }
});

test('1.1.5 功能开关: every switch key exists in the settings defaults and reads/writes correctly', () => {
    const { s } = settings();
    const all = s.all; let n = 0;
    for (const g of SWITCH_GROUPS) for (const r of g.items) {
        n++;
        const cur = r.k.split('.').reduce((o, x) => o?.[x], all);
        assert.notEqual(cur, undefined, `default missing for ${r.k}`);
    }
    assert.ok(n >= 35, `only ${n} switches`);
    const sum = switchSummary(all); assert.equal(sum.total, n); assert.ok(sum.on >= n - 3);
    const fx = SWITCH_GROUPS.flatMap(g => g.items).find(r => r.k === 'fx.mode');
    assert.equal(switchOn(fx, all), true);
    let [k, v] = switchWrite(fx, all, false); assert.equal(k, 'fx'); assert.equal(v.mode, 'off'); assert.equal(v.outside, true);
    [k, v] = switchWrite(fx, { fx: { mode: 'off' } }, true, { 'fx.mode': 'brief' }); assert.equal(v.mode, 'brief', 'remembers the previous non-off value');
    const grp = SWITCH_GROUPS.flatMap(g => g.items).find(r => r.k === 'modules.group');
    assert.equal(switchOn(grp, {}), true, 'modules default to on');
    [k, v] = switchWrite(grp, all, false); assert.equal(k, 'modules'); assert.equal(v.group, false); assert.equal(v.plugins, true);
    assert.ok(SWITCH_GROUPS.flatMap(g => g.items).find(r => r.k === 'assistant').reload);
});

test('1.1.5 功能开关: hidden pages — modules hide their page, 总览 / 设置 never hide', () => {
    assert.deepEqual([...hiddenPages(['shop', 'ov', 'set', 'man'], { group: false })].sort(), ['group', 'man', 'shop']);
    assert.deepEqual([...hiddenPages(null, { plugins: false })], ['plugmgr']);
    for (const id of ['ov', 'set', 'api', 'switches', 'persona']) assert.ok(ALWAYS_PAGES.includes(id));
});

test('1.1.5 settings defaults: persona / modules / navHidden / groupWorld', () => {
    const { s } = settings({});
    assert.equal(s.get('persona').preset, 'lilith');
    assert.deepEqual(s.get('modules'), { group: true, groupAuto: true, plugins: true, slash: true, guide: true });
    assert.deepEqual(s.get('navHidden'), []);
    assert.equal(s.get('groupWorld').read, true); assert.equal(s.get('groupWorld').memory, true);
    const { s: s2 } = settings({ persona: { preset: 'orb', code: '42' } });
    assert.equal(s2.get('persona').code, '42'); assert.equal(s2.get('persona').call, '', 'missing keys are filled');
});

const BOOK = [
    { uid: 0, comment: '白浅', key: ['白浅', '姑姑'], content: '青丘白浅，上神，性子清冷护短，与夜华有三生三世的纠葛。' },
    { uid: 1, comment: '夜华', key: ['夜华', '太子'], content: '天族太子夜华，冷面深情。' },
    { uid: 2, comment: '青丘', key: ['青丘', '狐狸洞'], content: '九尾白狐一族的领地。' },
    { uid: 3, comment: '停用', key: ['停用'], content: '不应出现', disable: true },
    { uid: 4, comment: '', key: ['/re.+gex/i', 'x'], content: '正则关键词' },
];

test('1.1.5 聊天群 × 世界书: search, keys and the summon prompt', () => {
    assert.deepEqual(searchEntries(BOOK, '').map(e => e.uid), [0, 1, 2, 4]);
    assert.deepEqual(searchEntries(BOOK, '夜华').map(e => e.uid), [1, 0], 'title hits before content hits');
    assert.deepEqual(searchEntries(BOOK, '停用'), []);
    assert.deepEqual(entryKeys(BOOK[4]), [], 'regex keys and 1-char keys are skipped');
    assert.equal(entryTitle(BOOK[4]), '/re.+gex/i');
    const p = summonPrompt(BOOK[0], '三生三世', { tiers: '1=凡人', maxTier: 3 });
    assert.match(p, /世界书「三生三世」/); assert.match(p, /青丘白浅/); assert.match(p, /名称\|出处世界\|实力档数字/);
    assert.deepEqual(parseRecruit('白浅|青丘|6|清冷护短|桃花醉'), { 名称: '白浅', 世界: '青丘', 档: 6, 性格: '清冷护短', 特产: '桃花醉' });
});

test('1.1.5 聊天群 × 世界书: group block within budget, keyword background', () => {
    const m = { id: 'm1', 名称: '白浅', 来源: { book: '三生三世', uid: 0, comment: '白浅' } };
    assert.match(memberSourceLine(m, BOOK[0]), /白浅（世界书「三生三世」·白浅）：青丘白浅/);
    assert.equal(memberSourceLine({ 名称: 'x' }, BOOK[0]), '');
    const bg = matchKeys(BOOK, '今天去狐狸洞找太子', new Set(['0']));
    assert.deepEqual(bg.map(e => e.uid), [1, 2]);
    const block = groupWorldBlock([{ m, entry: BOOK[0] }], bg.map(e => ({ book: '三生三世', entry: e })), 2000);
    assert.match(block, /^【世界书资料（只读参考）】/); assert.match(block, /夜华/);
    const tiny = groupWorldBlock([{ m, entry: BOOK[0] }], bg.map(e => ({ book: '三生三世', entry: e })), 60);
    assert.ok(!/天族太子/.test(tiny) && /青丘白浅/.test(tiny), 'budget respected');
    assert.equal(groupWorldBlock([], [], 100), '');
});

test('1.1.5 聊天群 × 世界书: 群员记忆注入 only for summoned members that appear in the story', () => {
    const g = { 成员: [{ id: 'm1', 名称: '白浅', 好感: 60, 来源: { book: 'b', uid: 0 } }, { id: 'm2', 名称: '叶清寒', 好感: 20 }],
        消息: [{ from: 'm1', text: '群主，桃花醉收到了吗？' }, { from: 'me', text: '收到了，谢谢白浅' }, { from: 'm2', text: '路过' }],
        私聊: { m1: [{ me: true, text: '在吗' }, { me: false, text: '在。' }] }, 入库记录: [{ what: '桃花醉×1', src: '白浅', how: '赠礼' }] };
    const entryOf = m => (m.id === 'm1' ? BOOK[0] : null);
    assert.equal(worldMemoryPrompt(g, '叶清寒拔剑。', entryOf), '', 'non-worldbook members are not recalled');
    assert.equal(worldMemoryPrompt(g, '风吹过山岗。', entryOf), '', 'not in the scene → nothing');
    const viaKey = worldMemoryPrompt(g, '“姑姑！”有人喊道。', entryOf);
    assert.match(viaKey, /群员记忆/); assert.match(viaKey, /白浅（好感 60/); assert.match(viaKey, /桃花醉收到了吗/); assert.match(viaKey, /（私聊）：在。/); assert.match(viaKey, /桃花醉×1（赠礼）/);
    assert.ok(mentions('白浅来了', g.成员[0], null)); assert.ok(!mentions('', g.成员[0], BOOK[0]));
});

test('1.1.5 聊天群 × 世界书: active books (chat → character → global) without the 诸天 book', () => {
    const ctx = { chatMetadata: { world_info: 'ChatBook' }, characterId: 0, characters: [{ data: { extensions: { world: 'CardBook' } } }] };
    assert.deepEqual(activeBooks(ctx, { selected_world_info: [WORLD_NAME, 'Global', 'ChatBook'] }), ['ChatBook', 'CardBook', 'Global']);
    assert.deepEqual(activeBooks({}, null), []);
});

test('1.1.5 wiring: persona page, switches page, module gates and the group summon are connected', () => {
    const idx = readFileSync(new URL('../index.js', import.meta.url), 'utf8');
    for (const s of ['new PersonaHost(this)', 'new HubPersona(this)', 'new HubSwitches(this)', 'persona:()=>this.persona']) assert.ok(idx.includes(s), s);
    const grp = readFileSync(new URL('../src/hub-group.js', import.meta.url), 'utf8');
    for (const s of ["modules')?.group !== false", 'groupAuto !== false', 'data-wb-summon', 'worldMemoryPrompt(', '来源: c.来源']) assert.ok(grp.includes(s), s);
    assert.ok(readFileSync(new URL('../src/hub-plugins.js', import.meta.url), 'utf8').includes("modules')?.plugins !== false"));
    assert.ok(readFileSync(new URL('../src/features.js', import.meta.url), 'utf8').includes("modules')?.slash === false"));
    assert.ok(readFileSync(new URL('../src/lilith-float.js', import.meta.url), 'utf8').includes('this.app.persona.lilith === false'));
    const set = readFileSync(new URL('../src/hub-settings.js', import.meta.url), 'utf8');
    assert.ok(set.includes("act('switches'") && set.includes("act('persona'"));
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    for (const f of ['persona.js', 'hub-persona.js', 'hub-switches.js', 'group-world.js', 'hub-manual.js']) assert.ok(pkg.scripts.check.includes(`src/${f}`), f);
});

test('1.1.5 说明书: title version, persona / switches chapters and the worldbook summon are documented', async () => {
    const { renderManual } = await import('../src/hub-manual.js');
    const md = readFileSync(new URL('../docs/MANUAL.md', import.meta.url), 'utf8');
    assert.match(md.split('\n')[0], /1\.1\.5/);
    const { html, toc } = renderManual(md);
    assert.ok(toc.length >= 19);
    for (const k of ['系统助手人设', '系统光球', '功能开关', '从世界书召唤', '群员记忆', '换回莉莉丝', '刷新后生效']) assert.ok(html.includes(k), k);
});

// ---------- 1.1.5 self-check fixes ----------
import { aliasNote } from '../src/persona.js';
import { dropGroupRule, GROUP_RULE_COMMENT, HubGroup } from '../src/hub-group.js';
import { voiceSourceFor } from '../src/voice-box.js';
import { Bridge } from '../src/th-bridge.js';
import { identity, STORAGE } from '../src/contracts.js';

test('1.1.5 self-check: a "$" in the persona name stays literal in the voice pattern', () => {
    const src = voiceSourceFor({ name: 'A$&B', en: 'X$1' });
    assert.ok(!src.includes('莉莉[丝絲]'), 'every name slot replaced');
    assert.ok(src.includes('A\\$&B') && src.includes('X\\$1'), 'no $& / $1 expansion');
    try {
        setVoicePersona({ name: '零$号', en: '' });
        assert.deepEqual(extractVoices('【零$号】：“在。”').voices.map(v => v.text), ['在。']);
    } finally { setVoicePersona(null); }
});
test('1.1.5 self-check: one-character names are refused (they would hijack 「我说：“…”」 narration)', () => {
    assert.throws(() => personaFromForm({ preset: 'custom', name: '我' }), /至少 2 个字/);
    assert.throws(() => personaFromForm({ preset: 'orb', name: ' 零 ' }), /至少 2 个字/);
    assert.equal(personaFromForm({ preset: 'custom', name: '' }).name, '', 'empty = default name');
    assert.equal(personaFromForm({ preset: 'lilith', name: '我' }).preset, 'lilith', '莉莉丝 ignores the name field');
    assert.equal(personaFromForm({ preset: 'custom', name: '零号' }).name, '零号');
});
test('1.1.5 self-check: every persona rule tells the story model that old 「莉莉丝」 lines mean the persona', () => {
    const orb = resolvePersona({ preset: 'orb', code: '007' });
    assert.ok(storyRule(orb).includes(aliasNote(orb)) && aliasNote(orb).includes('系统007'));
    const own = resolvePersona({ preset: 'custom', name: '零号', story: '我自己的规则' });
    assert.ok(storyRule(own).startsWith('我自己的规则') && storyRule(own).includes(aliasNote(own)), 'also after a full replacement');
    assert.equal(storyRule(resolvePersona(null)), null);
});
test('1.1.5 self-check: 聊天群 switched off → the plugin worldbook rule 36 leaves the pass (copies only)', () => {
    const lists = { globalLore: [{ comment: '02｜核心｜系统助手莉莉丝' }, { comment: GROUP_RULE_COMMENT }], characterLore: [], chatLore: [{ comment: GROUP_RULE_COMMENT }], personaLore: [] };
    assert.equal(dropGroupRule(lists), 2);
    assert.deepEqual(lists.globalLore.map(e => e.comment), ['02｜核心｜系统助手莉莉丝']);
    assert.equal(lists.chatLore.length, 0);
    assert.equal(dropGroupRule(null), 0);
    const src = readFileSync(new URL('../src/hub-group.js', import.meta.url), 'utf8');
    assert.match(src, /WORLDINFO_ENTRIES_LOADED[\s\S]{0,200}if \(!this\.on\(\)\) dropGroupRule\(lists\)/);
    assert.match(src, /MESSAGE_SENT \|\| 'message_sent', \(\) => this\.syncPrompt\(\)/, 'the user message that names a member counts this turn');
});
test('1.1.5 self-check: a group round is marked busy BEFORE the worldbook read (no parallel second round)', async () => {
    const c = { characterId: 0, characters: [{ avatar: 'a.png' }], getCurrentChatId: () => 'a', chat: [{ mes: 'x', swipe_id: 0 }],
        chatMetadata: { variables: { 诸天系统: { 系统点: 100, 背包: [], 聊天群: { 成员: [{ id: 'm1', 名称: '白浅', 世界: '青丘', 档: 1, 好感: 20, 来源: { book: 'B', uid: 1, comment: '白浅' } }] } } }, [STORAGE]: { ledgerSchema: 2 } },
        extensionSettings: { variables: { global: {} } }, getRequestHeaders: () => ({}), saveSettingsDebounced() {} };
    let disk = structuredClone(c.chatMetadata);
    c.saveMetadata = async () => { disk = structuredClone(c.chatMetadata); };
    const adapter = { context: () => c, currentIdentity: () => identity(c), ledger: () => c.chatMetadata.variables.诸天系统, isGenerating: () => false, transactions: { uncertain: new Set() }, notify() {} };
    const bridge = new Bridge(adapter, { scriptVariables: () => ({}) });
    const keep = ['isSecureContext', 'confirm', 'navigator', 'SillyTavern', 'fetch'].map(k => [k, Object.getOwnPropertyDescriptor(globalThis, k)]);
    const put = { isSecureContext: true, confirm: () => true, navigator: { locks: { request: async (_n, _o, fn) => fn() } }, SillyTavern: { getContext: () => c }, fetch: async () => Response.json([{ chat_metadata: structuredClone(disk) }]) };
    for (const [k, value] of Object.entries(put)) Object.defineProperty(globalThis, k, { value, writable: true, configurable: true });
    try {
        const g = new HubGroup({ adapter, bridge }); g.paint = () => {}; g.syncPrompt = () => {}; g.toast = () => {};
        let release, seenBusy = null, prompt = '';
        g.world.entries = book => { seenBusy = g.busy; return new Promise(r => { release = () => { const list = [{ uid: 1, comment: '白浅', key: ['白浅'], content: '青丘帝姬，天族太子的未婚妻。' }]; g.world.cache.set(book, { t: Date.now(), list }); r(list); }; }); };
        g.ask = async (sys, user) => { prompt = sys + '\n' + user; return '@白浅: 在'; };
        const run = g.round('你好');
        await new Promise(r => setTimeout(r, 0));
        assert.ok(seenBusy, 'busy is already set while the worldbook is being read');
        assert.ok(g.busy, 'the UI sees the group as busy during the read');
        release(); await run;
        assert.ok(prompt.includes('【世界书资料（只读参考）】') && prompt.includes('天族太子'), 'the entry reaches the prompt');
        assert.equal(g.busy, '', 'busy cleared afterwards');
        assert.deepEqual(disk.variables.诸天系统.聊天群.消息.map(m => m.text), ['在']);
    } finally { for (const [k, d] of keep) d ? Object.defineProperty(globalThis, k, d) : delete globalThis[k]; }
});

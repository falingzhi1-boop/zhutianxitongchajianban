// 1.0.0: cut-out floating Lilith assets, settings tiers + search, 导出 / 导入存档 + ledger structure version,
// forced pre-rollback backup, unified error lines, landscape rail 「更多」, 动态效果 auto-lite.
// Browser side: tests/native_v100.py.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { stripSecrets, migrateLedger, buildBackup, parseBackup, backupPreview, mergeKeepingSecrets, BACKUP_FORMAT, BACKUP_FORMAT_VERSION, LEDGER_SCHEMA as IO_SCHEMA } from '../src/data-io.js';
import { LEDGER_SCHEMA, VERSION } from '../src/contracts.js';
import { groupSections, matchSetting, SETTING_GROUPS } from '../src/hub-settings.js';
import { explain, errorLine } from '../src/errors.js';
import { decideLite, LOW_FPS, MOTION_OPTIONS } from '../src/perf.js';
import { LAND_PINNED } from '../src/mobile.js';
import { artBox, FACE_OF, MOODS } from '../src/lilith-float.js';
import { FLOAT_ART } from '../src/lilith-float-art.js';
const DEFAULTS = { motion: /motion: 'auto'/.test(readFileSync(new URL('../src/settings.js', import.meta.url), 'utf8')) ? 'auto' : undefined };

const src = f => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const path = f => new URL('../' + f, import.meta.url);

// ---------- floating Lilith (cut-out rig) ----------
test('float art: every part and face patch has a webp, all boxes lie inside the art box', () => {
    const [W, H] = FLOAT_ART.box;
    const files = ['body', 'wingl', 'wingr', ...Object.keys(FLOAT_ART.faces).map(f => 'face-' + f)];
    for (const f of files) { const p = path(`assets/lilith/float/${f}.webp`); assert.ok(existsSync(p), f); assert.ok(statSync(p).size > 500, f); }
    for (const [name, [x, y, w, h]] of Object.entries({ ...FLOAT_ART.parts, ...FLOAT_ART.faces })) {
        assert.ok(x >= 0 && y >= 0 && w > 0 && h > 0 && x + w <= W && y + h <= H, name);
    }
});
test('float art: artBox gives percentages of the art box', () => {
    assert.deepEqual(artBox([0, 0, 636, 700]), { left: '0%', top: '0%', width: '100%', height: '100%' });
    assert.deepEqual(artBox([318, 350, 159, 70], [636, 700]), { left: '50%', top: '50%', width: '25%', height: '10%' });
});
test('float art: every mood maps to the plain face or an existing patch; blink / talk are not moods', () => {
    for (const m of Object.keys(FACE_OF)) { const f = FACE_OF[m]; assert.ok(f === '' || FLOAT_ART.faces[f], m); }
    if (Array.isArray(MOODS)) for (const m of MOODS) assert.ok(m in FACE_OF, m);
    assert.ok(!('blink' in FACE_OF) && !('talk' in FACE_OF));
});
test('float art: PROVENANCE lists every shipped file with the right sha256', () => {
    const prov = src('assets/lilith/float/PROVENANCE.md');
    for (const m of prov.matchAll(/`([\w-]+\.webp)`\s*\|[^|\n]*\|\s*`([0-9a-f]{64})`/g)) {
        const h = createHash('sha256').update(readFileSync(path('assets/lilith/float/' + m[1]))).digest('hex');
        assert.equal(h, m[2], m[1]);
    }
    assert.equal([...prov.matchAll(/`([\w-]+\.webp)`\s*\|[^|\n]*\|\s*`[0-9a-f]{64}`/g)].length, 12);
    assert.match(prov, /isnet-anime/); assert.match(prov, /tools\/lilith_float_cutout\.py/);
});

// ---------- settings tiers + search ----------
test('settings: 常用 / 进阶 / 诊断 — item tier wins, then section tier, then 常用', () => {
    assert.deepEqual(SETTING_GROUPS.map(g => g[0]), ['common', 'adv', 'diag']);
    const secs = [{ title: 'A', items: [{ k: 'a' }, { k: 'b', tier: 'adv' }] }, { title: 'B', tier: 'diag', items: [{ k: 'c' }] }, { title: 'C', tier: 'adv', items: [{ k: 'd' }] }];
    assert.deepEqual(groupSections(secs, 'common').map(s => s.items.map(i => i.k)), [['a']]);
    assert.deepEqual(groupSections(secs, 'adv').map(s => s.title), ['A', 'C']);
    assert.deepEqual(groupSections(secs, 'diag').map(s => s.items.map(i => i.k)), [['c']]);
});
test('settings search: every word must match, case-insensitive, empty matches all', () => {
    assert.ok(matchSetting('悬浮莉莉丝 大小 Size', ''));
    assert.ok(matchSetting('悬浮莉莉丝 大小 Size', 'size 悬浮'));
    assert.ok(!matchSetting('悬浮莉莉丝 大小', '悬浮 超时'));
});
test('settings: 导出 / 导入存档 and 动态效果 are on the page; the run map knows data-io', () => {
    const s = src('src/hub-settings.js');
    assert.match(s, /act\('data-io'/); assert.match(s, /'data-io': \(\) => app\.dataIO\?\.open\(\)/);
    assert.match(s, /adv\(sel\('motion'/); assert.equal(DEFAULTS.motion, 'auto');
});

// ---------- export / import ----------
const LEDGER = { 系统点: 1200, 当前世界: '斗罗大陆', 背包: [{ 名称: '回元丹' }], 任务库: { a: {} }, 万界足迹: ['青丘'], 聊天群: { 成员: [{ 名称: '小舞' }] } };
test('stripSecrets: drops key-named fields and credential-looking values, trims URL queries', () => {
    const out = stripSecrets({ url: 'https://relay.example/v1?key=abc', key: 'sk-abcdefghijklmnop', model: 'x', nested: { token: 't', note: 'Bearer abcdefghijkl', ok: 'hello' }, list: ['sk-zzzzzzzzzzzz', 'fine'] });
    assert.deepEqual(out, { url: 'https://relay.example/v1', model: 'x', nested: { ok: 'hello' }, list: ['fine'] });
});
test('buildBackup: format marker, ledger + memory, host-only keys and API keys left out', () => {
    const f = buildBackup({ settings: { hud: true, takeoverLog: [1], ledgerReceipts: {}, scriptVariables: { 诸天记忆助手_v1_API: { url: 'u', key: 'sk-secretsecretsecret' } } }, variables: { 诸天系统: LEDGER, NS: { m: 1 }, other: 1 }, meta: { ledgerSchema: 1 }, chat: 'c1', memoryNs: 'NS' });
    assert.equal(f.format, BACKUP_FORMAT); assert.equal(f.formatVersion, BACKUP_FORMAT_VERSION); assert.equal(f.plugin, VERSION);
    assert.deepEqual(Object.keys(f.chat.variables).sort(), ['NS', '诸天系统'].sort());
    assert.ok(!('takeoverLog' in f.settings) && !('ledgerReceipts' in f.settings));
    assert.ok(!JSON.stringify(f).includes('sk-secret'));
    const noMem = buildBackup({ variables: { 诸天系统: LEDGER, NS: { m: 1 } }, memoryNs: 'NS', include: { memory: false } });
    assert.deepEqual(Object.keys(noMem.chat.variables), ['诸天系统']);
});
test('parseBackup: readable errors; refuses newer file formats and newer ledger structures', () => {
    assert.throws(() => parseBackup('{oops'), /不是有效的 JSON/);
    assert.throws(() => parseBackup('{"a":1}'), /不是诸天终端的存档/);
    assert.throws(() => parseBackup({ format: BACKUP_FORMAT, formatVersion: BACKUP_FORMAT_VERSION + 1 }), /更新的插件/);
    assert.throws(() => parseBackup({ format: BACKUP_FORMAT, formatVersion: 1, chat: { ledgerSchema: LEDGER_SCHEMA + 1, variables: {} } }), /结构版本/);
    assert.throws(() => parseBackup({ format: BACKUP_FORMAT, formatVersion: 1, chat: { variables: { 诸天系统: [] } } }), /账本格式不对/);
    const ok = buildBackup({ variables: { 诸天系统: LEDGER } });
    assert.deepEqual(parseBackup(JSON.stringify(ok)).chat.variables.诸天系统, LEDGER);
});
test('migrateLedger 0 → 1 repairs types on a copy; a newer structure throws', () => {
    assert.equal(IO_SCHEMA, LEDGER_SCHEMA);
    const bad = { 系统点: 'abc', 背包: 'x', 任务库: [], 万界足迹: {} };
    const r = migrateLedger(bad, 0);
    assert.deepEqual(r.ledger, { 系统点: 0, 背包: [], 任务库: {}, 万界足迹: [] }); assert.deepEqual(r.steps, [1]);
    assert.equal(bad.背包, 'x', 'input not mutated');
    assert.deepEqual(migrateLedger(LEDGER, 0).ledger, LEDGER, 'a healthy ledger passes unchanged');
    assert.deepEqual(migrateLedger(LEDGER, LEDGER_SCHEMA).steps, []);
    assert.throws(() => migrateLedger(LEDGER, LEDGER_SCHEMA + 1), /更新插件/);
});
test('backupPreview: readable before / after rows and the number of changed settings', () => {
    const file = buildBackup({ settings: { hud: false, fx: { mode: 'off' } }, variables: { 诸天系统: { ...LEDGER, 系统点: 50, 背包: [] } } });
    const p = backupPreview({ variables: { 诸天系统: LEDGER }, settings: { hud: true, fx: { mode: 'off' } } }, file);
    const row = l => p.rows.find(r => r[0] === l);
    assert.deepEqual(row('系统点').slice(1), ['1,200', '50']);
    assert.deepEqual(row('背包物品').slice(1), ['1', '0']);
    assert.deepEqual(row('当前世界').slice(1), ['斗罗大陆', '斗罗大陆']);
    assert.equal(p.settingsChanged, 1); assert.ok(p.hasLedger);
    assert.deepEqual(backupPreview({}, file).rows[0].slice(1), ['—', '50']);
});
test('mergeKeepingSecrets: an imported key-less config never wipes a stored key', () => {
    const local = { A_API: { url: 'old', key: 'sk-localkeylocalkey', model: 'm' }, B: { apiKeyRaw: 'sk-anotherlocalkey12' } };
    const merged = mergeKeepingSecrets(local, { A_API: { url: 'new', model: 'n' }, B: {} });
    assert.deepEqual(merged, { A_API: { url: 'new', model: 'n', key: 'sk-localkeylocalkey' }, B: { apiKeyRaw: 'sk-anotherlocalkey12' } });
    assert.deepEqual(mergeKeepingSecrets(local, null), local);
});
test('import / schema wiring: forced backup first, read-back compare, schema in chat metadata, not in the ledger', () => {
    const s = src('src/data-io.js');
    assert.ok(s.indexOf("snapshot?.('导入前')") < s.indexOf('updateVariablesWith(v => { for'), 'backup before the write');
    assert.match(s, /读回不一致/); assert.match(s, /meta\.ledgerSchema = v/);
    assert.match(src('index.js'), /new DataIO\(this\)\.start\(\)/);
    assert.match(src('src/features.js'), /case 'export': case 'import': app\.dataIO\?\.open\(\)/);
});
test('th-bridge: a newer ledger structure makes the chat read-only; rollback always backs up first and keeps that backup', () => {
    const s = src('src/th-bridge.js');
    assert.match(s, /schema > LEDGER_SCHEMA\) throw Error/);
    const r = s.slice(s.indexOf('async restoreBackup'), s.indexOf('async restoreBackup') + 700);
    assert.ok(r.indexOf("snapshot('回滚前')") > 0 && r.indexOf("snapshot('回滚前')") < r.indexOf('updateVariablesWith'));
    assert.match(r, /x\.at < at \|\| \(pre && x\.at === pre\.at\)/);
    assert.match(s, /async snapshot\(reason = ''\)/);
});
test('/zt init no longer falls through into the worldbook popup', () => {
    const s = src('src/features.js'), i = s.indexOf("case 'init':");
    assert.match(s.slice(i, s.indexOf("case 'world':", i)), /return '';/);
});

// ---------- unified error lines ----------
test('errorLine: what happened · ledger · next step', () => {
    assert.equal(errorLine(Error('聊天已经切换，取消写入。')), '聊天已经切换，取消写入。 账本：没有改动。 下一步：回到原来的聊天再试一次。');
    assert.match(errorLine(Error('导入后读回不一致（诸天系统）')), /账本：可能已经写入。 下一步：.*回滚/);
    assert.match(errorLine(Error('请求超时（120 秒）')), /费用已退回/);
    assert.match(errorLine(Error('HTTP 401 Unauthorized')), /API 密钥/);
    assert.match(errorLine(Error('系统点不足：需要 300')), /攒够系统点/);
    assert.equal(errorLine(Error('奇怪的错误')), '奇怪的错误。', 'unknown errors get no ledger claim');
    assert.equal(errorLine('已经写好 账本：x 下一步：y'), '已经写好 账本：x 下一步：y。');
    assert.equal(explain(null).what, '未知错误');
});
test('errorLine is used by the settings actions, 聊天群, popups and the takeover toasts', () => {
    for (const f of ['src/hub-settings.js', 'src/hub-group.js', 'src/features.js', 'src/portrait.js', 'src/onboarding.js', 'index.js']) assert.match(src(f), /errorLine\(/, f);
});

// ---------- landscape rail + lite ----------
test('landscape rail: six pinned pages + 更多 button, current page always visible', () => {
    assert.deepEqual([...LAND_PINNED], ['ov', 'task', 'shop', 'bag', 'group', 'set']);
    const css = src('styles/hub.css');
    assert.match(css, /nav\.zt-hub-nav:not\(\.zt-more-open\) \.nav-button\[data-page\]:not\(\[data-pin\]\):not\(\[aria-selected=true\]\)\{display:none!important\}/);
    assert.match(src('src/mobile.js'), /zt-nav-more/);
});
test('decideLite: settings win; auto follows reduced motion or a slow touch device', () => {
    assert.equal(decideLite('lite', {}), true); assert.equal(decideLite('full', { reduced: true, fps: 10, coarse: true }), false);
    assert.equal(decideLite('auto', { reduced: true }), true);
    assert.equal(decideLite('auto', { coarse: true, fps: LOW_FPS - 1 }), true);
    assert.equal(decideLite('auto', { coarse: true, fps: 60 }), false);
    assert.equal(decideLite('auto', { coarse: false, fps: 20 }), false, 'desktop is never auto-downgraded by fps');
    assert.equal(decideLite('auto', { coarse: true, fps: 0 }), false, 'not measured yet');
    assert.deepEqual(MOTION_OPTIONS.map(o => o[0]), ['auto', 'full', 'lite']);
});
test('lite visuals: float, world decorations, atlas and fx all honour it', () => {
    assert.match(src('src/lilith-float.js'), /\.fl\[data-lite=true\]/);
    assert.match(src('styles/world.css'), /:host\(\[data-zt-lite\]\) \.zt-world-deco>\*\{animation:none!important\}/);
    assert.match(src('styles/atlas.css'), /data-zt-lite/);
    assert.match(src('src/fx.js'), /this\.app\.perf\?\.lite/);
});

// ---------- release docs ----------
test('1.0 docs: README ≤ 150 lines, history in CHANGELOG, LICENSE forbids redistribution / commercial / AI training, UNINSTALL', () => {
    assert.ok(src('README.md').split('\n').length <= 150);
    const cl = src('CHANGELOG.md'); for (const v of ['1.0.0', '0.9.4', '0.9.0', '0.2.0']) assert.match(cl, new RegExp(`## ${v.replace(/\./g, '\\.')}`), v);
    const lic = src('LICENSE');
    assert.match(lic, /再分发/); assert.match(lic, /商业使用/); assert.match(lic, /训练、微调/); assert.match(lic, /无法在技术上阻止/);
    assert.match(lic, /vendor\/original/); assert.equal(JSON.parse(src('package.json')).license, 'SEE LICENSE IN LICENSE');
    assert.match(src('docs/UNINSTALL.md'), /导出存档/);
    assert.match(src('README.md'), /实验性/);
});
test('AI capabilities are 实验性 (experimental), the rollback capability is implemented, 1.0 capabilities listed', async () => {
    const { CAPABILITIES } = await import('../src/contracts.js');
    const st = n => CAPABILITIES.find(c => c.name === n)?.state;
    for (const n of ['原版自动记忆整理、补读及独立 API', '原版工作台完整工具与建议接续', 'AI 商城进货、许愿、抽取、外挂与神通支付动作', '私聊 API 与真实模型生成', 'AI 自动写入 当前世界 / 世界类型']) assert.equal(st(n), 'experimental', n);
    assert.equal(st('旧存档迁移、账本备份与回滚'), 'implemented');
    assert.ok(!CAPABILITIES.some(c => c.state === 'pending'), 'no plain pending left');
    for (const n of ['悬浮莉莉丝抠图立绘', '导出 / 导入存档', '账本结构版本', '设置分层与搜索', '统一错误提示', '手机横屏导航精简', '动态效果自动降级']) assert.equal(st(n), 'implemented', n);
});

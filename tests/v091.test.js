// 0.9.1: 复制诊断信息 (redaction, settings allow-list, endpoint text, error log, the report itself), 手机真机自检 helpers,
// keyboard detection for page-resizing WebViews, LF line endings + .gitattributes, FILELIST tool, CI workflow.
// The self-check and the copy button run in the browser in tests/native_v091.py.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { redact, settingsSnapshot, endpointText, ErrorLog, buildReport } from '../src/diag-report.js';
import { fillsView, summarize } from '../src/device-check.js';
import { keyboardState } from '../src/mobile.js';
import { CAPABILITIES, VERSION } from '../src/contracts.js';

const root = new URL('../', import.meta.url);
const read = f => readFileSync(new URL(f, root), 'utf8');
const FAKE_KEY = 'sk-' + 'abcdefghijklmnopqrstuvwxyz0123456789ABCD';

// ---------- redaction ----------
test('redact: keys, bearer tokens, key=value, URL credentials and query strings are masked', () => {
    const s = redact(`key ${FAKE_KEY} AIza${'x'.repeat(35)} Authorization: Bearer abc.def.ghijklmnop "apiKey":"hunter22" token=zzzzzz https://u:p@h.example/v1?key=1&x=2 https://ok.example/v1/models`);
    assert.ok(!s.includes(FAKE_KEY.slice(3))); assert.match(s, /sk-\*\*\*/);
    assert.ok(!/AIzax{10}/.test(s)); assert.ok(!s.includes('ghijklmnop'));
    assert.ok(!s.includes('hunter22')); assert.ok(!s.includes('zzzzzz'));
    assert.ok(!s.includes('u:p@')); assert.ok(!s.includes('key=1'));
    assert.ok(s.includes('https://ok.example/v1/models'), 'plain URLs stay readable');
});
test('redact: ordinary report text is untouched (hotkeys, commit hashes, Chinese text, numbers)', () => {
    const t = '"hotkeys":true,"apiTimeout":180 commit 7e8663cd9c184a550b37238218bdd32c6efc68e9 窗口 390×844 系统点 1200';
    assert.equal(redact(t), t);
});

// ---------- settings / endpoints ----------
test('settingsSnapshot: never script variables (API keys); lists become counts; nested objects keep plain values', () => {
    const snap = settingsSnapshot({ scriptVariables: { X_UI: { key: FAKE_KEY } }, takeoverLog: [1, 2, 3], hud: true, apiTimeout: 180,
        fx: { mode: 'full', outside: true }, live2d: { accepted: true, model: 'C:/secret/model.json' }, wbUnbound: { cards: ['a'] }, floatPos: { x: 1 }, deviceCheck: { text: 'x' } });
    const s = JSON.stringify(snap);
    assert.ok(!s.includes(FAKE_KEY) && !s.includes('scriptVariables') && !s.includes('secret'));
    assert.equal(snap.takeoverLog, '[3 项]'); assert.equal(snap.hud, true); assert.deepEqual(snap.fx, { mode: 'full', outside: true });
    assert.deepEqual(snap.live2d, { accepted: true, model: '已设置' }); assert.equal(snap.wbUnbound, true);
    assert.equal('floatPos' in snap, false); assert.equal('deviceCheck' in snap, false);
});
test('endpointText: host + model only, never the key or the path', () => {
    assert.equal(endpointText({ url: 'https://api.example.com/v1/chat/completions', key: FAKE_KEY, model: 'm-1' }), 'api.example.com · m-1');
    assert.equal(endpointText({ url: 'st-main://x', key: 'st-main' }), '酒馆主 API');
    assert.equal(endpointText({}), '未设置'); assert.equal(endpointText(null), '未设置');
    assert.equal(endpointText({ url: 'not a url' }), '地址无法解析');
});

// ---------- error log ----------
test('ErrorLog: records [诸天…] console errors / warnings (redacted, capped), ignores other lines, restores console', () => {
    const origWarn = console.warn, origErr = console.error; const seen = [];
    const stubW = (...a) => seen.push(a), stubE = (...a) => seen.push(a); console.warn = stubW; console.error = stubE;
    const g = globalThis; const hadAdd = g.addEventListener; g.addEventListener ??= () => {}; g.removeEventListener ??= () => {};
    try {
        const log = new ErrorLog('http://x/ext/', 3).start();
        console.warn('[诸天] 测试', new Error('boom ' + FAKE_KEY)); console.warn('other plugin'); console.error('[诸天设置]', { a: 1 });
        for (let i = 0; i < 5; i++) console.error('[诸天] n' + i);
        assert.equal(seen.length, 8, 'everything still reaches the real console');
        assert.equal(log.items.length, 3, 'capped'); assert.match(log.items.at(-1).text, /n4/);
        log.items.length = 0; console.warn('[诸天] k', FAKE_KEY); assert.ok(!log.items[0].text.includes(FAKE_KEY.slice(3)));
        log.dispose();
        assert.equal(console.warn, stubW); assert.equal(console.error, stubE); console.warn('[诸天] after'); assert.equal(log.items.length, 1);
    } finally { console.warn = origWarn; console.error = origErr; if (!hadAdd) { delete g.addEventListener; delete g.removeEventListener; } }
});

// ---------- the report ----------
test('buildReport: version, interfaces, endpoints (host only), settings, errors; no key anywhere; broken parts reported', () => {
    const app = {
        adapter: { version: '1.19.0', support: { reason: '已验收' }, capabilities: [{ ok: true, label: '事件' }, { ok: false, label: '钩子' }] },
        statusbar: { state: { mode: 'terminal', reason: 'ok' }, diagnoseLast: () => ({ ok: true, text: '第 6 层正常' }) },
        hub: { isOpen: false }, assistant: {}, float: { active: true },
        features: { apiConfigs: () => ({ status: { url: 'https://api.example.com/v1', key: FAKE_KEY, model: 'm-1' }, assistant: { url: 'https://u:pw@relay.example/v1?key=zzz', key: FAKE_KEY } }) },
        settings: { all: { hud: true, scriptVariables: { k: FAKE_KEY } }, get: k => (k === 'deviceCheck' ? { at: 'T', text: '✅ 全屏' } : undefined) },
    };
    const r = buildReport(app, { errors: [{ t: '10:00:00', kind: 'warn', text: '[诸天] x' }] });
    assert.ok(r.includes(VERSION) && r.includes('1.19.0') && r.includes('✅ 事件') && r.includes('❌ 钩子'));
    assert.ok(r.includes('api.example.com · m-1') && r.includes('relay.example'));
    assert.ok(r.includes('第 6 层正常') && r.includes('✅ 全屏') && r.includes('[诸天] x'));
    assert.ok(!r.includes(FAKE_KEY.slice(3)) && !r.includes('pw@') && !r.includes('zzz'));
    assert.match(r, /设备：读取失败|— 设备 —/, 'no browser in node: the device part is reported, not thrown');
    assert.doesNotThrow(() => buildReport({}));
});

// ---------- self-check helpers ----------
test('fillsView: ±2 px of the visible area', () => {
    const box = { left: 0, top: 0, w: 390, h: 470 };
    assert.equal(fillsView({ left: 0, top: 0, width: 390, height: 470 }, box), true);
    assert.equal(fillsView({ left: 1, top: -1, width: 391.5, height: 468.4 }, box), true);
    assert.equal(fillsView({ left: 8, top: 8, width: 374, height: 454 }, box), false);
    assert.equal(fillsView(null, box), false);
});
test('summarize: counts, one line per result, device line, redacted', () => {
    const t = summarize([{ title: '全屏', state: 'ok', text: '铺满' }, { title: '键盘', state: 'fail', text: '挡住', data: { kb: 'visual' } }, { title: '横屏', state: 'skip', text: '已跳过' }],
        { ua: 'UA ' + FAKE_KEY, inner: '390×844', visual: '390×844', dpr: 3, safe: { top: 24, right: 0, bottom: 16, left: 0 } });
    assert.match(t, /✅ 1 · ⚠ 0 · ❌ 1 · 跳过 1/); assert.match(t, /❌ 键盘：挡住  \{"kb":"visual"\}/); assert.match(t, /⏭ 横屏/);
    assert.match(t, /安全区 24\/0\/16\/0/); assert.ok(!t.includes(FAKE_KEY.slice(3)));
});

// ---------- keyboard on page-resizing WebViews ----------
test('keyboardState: visual-viewport keyboards, page-resizing keyboards (only while typing), nothing otherwise', () => {
    assert.equal(keyboardState({ kb: 374 }), 'visual');
    assert.equal(keyboardState({ kb: 0, innerH: 470, fullH: 844, typing: true }), 'resize');
    assert.equal(keyboardState({ kb: 0, innerH: 470, fullH: 844, typing: false }), '', 'a shorter window without a focused field is not a keyboard');
    assert.equal(keyboardState({ kb: 60, innerH: 800, fullH: 844, typing: true }), '', 'URL bar collapsing is not a keyboard');
    assert.equal(keyboardState(), '');
});

// ---------- wiring ----------
test('wiring: error log first, self-check after features, settings / diagnostics / slash entries, keep-hub exemption', () => {
    const idx = read('index.js');
    assert.ok(idx.indexOf('new ErrorLog(') < idx.indexOf('new Settings(a)'), 'error log starts before everything else');
    assert.ok(idx.indexOf('new DeviceCheck(this)') > idx.indexOf('new Features(this)'));
    const hs = read('src/hub-settings.js'); assert.match(hs, /act\('copy-diag'/); assert.match(hs, /act\('selftest'/);
    const f = read('src/features.js'); assert.match(f, /data-diag="copy"/); assert.match(f, /data-diag="selftest"/); assert.match(f, /case 'selftest'/); assert.match(f, /case 'copydiag'/);
    assert.match(read('src/hub.js'), /data-zt-keep-hub/);
    assert.match(read('src/device-check.js'), /setAttribute\('data-zt-keep-hub'/);
    for (const m of ['src/diag-report.js', 'src/device-check.js']) assert.ok(JSON.parse(read('package.json')).scripts.check.includes(m), m);
});

// ---------- repository hygiene ----------
test('line endings: .gitattributes forces LF (vendor untouched, binaries binary) and no shipped text file has CR', () => {
    const ga = read('.gitattributes');
    assert.match(ga, /^\* text=auto eol=lf$/m); assert.match(ga, /^vendor\/\*\* -text/m); assert.match(ga, /^\*\.webp binary$/m);
    const list = read('FILELIST.sha256').trim().split('\n').map(l => l.split('  ')[1]);
    const text = list.filter(f => /\.(js|mjs|json|md|css|html|py|sh|txt|yml|ya?ml)$|^\.git(ignore|attributes)$/.test(f));
    assert.ok(text.length > 100);
    const cr = text.filter(f => readFileSync(new URL(f, root)).includes(13));
    assert.deepEqual(cr, []);
    assert.ok(!read('FILELIST.sha256').includes('\r'));
});
test('FILELIST.sha256 is generated by tools/filelist.py (CI runs --check; locally: npm run filelist)', () => {
    assert.ok(existsSync(new URL('tools/filelist.py', root)));
    const pkg = JSON.parse(read('package.json')).scripts;
    assert.equal(pkg.filelist, 'python3 tools/filelist.py'); assert.equal(pkg['filelist:check'], 'python3 tools/filelist.py --check');
    const out = execFileSync('python3', ['-c', 'import sys;sys.path.insert(0,"tools");import filelist;print(len(filelist.files()))'], { cwd: new URL('.', root), encoding: 'utf8' });
    assert.ok(Number(out) > 150, 'walks the extension folder');
});
test('CI workflow runs check, unit tests, FILELIST check, line-ending and secret checks', () => {
    const ci = read('.github/workflows/ci.yml');
    for (const s of ['npm ci', 'npm run check', 'npm test', 'npm run filelist:check', 'git ls-files --eol', 'git grep']) assert.ok(ci.includes(s), s);
});
test('capabilities list the 0.9.1 rows', () => {
    for (const n of ['复制诊断信息', '手机真机自检']) assert.ok(CAPABILITIES.some(c => c.name === n && c.state === 'implemented'), n);
});

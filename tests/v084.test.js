// 0.8.4 pure logic: streamed chat completions (502 fix), readable API errors instead of the fixed "CORS" sentence,
// the stretched 60 s timeout (wrapper adaptation), private chat no longer closing the terminal, one API setting,
// 强力模块 worldbook defaults/switches, colour palettes, and the generic foreign-node alignment used for beautifications.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseSse, toCompletion, errorText, streamedCompletion } from '../src/api-stream.js';
import { proxiedFetch, clampTimeout, retimeError, TIMEOUT_CHOICES } from '../src/assistant-host.js';
import { Bridge } from '../src/th-bridge.js';
import { latestRules, mergeWorldbook, moduleStates, applyModules, BALANCE_MODULES, DEFAULT_OFF, WORLDBOOK_REV } from '../src/worldbook.js';
import { PALETTES, PALETTE_OPTIONS, shellCss, engineCss, fxCss, isPalette } from '../src/palettes.js';
import { sameConfig } from '../src/api-center.js';
import original from '../vendor/original/runtime.js';

const root = new URL('../', import.meta.url);
const read = p => readFileSync(new URL(p, root), 'utf8');
const sse = parts => parts.map(p => 'data: ' + (typeof p === 'string' ? p : JSON.stringify(p)) + '\n\n').join('');
const streamResponse = (text, status = 200) => new Response(text, { status, headers: { 'Content-Type': 'text/event-stream' } });
const jsonResponse = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
globalThis.location ??= { href: 'http://127.0.0.1:8000/', origin: 'http://127.0.0.1:8000' };

// ---------- streaming ----------
test('parseSse: content deltas joined, reasoning kept apart, finish_reason, [DONE] and junk ignored', () => {
    const p = parseSse(sse([{ id: 'c1', model: 'm', choices: [{ delta: { role: 'assistant' } }] }, { choices: [{ delta: { reasoning_content: '想一想' } }] },
        { choices: [{ delta: { content: '你好' } }] }, 'not json', { choices: [{ delta: { content: '，宿主' }, finish_reason: 'stop' }] }, '[DONE]']));
    assert.equal(p.content, '你好，宿主'); assert.equal(p.reasoning, '想一想'); assert.equal(p.finish, 'stop'); assert.equal(p.model, 'm'); assert.equal(p.chunks, 4);
    const c = toCompletion(p, 'x');
    assert.equal(c.choices[0].message.content, '你好，宿主'); assert.equal(c.choices[0].finish_reason, 'stop');
});

test('streamedCompletion: asks for stream:true and returns ONE non-stream JSON response (what the original parses)', async () => {
    const sent = [];
    const r = await streamedCompletion(async b => { sent.push(b); return streamResponse(sse([{ choices: [{ delta: { content: '成' } }] }, { choices: [{ delta: { content: '功' }, finish_reason: 'stop' }] }, '[DONE]'])); }, { model: 'm', messages: [], stream: false, max_tokens: 9 });
    assert.equal(sent[0].stream, true); assert.equal(sent[0].max_tokens, 9);
    assert.equal(r.status, 200);
    const j = await r.json();
    assert.equal(j.choices[0].message.content, '成功');
});

test('streamedCompletion: provider ignoring stream (plain JSON) is passed through; length cut keeps finish_reason', async () => {
    const r = await streamedCompletion(async () => jsonResponse({ choices: [{ message: { content: '' }, finish_reason: 'length' }] }), { model: 'm' });
    assert.equal((await r.json()).choices[0].finish_reason, 'length');
});

test('streamedCompletion: a provider that rejects streaming is retried once without stream', async () => {
    const sent = [];
    const r = await streamedCompletion(async b => { sent.push(b.stream); return b.stream ? jsonResponse({ error: { message: 'stream is not supported' } }, 400) : jsonResponse({ choices: [{ message: { content: 'ok' } }] }); }, { model: 'm' });
    assert.deepEqual(sent, [true, false]); assert.equal((await r.json()).choices[0].message.content, 'ok');
});

test('streamedCompletion: HTTP errors keep their status with a readable reason; in-stream error → 502', async () => {
    const r = await streamedCompletion(async () => jsonResponse({ error: { message: 'Incorrect API key' } }, 401), { model: 'm' });
    assert.equal(r.status, 401); assert.match((await r.json()).error.message, /Key 无效.*Incorrect API key/);
    const e = await streamedCompletion(async () => streamResponse(sse([{ error: { message: 'upstream overloaded' } }])), { model: 'm' });
    assert.equal(e.status, 502); assert.match((await e.json()).error.message, /overloaded/);
    const empty = await streamedCompletion(async () => streamResponse(''), { model: 'm' });
    assert.equal(empty.status, 502);
    // SillyTavern's non-stream relay reports upstream failures as HTTP 200 + {error}: never treated as success
    const st = await streamedCompletion(async () => jsonResponse({ error: { message: 'Bad Gateway' } }), { model: 'm' });
    assert.equal(st.status, 502);
});

test('errorText: html error pages are reduced to text, common statuses get a hint', () => {
    assert.match(errorText('<html><body><h1>502 Bad Gateway</h1></body></html>', 502), /网关错误.*502 Bad Gateway/);
    assert.match(errorText('{"error":"quota"}', 429), /余额不足.*quota/);
    assert.equal(errorText('', 418), 'HTTP 418');
});

// ---------- fetch shim (original Lilith code path) ----------
test('shim: POST chat/completions is streamed on the direct path and handed back as JSON', async () => {
    const real = globalThis.fetch; const bodies = [];
    globalThis.fetch = async (url, init) => { bodies.push([String(url), JSON.parse(init.body)]); return streamResponse(sse([{ choices: [{ delta: { content: '记忆' }, finish_reason: 'stop' }] }])); };
    try {
        const f = proxiedFetch({ ctx: () => ({ getRequestHeaders: () => ({}) }) });
        const r = await f('https://api.example.com/v1/chat/completions', { method: 'POST', headers: { Authorization: 'Bearer k' }, body: JSON.stringify({ model: 'm', messages: [{ role: 'user', content: 'x' }], stream: false, max_tokens: 1800 }) });
        assert.equal(bodies[0][0], 'https://api.example.com/v1/chat/completions'); assert.equal(bodies[0][1].stream, true);
        assert.equal((await r.json()).choices[0].message.content, '记忆');
    } finally { globalThis.fetch = real; }
});

test('shim: CORS-blocked chat goes through the ST relay WITH stream:true (the old non-stream relay was the 502)', async () => {
    const real = globalThis.fetch; const relayed = [];
    globalThis.fetch = async (url, init) => {
        if (String(url).startsWith('https://')) throw new TypeError('Failed to fetch');
        relayed.push(JSON.parse(init.body)); return streamResponse(sse([{ choices: [{ delta: { content: '转发' }, finish_reason: 'stop' }] }]));
    };
    try {
        const f = proxiedFetch({ ctx: () => ({ getRequestHeaders: () => ({ 'X-CSRF-Token': 't' }) }) });
        const r = await f('https://api.example.com/v1/chat/completions', { method: 'POST', headers: { Authorization: 'Bearer sk-1' }, body: JSON.stringify({ model: 'm', messages: [], max_tokens: 50 }) });
        assert.equal(relayed.length, 1); assert.equal(relayed[0].stream, true); assert.equal(relayed[0].custom_url, 'https://api.example.com/v1');
        assert.equal(relayed[0].custom_include_headers, JSON.stringify({ Authorization: 'Bearer sk-1' }));
        assert.equal((await r.json()).choices[0].message.content, '转发');
    } finally { globalThis.fetch = real; }
});

test('shim: relay failure on chat returns a JSON error (status), not a throw that reads as "CORS"', async () => {
    const real = globalThis.fetch;
    globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };
    try {
        const f = proxiedFetch({ ctx: () => ({ getRequestHeaders: () => ({}) }) });
        const r = await f('https://api.example.com/v1/chat/completions', { method: 'POST', body: JSON.stringify({ model: 'm', messages: [] }) });
        assert.equal(r.status, 502); assert.match((await r.json()).error.message, /转发也失败/);
    } finally { globalThis.fetch = real; }
});

test('shim: GET /models never throws — the relay reason reaches the page as an HTTP status', async () => {
    const real = globalThis.fetch;
    globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };
    try {
        let opts = null;
        const f = proxiedFetch({ listModels: async (base, key, o) => { opts = o; throw Object.assign(Error('经酒馆服务器转发：服务商返回 HTTP 401 · Key 无效或缺失'), { status: 401 }); } });
        const r = await f('https://api.example.com/v1/models', { headers: { Authorization: 'Bearer bad' } });
        assert.equal(r.status, 401); assert.match((await r.json()).error.message, /401/);
        assert.equal(opts.direct, false, 'the browser block was already seen: no second direct attempt inside the 20 s window');
    } finally { globalThis.fetch = real; }
});

test('bridge.listModels: bare array / {models} shapes; 403 from ST explains the CSRF case; 404 hints /v1', async () => {
    const real = globalThis.fetch;
    const b = new Bridge({ context: () => ({ getRequestHeaders: () => ({}) }) }, {});
    try {
        globalThis.fetch = async url => String(url).startsWith('https://') ? jsonResponse([{ id: 'a' }, 'b']) : null;
        assert.deepEqual(await b.listModels('https://x.example/v1', 'k'), ['a', 'b']);
        globalThis.fetch = async url => String(url).startsWith('https://') ? jsonResponse({ models: [{ name: 'g' }] }) : null;
        assert.deepEqual(await b.listModels('https://x.example/v1', 'k'), ['g']);
        globalThis.fetch = async url => { if (String(url).startsWith('https://')) throw new TypeError('Failed to fetch'); return new Response('Forbidden', { status: 403 }); };
        await assert.rejects(b.listModels('https://x.example/v1', 'k'), e => /403/.test(e.message) && /刷新/.test(e.message) && e.status === 403);
        globalThis.fetch = async url => { if (String(url).startsWith('https://')) throw new TypeError('Failed to fetch'); return new Response('nope', { status: 404 }); };
        await assert.rejects(b.listModels('https://x.example', 'k'), e => /\/v1/.test(e.message) && e.status === 404);
    } finally { globalThis.fetch = real; }
});

test('bridge.customChat: streamed (direct), relay fallback also streamed, error message carries the provider reason', async () => {
    const real = globalThis.fetch; const seen = [];
    const b = new Bridge({ context: () => ({ getRequestHeaders: () => ({}) }) }, {});
    try {
        globalThis.fetch = async (url, init) => { seen.push([String(url), JSON.parse(init.body).stream]); return streamResponse(sse([{ choices: [{ delta: { content: '好' }, finish_reason: 'stop' }] }])); };
        const r = await b.customChat({ url: 'https://x.example/v1', key: 'k', model: 'm' }, [{ role: 'user', content: 'hi' }]);
        assert.equal(r.text, '好'); assert.equal(r.via, 'direct'); assert.deepEqual(seen[0], ['https://x.example/v1/chat/completions', true]);
        seen.length = 0;
        globalThis.fetch = async (url, init) => { if (String(url).startsWith('https://')) throw new TypeError('Failed to fetch'); seen.push(JSON.parse(init.body).stream); return jsonResponse({ error: { message: 'model not found' } }, 404); };
        await assert.rejects(b.customChat({ url: 'https://x.example/v1', key: 'k', model: 'm' }, []), e => /酒馆转发返回 HTTP 404/.test(e.message) && /model not found/.test(e.message));
        assert.deepEqual(seen, [true]);
    } finally { globalThis.fetch = real; }
});

// ---------- timeout + private chat ----------
test('timeout: wrapper adaptation gives the original a host setTimeout; only 60000 ms is stretched', () => {
    const rt = read('vendor/original/assistant-runtime.js');
    assert.match(rt.split('\n').slice(0, 8).join('\n'), /const setTimeout = typeof env\.setTimeout === 'function' \? env\.setTimeout : window\.setTimeout;/);
    assert.equal((rt.match(/setTimeout\(\(\)=>control\.abort\(\),60000\)/g) || []).length, 4, 'the four fixed request aborts are still the original code');
    const host = read('src/assistant-host.js');
    assert.match(host, /setTimeout: \(fn, ms, \.\.\.rest\) => globalThis\.setTimeout\(fn, ms === 60000 \? this\.apiTimeoutSec\(\) \* 1000 : ms, \.\.\.rest\)/);
    assert.deepEqual(TIMEOUT_CHOICES, [60, 120, 180, 300, 600]);
    assert.equal(clampTimeout(undefined), 180); assert.equal(clampTimeout('300'), 300); assert.equal(clampTimeout(5), 180);
    const prov = JSON.parse(read('vendor/original/provenance.json'));
    assert.match(prov.assistantWrapperAdaptation, /setTimeout/);
});

test('timeout: the "超过60秒" wording follows the real limit', () => {
    const e = retimeError(Error('私聊已取消或超过60秒；旧记录和输入保留，已发出的请求仍可能计费。'), 180);
    assert.match(e.message, /超过180秒/); assert.doesNotMatch(e.message, /60秒/);
    const same = Error('别的错误'); assert.equal(retimeError(same, 180), same);
    const sixty = Error('超过60秒'); assert.equal(retimeError(sixty, 60), sixty);
});

test('private chat: opening it no longer collapses the window (= the terminal); the original module is wrapped, not edited', () => {
    const host = read('src/assistant-host.js');
    assert.match(host, /G\.ZhuTianLilithChat = Object\.create\(Chat/);
    assert.match(host, /collapseWorkbench: \(\) => \{\}/);
    // the original still calls E.collapseWorkbench() on open — that is what used to close the terminal
    assert.match(read('vendor/original/runtime.js'), /function open\(\)\{releaseDrag\(\);E\.collapseWorkbench\?\.\(\);/);
    assert.match(read('vendor/original/assistant-runtime.js'), /const L=globalThis\.ZhuTianLilithChat;/);
});

// ---------- one API setting ----------
test('API: the terminal 连接 page hosts the API 中心 form; the original form is hidden; status-bar gear routed too', () => {
    const idx = read('index.js'), css = read('styles/hub.css'), sb = read('src/statusbar-host.js'), hs = read('src/hub-settings.js');
    assert.match(idx, /if\(p==='api'\)try\{mountApiInline\(this\.hub\.shadow\.getElementById\('page-api'\)/);
    assert.match(idx, /openApiCenter\(\)\{if\(this\.hub\?\.isOpen\)\{this\.hub\.go\('api'\);return null;\}/);
    assert.match(css, /#page-api\.zt-api-unified > :not\(\.zt-api-inline\)\{display:none!important\}/);
    assert.match(sb, /\.btn-open-api,label\[for="api-modal-toggle"\]/);
    assert.doesNotMatch(hs, /act\('go-api'/, 'no second "莉莉丝连接页" entry');
    assert.equal(sameConfig({ url: 'a', key: 'k', model: 'm' }, { url: 'a ', key: 'k', model: 'm', maxTokens: 9 }), true);
    assert.equal(sameConfig({ url: 'a', key: 'k', model: 'm' }, { url: 'b', key: 'k', model: 'm' }), false);
});

// ---------- 强力模块 ----------
test('强力模块: new installs start with 神豪挥霍 and 诸天打手 off; every listed entry exists in the book', () => {
    const rules = latestRules(original.ZhuTianBuiltinRules).rules;
    assert.equal(WORLDBOOK_REV, '1.1.1');
    assert.deepEqual(DEFAULT_OFF, ['08｜核心｜神豪挥霍', '13｜外挂｜诸天打手']);
    for (const m of BALANCE_MODULES) assert.ok(rules.some(r => r.comment === m.comment), m.comment);
    assert.deepEqual(rules.filter(r => r.disable).map(r => r.comment), DEFAULT_OFF);
    assert.equal(rules.length, 36);
});

test('强力模块: an existing book keeps the user\'s on/off on update (never switched automatically)', () => {
    const rules = latestRules(original.ZhuTianBuiltinRules).rules;
    const old = { entries: Object.fromEntries(rules.map((r, i) => [i, { ...r, disable: false }])) };   // v1.1 copy: all on
    const merged = mergeWorldbook(old, rules).book;
    assert.equal(moduleStates(merged).find(m => m.name === '神豪挥霍').on, true);
});

test('强力模块: applyModules only flips disable of the listed entries', () => {
    const rules = latestRules(original.ZhuTianBuiltinRules).rules;
    const book = { entries: Object.fromEntries(rules.map((r, i) => [i, r])) };
    const r = applyModules(book, { '08｜核心｜神豪挥霍': true, '13｜外挂｜诸天打手': false });
    assert.equal(r.changed, 1);
    const st = moduleStates(r.book); assert.equal(st[0].on, true); assert.equal(st[1].on, false);
    assert.equal(JSON.stringify(Object.values(r.book.entries).map(e => e.content)), JSON.stringify(rules.map(e => e.content)), 'content untouched');
    const missing = moduleStates({ entries: {} }); assert.ok(missing.every(m => m.exists === false && m.on === null));
});

test('强力模块: off modules are hidden in the engine (神豪 card, 打手) and listed as 未装载 in the prompt', () => {
    const src = read('src/hub-plugins.js');
    assert.match(src, /\.shenhao-card/);
    assert.match(src, /pluginPrompt\(this\.enabled\(\)\.filter\(p => p\.inject\), \[\.\.\.new Set\(\[\.\.\.st\.off, \.\.\.this\.modOff\]\)\]\)/);
    assert.match(read('vendor/original/statusbar-v3.1-shell.html'), /class="mvu-card shenhao-card"/);
});

// ---------- palettes ----------
test('palettes: 7 fixed schemes + auto; CSS for terminal, engine and outside 演出 cards', () => {
    assert.equal(Object.keys(PALETTES).length, 7);
    assert.equal(PALETTE_OPTIONS[0][0], 'auto'); assert.equal(isPalette('auto'), false); assert.equal(isPalette('sakura'), true);
    const sh = shellCss(), en = engineCss(), fx = fxCss();
    for (const id of Object.keys(PALETTES)) {
        assert.match(sh, new RegExp(`:host\\(\\[data-zt-palette=${id}\\]\\[data-zt-world\\]\\)\\{--accent:`));
        assert.match(en, new RegExp(`html\\[data-zt-hub\\]\\[data-zt-palette=${id}\\]\\[data-zt-palette\\] \\.mvu-sys\\{--bg:`));
        assert.match(fx, new RegExp(`:host\\(\\[data-zt-palette=${id}\\]\\)\\{--fx-a:`));
    }
    for (const p of Object.values(PALETTES)) for (const k of ['win', 'side', 'surface', 'input', 'ink', 'muted', 'accent', 'accent2']) assert.match(p[k], /^#[0-9a-f]{6}$/);
});

test('palettes: 仙侠 world is no longer mint green (墨玉金); default world + palette uses the variable surfaces', () => {
    const css = read('styles/world.css');
    assert.doesNotMatch(css, /8fd6b2/); assert.match(css, /:host\(\[data-zt-world=xianxia\]\)\{--accent:#d4b46c/);
    assert.doesNotMatch(read('src/hub.js'), /8fd6b2/);
    const w = read('src/world.js');
    assert.match(w, /attrWorld\(\) \{ return this\.palette\(\) && this\.theme === 'default' \? 'plain' : this\.theme; \}/);
    assert.match(css, /:host\(\[data-zt-world\]:not\(\[data-zt-world=default\]\)\) #lc-panel/, 'the private chat panel follows the palette too');
});

// ---------- beautification compatibility ----------
test('beautifications: renderer passes SillyTavern\'s own render as reference so foreign nodes survive', async () => {
    const src = read('src/statusbar-host.js');
    assert.match(src, /swapContent\(text, box, ref[,)]/);   // 0.9.2 adds a 4th argument
    assert.match(src, /swapContent\(text, box, box\.cloneNode\(true\)\)/);
    const { lcsPairs } = await import('../src/statusbar-host.js');
    assert.deepEqual(lcsPairs(['a', 'b', 'c', 'd'], ['a', 'x', 'c', 'd']), [[0, 0], [2, 2], [3, 3]]);
    assert.deepEqual(lcsPairs([], ['a']), []);
});

test('version ≥ 0.8.4 and consistent everywhere (exact value pinned in the newest version test)', () => {
    const v = JSON.parse(read('manifest.json')).version;
    assert.match(v, /^(?:0\.8\.[4-9]|0\.(?:9|\d{2,})\.\d+|[1-9]\d*\.\d+\.\d+)$/);
    assert.equal(JSON.parse(read('package.json')).version, v);
    const lock = JSON.parse(read('package-lock.json')); assert.equal(lock.version, v); assert.equal(lock.packages[''].version, v);
    assert.match(read('src/contracts.js'), new RegExp(`VERSION = '${v.replace(/\./g, '\\.')}'`));
});

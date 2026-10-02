// 0.8.5: AI 接口设置排版与用词、账本核验引导、生成状态自愈（手机状态栏不渲染）、版本号。
// DOM behaviour (form layout, highlight, real floor render) is covered in the browser by tests/native_v085.py.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { HostAdapter, stopButtonShown } from '../src/host-adapter.js';
import { CAPABILITIES, VERSION } from '../src/contracts.js';

const read = f => readFileSync(new URL('../' + f, import.meta.url), 'utf8');

// ---------- 生成状态自愈 ----------
const fakeDoc = stop => ({ getElementById: id => (id === 'mes_stop' ? stop : null) });
test('stopButtonShown: missing element counts as visible; a stop button without boxes is hidden', () => {
    assert.equal(stopButtonShown(fakeDoc(null)), true);
    assert.equal(stopButtonShown(fakeDoc({ getClientRects: () => [] })), false);
    assert.equal(stopButtonShown(null), true);
});

test('isGenerating: stop button seen, then hidden without GENERATION_ENDED → the stale flag clears itself', () => {
    const prev = globalThis.document; let notified = 0, shown = true;
    globalThis.document = fakeDoc({ getClientRects: () => (shown ? [{}] : []) });
    globalThis.getComputedStyle ??= () => ({ display: 'flex' });
    const P = HostAdapter.prototype;
    const mk = o => Object.assign(Object.create(P), { generating: true, sawStop: false, notify: () => notified++, host: { isSendPress: () => false } }, o);
    try {
        const a = mk();
        assert.equal(a.isGenerating(), true, 'button visible → generating'); assert.equal(a.sawStop, true);
        shown = false;
        assert.equal(a.isGenerating(), false, 'button gone, end event lost → no longer generating');
        assert.equal(a.generating, false); assert.equal(notified, 1);
        // GENERATION_STARTED fires before SillyTavern shows the button / sets is_send_press; quiet generations never show it:
        // a button that was never seen must not unlock anything (native_guards relies on this)
        const b = mk(); shown = false;
        assert.equal(b.isGenerating(), true); assert.equal(b.generating, true);
        // button seen, hidden, but the host still reports a send in progress → keep the flag
        const c = mk({ sawStop: true, host: { isSendPress: () => true } });
        assert.equal(c.isGenerating(), true); assert.equal(c.generating, true);
    } finally { globalThis.document = prev; }
});

test('adapter watches #mes_stop and resets the "seen" mark on every GENERATION_STARTED', () => {
    const h = read('src/host-adapter.js');
    assert.match(h, /on\('GENERATION_STARTED',\(type,opts,dry\)=>\{if\(!dry\)\{this\.generating=true;this\.sawStop=false;/);
    assert.match(h, /new MutationObserver\(\(\)=>this\.checkStop\(\)\)/);
});

test('status bar: the last floor is skipped only while the stop button is visible; its hiding triggers a rescan', () => {
    const sb = read('src/statusbar-host.js');
    assert.match(sb, /const generating = this\.adapter\.isGenerating\(\) && \(!stop \|\| \(stop\.getClientRects\(\)\.length > 0/);
    assert.match(sb, /mo\.observe\(stop, \{ attributes: true, attributeFilter: \['style', 'class', 'hidden'\] \}\)/);
    assert.match(sb, /diagnoseLast\(\) \{/);
    const f = read('src/features.js');
    assert.match(f, /最新楼层：/); assert.match(f, /data-diag="rerender">重新渲染楼层</);
});

// ---------- AI 接口设置 ----------
test('API form: plain wording, three steps, advanced section; radios/checkboxes are not stretched', () => {
    const s = read('src/api-center.js');
    for (const t of ['连接 · AI 接口设置', '还没有设置 API', '选择用哪个 AI', '单独的 API（推荐）', '直接用酒馆正在用的模型', '填写接口', '测试并保存', '高级设置（一般不用改）', '两处用的 API 不一致'])
        assert.ok(s.includes(t), t);
    assert.doesNotMatch(s, /应用到状态栏|应用到莉莉丝助手/, 'the old 应用到… boxes are gone from the main form');
    assert.match(s, /const tick = 'style="width:auto;min-width:0;flex:none/);
    assert.equal((s.match(/\$\{tick\}/g) || []).length, 3, 'two radios + … via opt() and two checkboxes');
    // hooks other suites rely on stay
    for (const h of ['data-act="models"', 'data-act="test"', 'data-act="save"', 'name="toStatus"', 'name="toAssistant"', 'data-out', 'data-custom', 'value="close"'])
        assert.ok(s.includes(h), h);
});

// ---------- 账本核验引导 ----------
test('ledger check: hint under the button, capture-phase guard, original message rewritten, original code untouched', () => {
    const h = read('src/assistant-host.js');
    assert.match(h, /guideLedgerCheck\(\) \{/);
    assert.match(h, /btn\.addEventListener\('click', ev => \{[\s\S]*?ev\.stopImmediatePropagation\(\)[\s\S]*?\}, true\)/);
    for (const t of ['在当前聊天启用助手与记忆注入', '莉莉丝监管账本与奖励', '保存当前聊天设置', '什么都没有写入'])
        assert.ok(h.includes(t), t);
    const rt = read('vendor/original/assistant-runtime.js');
    assert.ok(rt.includes("throw Error('请先启用当前聊天与账本核验；未写入。')"), 'original check is still there (we only rewrite its message)');
});

// ---------- 能力表 / 版本 ----------
test('capabilities list the 0.8.5 rows', () => {
    for (const n of ['AI 接口设置（新手版排版）', '账本核验引导', '生成状态自愈（手机状态栏不渲染修复）'])
        assert.ok(CAPABILITIES.some(c => c.name === n && c.state === 'implemented'), n);
});

test('version ≥ 0.8.5 and consistent everywhere (exact value pinned in the newest version test)', () => {
    const v = VERSION;
    assert.match(v, /^(?:0\.8\.[5-9]|0\.(?:9|\d{2,})\.\d+|[1-9]\d*\.\d+\.\d+)$/);
    assert.equal(JSON.parse(read('manifest.json')).version, v);
    assert.equal(JSON.parse(read('package.json')).version, v);
    const lock = JSON.parse(read('package-lock.json')); assert.equal(lock.version, v); assert.equal(lock.packages[''].version, v);
});

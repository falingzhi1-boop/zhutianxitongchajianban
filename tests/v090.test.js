// 0.9.0: 手机端适配 — layout choice, visible-area numbers, Lilith's waiting spot, the desktop window box that a phone
// session must not overwrite, the bridge filter hook, CSS / settings presence and the version.
// Real layout (full screen, keyboard, landscape rail, 私聊 sheet) is covered in the browser by tests/native_v090.py.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { phoneLayout, viewportBox, keepWindowBox, MOBILE_LAYOUTS } from '../src/mobile.js';
import { parkSpot } from '../src/lilith-float.js';
import { Bridge } from '../src/th-bridge.js';
import { Settings } from '../src/settings.js';
import { CAPABILITIES, VERSION } from '../src/contracts.js';

const read = f => readFileSync(new URL('../' + f, import.meta.url), 'utf8');

// ---------- which layout ----------
test('phoneLayout: phones get full screen (portrait / landscape), desktops and 浮动窗口 keep the window', () => {
    assert.equal(phoneLayout('auto', { w: 390, h: 844, coarse: true }), 'port');
    assert.equal(phoneLayout('auto', { w: 844, h: 390, coarse: true }), 'land');
    assert.equal(phoneLayout('auto', { w: 360, h: 640 }), 'port', 'narrow window without touch info still counts');
    assert.equal(phoneLayout('auto', { w: 1400, h: 900 }), '');
    assert.equal(phoneLayout('auto', { w: 1024, h: 768, coarse: true }), '', 'tablets keep the floating window');
    assert.equal(phoneLayout('window', { w: 390, h: 844, coarse: true }), '');
    assert.equal(phoneLayout('full', { w: 1400, h: 900 }), 'port', '总是全屏 also on a desktop');
    assert.equal(phoneLayout('full', { w: 1400, h: 500 }), 'land');
    assert.equal(phoneLayout(undefined, { w: 390, h: 844 }), 'port', 'unknown value behaves like auto');
});

test('MOBILE_LAYOUTS: the three setting values, auto first', () => {
    assert.deepEqual(MOBILE_LAYOUTS.map(o => o[0]), ['auto', 'full', 'window']);
    assert.ok(Object.isFrozen(MOBILE_LAYOUTS));
});

// ---------- visible area / keyboard ----------
test('viewportBox: keyboard height = layout height − visible height − offset; no visualViewport → the window', () => {
    assert.deepEqual(viewportBox(null, 390, 844), { w: 390, h: 844, top: 0, left: 0, kb: 0 });
    assert.deepEqual(viewportBox({ width: 390, height: 470, offsetTop: 0, offsetLeft: 0 }, 390, 844), { w: 390, h: 470, top: 0, left: 0, kb: 374 });
    assert.deepEqual(viewportBox({ width: 390.4, height: 500.6, offsetTop: 40.2, offsetLeft: -3 }, 390, 844), { w: 390, h: 501, top: 40, left: 0, kb: 303 });
    assert.equal(viewportBox({ width: 390, height: 900, offsetTop: 0 }, 390, 844).kb, 0, 'never negative');
});

// ---------- Lilith while the terminal is full screen ----------
test('parkSpot: bottom corner of her own side; landscape forces the right side (rail on the left)', () => {
    const dims = { w: 76, h: 104 };
    const left = parkSpot({ x: 20, y: 300, edge: '' }, 390, 844, dims);
    assert.equal(left.edge, 'left'); assert.equal(left.tucked, true); assert.equal(left.y, 844 - 104 - 64);
    const right = parkSpot({ x: 300, y: 300, edge: '' }, 390, 844, dims);
    assert.equal(right.edge, 'right');
    assert.equal(parkSpot({ x: 0, y: 0, edge: 'right' }, 390, 844, dims).edge, 'right', 'an edge she was tucked at wins');
    assert.equal(parkSpot({ x: 20, y: 100, edge: 'left' }, 844, 390, dims, 'right').edge, 'right');
    assert.ok(parkSpot(null, 390, 844, dims).y > 0);
});

// ---------- the desktop window box ----------
test('keepWindowBox: *_UI.window keeps the previous box (or none); other keys and fields pass through untouched', () => {
    const prev = { NS_UI: { window: { x: 120, y: 60, w: 1000, h: 720 }, tab: 'api' }, other: 1 };
    const next = { NS_UI: { window: { x: 0, y: 0, w: 390, h: 844 }, tab: 'work', launcher: { x: 5, y: 6 } }, other: 2 };
    const out = keepWindowBox(next, prev);
    assert.deepEqual(out.NS_UI, { window: { x: 120, y: 60, w: 1000, h: 720 }, tab: 'work', launcher: { x: 5, y: 6 } });
    assert.equal(out.other, 2);
    assert.deepEqual(next.NS_UI.window, { x: 0, y: 0, w: 390, h: 844 }, 'input not mutated');
    assert.notEqual(out.NS_UI.window, prev.NS_UI.window, 'a copy, not the stored object');
    assert.equal('window' in keepWindowBox({ A_UI: { window: { w: 1 } } }, {}).A_UI, false, 'no earlier box → none is stored');
    const plain = { k: { window: { w: 1 } } };
    assert.equal(keepWindowBox(plain, {}), plain, 'keys not ending in _UI: same object back');
});

test('Bridge.addScriptFilter: filters see (next, prev), can replace the write, are removable, a throwing one is skipped', async () => {
    const store = {}; const settings = new Settings({ context: () => ({ extensionSettings: store, saveSettingsDebounced() {} }) });
    settings.setScriptVariables({ X_UI: { window: { w: 1000 } } });
    const b = new Bridge({ context: () => ({}) }, settings);
    const seen = [];
    const off = b.addScriptFilter((next, prev) => { seen.push([next.X_UI.window.w, prev.X_UI.window.w]); return keepWindowBox(next, prev); });
    b.addScriptFilter(() => { throw Error('boom'); });
    const warn = console.warn; console.warn = () => {};
    try {
        await b.updateVariablesWith(v => { v.X_UI = { ...v.X_UI, window: { w: 390 }, tab: 'work' }; return v; }, { type: 'script' });
        assert.deepEqual(seen, [[390, 1000]]);
        assert.deepEqual(settings.scriptVariables().X_UI, { window: { w: 1000 }, tab: 'work' });
        off();
        await b.updateVariablesWith(v => { v.X_UI = { ...v.X_UI, window: { w: 500 } }; return v; }, { type: 'script' });
        assert.equal(settings.scriptVariables().X_UI.window.w, 500, 'filter removed → normal write');
    } finally { console.warn = warn; }
});

// ---------- wiring / CSS / settings ----------
test('settings: mobileLayout defaults to auto and the settings page offers it', () => {
    const store = {}; const s = new Settings({ context: () => ({ extensionSettings: store, saveSettingsDebounced() {} }) });
    assert.equal(s.get('mobileLayout'), 'auto');
    assert.match(read('src/hub-settings.js'), /sel\('mobileLayout', '手机上的终端与私聊窗口', MOBILE_LAYOUTS/);
});

test('index.js starts the phone layout after the terminal and before floating Lilith, and disposes it', () => {
    const t = read('index.js');
    assert.match(t, /import ?\{ ?MobileLayout ?\} ?from '\.\/src\/mobile\.js'/);
    const m = t.indexOf('new MobileLayout(this)'), f = t.indexOf('new LilithFloat(');
    assert.ok(m > t.indexOf('new Hub(') && m > 0 && (f < 0 || m < f));
    assert.match(t, /this\.parts\.push\(this\.mobile\)/);
});

test('hub.css: full-screen rules keyed on data-zt-mobile, keyboard, landscape rail, 私聊 sheet, 16 px fields', () => {
    const css = read('styles/hub.css');
    for (const s of ['dialog[data-zt-mobile]{', 'var(--zt-vvh', 'env(safe-area-inset-top', 'dialog[data-zt-mobile][data-zt-kb] .zt-hub-top',
        'dialog[data-zt-mobile=land] .shell', ':host([data-zt-mobile]) #lc-panel:not([hidden])', ':host([data-zt-mobile]) #lc-panel #lc-grip',
        'dialog[data-zt-mobile] .drag-hint', '@media (pointer:coarse)'])
        assert.ok(css.includes(s), s);
    assert.match(read('src/hub.js'), /pointer: ?coarse/);
});

test('package.json check covers the modules that were missing and the new one', () => {
    const check = JSON.parse(read('package.json')).scripts.check;
    for (const f of ['src/mobile.js', 'src/lilith-float.js', 'src/wb-unbind.js', 'src/worldbook.js']) assert.ok(check.includes(f), f);
});

// ---------- capability row / version ----------
test('capabilities list 手机端适配 and say it is not tested on real phones', () => {
    const c = CAPABILITIES.find(r => r.name === '手机端适配');
    assert.ok(c && c.state === 'implemented'); assert.match(c.scope, /未在真机上测试/);
});

test('version ≥ 0.9.0 and consistent everywhere (exact value pinned in tests/version.test.js)', () => {
    const v = VERSION;
    assert.match(v, /^(?:0\.9\.\d+|0\.(?:[1-9]\d+)\.\d+|[1-9]\d*\.\d+\.\d+)$/);
    assert.equal(JSON.parse(read('manifest.json')).version, v);
    assert.equal(JSON.parse(read('package.json')).version, v);
    const lock = JSON.parse(read('package-lock.json')); assert.equal(lock.version, v); assert.equal(lock.packages[''].version, v);
    assert.ok(read('docs/CHANGES-0.9.0.md').includes('0.9.0'));
});

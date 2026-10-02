// 0.8.3: floating Lilith size setting; tapping her while the terminal is open talks instead of closing the terminal.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LilithFloat, FLOAT_SIZES, floatDims, settle } from '../src/lilith-float.js';
import { VERSION, CAPABILITIES } from '../src/contracts.js';

const read = f => readFileSync(new URL('../' + f, import.meta.url), 'utf8');

test('size presets: default 75 % of the 0.8.2 portrait, xl = old size, touch target never below 24 px', () => {
    assert.deepEqual(Object.keys(FLOAT_SIZES), ['xs', 's', 'm', 'l', 'xl']);
    assert.deepEqual(floatDims(undefined), floatDims('m'));
    assert.deepEqual(floatDims('m'), { w: 59, h: 78, peek: 24, k: 0.75 });
    assert.deepEqual(floatDims('xl'), { w: 78, h: 104, peek: 30, k: 1 });
    assert.equal(floatDims('bogus').w, 59);
    for (const k of Object.keys(FLOAT_SIZES)) { const d = floatDims(k); assert.ok(d.peek >= 24, k); assert.ok(Math.abs(d.h / d.w - 104 / 78) < 0.05, 'same proportions ' + k); }
});

test('edge tucking uses the actual size (small portrait near the right edge tucks right)', () => {
    const { w, h } = floatDims('xs');
    assert.equal(settle({ x: 390 - w - 10, y: 300 }, 390, 844, w, h).edge, 'right');
    assert.equal(settle({ x: 390 - w - 40, y: 300 }, 390, 844, w, h).tucked, false);
});

function fake({ open, tucked = true, temp = true }) {
    const calls = [];
    const f = Object.create(LilithFloat.prototype);
    Object.assign(f, {
        app: { hub: { isOpen: open }, openTerminal: () => calls.push('open') },
        cur: { x: 0, y: 300, edge: 'left', tucked }, tempTuck: temp, dims: floatDims('m'), lineIdx: 0,
        storyLine: () => ({ zone: 'chest', text: '剧情台词' }),
        say: t => calls.push('say:' + t), place: (p, save) => calls.push('place:' + (p.tucked ? 'tucked' : 'out') + (save ? ':save' : '')),
    });
    return { f, calls };
}

test('terminal open: a tap only talks — no move, no open, no close (also when she was hidden by the user)', () => {
    for (const temp of [true, false]) {
        const { f, calls } = fake({ open: true, temp });
        f.tap();
        assert.deepEqual(calls, ['say:剧情台词'], 'tempTuck=' + temp);
    }
});

test('terminal closed: tap the peek → she comes out (saved); tap again → opens the terminal', () => {
    const { f, calls } = fake({ open: false, temp: false });
    f.tap();
    assert.deepEqual(calls, ['place:out:save', 'say:被你发现了～']);
    const b = fake({ open: false, tucked: false, temp: false }); b.f.tap();
    assert.deepEqual(b.calls, ['open']);
});

test('terminal outside-tap rule ignores the floating Lilith (that tap used to close the terminal on phones)', () => {
    const hub = read('src/hub.js');
    assert.match(hub, /n\?\.id === 'zhutian-lilith-float'/);
    const lf = read('src/lilith-float.js');
    assert.match(lf, /host\.id = 'zhutian-lilith-float'/);
});

test('setting floatSize: default m, offered in 设置 → 莉莉丝, applied live', () => {
    assert.match(read('src/settings.js'), /floatSize: 'm'/);
    assert.match(read('src/hub-settings.js'), /sel\('floatSize'/);
    assert.match(read('src/lilith-float.js'), /k === 'floatSize'\) \{ this\.applySize\(\)/);
});

test('version ≥ 0.8.3 and the floating Lilith capability row mentions it', () => {
    assert.match(VERSION, /^(?:0\.8\.[3-9]|0\.(?:9|\d{2,})\.\d+|[1-9]\d*\.\d+\.\d+)$/);
    assert.ok(CAPABILITIES.some(c => c.name.includes('悬浮莉莉丝') && c.scope.includes('0.8.3')));
});

test('a saved "out" spot near the edge stays out (was: re-tucked after every terminal close / reload)', async () => {
    const { keepOnScreen } = await import('../src/lilith-float.js');
    const { w, h } = floatDims('m');
    assert.deepEqual(keepOnScreen({ x: 8, y: 420 }, 390, 844, w, h), { x: 8, y: 420, edge: '', tucked: false });
    assert.equal(keepOnScreen({ x: 500, y: 2000 }, 390, 844, w, h).x, 390 - w - 4);
    assert.equal(settle({ x: 8, y: 420 }, 390, 844, w, h).tucked, true, 'a DROP near the edge still tucks');
});

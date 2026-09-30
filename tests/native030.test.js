// 0.3.0 unit tests: host-version gate (1.16–1.19), settings persistence, the Tavern-Helper-shaped SillyTavern
// context, Live2D helpers, AI variant manifest and the layered PSD encoder. Pure functions only; the real-host
// browser checks live in docs/ACCEPTANCE-0.3.0.md.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { parseVersion, compareVersion, hostSupport, hooksSupported, HOST_MIN, HOST_TESTED } from '../src/compat.js';
import { fillDefaults } from '../src/settings.js';
import { stContextProxy } from '../src/assistant-host.js';
import { MOODS, VARIANTS, POSES, pickExpression, fitModel } from '../src/portrait.js';
import { encodePsd } from '../src/psd-export.js';
import { VERSION } from '../src/contracts.js';

const root = new URL('../', import.meta.url);
const json = p => JSON.parse(readFileSync(new URL(p, root), 'utf8'));

test('version gate: 1.16.0 minimum, 1.16–1.19 tested, hooks only from 1.17', () => {
    assert.equal(HOST_MIN, '1.16.0');
    assert.deepEqual([...HOST_TESTED], ['1.16.0', '1.17.0', '1.18.0', '1.19.0']);
    for (const v of HOST_TESTED) { const s = hostSupport(v); assert.equal(s.ok, true); assert.equal(s.tested, true); assert.equal(s.level, 'supported'); }
    assert.equal(hostSupport('1.15.9').ok, false);
    assert.equal(hostSupport('1.15.9').level, 'too-old');
    assert.equal(hostSupport('1.17.2').tested, false);            // same minor line: supported by capability probing
    assert.equal(hostSupport('1.17.2').level, 'supported');
    assert.equal(hostSupport('1.20.0').level, 'newer');
    assert.equal(hostSupport('').ok, false);
    assert.equal(hooksSupported('1.16.0'), false);
    assert.equal(hooksSupported('1.17.0'), true);
    assert.deepEqual(parseVersion('1.19.0 \'HEAD\''), [1, 19, 0]);
    assert.equal(compareVersion('1.9.0', '1.16.0'), -1);
});

test('settings: defaults are filled in place so nested patches are never lost', () => {
    const store = { portrait: { mode: 'variants' }, custom: 1 };
    const same = fillDefaults(store, { portrait: { mode: 'rig', variant: 'default', autoMood: true }, hud: true, live2d: { moodMap: {} } });
    assert.equal(same, store);                                     // identity kept (the 0.3.0-dev bug swapped in a clone)
    assert.equal(store.portrait.mode, 'variants');                 // user value kept
    assert.equal(store.portrait.variant, 'default');               // missing nested key added
    assert.equal(store.hud, true);
    assert.equal(store.custom, 1);
    const d = { live2d: { moodMap: {} } }, a = fillDefaults({}, d), b = fillDefaults({}, d);
    a.live2d.moodMap.x = 1; assert.equal(b.live2d.moodMap.x, undefined);   // defaults are cloned, not shared
    assert.equal(d.live2d.moodMap.x, undefined);
});

test('SillyTavern shim: behaves like the Tavern Helper iframe global (context, always fresh)', () => {
    let chat = 'a.jsonl';
    const ctx = () => ({ name1: '宿主', groupId: null, getCurrentChatId() { return chat; } });
    const st = stContextProxy(ctx);
    assert.equal(typeof st.getCurrentChatId, 'function');
    assert.equal(st.getCurrentChatId(), 'a.jsonl');
    chat = 'b.jsonl';
    assert.equal(st.getCurrentChatId(), 'b.jsonl');                // never a stale snapshot
    assert.equal(st.name1, '宿主');
    assert.equal(st.groupId, null);
    assert.equal(typeof st.getContext, 'function');
    assert.equal(st.getContext().name1, '宿主');
    assert.ok('getCurrentChatId' in st);
});

test('Live2D helpers: expression picking and height-fit without blank bands', () => {
    assert.equal(pickExpression('smile', ['Normal', 'Smile', 'Sad']), 'Smile');
    assert.equal(pickExpression('shy', ['f00', 'f01'], { shy: 'f01' }), 'f01');
    assert.equal(pickExpression('shy', ['f00'], { shy: 'missing' }), null);
    assert.equal(pickExpression('smile', ['f00', 'f01']), 'f01');  // official sample convention f00–f07
    assert.equal(pickExpression('wink', ['f00', 'f01', 'f07']), null);
    assert.equal(pickExpression('smile', ['exp_a', 'exp_b']), null); // opaque names: user maps them in the mood table
    const f = fitModel({ width: 300, height: 450 }, { width: 1000, height: 1500 });
    assert.equal(f.scale, 0.3);
    assert.equal(f.y + 1500 * f.scale, 450);                       // bottom-anchored, fills the height
    assert.equal(f.x + 500 * f.scale, 150);                        // centred
    const g = fitModel({ width: 300, height: 450 }, { width: 1000, height: 1500 }, { scale: 2, x: 0.1 });
    assert.equal(g.scale, 0.6); assert.ok(Math.abs(g.x - (150 - 300 + 30)) < 1e-9);
});

test('AI variants: every mood has a shipped 424×632 frame; poses are declared honestly', () => {
    assert.deepEqual(VARIANTS.map(v => v.mood), MOODS);
    for (const v of VARIANTS) {
        const p = new URL('assets/lilith/variants/' + v.file, root);
        assert.ok(existsSync(p), v.file); assert.ok(statSync(p).size > 10_000, v.file);
        const b = readFileSync(p); assert.equal(b.toString('ascii', 0, 4), 'RIFF'); assert.equal(b.toString('ascii', 8, 12), 'WEBP');
    }
    for (const pose of POSES) assert.equal(existsSync(new URL('assets/lilith/variants/' + pose.file, root)), !pose.pending, pose.id);
    assert.ok(readFileSync(new URL('assets/lilith/variants/PROVENANCE.md', root), 'utf8').includes('AI'));
});

test('PSD encoder: valid header, layer count, Unicode names, composite', async () => {
    const W = 4, H = 3, px = (r, g, b, a, n) => { const o = new Uint8ClampedArray(n * 4); for (let i = 0; i < n; i++) o.set([r, g, b, a], i * 4); return o; };
    const layers = [
        { name: '背景（静止）', left: 0, top: 0, right: 4, bottom: 3, pixels: px(10, 20, 30, 255, 12) },
        { name: '表情_smile', left: 1, top: 1, right: 3, bottom: 2, pixels: px(200, 100, 50, 255, 2), hidden: true },
    ];
    const buf = new Uint8Array(await encodePsd(W, H, layers, px(10, 20, 30, 255, 12)).arrayBuffer());
    const dv = new DataView(buf.buffer);
    assert.equal(new TextDecoder().decode(buf.slice(0, 4)), '8BPS');
    assert.equal(dv.getUint16(4), 1); assert.equal(dv.getUint16(12), 4);
    assert.equal(dv.getUint32(14), H); assert.equal(dv.getUint32(18), W);
    assert.equal(dv.getUint16(22), 8); assert.equal(dv.getUint16(24), 3);
    const lmLen = dv.getUint32(34), liLen = dv.getUint32(38);
    assert.equal(lmLen, liLen + 8);
    assert.equal(dv.getInt16(42), -2);
    const text = new TextDecoder('utf-16be').decode(buf);
    assert.ok(text.includes('背景（静止）')); assert.ok(text.includes('表情_smile'));
    // composite = header 26 + 4 + 4 + (4 + lmLen) + compression(2) + 4 planes
    assert.equal(buf.length, 26 + 4 + 4 + 4 + lmLen + 2 + W * H * 4);
});

test('version is consistent across manifest, package.json, package-lock and contracts', () => {
    const m = json('manifest.json'), p = json('package.json'), l = json('package-lock.json');
    assert.equal(VERSION, '0.4.0');
    assert.equal(m.version, VERSION); assert.equal(p.version, VERSION); assert.equal(l.version, VERSION); assert.equal(l.packages[''].version, VERSION);
    assert.equal(m.minimum_client_version, HOST_MIN);
    assert.ok(readFileSync(new URL('docs/CHANGES-0.4.0.md', root), 'utf8').includes('0.4.0'));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { Bridge } from '../src/th-bridge.js';
import { Hub } from '../src/hub.js';
import { StatusBarHost } from '../src/statusbar-host.js';
import { identity } from '../src/contracts.js';

function fixture() {
    const make = (id, points) => ({ characterId: 0, characters: [{ avatar: 'qa.png' }], getCurrentChatId: () => id,
        chat: [{ mes: id }], chatMetadata: { variables: { 诸天系统: { 系统点: points, 背包: [] } } },
        extensionSettings: { variables: { global: {} } }, saveSettingsDebounced() {} });
    const a = make('a', 1000), b = make('b', 2000), subscribers = new Set(); let current = a, saves = 0;
    a.saveMetadata = b.saveMetadata = async () => { saves++; };
    const adapter = { context: () => current, currentIdentity: () => identity(current), isGenerating: () => false,
        notify: () => { for (const fn of subscribers) fn(); }, subscribe: fn => { subscribers.add(fn); return () => subscribers.delete(fn); } };
    const old = Object.fromEntries(['isSecureContext', 'navigator'].map(k => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
    Object.defineProperty(globalThis, 'isSecureContext', { value: true, configurable: true });
    Object.defineProperty(globalThis, 'navigator', { value: { locks: { request: async (_n, _o, fn) => fn() } }, configurable: true });
    const bridge = new Bridge(adapter, { scriptVariables: () => ({}), setScriptVariables() {} }), api = bridge.frameApi(() => 0);
    return { a, b, adapter, bridge, api, subscribers, get saves() { return saves; },
        switch(c = b, notify = true) { current = c; if (notify) adapter.notify(); },
        restore() { api.dispose?.(); bridge.dispose(); for (const [k, d] of Object.entries(old)) d ? Object.defineProperty(globalThis, k, d) : delete globalThis[k]; } };
}
const debit = v => { v.诸天系统.系统点 -= 100; return v; };

for (const method of ['updateVariablesWith', 'replaceVariables', 'insertOrAssignVariables']) test(`retired frame rejects ${method} without touching either chat`, async () => {
    const f = fixture(); try {
        f.switch(); const arg = method === 'updateVariablesWith' ? debit : { 诸天系统: { 系统点: 900 } };
        await assert.rejects(async () => f.api[method](arg, { expectedIdentity: identity(f.b), frameGuard: () => {} }), /失效|切换/);
        assert.equal(f.a.chatMetadata.variables.诸天系统.系统点, 1000); assert.equal(f.b.chatMetadata.variables.诸天系统.系统点, 2000); assert.equal(f.saves, 0);
    } finally { f.restore(); }
});
test('stale reads and floor queries fail, even before the chat-change notification', () => {
    const f = fixture(); try { f.switch(f.b, false);
        for (const run of [() => f.api.getVariables(), () => f.api.getCurrentMessageId(), () => f.api.getLastMessageId()]) assert.throws(run, /失效|切换/);
        f.switch(f.a); assert.throws(() => f.api.getVariables(), /失效|切换/);
    } finally { f.restore(); }
});
test('A to B to A cannot revive an old frame', () => {
    const f = fixture(); try { f.switch(); f.switch(f.a); assert.throws(() => f.api.getVariables(), /失效|切换/); assert.equal(f.subscribers.size, 0); }
    finally { f.restore(); }
});
for (const key of ['chat', 'chatMetadata']) test(`same identity with replaced ${key} retires the frame`, () => {
    const f = fixture(); try { f.a[key] = structuredClone(f.a[key]); f.adapter.notify(); assert.throws(() => f.api.getVariables(), /失效|切换/); }
    finally { f.restore(); }
});
test('frame disposed while waiting for the lock never calls the updater', async () => {
    const f = fixture(); try { let calls = 0; navigator.locks.request = async (_n, _o, fn) => { f.api.dispose(); return fn(); };
        await assert.rejects(() => f.api.updateVariablesWith(v => { calls++; return debit(v); }), /失效|切换/); assert.equal(calls, 0); assert.equal(f.saves, 0);
    } finally { f.restore(); }
});
for (const type of ['chat', 'global', 'script']) test(`dispose during async ${type} updater rejects before committing`, async () => {
    const f = fixture(); try { let release; const pending = f.api.updateVariablesWith(async v => { await new Promise(r => release = r); v.changed = true; return v; }, { type });
        while (!release) await Promise.resolve(); f.api.dispose(); release(); await assert.rejects(pending, /失效|切换/); assert.equal(f.saves, 0);
        assert.equal(f.bridge.getVariables({ type }).changed, undefined);
    } finally { f.restore(); }
});
for (const method of ['generateRaw', 'listModels']) test(`delayed ${method} result is discarded after chat switch`, async () => {
    const f = fixture(); try { let release; f.bridge[method] = () => new Promise(r => release = r);
        const pending = f.api[method]({}); f.switch(); release('old result'); await assert.rejects(pending, /失效|切换/);
    } finally { f.restore(); }
});
test('release revokes an already copied API and removes its listener', () => {
    const f = fixture(); try { const frame = {}, host = new StatusBarHost(f.adapter, f.bridge, {}, ''); host.registry = { frames: new Map([['token', f.api]]) }; host.frames.set(frame, 'token');
        host.release(frame); host.release(frame); assert.equal(host.frames.size, 0); assert.equal(host.registry.frames.size, 0); assert.equal(f.subscribers.size, 0);
        assert.throws(() => f.api.getVariables(), /失效|切换/);
    } finally { f.restore(); }
});
test('unchanged chat supports all existing frame writes and floor queries', async () => {
    const f = fixture(); try { assert.equal(f.api.getCurrentMessageId(), 0); assert.equal(f.api.getLastMessageId(), 0);
        await f.api.updateVariablesWith(debit); await f.api.replaceVariables({ 诸天系统: { 系统点: 800, 背包: [] } }); await f.api.insertOrAssignVariables({ note: 'ok' });
        assert.equal(f.api.getVariables().诸天系统.系统点, 800); assert.equal(f.api.getVariables().note, 'ok'); assert.equal(f.saves, 3);
        assert.equal(Object.keys(f.api).includes('dispose'), false); assert.equal(Object.keys(f.api).includes('isCurrent'), false);
    } finally { f.restore(); }
});
function hubFixture(f) {
    const frame = { isConnected: true, classList: { add() {} }, addEventListener() {}, contentDocument: { querySelector: () => ({}) }, remove() { this.isConnected = false; } };
    const sb = new StatusBarHost(f.adapter, f.bridge, {}, ''); sb.template = 'ready'; sb.registry = { frames: new Map([['old', f.api]]) }; sb.frames.set(frame, 'old'); sb.latestPanel = () => ({ id: 0, panel: 'panel' });
    sb.frame = () => { throw Error('new frame requested'); }; const hub = new Hub({ adapter: f.adapter, statusbar: sb }); hub.engineFrame = frame;
    hub.shadow = { getElementById: () => ({ querySelector() {}, append() {} }) }; hub.scheduleEngine = () => {};
    return { hub, frame };
}
for (const generating of [false, true]) test(`busy terminal is dropped on chat switch, generating=${generating}`, () => {
    const f = fixture(); try { const { hub, frame } = hubFixture(f); f.switch(); f.adapter.isGenerating = () => generating;
        if (generating) hub.syncEngine(); else assert.throws(() => hub.syncEngine(), /new frame requested/);
        assert.equal(frame.isConnected, false); assert.equal(hub.engineFrame, null);
    } finally { f.restore(); }
});
test('same-chat open modal still postpones replacement', () => {
    const f = fixture(); try { const { hub, frame } = hubFixture(f); hub.syncEngine(); assert.equal(hub.engineFrame, frame); assert.equal(frame.isConnected, true); }
    finally { f.restore(); }
});

// 1.1.1 audit #7 · 重roll（swipe / 重新生成）不再叠加非系统点资产.
// The engine books every AI floor once and keeps the state BEFORE that floor in 面板账本[floor].snap (专属资源, 功法…,
// plus the previous values of 变量更新 module variables in snap.__vars). It rolls a floor back only when the NEW reply's
// block arrives — but the new reply was already written from a prompt that showed the rolled-away reply's numbers
// (数据块模板「专属资源: {{资源行}}」, 世界书「实时数据」, 模块变量). The model then added its gains on top of gains that were
// about to be undone, so every reroll stacked them again (天命印记 / 因果筹码 / 名望 / 模块货币 …, and 持有金额).
// Fix: when SillyTavern starts a swipe / regenerate generation (GENERATION_STARTED is awaited before the prompt is
// built) the floor's own snapshot is restored first — exactly what the engine does later anyway. The floor's booking
// hash is NOT touched then: the old reply's status-bar frame stays alive while the new one streams and would re-book
// itself. Only after the generation is over (old frame re-rendered) and no new reply was booked (failed / stopped
// swipe, a reply without a block, an identical block) is the hash cleared, so what is on screen is booked again. 持有金额 / 当前货币 are not in the engine snapshot; they go back to the previous floor's block
// value, but only while the ledger still holds the value of the reply being replaced (a manual edit is never reverted).
import { repairMessage, fieldOf } from './panel-guard.js';

/** vendor ZT_SNAP_KEYS (statusbar-v3.1-part2.js / ledger-kernel.js; a test keeps both equal). */
export const SNAP_KEYS = Object.freeze(['功法库', '功法', '功法记录', '功法待播报', '专属资源', '模块变量键']);
export const RES_KEYS = Object.freeze(['天命印记', '血脉结晶', '因果筹码', '名望', '岁月沉淀']);
const MONEY = ['持有金额', '当前货币'];
const clone = v => (v === undefined ? undefined : structuredClone(v));
const safe = p => String(p).split('.').every(k => k && !['__proto__', 'prototype', 'constructor'].includes(k));
/** vendor ztSetPath: dotted path, missing objects created, undefined deletes. */
function setPath(o, path, v) {
    if (!safe(path)) return;
    const keys = String(path).split('.'); let cur = o;
    for (let i = 0; i < keys.length - 1; i++) { if (!cur[keys[i]] || typeof cur[keys[i]] !== 'object') cur[keys[i]] = {}; cur = cur[keys[i]]; }
    if (v === undefined) delete cur[keys.at(-1)]; else cur[keys.at(-1)] = v;
}
const norm = v => String(v ?? '').trim().replace(/^[「『《"“]|[」』》"”]$/g, '').replace(/[,，\s]/g, '');
/** 字段 → 值 of the (repaired) data block in a reply ({} when there is none). */
export function panelValues(text) {
    const panel = repairMessage(String(text || '')).panel || '', out = {};
    for (const line of panel.split(/\r?\n/)) { const f = fieldOf(line); if (f && !(f in out)) out[f] = line.slice(line.search(/[:：]/) + 1).trim(); }
    return out;
}
/** vendor ztRes / 资源行 (so the prompt shows the restored numbers even before the engine re-derives). */
export function resourceLine(z) {
    const r = z?.专属资源 && typeof z.专属资源 === 'object' ? z.专属资源 : {};
    return RES_KEYS.map(k => k + (Math.floor(Number(r[k])) || 0)).join('｜');
}

/**
 * Pure: puts the ledger `z` back to the state before floor `idx` (in place).
 * `replaced` = texts of the reply/replies being replaced, `previous` = text of the newest earlier reply with a block.
 * Returns { changed, restored: [keys] }.
 */
export function rollbackFloor(z, idx, { replaced = [], previous = '' } = {}) {   // the floor's hash is left alone
    const restored = [];
    if (!z || typeof z !== 'object') return { changed: false, restored };
    const rec = z.面板账本?.[String(idx)];
    if (rec && typeof rec === 'object' && rec.snap && typeof rec.snap === 'object') {
        const snap = rec.snap;
        for (const k of SNAP_KEYS) {
            const want = snap[k];
            if (JSON.stringify(z[k]) === JSON.stringify(want)) continue;
            if (want === undefined) delete z[k]; else z[k] = clone(want);
            restored.push(k);
        }
        const vars = snap.__vars && typeof snap.__vars === 'object' ? snap.__vars : {};
        for (const [path, v] of Object.entries(vars)) {
            if (!safe(path)) continue;
            const want = v === null ? undefined : v, have = String(path).split('.').reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), z);
            if (JSON.stringify(have) === JSON.stringify(want)) continue;
            setPath(z, path, clone(want)); restored.push(path);
        }
    }
    if (!z.神豪模式 && previous) {
        const prev = panelValues(previous), olds = replaced.map(panelValues);
        for (const k of MONEY) {
            if (!(k in prev) || !prev[k] || norm(z[k]) === norm(prev[k])) continue;
            if (!olds.some(o => k in o && norm(o[k]) === norm(z[k]))) continue;   // the ledger no longer shows that reply's value
            z[k] = prev[k].replace(/^[「『《"“]|[」』》"”]$/g, ''); restored.push(k);
        }
    }
    if (restored.length) z.资源行 = resourceLine(z);
    return { changed: restored.length > 0, restored };
}

/** Which floor a swipe / regenerate is about to replace, and the texts involved (null = nothing to roll back). */
export function rerollTarget(chat, type) {
    if (!['swipe', 'regenerate'].includes(type) || !Array.isArray(chat) || !chat.length) return null;
    const idx = chat.length - 1, m = chat[idx];
    if (!m || m.is_user || m.is_system) return null;
    const replaced = type === 'swipe'
        ? (Array.isArray(m.swipes) ? m.swipes.filter((s, i) => i !== m.swipe_id && typeof s === 'string') : [])
        : [m.mes];
    let previous = '';
    for (let j = idx - 1; j >= 0; j--) { const x = chat[j]; if (x && !x.is_user && !x.is_system && /zhutianpanel/i.test(x.mes || '') && repairMessage(x.mes).panel) { previous = x.mes; break; } }
    return { idx, replaced, previous };
}

export class RerollGuard {
    constructor(app) { this.app = app; this.disposers = []; this.stats = { rolled: 0, rebooked: 0, last: null }; this.pending = null; }
    start() {
        const c = this.app.adapter.context(), ev = c?.eventTypes || {};
        if (!ev.GENERATION_STARTED || !c.eventSource) return this;
        const on = (key, fn, first = false) => {
            const e = ev[key]; if (!e) return;
            if (first && typeof c.eventSource.makeFirst === 'function') c.eventSource.makeFirst(e, fn); else c.eventSource.on(e, fn);
            this.disposers.push(() => c.eventSource.removeListener(e, fn));
        };
        on('GENERATION_STARTED', (type, _opts, dry) => (dry ? undefined : this.onStart(type)), true);
        for (const k of ['GENERATION_ENDED', 'GENERATION_STOPPED']) on(k, () => this.scheduleSettle());
        on('CHAT_CHANGED', () => { this.pending = null; clearTimeout(this.timer); });
        return this;
    }
    /** Awaited by SillyTavern before it builds the prompt. Never throws (a failure must not block the generation). */
    async onStart(type) {
        try {
            if (this.dead || this.app.bridge?.dead) return;
            const c = this.app.adapter.context(), id = this.app.adapter.currentIdentity();
            const z = c?.chatMetadata?.variables?.诸天系统; if (!id || !z) return;
            const t = rerollTarget(c.chat, type); if (!t) return;
            const probe = structuredClone(z); if (!rollbackFloor(probe, t.idx, t).changed) return;
            let restored = [], h = '';
            await this.app.bridge.updateVariablesWith(v => {
                const live = v.诸天系统; if (!live) return v;
                const r = rollbackFloor(live, t.idx, t); restored = r.restored; h = live.面板账本?.[String(t.idx)]?.h || '';
                if (r.changed) { try { this.app.hub?.engineFrame?.contentWindow?.ztDerive?.(v); } catch { /* derived on next render */ } }
                return v;
            }, { type: 'chat', expectedIdentity: id });
            if (!restored.length) return;
            this.stats.rolled++; this.stats.last = { floor: t.idx, type, restored, at: Date.now() };
            this.pending = { id, idx: t.idx, h, chat: c.chat };
        } catch (e) { console.warn('[诸天] 重roll 前回滚本层记账失败（不影响生成）', e); }
    }
    scheduleSettle(ms = 2000) { if (!this.pending || this.dead) return; clearTimeout(this.timer); this.timer = setTimeout(() => this.settle().catch(e => console.warn('[诸天] 重roll 后补记账失败', e)), ms); }
    /** After the generation: the floor still carries the rolled-back reply's hash → nothing new was booked; let the
     *  engine book what is on screen again (from the restored snapshot). */
    async settle() {
        const p = this.pending; if (!p || this.dead || this.app.bridge?.dead) return;
        const a = this.app.adapter, c = a.context();
        if (a.isGenerating?.()) { this.scheduleSettle(1500); return; }
        this.pending = null;
        if (a.currentIdentity() !== p.id || c.chat !== p.chat) return;
        const m = c.chat[p.idx];
        if (!m || m.is_user || m.is_system || p.idx !== c.chat.length - 1 || !repairMessage(m.mes || '').panel) return;   // reply gone / no block: rolled back is right
        const rec = c.chatMetadata?.variables?.诸天系统?.面板账本?.[String(p.idx)];
        if (!rec || rec.h !== p.h || !p.h) return;                                                            // a new reply was booked
        await this.app.bridge.updateVariablesWith(v => {
            const r = v.诸天系统?.面板账本?.[String(p.idx)]; if (r && r.h === p.h) r.h = ''; return v;
        }, { type: 'chat', expectedIdentity: p.id });
        this.stats.rebooked++;
        try { if (this.app.hub) this.app.hub.engineSig = ''; this.app.hub?.scheduleEngine?.(0); } catch { /* no terminal */ }
        try { const el = globalThis.document?.querySelector(`#chat .mes[mesid="${p.idx}"]`); if (el) delete el.dataset.ztSig; this.app.statusbar?.schedule?.(0); } catch { /* no DOM */ }
    }
    dispose() { this.dead = true; this.pending = null; clearTimeout(this.timer); this.disposers.splice(0).forEach(f => { try { f(); } catch { /* ignore */ } }); }
}

// 演出 (0.7.0): short, skippable transitions for the important moments — 穿越 · 突破 · 契约 · 任务完成 · 抽取 · 奖励入库.
//
// The one rule: a performance never runs ahead of the ledger. Nothing here decides an outcome.
//   * Engine / AI driven moments are found by diffing the ledger AFTER the native Bridge has saved it (bridge.onChange
//     fires after saveMetadata). Right before an event plays it is checked again against the live ledger (`stillBooked`);
//     if the change is gone (re-roll, rollback, failed write) nothing plays and the history says so.
//   * Terminal modules (聊天群, 星图 …) call `fx.play()` only after their own `commit()` has read the write back.
// Performances are optional decoration: mode full | brief | off, prefers-reduced-motion → brief, Esc / click / 跳过 skips.
// The result card (what changed, "账本已确认", a link to the record) is shown in every mode except off.
import { fxCss, isPalette } from './palettes.js';
import { TIERS } from './ledger-ops.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const num = (x, d = 0) => { const n = Number(x); return Number.isFinite(n) ? n : d; };
const fmt = x => num(x).toLocaleString('zh-CN');
const obj = x => (x && typeof x === 'object' && !Array.isArray(x) ? x : {});
const arr = x => (Array.isArray(x) ? x : []);
const nameOf = s => String(s ?? '').trim();
const EMPTY_NAME = /^(|暂无|无|未知|未记录|none)$/i;

export const FX_KINDS = Object.freeze({
    travel: { label: '穿越', ms: 2100, page: 'stars' },
    breakthrough: { label: '突破', ms: 1900, page: 'tree' },
    contract: { label: '契约', ms: 2000, page: 'bonds' },
    task: { label: '任务完成', ms: 1800, page: 'events' },
    fail: { label: '任务失败', ms: 1400, page: 'events' },
    draw: { label: '抽取', ms: 1900, page: 'shop' },
    reward: { label: '奖励入库', ms: 1500, page: 'bag' },
});

function bagMap(z) {
    const m = new Map();
    for (const it of arr(z?.背包)) { if (!it || !it.名称) continue; const k = it.名称 + '|' + (it.品级 || ''); m.set(k, (m.get(k) || 0) + Math.max(1, num(it.数量, 1))); }
    return m;
}

/** Pure: what important thing happened between two saved ledgers (`诸天系统` objects). Order = play order. */
export function diffLedger(a, b) {
    const out = [];
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return out;
    // 穿越
    const w0 = nameOf(a.当前世界), w1 = nameOf(b.当前世界);
    if (w1 && !EMPTY_NAME.test(w1) && w0 !== w1) out.push({ kind: 'travel', from: EMPTY_NAME.test(w0) ? '' : w0, to: w1, type: nameOf(b.世界类型), key: 'travel:' + w1 });
    // 契约: bond target locked, new group member
    const l0 = nameOf(obj(a.恋爱目标).姓名), l1 = nameOf(obj(b.恋爱目标).姓名);
    if (l1 && !EMPTY_NAME.test(l1) && l0 !== l1) out.push({ kind: 'contract', name: l1, label: '羁绊锁定', ref: 'bond:love', key: 'contract:love:' + l1 });
    const m0 = new Set(arr(obj(a.聊天群).成员).map(m => m?.id));
    for (const m of arr(obj(b.聊天群).成员)) if (m?.id && !m0.has(m.id)) out.push({ kind: 'contract', name: nameOf(m.名称), world: nameOf(m.世界), label: '入群契约', ref: 'bond:m:' + m.id, member: m.id, key: 'contract:m:' + m.id });
    // 突破: the original pushes every stage-up into 功法待播报; host tier going up
    const seen = new Set(arr(a.功法待播报).map(x => [x?.名称, x?.阶段, x?.楼层].join('|')));
    for (const x of arr(b.功法待播报)) {
        const k = [x?.名称, x?.阶段, x?.楼层].join('|');
        if (x?.名称 && !seen.has(k)) out.push({ kind: 'breakthrough', name: nameOf(x.名称), stage: nameOf(x.阶段), reward: nameOf(x.奖励), ref: 'skill:' + nameOf(x.名称), key: 'bt:' + k });
    }
    const t0 = num(a.宿主实力档), t1 = num(b.宿主实力档);
    if (t0 >= 1 && t1 > t0 && t1 <= 8) out.push({ kind: 'breakthrough', name: '宿主实力档', stage: TIERS[t1]?.n || String(t1), tier: t1, ref: 'tier', key: 'tier:' + t1 });
    // 任务: settlement receipts are the booked truth; status flips without points still count as completion / failure
    const r0 = obj(a.任务结算凭据), r1 = obj(b.任务结算凭据), lib0 = obj(a.任务库), lib1 = obj(b.任务库);
    const paid = new Set();
    for (const [id, r] of Object.entries(r1)) {
        if (Object.hasOwn(r0, id)) continue;
        paid.add(id);
        out.push({ kind: 'task', id, name: nameOf(r?.任务名 || lib1[id]?.名称 || id), points: num(r?.点数), floor: r?.楼层, ref: 'task:' + id, key: 'task:' + id });
    }
    for (const [id, t] of Object.entries(lib1)) {
        if (!t || typeof t !== 'object' || paid.has(id)) continue;
        const before = lib0[id]?.状态;
        if (t.状态 === '已完成' && before && before !== '已完成') out.push({ kind: 'task', id, name: nameOf(t.名称 || id), points: 0, floor: t.更新楼层, ref: 'task:' + id, key: 'task:' + id });
        if (t.状态 === '已失败' && before && before !== '已失败') out.push({ kind: 'fail', id, name: nameOf(t.名称 || id), floor: t.更新楼层, ref: 'task:' + id, key: 'fail:' + id });
    }
    // 抽取: the original counts every pull in 累计抽数 (神品次数 / 仙品次数 for the best grade)
    const d0 = num(a.累计抽数), d1 = num(b.累计抽数);
    if (d1 > d0) {
        const best = num(b.神品次数) > num(a.神品次数) ? '神品' : num(b.仙品次数) > num(a.仙品次数) ? '仙品' : '';
        const p0 = new Set(arr(a.待处理物品).map(x => JSON.stringify(x)));
        const items = arr(b.待处理物品).filter(x => !p0.has(JSON.stringify(x))).map(x => nameOf(x?.名称)).filter(Boolean).slice(0, 10);
        out.push({ kind: 'draw', n: d1 - d0, total: d1, best, items, ref: 'draw', key: 'draw:' + d1 });
    }
    // 入库: anything that grew in the bag (purchase, pending → bag, gifts, task items)
    const bm0 = bagMap(a), bm1 = bagMap(b), items = [];
    for (const [k, q] of bm1) { const d = q - (bm0.get(k) || 0); if (d > 0) { const [名称, 品级] = k.split('|'); items.push({ 名称, 品级, n: d }); } }
    if (items.length) out.push({ kind: 'reward', items: items.slice(0, 12), ref: 'bag', key: 'reward:' + items.map(i => i.名称 + i.n).join(',') });
    return out;
}

/** Pure: is the change an event describes still in the ledger right now? (checked right before it plays) */
export function stillBooked(ev, z) {
    if (!z || typeof z !== 'object') return false;
    switch (ev.kind) {
        case 'travel': return nameOf(z.当前世界) === ev.to;
        case 'contract': return ev.member ? arr(obj(z.聊天群).成员).some(m => m?.id === ev.member) : ev.ref === 'lilith' ? true : nameOf(obj(z.恋爱目标).姓名) === ev.name;
        case 'breakthrough': return ev.tier ? num(z.宿主实力档) >= ev.tier : arr(z.功法库).some(s => nameOf(s?.名称) === ev.name) || arr(z.功法待播报).some(x => nameOf(x?.名称) === ev.name);
        case 'task': return ev.points > 0 ? Object.hasOwn(obj(z.任务结算凭据), ev.id) : obj(z.任务库)[ev.id]?.状态 === '已完成';
        case 'fail': return obj(z.任务库)[ev.id]?.状态 === '已失败';
        case 'draw': return num(z.累计抽数) >= num(ev.total);
        case 'reward': { const m = bagMap(z); return (ev.items || []).every(i => [...m.keys()].some(k => k.startsWith(i.名称 + '|'))); }
        default: return true;
    }
}

/** Pure: headline + detail line for an event (also used by the history list). */
export function describe(ev) {
    const k = FX_KINDS[ev.kind] || { label: ev.kind };
    switch (ev.kind) {
        case 'travel': return { title: '穿越', detail: (ev.from ? `${ev.from} → ` : '坐标锁定 · ') + ev.to + (ev.type ? ` · ${ev.type}` : '') };
        case 'contract': return { title: ev.label || '契约', detail: ev.name + (ev.world ? ` · 来自${ev.world}` : '') };
        case 'breakthrough': return { title: '突破', detail: `${ev.name} → ${ev.stage}` + (ev.reward ? ` · ${ev.reward}` : '') };
        case 'task': return { title: '任务完成', detail: ev.name + (ev.points > 0 ? ` · +${fmt(ev.points)} 系统点` : '') };
        case 'fail': return { title: '任务失败', detail: ev.name };
        case 'draw': return { title: `抽取 ×${ev.n}`, detail: (ev.best ? `最高 ${ev.best}` : '结果已进入待处理') + (ev.items?.length ? ` · ${ev.items.slice(0, 3).join('、')}${ev.items.length > 3 ? '…' : ''}` : '') };
        case 'reward': return { title: '奖励入库', detail: (ev.items || []).slice(0, 3).map(i => `${i.名称}${i.n > 1 ? '×' + i.n : ''}`).join('、') + ((ev.items || []).length > 3 ? ` 等 ${ev.items.length} 种` : '') };
        default: return { title: ev.title || k.label, detail: ev.detail || '' };
    }
}

// ---------- art: one small SVG per kind, animated by styles/fx.css ----------
const ART = {
    travel: `<svg viewBox="0 0 200 200" class="zt-fx-svg"><g class="a-ring"><circle cx="100" cy="100" r="70"/><circle cx="100" cy="100" r="52" class="thin"/><circle cx="100" cy="100" r="86" class="dash"/></g><g class="a-stars">${Array.from({ length: 14 }, (_, i) => { const a = i / 14 * Math.PI * 2; return `<line x1="${100 + Math.cos(a) * 20}" y1="${100 + Math.sin(a) * 20}" x2="${100 + Math.cos(a) * 95}" y2="${100 + Math.sin(a) * 95}" style="--i:${i}"/>`; }).join('')}</g><circle cx="100" cy="100" r="18" class="a-core"/></svg>`,
    breakthrough: `<svg viewBox="0 0 200 200" class="zt-fx-svg"><rect x="88" y="0" width="24" height="200" class="a-pillar"/><g class="a-steps">${[0, 1, 2, 3, 4].map(i => `<path d="M${60 + i * 4} ${160 - i * 26}h${80 - i * 8}" style="--i:${i}"/>`).join('')}</g><path d="M100 30l10 24 26 2-20 17 7 25-23-14-23 14 7-25-20-17 26-2z" class="a-star"/></svg>`,
    contract: `<svg viewBox="0 0 200 200" class="zt-fx-svg"><circle cx="100" cy="100" r="78" class="a-draw"/><circle cx="100" cy="100" r="62" class="a-draw d2"/><path d="M100 30 L160 135 L40 135 Z M100 170 L40 65 L160 65 Z" class="a-draw d3"/><circle cx="100" cy="100" r="10" class="a-core"/></svg>`,
    task: `<svg viewBox="0 0 200 200" class="zt-fx-svg"><g class="a-seal"><rect x="40" y="40" width="120" height="120" rx="14"/><rect x="52" y="52" width="96" height="96" rx="8" class="thin"/><path d="M70 102l20 20 42-44" class="a-check"/></g></svg>`,
    fail: `<svg viewBox="0 0 200 200" class="zt-fx-svg"><g class="a-crack"><circle cx="100" cy="100" r="64"/><path d="M100 36l-10 34 16 16-14 22 10 26-6 30"/></g></svg>`,
    draw: `<svg viewBox="0 0 200 200" class="zt-fx-svg"><g class="a-card"><rect x="62" y="34" width="76" height="120" rx="10"/><path d="M100 64l12 30-12 30-12-30z" class="thin"/></g><g class="a-rays">${Array.from({ length: 10 }, (_, i) => `<line x1="100" y1="94" x2="${100 + Math.cos(i / 10 * 6.283) * 96}" y2="${94 + Math.sin(i / 10 * 6.283) * 96}" style="--i:${i}"/>`).join('')}</g></svg>`,
    reward: `<svg viewBox="0 0 200 200" class="zt-fx-svg"><path d="M58 92h84l-8 72H66z" class="a-bag"/><path d="M80 92v-8a20 20 0 0 1 40 0v8" class="a-bag"/><g class="a-drop"><path d="M100 18l12 14-12 14-12-14z"/></g></svg>`,
};

// Lilith bust / face crops from the original-derived expression stills (same art, only framing changes).
export const SHOTS = Object.freeze({ near: 'background-size:260px auto;background-position:-94px -30px', mid: 'background-size:212px auto;background-position:-71px -18px' });
export const MOOD_FOR = Object.freeze({ travel: 'surprised', breakthrough: 'smug', contract: 'shy', task: 'smile', fail: 'sad', draw: 'smile', reward: 'wink' });

export class FX {
    constructor(app) { this.app = app; this.queue = []; this.playing = null; this.deferred = new Map(); this.history = []; this.prev = undefined; this.idn = null; this.disposers = []; this.cards = null; }
    get settings() { return this.app.settings; }
    mode() { const m = this.settings.get('fx')?.mode || 'full'; if (m === 'full' && (globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches || this.app.perf?.lite)) return 'brief'; return m; }
    ledger() { try { const z = this.app.bridge.getVariables({ type: 'chat' })?.诸天系统; return z && typeof z === 'object' ? structuredClone(z) : null; } catch { return null; } }
    start() {
        this.rebase();
        this.disposers.push(this.app.bridge.onChange(kind => { if (kind === 'chat') this.scan(); }));
        this.disposers.push(this.app.adapter.subscribe(() => { if (this.app.adapter.currentIdentity() !== this.idn) this.rebase(); }));
        const key = e => {
            if (!this.playing || e.key !== 'Escape') return;
            e.preventDefault(); e.stopImmediatePropagation(); this.skip();
        };
        this.app.hub?.hook?.('onOpen', () => this.clearOutside());
        document.addEventListener('keydown', key, true); this.disposers.push(() => document.removeEventListener('keydown', key, true));
        // Focus may sit inside the engine iframe (its key events never reach this document).
        this.app.hub?.hook?.('onEngine', (frame, doc) => doc?.addEventListener('keydown', key, true));
        return this;
    }
    rebase() { this.idn = this.app.adapter.currentIdentity(); this.prev = this.idn ? this.ledger() : undefined; this.history = []; this.queue = []; for (const t of this.deferred.values()) clearTimeout(t.timer); this.deferred.clear(); }
    /** Ledger saved: compare with the previous saved state of the same chat. */
    scan() {
        const idn = this.app.adapter.currentIdentity();
        if (idn !== this.idn) { this.rebase(); return; }
        const z = this.ledger(), prev = this.prev; this.prev = z;
        if (prev === undefined) return;
        const evs = prev === null ? (z ? [{ kind: 'contract', name: '莉莉丝', label: '诸天契约缔结', ref: 'lilith', key: 'contract:init' }] : []) : diffLedger(prev, z);
        for (const ev of evs) this.defer(ev);
    }
    /** Watcher events wait a moment so an explicit module call for the same moment (richer text) replaces them. */
    defer(ev) {
        const old = this.deferred.get(ev.key); if (old) clearTimeout(old.timer);
        const timer = setTimeout(() => { this.deferred.delete(ev.key); this.enqueue(ev); }, 380);
        this.deferred.set(ev.key, { ev, timer });
    }
    /** Explicit: a module already committed + read back. {kind, title?, detail?, ref?, ...} */
    play(ev) {
        for (const [k, d] of this.deferred) if (d.ev.kind === ev.kind) { clearTimeout(d.timer); this.deferred.delete(k); }
        this.enqueue({ ...ev, explicit: true, key: ev.key || ev.kind + ':' + Date.now() });
    }
    /** 0.9.3: a write that is not a story moment (星图 → 更正 renames 当前世界) — forget the pending watcher event. */
    drop(kind) { for (const [k, d] of this.deferred) if (d.ev.kind === kind) { clearTimeout(d.timer); this.deferred.delete(k); } }
    /** Settings → 预览演出: a sample that writes nothing; the card says so. */
    preview() {
        const kinds = ['task', 'travel', 'breakthrough', 'contract', 'draw', 'reward'], k = kinds[(this.pv = ((this.pv ?? -1) + 1) % kinds.length)];
        const sample = { task: { name: '示例任务', points: 5000 }, travel: { from: '诸天', to: '示例世界' }, breakthrough: { name: '示例功法', stage: '精通' }, contract: { name: '示例角色', label: '契约' }, draw: { n: 10, best: '神品' }, reward: { items: [{ 名称: '示例物品', 品级: '仙品', n: 1 }] } }[k];
        this.enqueue({ kind: k, ...sample, preview: true, explicit: true, key: 'preview:' + Date.now() });
    }
    enqueue(ev) {
        if (this.queue.some(q => q.key === ev.key) || this.playing?.key === ev.key) return;
        this.queue.push(ev); if (!this.playing) this.next();
    }
    record(ev, state) {
        const d = describe(ev);
        this.history.unshift({ ...ev, ...d, title: ev.title || d.title, detail: ev.detail || d.detail, state, t: Date.now() });
        this.history.length = Math.min(this.history.length, 40);
        this.app.atlas?.onHistory?.();
    }
    async next() {
        const ev = this.queue.shift(); if (!ev) { this.playing = null; return; }
        // Checked against the live ledger right before playing: never show something the ledger no longer has.
        if (!ev.explicit && !stillBooked(ev, this.ledger())) { this.record(ev, 'dropped'); return this.next(); }
        if (!ev.preview) this.record(ev, 'booked');
        const mode = this.mode();
        try { this.app.lilith?.reactTo?.(ev); } catch { /* optional */ }
        if (mode === 'off') return this.next();
        this.playing = ev;
        try { await this.show(ev, mode); } catch (e) { console.warn('[诸天演出]', e); }
        this.playing = null;
        this.next();
    }
    inTerminal() { return !!this.app.hub?.isOpen; }
    /** When the terminal opens, story-hint cards outside it are no longer needed (the terminal shows its own). */
    clearOutside() { this.outBox?.replaceChildren(); }
    host() {
        if (this.inTerminal()) return { root: this.app.hub.shell.dialog, inside: true };
        if (this.settings.get('fx')?.outside === false) return null;
        if (!this.outHost?.isConnected) {
            const h = document.createElement('div'); h.id = 'zhutian-fx-host'; document.body.append(h);
            const sh = h.attachShadow({ mode: 'open' });
            const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = this.app.base + 'styles/fx.css'; sh.append(link);
            const pal = document.createElement('style'); pal.textContent = fxCss(); sh.append(pal);   // 0.8.4 配色方案
            const box = document.createElement('div'); box.className = 'zt-fx-out'; sh.append(box);
            this.outHost = h; this.outBox = box;
        }
        this.outHost.dataset.ztWorld = this.app.world?.theme || 'default';
        const pid = this.settings.get('palette'); if (isPalette(pid)) this.outHost.dataset.ztPalette = pid; else delete this.outHost.dataset.ztPalette;
        return { root: this.outBox, inside: false };
    }
    show(ev, mode) {
        const where = this.host(); if (!where) return Promise.resolve();
        const d = describe(ev), title = ev.title || d.title, detail = ev.detail || d.detail, k = FX_KINDS[ev.kind] || { ms: 1600 };
        const grade = ev.best || ev.items?.[0]?.品级 || '';
        return new Promise(resolve => {
            let done = false, overlay = null, timer = 0;
            let finish = () => { if (done) return; done = true; clearTimeout(timer); overlay?.classList.add('zt-fx-leave'); setTimeout(() => overlay?.remove(), 220); this.card(ev, title, detail, where); resolve(); };
            this.skip = finish;
            if (mode === 'full' && where.inside) {
                overlay = document.createElement('div');
                overlay.className = 'zt-fx'; overlay.dataset.kind = ev.kind; if (grade) overlay.dataset.grade = grade;
                overlay.setAttribute('role', 'dialog'); overlay.setAttribute('aria-label', '演出：' + title);
                overlay.innerHTML = `<div class="zt-fx-stage">${ART[ev.kind] || ART.reward}<div class="zt-fx-title">${esc(title)}</div><div class="zt-fx-detail">${esc(detail)}</div></div><button type="button" class="zt-fx-skip">跳过 ›</button>`;
                overlay.addEventListener('click', () => finish());
                where.root.append(overlay);
                // Keyboard users land on 跳过 (Esc / Enter both skip); focus goes back where it was afterwards.
                const back = where.root.getRootNode?.().activeElement || document.activeElement;
                try { overlay.querySelector('.zt-fx-skip').focus({ preventScroll: true }); } catch { /* ignore */ }
                const restore = () => { try { if (back?.isConnected && back.focus) back.focus({ preventScroll: true }); } catch { /* ignore */ } };
                overlay.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); finish(); } });
                const f0 = finish; finish = () => { const was = done; f0(); if (!was) restore(); }; this.skip = finish;
                timer = setTimeout(finish, k.ms);
            } else if (mode === 'full' && !where.inside) {
                timer = setTimeout(finish, 60);               // outside the terminal: the story-hint card carries a short motion itself
            } else finish();
        });
    }
    skip() { /* replaced while a performance is on screen */ }
    card(ev, title, detail, where) {
        let stack = where.root.querySelector(':scope > .zt-fx-cards');
        if (!stack) { stack = document.createElement('div'); stack.className = 'zt-fx-cards'; stack.setAttribute('role', 'status'); stack.setAttribute('aria-live', 'polite'); where.root.append(stack); }
        const c = document.createElement('div'); c.className = 'zt-fx-card'; c.dataset.kind = ev.kind;
        const mood = MOOD_FOR[ev.kind] || 'neutral', shot = where.inside ? '' : `<i class="zt-fx-bust" style="background-image:url('${this.app.base}assets/lilith/variants/${mood}.webp');${SHOTS.mid}" aria-hidden="true"></i>`;
        const line = !where.inside ? this.app.lilith?.lineFor?.(ev) : '';
        c.innerHTML = `${shot}<div class="zt-fx-card-body"><b>${esc(title)}</b><span>${esc(detail)}</span>${line ? `<q>${esc(line)}</q>` : ''}<small>${ev.preview ? '预览 · 未写入账本' : '✓ 账本已确认'}</small></div>
<div class="zt-fx-card-act">${ev.preview ? '' : '<button type="button" data-fx="open">查看记录</button>'}<button type="button" data-fx="close" aria-label="关闭">✕</button></div>`;
        c.addEventListener('click', e => {
            const b = e.target.closest('[data-fx]'); if (!b) return;
            if (b.dataset.fx === 'open' && !ev.preview) this.openRecord(ev);
            c.remove();
        });
        stack.prepend(c);
        while (stack.children.length > 3) stack.lastElementChild.remove();
        let t = setTimeout(() => c.remove(), where.inside ? 7000 : 9000);
        c.addEventListener('pointerenter', () => clearTimeout(t)); c.addEventListener('pointerleave', () => { t = setTimeout(() => c.remove(), 3000); });
    }
    /** Every result links back to the actual record. */
    openRecord(ev) {
        const page = FX_KINDS[ev.kind]?.page || 'events', hub = this.app.hub; if (!hub) return;
        hub.open(page);
        if (ev.ref) setTimeout(() => this.app.atlas?.focus?.(page, ev.ref, ev), 60);
    }
    dispose() { this.disposers.splice(0).forEach(f => { try { f(); } catch { /* ignore */ } }); for (const t of this.deferred.values()) clearTimeout(t.timer); this.outHost?.remove(); }
}

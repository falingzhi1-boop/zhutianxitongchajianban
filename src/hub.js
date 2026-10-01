// 诸天终端 (0.5.0+): ONE window for the whole system.
// The original Lilith window (portrait, private chat, workbench, memory, rules, connection, status) is the shell; this
// module adds every other surface into that same window: the original 3.1 status-bar engine (all 8 pages, driven by the
// terminal navigation instead of an in-message bar), 外挂管理 + 自拟外挂, settings (everything that used to hide in the
// Extensions drawer), and later phases (聊天群, 图谱, 演出, 主题).
// Nothing here re-implements settlement rules: the engine iframe runs the byte-for-byte original functions on the native
// Bridge, bound to the latest floor that carries a <ZhuTianPanel> block.
import { ID, VERSION, STORAGE } from './contracts.js';
import { hash } from './statusbar-host.js';
import { shopLevel } from './ledger-ops.js';

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const fmtNum = x => { const n = Number(x); return Number.isFinite(n) ? n.toLocaleString('zh-CN') : '—'; };
const RES_KEYS = ['天命印记', '血脉结晶', '因果筹码', '名望', '岁月沉淀'];
const I = {
    grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    task: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 3h6v4H9zM9 12h6M9 16h4"/>',
    heart: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z"/>',
    lotus: '<path d="M12 20c-4 0-8-3-8-7 3 0 6 2 8 5 2-3 5-5 8-5 0 4-4 7-8 7Z"/><path d="M12 18c-2-3-2-8 0-12 2 4 2 9 0 12Z"/>',
    shop: '<path d="M4 7h16l-1.5 12h-13Z"/><path d="M9 7a3 3 0 0 1 6 0"/>',
    bag: '<path d="M6 8h12l1 12H5Z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>',
    plug: '<path d="M12 2 4 6v6c0 5 3.5 9 8 10 4.5-1 8-5 8-10V6Z"/><path d="m9 12 2 2 4-4"/>',
    art: '<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z"/>',
    chat: '<path d="M4 5h16v11H9l-5 4Z"/><path d="M8 9h8M8 12h5"/>',
    atlas: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1"/>',
};
const icon = k => `<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${I[k] || I.grid}</svg>`;
/** Engine pages → original status-bar tab index (radio .t1…t8). */
export const ENGINE_TABS = { ov: 1, bond: 2, task: 3, cult: 4, shop: 5, bag: 6, plug: 7, art: 8 };
/** Fixed navigation (positions never change with world themes). Original Lilith pages keep their own buttons. */
export const NAV = [
    { group: '系统', items: [['ov', '总览', 'grid'], ['task', '任务', 'task'], ['bond', '羁绊', 'heart'], ['cult', '修行', 'lotus']] },
    { group: '交易', items: [['shop', '商城', 'shop'], ['bag', '背包', 'bag']] },
    { group: '能力', items: [['plug', '外挂', 'plug'], ['art', '神通', 'art']] },
    { group: '万界', items: [] },
    { group: '莉莉丝', items: [['work'], ['memory'], ['rules']] },
    { group: '终端', items: [['api'], ['env'], ['set', '设置', 'gear']] },
];
const ORIGINAL_PAGES = ['work', 'memory', 'rules', 'api', 'env'];
const ORIGINAL_LABEL = { work: '工作台', memory: '记忆', rules: '规则', api: '连接', env: '状态' };

export class Hub {
    constructor(app) { this.app = app; this.pages = new Map(); this.disposers = []; this.page = 'ov'; this.dead = false; this.engineSig = ''; this.engineFrame = null; this.engineTimer = 0; this.passClose = false; this.historyArmed = false; }
    get a() { return this.app.adapter; }
    get settings() { return this.app.settings; }
    on(target, type, fn, opt) { target.addEventListener(type, fn, opt); this.disposers.push(() => target.removeEventListener(type, fn, opt)); }

    start() {
        const sh = this.app.assistant?.shadow;
        this.shell = sh ? this.fromAssistant(sh) : this.fallbackShell();
        this.shadow = this.shell.shadow;
        const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = this.app.base + 'styles/hub.css'; this.shadow.append(link); this.css = link;
        this.marker = document.createElement('div'); this.marker.id = ID; this.marker.hidden = true; document.body.append(this.marker);
        this.buildNav(); this.buildTop(); this.buildEngine();
        const title = this.shadow.getElementById('title'); if (title) { this.oldTitle = [title.textContent, title.nextElementSibling?.textContent]; title.textContent = '诸天终端'; if (title.nextElementSibling) title.nextElementSibling.textContent = 'ZHUTIAN TERMINAL · LILITH'; }
        const pill = this.shadow.querySelector('.version-pill'); if (pill) pill.textContent = VERSION;
        this.register('set', { title: '设置', render: el => this.app.hubSettings?.render(el) });
        this.bindClose();
        this.disposers.push(this.a.subscribe(() => { this.refreshTop(); this.scheduleEngine(); }));
        this.disposers.push(this.app.bridge.onChange(() => { this.refreshTop(); }));
        if (this.app.statusbar) { this.app.statusbar.openHub = (page, floor) => this.open(page, { floor }); this.app.statusbar.onScan = () => this.scheduleEngine(); }
        this.page = this.settings.get('hubPage') || 'ov';
        this.go(this.page, { silent: true });
        this.refreshTop(); this.scheduleEngine(0);
        return this;
    }

    // ---------- shell ----------
    fromAssistant(shadow) {
        const q = s => shadow.querySelector(s);
        return { shadow, kind: 'assistant', dialog: q('dialog'), nav: q('.sidebar nav'), main: q('.main'), scroll: q('.page-scroll'), header: q('.window-tools'),
            open: () => { if (!q('dialog')?.open) this.app.assistant.open(); }, closeBtn: q('#close'), minBtn: q('#minimize') };
    }
    /** Only used when the original Lilith window could not start (e.g. an old Tavern Helper copy is still running). */
    fallbackShell() {
        const host = document.createElement('div'); host.id = 'zhutian-hub-fallback'; document.body.append(host);
        const shadow = host.attachShadow({ mode: 'open' });
        shadow.innerHTML = `<button id="entry" class="zt-fb-entry" type="button" title="打开诸天终端" aria-label="打开诸天终端"><img src="${this.app.base}assets/original/avatar.webp" alt=""></button>
<dialog class="zt-fb"><header class="zt-fb-head"><b>诸天终端</b><span class="window-tools"></span><button id="close" type="button" aria-label="关闭">✕</button></header>
<div class="shell"><aside class="sidebar"><nav aria-label="终端导航"></nav></aside><main class="main"><div class="page-scroll"></div></main></div></dialog>`;
        const d = shadow.querySelector('dialog'), close = () => d.close();
        shadow.getElementById('entry').addEventListener('click', () => { if (!d.open) d.show(); });
        shadow.getElementById('close').addEventListener('click', close);
        this.disposers.push(() => host.remove());
        return { shadow, kind: 'fallback', dialog: d, nav: shadow.querySelector('nav'), main: shadow.querySelector('.main'), scroll: shadow.querySelector('.page-scroll'), header: shadow.querySelector('.window-tools'), open: () => { if (!d.open) d.show(); }, closeBtn: shadow.getElementById('close') };
    }
    buildNav() {
        const nav = this.shell.nav; if (!nav) return;
        const originals = new Map([...nav.querySelectorAll('.nav-button[data-page]')].map(b => [b.dataset.page, b]));
        nav.classList.add('zt-hub-nav');
        const frag = document.createDocumentFragment();
        for (const g of NAV) {
            const box = document.createElement('div'); box.className = 'zt-nav-group'; box.dataset.group = g.group;
            box.innerHTML = `<div class="zt-nav-title">${esc(g.group)}</div><div class="zt-nav-items"></div>`;
            const items = box.querySelector('.zt-nav-items');
            for (const [id, label, ic] of g.items) {
                if (ORIGINAL_PAGES.includes(id)) {
                    const b = originals.get(id); if (!b) continue;
                    b.classList.add('zt-nav-orig'); const span = b.querySelector('span'); if (span) span.textContent = ORIGINAL_LABEL[id];
                    items.append(b); originals.delete(id); continue;
                }
                items.append(this.navButton(id, label, ic));
            }
            frag.append(box);
        }
        for (const b of originals.values()) frag.append(b);        // unknown future original tabs stay reachable
        nav.replaceChildren(frag);
        this.groupBox = g => nav.querySelector(`.zt-nav-group[data-group="${g}"] .zt-nav-items`);
        this.on(nav, 'click', e => {
            const b = e.target.closest('.nav-button[data-page]'); if (!b) return;
            if (b.classList.contains('zt-nav-orig')) { this.page = b.dataset.page; this.afterGo(); return; }   // original handler switches the page
            e.preventDefault(); this.go(b.dataset.page);
        });
        // Arrow keys across all groups (the original handler only knows its five tabs).
        this.on(nav, 'keydown', e => {
            if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) return;
            const list = [...nav.querySelectorAll('.nav-button[data-page]')].filter(b => !b.hidden), i = list.indexOf(e.target.closest('.nav-button'));
            if (i < 0) return; e.preventDefault(); e.stopImmediatePropagation();
            const next = list[(i + (['ArrowDown', 'ArrowRight'].includes(e.key) ? 1 : -1) + list.length) % list.length]; next.click(); next.focus();
        }, true);
    }
    navButton(id, label, ic) {
        const b = document.createElement('button'); b.type = 'button'; b.className = 'nav-button zt-nav-own'; b.dataset.page = id; b.setAttribute('role', 'tab');
        b.id = 'tab-' + id; b.setAttribute('aria-selected', 'false'); b.innerHTML = `${icon(ic)}<span>${esc(label)}</span>`; return b;
    }
    /** Adds a page to a nav group (used by later modules: 聊天群, 图谱 …). */
    addNav(group, id, label, ic, def) {
        const items = this.groupBox?.(group); if (items && !items.querySelector(`[data-page="${id}"]`)) items.append(this.navButton(id, label, ic));
        this.register(id, def);
    }
    register(id, def) {
        let el = this.shadow.getElementById('page-' + id);
        if (!el) { el = document.createElement('section'); el.className = 'page zt-hub-page'; el.id = 'page-' + id; el.hidden = true; this.shell.scroll.append(el); }
        this.pages.set(id, { ...def, el });
        return el;
    }
    buildTop() {
        const top = document.createElement('div'); top.className = 'zt-hub-top'; top.setAttribute('role', 'status');
        top.innerHTML = `<div class="zt-top-world"><small>当前世界</small><b id="zt-top-world">—</b></div><div class="zt-top-pts"><small>系统点</small><b id="zt-top-pts">—</b></div><div class="zt-top-res" id="zt-top-res"></div><div class="zt-top-shop"><small>商城</small><b id="zt-top-shop">—</b></div>`;
        this.shell.main.insertBefore(top, this.shell.main.firstChild); this.top = top;
        this.on(top, 'click', e => { if (e.target.closest('.zt-top-pts,.zt-top-res')) this.go('ov'); if (e.target.closest('.zt-top-shop')) this.go('shop'); });
    }
    ledger() { try { const v = this.app.bridge.getVariables({ type: 'chat' }).诸天系统; return v && typeof v === 'object' ? v : null; } catch { return null; } }
    refreshTop() {
        if (!this.top || this.dead) return;
        const l = this.ledger(), $ = id => this.shadow.getElementById(id);
        $('zt-top-world').textContent = l?.当前世界 || l?.世界名称 || (this.a.currentIdentity() ? '未记录' : '未打开聊天');
        $('zt-top-pts').textContent = l ? fmtNum(l.系统点) : '—';
        const r = l?.专属资源 && typeof l.专属资源 === 'object' ? l.专属资源 : {};
        $('zt-top-res').innerHTML = RES_KEYS.map(k => `<span title="${k}"><small>${k}</small><b>${fmtNum(r[k] ?? 0)}</b></span>`).join('');
        $('zt-top-shop').textContent = 'Lv.' + shopLevel(l);
        this.onTop?.(l);
    }

    // ---------- navigation ----------
    go(id, { silent = false } = {}) {
        if (ORIGINAL_PAGES.includes(id)) { const b = this.shadow.querySelector(`.zt-nav-orig[data-page="${id}"]`); if (b) { b.click(); return; } id = 'ov'; }
        const engine = id in ENGINE_TABS, def = this.pages.get(engine ? 'zt-engine' : id);
        if (!def) id = 'ov';
        this.page = id;
        const target = engine || !def ? this.pages.get('zt-engine').el : def.el;
        this.shadow.querySelectorAll('.nav-button[data-page]').forEach(b => { const yes = b.dataset.page === id; b.setAttribute('aria-selected', String(yes)); b.tabIndex = yes ? 0 : -1; });
        this.shell.scroll.querySelectorAll(':scope > .page').forEach(p => { p.hidden = p !== target; });
        this.shell.scroll.classList.toggle('zt-fill', target.classList.contains('zt-fill-page'));
        if (engine) this.setEngineTab(ENGINE_TABS[id]);
        else { try { def?.render?.(target); } catch (e) { target.innerHTML = `<div class="zt-empty">页面加载失败：${esc(e.message)}</div>`; } this.shell.scroll.scrollTop = 0; }
        this.afterGo(silent);
    }
    afterGo(silent) {
        if (ORIGINAL_PAGES.includes(this.page)) this.shell.scroll?.classList.remove('zt-fill');
        if (!silent) this.settings.set('hubPage', this.page);
        this.shadow.host?.setAttribute?.('data-zt-page', this.page);
        this.onPage?.(this.page);
    }
    open(page, opts = {}) {
        this.shell.open();
        if (page) this.go(page); else this.go(this.settings.get('hubPage') || this.page || 'ov');
        if (opts.floor !== undefined) this.onFloorFocus?.(opts.floor);
    }
    get isOpen() { return !!this.shell.dialog?.open; }
    close() { if (!this.isOpen) return; this.animateClose(() => this.rawClose()); }
    rawClose() { this.passClose = true; try { (this.shell.closeBtn || this.shell.minBtn)?.click(); } finally { this.passClose = false; } if (this.shell.dialog?.open) this.shell.dialog.close(); }

    // ---------- closing: one window, four ways, no focus jump ----------
    bindClose() {
        const d = this.shell.dialog; if (!d) return;
        const intercept = e => { if (this.passClose) return; e.preventDefault(); e.stopImmediatePropagation(); this.close(); };
        for (const b of [this.shell.closeBtn, this.shell.minBtn]) if (b) this.on(b, 'click', intercept, true);
        // Esc anywhere while the terminal is open (the original only listened inside the dialog); ST popups keep their own Esc.
        this.on(document, 'keydown', e => {
            if (e.key !== 'Escape' || !this.isOpen || e.defaultPrevented) return;
            if (document.querySelector('dialog.popup[open], .popup[open]')) return;
            const inner = this.engineFrame?.contentDocument?.querySelector('.mvu-modal-toggle:checked, .gacha-overlay.show, .zt-overlay.show');
            if (inner) return;
            e.preventDefault(); this.close();
        });
        // Clicking outside the window (optional; default on phones where the window covers the screen).
        this.on(document, 'pointerdown', e => {
            if (!this.isOpen || !this.outsideClose()) return;
            const path = e.composedPath(); if (path.includes(this.shell.dialog) || path.includes(this.shadow.host)) return;
            if (path.some(n => n?.classList?.contains?.('popup') || n?.id === 'toast-container')) return;
            this.close();
        }, true);
        // Phone back gesture: opening pushes one history entry; going back closes the terminal instead of leaving ST.
        this.on(globalThis, 'popstate', () => { if (this.historyArmed) { this.historyArmed = false; if (this.isOpen) this.animateClose(() => this.rawClose(), true); } });
        const mo = new MutationObserver(() => {
            const open = d.open;
            this.shadow.host?.toggleAttribute?.('data-zt-open', open);
            if (open && !this.wasOpen) { this.returnFocus = document.activeElement && !this.shadow.host?.contains?.(document.activeElement) ? document.activeElement : null; this.armHistory(); this.onOpen?.(); this.refreshTop(); }
            if (!open && this.wasOpen) { this.disarmHistory(); this.onClose?.(); this.restoreFocus(); }
            this.wasOpen = open;
        });
        mo.observe(d, { attributes: true, attributeFilter: ['open'] }); this.disposers.push(() => mo.disconnect());
        this.wasOpen = d.open;
    }
    outsideClose() { const v = this.settings.get('hubOutsideClose'); return v === 'always' || (v !== 'never' && matchMedia('(max-width: 720px)').matches); }
    armHistory() { if (this.historyArmed || this.settings.get('hubBackClose') === false) return; try { history.pushState({ ...(history.state || {}), zhutianHub: 1 }, ''); this.historyArmed = true; } catch { /* sandboxed */ } }
    disarmHistory() { if (!this.historyArmed) return; this.historyArmed = false; try { if (history.state?.zhutianHub) history.back(); } catch { /* ignore */ } }
    animateClose(done, fromHistory = false) {
        const d = this.shell.dialog; if (!d?.open) return done();
        if (fromHistory) this.historyArmed = false;
        if (matchMedia('(prefers-reduced-motion: reduce)').matches) return done();
        d.classList.add('zt-closing');
        setTimeout(() => { d.classList.remove('zt-closing'); done(); }, 150);
    }
    restoreFocus() {
        const el = this.returnFocus; this.returnFocus = null;
        const y = scrollY, chat = document.getElementById('chat'), top = chat?.scrollTop;
        try { if (el?.isConnected && el.focus) el.focus({ preventScroll: true }); else document.activeElement?.blur?.(); } catch { /* ignore */ }
        requestAnimationFrame(() => { if (chat && top !== undefined) chat.scrollTop = top; if (scrollY !== y) scrollTo(scrollX, y); });
    }

    // ---------- the original 3.1 engine inside the terminal ----------
    buildEngine() {
        const el = this.register('zt-engine', { title: '诸天系统' });
        el.classList.add('zt-fill-page');
        el.innerHTML = `<div class="zt-engine-tools" id="zt-engine-tools"></div><div class="zt-engine-slot" id="zt-engine-slot"><div class="zt-empty" id="zt-engine-empty">正在读取当前聊天的诸天系统…</div></div>`;
        this.engineTab = 1;
    }
    scheduleEngine(ms = 250) { if (this.dead) return; clearTimeout(this.engineTimer); this.engineTimer = setTimeout(() => this.syncEngine(), ms); }
    engineTarget() {
        const sb = this.app.statusbar; if (!sb?.template) return null;
        const idn = this.a.currentIdentity(); if (!idn) return { idn: '', none: true };
        const lp = sb.latestPanel(), mode = sb.state?.mode || 'terminal';
        const capture = mode === 'terminal' || mode === 'native';
        return { idn, id: lp ? lp.id : Math.max(0, (this.a.context().chat?.length || 1) - 1), panel: lp ? lp.panel : '', capture: capture && !!lp, mode };
    }
    syncEngine(force = false) {
        if (this.dead) return;
        const t = this.engineTarget(), slot = this.shadow.getElementById('zt-engine-slot'); if (!slot) return;
        if (!t) { this.scheduleEngine(1000); return; }
        if (t.none) { this.dropEngine(); slot.innerHTML = '<div class="zt-empty">请先打开一个单角色聊天。诸天系统的数据保存在每个聊天里。</div>'; this.engineSig = ''; return; }
        if (this.a.isGenerating()) { this.scheduleEngine(800); return; }
        const sig = [t.idn, t.id, hash(t.panel), t.capture ? 1 : 0].join('|');
        if (!force && sig === this.engineSig && this.engineFrame?.isConnected) return;
        if (this.engineBusy && !force) { this.scheduleEngine(600); return; }   // never reload under an open gacha / modal
        this.engineSig = sig;
        const frame = this.app.statusbar.frame(t.panel, t.id, { fill: true, lastId: t.capture ? undefined : () => 1e9 });
        frame.addEventListener('load', () => this.engineLoaded(frame), { once: true });
        slot.querySelector('.zt-empty')?.remove();
        const old = this.engineFrame; this.engineFrame = frame; frame.classList.add('zt-engine-loading');
        slot.append(frame);
        if (old) setTimeout(() => { this.app.statusbar.release(old); old.remove(); }, 60);
    }
    get engineBusy() {
        const doc = this.engineFrame?.contentDocument; if (!doc) return false;
        return !!doc.querySelector('.mvu-modal-toggle:checked, .gacha-overlay.show, [class*="overlay"].show, .mvu-detail-modal.show') || doc.activeElement?.matches?.('input[type=text],textarea');
    }
    dropEngine() { const f = this.engineFrame; if (f) { this.app.statusbar?.release(f); f.remove(); } this.engineFrame = null; }
    engineLoaded(frame) {
        if (frame !== this.engineFrame) return;
        const doc = frame.contentDocument; if (!doc) return;
        const st = doc.createElement('style'); st.id = 'zt-hub-engine-css'; st.textContent = ENGINE_CSS; doc.head.append(st);
        doc.documentElement.dataset.ztHub = '1';
        const det = doc.querySelector('.mvu-sys > details'); if (det) det.open = true;
        frame.classList.remove('zt-engine-loading');
        // The original writes 闭关 / 结算 / 购物车 text into the chat input behind this window: say so, offer to close.
        const w = frame.contentWindow, orig = w?.insertIntoChatInput;
        if (typeof orig === 'function' && !orig.__zt) { const wrapped = function (...args) { const r = orig.apply(this, args); if (r) setTimeout(() => this.hubInputWritten?.(), 0); return r; }.bind(w); wrapped.__zt = true; w.hubInputWritten = () => this.inputWritten(); w.insertIntoChatInput = wrapped; }
        this.setEngineTab(this.engineTab, true);
        this.onEngine?.(frame, doc);
    }
    setEngineTab(n, force = false) {
        this.engineTab = n;
        const doc = this.engineFrame?.contentDocument, r = doc?.querySelector('input.t' + n);
        if (r && (!r.checked || force)) { r.click(); }
        doc?.documentElement?.setAttribute('data-zt-tab', String(n));
        const tools = this.shadow.getElementById('zt-engine-tools'); if (tools) { tools.dataset.tab = String(n); this.onEngineTab?.(n, tools); }
        try { doc?.scrollingElement?.scrollTo?.(0, 0); } catch { /* ignore */ }
    }
    reloadEngine() { this.syncEngine(true); }
    /** Something was written into the chat input while the terminal is open. */
    inputWritten() {
        if (!this.isOpen) return;
        this.toast('已写入聊天输入框 · 发送后由 AI 演绎', 5000, { label: '关闭终端去发送', run: () => { this.close(); setTimeout(() => document.getElementById('send_textarea')?.focus({ preventScroll: true }), 260); } });
        try { this.engineFrame?.contentWindow?.focus(); } catch { /* ignore */ }
    }
    /** Short status line at the bottom of the terminal; optional one action button ({label, run}). */
    toast(text, ms = 2200, action = null) {
        const host = this.shell.main || this.shell.dialog; if (!host) return;
        let t = this.shadow.getElementById('zt-hub-toast');
        if (!t) { t = document.createElement('div'); t.id = 'zt-hub-toast'; t.className = 'zt-toast'; t.setAttribute('role', 'status'); host.append(t); }
        t.replaceChildren(document.createTextNode(text));
        if (action?.label) { const b = document.createElement('button'); b.type = 'button'; b.className = 'zt-toast-act'; b.textContent = action.label; b.addEventListener('click', () => { t.hidden = true; action.run?.(); }); t.append(b); }
        t.hidden = false; clearTimeout(this.toastTimer); this.toastTimer = setTimeout(() => { t.hidden = true; }, ms);
    }

    dispose() {
        this.dead = true; clearTimeout(this.engineTimer); this.disarmHistory();
        this.disposers.splice(0).forEach(f => { try { f(); } catch { /* ignore */ } });
        this.dropEngine(); this.marker?.remove(); this.css?.remove();
        for (const { el } of this.pages.values()) el?.remove();
        this.top?.remove();
        if (this.app.statusbar) { this.app.statusbar.openHub = null; this.app.statusbar.onScan = null; }
    }
}

/** Injected into the engine iframe: the terminal navigation replaces the bar's own header/tabs; nothing else changes. */
export const ENGINE_CSS = `
html[data-zt-hub],html[data-zt-hub] body{background:#17111f!important}
html[data-zt-hub] body{margin:0!important;padding:0!important;overflow-x:hidden}
html[data-zt-hub] .mvu-sys{--bg:#17111f;--bg2:#1b1325;--panel:#21182d;--panel2:#2a1f38;--input:#120c19;--text:#f3edf7;--muted:#b4a3c4;--faint:#8f7fa3;--hair:#ffffff17;--border:#ffffff1f;--gold:#d8bf92;--jade:#c9a2ef;--sky:#9fc3e6;--violet:#c59bee;--pink:#e3a2c3;--c-text:var(--text);--c-hl:#d8bf92;--v-task:#b98ae0;--accent-soft:#2e2142;--accent-line:#6f5190;--btn-hover-bg:#3a2749;--btn-hover-text:#f6ecfb;--title-grad:linear-gradient(0deg,#f3edf7,#f3edf7);--pts-grad:linear-gradient(0deg,#d8bf92,#d8bf92)}
html[data-zt-hub] .mvu-sys{margin:0!important;max-width:none!important;border:0!important;border-radius:0!important;box-shadow:none!important;background:transparent!important}
html[data-zt-hub] .mvu-sys>details>summary,html[data-zt-hub] .mvu-head-area,html[data-zt-hub] .mvu-nav{display:none!important}
html[data-zt-hub] .mvu-container{padding:14px 18px 48px!important;border:0!important;background:transparent!important}
html[data-zt-hub] .zt-page-heading{margin-top:0!important}
html[data-zt-hub] [data-zt-off="1"]{display:none!important}
html[data-zt-hub] ::-webkit-scrollbar{width:8px;height:8px}html[data-zt-hub] ::-webkit-scrollbar-thumb{background:#8a6aa055;border-radius:8px}
@media (max-width:560px){html[data-zt-hub] .mvu-container{padding:10px 10px 40px!important}}
`;

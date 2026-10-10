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
import { resetPageScroll, guardPageScroll, withoutFocusScroll } from './page-scroll.js';

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
    quill: '<path d="M20 4c-6 1-11 6-13 13l-2 3"/><path d="M20 4c0 6-4 11-11 12"/><path d="M9 11h5"/>',
    flag: '<path d="M5 21V4"/><path d="M5 4h12l-2.5 4 2.5 4H5"/>',
    book: '<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2Z"/><path d="M4 19V5M8 7h7M8 11h5"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1"/>',
};
const icon = k => `<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${I[k] || I.grid}</svg>`;
/** Engine pages → original status-bar tab index (radio .t1…t8). */
export const ENGINE_TABS = { ov: 1, bond: 2, task: 3, cult: 4, shop: 5, bag: 6, plug: 7, art: 8 };
/** Fixed navigation (positions never change with world themes). Original Lilith pages keep their own buttons. */
export const NAV = [
    { group: '系统', items: [['ov', '总览', 'grid'], ['task', '任务', 'task'], ['bond', '羁绊', 'heart'], ['cult', '修行', 'lotus']] },
    { group: '交易', items: [['shop', '商城', 'shop'], ['bag', '背包', 'bag']] },
    { group: '能力', items: [['plug', '外挂', 'plug'], ['plugmgr', '自拟', 'quill'], ['art', '神通', 'art']] },
    { group: '图谱', items: [] },
    { group: '万界', items: [] },
    { group: '莉莉丝', items: [['work'], ['memory'], ['rules']] },
    { group: '终端', items: [['api'], ['env'], ['set', '设置', 'gear']] },
];
/** Full names for short navigation labels (tooltip + screen readers via title). */
const NAV_TITLE = { plugmgr: '自拟外挂：自己编写外挂（规则、代价、冷却），按聊天启用' };
const ORIGINAL_PAGES = ['work', 'memory', 'rules', 'api', 'env'];
const ORIGINAL_LABEL = { work: '工作台', memory: '记忆', rules: '规则', api: '连接', env: '状态' };

export class Hub {
    constructor(app) { this.app = app; this.pages = new Map(); this.disposers = []; this.page = 'ov'; this.dead = false; this.engineSig = ''; this.engineFrame = null; this.engineTimer = 0; this.passClose = false; this.historyArmed = false; }
    get a() { return this.app.adapter; }
    /** Chains a hook (onEngine, onPage, onEngineTab, onOpen, onClose, onTop …) without replacing earlier listeners. */
    hook(name, fn) { const prev = this[name]; this[name] = (...args) => { try { prev?.(...args); } catch (e) { console.warn('[诸天终端]', name, e); } return fn(...args); }; }
    get settings() { return this.app.settings; }
    on(target, type, fn, opt) { target.addEventListener(type, fn, opt); this.disposers.push(() => target.removeEventListener(type, fn, opt)); }

    start() {
        const sh = this.app.assistant?.shadow;
        this.shell = sh ? this.fromAssistant(sh) : this.fallbackShell();
        this.shadow = this.shell.shadow;
        // 1.1.1: the page itself never scrolls while the terminal is open (外挂工坊 / 许愿 used to push ST up)
        this.disposers.push(guardPageScroll(() => this.isOpen));
        const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = this.app.base + 'styles/hub.css'; this.shadow.append(link); this.css = link;
        // 0.7.0: world themes + layout, 图谱, 演出 (each its own file so a theme never touches layout rules).
        this.extraCss = ['world.css', 'atlas.css', 'fx.css'].map(f => { const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = this.app.base + 'styles/' + f; this.shadow.append(l); return l; });
        this.marker = document.createElement('div'); this.marker.id = ID; this.marker.hidden = true; document.body.append(this.marker);
        this.buildNav(); this.buildTop(); this.buildEngine(); this.buildDeco();
        const title = this.shadow.getElementById('title'); if (title) { this.oldTitle = [title.textContent, title.nextElementSibling?.textContent]; title.textContent = '诸天终端'; if (title.nextElementSibling) title.nextElementSibling.textContent = 'ZHUTIAN TERMINAL · LILITH'; }
        const pill = this.shadow.querySelector('.version-pill'); if (pill) pill.textContent = VERSION;
        this.register('set', { title: '设置', render: el => this.app.hubSettings?.render(el) });
        this.bindClose();
        this.disposers.push(this.a.subscribe(() => { if (this.engineFrame && !this.app.statusbar.isCurrent(this.engineFrame)) this.dropEngine(); this.refreshTop(); this.scheduleEngine(); }));
        // 0.8.0: a ledger write from outside the engine (签到, 聊天群, 自拟外挂, 管理员 …) also refreshes the numbers shown
        // inside the engine page — before, only the top bar followed and 基础概览 kept the panel's old 系统点.
        this.disposers.push(this.app.bridge.onChange(() => { this.refreshTop(); this.scheduleEngineView(); }));
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
        b.id = 'tab-' + id; b.setAttribute('aria-selected', 'false'); if (NAV_TITLE[id]) b.title = NAV_TITLE[id]; b.innerHTML = `${icon(ic)}<span>${esc(label)}</span>`; return b;
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
        top.innerHTML = `<div class="zt-top-world" title="打开星图"><small>当前世界 <span class="zt-world-badge" id="zt-top-theme"></span></small><b id="zt-top-world">—</b></div><div class="zt-top-pts"><small>系统点</small><b id="zt-top-pts">—</b></div><div class="zt-top-res" id="zt-top-res"></div><div class="zt-top-shop"><small>商城</small><b id="zt-top-shop">—</b></div>`;
        this.shell.main.insertBefore(top, this.shell.main.firstChild); this.top = top;
        this.on(top, 'click', e => { if (e.target.closest('.zt-top-pts,.zt-top-res')) this.go('ov'); if (e.target.closest('.zt-top-shop')) this.go('shop'); if (e.target.closest('.zt-top-world') && this.pages.has('stars')) this.go('stars'); });
    }
    /** Theme decoration layer (阵纹 / 全息网格 / 侵蚀). Purely visual, pointer-events none, never moves a control. */
    buildDeco() {
        const d = this.shell.dialog; if (!d || d.querySelector(':scope > .zt-world-deco')) return;
        const deco = document.createElement('div'); deco.className = 'zt-world-deco'; deco.setAttribute('aria-hidden', 'true');
        deco.innerHTML = `<svg class="zt-deco-array" viewBox="0 0 200 200"><circle cx="100" cy="100" r="96"/><circle cx="100" cy="100" r="78"/><circle cx="100" cy="100" r="40"/><path d="M100 4 L183 148 L17 148 Z M100 196 L17 52 L183 52 Z"/>${Array.from({ length: 24 }, (_, i) => { const a = i / 24 * Math.PI * 2; return `<line x1="${(100 + Math.cos(a) * 78).toFixed(1)}" y1="${(100 + Math.sin(a) * 78).toFixed(1)}" x2="${(100 + Math.cos(a) * 96).toFixed(1)}" y2="${(100 + Math.sin(a) * 96).toFixed(1)}"/>`; }).join('')}</svg><i class="zt-deco-grid"></i><i class="zt-deco-scan"></i><i class="zt-deco-rot"></i>`;
        d.prepend(deco); this.disposers.push(() => deco.remove());
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
        const th = this.app.world?.theme || 'default', badge = $('zt-top-theme');
        if (badge) { badge.textContent = { default: '', xianxia: '玉简', cyber: '全息', eerie: '异常' }[th] || ''; badge.dataset.theme = th; }
        this.onTop?.(l);
    }

    // ---------- navigation ----------
    go(id, { silent = false } = {}) {
        if (ORIGINAL_PAGES.includes(id)) { const b = this.shadow.querySelector(`.zt-nav-orig[data-page="${id}"]`); if (b) { b.click(); return; } id = 'ov'; }
        const engine = id in ENGINE_TABS && !this.pages.has(id), def = this.pages.get(engine ? 'zt-engine' : id);
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
        // Navigation/diagnostics must remain usable even when persisting the last page is unavailable.
        if (!silent) try { this.settings.set('hubPage', this.page); } catch { /* save failure already logged by Settings */ }
        this.shadow.host?.setAttribute?.('data-zt-page', this.page);
        this.onPage?.(this.page);
    }
    open(page, opts = {}) {
        this.openedWith = page || null;          // 0.9.3: the first-run guide never replaces a page that was asked for
        this.shell.open();
        if (page) this.go(page); else this.go(this.settings.get('hubPage') || this.page || 'ov');
        if (opts.floor !== undefined) this.onFloorFocus?.(opts.floor);
    }
    get isOpen() { return !!this.shell.dialog?.open; }
    close() { if (!this.isOpen) return; this.animateClose(() => this.rawClose()); }
    rawClose() { this.passClose = true; try { (this.shell.closeBtn || this.shell.minBtn)?.click(); } finally { this.passClose = false; } if (this.shell.dialog?.open) this.shell.dialog.close(); resetPageScroll(); setTimeout(() => resetPageScroll(), 0); }

    // ---------- closing: one window, four ways, no focus jump ----------
    bindClose() {
        const d = this.shell.dialog; if (!d) return;
        const intercept = e => { if (this.passClose) return; e.preventDefault(); e.stopImmediatePropagation(); this.close(); };
        for (const b of [this.shell.closeBtn, this.shell.minBtn]) if (b) this.on(b, 'click', intercept, true);
        // Esc anywhere while the terminal is open (the original only listened inside the dialog); ST popups keep their own Esc.
        this.on(document, 'keydown', e => {
            if (e.key !== 'Escape' || !this.isOpen || e.defaultPrevented) return;
            if (document.querySelector('dialog.popup[open], .popup[open]')) return;
            const inner = this.engineFrame?.contentDocument?.querySelector('.mvu-modal-toggle:checked, .gacha-overlay.show, .zt-overlay.show, [id$="-overlay"]:not([hidden])');
            if (inner) return;
            e.preventDefault(); this.close();
        });
        // Clicking outside the window (optional; default on phones where the window covers the screen).
        this.on(document, 'pointerdown', e => {
            if (!this.isOpen || !this.outsideClose()) return;
            const path = e.composedPath(); if (path.includes(this.shell.dialog) || path.includes(this.shadow.host)) return;
            if (path.some(n => n?.classList?.contains?.('popup') || n?.id === 'toast-container' || n?.id === 'zhutian-lilith-float' || n?.hasAttribute?.('data-zt-keep-hub'))) return;   // 0.8.3: tapping the floating Lilith is not "outside"
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
        // Chat changes outrank modal/focus and generation guards: an old frame must never be kept alive.
        if (this.engineFrame && !this.app.statusbar.isCurrent(this.engineFrame)) this.dropEngine();
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
        if (old) { this.app.statusbar.release(old); setTimeout(() => old.remove(), 60); }
    }
    get engineBusy() {
        const doc = this.engineFrame?.contentDocument; if (!doc) return false;
        // #admin-overlay / #gacha-overlay / #item-detail-overlay: 管理员 / 抽取 / 物品详情 (shown by removing [hidden], not by .show)
        return !!doc.querySelector('.mvu-modal-toggle:checked, .gacha-overlay.show, [class*="overlay"].show, [id$="-overlay"]:not([hidden]), .mvu-detail-modal.show') || !!doc.activeElement?.matches?.('input:not([type]),input[type=text],input[type=number],textarea,select');
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
        if (typeof orig === 'function' && !orig.__zt) { const hub = this;
            // 1.1.1: the original focuses #send_textarea — behind the open terminal that scrolled the whole page up.
            // While the terminal is open the focus is skipped (the text is still written); otherwise it cannot scroll.
            const wrapped = function (...args) {
                const ta = document.querySelector('#send_textarea') || document.querySelector('#send_form textarea');
                const r = withoutFocusScroll(ta, () => orig.apply(this, args), { skipFocus: hub.isOpen });
                resetPageScroll(); if (r) setTimeout(() => this.hubInputWritten?.(), 0); return r;
            }.bind(w); wrapped.__zt = true; w.hubInputWritten = () => this.inputWritten(); w.insertIntoChatInput = wrapped; }
        this.setEngineTab(this.engineTab, true);
        this.onEngine?.(frame, doc);
        this.scheduleEngineView(0);
    }
    /** The engine root once the original finished its first fill (root.__ztDataReady), else null. */
    engineRoot() {
        const f = this.engineFrame; if (!f?.isConnected) return null;
        try { const r = f.contentDocument?.querySelector('.mvu-sys'); return r && r.__ztDataReady ? r : null; } catch { return null; }
    }
    scheduleEngineView(ms = 120) { if (this.dead) return; clearTimeout(this.viewTimer); this.viewTimer = setTimeout(() => this.refreshEngineView(), ms); }
    /** Re-reads the ledger into the visible engine page with the original functions (applyVarsToDisplay: 系统点 / 好感 /
     *  主修功法 / 货币; ztRefreshVisible: the active tab's lists). The panel text itself is not touched. When the engine
     *  was built without a capture (no AI panel yet, e.g. right after 签到) this is what puts the ledger value on screen. */
    refreshEngineView(tries = 0) {
        if (this.dead) return;
        const f = this.engineFrame; if (!f?.isConnected) return;
        const root = this.engineRoot();
        if (!root) { if (tries < 40) this.viewTimer = setTimeout(() => this.refreshEngineView(tries + 1), 250); return; }
        if (this.engineBusy) { this.viewTimer = setTimeout(() => this.refreshEngineView(tries), 900); return; }
        const w = f.contentWindow;
        try { w.applyVarsToDisplay?.(root); } catch (e) { console.warn('[诸天终端] 概览刷新失败', e); }
        try { w.ztRefreshVisible?.(root); } catch (e) { console.warn('[诸天终端] 页面刷新失败', e); }
        this.onEngineView?.(root, f.contentDocument);
    }
    /** 管理员控制台 — 1.1.2: the terminal page (src/admin.js); the original overlay stays reachable from it. */
    async openAdmin() {
        if (!this.a.currentIdentity()) throw Error('请先打开单角色聊天。');
        if (!this.ledger()) throw Error('当前聊天还没有诸天账本，先在「设置 → 新聊天初始化」创建。');
        if (this.pages.has('admin')) { this.go('admin'); return true; }
        return this.openOriginalAdmin();
    }
    /** Original openAdmin overlay — 0.8.0 entry: 设置 → 高级. The ◆ five-click entry is hidden in the terminal. */
    async openOriginalAdmin() {
        if (!this.a.currentIdentity()) throw Error('请先打开单角色聊天。');
        if (!this.ledger()) throw Error('当前聊天还没有诸天账本，先在「设置 → 新聊天初始化」创建。');
        this.open('ov');
        for (let i = 0; i < 60; i++) {
            const root = this.engineRoot(), w = this.engineFrame?.contentWindow;
            if (root && typeof w?.openAdmin === 'function') { await w.openAdmin(root); return true; }
            await new Promise(r => setTimeout(r, 150));
        }
        throw Error('诸天系统页面还没加载好，稍后再试。');
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
        this.dead = true; clearTimeout(this.engineTimer); clearTimeout(this.viewTimer); this.disarmHistory();
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
/* 0.8.0: 莉莉丝's line (and the ◆ admin mark) moved out of the page: she speaks it from the portrait bubble; the admin
   console opens from 设置 → 高级. Native in-message mode keeps the original row. */
html[data-zt-hub] .mvu-msg{display:none!important}
html[data-zt-hub] .mvu-admin-f-sub{visibility:hidden}
html[data-zt-hub] ::-webkit-scrollbar{width:8px;height:8px}html[data-zt-hub] ::-webkit-scrollbar-thumb{background:#8a6aa055;border-radius:8px}
@media (max-width:560px){html[data-zt-hub] .mvu-container{padding:10px 10px 40px!important}}
/* 0.7.0 world themes: colours only (the engine layout never changes) */
html[data-zt-hub][data-zt-world=xianxia],html[data-zt-hub][data-zt-world=xianxia] body{background:#111315!important}
html[data-zt-hub][data-zt-world=xianxia] .mvu-sys{--bg:#111315;--bg2:#15171a;--panel:#191b1d;--panel2:#202323;--input:#0b0c0d;--text:#f1ece0;--muted:#b4ad9a;--faint:#8b8676;--hair:#e8d9b01a;--border:#e8d9b026;--gold:#d4b46c;--jade:#9fcfbf;--violet:#c9b98f;--v-task:#d4b46c;--accent-soft:#2a2618;--accent-line:#8a7440;--btn-hover-bg:#332d1c;--btn-hover-text:#fff5df;--c-hl:#d4b46c}
html[data-zt-hub][data-zt-world=cyber],html[data-zt-hub][data-zt-world=cyber] body{background:#071019!important}
html[data-zt-hub][data-zt-world=cyber] .mvu-sys{--bg:#071019;--bg2:#0a1622;--panel:#0d1c2a;--panel2:#122536;--input:#050c13;--text:#e6f6ff;--muted:#8fb3c6;--faint:#6a8fa3;--hair:#5fe3ff1f;--border:#5fe3ff2e;--gold:#ffd166;--jade:#4fe3ff;--violet:#7fb8ff;--pink:#ff5fae;--v-task:#4fe3ff;--accent-soft:#0f2a3b;--accent-line:#2f7fa3;--btn-hover-bg:#12405a;--btn-hover-text:#eaffff;--c-hl:#4fe3ff}
html[data-zt-hub][data-zt-world=cyber] .mvu-container{background-image:repeating-linear-gradient(0deg,#5fe3ff06 0 1px,transparent 1px 3px)!important}
html[data-zt-hub][data-zt-world=eerie],html[data-zt-hub][data-zt-world=eerie] body{background:#100e0e!important}
html[data-zt-hub][data-zt-world=eerie] .mvu-sys{--bg:#100e0e;--bg2:#141111;--panel:#191515;--panel2:#201a1a;--input:#0b0909;--text:#e9e2dc;--muted:#a79d95;--faint:#857a72;--hair:#ffffff12;--border:#b0484826;--gold:#bba77c;--jade:#b9a58a;--violet:#b39a9a;--pink:#c07070;--v-task:#c27a6a;--accent-soft:#2a1a1a;--accent-line:#6d3a3a;--btn-hover-bg:#3a2222;--btn-hover-text:#ffe9e2;--c-hl:#c9776b}
html[data-zt-hub] .zt-flash{outline:2px solid var(--gold);outline-offset:2px;transition:outline-color 1.4s}
/* 0.9.0 touch screens: 16 px fields — iOS zooms the whole page into smaller ones and stays zoomed */
@media (pointer:coarse){html[data-zt-hub] input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=button]):not([type=submit]),html[data-zt-hub] select,html[data-zt-hub] textarea{font-size:16px!important}}
`;

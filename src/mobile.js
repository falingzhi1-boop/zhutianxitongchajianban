// 0.9.0 手机端适配 — the terminal as a full-screen phone screen.
// Before 0.9.0 the terminal on a phone was the original floating window: 8 px margins, a remembered size (a landscape
// session left a 380 × 354 window behind for portrait use — 122 px of content), the chat input bar showing under it and
// the on-screen keyboard covering the group-chat input. Now, on phones:
//   * the window fills the visible screen and follows the on-screen keyboard (visualViewport), safe areas respected;
//   * portrait keeps the top navigation strip, landscape moves it into a left rail so the content keeps its height;
//   * the focused text field is scrolled into view once the keyboard is up;
//   * 私聊 (#lc-panel, same shadow root) becomes a full-screen sheet too; the close-up band steps aside in landscape
//     and while the keyboard is up;
//   * a full-screen session does not overwrite the remembered desktop window box (keepWindowBox);
//   * inputs use 16 px text (iOS zooms the whole page on smaller ones) and tap targets grow (styles/hub.css).
// Layout only: no chat data, no ledger writes, the original window manager (vendor/original) is untouched — the
// full-screen rules are CSS overrides keyed on dialog[data-zt-mobile]. Setting mobileLayout: auto | full | window.

/** Which phone layout applies (pure, for tests). Returns '' (normal window), 'port' or 'land'. */
export function phoneLayout(mode, { w = 1280, h = 800, coarse = false } = {}) {
    if (mode === 'window') return '';
    const phone = mode === 'full' || w <= 720 || (coarse && Math.min(w, h) <= 600);
    if (!phone) return '';
    return w > h && h <= 520 ? 'land' : 'port';
}
/** Visible-area numbers from a visualViewport-like object (pure, for tests). kb = height hidden by the keyboard. */
export function viewportBox(vv, innerW, innerH) {
    const w = Math.round(vv?.width || innerW), h = Math.round(vv?.height || innerH);
    const top = Math.max(0, Math.round(vv?.offsetTop || 0)), left = Math.max(0, Math.round(vv?.offsetLeft || 0));
    return { w, h, top, left, kb: Math.max(0, Math.round(innerH - h - top)) };
}
/** Full-screen sessions must not overwrite the remembered desktop window box (pure, for tests): any `*_UI` prefs
 *  object keeps its previous `window` (or none). The original window manager saves its box whenever it places the
 *  window — before 0.9.0 a phone session left a phone-sized window behind for the next desktop session. */
export function keepWindowBox(next, prev) {
    let out = next;
    for (const k of Object.keys(next || {})) {
        const v = next[k];
        if (!k.endsWith('_UI') || !v || typeof v !== 'object' || Array.isArray(v) || !('window' in v)) continue;
        const old = prev?.[k]?.window, copy = { ...v };
        if (old && typeof old === 'object') copy.window = { ...old }; else delete copy.window;
        if (out === next) out = { ...next };
        out[k] = copy;
    }
    return out;
}
function clearBox(el) {
    if (!el?.removeAttribute) return;
    el.removeAttribute('data-zt-mobile'); el.removeAttribute('data-zt-kb');
    for (const v of ['--zt-vvh', '--zt-vvw', '--zt-vvt', '--zt-vvl']) el.style?.removeProperty(v);
}
/** Is the on-screen keyboard up? (pure, for tests) Two ways phones show it:
 *   * the visual viewport shrinks, the layout viewport stays (Chrome ≥ 108, Safari): kb = hidden height;
 *   * the whole page is resized (older Android WebViews, interactive-widget=resizes-content): innerHeight itself drops,
 *     so kb stays 0 — then a focused text field plus a page at least 120 px shorter than the tallest seen in this
 *     orientation means the keyboard. Returns 'visual' | 'resize' | ''. */
export function keyboardState({ kb = 0, innerH = 0, fullH = 0, typing = false } = {}) {
    if (kb > 120) return 'visual';
    if (typing && fullH - innerH > 120) return 'resize';
    return '';
}
const TEXT_INPUT = 'input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=button]):not([type=submit]):not([type=file]):not([type=color]),textarea,select,[contenteditable=true]';
/** 1.0: landscape rail — these six stay in the rail, the rest sit behind 「更多」 (the current page always shows). */
export const LAND_PINNED = Object.freeze(['ov', 'task', 'shop', 'bag', 'group', 'set']);
export const MOBILE_LAYOUTS = Object.freeze([['auto', '自动：手机上全屏（推荐）'], ['full', '总是全屏'], ['window', '浮动窗口（0.8.5 及以前的样子）']]);

export class MobileLayout {
    constructor(app) { this.app = app; this.disposers = []; this.mode = ''; this.raf = 0; }
    get settings() { return this.app.settings; }
    get dialog() { return this.app.hub?.shell?.dialog || null; }
    /** True while the terminal is shown full screen (other modules ask before placing things over it). */
    get full() { return !!this.mode; }
    on(target, type, fn, opt) { if (!target) return; target.addEventListener(type, fn, opt); this.disposers.push(() => target.removeEventListener(type, fn, opt)); }
    start() {
        const sync = () => this.schedule();
        this.on(globalThis, 'resize', sync); this.on(globalThis, 'orientationchange', sync);
        this.on(globalThis.visualViewport, 'resize', sync); this.on(globalThis.visualViewport, 'scroll', sync);
        try { const mq = matchMedia('(pointer: coarse)'); this.on(mq, 'change', sync); } catch { /* old browsers */ }
        this.disposers.push(this.settings.onChange(k => { if (k === 'mobileLayout') this.apply(); }));
        if (this.app.bridge?.addScriptFilter) this.disposers.push(this.app.bridge.addScriptFilter((next, prev) => this.full ? keepWindowBox(next, prev) : next));
        const hub = this.app.hub;
        if (hub) {
            hub.hook('onOpen', () => { this.apply(); this.showNav(); }); hub.hook('onClose', () => this.apply());
            hub.hook('onPage', () => { this.app.hub?.shell?.nav?.classList.remove('zt-more-open'); this.landNav(); this.showNav(); });
        }
        const sh = hub?.shadow;
        // keyboard: once it is up, bring the focused field into view inside its own scroll box
        this.on(sh, 'focusin', e => { this.reveal(e.composedPath?.()[0] || e.target); this.schedule(); });
        this.on(sh, 'focusout', () => setTimeout(() => this.schedule(), 60));
        // a scroll inside the terminal hides Lilith's line so it never sits on top of what you are reading
        this.on(sh, 'scroll', () => { if (this.full && this.app.float?.speaking) this.app.float.quiet(); }, { capture: true, passive: true });
        this.apply();
        return this;
    }
    schedule() { if (this.raf || this.dead) return; this.raf = requestAnimationFrame(() => { this.raf = 0; this.apply(); }); }
    apply() {
        const d = this.dialog; if (!d) return;
        let coarse = false; try { coarse = matchMedia('(pointer: coarse)').matches; } catch { /* ignore */ }
        const box = viewportBox(globalThis.visualViewport, innerWidth, innerHeight);
        const mode = phoneLayout(this.settings.get('mobileLayout') || 'auto', { w: innerWidth, h: innerHeight, coarse });
        const host = this.app.hub?.shadow?.host;
        if (!mode) {
            if (this.mode) { clearBox(d); clearBox(host); }
            this.mode = ''; return;
        }
        this.mode = mode;
        if (d.dataset.ztMobile !== mode) { d.dataset.ztMobile = mode; this.landNav(); }
        if (host && host.getAttribute('data-zt-mobile') !== mode) host.setAttribute('data-zt-mobile', mode);
        // tallest layout height seen at this width (a rotation or a resized window starts over)
        if (this.fullW !== innerWidth) { this.fullW = innerWidth; this.fullH = innerHeight; } else this.fullH = Math.max(this.fullH || 0, innerHeight);
        this.kbMode = keyboardState({ kb: box.kb, innerH: innerHeight, fullH: this.fullH, typing: this.typing() });
        const kb = this.kbMode ? 'open' : '';
        if ((d.dataset.ztKb || '') !== kb) { if (kb) d.dataset.ztKb = kb; else delete d.dataset.ztKb; }
        if (host && (host.getAttribute('data-zt-kb') || '') !== kb) { if (kb) host.setAttribute('data-zt-kb', kb); else host.removeAttribute('data-zt-kb'); }
        // the same numbers on the dialog (terminal) and on the shadow host (private chat #lc-panel lives in that shadow)
        for (const el of [d, host]) {
            if (!el?.style) continue;
            const set = (k, v) => { if (el.style.getPropertyValue(k) !== v) el.style.setProperty(k, v); };
            set('--zt-vvh', box.h + 'px'); set('--zt-vvw', box.w + 'px'); set('--zt-vvt', box.top + 'px'); set('--zt-vvl', box.left + 'px');
        }
    }
    /** 1.0: the landscape rail had ~20 entries and had to be scrolled — six common ones + 「更多」 now. */
    landNav() {
        const nav = this.app.hub?.shell?.nav; if (!nav) return;
        const btns = [...nav.querySelectorAll('.nav-button[data-page]')];
        for (const b of btns) b.toggleAttribute('data-pin', LAND_PINNED.includes(b.dataset.page));
        let more = nav.querySelector('.zt-nav-more');
        if (!more) {
            more = document.createElement('button'); more.type = 'button'; more.className = 'nav-button zt-nav-more'; more.setAttribute('aria-expanded', 'false');
            more.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><circle cx="5" cy="12" r="2" fill="currentColor"/><circle cx="12" cy="12" r="2" fill="currentColor"/><circle cx="19" cy="12" r="2" fill="currentColor"/></svg><span>更多</span>';
            more.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); const open = nav.classList.toggle('zt-more-open'); more.setAttribute('aria-expanded', String(open)); more.querySelector('span').textContent = open ? '收起' : '更多'; if (open) this.showNav(); });
            nav.append(more);
        } else if (more !== nav.lastElementChild) nav.append(more);
        if (!nav.classList.contains('zt-more-open')) { more.setAttribute('aria-expanded', 'false'); more.querySelector('span').textContent = '更多'; }
        more.title = `其余 ${btns.filter(b => !b.hasAttribute('data-pin')).length} 个页面`;
    }
    /** The navigation strip / rail scrolls: keep the current page's button in sight (links jump to pages far down it). */
    showNav() {
        if (!this.full) return;
        const nav = this.app.hub?.shell?.nav, b = nav?.querySelector('.nav-button[aria-selected=true]'); if (!b) return;
        const n = nav.getBoundingClientRect(), r = b.getBoundingClientRect();
        if (this.mode === 'land') { const box = nav.closest('.sidebar') || nav, s = box.getBoundingClientRect(); if (r.top < s.top || r.bottom > s.bottom) box.scrollTop += r.top - s.top - (s.height - r.height) / 2; }
        else if (r.left < n.left || r.right > n.right) nav.scrollLeft += r.left - n.left - (n.width - r.width) / 2;
    }
    /** A text field inside the terminal / private chat has the focus. */
    typing() {
        try { let a = document.activeElement; while (a?.shadowRoot?.activeElement) a = a.shadowRoot.activeElement; return !!a?.matches?.(TEXT_INPUT); } catch { return false; }
    }
    reveal(el) {
        if (!this.full || !el?.matches?.(TEXT_INPUT)) return;
        clearTimeout(this.revealT);
        // the keyboard animates in for ~250–400 ms; scroll after it settled, only inside the terminal's own scroll boxes
        this.revealT = setTimeout(() => { try { if (el.isConnected && el.getRootNode()?.activeElement === el) el.scrollIntoView({ block: 'center', inline: 'nearest' }); } catch { /* ignore */ } }, 420);
    }
    dispose() {
        this.dead = true; clearTimeout(this.revealT); if (this.raf) cancelAnimationFrame(this.raf);
        this.disposers.splice(0).forEach(f => { try { f(); } catch { /* ignore */ } });
        clearBox(this.dialog); clearBox(this.app.hub?.shadow?.host);
        this.mode = '';
    }
}

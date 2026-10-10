// 1.1 touch floating window + circular launcher. Does not alter the portrait's gesture owner.
import { keepWindowBox } from './mobile.js';
import { FLOAT_SIZES, BIN_CSS, binHtml, showBinAt, binHit, binHot, swapFloat, closeFloats } from './lilith-float.js';
export function clampBox(b, v) {
    const w = Math.max(180, Math.min(v.w - 16, Number(b.w) || v.w - 24));
    const h = Math.max(180, Math.min(v.h - 24, Number(b.h) || v.h * .8));
    return { w: Math.min(w, v.w), h: Math.min(h, v.h), x: Math.max(v.x, Math.min(v.x + v.w - w, Number(b.x) || v.x + 8)), y: Math.max(v.y, Math.min(v.y + v.h - h, Number(b.y) || v.y + 8)) };
}
export function launcherPosition(p, v, size = 64) {
    const edge = p.edge === 'right' ? 'right' : 'left', tucked = !!p.tucked;
    return { x: tucked ? (edge === 'left' ? v.x - size + 18 : v.x + v.w - 18) : Math.max(v.x + 4, Math.min(v.x + v.w - size - 4, Number(p.x) || v.x + 18)), y: Math.max(v.y + 8, Math.min(v.y + v.h - size - 12, Number(p.y) || v.y + v.h / 2)), edge, tucked };
}
/**
 * 1.1.1: where the docked avatar (#entry, 44 px) belongs (pure, for tests). The original placer centres it on the
 * header measured from the WINDOW top; a full-screen phone window pads its top by the status-bar inset, so the avatar
 * landed in the phone status bar (hard to tap — the system pulls down its shade). Measured from the HEADER instead.
 * `base` = where the avatar is without our shift; returns the translate that moves it, or null when nothing to do.
 */
export function dockShift(base, header, inset = 13, size = 44, anchor = null) {
    if (!header || !(header.h > 0)) return null;
    // anchor = the centre of the header's own avatar picture (私聊 sheet): sit exactly on it, no double ring
    const x = anchor ? anchor.cx - size / 2 : header.left + inset, y = anchor ? anchor.cy - size / 2 : header.top + Math.max(4, (header.h - size) / 2);
    const dx = Math.round(x - base.left), dy = Math.round(y - base.top);
    return Math.abs(dx) <= 1 && Math.abs(dy) <= 1 ? null : { dx, dy };
}
export class WindowControls {
    constructor(app) { this.app = app; this.off = []; }
    on(t, e, f, opts) { if (!t) return; t.addEventListener(e, f, opts); this.off.push(() => t.removeEventListener(e, f, opts)); }
    coarse() { return matchMedia('(pointer:coarse)').matches || innerWidth <= 720; }
    /** 1.1.1: the phone status bar / notch / home bar (CSS safe-area insets; 0 on desktop and in normal browser tabs). */
    insets() {
        try {
            const p = document.createElement('div');
            p.style.cssText = 'position:fixed;left:0;top:0;visibility:hidden;pointer-events:none;padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px)';
            document.body.append(p); const c = getComputedStyle(p), n = k => parseFloat(c[k]) || 0;
            const r = { top: n('paddingTop'), right: n('paddingRight'), bottom: n('paddingBottom'), left: n('paddingLeft') }; p.remove(); return r;
        } catch { return { top: 0, right: 0, bottom: 0, left: 0 }; }
    }
    /** Visible area minus the safe-area insets, so the floating window and the round launcher stay out of the status bar. */
    viewport() {
        const v = visualViewport, i = this.ins || (this.ins = this.insets()), x = v?.offsetLeft || 0, y = v?.offsetTop || 0, w = v?.width || innerWidth, h = v?.height || innerHeight;
        return { x: x + i.left, y: y + i.top, w: Math.max(200, w - i.left - i.right), h: Math.max(200, h - i.top - i.bottom) };
    }
    start() {
        const h = this.app.hub; if (!h) return this;
        this.sh = h.shadow; this.d = h.shell.dialog; this.entry = this.sh.getElementById('entry');
        const style = document.createElement('style'); style.textContent = `#zt-layout-toggle{font-size:11px!important;min-width:48px!important;width:auto!important;padding:6px!important}#zt-touch-resize{display:none;position:absolute;bottom:5px;right:5px;width:44px;height:44px;touch-action:none;background:#503a63;color:#fff;border-radius:12px;z-index:20;font-size:23px}:host([data-zt-touch-window]) #zt-touch-resize{display:block}:host([data-zt-touch-window]) #drag-handle{touch-action:none!important}:host([data-zt-touch-window]) dialog{min-width:0!important;min-height:0!important}#entry[data-zt-tucked=true]{opacity:.72;transition:opacity .2s}#entry[data-zt-tucked=true]:focus-visible{opacity:1}`;
        this.sh.append(style); this.off.push(() => style.remove());
        // 1.1.3: avatar size (setting avatarSize, 20 %–100 %) and the drag targets 「换成莉莉丝」 / 「关闭悬浮窗」
        const size = document.createElement('style'); size.id = 'zt-avatar-size'; this.sizeStyle = size;
        const binStyle = document.createElement('style'); binStyle.textContent = BIN_CSS.replaceAll('.bin', '#zt-entry-bin');
        const holder = document.createElement('div'); holder.innerHTML = binHtml('换成莉莉丝', 'zt-entry-bin', 'zt-entry-bin'); this.bin = holder.firstElementChild;
        this.sh.append(size, binStyle, this.bin); this.off.push(() => { size.remove(); binStyle.remove(); this.bin.remove(); });
        this.applySize();
        const b = document.createElement('button'); b.type = 'button'; b.id = 'zt-layout-toggle'; b.title = '切换全屏 / 可拖动浮窗'; h.shell.header?.prepend(b); this.toggle = b;
        this.on(b, 'click', e => { e.stopPropagation(); this.app.settings.set('mobileLayout', this.app.mobile?.full ? 'window' : 'full'); this.app.mobile?.apply(); this.sync(true); });
        const grip = document.createElement('button'); grip.type = 'button'; grip.id = 'zt-touch-resize'; grip.textContent = '⤡'; grip.setAttribute('aria-label', '拖动调整窗口大小'); this.d.append(grip); this.off.push(() => { b.remove(); grip.remove(); });
        this.off.push(this.app.bridge.addScriptFilter((next, prev) => this.coarse() ? keepWindowBox(next, prev) : next));
        const schedule = () => { if (!this.raf) this.raf = requestAnimationFrame(() => { this.raf = 0; this.sync(); }); };
        this.on(window, 'resize', schedule); this.on(visualViewport, 'resize', schedule); this.on(visualViewport, 'scroll', schedule);
        // 1.1.1: the header only has its final box after the open animation (terminal / 私聊) — re-dock the avatar then
        this.on(this.sh, 'animationend', schedule); this.on(this.sh, 'transitionend', schedule);
        this.off.push(this.app.settings.onChange(k => { if (k === 'mobileLayout') this.sync(true); if (k === 'avatarSize') { this.applySize(); this.sync(true); } }));
        h.hook('onOpen', () => this.sync(true)); h.hook('onClose', schedule);
        this.obs = new MutationObserver(schedule); this.obs.observe(this.d, { attributes: true, attributeFilter: ['open', 'style'] });
        if (this.entry) this.obs.observe(this.entry, { attributes: true, attributeFilter: ['data-docked', 'style'] });
        this.on(this.sh, 'click', e => {
            if (!this.coarse() || !e.target.closest?.('#reset-window')) return;
            e.preventDefault(); e.stopImmediatePropagation(); this.cancel();
            this.app.settings.set('touchWindowBox', null); this.sync(true);
        }, true);
        this.on(this.sh, 'pointerdown', e => this.down(e), true);
        this.on(this.sh, 'pointermove', e => this.move(e), true);
        this.on(this.sh, 'pointerup', e => this.end(e), true);
        this.on(this.sh, 'pointercancel', e => this.end(e, true), true);
        this.on(this.sh, 'lostpointercapture', e => { if (this.g?.id === e.pointerId) { this.cancel(); this.sync(true); } }, true);
        this.on(window, 'blur', () => this.cancel()); this.on(document, 'visibilitychange', () => { if (document.hidden) this.cancel(); });
        this.on(this.sh, 'click', e => { if (e.isTrusted && Date.now() < (this.suppress || 0) && (e.composedPath().includes(this.entry) || e.target === grip)) { e.preventDefault(); e.stopImmediatePropagation(); } }, true);
        this.sync(true); return this;
    }
    sync(force = false) {
        if (this.dead) return;
        const touch = this.coarse(), floating = touch && !this.app.mobile?.full;
        this.sh.host.toggleAttribute('data-zt-touch-window', floating);
        this.toggle.textContent = this.app.mobile?.full ? '浮窗' : '全屏'; this.toggle.setAttribute('aria-label', this.app.mobile?.full ? '切换浮窗，支持拖动缩放' : '切换全屏');
        if (!this.g) this.ins = this.insets(); // re-read on rotation / resize, not on every drag move
        const view = this.viewport(), sig = JSON.stringify(view), resized = sig !== this.viewSig; this.viewSig = sig;
        if (floating && !this.g && (force || resized || !this.wasFloat)) this.placeWindow(this.app.settings.get('touchWindowBox') || {});
        this.wasFloat = floating;
        if (!this.g && this.entry?.dataset.docked !== 'true') { this.dockTr = null; this.placeLauncher(); }
        else if (this.entry?.dataset.docked === 'true') { delete this.entry.dataset.ztTucked; this.placeDocked(); }
    }
    /**
     * 1.1.1: keep the docked avatar inside the header (below the phone status bar), never above it. Measured from the
     * live boxes (minus our own shift), so a position the original placer took mid open-animation is corrected too.
     */
    placeDocked() {
        const e = this.entry; if (!e) return null;
        const chat = this.sh.getElementById('lc-panel'), chatOn = !!chat && !chat.hidden;
        // phone: 私聊 is a full-screen sheet over the terminal, so the avatar belongs to the sheet's header even though
        // the original placer still docks it to the (covered) terminal window
        const sheet = chatOn && (!this.d.open || this.sh.host.hasAttribute('data-zt-mobile')), inDialog = this.d.open && !sheet;
        const head = (inDialog || sheet) && this.sh.getElementById(sheet ? 'lc-head' : 'drag-handle');
        const pic = sheet ? head?.querySelector(':scope>img')?.getBoundingClientRect() : null;
        const anchor = pic?.width ? { cx: pic.left + pic.width / 2, cy: pic.top + pic.height / 2 } : null;
        const r = head?.getBoundingClientRect(), er = e.getBoundingClientRect(), cur = this.dockTr || { dx: 0, dy: 0 };
        const shift = r && er.width ? dockShift({ left: er.left - cur.dx, top: er.top - cur.dy }, { left: r.left, top: r.top, h: r.height }, inDialog ? 13 : 18, 44, anchor) : null;
        if (!shift && r && er.width && cur.dx === 0 && cur.dy === 0 && !e.style.transform) return null;
        this.dockTr = shift || { dx: 0, dy: 0 };
        const tr = shift ? `translate(${shift.dx}px,${shift.dy}px)` : '';
        if (e.style.transform !== tr) { if (tr) e.style.transform = tr; else e.style.removeProperty('transform'); }
        return shift;
    }
    placeWindow(box) {
        const b = clampBox(box, this.viewport()); this.box = b;
        Object.assign(this.d.style, { left: b.x + 'px', top: b.y + 'px', width: b.w + 'px', height: b.h + 'px' });
        this.d.style.setProperty('--zt-window-height', b.h + 'px'); return b;
    }
    /** 1.1.3: scale the undocked launcher (round avatar on phones, pill on desktop); `scale` keeps the top-left corner. */
    applySize() {
        const k = FLOAT_SIZES[this.app.settings.get('avatarSize')] || 1; this.k = k;
        if (this.sizeStyle) this.sizeStyle.textContent = k === 1 ? '' : `#entry:not([data-docked=true]){scale:${k};transform-origin:0 0}`;
    }
    placeLauncher(pos = this.app.settings.get('circlePosition') || {}) {
        if (!this.entry || this.entry.dataset.docked === 'true') return;
        const r = this.entry.getBoundingClientRect(), size = r.width || 64, p = launcherPosition(pos, this.viewport(), size);
        // The legacy placer writes left/top on dialog changes. Transform accounts for that without fighting its observer.
        const x = parseFloat(this.entry.style.left) || 0, y = parseFloat(this.entry.style.top) || 0;
        const k = this.k || 1;   // the scale applies after the transform → divide the shift so the box lands at p
        const tr = `translate(${+((p.x - x) / k).toFixed(2)}px,${+((p.y - y) / k).toFixed(2)}px)`;
        if (this.entry.style.transform !== tr) this.entry.style.transform = tr;
        this.entry.dataset.ztTucked = String(p.tucked); this.lp = p; return p;
    }
    down(e) {
        const path = e.composedPath(), launcher = path.includes(this.entry) && this.entry?.dataset.docked !== 'true';
        const resize = path.some(x => x.id === 'zt-touch-resize');
        const head = path.some(x => x.id === 'drag-handle' || x.classList?.contains('zt-fb-head'));
        if (!launcher && !(this.coarse() && !this.app.mobile?.full && (resize || head) && (!e.target.closest('button,input,select,textarea,a') || resize))) return;
        if (e.isPrimary === false || e.button !== 0) return;
        e.preventDefault(); e.stopImmediatePropagation(); this.cancel();
        const el = launcher ? this.entry : this.d, r = el.getBoundingClientRect();
        this.g = { id: e.pointerId, el, launcher, resize, sx: e.clientX, sy: e.clientY, initial: { x: r.x, y: r.y, w: r.width, h: r.height }, moved: false, tucked: this.lp?.tucked };
        try { el.setPointerCapture(e.pointerId); } catch { /* still cancellable */ }
    }
    move(e) {
        const g = this.g; if (!g || e.pointerId !== g.id) return;
        e.preventDefault(); e.stopImmediatePropagation(); const dx = e.clientX - g.sx, dy = e.clientY - g.sy;
        if (!g.moved && Math.abs(dx) + Math.abs(dy) < 6) return;
        if (!g.moved && g.launcher) showBinAt(this.bin);
        g.moved = true;
        if (g.launcher) { const hot = binHit(this.bin, e.clientX, e.clientY); if (hot !== g.hot) { g.hot = hot; binHot(this.bin, hot); if (hot) navigator.vibrate?.(6); } }
        const b = { ...g.initial };
        if (g.resize) { b.w += dx; b.h += dy; } else { b.x += dx; b.y += dy; }
        if (g.launcher) this.placeLauncher({ ...b, tucked: false }); else this.placeWindow(b);
    }
    end(e, cancel = false) {
        const g = this.g; if (!g || e.pointerId !== g.id) return;
        e.preventDefault(); e.stopImmediatePropagation(); this.g = null; this.suppress = Date.now() + 600;
        try { g.el.releasePointerCapture(g.id); } catch { /* pointer already released */ }
        const target = g.launcher && g.moved && !cancel ? (binHit(this.bin, e.clientX, e.clientY) || g.hot || '') : '';
        this.hideBin();
        if (cancel) { this.sync(true); return; }
        if (target) {   // 1.1.3: dropped on 「换成莉莉丝」(切换) or 「关闭悬浮窗」(关闭) — the avatar goes back to where it was
            this.placeLauncher();
            if (target === 'swap' && this.app.persona?.lilith === false) { this.sync(true); return; }   // 1.1.5: no floating figure for other personas
            if (target === 'swap') { swapFloat(this.app, 'lilith'); globalThis.toastr?.info('拖动莉莉丝到屏幕底部可以换回头像，或关闭悬浮窗。', '诸天 · 已切换成悬浮莉莉丝', { timeOut: 5000 }); }
            else void closeFloats(this.app);
            return;
        }
        if (g.launcher) {
            if (!g.moved && !g.tucked) { this.entry.click(); return; }
            const v = this.viewport(), p = this.lp || g.initial, size = g.initial.w;
            const edge = p.x + size / 2 < v.x + v.w / 2 ? 'left' : 'right';
            const tucked = g.moved && (p.x <= v.x + 26 || p.x + size >= v.x + v.w - 26);
            const next = { ...p, tucked, edge };
            if (!g.moved && g.tucked) next.x = edge === 'left' ? v.x + 10 : v.x + v.w - size - 10;
            this.app.settings.set('circlePosition', next); this.placeLauncher(next);
        } else this.app.settings.set('touchWindowBox', this.box);
    }
    hideBin() { this.bin?.classList.remove('show'); binHot(this.bin, ''); }
    cancel() { this.hideBin(); const g = this.g; this.g = null; if (g) try { g.el.releasePointerCapture(g.id); } catch { /* no capture */ } }
    dispose() { this.dead = true; this.cancel(); cancelAnimationFrame(this.raf); this.obs?.disconnect(); this.off.splice(0).forEach(f => f()); this.sh?.host.removeAttribute('data-zt-touch-window'); this.entry?.style.removeProperty('transform'); }
}

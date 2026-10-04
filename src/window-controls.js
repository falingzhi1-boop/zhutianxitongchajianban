// 1.1 touch floating window + circular launcher. Does not alter the portrait's gesture owner.
import { keepWindowBox } from './mobile.js';
export function clampBox(b, v) {
    const w = Math.max(180, Math.min(v.w - 16, Number(b.w) || v.w - 24));
    const h = Math.max(180, Math.min(v.h - 24, Number(b.h) || v.h * .8));
    return { w: Math.min(w, v.w), h: Math.min(h, v.h), x: Math.max(v.x, Math.min(v.x + v.w - w, Number(b.x) || v.x + 8)), y: Math.max(v.y, Math.min(v.y + v.h - h, Number(b.y) || v.y + 8)) };
}
export function launcherPosition(p, v, size = 64) {
    const edge = p.edge === 'right' ? 'right' : 'left', tucked = !!p.tucked;
    return { x: tucked ? (edge === 'left' ? v.x - size + 18 : v.x + v.w - 18) : Math.max(v.x + 4, Math.min(v.x + v.w - size - 4, Number(p.x) || v.x + 18)), y: Math.max(v.y + 8, Math.min(v.y + v.h - size - 12, Number(p.y) || v.y + v.h / 2)), edge, tucked };
}
export class WindowControls {
    constructor(app) { this.app = app; this.off = []; }
    on(t, e, f, opts) { if (!t) return; t.addEventListener(e, f, opts); this.off.push(() => t.removeEventListener(e, f, opts)); }
    coarse() { return matchMedia('(pointer:coarse)').matches || innerWidth <= 720; }
    viewport() { const v = visualViewport; return { x: v?.offsetLeft || 0, y: v?.offsetTop || 0, w: v?.width || innerWidth, h: v?.height || innerHeight }; }
    start() {
        const h = this.app.hub; if (!h) return this;
        this.sh = h.shadow; this.d = h.shell.dialog; this.entry = this.sh.getElementById('entry');
        const style = document.createElement('style'); style.textContent = `#zt-layout-toggle{font-size:11px!important;min-width:48px!important;width:auto!important;padding:6px!important}#zt-touch-resize{display:none;position:absolute;bottom:5px;right:5px;width:44px;height:44px;touch-action:none;background:#503a63;color:#fff;border-radius:12px;z-index:20;font-size:23px}:host([data-zt-touch-window]) #zt-touch-resize{display:block}:host([data-zt-touch-window]) #drag-handle{touch-action:none!important}:host([data-zt-touch-window]) dialog{min-width:0!important;min-height:0!important}#entry[data-zt-tucked=true]{opacity:.72;transition:opacity .2s}#entry[data-zt-tucked=true]:focus-visible{opacity:1}`;
        this.sh.append(style); this.off.push(() => style.remove());
        const b = document.createElement('button'); b.type = 'button'; b.id = 'zt-layout-toggle'; b.title = '切换全屏 / 可拖动浮窗'; h.shell.header?.prepend(b); this.toggle = b;
        this.on(b, 'click', e => { e.stopPropagation(); this.app.settings.set('mobileLayout', this.app.mobile?.full ? 'window' : 'full'); this.app.mobile?.apply(); this.sync(true); });
        const grip = document.createElement('button'); grip.type = 'button'; grip.id = 'zt-touch-resize'; grip.textContent = '⤡'; grip.setAttribute('aria-label', '拖动调整窗口大小'); this.d.append(grip); this.off.push(() => { b.remove(); grip.remove(); });
        this.off.push(this.app.bridge.addScriptFilter((next, prev) => this.coarse() ? keepWindowBox(next, prev) : next));
        const schedule = () => { if (!this.raf) this.raf = requestAnimationFrame(() => { this.raf = 0; this.sync(); }); };
        this.on(window, 'resize', schedule); this.on(visualViewport, 'resize', schedule); this.on(visualViewport, 'scroll', schedule);
        this.off.push(this.app.settings.onChange(k => { if (k === 'mobileLayout') this.sync(true); }));
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
        const view = this.viewport(), sig = JSON.stringify(view), resized = sig !== this.viewSig; this.viewSig = sig;
        if (floating && !this.g && (force || resized || !this.wasFloat)) this.placeWindow(this.app.settings.get('touchWindowBox') || {});
        this.wasFloat = floating;
        if (!this.g && this.entry?.dataset.docked !== 'true') this.placeLauncher();
        else if (this.entry?.dataset.docked === 'true') { this.entry.style.removeProperty('transform'); delete this.entry.dataset.ztTucked; }
    }
    placeWindow(box) {
        const b = clampBox(box, this.viewport()); this.box = b;
        Object.assign(this.d.style, { left: b.x + 'px', top: b.y + 'px', width: b.w + 'px', height: b.h + 'px' });
        this.d.style.setProperty('--zt-window-height', b.h + 'px'); return b;
    }
    placeLauncher(pos = this.app.settings.get('circlePosition') || {}) {
        if (!this.entry || this.entry.dataset.docked === 'true') return;
        const r = this.entry.getBoundingClientRect(), size = r.width || 64, p = launcherPosition(pos, this.viewport(), size);
        // The legacy placer writes left/top on dialog changes. Transform accounts for that without fighting its observer.
        const x = parseFloat(this.entry.style.left) || 0, y = parseFloat(this.entry.style.top) || 0;
        const tr = `translate(${p.x - x}px,${p.y - y}px)`;
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
        if (!g.moved && Math.abs(dx) + Math.abs(dy) < 6) return; g.moved = true;
        const b = { ...g.initial };
        if (g.resize) { b.w += dx; b.h += dy; } else { b.x += dx; b.y += dy; }
        if (g.launcher) this.placeLauncher({ ...b, tucked: false }); else this.placeWindow(b);
    }
    end(e, cancel = false) {
        const g = this.g; if (!g || e.pointerId !== g.id) return;
        e.preventDefault(); e.stopImmediatePropagation(); this.g = null; this.suppress = Date.now() + 600;
        try { g.el.releasePointerCapture(g.id); } catch { /* pointer already released */ }
        if (cancel) { this.sync(true); return; }
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
    cancel() { const g = this.g; this.g = null; if (g) try { g.el.releasePointerCapture(g.id); } catch { /* no capture */ } }
    dispose() { this.dead = true; this.cancel(); cancelAnimationFrame(this.raf); this.obs?.disconnect(); this.off.splice(0).forEach(f => f()); this.sh?.host.removeAttribute('data-zt-touch-window'); this.entry?.style.removeProperty('transform'); }
}

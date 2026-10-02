// 1.0 动态效果：低端机自动降级.
// Setting `motion`: auto (default) | full | lite.
//   auto → lite when the system asks for reduced motion, or when a touch device draws fewer than 40 frames per second
//          in a 2-second sample taken once per session (6 s after start, so SillyTavern's own loading is not counted).
//   lite → the floating Lilith stops breathing / swaying and drops her shadow filter; world decorations and the
//          terminal's own decorative animations stop; 演出 shows only the result card. Nothing functional changes.
export const MOTION_OPTIONS = Object.freeze([['auto', '自动（系统要求减少动态效果，或手机明显卡顿时降级）'], ['full', '完整'], ['lite', '精简（低端机推荐）']]);
export const LOW_FPS = 40;

/** Should the lite visuals be used? (pure) */
export function decideLite(mode, { reduced = false, fps = 0, coarse = false } = {}) {
    if (mode === 'lite') return true;
    if (mode === 'full') return false;
    return !!reduced || (coarse && fps > 0 && fps < LOW_FPS);
}

export class Perf {
    constructor(app) { this.app = app; this.fps = 0; this.lite = false; this.disposers = []; }
    get settings() { return this.app.settings; }
    start() {
        this.disposers.push(this.settings.onChange(k => { if (k === 'motion') this.apply(); }));
        try { const mq = matchMedia('(prefers-reduced-motion: reduce)'); const f = () => this.apply(); mq.addEventListener?.('change', f); this.disposers.push(() => mq.removeEventListener?.('change', f)); } catch { /* old browsers */ }
        this.timer = setTimeout(() => this.sample(), 6000);
        this.apply();
        return this;
    }
    sample(ms = 2000) {
        if (this.dead || document.visibilityState === 'hidden') return;
        let n = 0; const t0 = performance.now();
        const tick = t => { if (this.dead) return; n++; if (t - t0 < ms) requestAnimationFrame(tick); else { this.fps = Math.round(n * 1000 / (t - t0)); this.apply(); } };
        requestAnimationFrame(tick);
    }
    apply() {
        let reduced = false, coarse = false;
        try { reduced = matchMedia('(prefers-reduced-motion: reduce)').matches; coarse = matchMedia('(pointer: coarse)').matches; } catch { /* ignore */ }
        const mode = this.settings.get('motion') || 'auto';
        this.lite = decideLite(mode, { reduced, fps: this.fps, coarse });
        this.reason = mode !== 'auto' ? `设置为「${mode === 'lite' ? '精简' : '完整'}」` : reduced ? '系统要求减少动态效果' : this.lite ? `帧率 ${this.fps} fps` : this.fps ? `帧率 ${this.fps} fps，正常` : '尚未测量';
        const host = this.app.hub?.shadow?.host;
        if (host) host.toggleAttribute('data-zt-lite', this.lite);
        const fl = this.app.float?.el; if (fl) fl.dataset.lite = String(this.lite);
        document.documentElement.toggleAttribute('data-zt-lite', this.lite);
    }
    dispose() { this.dead = true; clearTimeout(this.timer); this.disposers.splice(0).forEach(f => { try { f(); } catch { /* ignore */ } }); this.app.hub?.shadow?.host?.removeAttribute('data-zt-lite'); document.documentElement.removeAttribute('data-zt-lite'); }
}

// 0.8.2 悬浮莉莉丝 — the phone launcher.
// On phones the terminal window is too small for the original standing portrait (the original hides it below 600 px
// height / in the compact layout), so Lilith was never seen there. The floating launcher becomes her portrait instead:
//   tap            → open the terminal (terminal already open: she only talks — never moves, never closes it)
//   double tap     → poke: a reaction line + expression
//   long press     → pick her up and drag (mouse: just drag); drop near the left/right edge → she hides behind it
//                    (tucked, only a peek visible) and stays there; tap the peek → she comes out
//   position / tucked state are saved (extension settings), the terminal opening tucks her temporarily
//   size: setting floatSize (0.8.3), default 75 % of the 0.8.2 size
// Every line the portrait bubble would say while the portrait is not visible (system broadcast, reactions, results)
// pops up next to her here instead — so her dialogue reaches the front even without the portrait.
// Art: the original expression stills in assets/lilith/variants (head-and-shoulders crop). No model calls, no ledger writes.
import { storyLines, IDLE } from './lilith-stage.js';

const MOODS = ['neutral', 'smile', 'shy', 'pout', 'surprised', 'wink', 'smug', 'sad'];
export const ZONE_MOOD = Object.freeze({ wing: 'smile', lower: 'sad', horn: 'smug', chest: 'neutral', cheek: 'shy', thigh: 'pout', arm: 'wink', head: 'smile', hair: 'smile', tail: 'surprised' });
export const POKE_LINES = Object.freeze(['呀！戳哪里呢～', '再戳就收你系统点了哦。', '嗯？有事要莉莉丝帮忙？', '别闹，正在帮你盯账本呢。', '好啦好啦，我在。']);
const W = 78, H = 104, EDGE = 26, PEEK = 30;          // full size (0.8.2 default); actual size = × floatSize scale
/** 0.8.3 悬浮莉莉丝大小. Default 'm' (75 %) — 0.8.2's full size was too big on phones. */
export const FLOAT_SIZES = Object.freeze({ xs: 0.55, s: 0.65, m: 0.75, l: 0.9, xl: 1 });
export function floatDims(size) { const k = FLOAT_SIZES[size] || FLOAT_SIZES.m; return { w: Math.round(W * k), h: Math.round(H * k), peek: Math.max(24, Math.round(PEEK * k)), k }; }
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/** Where a released float goes (pure, for tests): near an edge → tucked against it; otherwise stays, clamped. */
export function settle({ x, y }, vw, vh, w = W, h = H) {
    const top = clamp(y, 8, Math.max(8, vh - h - 8));
    if (x < EDGE) return { x: 0, y: top, edge: 'left', tucked: true };
    if (x + w > vw - EDGE) return { x: vw - w, y: top, edge: 'right', tucked: true };
    return { x: clamp(x, 4, Math.max(4, vw - w - 4)), y: top, edge: '', tucked: false };
}
/** A saved spot that is NOT tucked: keep it on screen, never tuck it again (0.8.3 — settle() is only for a drop; using it
 *  here re-hid her after every terminal close / rotation / reload, since "come out" puts her 8 px from the edge). */
export function keepOnScreen({ x, y }, vw, vh, w = W, h = H) {
    return { x: clamp(x, 4, Math.max(4, vw - w - 4)), y: clamp(y, 8, Math.max(8, vh - h - 8)), edge: '', tucked: false };
}
/** Should the floating portrait be used? auto = touch / narrow screens. */
export function wantFloat(mode, { coarse = false, width = 1280 } = {}) { return mode === 'on' || (mode !== 'off' && (coarse || width <= 720)); }

const CSS = `
:host{all:initial}
.fl{position:fixed;left:0;top:0;width:var(--w,${W}px);height:var(--h,${H}px);z-index:2147483100;touch-action:none;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none;transition:transform .42s cubic-bezier(.2,.9,.25,1.15),opacity .3s;will-change:transform}
.fl[hidden]{display:none}
.fl.drag{transition:none}
.fig{position:absolute;inset:0;padding:0;margin:0;border:1px solid #d9b6ee88;border-radius:calc(var(--w,${W}px) / 2) calc(var(--w,${W}px) / 2) calc(var(--k,1) * 20px) calc(var(--k,1) * 20px);overflow:hidden;background:#1d1328;box-shadow:0 10px 26px #000a,0 0 18px #b47ae044;cursor:pointer;outline:none;animation:zt-bob 3.4s ease-in-out infinite;-webkit-tap-highlight-color:transparent}
.fig:focus-visible{box-shadow:0 0 0 3px #e3c4ff,0 10px 26px #000a}
.fig img{position:absolute;left:-46%;top:-3%;width:192%;height:auto;pointer-events:none;opacity:0;transition:opacity .35s}
.fig img.on{opacity:1}
.fig::after{content:"";position:absolute;inset:0;border-radius:inherit;background:linear-gradient(180deg,transparent 62%,#1a1024cc);pointer-events:none}
.gem{position:absolute;right:calc(var(--k,1) * 7px);bottom:calc(var(--k,1) * 8px);width:calc(var(--k,1) * 8px);height:calc(var(--k,1) * 8px);transform:rotate(45deg);background:#c99be6;box-shadow:0 0 10px #c99be6;z-index:2;pointer-events:none}
.fl.drag .fig{animation:none;transform:scale(1.08) rotate(-3deg);box-shadow:0 18px 36px #000c,0 0 24px #c99be688}
.fl[data-tucked=true] .fig{animation:zt-peek 4s ease-in-out infinite}
.fl[data-tucked=true][data-edge=left] .fig{transform-origin:100% 60%}
.fl[data-tucked=true][data-edge=right] .fig{transform-origin:0 60%}
.fl.hide-anim .fig{animation:zt-hide .5s ease-out 1}
.bubble{position:absolute;bottom:calc(100% + 8px);max-width:min(260px,calc(100vw - 24px));width:max-content;padding:9px 12px;border-radius:14px;border:1px solid #c9a2ef66;background:linear-gradient(135deg,#2a1d38f2,#1a1124f2);color:#f3e9fb;font:13px/1.6 -apple-system,"PingFang SC","Microsoft YaHei",sans-serif;box-shadow:0 8px 24px #000a;opacity:0;transform:translateY(6px) scale(.96);transition:opacity .22s,transform .22s;pointer-events:none;white-space:normal;word-break:break-word}
.bubble b{display:block;font-size:10px;letter-spacing:2px;color:#d8bf92;margin-bottom:2px;font-weight:600}
.bubble.show{opacity:1;transform:none;pointer-events:auto}
.fl[data-side=left] .bubble{left:0}
.fl[data-side=right] .bubble{right:0}
.fl[data-low=true] .bubble{bottom:auto;top:calc(100% + 8px)}
@keyframes zt-bob{0%,100%{translate:0 0}50%{translate:0 -3px}}
@keyframes zt-peek{0%,82%,100%{rotate:0deg}88%{rotate:-4deg}94%{rotate:3deg}}
@keyframes zt-hide{0%{scale:1.06}60%{scale:.94}100%{scale:1}}
@media (prefers-reduced-motion:reduce){.fl,.fig img,.bubble{transition:none}.fig,.fl[data-tucked=true] .fig{animation:none}}
`;

export class LilithFloat {
    constructor(app) { this.app = app; this.disposers = []; this.mood = ''; this.hideT = 0; this.tempTuck = false; this.lineIdx = 0; this.pokeIdx = 0; this.lastTap = 0; }
    get settings() { return this.app.settings; }
    get active() { return !!this.el && !this.el.hidden; }
    start() {
        const host = document.createElement('div'); host.id = 'zhutian-lilith-float'; document.body.append(host); this.host = host;
        const sh = host.attachShadow({ mode: 'open' });
        sh.innerHTML = `<style>${CSS}</style><div class="fl" hidden data-side="left"><div class="bubble" role="status" aria-live="polite"><b>莉莉丝</b><span></span></div><button class="fig" type="button" aria-label="莉莉丝：点一下打开诸天终端，长按拖动，拖到屏幕边缘可以藏起来"><img alt=""><img alt=""><i class="gem"></i></button></div>`;
        this.el = sh.querySelector('.fl'); this.fig = sh.querySelector('.fig'); this.bubble = sh.querySelector('.bubble'); this.text = this.bubble.querySelector('span');
        this.imgs = [...sh.querySelectorAll('img')]; this.setMood('neutral'); this.applySize();
        this.bindPointer();
        const sync = () => this.sync();
        addEventListener('resize', sync); this.disposers.push(() => removeEventListener('resize', sync));
        const mq = matchMedia('(pointer: coarse)'); mq.addEventListener?.('change', sync); this.disposers.push(() => mq.removeEventListener?.('change', sync));
        this.disposers.push(this.settings.onChange(k => { if (k === 'floatLilith') this.sync(); if (k === 'floatSize') { this.applySize(); this.sync(); } }));
        const hub = this.app.hub;
        if (hub) { hub.hook('onOpen', () => this.onHub(true)); hub.hook('onClose', () => this.onHub(false)); }
        this.sync();
        return this;
    }
    // ---------- state ----------
    applySize() {
        this.dims = floatDims(this.settings.get('floatSize'));
        this.el.style.setProperty('--w', this.dims.w + 'px'); this.el.style.setProperty('--h', this.dims.h + 'px'); this.el.style.setProperty('--k', String(this.dims.k));
    }
    wanted() { return wantFloat(this.settings.get('floatLilith') || 'auto', { coarse: matchMedia('(pointer: coarse)').matches, width: innerWidth }); }
    sync() {
        const on = this.wanted();
        this.el.hidden = !on;
        this.hideOriginalEntry(on);
        if (on) this.place(this.pos(), false);
    }
    /** The original pill launcher stays for desktop; with the floating portrait it would be a second Lilith. */
    hideOriginalEntry(on) {
        const sh = this.app.assistant?.shadow; if (!sh) return;
        let st = sh.getElementById('zt-float-entry-off');
        if (on && !st) { st = document.createElement('style'); st.id = 'zt-float-entry-off'; st.textContent = '#entry:not([data-docked=true]){display:none!important}'; sh.append(st); }
        if (!on && st) st.remove();
    }
    pos() {
        const p = this.settings.get('floatPos');
        if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) return p.tucked ? settle(p.edge === 'right' ? { x: innerWidth, y: p.y } : { x: -1, y: p.y }, innerWidth, innerHeight, this.dims.w, this.dims.h) : keepOnScreen(p, innerWidth, innerHeight, this.dims.w, this.dims.h);
        return { x: 0, y: Math.round(innerHeight * 0.58), edge: 'left', tucked: true };   // default: peeking from the left edge
    }
    place(p, save = true) {
        this.cur = p; const vw = innerWidth;
        let x = p.x;
        const { w, peek } = this.dims;
        if (p.tucked && !this.peeking) x = p.edge === 'right' ? vw - peek : peek - w;
        else if (p.tucked && this.peeking) x = p.edge === 'right' ? vw - w - 6 : 6;
        this.el.style.transform = `translate(${Math.round(x)}px, ${Math.round(p.y)}px)` + (p.tucked && !this.peeking ? ` rotate(${p.edge === 'right' ? -10 : 10}deg)` : '');
        this.el.dataset.tucked = String(!!p.tucked && !this.peeking); this.el.dataset.edge = p.edge || '';
        this.el.dataset.side = (p.edge === 'right' || (!p.edge && p.x > vw / 2)) ? 'right' : 'left';
        this.el.dataset.low = String(p.y < 120);
        if (save) this.settings.set('floatPos', { x: Math.round(p.x), y: Math.round(p.y), edge: p.edge || '', tucked: !!p.tucked });
    }
    onHub(open) {
        if (!this.active) return;
        const p = this.cur || this.pos();
        if (open && !p.tucked) { this.tempTuck = true; this.place(settle({ x: p.x > innerWidth / 2 ? innerWidth : -1, y: p.y }, innerWidth, innerHeight, this.dims.w, this.dims.h), false); }
        else if (!open && this.tempTuck) { this.tempTuck = false; this.place(this.pos(), false); }
        // desktop with the portrait visible inside the window: one Lilith is enough
        this.el.style.opacity = open && this.app.lilith?.stageVisible?.() ? '0' : '';
        this.el.style.pointerEvents = open && this.app.lilith?.stageVisible?.() ? 'none' : '';
    }
    setMood(m) {
        m = MOODS.includes(m) ? m : 'neutral'; if (m === this.mood) return; this.mood = m;
        const [front, back] = this.imgs[0].classList.contains('on') ? [this.imgs[0], this.imgs[1]] : [this.imgs[1], this.imgs[0]];
        back.src = `${this.app.base}assets/lilith/variants/${m}.webp`; back.classList.add('on'); front.classList.remove('on');
    }
    // ---------- speaking ----------
    /** Shows a line next to her. Returns false when the float is off (caller falls back to its own surface). */
    say(text, { zone = 'chest', mood = '', ms = 0 } = {}) {
        if (!this.active || !text) return false;
        if (this.el.style.opacity === '0') return false;
        this.setMood(mood || ZONE_MOOD[zone] || 'neutral');
        this.text.textContent = String(text).slice(0, 120);
        this.bubble.classList.add('show');
        if (this.cur?.tucked && !this.peeking) { this.peeking = true; this.place(this.cur, false); }
        clearTimeout(this.hideT);
        this.hideT = setTimeout(() => this.quiet(), ms || Math.max(3600, String(text).length * 170));
        this.lastSaid = text;
        return true;
    }
    quiet() { this.bubble.classList.remove('show'); if (this.peeking) { this.peeking = false; this.place(this.cur, false); } setTimeout(() => { if (!this.bubble.classList.contains('show')) this.setMood('neutral'); }, 900); }
    ledger() { try { return this.app.bridge.getVariables({ type: 'chat' })?.诸天系统 || null; } catch { return null; } }
    storyLine() {
        const cur = this.app.lilith?.current, all = [...(cur ? [{ zone: 'chest', text: cur }] : []), ...storyLines(this.ledger())];
        const l = all[this.lineIdx++ % all.length] || { zone: 'chest', text: IDLE[0] };
        return l;
    }
    // ---------- gestures ----------
    bindPointer() {
        const f = this.el; let d = null;
        const vib = ms => { try { if (this.settings.get('haptics') !== false) navigator.vibrate?.(ms); } catch { /* unsupported */ } };
        const down = e => {
            if (e.button > 0) return;
            const r = f.getBoundingClientRect();
            d = { id: e.pointerId, x0: e.clientX, y0: e.clientY, dx: e.clientX - r.left, dy: e.clientY - r.top, t: Date.now(), drag: false, touch: e.pointerType !== 'mouse' };
            try { this.fig.setPointerCapture(e.pointerId); } catch { /* ignore */ }
            if (d.touch) d.timer = setTimeout(() => { if (d && !d.moved) { d.drag = true; f.classList.add('drag'); this.bubble.classList.remove('show'); vib(12); } }, 420);
        };
        const move = e => {
            if (!d || e.pointerId !== d.id) return;
            const dist = Math.hypot(e.clientX - d.x0, e.clientY - d.y0);
            if (!d.drag) {
                if (dist > 10) d.moved = true;
                if (!d.touch && dist > 5) { d.drag = true; f.classList.add('drag'); this.bubble.classList.remove('show'); }
                if (!d.drag) return;
            }
            e.preventDefault();
            const x = clamp(e.clientX - d.dx, -this.dims.w / 2, innerWidth - this.dims.w / 2), y = clamp(e.clientY - d.dy, 0, innerHeight - this.dims.h);
            this.peeking = false; f.dataset.tucked = 'false';
            f.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`; d.last = { x, y };
        };
        const up = e => {
            if (!d || e.pointerId !== d.id) return;
            clearTimeout(d.timer); const g = d; d = null; f.classList.remove('drag');
            if (g.drag) {
                if (Number.isFinite(e.clientX) && (e.clientX || e.clientY)) g.last = { x: clamp(e.clientX - g.dx, -this.dims.w / 2, innerWidth - this.dims.w / 2), y: clamp(e.clientY - g.dy, 0, innerHeight - this.dims.h) };
                const p = settle(g.last || this.cur || this.pos(), innerWidth, innerHeight, this.dims.w, this.dims.h); this.tempTuck = false;
                this.place(p, true);
                if (p.tucked) { f.classList.add('hide-anim'); setTimeout(() => f.classList.remove('hide-anim'), 520); setTimeout(() => this.say('躲好了～要找我就戳这里。', { mood: 'wink', ms: 2600 }), 380); vib(8); }
                this.suppressClick = true; setTimeout(() => { this.suppressClick = false; }, 60);
                return;
            }
            if (g.moved || Date.now() - g.t > 600) { this.suppressClick = true; setTimeout(() => { this.suppressClick = false; }, 60); }
        };
        const cancel = () => { if (d) { clearTimeout(d.timer); d = null; f.classList.remove('drag'); this.place(this.cur || this.pos(), false); } };
        const click = e => {
            e.preventDefault(); if (this.suppressClick) return;
            const now = Date.now(), dbl = now - this.lastTap < 320; this.lastTap = now;
            clearTimeout(this.tapT);
            if (dbl) { this.poke(); return; }
            this.tapT = setTimeout(() => this.tap(), 260);
        };
        this.fig.addEventListener('pointerdown', down); this.fig.addEventListener('pointermove', move); this.fig.addEventListener('pointerup', up);
        this.fig.addEventListener('pointercancel', cancel); this.fig.addEventListener('click', click);
        this.fig.addEventListener('contextmenu', e => e.preventDefault());
        this.fig.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.tap(); } });
    }
    tap() {
        const hub = this.app.hub, p = this.cur || this.pos();
        // 0.8.3: terminal open → she only talks (peeks out for the line, then slips back). She never moves out over the
        // terminal and never closes it; close the terminal with its own ✕ / back gesture.
        if (hub?.isOpen) { const l = this.storyLine(); this.say(l.text, { zone: l.zone }); return; }
        if (p.tucked) {                            // come out of hiding
            const out = { ...p, x: p.edge === 'right' ? innerWidth - this.dims.w - 8 : 8, edge: '', tucked: false };
            this.place(out, true); this.say('被你发现了～', { mood: 'surprised', ms: 2200 }); return;
        }
        this.app.openTerminal();
    }
    poke() { this.say(POKE_LINES[this.pokeIdx++ % POKE_LINES.length], { mood: ['surprised', 'pout', 'smile', 'smug', 'wink'][this.pokeIdx % 5], ms: 2600 }); try { if (this.settings.get('haptics') !== false) navigator.vibrate?.(15); } catch { /* ignore */ } }
    dispose() { clearTimeout(this.hideT); clearTimeout(this.tapT); this.disposers.splice(0).forEach(f => { try { f(); } catch { /* ignore */ } }); this.hideOriginalEntry(false); this.host?.remove(); }
}

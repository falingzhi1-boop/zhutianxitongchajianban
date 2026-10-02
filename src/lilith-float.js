// 0.8.2 悬浮莉莉丝 — the phone launcher.  1.0: she is cut out of the card and stands on the page herself.
// On phones the terminal window is too small for the original standing portrait (the original hides it below 600 px
// height / in the compact layout), so Lilith was never seen there. The floating launcher becomes her portrait instead:
//   tap            → open the terminal (terminal already open: she only talks — never moves, never closes it)
//   double tap     → poke: a reaction line + expression (+ a little hop and a wing flutter)
//   long press     → pick her up and drag (mouse: just drag) — she tilts with the drag; drop near the left/right edge →
//                    she hides behind it (only a peek visible) and stays there; tap the peek → she comes out
//   position / tucked state are saved (extension settings), the terminal opening tucks her temporarily
//   size: setting floatSize (0.8.3), default 75 %
//   close (1.0): drag her onto 「拖到这里关闭悬浮窗」 at the bottom (or right click → 关闭悬浮窗 on a desktop) → a confirm
//                    that says the terminal stays reachable from 酒馆「扩展」→ 诸天终端 → 打开诸天终端; floatLilith = off
// Every line the portrait bubble would say while the portrait is not visible (system broadcast, reactions, results)
// pops up next to her here instead — so her dialogue reaches the front even without the portrait.
// Art (1.0): the ORIGINAL layered portrait (vendor ZhuTianLilithLayers: body / wings / face patches), cut out with a
// matte (tools/lilith_float_cutout.py → assets/lilith/float). Head to upper thigh, the bottom fades out, no frame.
// Alive without a model: breathing, bobbing, wings swaying, blinking, the mouth moving while a line is shown, the original
// expression patches for reactions. No model calls, no ledger writes. Same gestures as 0.8.2–0.9.x.
import { storyLines, IDLE } from './lilith-stage.js';
import { FLOAT_ART } from './lilith-float-art.js';
import { confirmBox } from './plugin-switch.js';

export const MOODS = ['neutral', 'smile', 'shy', 'pout', 'surprised', 'wink', 'smug', 'sad'];
export const ZONE_MOOD = Object.freeze({ wing: 'smile', lower: 'sad', horn: 'smug', chest: 'neutral', cheek: 'shy', thigh: 'pout', arm: 'wink', head: 'smile', hair: 'smile', tail: 'surprised' });
export const POKE_LINES = Object.freeze(['呀！戳哪里呢～', '再戳就收你系统点了哦。', '嗯？有事要莉莉丝帮忙？', '别闹，正在帮你盯账本呢。', '好啦好啦，我在。']);
// 1.0: the cut-out figure (636×700 art box) — full size 150×165; actual size = × floatSize scale. When tucked, 36 % of
// her (one wing, half her face) stays visible.
const W = 150, H = 165, EDGE = 26, PEEK_K = 0.36;
/** 0.8.3 悬浮莉莉丝大小. Default 'm' (75 %) — 0.8.2's full size was too big on phones. */
export const FLOAT_SIZES = Object.freeze({ xs: 0.55, s: 0.65, m: 0.75, l: 0.9, xl: 1 });
export function floatDims(size) { const k = FLOAT_SIZES[size] || FLOAT_SIZES.m; return { w: Math.round(W * k), h: Math.round(H * k), peek: Math.max(24, Math.round(W * k * PEEK_K)), k }; }
/** Percent box (left/top/width/height) of a part of the art inside the float (pure, for tests). */
export function artBox([x, y, w, h], box = FLOAT_ART.box) {
    const p = v => Math.round(v * 10000) / 100 + '%';
    return { left: p(x / box[0]), top: p(y / box[1]), width: p(w / box[0]), height: p(h / box[1]) };
}
/** Which face patch shows for a mood (neutral = the plain body). Moods without an original patch fall back. */
export const FACE_OF = Object.freeze({ neutral: '', smile: 'smile', shy: 'shy', pout: 'pout', surprised: 'surprised', wink: 'wink', smug: 'smug', sad: 'sad' });
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
/** 0.9.0: where she waits while the terminal is full screen on a phone — tucked at her side's edge, bottom corner. */
export function parkSpot(p, vw, vh, dims = { w: W, h: H }, side = '') {
    // landscape: the navigation rail is on the left, so she always waits on the right
    const right = side ? side === 'right' : !!p && (p.edge === 'right' || (!p.edge && p.x > vw / 2));
    return settle({ x: right ? vw : -1, y: vh - dims.h - 64 }, vw, vh, dims.w, dims.h);
}
/** Should the floating portrait be used? auto = touch / narrow screens. */
export function wantFloat(mode, { coarse = false, width = 1280 } = {}) { return mode === 'on' || (mode !== 'off' && (coarse || width <= 720)); }

const CSS = `
:host{all:initial}
.fl{position:fixed;left:0;top:0;width:var(--w,${W}px);height:var(--h,${H}px);z-index:2147483100;touch-action:none;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none;transition:transform .42s cubic-bezier(.2,.9,.25,1.15),opacity .3s;will-change:transform}
.fl[hidden]{display:none}
.fl.drag{transition:none}
.rig{position:absolute;inset:0;pointer-events:none;filter:drop-shadow(0 calc(var(--k,1) * 7px) calc(var(--k,1) * 9px) #0009) drop-shadow(0 0 calc(var(--k,1) * 10px) #b47ae033);animation:zt-bob 3.4s ease-in-out infinite}
.pose{position:absolute;inset:0;transform-origin:50% 92%;rotate:var(--tilt,0deg);transition:rotate .25s ease-out,scale .25s ease-out}
.torso{position:absolute;inset:0;transform-origin:50% 100%;animation:zt-breathe 3.8s ease-in-out infinite}
.rig img{position:absolute;display:block;pointer-events:none;-webkit-user-drag:none}
.wing{animation:zt-wing 2.9s ease-in-out infinite}
.wing.l{transform-origin:100% 42%}
.wing.r{transform-origin:0% 30%;animation-delay:-.2s;--dir:-1}
.face{opacity:0;transition:opacity .16s}
.face.on{opacity:1}
.face.quick{transition:none}
.fig{position:absolute;left:17%;right:17%;top:1%;bottom:12%;padding:0;margin:0;border:0;border-radius:40% 40% 18% 18%;background:transparent;cursor:pointer;outline:none;-webkit-tap-highlight-color:transparent}
.fig:focus-visible{box-shadow:0 0 0 3px #e3c4ff}
.fl.drag .pose{scale:1.07}
.fl.drag .wing,.fl.flap .wing{animation:zt-flap .22s ease-in-out infinite}
.fl.hop .pose{animation:zt-hop .55s cubic-bezier(.3,1.6,.5,1) 1}
.fl[data-tucked=true] .pose{animation:zt-peek 4s ease-in-out infinite}
.fl[data-tucked=true][data-edge=left] .pose{transform-origin:100% 60%}
.fl[data-tucked=true][data-edge=right] .pose{transform-origin:0 60%}
.fl.hide-anim .pose{animation:zt-hide .5s ease-out 1}
.bubble{position:absolute;bottom:calc(100% + 4px);max-width:min(260px,calc(100vw - 24px));width:max-content;padding:9px 12px;border-radius:14px;border:1px solid #c9a2ef66;background:linear-gradient(135deg,#2a1d38f2,#1a1124f2);color:#f3e9fb;font:13px/1.6 -apple-system,"PingFang SC","Microsoft YaHei",sans-serif;box-shadow:0 8px 24px #000a;opacity:0;transform:translateY(6px) scale(.96);transition:opacity .22s,transform .22s;pointer-events:none;white-space:normal;word-break:break-word;z-index:2}
.bubble b{display:block;font-size:10px;letter-spacing:2px;color:#d8bf92;margin-bottom:2px;font-weight:600}
.bubble.show{opacity:1;transform:none;pointer-events:auto}
.fl[data-side=left] .bubble{left:12%}
.fl[data-side=right] .bubble{right:12%}
.fl[data-low=true] .bubble{bottom:auto;top:calc(100% + 4px)}
@keyframes zt-bob{0%,100%{translate:0 0}50%{translate:0 calc(var(--k,1) * -4px)}}
@keyframes zt-breathe{0%,100%{scale:1 1}50%{scale:1.006 1.014}}
@keyframes zt-wing{0%,100%{rotate:0deg}50%{rotate:calc(var(--dir,1) * -7deg)}}
@keyframes zt-flap{0%,100%{rotate:0deg}50%{rotate:calc(var(--dir,1) * -16deg)}}
@keyframes zt-hop{0%{translate:0 0;scale:1 1}25%{translate:0 calc(var(--k,1) * -12px);scale:.97 1.04}55%{translate:0 0;scale:1.04 .96}100%{translate:0 0;scale:1 1}}
@keyframes zt-peek{0%,82%,100%{rotate:0deg}88%{rotate:-4deg}94%{rotate:3deg}}
@keyframes zt-hide{0%{scale:1.06}60%{scale:.94}100%{scale:1}}
.fl[data-lite=true] .rig{filter:none}
.fl[data-lite=true] .torso,.fl[data-lite=true] .wing{animation:none}
/* 1.0: 拖到底部「关闭悬浮窗」 · 桌面右键菜单 */
.bin{position:fixed;left:50%;top:0;z-index:2147483099;translate:-50% 0;display:flex;align-items:center;gap:8px;padding:10px 18px;border-radius:999px;background:#140d1fe6;border:1px dashed #f0abfc88;color:#f5e8ff;font:500 13px/1.2 system-ui,'PingFang SC','Microsoft YaHei',sans-serif;box-shadow:0 8px 28px #0008;opacity:0;scale:.9;pointer-events:none;transition:opacity .18s,scale .18s,background .18s}
.bin.show{opacity:1;scale:1}
.bin.hot{background:#7f1d4de6;border-style:solid;border-color:#fda4af;scale:1.08}
.bin svg{width:18px;height:18px;flex:none}
.menu{position:fixed;z-index:2147483101;min-width:150px;padding:5px;border-radius:10px;background:#160f22f2;border:1px solid #ffffff22;box-shadow:0 10px 30px #000a;font:13px/1.3 system-ui,'PingFang SC','Microsoft YaHei',sans-serif}
.menu[hidden]{display:none}
.menu button{display:block;width:100%;text-align:left;padding:8px 10px;border:0;border-radius:7px;background:none;color:#f1e9ff;font:inherit;cursor:pointer}
.menu button:hover,.menu button:focus-visible{background:#ffffff14;outline:none}
.menu button.danger{color:#fda4af}
@media (prefers-reduced-motion:reduce){.fl,.bubble,.pose,.face{transition:none}.rig,.torso,.wing,.fl.drag .wing,.fl.flap .wing,.fl.hop .pose,.fl[data-tucked=true] .pose{animation:none}}
.fl[data-lite=true] .rig{filter:drop-shadow(0 calc(var(--k,1) * 5px) calc(var(--k,1) * 4px) #0008)}.fl[data-lite=true] :is(.rig,.torso,.wing,.pose){animation:none!important}.fl[data-lite=true] :is(.pose,.face){transition:none}
`;

/** 1.0: what closing the float means, and where the terminal is afterwards. */
export const CLOSE_TEXT = hasEntry => `悬浮莉莉丝会从页面上消失（账本、设置都不受影响）。\n\n关闭后随时可以从酒馆的「扩展」面板（顶栏积木图标）→「诸天终端」→「打开诸天终端」重新进入控制台。${hasEntry ? '\n左下角的原版莉莉丝唤醒按钮也会回来。' : ''}\n\n想让她回来：扩展面板里点「显示悬浮莉莉丝」，或终端「设置 → 莉莉丝 → 悬浮莉莉丝」。`;
export const CLOSED_TEXT = '要进入控制台：酒馆「扩展」面板（顶栏积木图标）→「诸天终端」→「打开诸天终端」。想让她回来：同一处点「显示悬浮莉莉丝」。';
export class LilithFloat {
    constructor(app) { this.app = app; this.disposers = []; this.mood = ''; this.hideT = 0; this.tempTuck = false; this.lineIdx = 0; this.pokeIdx = 0; this.lastTap = 0; }
    get settings() { return this.app.settings; }
    get active() { return !!this.el && !this.el.hidden; }
    /** A line is showing right now (0.9.0: a scroll inside the full-screen terminal hides it). */
    get speaking() { return !!this.bubble?.classList.contains('show'); }
    start() {
        const host = document.createElement('div'); host.id = 'zhutian-lilith-float'; document.body.append(host); this.host = host;
        const sh = host.attachShadow({ mode: 'open' });
        const A = FLOAT_ART, url = f => `${this.app.base}assets/lilith/float/${f}.webp`;
        const at = (r, cls, f) => { const b = artBox(r); return `<img class="${cls}" alt="" draggable="false" src="${url(f)}" style="left:${b.left};top:${b.top};width:${b.width};height:${b.height}">`; };
        const faces = Object.entries(A.faces).map(([k, r]) => at(r, 'face', 'face-' + k).replace('class="face"', `class="face" data-face="${k}"`)).join('');
        sh.innerHTML = `<style>${CSS}</style><div class="fl" hidden data-side="left" data-mood="neutral"><div class="bubble" role="status" aria-live="polite"><b>莉莉丝</b><span></span></div>`
            + `<div class="rig" aria-hidden="true"><div class="pose">${at(A.parts.wingL, 'wing l', 'wingl')}${at(A.parts.wingR, 'wing r', 'wingr')}<div class="torso">${at(A.parts.body, 'body', 'body')}${faces}</div></div></div>`
            + `<button class="fig" type="button" aria-label="莉莉丝：点一下打开诸天终端，长按拖动，拖到屏幕边缘可以藏起来，拖到底部可以关闭悬浮窗"></button></div>`
            + `<div class="bin" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg><span>拖到这里关闭悬浮窗</span></div>`
            + `<div class="menu" role="menu" hidden><button type="button" role="menuitem" data-m="open">打开诸天终端</button><button type="button" role="menuitem" data-m="hide">藏到屏幕边</button><button type="button" role="menuitem" class="danger" data-m="close">关闭悬浮窗…</button></div>`;
        this.el = sh.querySelector('.fl'); this.fig = sh.querySelector('.fig'); this.bubble = sh.querySelector('.bubble'); this.text = this.bubble.querySelector('span'); this.el.dataset.lite = String(!!this.app?.perf?.lite);
        this.bin = sh.querySelector('.bin'); this.menu = sh.querySelector('.menu');
        this.pose = sh.querySelector('.pose'); this.faces = Object.fromEntries([...sh.querySelectorAll('.face')].map(i => [i.dataset.face, i]));
        this.setMood('neutral'); this.applySize(); this.blinkLoop();
        this.bindPointer(); this.bindMenu();
        // 0.9.0: tap the bubble to dismiss it (on a phone it can sit over the terminal's content)
        this.bubble.addEventListener('click', e => { e.stopPropagation(); clearTimeout(this.hideT); this.quiet(); });
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
        if (on) { if (this.app.hub?.isOpen) { this.tempTuck = false; this.onHub(true); } else this.place(this.pos(), false); }
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
        if (p.tucked && !this.peeking && this.speaking) this.peeking = true;   // 1.0: a line is showing → never half off-screen
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
        // 0.9.0: over the full-screen phone terminal she waits in the bottom corner (above the status line), not halfway
        // up the content where her lines covered what you were reading
        if (open && this.app.mobile?.full) { this.tempTuck = true; this.place(parkSpot(p, innerWidth, innerHeight, this.dims, this.app.mobile.mode === 'land' ? 'right' : ''), false); }
        else if (open && !p.tucked) { this.tempTuck = true; this.place(settle({ x: p.x > innerWidth / 2 ? innerWidth : -1, y: p.y }, innerWidth, innerHeight, this.dims.w, this.dims.h), false); }
        else if (!open && this.tempTuck) { this.tempTuck = false; this.place(this.pos(), false); }
        // desktop with the portrait visible inside the window: one Lilith is enough
        this.el.style.opacity = open && this.app.lilith?.stageVisible?.() ? '0' : '';
        this.el.style.pointerEvents = open && this.app.lilith?.stageVisible?.() ? 'none' : '';
    }
    setMood(m) {
        m = MOODS.includes(m) ? m : 'neutral'; if (m === this.mood) return; this.mood = m;
        this.el.dataset.mood = m;
        const k = FACE_OF[m] || '';
        for (const [name, img] of Object.entries(this.faces || {})) if (name !== 'blink' && name !== 'talk') img.classList.toggle('on', name === k);
    }
    /** A short one-off body reaction: 'hop' (poke / coming out) or 'flap' (wings flutter). */
    react(cls, ms = 600) {
        if (!this.el) return; this.el.classList.remove(cls); void this.el.offsetWidth; this.el.classList.add(cls);
        clearTimeout(this['t_' + cls]); this['t_' + cls] = setTimeout(() => this.el.classList.remove(cls), ms);
    }
    /** Blinks every 2.5–6 s while she is on screen with the plain face (the blink patch is drawn on the neutral face). */
    blinkLoop() {
        clearTimeout(this.blinkT);
        this.blinkT = setTimeout(() => {
            const b = this.faces?.blink;
            if (b && this.active && this.mood === 'neutral' && !this.talking && document.visibilityState !== 'hidden') {
                b.classList.add('quick', 'on'); setTimeout(() => b.classList.remove('on', 'quick'), 130);
            }
            this.blinkLoop();
        }, 2500 + Math.random() * 3500);
    }
    /** The mouth moves while a line is shown (neutral face only — the talk patch is drawn on it). */
    talk(text) {
        clearInterval(this.talkI); const m = this.faces?.talk; if (!m) return;
        m.classList.remove('on'); this.talking = false;
        if (this.mood !== 'neutral' || this.el?.dataset.lite === 'true' || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
        const until = Date.now() + Math.min(2600, 500 + String(text).length * 90); let open = false; this.talking = true;
        m.classList.add('quick');
        this.talkI = setInterval(() => {
            open = !open && Date.now() < until && this.mood === 'neutral';
            m.classList.toggle('on', open);
            if (!open && Date.now() >= until) { clearInterval(this.talkI); this.talking = false; m.classList.remove('quick'); }
        }, 150);
    }
    // ---------- speaking ----------
    /** Shows a line next to her. Returns false when the float is off (caller falls back to its own surface). */
    say(text, { zone = 'chest', mood = '', ms = 0 } = {}) {
        if (!this.active || !text) return false;
        if (this.el.style.opacity === '0') return false;
        this.setMood(mood || ZONE_MOOD[zone] || 'neutral');
        this.text.textContent = String(text).slice(0, 120);
        this.bubble.classList.add('show'); this.talk(text);
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
            if (d.touch) d.timer = setTimeout(() => { if (d && !d.moved) { d.drag = true; f.classList.add('drag'); this.bubble.classList.remove('show'); this.showBin(); vib(12); } }, 420);
        };
        const move = e => {
            if (!d || e.pointerId !== d.id) return;
            const dist = Math.hypot(e.clientX - d.x0, e.clientY - d.y0);
            if (!d.drag) {
                if (dist > 10) d.moved = true;
                if (!d.touch && dist > 5) { d.drag = true; f.classList.add('drag'); this.bubble.classList.remove('show'); this.showBin(); }
                if (!d.drag) return;
            }
            e.preventDefault();
            const x = clamp(e.clientX - d.dx, -this.dims.w / 2, innerWidth - this.dims.w / 2), y = clamp(e.clientY - d.dy, 0, innerHeight - this.dims.h);
            this.peeking = false; f.dataset.tucked = 'false';
            // 1.0: she swings with the drag (tilts against the direction she is pulled)
            const vx = d.last ? x - d.last.x : 0; d.tilt = clamp((d.tilt || 0) * 0.6 - vx * 0.9, -16, 16);
            this.pose.style.setProperty('--tilt', d.tilt.toFixed(1) + 'deg');
            f.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`; d.last = { x, y };
            const hot = this.overBin(e.clientX, e.clientY); if (hot !== d.hot) { d.hot = hot; this.bin.classList.toggle('hot', hot); if (hot) vib(6); }
        };
        const up = e => {
            if (!d || e.pointerId !== d.id) return;
            clearTimeout(d.timer); const g = d; d = null; f.classList.remove('drag'); this.pose.style.removeProperty('--tilt');
            this.bin.classList.remove('show', 'hot');
            if (g.drag && (g.hot || this.overBin(e.clientX, e.clientY))) {      // 1.0: dropped on 「关闭悬浮窗」
                this.place(this.cur || this.pos(), false);
                this.suppressClick = true; setTimeout(() => { this.suppressClick = false; }, 60);
                void this.askClose();
                return;
            }
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
        const cancel = () => { this.bin.classList.remove('show', 'hot'); if (d) { clearTimeout(d.timer); d = null; f.classList.remove('drag'); this.pose.style.removeProperty('--tilt'); this.place(this.cur || this.pos(), false); } };
        const click = e => {
            e.preventDefault(); if (this.suppressClick) return;
            const now = Date.now(), dbl = now - this.lastTap < 320; this.lastTap = now;
            clearTimeout(this.tapT);
            if (dbl) { this.poke(); return; }
            this.tapT = setTimeout(() => this.tap(), 260);
        };
        this.fig.addEventListener('pointerdown', down); this.fig.addEventListener('pointermove', move); this.fig.addEventListener('pointerup', up);
        this.fig.addEventListener('pointercancel', cancel); this.fig.addEventListener('click', click);
        // 1.0: desktop right click → 打开终端 / 藏起来 / 关闭悬浮窗 (touch long-press stays the drag)
        this.fig.addEventListener('contextmenu', e => { e.preventDefault(); if (d?.touch || e.pointerType === 'touch' ) return; this.openMenu(e.clientX, e.clientY); });
        this.fig.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.tap(); } });
    }
    /** Show 「拖到这里关闭悬浮窗」 near the bottom of the screen. Placed with `top` from innerHeight (like the figure itself):
     *  SillyTavern's phone layout gives <html> a transform and height 0, so a `bottom:` on a fixed element would put the bar
     *  above the top of the screen. */
    showBin() {
        const b = this.bin; if (!b) return;
        b.classList.add('show');
        const h = b.offsetHeight || 38;
        b.style.top = `calc(${Math.max(8, innerHeight - h - 22)}px - env(safe-area-inset-bottom, 0px))`;
    }
    /** Is the pointer over the 「关闭悬浮窗」 target? (generous: the bar plus 24 px around it) */
    overBin(x, y) {
        if (!Number.isFinite(x) || !Number.isFinite(y) || !this.bin?.classList.contains('show')) return false;
        const r = this.bin.getBoundingClientRect();
        return x > r.left - 24 && x < r.right + 24 && y > r.top - 24 && y < r.bottom + 24;
    }
    bindMenu() {
        const m = this.menu, close = () => { m.hidden = true; };
        m.addEventListener('click', e => {
            const b = e.target.closest('[data-m]'); if (!b) return; close();
            if (b.dataset.m === 'open') this.app.openTerminal();
            else if (b.dataset.m === 'hide') { const p = this.cur || this.pos(); this.place(settle({ x: p.x > innerWidth / 2 ? innerWidth : -1, y: p.y }, innerWidth, innerHeight, this.dims.w, this.dims.h), true); }
            else if (b.dataset.m === 'close') void this.askClose();
        });
        m.addEventListener('keydown', e => { if (e.key === 'Escape') { close(); this.fig.focus(); } });
        const outside = e => { if (!m.hidden && !e.composedPath().includes(m)) close(); };
        addEventListener('pointerdown', outside, true); this.disposers.push(() => removeEventListener('pointerdown', outside, true));
        const esc = e => { if (e.key === 'Escape') close(); };
        addEventListener('keydown', esc); this.disposers.push(() => removeEventListener('keydown', esc));
    }
    openMenu(x, y) {
        const m = this.menu; m.hidden = false;
        const w = m.offsetWidth || 160, h = m.offsetHeight || 110;
        m.style.left = clamp(x, 4, innerWidth - w - 4) + 'px'; m.style.top = clamp(y, 4, innerHeight - h - 4) + 'px';
        m.querySelector('button')?.focus({ preventScroll: true });
    }
    /** 1.0: 关闭悬浮窗 — asks first, and says where the terminal is afterwards (酒馆「扩展」面板). Resolves true when closed. */
    async askClose({ ask = confirmBox } = {}) {
        if (this.asking) return false; this.asking = true;
        try {
            const yes = await ask(CLOSE_TEXT(!!this.app.assistant?.shadow), { ok: '关闭悬浮窗', cancel: '留着她', title: '关闭悬浮莉莉丝？' });
            if (!yes) { this.say('哼，就知道你舍不得我～', { mood: 'smug', ms: 2400 }); return false; }
            this.menu.hidden = true; this.quiet?.();
            this.settings.set('floatLilith', 'off');
            globalThis.toastr?.info(CLOSED_TEXT, '诸天 · 悬浮莉莉丝已关闭', { timeOut: 12000, extendedTimeOut: 6000 });
            return true;
        } finally { this.asking = false; }
    }
    /** Drawer 「显示悬浮莉莉丝」 / settings: bring her back on this device. */
    show() {
        if (this.active) { this.say('我一直都在这里呀～', { mood: 'smile', ms: 2200 }); return 'already'; }
        const mode = wantFloat('auto', { coarse: matchMedia('(pointer: coarse)').matches, width: innerWidth }) ? 'auto' : 'on';
        this.settings.set('floatLilith', mode);
        setTimeout(() => this.say('我回来啦～', { mood: 'wink', ms: 2200 }), 200);
        return mode;
    }
    tap() {
        const hub = this.app.hub, p = this.cur || this.pos();
        // 0.8.3: terminal open → she only talks (peeks out for the line, then slips back). She never moves out over the
        // terminal and never closes it; close the terminal with its own ✕ / back gesture.
        if (hub?.isOpen) { const l = this.storyLine(); this.say(l.text, { zone: l.zone }); return; }
        if (p.tucked) {                            // come out of hiding
            const out = { ...p, x: p.edge === 'right' ? innerWidth - this.dims.w - 8 : 8, edge: '', tucked: false };
            this.place(out, true); this.react('hop'); this.say('被你发现了～', { mood: 'surprised', ms: 2200 }); return;
        }
        this.app.openTerminal();
    }
    poke() { this.react('hop'); this.react('flap', 700); this.say(POKE_LINES[this.pokeIdx++ % POKE_LINES.length], { mood: ['surprised', 'pout', 'smile', 'smug', 'wink'][this.pokeIdx % 5], ms: 2600 }); try { if (this.settings.get('haptics') !== false) navigator.vibrate?.(15); } catch { /* ignore */ } }
    dispose() { clearTimeout(this.hideT); clearTimeout(this.tapT); clearTimeout(this.blinkT); clearInterval(this.talkI); this.disposers.splice(0).forEach(f => { try { f(); } catch { /* ignore */ } }); this.hideOriginalEntry(false); this.host?.remove(); }
}

// 真实触摸互动 — native gesture layer on top of the ORIGINAL Lilith stage (vendor ZhuTianLilithMotion, unmodified).
// The original stage already reacts to a tap/click/Enter on a body part (bubble line + expression timeline + body
// motion) and lets the eyes follow a hovering mouse. This layer adds what a touch screen can do on top of it:
//   * stroke  — rubbing back and forth on a part (or a long slide) escalates through three stroke lines
//   * hold    — keeping a finger/mouse still on a part for 650 ms; the click that would follow is swallowed
//   * look    — on touch, her eyes follow the finger while it is down and settle back ~0.9 s after release
//   * haptics — navigator.vibrate on touch pointers only (tap 8 ms, stroke 6 ms per level, hold 15 ms), switchable
// Every reaction goes through the original speak(zone, point) so the expression/motion timeline is the original one;
// only the bubble text is replaced by the gesture line. Nothing here calls a model or touches the ledger.

export const STROKE_LINES = Object.freeze({
    cheek: ['唔……主人的手好暖。就、就再摸一会儿吧。', '脸都被主人揉热了啦……不许笑。', '再摸下去，莉莉丝可要赖着不走了哦？'],
    horn: ['别、别顺着角摸……那里很敏感的！', '呜……主人是故意的吧？角都在发烫了。', '够了够了！再摸就要签补充条款了！'],
    wing: ['羽膜要顺着摸才舒服……对，就是这样。', '嗯～翅膀被照顾得很好，下次带您飞快一点。', '主人再这样，莉莉丝要把您裹进翅膀里了。'],
    tail: ['呀！尾巴不能那样捋……会、会发软的。', '尾巴自己缠上来了？那、那不是我让它做的！', '哼，尾巴已经认主了，主人要负责到底。'],
    arm: ['牵手就牵手，别挠手心啦。', '手被主人握着，今天的任务好像也没那么难了。', '不放开？好吧，那就这样一起走。'],
    thigh: ['喂，往哪儿摸呢？契约里可没写这条！', '……主人今天胆子不小嘛。', '再不停下，莉莉丝就要收利息了哦。'],
    lower: ['衣角被您揉皱了……待会儿帮我抚平。', '别扯啦，裙摆会乱的！', '好好好，莉莉丝站着不动，让您整理个够。'],
    chest: ['契约印记在发光呢……主人感觉到了吗？', '心跳？那是契约的回响，才、才不是紧张。', '再按着，莉莉丝的心跳要被您全听去了。'],
});
export const HOLD_LINES = Object.freeze({
    cheek: ['被主人捧着脸……好吧，只许看一会儿。', '一直这样看着我，莉莉丝会害羞的。'],
    horn: ['握住角可是很亲密的动作哦，主人知道吗？', '……不松手？那莉莉丝就当您是认真的了。'],
    wing: ['抓着翅膀不放？那莉莉丝就带您飞一圈。', '别担心，翅膀收好了，不会把您扇跑的。'],
    tail: ['尾巴被抓住了……好、好吧，让您抓着。', '尾巴尖在发抖？才没有！'],
    arm: ['要莉莉丝陪您多久都可以，别松手就好。', '握紧一点，前面的路一起走。'],
    thigh: ['……按着不放是什么意思呀，主人？', '再按下去，契约要追加条款了。'],
    lower: ['想让我留下来？直接说嘛。', '拽着衣角的样子，像怕我跑掉一样。'],
    chest: ['听到了吗？这是我们的契约在跳动。', '手放在这里……莉莉丝的心意都被您知道了。'],
});
export const GESTURE = Object.freeze({ strokeMin: 60, strokeLong: 140, strokeStep: 180, reversals: 2, holdMs: 650, holdSlop: 8, lookRelease: 900 });

/** Pure stroke classifier (tested in node): path length + direction reversals → null | level 0..2.
 *  Points are CSS pixels on screen, so the feel is the same on a phone and on a large monitor. */
export function classifyStroke(points) {
    let path = 0, reversals = 0, lastDir = 0;
    for (let i = 1; i < points.length; i++) {
        const dx = points[i][0] - points[i - 1][0], dy = points[i][1] - points[i - 1][1], d = Math.hypot(dx, dy);
        if (d < 1.5) continue; path += d;
        const major = Math.abs(dx) >= Math.abs(dy) ? dx : dy, dir = Math.sign(major);
        if (dir && lastDir && dir !== lastDir && d >= 3) reversals++;
        if (dir) lastDir = dir;
    }
    if (!(path >= GESTURE.strokeMin && reversals >= GESTURE.reversals) && !(path > GESTURE.strokeLong)) return { level: null, path, reversals };
    return { level: Math.min(2, Math.floor((path - GESTURE.strokeMin) / GESTURE.strokeStep)), path, reversals };
}

export class TouchLayer {
    constructor(settings) { this.settings = settings; this.off = []; this.stage = null; this.stats = { taps: 0, strokes: 0, holds: 0 }; this.seen = {}; }
    enabled() { return this.settings.get('touchGestures') !== false; }
    buzz(e, pattern) { if (e?.pointerType === 'touch' && this.settings.get('haptics') !== false) try { navigator.vibrate?.(pattern); } catch { /* optional */ } }
    /** Attach to a mounted original stage ({frame, figure, bubble, speak, rig}). Safe to call again on remount. */
    attach(motion) {
        this.detach();
        const stage = motion?.stages?.[0]; if (!stage?.figure || typeof stage.speak !== 'function') return false;
        this.stage = stage;
        const { figure, frame } = stage, root = figure.getRootNode?.() || document, win = figure.ownerDocument.defaultView || window;
        const vb = figure.viewBox?.baseVal, W = vb?.width || 424, H = vb?.height || 632;
        const on = (el, type, fn, opts) => { el.addEventListener(type, fn, opts); this.off.push(() => el.removeEventListener(type, fn, opts)); };
        const logical = e => { const b = figure.getBoundingClientRect(); return b.width ? [(e.clientX - b.left) / b.width * W, (e.clientY - b.top) / b.height * H] : null; };
        const zoneAt = e => { const el = root.elementFromPoint?.(e.clientX, e.clientY); return el?.closest?.('.zt-zone')?.dataset.zone || null; };
        // Strokes need the browser not to scroll while a finger is on a body part (the original zones allow pan-y).
        const style = figure.ownerDocument.createElement('style');
        style.textContent = '.zt-stage[data-zt-touch=on] .zt-zone{touch-action:none!important}';
        (root.nodeType === 11 ? root : figure.ownerDocument.head).append(style);
        frame.dataset.ztTouch = this.enabled() ? 'on' : 'off';
        this.off.push(() => { style.remove(); delete frame.dataset.ztTouch; });
        let g = null, swallowUntil = 0, lookTimer = 0;
        const say = (zone, text, point) => { stage.speak(zone, point); if (text && stage.bubble) stage.bubble.textContent = text; };
        on(figure, 'pointerdown', e => {
            if (!this.enabled()) return;
            const zone = e.target?.closest?.('.zt-zone')?.dataset.zone; if (!zone) return;
            const p = logical(e);
            g = { id: e.pointerId, zone, type: e.pointerType, start: [e.clientX, e.clientY], pts: [[e.clientX, e.clientY]], last: p, level: -1, held: false, moved: false };
            g.timer = win.setTimeout(() => {
                if (!g || g.moved || g.level >= 0) return;
                g.held = true; this.stats.holds++; swallowUntil = win.performance.now() + 1200;
                const lines = HOLD_LINES[g.zone] || [], n = (this.seen['hold:' + g.zone] = (this.seen['hold:' + g.zone] ?? -1) + 1);
                say(g.zone, lines[n % lines.length], g.last); this.buzz(e, 15);
            }, GESTURE.holdMs);
            if (e.pointerType === 'touch' && p) { stage.rig?.pointAt?.(p, win.performance.now(), 0); win.clearTimeout(lookTimer); }
        }, true);
        on(figure, 'pointermove', e => {
            if (!g || e.pointerId !== g.id) return;
            const p = logical(e); if (!p) return;
            if (Math.hypot(e.clientX - g.start[0], e.clientY - g.start[1]) > GESTURE.holdSlop) g.moved = true;
            g.last = p; g.pts.push([e.clientX, e.clientY]); if (g.pts.length > 240) g.pts.splice(1, g.pts.length - 240);
            if (g.type === 'touch') stage.rig?.pointAt?.(p, win.performance.now(), 0);
            if (g.held) return;
            const zone = zoneAt(e) || g.zone, r = classifyStroke(g.pts);
            if (r.level !== null && r.level > g.level) {
                g.level = r.level; g.zone = zone; this.stats.strokes++; swallowUntil = win.performance.now() + 1200;
                say(zone, STROKE_LINES[zone]?.[r.level], p); this.buzz(e, 6 * (r.level + 1));
            }
        }, true);
        const end = e => {
            if (!g || e.pointerId !== g.id) return;
            win.clearTimeout(g.timer);
            if (!g.moved && !g.held && g.level < 0 && e.type === 'pointerup') { this.stats.taps++; this.buzz(e, 8); }
            if (g.type === 'touch') { win.clearTimeout(lookTimer); lookTimer = win.setTimeout(() => stage.rig?.pointAt?.(null, win.performance.now()), GESTURE.lookRelease); }
            g = null;
        };
        on(figure, 'pointerup', end, true); on(figure, 'pointercancel', end, true);
        // After a hold or a stroke the browser still sends a click; the original would answer it with a tap line.
        on(figure, 'click', e => { if (win.performance.now() < swallowUntil) { swallowUntil = 0; e.stopImmediatePropagation(); e.preventDefault(); } }, true);
        this.off.push(() => { win.clearTimeout(lookTimer); if (g) win.clearTimeout(g.timer); });
        this.offSettings = this.settings.onChange?.(k => { if (k === 'touchGestures' && this.stage) this.stage.frame.dataset.ztTouch = this.enabled() ? 'on' : 'off'; });
        return true;
    }
    detach() { this.off.splice(0).forEach(f => { try { f(); } catch { /* gone */ } }); this.offSettings?.(); this.offSettings = null; this.stage = null; }
    dispose() { this.detach(); }
}

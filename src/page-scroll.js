// 1.1.1 · 页面整体上移.
// Player feedback (screenshot): after 外挂 → 工坊「编辑 / 新建」or 许愿 / 闭关 / 结算 the whole SillyTavern page — the
// terminal, the input bar, the background — sat ~200 px too high with an empty band below, until the console snippet
// `document.documentElement.scrollTop = document.body.scrollTop = 0` was run.
// Cause: element.scrollIntoView() and textarea.focus() (the original insertIntoChatInput focuses #send_textarea) scroll
// EVERY scrollable ancestor, including <html>/<body>. SillyTavern's page is a fixed 100dvh layout with overflow hidden,
// so the document is never meant to scroll — but programmatic scrolling still moves it, and nothing scrolls it back.
// Here:
//   * scrollWithin(el)  — scrolls only the scroll boxes between el and its shadow root / <body> (never the page);
//   * resetPageScroll() — puts <html>/<body>/window back to 0 (what the console snippet did);
//   * guardPageScroll() — while the terminal is open, a page scroll that happens anyway is undone on the next frame
//                         (not while a text field has the focus: phones may scroll for the on-screen keyboard).
const TEXT_FIELD = 'input:not([type=checkbox]):not([type=radio]):not([type=button]):not([type=range]),textarea,select,[contenteditable=""],[contenteditable="true"]';

/** The page-level scrollers SillyTavern never scrolls on purpose. */
function pageScrollers(doc) {
    return [doc.scrollingElement, doc.documentElement, doc.body].filter((el, i, all) => el && all.indexOf(el) === i);
}
/** Is the page (not a scroll box inside it) scrolled? */
export function pageScrolled(doc = globalThis.document) {
    if (!doc) return false;
    const win = doc.defaultView;
    return pageScrollers(doc).some(el => el.scrollTop || el.scrollLeft) || !!(win && (win.scrollY || win.scrollX));
}
/** Scrolls <html>/<body>/window back to the top-left. Returns true when something had moved. */
export function resetPageScroll(doc = globalThis.document) {
    if (!doc) return false;
    let moved = false;
    for (const el of pageScrollers(doc)) if (el.scrollTop || el.scrollLeft) { el.scrollTop = 0; el.scrollLeft = 0; moved = true; }
    const win = doc.defaultView;
    if (win && (win.scrollY || win.scrollX)) { try { win.scrollTo(0, 0); } catch { /* ignore */ } moved = true; }
    return moved;
}
const scrollable = (el, win) => {
    if (!el || el.scrollHeight <= el.clientHeight + 1) return false;
    try { return /(auto|scroll|overlay)/.test(win.getComputedStyle(el).overflowY); } catch { return false; }
};
/**
 * scrollIntoView without moving the page: only the scroll boxes between `el` and the nearest shadow root / <body>.
 * block: 'start' | 'center' | 'nearest' (default). Returns how many boxes were scrolled.
 */
export function scrollWithin(el, { block = 'nearest', behavior = 'auto', margin = 8 } = {}) {
    if (!el?.isConnected) return 0;
    const doc = el.ownerDocument, win = doc?.defaultView; if (!win) return 0;
    let n = 0, p = el.parentNode;
    while (p && p !== doc.body && p !== doc.documentElement && p.nodeType === 1) {
        if (scrollable(p, win)) {
            const box = p.getBoundingClientRect(), r = el.getBoundingClientRect();
            const top = r.top - box.top + p.scrollTop;                    // el's offset inside the scroll box
            let want = null;
            if (block === 'start') want = top - margin;
            else if (block === 'center') want = top - (p.clientHeight - r.height) / 2;
            else if (r.top < box.top + margin) want = top - margin;
            else if (r.bottom > box.bottom - margin) want = top + r.height - p.clientHeight + margin;
            if (want !== null) {
                const max = p.scrollHeight - p.clientHeight, y = Math.max(0, Math.min(max, Math.round(want)));
                if (y !== p.scrollTop) { try { p.scrollTo({ top: y, behavior }); } catch { p.scrollTop = y; } n++; }
            }
        }
        p = p.parentNode;                                                   // a ShadowRoot (nodeType 11) ends the walk
    }
    return n;
}
/** Runs fn while `textarea.focus()` cannot scroll the page (own property, removed afterwards). */
export function withoutFocusScroll(textarea, fn, { skipFocus = false } = {}) {
    if (!textarea || typeof textarea.focus !== 'function') return fn();
    const had = Object.prototype.hasOwnProperty.call(textarea, 'focus'), prev = textarea.focus;
    const proto = Object.getPrototypeOf(textarea)?.focus || prev;
    textarea.focus = skipFocus ? () => {} : (opts => proto.call(textarea, { ...(opts || {}), preventScroll: true }));
    try { return fn(); }
    finally { if (had) textarea.focus = prev; else delete textarea.focus; }
}
/** Is a text field focused (also inside shadow roots)? */
export function typingNow(doc = globalThis.document) {
    try { let a = doc.activeElement; while (a?.shadowRoot?.activeElement) a = a.shadowRoot.activeElement; return !!a?.matches?.(TEXT_FIELD); } catch { return false; }
}
/** While active() is true, a page scroll is undone on the next frame. Returns the cleanup function. */
export function guardPageScroll(active, doc = globalThis.document) {
    const win = doc?.defaultView; if (!win) return () => {};
    let raf = 0;
    const check = () => { raf = 0; if (active() && !typingNow(doc)) resetPageScroll(doc); };
    const on = e => {
        const t = e.target;
        if (t !== doc && t !== doc.documentElement && t !== doc.body && t !== doc.scrollingElement) return;
        if (!raf && active()) raf = win.requestAnimationFrame(check);
    };
    win.addEventListener('scroll', on, { capture: true, passive: true });
    return () => { win.removeEventListener('scroll', on, { capture: true }); if (raf) win.cancelAnimationFrame(raf); };
}

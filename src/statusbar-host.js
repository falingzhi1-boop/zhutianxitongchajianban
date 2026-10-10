// Native story renderer. One pass per chat floor replaces everything the v1.1 install needed regex scripts and
// Tavern Helper for:
//   * <ZhuTianPanel> → the ORIGINAL 诸天 3.1 status bar (all 8 tabs), rendered in a same-origin iframe exactly like Tavern
//     Helper did (vendor/original/statusbar-v3.1-shell.html + the vendored part1/2/3 scripts and css). Its seven host
//     calls go to the native Bridge instead of Tavern Helper.            (regex "诸天万界最强系统状态栏 3.1", maxDepth 1)
//   * older floors → the compact one-line summary (系统点 · 好感 · 任务), click to expand the full bar
//                                                                            (regex "诸天状态栏 · 旧楼层精简显示", minDepth 2)
//   * 莉莉丝：“…” → the Lilith voice card with tone avatar                    (regex "莉莉丝专属语音框", optional here)
//   * {{get_chat_variable::…}} in displayed text → value                     (Tavern Helper macro-like on render)
// Depth is SillyTavern's regex depth: 0 = newest floor.
import { BRIDGE_KEY, STATUSBAR_CLASS } from './contracts.js';
import { extractVoices, buildVoiceCard, hasVoice, LEGACY_VOICE_ID } from './voice-box.js';
import { tavernHelperMacrosActive } from './macro-like.js';
import { displayPanel, outsideThoughts } from './panel-guard.js';
import { scrollWithin, resetPageScroll } from './page-scroll.js';

export const PANEL_RE = /<ZhuTianPanel>([\s\S]*?)<\/ZhuTianPanel>/g;
const SLOT = i => `ZTPANELSLOT${i}ZT`;
const TOKEN = /(ZTPANELSLOT\d+ZT|ZTVOICESLOT\d+ZT)/;
const escapeText = s => String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
export function hash(text) { let h = 2166136261; for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); }
/** 1.1.1: a block that has story / <think> / other cards' code inside is shown cleaned — the stray text goes back into
 *  the story in front of the block, a block without a single field is plain story. Healthy blocks are returned as they
 *  are (same string: the engine keys each floor on the hash of the block). */
// 1.1.4: reasoning blocks outside the data block are skipped (a draft block in <think> is neither shown nor booked)
export function splitPanels(text) {
    const panels = []; const stripped = outsideThoughts(text, t => t.replace(PANEL_RE, (_, inner) => {
        const d = displayPanel(inner), story = d.story ? `\n\n${d.story}\n\n` : '';
        if (!d.ok) return story || ' ';
        panels.push(d.panel); return `${story}\n\n${SLOT(panels.length - 1)}\n\n`;
    }));
    return { panels, stripped };
}
/** Reads "字段: 值" / "字段：值" lines of a panel. */
export function panelFields(panel) {
    const out = {};
    for (const line of String(panel ?? '').split(/\r?\n/)) { const m = /^\s*([^:：\n]{1,12}?)\s*[:：]\s*(.*?)\s*$/.exec(line); if (m && !(m[1] in out)) out[m[1]] = m[2]; }
    return out;
}
/** The compact floor summary of the original "旧楼层精简显示" regex (same look; tolerant of missing fields). */
export function compactSummary(panel) {
    const f = panelFields(panel);
    if (!('系统点' in f) && !('当前任务' in f) && !('好感度' in f)) return null;
    return { points: f.系统点 ?? '—', favor: f.好感度 ?? '—', task: f.当前任务 ?? '暂无任务' };
}
/** Is the old regex (TH-rendered) status bar still active? Global or character-scoped regex with the panel pattern. */
export function legacyRegexActive(c) {
    const lists = [c?.extensionSettings?.regex, c?.characters?.[c?.characterId]?.data?.extensions?.regex_scripts];
    return lists.some(list => Array.isArray(list) && list.some(r => r && !r.disabled && !r.promptOnly && /ZhuTianPanel/.test(String(r.findRegex || '')) && /<(?:html|body|div|style|script)/i.test(String(r.replaceString || '')) && !/精简/.test(String(r.scriptName || ''))));
}
export function legacyVoiceActive(c) {
    const lists = [c?.extensionSettings?.regex, c?.characters?.[c?.characterId]?.data?.extensions?.regex_scripts];
    return lists.some(list => Array.isArray(list) && list.some(r => r && !r.disabled && (r.id === LEGACY_VOICE_ID || /data-lilith-voice/.test(String(r.replaceString || '')))));
}
/** 0.8.2 fix — character-card status bars (Tavern Helper front-end code blocks) vanished when this extension was on.
 *  0.8.4 — generalised to every other renderer / beautification. Our floor renderer rebuilds .mes_text (voice card,
 *  诸天 data block, macros) from SillyTavern's own messageFormatting. Anything ANOTHER extension put into the floor after
 *  SillyTavern rendered it — Tavern Helper's div.TH-render, 小白X / other iframe renderers, JS beautifiers that wrap or
 *  restyle paragraphs, a code block replaced by a rendered card — used to be lost (or shown twice: raw code + card).
 *
 *  How: `ref` is SillyTavern's untouched render of the same message. Old top-level nodes that are neither ours nor in
 *  `ref` are foreign → they stay in place (same node, an iframe inside is NOT reloaded). An ST node a foreign node
 *  replaced (a <pre>, or on a floor we never touched any node) is not re-added next to it, so nothing appears twice.
 *  A node edited in place (same text, other markup: a JS beautifier wrapping words, adding classes) is kept too.
 *  New nodes are inserted around the kept ones in order. Without `ref`, only div.TH-render is treated as foreign (0.8.2). */
export const FOREIGN_SELECTOR = 'div.TH-render';
const OWN = new WeakSet();                                   // nodes this renderer inserted (survive between passes)
const FRONTEND = /<(?:!doctype|html|head|body|script|style)\b/i;
const blank = n => (n.nodeType === 3 && !n.nodeValue.trim()) || n.nodeType === 8;
const sig = n => n.nodeType === 1 ? n.outerHTML : n.nodeType === 3 ? '#' + n.nodeValue.trim() : '';
const OURS_SEL = '.zt-render-mark,.zt-lilith-voice,[data-lilith-voice],[data-zt-native],[data-zt-frame],.' + STATUSBAR_CLASS;
export const isOurs = n => OWN.has(n) || (n.nodeType === 1 && (!!n.matches?.(OURS_SEL) || /(^|\s)zt-/.test(typeof n.className === 'string' ? n.className : '')));
const hasFrame = n => n.nodeType === 1 && (n.matches('iframe,' + FOREIGN_SELECTOR) || !!n.querySelector('iframe,' + FOREIGN_SELECTOR));
const isPre = n => n.nodeType === 1 && (n.tagName === 'PRE' || (n.childElementCount === 1 && n.firstElementChild.tagName === 'PRE' && !n.textContent.replace(n.firstElementChild.textContent, '').trim()));
/** Longest common subsequence of two signature lists → matched index pairs. */
export function lcsPairs(a, b) {
    const n = a.length, m = b.length; if (!n || !m) return [];
    const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    const out = []; let i = 0, j = 0;
    while (i < n && j < m) { if (a[i] === b[j]) { out.push([i, j]); i++; j++; } else if (dp[i + 1][j] >= dp[i][j + 1]) i++; else j++; }
    return out;
}
/** Text-only key: a node another script edited IN PLACE (wrapped words in spans, added classes / styles, swapped a
 *  <p> for a <div>) keeps its text. Empty-text elements (hr, img) fall back to their tag. */
const textKey = n => n.nodeType === 1 ? (n.textContent.replace(/\s+/g, ' ').trim() || '<' + n.tagName + '>') : sig(n);
/** In-place edits: old node ≈ ST's node by text but differs in markup, and our new node IS ST's node (we did not change
 *  it) → the old, edited node replaces our copy. Frames are left to the foreign path (moving an iframe reloads it). */
function keepEdited(O, box, ref) {
    const A = [...ref.childNodes].filter(n => !blank(n)), N = [...box.childNodes].filter(n => !blank(n));
    const aToN = new Map(lcsPairs(A.map(sig), N.map(sig))); let kept = 0;
    for (const [i, j] of lcsPairs(O.map(textKey), A.map(textKey))) {
        const o = O[i], a = A[j], n = N[aToN.get(j)];
        if (!n || o.nodeType !== 1 || sig(o) === sig(a) || hasFrame(o) || o.matches?.(OURS_SEL) || o.querySelector?.(OURS_SEL)) continue;
        n.replaceWith(o); kept++;
    }
    return kept;
}
/** 0.9.2 — is an old node that matches nothing really another extension's, or SillyTavern's own text that someone
 *  touched? Phones showed the 【莉莉丝】 line twice (raw + card) and the raw 系统点 / 好感度 lines of the data block: a
 *  keyword highlighter had wrapped words of those paragraphs (or a variable extension had changed the message after
 *  SillyTavern drew it), so they no longer equalled SillyTavern's render and were kept as "foreign".
 *  SillyTavern text = no frame inside AND (its text is a whole node of the reference, OR its text appears in the
 *  reference prose — code blocks excluded, so a card rendered from a code block is still foreign — OR it contains the
 *  text of a voice line / data block this renderer replaced). Those are never kept: our render shows them correctly. */
const squash = s => String(s ?? '').replace(/\s+/g, '');
export function stText(n, ref, consumed = []) {
    if (n.nodeType !== 1 && n.nodeType !== 3) return false;
    if (n.nodeType === 1 && hasFrame(n)) return false;
    const T = squash(n.textContent); if (!T) return false;
    // a voice line's text alone is enough; data-block lines need two (a card may show one 好感度 line of its own)
    for (const g of consumed) { const hit = (g?.snips || []).filter(c => c && T.includes(c)).length; if (hit && hit >= Math.min(g.need || 1, g.snips.length)) return true; }
    if (!ref) return false;
    const A = [...ref.childNodes].filter(a => !blank(a));
    if (A.some(a => squash(a.textContent) === T)) return true;
    if (T.length < 2) return false;
    const prose = ref.cloneNode(true); prose.querySelectorAll('pre,script,style,textarea').forEach(x => x.remove());
    return squash(prose.textContent).includes(T);
}
/** Snippets of what a floor render replaced (voice line text, data block lines) → stText(). Pure, for tests. */
export function consumedSnippets(voices = [], panels = []) {
    const out = [];
    for (const v of voices) { const s = squash(v?.text); if (s.length >= 4) out.push({ snips: [s.slice(0, 24)], need: 1 }); }
    for (const p of panels) { const snips = String(p ?? '').split(/\r?\n/).map(squash).filter(s => /[:：]/.test(s) && s.length >= 4); if (snips.length) out.push({ snips, need: 2 }); }
    return out;
}
export function swapContent(target, box, ref = null, consumed = []) {
    // O is taken BEFORE edited nodes move into `box`: they stay in it, so the old ↔ new alignment (and with it the
    // position of foreign nodes next to them) still sees them on both sides.
    const O = [...target.childNodes].filter(n => !blank(n));
    if (ref) keepEdited(O, box, ref);
    let foreign;
    if (ref) {
        const A = [...ref.childNodes].filter(n => !blank(n)), Nk = [...box.childNodes].filter(n => !blank(n));
        const inA = new Set(lcsPairs(O.map(sig), A.map(sig)).map(([i]) => i)), inN = new Set(lcsPairs(O.map(sig), Nk.map(sig)).map(([i]) => i));
        foreign = O.filter((n, i) => !isOurs(n) && !inA.has(i) && !inN.has(i) && !stText(n, ref, consumed));
    } else foreign = [...target.querySelectorAll(':scope > ' + FOREIGN_SELECTOR)];
    // nested Tavern Helper wrappers (inside details/blockquote of an ST node): keep the 0.8.2 behaviour — the new <pre>
    // is swapped for the old wrapper (which has to move; only happens when the surrounding node is rebuilt).
    const nestedTH = [...target.querySelectorAll(FOREIGN_SELECTOR)].filter(w => !foreign.some(f => f === w || f.contains(w)));
    if (!foreign.length && !nestedTH.length) {
        const nodes = [...box.childNodes]; target.replaceChildren(...nodes); nodes.forEach(n => OWN.add(n)); return 0;
    }
    const preText = el => (el?.matches?.('pre') ? el : el?.querySelector?.('pre'))?.textContent ?? '';
    for (const pre of [...box.querySelectorAll('pre')]) {
        if (!nestedTH.length) break; if (pre.parentNode === box) continue;
        let i = nestedTH.findIndex(k => preText(k) === pre.textContent);
        if (i < 0 && FRONTEND.test(pre.textContent)) i = nestedTH.findIndex(k => FRONTEND.test(preText(k)));
        if (i >= 0) pre.replaceWith(nestedTH.splice(i, 1)[0]);
    }
    // positions: align old ↔ new; each foreign node goes after the new node matching its last matched old predecessor
    const N = [...box.childNodes], Nk = N.filter(n => !blank(n));
    const pairs = lcsPairs(O.map(sig), Nk.map(sig)), oToN = new Map(pairs);
    const gapOfForeign = new Map(); let last = -1;
    for (let i = 0; i < O.length; i++) { if (oToN.has(i)) last = oToN.get(i); else if (foreign.includes(O[i])) gapOfForeign.set(O[i], last); }
    const gapsWithForeign = new Set(gapOfForeign.values()), framed = new Set([...gapOfForeign].filter(([f]) => hasFrame(f)).map(([, g]) => g));
    const pristine = !O.some(n => OWN.has(n));                // first pass over an ST render: foreign may have replaced any node
    const matchedN = new Set(pairs.map(([, j]) => j));
    const drop = new Set(); last = -1;
    Nk.forEach((n, j) => {
        if (matchedN.has(j)) { last = j; return; }
        if (!gapsWithForeign.has(last)) return;
        const replaced = ref ? [...ref.childNodes].some(a => !blank(a) && sig(a) === sig(n)) && !O.some(o => sig(o) === sig(n)) : false;
        if ((replaced && (isPre(n) || pristine)) || (framed.has(last) && isPre(n) && FRONTEND.test(n.textContent))) drop.add(n);
    });
    // 0.9.2: a foreign node that replaced a node of ours (Tavern Helper / 小白X turning a code block into an iframe card)
    // goes exactly where that node is in the new render — not right after the last matched node, which put the card
    // status bar ABOVE a voice card that belongs before it ("one card ended up under the status bar").
    const gapHasDrop = new Set(); last = -1;
    Nk.forEach((n, j) => { if (matchedN.has(j)) last = j; else if (drop.has(n)) gapHasDrop.add(last); });
    const plan = []; last = -1; let k = 0;
    const flush = g => { for (const [f, gf] of gapOfForeign) if (gf === g && !plan.includes(f)) plan.push(f); };
    if (!gapHasDrop.has(-1)) flush(-1);
    for (const n of N) {
        if (blank(n)) { plan.push(n); continue; }
        const j = Nk.indexOf(n, k); k = j + 1;
        if (drop.has(n)) { flush(last); continue; }                          // the replaced node's place
        plan.push(n);
        if (matchedN.has(j)) { last = j; if (!gapHasDrop.has(j)) flush(j); }
        else if (j === Nk.length - 1 || matchedN.has(j + 1)) flush(last);   // end of a run of new nodes: foreign of that gap
    }
    for (const f of gapOfForeign.keys()) if (!plan.includes(f)) plan.push(f);
    const keep = new Set(plan.filter(n => n.parentNode === target && foreign.includes(n)));
    for (const n of [...target.childNodes]) if (!keep.has(n)) n.remove();          // only the kept foreign nodes stay put
    let cursor = target.firstChild;
    for (const n of plan) { if (n === cursor) { cursor = cursor.nextSibling; continue; } target.insertBefore(n, cursor); if (!keep.has(n)) OWN.add(n); }
    return keep.size;
}
export function tavernHelperPresent() { return !!(globalThis.TavernHelper || document.querySelector('iframe[id^="TH-message--"], #tavern_helper')); }

export class StatusBarHost {
    constructor(adapter, bridge, settings, base, extras = {}) {
        this.adapter = adapter; this.bridge = bridge; this.settings = settings; this.base = base;
        this.macros = extras.macros || null; this.voiceKit = extras.voice || null;
        this.template = null; this.frames = new Map(); this.timer = 0; this.dead = false; this.disposers = []; this.seq = 0;
        this.state = { mode: 'off', reason: '' }; this.counts = { panels: 0, voices: 0, compact: 0, macros: 0 };
    }
    ctx() { return this.adapter.context(); }
    async start() {
        const r = await fetch(this.base + 'vendor/original/statusbar-v3.1-shell.html', { cache: 'no-cache' });
        if (!r.ok) throw Error('原版状态栏模板缺失：HTTP ' + r.status);
        this.template = (await r.text()).replaceAll('__ZT_VENDOR__/', this.base + 'vendor/original/');
        const registry = globalThis[BRIDGE_KEY] ||= { frames: new Map() };
        this.registry = registry;
        const c = this.ctx(), on = (key, fn) => { const e = c.eventTypes[key]; if (!e) return; c.eventSource.on(e, fn); this.disposers.push(() => c.eventSource.removeListener(e, fn)); };
        for (const key of ['CHAT_CHANGED', 'MORE_MESSAGES_LOADED', 'CHARACTER_MESSAGE_RENDERED', 'USER_MESSAGE_RENDERED', 'MESSAGE_UPDATED', 'MESSAGE_EDITED', 'MESSAGE_SWIPED', 'MESSAGE_DELETED', 'GENERATION_ENDED', 'GENERATION_STOPPED']) on(key, () => this.schedule(key === 'CHAT_CHANGED' ? 60 : 30));
        const chat = document.getElementById('chat');
        if (chat) {
            this.observer = new MutationObserver(list => { if (list.some(m => !(m.target.closest?.('.' + STATUSBAR_CLASS + ',.zt-lilith-voice')))) this.schedule(160); });
            this.observer.observe(chat, { childList: true, subtree: true });
        }
        // 0.8.5: the stop button hiding = generation over, even when GENERATION_ENDED never arrives (phones).
        const stop = document.getElementById('mes_stop');
        if (stop) { const mo = new MutationObserver(() => this.schedule(200)); mo.observe(stop, { attributes: true, attributeFilter: ['style', 'class', 'hidden'] }); this.disposers.push(() => mo.disconnect()); }
        const keys = ['statusbar', 'statusbarMaxDepth', 'compactHistory', 'voiceBox', 'macroLike', 'floorTag'];
        this.disposers.push(this.settings.onChange(k => { if (keys.includes(k)) this.rebuild(); }));
        this.schedule(0);
    }
    decideMode() {
        const want = this.settings.get('statusbar'), c = this.ctx();
        if (want === 'off') return { mode: 'off', reason: '已在设置中关闭诸天系统面板处理。' };
        if (want !== 'native' && legacyRegexActive(c) && tavernHelperPresent()) return { mode: 'yield', reason: '检测到旧状态栏正则与酒馆助手同时启用：插件自动让位，避免两个引擎写同一账本。请在终端「设置」里用“一键接管旧版”停用旧正则。' };
        if (want === 'native') return { mode: 'native', reason: '兼容模式：聊天楼层内仍渲染原版 3.1 状态栏（终端里同样可操作）。' };
        return { mode: 'terminal', reason: '终端模式：系统数据块由终端记账，楼层内只留一个小标签，不再显示状态栏。' };
    }
    get active() { return this.state.mode === 'native' || this.state.mode === 'terminal'; }
    schedule(ms = 120) { if (this.dead) return; clearTimeout(this.timer); this.timer = setTimeout(() => this.scan(), ms); }
    rebuild() { for (const el of document.querySelectorAll('#chat .mes[mesid]')) delete el.dataset.ztSig; this.schedule(0); }
    maxDepth() { const n = Number(this.settings.get('statusbarMaxDepth')); return Number.isFinite(n) && n >= 0 ? Math.min(10, Math.floor(n)) : 1; }
    /** What this floor needs from us. */
    plan(m) {
        const text = m?.mes || '';
        PANEL_RE.lastIndex = 0;
        const panels = (this.state.mode === 'native' || this.state.mode === 'terminal') && PANEL_RE.test(text); PANEL_RE.lastIndex = 0;
        const yieldPanels = this.state.mode === 'yield' && /<ZhuTianPanel>/.test(text);
        const voice = !yieldPanels && this.settings.get('voiceBox') !== false && !m.is_user && !m.is_system && hasVoice(text);
        const macro = !yieldPanels && !!this.macros?.has(text) && !tavernHelperMacrosActive(this.ctx());   // TH replaces them itself
        return { panels, voice, macro, any: panels || voice || macro };
    }
    scan() {
        if (this.dead) return;
        const c = this.ctx(); const prev = this.state.mode; this.state = this.decideMode();
        if (prev !== this.state.mode) this.adapter.notify();
        const chat = c.chat || [], last = chat.length - 1, maxDepth = this.maxDepth();
        // 0.8.5: only while SillyTavern really streams (its stop button is visible). A stale "generating" state used to
        // skip the last floor for good — on phones the raw <ZhuTianPanel> text stayed in the chat.
        const stop = document.getElementById('mes_stop');
        const generating = this.adapter.isGenerating() && (!stop || (stop.getClientRects().length > 0 && getComputedStyle(stop).display !== 'none'));
        for (const el of document.querySelectorAll('#chat .mes[mesid]')) {
            const id = Number(el.getAttribute('mesid')), m = chat[id];
            const text = el.querySelector('.mes_text');
            const ours = !!text?.querySelector(':scope > .zt-render-mark');
            const p = m ? this.plan(m) : { any: false };
            if (!p.any) { if (ours || el.querySelector('.' + STATUSBAR_CLASS)) this.unmount(el, m, id); continue; }
            if (generating && id === last) continue;               // never fight the streaming renderer
            const live = last - id <= maxDepth;
            const sig = [this.state.mode, id, m.swipe_id ?? 0, hash(m.mes || ''), live ? 1 : 0, p.panels ? 1 : 0, p.voice ? 1 : 0, p.macro ? 1 : 0, this.settings.get('compactHistory') === false ? 0 : 1].join(':');
            if (el.dataset.ztSig === sig && ours) continue;
            this.render(el, m, id, live, p); el.dataset.ztSig = sig;
        }
        this.onScan?.();
    }
    /** 0.8.5 兼容诊断: is the newest floor that carries a <ZhuTianPanel> rendered, and if not, why. */
    diagnoseLast() {
        const chat = this.ctx().chat || [];
        let id = -1; for (let i = chat.length - 1; i >= Math.max(0, chat.length - 10); i--) if (/<ZhuTianPanel>/.test(chat[i]?.mes || '')) { id = i; break; }
        if (id < 0) return { ok: null, text: '最近 10 层里没有 <ZhuTianPanel> 数据块（模型这几轮没输出，或被别的正则改掉了）。' };
        const el = document.querySelector(`#chat .mes[mesid="${id}"]`), t = el?.querySelector('.mes_text');
        if (!t) return { ok: null, text: `第 ${id} 层不在当前已加载的聊天里。` };
        if (!this.active) return { ok: false, floor: id, text: `第 ${id} 层没有处理：${this.state.reason || this.state.mode}` };
        if (t.querySelector(':scope > .zt-render-mark')) return { ok: true, floor: id, text: `第 ${id} 层已正常显示为诸天数据标签。` };
        return { ok: false, floor: id, text: `第 ${id} 层还没处理${this.adapter.isGenerating() ? '（插件认为主聊天仍在生成）' : ''}。点「重新渲染楼层」。` };
    }
    unmount(el, m, id) {
        for (const f of el.querySelectorAll('.' + STATUSBAR_CLASS + ' iframe')) this.release(f);
        delete el.dataset.ztSig;
        const text = el.querySelector('.mes_text');
        if (text && m) { const box = document.createElement('div'); box.innerHTML = this.ctx().messageFormatting(m.mes, m.name, m.is_system, m.is_user, id); swapContent(text, box, box.cloneNode(true)); }
    }
    render(el, m, id, live, p) {
        const c = this.ctx(), text = el.querySelector('.mes_text'); if (!text) return;
        for (const f of el.querySelectorAll('.' + STATUSBAR_CLASS + ' iframe')) this.release(f);
        let source = m.mes || '';
        if (p.macro) { source = this.macros.replace(source, { message_id: id, role: m.is_user ? 'user' : 'assistant' }); this.counts.macros++; }
        let panels = [];
        if (p.panels) ({ panels, stripped: source } = splitPanels(source));
        let voices = [];
        if (p.voice) ({ voices, text: source } = extractVoices(source));
        const box = document.createElement('div');
        box.innerHTML = c.messageFormatting(source, m.name, m.is_system, m.is_user, id);
        const walker = document.createTreeWalker(box, NodeFilter.SHOW_TEXT), hits = [];
        while (walker.nextNode()) if (TOKEN.test(walker.currentNode.nodeValue)) hits.push(walker.currentNode);
        const usedP = new Set(), usedV = new Set();
        for (const node of hits) {
            const parts = node.nodeValue.split(/(ZTPANELSLOT\d+ZT|ZTVOICESLOT\d+ZT)/), frag = document.createDocumentFragment();
            for (const part of parts) {
                const mp = /^ZTPANELSLOT(\d+)ZT$/.exec(part), mv = /^ZTVOICESLOT(\d+)ZT$/.exec(part);
                if (mp && panels[Number(mp[1])] !== undefined) { usedP.add(Number(mp[1])); frag.append(this.mount(panels[Number(mp[1])], id, live)); }
                else if (mv && voices[Number(mv[1])]) { usedV.add(Number(mv[1])); frag.append(this.voiceCard(voices[Number(mv[1])])); }
                else if (part) frag.append(part);
            }
            const block = node.parentElement;
            if (block && block !== box && block.childNodes.length === 1 && /^(P|SPAN|DIV)$/.test(block.tagName)) block.replaceWith(frag); else node.replaceWith(frag);
        }
        panels.forEach((pn, i) => { if (!usedP.has(i)) box.append(this.mount(pn, id, live)); }); // markdown swallowed the slot: still show it
        voices.forEach((v, i) => { if (!usedV.has(i)) box.append(this.voiceCard(v)); });
        // SillyTavern's own render of this message: what other extensions saw and may have changed (see swapContent)
        const ref = document.createElement('div'); ref.innerHTML = c.messageFormatting(m.mes || '', m.name, m.is_system, m.is_user, id);
        swapContent(text, box, ref, consumedSnippets(voices, panels));
        this.counts.panels += panels.length; this.counts.voices += voices.length;
        const mark = document.createElement('span'); mark.className = 'zt-render-mark'; mark.hidden = true; text.append(mark);
    }
    voiceCard(v) { return buildVoiceCard(document, v, this.voiceKit); }
    mount(panel, id, live) {
        const box = document.createElement('div'); box.className = STATUSBAR_CLASS; box.dataset.floor = String(id);
        if (this.state.mode === 'terminal') return this.tag(box, panel, id);
        if (!live) {
            const sum = this.settings.get('compactHistory') !== false ? compactSummary(panel) : null;
            if (sum) {
                const card = document.createElement('div'); card.className = 'zt-sb-compact'; card.setAttribute('role', 'button'); card.tabIndex = 0;
                card.title = `楼 ${id} · 历史状态栏（点击展开；只有最新楼层会结算）`;
                card.setAttribute('style', 'margin:8px 0;padding:9px 12px;border:1px solid rgba(124,153,135,.28);background:rgba(124,153,135,.09);border-radius:10px;display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 14px;font-size:12px;line-height:1.7;color:inherit;overflow-wrap:anywhere;cursor:pointer;');
                card.innerHTML = `<span style="font-weight:600;letter-spacing:.5px;">◇ 诸天系统</span><span>系统点 <b>${escapeText(sum.points)}</b></span><span>好感 ${escapeText(sum.favor)}</span><span style="flex:1 1 150px;min-width:0;">任务：${escapeText(sum.task)}</span><span class="zt-sb-expand" style="opacity:.6">展开 ▾</span>`;
                const open = () => card.replaceWith(this.frame(panel, id));
                card.addEventListener('click', open); card.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
                box.append(card); this.counts.compact++; return box;
            }
            const b = document.createElement('button'); b.type = 'button'; b.className = 'zt-sb-history menu_button';
            b.textContent = `楼 ${id} · 历史状态栏（点击展开；只有最新楼层会结算）`;
            b.addEventListener('click', () => { b.replaceWith(this.frame(panel, id)); });
            box.append(b); return box;
        }
        box.append(this.frame(panel, id)); return box;
    }
    /** Terminal mode: the data block is kept out of the story; one small chip says it was recorded and opens the terminal. */
    tag(box, panel, id) {
        box.classList.add('zt-floor-tag-box');
        if (this.settings.get('floorTag') === false) { box.hidden = true; return box; }
        const sum = compactSummary(panel), chip = document.createElement('button');
        chip.type = 'button'; chip.className = 'zt-floor-tag'; chip.dataset.floor = String(id);
        chip.title = '诸天系统 · 本楼数据已由终端记录（点击打开终端）';
        chip.innerHTML = `<span class="zt-floor-tag-mark">✧</span><span>系统已记录</span>${sum ? `<span class="zt-floor-tag-v">系统点 ${escapeText(sum.points)}</span><span class="zt-floor-tag-v">${escapeText(sum.task)}</span>` : ''}<span class="zt-floor-tag-go">查看 ›</span>`;
        chip.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); this.openHub?.('ov', id); });
        box.append(chip); this.counts.compact++; return box;
    }
    /** Latest floor that carries a data block (what the terminal engine is bound to). */
    latestPanel() {
        const chat = this.ctx()?.chat || [];
        for (let i = chat.length - 1; i >= 0; i--) {
            const m = chat[i]; if (!m || m.is_user || m.is_system) continue;
            PANEL_RE.lastIndex = 0; const hit = PANEL_RE.exec(m.mes || ''); PANEL_RE.lastIndex = 0;
            // 1.1.1: a block with no field at all (story wrapped in tags) is not a data block
            if (hit) { const all = splitPanels(m.mes || '').panels; if (all.length) return { id: i, panel: all.at(-1) }; }
        }
        return null;
    }
    frame(panel, id, opts = {}) {
        const token = 'f' + (++this.seq) + '-' + Date.now().toString(36);
        const iframe = document.createElement('iframe');
        iframe.dataset.ztFloor = String(id);
        iframe.className = 'zt-sb-frame'; iframe.dataset.ztFrame = token; iframe.title = '诸天系统状态栏 · 楼 ' + id;
        iframe.setAttribute('scrolling', 'no'); iframe.style.cssText = 'width:100%;border:0;display:block;height:560px;background:transparent;';
        const c = this.ctx(); let content = panel;
        try { content = c.substituteParams(panel); } catch { /* same as the regex engine; keep raw on failure */ }
        if (this.macros) content = this.macros.replace(content, { message_id: id, role: 'assistant' });
        this.registry.frames.set(token, this.bridge.frameApi(() => id, opts.lastId));
        this.frames.set(iframe, token);
        const boot = `<script>(function(){var api=parent.${BRIDGE_KEY}&&parent.${BRIDGE_KEY}.frames.get(frameElement&&frameElement.dataset.ztFrame);if(!api){document.documentElement.setAttribute('data-zt-bridge','missing');return;}for(var k in api)window[k]=api[k];window.SillyTavern=parent.SillyTavern;var nf=window.fetch.bind(window);window.fetch=function(u,o){return nf(u,o).catch(function(e){var s=String(u);if((!o||!o.method||o.method==='GET')&&/\\/models$/.test(s)){var a=o&&o.headers&&o.headers.Authorization;return api.listModels(s.replace(/\\/(v1\\/)?models$/,''),a?String(a).replace(/^Bearer\\s+/,''):'').then(function(l){return new Response(JSON.stringify({data:l.map(function(x){return{id:x}})}),{status:200,headers:{'Content-Type':'application/json'}})});}throw e;});};document.documentElement.setAttribute('data-zt-bridge','native');})();<\/script>`;
        const fit = `<script>(function(){var f=frameElement;if(!f)return;var last=0;function fit(){var h=Math.ceil(Math.max(document.body?document.body.scrollHeight:0,document.documentElement.scrollHeight));if(h&&Math.abs(h-last)>1){last=h;f.style.height=h+'px';}}new ResizeObserver(fit).observe(document.documentElement);if(document.body)new ResizeObserver(fit).observe(document.body);addEventListener('load',fit);setTimeout(fit,50);setTimeout(fit,600);})();<\/script>`;
        let html = this.template.replace('$1', () => escapeText(content));
        html = html.replace(/<head>/i, m => m + boot).replace(/<\/body>/i, m => (opts.fill ? '' : fit) + m);
        if (opts.fill) { iframe.removeAttribute('scrolling'); iframe.style.cssText = 'width:100%;height:100%;border:0;display:block;background:transparent;'; iframe.className = 'zt-engine-frame'; iframe.title = '诸天系统引擎 · 楼 ' + id; }
        // 0.8.4: the status bar's own ⚙ API dialog wrote only the status-bar copy of the API config (a third place).
        // Its gear now opens the one API 中心 (terminal 连接 page when the terminal is open, otherwise the popup).
        iframe.addEventListener('load', () => {
            const d = iframe.contentDocument; if (!d) return;
            this.enhanceFrame?.(iframe, d);
            d.addEventListener('click', e => {
                if (!e.target?.closest?.('.btn-open-api,label[for="api-modal-toggle"]')) return;
                if (typeof this.openApi !== 'function') return;     // no app hook: keep the original dialog
                e.preventDefault(); e.stopPropagation(); this.openApi();
            }, true);
        });
        iframe.srcdoc = html;
        return iframe;
    }
    isCurrent(iframe) { return this.registry?.frames.get(this.frames.get(iframe))?.isCurrent() === true; }
    release(iframe) { const t = this.frames.get(iframe); if (t) { this.registry?.frames.get(t)?.dispose(); this.registry?.frames.delete(t); this.frames.delete(iframe); } }
    latestFrame() { const all = [...document.querySelectorAll('#chat .' + STATUSBAR_CLASS)]; return all.at(-1) || null; }
    focusLatest() { if (this.openHub) { this.openHub('ov'); return true; } const box = this.latestFrame(); if (!box) return false; scrollWithin(box, { behavior: 'smooth', block: 'center' }); resetPageScroll(); box.querySelector('button.zt-sb-history,.zt-sb-compact')?.click(); return true; }
    /** New-chat initialization using the ORIGINAL ensureSystemVars() of the status bar (same defaults, same schema). */
    async initializeChat() {
        if (!this.template) throw Error('原版状态栏模板未加载。');
        const iframe = this.frame('', -1); iframe.style.cssText = 'position:fixed;left:-9999px;top:0;width:360px;height:200px;border:0;visibility:hidden';
        document.body.append(iframe);
        try {
            await new Promise((resolve, reject) => { const t = setTimeout(() => reject(Error('状态栏初始化超时')), 20000); iframe.addEventListener('load', () => { clearTimeout(t); resolve(); }, { once: true }); });
            const w = iframe.contentWindow;
            if (typeof w.ensureSystemVars !== 'function') throw Error('原版 ensureSystemVars 不可用。');
            await w.ensureSystemVars();
            return this.bridge.getVariables({ type: 'chat' }).诸天系统 || null;
        } finally { this.release(iframe); iframe.remove(); }
    }
    dispose() {
        this.dead = true; clearTimeout(this.timer); this.observer?.disconnect(); this.disposers.splice(0).forEach(f => f());
        const c = this.ctx();
        for (const el of document.querySelectorAll('#chat .mes[mesid]')) { const t = el.querySelector('.mes_text'); if (el.querySelector('.' + STATUSBAR_CLASS) || t?.querySelector(':scope > .zt-render-mark')) { const id = Number(el.getAttribute('mesid')); this.unmount(el, c.chat?.[id], id); } }
        for (const [f] of this.frames) this.release(f);
    }
}

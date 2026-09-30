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
import { extractVoices, buildVoiceCard, voiceRegex, LEGACY_VOICE_ID } from './voice-box.js';

export const PANEL_RE = /<ZhuTianPanel>([\s\S]*?)<\/ZhuTianPanel>/g;
const SLOT = i => `ZTPANELSLOT${i}ZT`;
const TOKEN = /(ZTPANELSLOT\d+ZT|ZTVOICESLOT\d+ZT)/;
const escapeText = s => String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
export function hash(text) { let h = 2166136261; for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); }
export function splitPanels(text) {
    const panels = []; const stripped = String(text ?? '').replace(PANEL_RE, (_, inner) => { panels.push(inner); return `\n\n${SLOT(panels.length - 1)}\n\n`; });
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
        const keys = ['statusbar', 'statusbarMaxDepth', 'compactHistory', 'voiceBox', 'macroLike'];
        this.disposers.push(this.settings.onChange(k => { if (keys.includes(k)) this.rebuild(); }));
        this.schedule(0);
    }
    decideMode() {
        const want = this.settings.get('statusbar'), c = this.ctx();
        if (want === 'off') return { mode: 'off', reason: '已在设置中关闭原生状态栏。' };
        if (want === 'auto' && legacyRegexActive(c) && tavernHelperPresent()) return { mode: 'yield', reason: '检测到旧状态栏正则与酒馆助手同时启用：原生状态栏自动让位，避免两个引擎写同一账本。用“一键接管旧版”停用旧正则，或把模式改为“强制原生”即可接管。' };
        return { mode: 'native', reason: legacyRegexActive(c) ? '旧状态栏正则仍启用，但原生渲染会先拆出面板块，旧正则不会再生效（酒馆助手未运行）。' : '原生状态栏运行中（无需酒馆助手、无需正则）。' };
    }
    get active() { return this.state.mode === 'native'; }
    schedule(ms = 120) { if (this.dead) return; clearTimeout(this.timer); this.timer = setTimeout(() => this.scan(), ms); }
    rebuild() { for (const el of document.querySelectorAll('#chat .mes[mesid]')) delete el.dataset.ztSig; this.schedule(0); }
    maxDepth() { const n = Number(this.settings.get('statusbarMaxDepth')); return Number.isFinite(n) && n >= 0 ? Math.min(10, Math.floor(n)) : 1; }
    /** What this floor needs from us. */
    plan(m) {
        const text = m?.mes || '';
        PANEL_RE.lastIndex = 0;
        const panels = this.state.mode === 'native' && PANEL_RE.test(text); PANEL_RE.lastIndex = 0;
        const yieldPanels = this.state.mode === 'yield' && /<ZhuTianPanel>/.test(text);
        const voice = !yieldPanels && this.settings.get('voiceBox') !== false && !m.is_user && !m.is_system && voiceRegex().test(text);
        const macro = !yieldPanels && !!this.macros?.has(text);
        return { panels, voice, macro, any: panels || voice || macro };
    }
    scan() {
        if (this.dead) return;
        const c = this.ctx(); const prev = this.state.mode; this.state = this.decideMode();
        if (prev !== this.state.mode) this.adapter.notify();
        const chat = c.chat || [], last = chat.length - 1, maxDepth = this.maxDepth();
        const generating = this.adapter.isGenerating();
        for (const el of document.querySelectorAll('#chat .mes[mesid]')) {
            const id = Number(el.getAttribute('mesid')), m = chat[id];
            const text = el.querySelector('.mes_text');
            const ours = !!text?.querySelector(':scope > .zt-render-mark');
            const p = m ? this.plan(m) : { any: false };
            if (!p.any) { if (ours || el.querySelector('.' + STATUSBAR_CLASS)) this.unmount(el, m, id); continue; }
            if (generating && id === last) continue;               // never fight the streaming renderer
            const live = last - id <= maxDepth;
            const sig = [id, m.swipe_id ?? 0, hash(m.mes || ''), live ? 1 : 0, p.panels ? 1 : 0, p.voice ? 1 : 0, p.macro ? 1 : 0, this.settings.get('compactHistory') === false ? 0 : 1].join(':');
            if (el.dataset.ztSig === sig && ours) continue;
            this.render(el, m, id, live, p); el.dataset.ztSig = sig;
        }
    }
    unmount(el, m, id) {
        for (const f of el.querySelectorAll('.' + STATUSBAR_CLASS + ' iframe')) this.release(f);
        delete el.dataset.ztSig;
        const text = el.querySelector('.mes_text');
        if (text && m) text.innerHTML = this.ctx().messageFormatting(m.mes, m.name, m.is_system, m.is_user, id);
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
        text.innerHTML = c.messageFormatting(source, m.name, m.is_system, m.is_user, id);
        const walker = document.createTreeWalker(text, NodeFilter.SHOW_TEXT), hits = [];
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
            if (block && block !== text && block.childNodes.length === 1 && /^(P|SPAN|DIV)$/.test(block.tagName)) block.replaceWith(frag); else node.replaceWith(frag);
        }
        panels.forEach((pn, i) => { if (!usedP.has(i)) text.append(this.mount(pn, id, live)); }); // markdown swallowed the slot: still show it
        voices.forEach((v, i) => { if (!usedV.has(i)) text.append(this.voiceCard(v)); });
        this.counts.panels += panels.length; this.counts.voices += voices.length;
        const mark = document.createElement('span'); mark.className = 'zt-render-mark'; mark.hidden = true; text.append(mark);
    }
    voiceCard(v) { return buildVoiceCard(document, v, this.voiceKit); }
    mount(panel, id, live) {
        const box = document.createElement('div'); box.className = STATUSBAR_CLASS; box.dataset.floor = String(id);
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
    frame(panel, id) {
        const token = 'f' + (++this.seq) + '-' + Date.now().toString(36);
        const iframe = document.createElement('iframe');
        iframe.className = 'zt-sb-frame'; iframe.dataset.ztFrame = token; iframe.title = '诸天系统状态栏 · 楼 ' + id;
        iframe.setAttribute('scrolling', 'no'); iframe.style.cssText = 'width:100%;border:0;display:block;height:560px;background:transparent;';
        const c = this.ctx(); let content = panel;
        try { content = c.substituteParams(panel); } catch { /* same as the regex engine; keep raw on failure */ }
        if (this.macros) content = this.macros.replace(content, { message_id: id, role: 'assistant' });
        this.registry.frames.set(token, this.bridge.frameApi(() => id));
        this.frames.set(iframe, token);
        const boot = `<script>(function(){var api=parent.${BRIDGE_KEY}&&parent.${BRIDGE_KEY}.frames.get(frameElement&&frameElement.dataset.ztFrame);if(!api){document.documentElement.setAttribute('data-zt-bridge','missing');return;}for(var k in api)window[k]=api[k];window.SillyTavern=parent.SillyTavern;var nf=window.fetch.bind(window);window.fetch=function(u,o){return nf(u,o).catch(function(e){var s=String(u);if((!o||!o.method||o.method==='GET')&&/\\/models$/.test(s)){var a=o&&o.headers&&o.headers.Authorization;return api.listModels(s.replace(/\\/(v1\\/)?models$/,''),a?String(a).replace(/^Bearer\\s+/,''):'').then(function(l){return new Response(JSON.stringify({data:l.map(function(x){return{id:x}})}),{status:200,headers:{'Content-Type':'application/json'}})});}throw e;});};document.documentElement.setAttribute('data-zt-bridge','native');})();<\/script>`;
        const fit = `<script>(function(){var f=frameElement;if(!f)return;var last=0;function fit(){var h=Math.ceil(Math.max(document.body?document.body.scrollHeight:0,document.documentElement.scrollHeight));if(h&&Math.abs(h-last)>1){last=h;f.style.height=h+'px';}}new ResizeObserver(fit).observe(document.documentElement);if(document.body)new ResizeObserver(fit).observe(document.body);addEventListener('load',fit);setTimeout(fit,50);setTimeout(fit,600);})();<\/script>`;
        let html = this.template.replace('$1', () => escapeText(content));
        html = html.replace(/<head>/i, m => m + boot).replace(/<\/body>/i, m => fit + m);
        iframe.srcdoc = html;
        return iframe;
    }
    release(iframe) { const t = this.frames.get(iframe); if (t) { this.registry?.frames.delete(t); this.frames.delete(iframe); } }
    latestFrame() { const all = [...document.querySelectorAll('#chat .' + STATUSBAR_CLASS)]; return all.at(-1) || null; }
    focusLatest() { const box = this.latestFrame(); if (!box) return false; box.scrollIntoView({ behavior: 'smooth', block: 'center' }); box.querySelector('button.zt-sb-history,.zt-sb-compact')?.click(); return true; }
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

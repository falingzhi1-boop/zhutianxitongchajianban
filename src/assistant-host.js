// Runs the ORIGINAL v1.1 Lilith assistant (window, memory auto-organize + 补读, independent API + model discovery,
// workbench + suggestions, continuity, private chat, story voice, ledger supervision) on SillyTavern natively.
// vendor/original/assistant-runtime.js is the byte-for-byte original; this file only supplies its private scope:
//   globalThis -> original pure modules + a Tavern-Helper-compatible API backed by the native Bridge
//   window     -> the real window, except `pagehide` which is routed to our own dispose (extension disable hook)
//   fetch      -> the real fetch, falling back to the user's own SillyTavern server when CORS blocks the API
import mountOriginalAssistant from '../vendor/original/assistant-runtime.js';
import { streamedCompletion, reportApiError } from './api-stream.js';
import { NATIVE_SCRIPT_ID, isMainApi, MAIN_API_MODEL, MAIN_API_URL, endpointOf } from './th-bridge.js';
import { classifyAssistant, readRoutes, resolveRoute, routeLabel } from './api-routes.js';

const LEGACY_DOM_ID = 'zt-memory-assistant-v1';

/** Live view of SillyTavern.getContext() shaped like Tavern Helper's in-iframe `SillyTavern` global. */
export function stContextProxy(getContext) {
    return new Proxy({}, {
        get(_, key) {
            const c = getContext() || {};
            if (key === 'getContext') return () => getContext();
            const v = c[key];
            return typeof v === 'function' ? v.bind(c) : v;
        },
        has(_, key) { return key === 'getContext' || key in (getContext() || {}); },
        ownKeys() { return Reflect.ownKeys(getContext() || {}); },
        getOwnPropertyDescriptor(_, key) { const c = getContext() || {}; return key in c ? { enumerable: true, configurable: true, value: c[key] } : undefined; },
    });
}
export function proxiedFetch(bridge) {
    const real = globalThis.fetch.bind(globalThis);
    const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
    return async function fetch(url, init = {}) {
        // 1.0 分功能 API: 私聊 / 记忆 / 工作台 can each use a preset, an own config or 酒馆主 API. The original assistant
        // still sends the request to the default connection; it is pointed at the routed one here. No route → unchanged.
        if (String(init.method || 'GET').toUpperCase() === 'POST' && /\/chat\/completions$/.test(String(url).replace(/[?#].*$/, ''))) {
            let body = null; try { body = JSON.parse(init.body || '{}'); } catch { body = null; }
            const id = body ? classifyAssistant(body.messages) : '', over = id ? resolveRoute(readRoutes(bridge), id) : null;
            if (over) {
                bridge.lastRoute = { id, via: over.via, at: Date.now() };
                if (over.main) url = MAIN_API_URL + '/chat/completions';
                else {
                    try { url = endpointOf(over.url).chat; } catch (e) { return json({ error: { message: `${routeLabel(id)}（${over.via}）：${e?.message || e}` } }, 400); }
                    const headers = { ...(init.headers || {}) }; delete headers.authorization; delete headers.Authorization;
                    if (over.key) headers.Authorization = 'Bearer ' + over.key;
                    body.model = over.model || body.model; if (over.maxTokens) body.max_tokens = over.maxTokens;
                    init = { ...init, headers, body: JSON.stringify(body) };
                }
            }
        }
        // API center "酒馆当前主API": answered locally through SillyTavern generateRaw, never sent to the network.
        if (isMainApi(url)) {
            const u = new URL(String(url)), method = String(init.method || 'GET').toUpperCase();
            if (/\/models$/.test(u.pathname)) return json({ data: [{ id: MAIN_API_MODEL }] });
            if (method === 'POST' && /\/chat\/completions$/.test(u.pathname)) {
                const body = JSON.parse(init.body || '{}');
                try { const text = await bridge.mainChat(body.messages || [], { maxTokens: body.max_tokens, signal: init.signal }); return json({ id: 'st-main', object: 'chat.completion', model: MAIN_API_MODEL, choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: text } }] }); }
                catch (e) { return json({ error: { message: '酒馆主 API：' + (e?.message || e) } }, 502); }
            }
            return json({ error: { message: '不支持的主 API 路径' } }, 404);
        }
        const text = String(url), method = String(init.method || 'GET').toUpperCase();
        let u; try { u = new URL(text, location.href); } catch { return real(url, init); }
        if (u.origin === location.origin) return real(url, init);
        const headers = init.headers || {}, auth = String(headers.Authorization || headers.authorization || ''), key = auth.replace(/^Bearer\s+/i, '');
        const extra = key ? JSON.stringify({ Authorization: 'Bearer ' + key }) : '';
        // 0.8.4: chat completions are always streamed (direct and relayed) and handed back as one JSON response —
        // keeps long 私聊/记忆 requests alive behind proxies (the 502s) without touching the original code.
        if (method === 'POST' && /\/chat\/completions$/.test(u.pathname)) {
            let body = {}; try { body = JSON.parse(init.body || '{}'); } catch { return real(url, init); }
            const direct = b => real(url, { ...init, body: JSON.stringify(b) });
            const relay = b => real('/api/backends/chat-completions/generate', { method: 'POST', signal: init.signal, headers: bridge.ctx().getRequestHeaders(), body: JSON.stringify({
                chat_completion_source: 'custom', custom_url: u.href.replace(/\/chat\/completions$/, ''), model: body.model, messages: body.messages,
                max_tokens: body.max_tokens, temperature: body.temperature ?? 1, stream: !!b.stream, custom_include_headers: extra }) });
            let r;
            try { r = await streamedCompletion(direct, body); }
            catch (error) {
                if (init?.signal?.aborted) throw error;
                try { r = await streamedCompletion(relay, body); }
                catch (e2) { if (init?.signal?.aborted) throw e2; r = json({ error: { message: '浏览器直连被拦截（CORS），经酒馆服务器转发也失败：' + (e2?.message || e2) } }, 502); }
            }
            if (!r.ok) { const j = await r.clone().json().catch(() => null); reportApiError('独立 API', `HTTP ${r.status} · ${j?.error?.message || ''}`); }
            return r;
        }
        try { return await real(url, init); }
        catch (error) {
            if (init?.signal?.aborted) throw error;
            if (method === 'GET' && /\/models$/.test(u.pathname)) {
                // Never throw here: the original connection page shows its fixed "CORS" sentence for ANY throw, which hid
                // the real reason (wrong path, bad key, relay refused). A status + JSON reaches the page as "HTTP xxx".
                try {
                    // Keep the user's base path (…/v1): stripping it made the server-side relay ask the wrong URL.
                    const list = await bridge.listModels(u.href.replace(/\/models$/, ''), key, { direct: false, signal: init.signal });
                    return json({ data: list.map(id => ({ id })) });
                } catch (e) {
                    if (init?.signal?.aborted) throw error;
                    const msg = e?.message || String(e);
                    reportApiError('拉取模型', msg);
                    return json({ error: { message: msg } }, Number(e?.status) || 502);
                }
            }
            throw error;
        }
    };
}

export const TIMEOUT_CHOICES = [60, 120, 180, 300, 600];
export function clampTimeout(v) { const n = Number(v); return TIMEOUT_CHOICES.includes(n) ? n : 180; }
/** The original's fixed "超过60秒" wording, corrected to the timeout actually in force. */
export function retimeError(e, sec) {
    if (!(e instanceof Error) || sec === 60) return e;
    const m = String(e.message || '').replace(/超过60秒/g, `超过${sec}秒`);
    if (m === e.message) return e;
    const out = Error(m); out.cause = e; return out;
}
export class AssistantHost {
    constructor({ adapter, bridge, original, settings, openTerminal }) {
        Object.assign(this, { adapter, bridge, original, settings, openTerminal });
        this.disposeOriginal = null; this.hostElement = null; this.shadow = null; this.motion = null; this.onMotion = null;
    }
    legacyRunning() { const el = document.getElementById(LEGACY_DOM_ID); return !!el && !el.dataset.ztNative; }
    start() {
        if (this.legacyRunning()) throw Error('旧版酒馆助手记忆脚本仍在运行：请先在酒馆助手里停用它，原生莉莉丝才会接管（避免双重注入与重复计费）。');
        this.importLegacyConfig();
        const b = this.bridge, a = this.adapter;
        const G = Object.create(this.original);          // original modules stay shared and untouched
        // 语音美化 is one switch: when the native voice box is off, the original story-assist painter stays off too
        // (it would otherwise still wrap 莉莉丝：“…” paragraphs into voice cards). Tone avatars keep working.
        const Voice = this.original.ZhuTianLilithVoice;
        if (Voice?.mountStory) G.ZhuTianLilithVoice = Object.create(Voice, { mountStory: { enumerable: true, value: (doc, allowed, avatars) => Voice.mountStory(doc, () => this.settings.get('voiceBox') !== false && !!allowed?.(), avatars) } });
        // Hand the original portrait stage (speak / rig / bubble / zones) to the native touch layer, unmodified.
        const Motion = this.original.ZhuTianLilithMotion;
        if (Motion?.mount) G.ZhuTianLilithMotion = Object.create(Motion, { mount: { enumerable: true, value: opts => { const m = Motion.mount(opts); this.motion = m; try { this.onMotion?.(m); } catch (e) { console.warn('[诸天] 触摸层挂载失败', e); } return m; } } });
        // 0.8.4 私聊: the original private chat closed the main window when it opened (E.collapseWorkbench → ui.close).
        // That window IS the terminal now, so tapping 私聊 inside the terminal shut the whole terminal, and on phones the
        // close side effects (history step, float re-tuck) sometimes swallowed the panel too. The chat panel already sits
        // above the window (z-index), so it simply opens on top and the terminal stays. Requests keep the original code;
        // only the "超过60秒" text follows the real timeout setting.
        const Chat = this.original.ZhuTianLilithChat;
        if (Chat?.mount) G.ZhuTianLilithChat = Object.create(Chat, { mount: { enumerable: true, value: opts => {
            const o = { ...opts, collapseWorkbench: () => {} };
            if (typeof opts?.request === 'function') o.request = async (...args) => { try { return await opts.request(...args); } catch (e) { throw retimeError(e, this.apiTimeoutSec()); } };
            const c = Chat.mount.call(Chat, o); this.companion = c; return c;
        } } });
        Object.assign(G, {
            getVariables: o => b.getVariables(o), updateVariablesWith: (f, o) => b.updateVariablesWith(f, o),
            replaceVariables: (v, o) => b.replaceVariables(v, o), insertOrAssignVariables: (v, o) => b.insertOrAssignVariables(v, o),
            getChatMessages: (r, o) => b.getChatMessages(r, o), injectPrompts: l => b.injectPrompts(l), uninjectPrompts: l => b.uninjectPrompts(l),
            // 0.9.3 规则 → 额外世界背景: read-only worldbook list + entries (TH signatures).
            getWorldbookNames: () => b.getWorldbookNames(), getWorldbook: name => b.getWorldbook(name),
            eventOn: (t, f) => b.eventOn(t, f), getScriptId: () => NATIVE_SCRIPT_ID, tavern_events: a.context().eventTypes,
            // Inside a Tavern Helper script iframe `SillyTavern` IS the context (getCurrentChatId, name1, groupId…),
            // not the top-level namespace. Resolve a fresh context on every read so chat switches are seen live.
            SillyTavern: stContextProxy(() => a.context()), TavernHelper: undefined,
        });
        try { b.prefetchWorldbooks?.(); } catch { /* list is fetched again on the first click */ }
        const pagehide = new Set(), realWindow = globalThis.window;
        const windowShim = new Proxy(realWindow, {
            get(target, key) {
                if (key === 'addEventListener') return (type, fn, opt) => type === 'pagehide' ? pagehide.add(fn) : target.addEventListener(type, fn, opt);
                if (key === 'removeEventListener') return (type, fn, opt) => type === 'pagehide' ? pagehide.delete(fn) : target.removeEventListener(type, fn, opt);
                if (key === 'parent' || key === 'top' || key === 'window' || key === 'self') return target;
                const v = Reflect.get(target, key, target); return typeof v === 'function' && !/^[A-Z]/.test(String(key)) ? v.bind(target) : v;
            },
        });
        // The original connection page calls `root.fetch(…/models)` where root is this private globalThis — not the
        // module-level `fetch`. Without this the call threw a TypeError and the page always reported "CORS" (0.8.1 fix).
        const shimFetch = proxiedFetch(b); G.fetch = shimFetch; this.shimFetch = shimFetch;   // also for diagnostics / QA
        mountOriginalAssistant({
            globalThis: G, window: windowShim, fetch: shimFetch,
            // The original aborts every independent-API request after a fixed 60 s; behind slow providers / thinking models
            // that is too short. Only that exact delay is stretched, every other timer is the platform's.
            setTimeout: (fn, ms, ...rest) => globalThis.setTimeout(fn, ms === 60000 ? this.apiTimeoutSec() * 1000 : ms, ...rest),
            getTavernVersion: async () => a.version + '（原生扩展）',
            getTavernHelperVersion: async () => '不需要 · 原生桥接（' + (a.support?.tested ? '已验收宿主' : '能力探测') + '）',
        });
        this.hostElement = document.getElementById(LEGACY_DOM_ID);
        if (!this.hostElement) throw Error('原版莉莉丝窗口未创建。');
        this.hostElement.dataset.ztNative = '1';               // lets ledger-service tell our instance from a real old TH helper
        this.shadow = this.hostElement.shadowRoot;
        this.disposeOriginal = () => { for (const fn of [...pagehide]) try { fn(); } catch (e) { console.warn(e); } pagehide.clear(); };
        a.assistantOwnsPrompt = () => !!this.hostElement?.isConnected;
        this.decorate();
        return this;
    }
    /** 独立 API 超时 (seconds) used for the original's private chat / memory / workbench requests. */
    apiTimeoutSec() { return clampTimeout(this.settings?.get?.('apiTimeout')); }
    /** Real health of the original assistant: its own status line says 未启动 when a capability check failed. */
    health() {
        const sh = this.shadow; if (!sh) return { ok: false, text: '莉莉丝窗口未创建' };
        const text = (sh.getElementById('status')?.textContent || '').trim();
        return { ok: !!sh.querySelector('.zt-stage') && !/^未启动/.test(text), text, rig: !!sh.querySelector('.zt-stage') };
    }
    /** Old saves: the v1.1 helper kept its API/UI/private-chat box in Tavern Helper script storage. Import once, read-only source. */
    importLegacyConfig() {
        if (this.settings.get('legacyImported')) return null;
        const data = this.bridge.findLegacyScriptData();
        if (data && Object.keys(data).length) {
            const mine = this.settings.scriptVariables();
            this.settings.setScriptVariables({ ...data, ...mine });
        }
        this.settings.set('legacyImported', true);
        return data;
    }
    /** 0.8.5 「请先启用当前聊天与账本核验；未写入。」 — the original 记忆 page's 「立即核验最新正文」 refuses until two switches
     *  above it are ticked AND 「保存当前聊天设置」 was pressed, and says so only in the small status line at the bottom.
     *  Users could not tell what or where that is. Now: a hint under the button; pressing it too early points at the
     *  two switches and the save button (highlight + scroll + toast); the status line gets the same plain explanation.
     *  The original code and its checks are unchanged (we only read the checkboxes and rewrite that one message). */
    guideLedgerCheck() {
        const s = this.shadow, btn = s?.getElementById('ledger-check'); if (!btn || btn.dataset.ztGuided) return;
        btn.dataset.ztGuided = '1';
        const on = s.getElementById('enabled'), led = s.getElementById('ledger-assist'), save = s.getElementById('save-chat');
        const hint = document.createElement('div'); hint.className = 'zt-ledger-hint';
        hint.style.cssText = 'font-size:12px;line-height:1.6;opacity:.8;margin:-2px 0 8px';
        hint.textContent = '核验 = 读取最新一条正文末尾的诸天数据块，与账本对照并结算奖励，不请求模型。使用前先勾选上面的「在当前聊天启用助手与记忆注入」和「莉莉丝监管账本与奖励」，再点「保存当前聊天设置」。';
        btn.after(hint);
        const GUIDE = '账本核验还没开启（什么都没有写入）：请在本页上方勾选「在当前聊天启用助手与记忆注入」和「莉莉丝监管账本与奖励」，然后点「保存当前聊天设置」，再点「立即核验最新正文」。';
        const flash = () => {
            for (const el of [on?.closest('label'), led?.closest('label'), save].filter(Boolean)) {
                el.style.outline = '2px solid var(--accent,#c59bee)'; el.style.outlineOffset = '3px'; el.style.borderRadius = '6px';
                setTimeout(() => { el.style.outline = ''; el.style.outlineOffset = ''; }, 4500);
            }
            (on?.checked ? save : on)?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
        };
        btn.addEventListener('click', ev => {
            if (on && led && on.checked && led.checked) return;          // ticked: let the original decide (it also checks "saved")
            ev.stopImmediatePropagation(); ev.preventDefault();
            flash(); try { globalThis.toastr?.warning?.(GUIDE, '诸天 · 账本核验', { timeOut: 9000 }); } catch { /* no toastr */ }
            const st = s.getElementById('status'); if (st) st.textContent = GUIDE;
        }, true);
        const st = s.getElementById('status');
        if (st) new MutationObserver(() => {
            if (!/请先启用当前聊天与账本核验/.test(st.textContent)) return;
            st.textContent = on?.checked && led?.checked ? '两个开关已勾选，但还没保存：请点本页的「保存当前聊天设置」，再点「立即核验最新正文」。（什么都没有写入）' : GUIDE;
            flash();
        }).observe(st, { childList: true, characterData: true, subtree: true });
    }
    /** Adds the native-only entries (terminal, status bar) into the original header without touching its code. */
    decorate() {
        const s = this.shadow; if (!s) return;
        const pill = s.querySelector('.version-pill'); if (pill) pill.textContent = '原生 ' + (this.adapter.version || '');
        try { this.guideLedgerCheck(); } catch (e) { console.warn('[诸天] 账本核验引导', e); }
        // 0.5.0: no separate terminal button any more — this window IS the terminal (see src/hub.js).
    }
    open() { const d = this.shadow?.querySelector('dialog'); if (d?.open) return; this.shadow?.getElementById('entry')?.click(); }
    portraitHost() { return this.shadow?.getElementById('lilith-portrait') || null; }
    stage() { return this.motion?.stages?.[0] || null; }
    dispose() { try { this.disposeOriginal?.(); } finally { this.adapter.assistantOwnsPrompt = null; this.hostElement?.remove(); this.hostElement = null; } }
}

// Runs the ORIGINAL v1.1 Lilith assistant (window, memory auto-organize + 补读, independent API + model discovery,
// workbench + suggestions, continuity, private chat, story voice, ledger supervision) on SillyTavern natively.
// vendor/original/assistant-runtime.js is the byte-for-byte original; this file only supplies its private scope:
//   globalThis -> original pure modules + a Tavern-Helper-compatible API backed by the native Bridge
//   window     -> the real window, except `pagehide` which is routed to our own dispose (extension disable hook)
//   fetch      -> the real fetch, falling back to the user's own SillyTavern server when CORS blocks the API
import mountOriginalAssistant from '../vendor/original/assistant-runtime.js';
import { NATIVE_SCRIPT_ID, isMainApi, MAIN_API_MODEL } from './th-bridge.js';

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
        try { return await real(url, init); }
        catch (error) {
            if (init?.signal?.aborted) throw error;
            const text = String(url), method = String(init.method || 'GET').toUpperCase();
            const headers = init.headers || {}, auth = String(headers.Authorization || headers.authorization || ''), key = auth.replace(/^Bearer\s+/i, '');
            const extra = key ? JSON.stringify({ Authorization: 'Bearer ' + key }) : '';
            let u; try { u = new URL(text, location.href); } catch { throw error; }
            if (u.origin === location.origin) throw error;
            if (method === 'POST' && /\/chat\/completions$/.test(u.pathname)) {
                const body = JSON.parse(init.body || '{}');
                return real('/api/backends/chat-completions/generate', { method: 'POST', signal: init.signal, headers: bridge.ctx().getRequestHeaders(), body: JSON.stringify({
                    chat_completion_source: 'custom', custom_url: u.href.replace(/\/chat\/completions$/, ''), model: body.model, messages: body.messages,
                    max_tokens: body.max_tokens, temperature: body.temperature ?? 1, stream: false, custom_include_headers: extra }) });
            }
            if (method === 'GET' && /\/models$/.test(u.pathname)) {
                const list = await bridge.listModels(u.href.replace(/\/(v1\/)?models$/, ''), key);
                return new Response(JSON.stringify({ data: list.map(id => ({ id })) }), { status: 200, headers: { 'Content-Type': 'application/json' } });
            }
            throw error;
        }
    };
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
        Object.assign(G, {
            getVariables: o => b.getVariables(o), updateVariablesWith: (f, o) => b.updateVariablesWith(f, o),
            replaceVariables: (v, o) => b.replaceVariables(v, o), insertOrAssignVariables: (v, o) => b.insertOrAssignVariables(v, o),
            getChatMessages: (r, o) => b.getChatMessages(r, o), injectPrompts: l => b.injectPrompts(l), uninjectPrompts: l => b.uninjectPrompts(l),
            eventOn: (t, f) => b.eventOn(t, f), getScriptId: () => NATIVE_SCRIPT_ID, tavern_events: a.context().eventTypes,
            // Inside a Tavern Helper script iframe `SillyTavern` IS the context (getCurrentChatId, name1, groupId…),
            // not the top-level namespace. Resolve a fresh context on every read so chat switches are seen live.
            SillyTavern: stContextProxy(() => a.context()), TavernHelper: undefined,
        });
        const pagehide = new Set(), realWindow = globalThis.window;
        const windowShim = new Proxy(realWindow, {
            get(target, key) {
                if (key === 'addEventListener') return (type, fn, opt) => type === 'pagehide' ? pagehide.add(fn) : target.addEventListener(type, fn, opt);
                if (key === 'removeEventListener') return (type, fn, opt) => type === 'pagehide' ? pagehide.delete(fn) : target.removeEventListener(type, fn, opt);
                if (key === 'parent' || key === 'top' || key === 'window' || key === 'self') return target;
                const v = Reflect.get(target, key, target); return typeof v === 'function' && !/^[A-Z]/.test(String(key)) ? v.bind(target) : v;
            },
        });
        mountOriginalAssistant({
            globalThis: G, window: windowShim, fetch: proxiedFetch(b),
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
    /** Adds the native-only entries (terminal, status bar) into the original header without touching its code. */
    decorate() {
        const s = this.shadow; if (!s) return;
        const pill = s.querySelector('.version-pill'); if (pill) pill.textContent = '原生 ' + (this.adapter.version || '');
        const head = s.querySelector('#close')?.parentElement; if (!head || s.getElementById('zt-open-terminal')) return;
        const mk = (id, label, title, fn) => { const b = document.createElement('button'); b.id = id; b.type = 'button'; b.className = 'icon-btn zt-native-btn'; b.textContent = label; b.title = title; b.setAttribute('aria-label', title); b.addEventListener('click', fn); return b; };
        head.insertBefore(mk('zt-open-terminal', '终端', '打开契约终端（账本、交易、诊断）', () => this.openTerminal?.()), s.querySelector('#close'));
        const style = document.createElement('style');
        style.textContent = '.zt-native-btn{font:600 12px/1 inherit;padding:6px 8px;border-radius:8px;border:1px solid #b38bbc55;background:#2a1d33;color:#f1e4f6;cursor:pointer;margin-right:6px}.zt-native-btn:hover{background:#3b2748}';
        s.append(style);
    }
    open() { this.shadow?.getElementById('entry')?.click(); }
    portraitHost() { return this.shadow?.getElementById('lilith-portrait') || null; }
    stage() { return this.motion?.stages?.[0] || null; }
    dispose() { try { this.disposeOriginal?.(); } finally { this.adapter.assistantOwnsPrompt = null; this.hostElement?.remove(); this.hostElement = null; } }
}

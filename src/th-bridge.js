import { assertSaveEnvironment, recordSaveFailure } from './save-environment.js';
import { preserveNative } from './native-owned.js';
import { stable } from './ledger-plan.js';
import { syncBonds } from './bonds-data.js';
import { completionText } from './model-response.js';
// Native replacement for the small Tavern Helper surface that the original 诸天 v1.1 sources call.
// Storage locations are the ones SillyTavern itself (and Tavern Helper) already use, so old saves need no conversion:
//   chat   -> chat_metadata.variables               (ST core /setvar, TH type:'chat')
//   global -> extension_settings.variables.global   (ST core /setglobalvar, TH type:'global')
//   script -> extension_settings[ID].scriptVariables (this extension; one-click import from the old TH helper script)
// Every chat write is serialized under the same Web Lock as the guarded ledger service and refuses to run
// while a previous ledger write is uncertain.
import { ID, STORAGE, LEGACY_SCRIPT_ID, LEDGER_SCHEMA, identity } from './contracts.js';
import { classifyStatus, readRoutes, resolveRoute, routeLabel } from './api-routes.js';
import { streamedCompletion, errorText } from './api-stream.js';

const clone = value => value === undefined ? undefined : structuredClone(value);
const plainObject = value => value && typeof value === 'object' && !Array.isArray(value);
const ROLE = { system: 0, user: 1, assistant: 2 };
const POSITION = { none: -1, before_prompt: 2, in_prompt: 0, in_chat: 1 };
export const NATIVE_SCRIPT_ID = 'zhutian-native-assistant';

export function parseRange(range, last) {
    if (typeof range === 'number') return [range, range];
    const text = String(range ?? `0-${last}`).replaceAll('{{lastMessageId}}', String(last)).trim();
    const m = /^(-?\d+)(?:\s*-\s*(-?\d+))?$/.exec(text);
    if (!m) throw Error('无法识别的楼层范围：' + text);
    const norm = n => (n < 0 ? last + 1 + n : n);
    const a = norm(Number(m[1])), b = m[2] === undefined ? a : norm(Number(m[2]));
    return [Math.max(0, Math.min(a, b)), Math.min(last, Math.max(a, b))];
}
export function toThMessage(m, i) {
    return {
        message_id: i, name: m.name, role: m.is_user ? 'user' : m.is_system ? 'system' : 'assistant',
        is_hidden: !!m.is_system, message: m.mes || '', data: clone(m.variables?.[m.swipe_id ?? 0] || {}),
        extra: clone(m.extra || {}), swipe_id: m.swipe_id ?? 0, swipes: Array.isArray(m.swipes) ? [...m.swipes] : [m.mes || ''],
    };
}
/** Opt-in sentinel chosen in the API center: "use SillyTavern's currently connected main API". It is an https URL on
 *  the reserved .invalid TLD, so the original validators accept it and no real request can ever leave the browser;
 *  the bridge and the assistant fetch shim answer it through SillyTavern generateRaw. Never used unless selected. */
export const MAIN_API_HOST = 'st-main.zhutian.invalid';
export const MAIN_API_URL = `https://${MAIN_API_HOST}/v1`;
export const MAIN_API_MODEL = '酒馆当前主API';
export function isMainApi(url) { try { return new URL(String(url || '').trim()).hostname === MAIN_API_HOST; } catch { return false; } }
/** 0.9.3: SillyTavern world-info entries ({uid: entry} or an array) → the Tavern Helper style list that the original
 *  规则 → 额外世界背景 page hands to normalizeBook (it reads name|comment, key|strategy.keys, content, enabled/disable,
 *  uid). Plain copies only — the ST cache object is never handed out, so nothing can write back into the book. */
export function toWorldbookEntries(entries) {
    const list = Array.isArray(entries) ? entries : plainObject(entries) ? Object.values(entries) : [];
    const str = v => (typeof v === 'string' ? v : '');
    return list.filter(plainObject)
        .map((e, i) => ({ e, i, at: Number.isFinite(Number(e.displayIndex)) ? Number(e.displayIndex) : Number.isFinite(Number(e.uid)) ? Number(e.uid) : i }))
        .sort((a, b) => a.at - b.at || a.i - b.i)
        .map(({ e, i }) => {
            const keys = (Array.isArray(e.key) ? e.key : Array.isArray(e.keys) ? e.keys : []).filter(k => typeof k === 'string');
            return { uid: e.uid ?? i, name: str(e.comment) || str(e.name), comment: str(e.comment) || str(e.name), key: [...keys], strategy: { keys: [...keys] },
                content: str(e.content), constant: !!e.constant, enabled: e.disable !== true && e.enabled !== false, disable: e.disable === true || e.enabled === false };
        });
}
/** Chat-completions endpoint normalisation shared by the status bar and the assistant. */
export function endpointOf(url) {
    const raw = String(url || '').trim().replace(/\/+$/, '');
    if (!raw) throw Error('请先填写 API 地址');
    const u = new URL(raw);
    if (u.username || u.password) throw Error('API 地址不能包含用户名或密码');
    const href = u.href.replace(/\/+$/, '');   // a bare domain parses as "https://x/" — avoid "https://x//models"
    if (/\/chat\/completions$/.test(u.pathname)) return { chat: href, base: href.replace(/\/chat\/completions$/, '') };
    return { chat: href + '/chat/completions', base: href };
}

export class Bridge {
    constructor(adapter, settings) {
        this.adapter = adapter; this.settings = settings; this.listeners = new Set(); this.stops = new Set(); this.dead = false;
        this.scriptFilters = new Set();
    }
    /** fn(next, prev) → object: last look at a script-variable write before it is stored. Returns the remover. */
    addScriptFilter(fn) { this.scriptFilters.add(fn); return () => this.scriptFilters.delete(fn); }
    ctx() { return this.adapter.context(); }
    onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
    emit(kind) { for (const fn of this.listeners) try { fn(kind); } catch (e) { console.warn('[诸天桥接]', e); } }

    // ---------- variables ----------
    getVariables({ type = 'chat', message_id } = {}) {
        const c = this.ctx();
        if (type === 'chat') return clone(plainObject(c?.chatMetadata?.variables) ? c.chatMetadata.variables : {});
        if (type === 'global') return clone(plainObject(c?.extensionSettings?.variables?.global) ? c.extensionSettings.variables.global : {});
        if (type === 'script') return clone(this.settings.scriptVariables());
        if (type === 'message') { const m = c?.chat?.[message_id ?? c.chat.length - 1]; return clone(m?.variables?.[m.swipe_id ?? 0] || {}); }
        throw Error('不支持的变量类型：' + type);
    }
    async replaceVariables(variables, options = {}) { return this.updateVariablesWith(() => clone(variables), options); }
    async insertOrAssignVariables(variables, options = {}) {
        const merge = (a, b) => { for (const [k, v] of Object.entries(b || {})) a[k] = plainObject(v) && plainObject(a[k]) ? merge(a[k], v) : clone(v); return a; };
        return this.updateVariablesWith(v => merge(v, variables), options);
    }
    async updateVariablesWith(updater, options = {}) {
        try { assertSaveEnvironment(); return await this.#updateVariablesWith(updater, options); }
        catch (error) { recordSaveFailure(error, '变量保存'); throw error; }
    }
    async #updateVariablesWith(updater, { type = 'chat', verify = false, expectedIdentity, engine = false, replaceLedger = false } = {}) {
        if (this.dead) throw Error('扩展已停用，未写入。');
        if (type === 'chat') return this.#writeChat(updater, { verify, expectedIdentity, engine, replaceLedger });
        if (type === 'global') {
            const c = this.ctx(); c.extensionSettings.variables ??= {};
            const draft = clone(plainObject(c.extensionSettings.variables.global) ? c.extensionSettings.variables.global : {});
            const next = (await updater(draft)) ?? draft;
            if (!plainObject(next)) throw Error('全局变量必须是对象，未写入。');
            const prev = c.extensionSettings.variables.global;
            c.extensionSettings.variables.global = next;
            try { await c.saveSettingsDebounced(); } catch (e) { c.extensionSettings.variables.global = prev; throw e; }
            this.emit('global'); return clone(next);
        }
        if (type === 'script') {
            const prev = this.settings.scriptVariables(), draft = clone(prev);
            let next = (await updater(draft)) ?? draft;
            if (!plainObject(next)) throw Error('脚本变量必须是对象，未写入。');
            // 0.9.0: e.g. the phone layout keeps the desktop window box out of a full-screen session's writes
            for (const f of this.scriptFilters) { try { const v = f(next, prev); if (plainObject(v)) next = v; } catch (e) { console.warn('[诸天] 脚本变量过滤', e); } }
            this.settings.setScriptVariables(next); this.emit('script'); return clone(next);
        }
        throw Error('不支持写入的变量类型：' + type);
    }
    async #writeChat(updater, { verify = false, expectedIdentity, engine = false, replaceLedger = false } = {}) {
        const expected = identity(this.ctx());
        if (expectedIdentity && expected !== expectedIdentity) throw Error('聊天已切换；未写入。');
        if (!expected) throw Error('请先打开单角色聊天；群聊暂不写入。');
        if (this.adapter.transactions?.uncertain?.has(expected)) throw Error('此前原生结算写入状态不明，已冻结此聊天的所有账本写入；请重载核对。');
        assertSaveEnvironment({ requireLocks: true });
        return navigator.locks.request('zhutian-ledger:' + expected, { signal: AbortSignal.timeout(20000) }, async () => {
            const c = this.ctx();
            if (this.adapter.transactions?.uncertain?.has(expected)) throw Error('此前写入状态未确认，已冻结交易；请重载核对。');
            if (this.dead || identity(c) !== expected) throw Error('聊天已经切换，取消写入。');
            // 1.0: a ledger written by a newer plugin (higher structure version) is read-only here
            const schema = Number(c.chatMetadata?.[STORAGE]?.ledgerSchema) || 0;
            if (schema > LEDGER_SCHEMA) throw Error(`这个聊天的账本由更新版本的插件写过（结构版本 ${schema}，本插件 ${LEDGER_SCHEMA}），为避免写坏已改为只读。请更新插件。`);
            const metadata = c.chatMetadata, chat = c.chat;
            const before = clone(plainObject(metadata.variables) ? metadata.variables : {});
            const stamp = stable(before);
            const guard = () => {
                const live = this.ctx();
                if (this.dead || identity(live) !== expected || live.chat !== chat || live.chatMetadata !== metadata) throw Error('聊天已经切换或上下文已变化，取消写入。');
                if (stable(plainObject(metadata.variables) ? metadata.variables : {}) !== stamp) throw Error('核验期间页面账本已变化，未写入；请刷新数据后重新确认，不会自动重扣。');
                if ((Number(metadata[STORAGE]?.ledgerSchema) || 0) > LEDGER_SCHEMA || this.adapter.transactions?.uncertain?.has(expected)) throw Error('结算权限已变化，未写入。');
            };
            const serialized = JSON.stringify(before), draft = clone(before);
            const target = verify ? { avatar_url: c.characters?.[c.characterId]?.avatar, file_name: c.getCurrentChatId() } : null;
            const diskVariables = async () => {
                const r = await fetch('/api/chats/get', { method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: c.getRequestHeaders(), body: JSON.stringify(target), signal: AbortSignal.timeout(15000) });
                if (!r.ok) throw Error('无法核对服务器账本 HTTP ' + r.status);
                const chat = await r.json();
                if (!Array.isArray(chat) || !chat[0]?.chat_metadata) throw Error('服务器没有返回聊天元数据');
                return chat[0].chat_metadata.variables || {};
            };
            if (verify) {
                if (this.adapter.isGenerating()) throw Error('主聊天正在生成，请结束后再操作。');
                const disk = await diskVariables();
                guard();
                if (stable(disk) !== stamp) throw Error('服务器账本与当前页面不同，请重载后重试；未写入。');
                if (identity(this.ctx()) !== expected) throw Error('聊天已切换；未写入。');
            }
            guard();
            const next = (await updater(draft)) ?? draft;
            guard();
            if (!plainObject(next)) throw Error('聊天变量必须是对象，未写入。');
            if (this.dead || identity(this.ctx()) !== expected) throw Error('聊天已经切换或插件已停用，取消写入。');
            if (verify && this.adapter.isGenerating()) throw Error('主聊天开始生成，取消写入。');
            if (engine) preserveNative(next.诸天系统, before.诸天系统);
            if (!replaceLedger) syncBonds(next.诸天系统, before.诸天系统);
            if (JSON.stringify(next) === serialized) return clone(next);
            this.#backup(c, before, next);
            c.chatMetadata.variables = next;
            try {
                await c.saveMetadata();
                if (verify && stable(await diskVariables()) !== stable(next)) throw Error('服务器读回不一致');
                if (verify && identity(this.ctx()) !== expected) throw Error('写入后聊天已切换');
            } catch (e) {
                if (verify) { this.adapter.transactions?.uncertain?.add(expected); throw Error('写入状态未确认，已冻结交易；请重载核对，不要重复提交。' + e.message); }
                throw e;
            }
            this.emit('chat'); this.adapter.notify();
            return clone(next);
        });
    }
    /** Rolling pre-write snapshots of the 诸天系统 ledger so a bad AI settlement can be undone from the terminal. */
    #backup(c, before, next) {
        try {
            if (JSON.stringify(before?.诸天系统 ?? null) === JSON.stringify(next?.诸天系统 ?? null) || before?.诸天系统 === undefined) return;
            const meta = c.chatMetadata[STORAGE] = { schema: 1, ...(c.chatMetadata[STORAGE] || {}) };
            const list = Array.isArray(meta.ledgerBackups) ? meta.ledgerBackups : [];
            const last = list.at(-1);
            if (last && Date.now() - last.at < 90_000) return; // one snapshot per burst of status-bar writes
            list.push({ at: Date.now(), balance: before.诸天系统?.系统点 ?? null, floor: c.chat.length - 1, ledger: clone(before.诸天系统) });
            meta.ledgerBackups = list.slice(-5);
        } catch (e) { console.warn('[诸天桥接] 备份失败（不影响写入）', e); }
    }
    backups() { return clone(this.ctx()?.chatMetadata?.[STORAGE]?.ledgerBackups || []); }
    /** 1.0: a forced backup of the current ledger (import / rollback / structure upgrade), not merged into a recent one. */
    async snapshot(reason = '') {
        const c = this.ctx(), z = c?.chatMetadata?.variables?.诸天系统;
        if (!c?.chatMetadata || z === undefined) return null;
        const meta = c.chatMetadata[STORAGE] = { schema: 1, ...(c.chatMetadata[STORAGE] || {}) };
        const list = Array.isArray(meta.ledgerBackups) ? meta.ledgerBackups : [];
        const at = Math.max(Date.now(), (list.at(-1)?.at || 0) + 1);
        const item = { at, balance: z?.系统点 ?? null, floor: (c.chat?.length || 0) - 1, ledger: clone(z), ...(reason ? { reason } : {}) };
        list.push(item); meta.ledgerBackups = list.slice(-5);
        await c.saveMetadata?.();
        return item;
    }
    async restoreBackup(at) {
        const expected = identity(this.ctx()), before = JSON.stringify(this.getVariables({ type: 'chat' }));
        const item = this.backups().find(x => x.at === at);
        if (!item) throw Error('备份不存在。');
        // 1.0: the state before the rollback is always backed up (it used to be skipped within 90 s of another write)
        const pre = await this.snapshot('回滚前');
        if (!expected || identity(this.ctx()) !== expected) throw Error('回滚期间聊天已切换，未写入。');
        await this.updateVariablesWith(v => { if (JSON.stringify(v) !== before) throw Error('备份后账本已变化，请重新预览回滚。'); v.诸天系统 = clone(item.ledger); return v; }, { verify: true, expectedIdentity: expected, replaceLedger: true });
        if (identity(this.ctx()) !== expected) throw Error('回滚后聊天已切换，请返回原聊天核对。');
        const c = this.ctx(); const meta = c.chatMetadata[STORAGE];
        meta.ledgerBackups = (meta.ledgerBackups || []).filter(x => x.at < at || (pre && x.at === pre.at));
        await c.saveMetadata();
    }

    // ---------- messages ----------
    getLastMessageId() { return (this.ctx()?.chat?.length ?? 0) - 1; }
    getChatMessages(range, { include_swipes = false } = {}) {
        const chat = this.ctx()?.chat || [], last = chat.length - 1;
        if (last < 0) return [];
        const [a, b] = parseRange(range, last), out = [];
        for (let i = a; i <= b; i++) { const m = toThMessage(chat[i], i); if (!include_swipes) delete m.swipes; out.push(m); }
        return out;
    }

    // ---------- prompts ----------
    injectPrompts(list) {
        const c = this.ctx();
        for (const p of list || []) {
            c.setExtensionPrompt(`${ID}/${p.id}`, String(p.content ?? ''), POSITION[p.position] ?? 1, Number(p.depth) || 0, !!p.should_scan, ROLE[p.role] ?? 0, typeof p.filter === 'function' ? p.filter : null);
        }
    }
    /** 1.0: what SillyTavern really holds for one of our prompts (it empties them all when a chat is (re)loaded). */
    livePrompt(id) { try { return String(this.ctx()?.extensionPrompts?.[`${ID}/${id}`]?.value ?? ''); } catch { return ''; } }
    uninjectPrompts(ids) { const c = this.ctx(); for (const id of ids || []) c?.setExtensionPrompt?.(`${ID}/${id}`, '', 1, 0, false, 0); }

    // ---------- worldbooks (read-only; 0.9.3) ----------
    // The original 规则 → 额外世界背景 page calls the Tavern Helper functions getWorldbookNames() (synchronous string[])
    // and getWorldbook(name) (Promise of entries). The native host never provided them, so the page always said
    // 「当前助手缺少世界书读取接口」 — on TauriTavern as well as on SillyTavern. Names come from SillyTavern's own
    // context (getWorldInfoNames, ST 1.19+), its world-info module (live list), then /api/settings/get; entries from getContext().loadWorldInfo, then the module,
    // then /api/worldinfo/get. Nothing here writes, binds or unbinds a book.
    loadWorldInfoModule() { return import('/scripts/world-info.js'); }
    prefetchWorldbooks() {
        if (this.wbLoading) return this.wbLoading;
        this.wbLoading = (async () => {
            try { this.wiModule = await this.loadWorldInfoModule(); } catch { this.wiModule = null; }
            if (Array.isArray(this.wiModule?.world_names)) { this.wbNames = [...this.wiModule.world_names]; return; }
            try {
                const r = await fetch('/api/settings/get', { method: 'POST', headers: this.ctx().getRequestHeaders(), credentials: 'same-origin', cache: 'no-store', body: '{}' });
                const j = r.ok ? await r.json() : null;
                if (Array.isArray(j?.world_names)) this.wbNames = [...j.world_names];
            } catch (e) { console.warn('[诸天桥接] 世界书列表读取失败', e); }
            if (!this.wbNames) this.wbFailed = true;
        })().finally(() => { this.wbLoading = null; });
        return this.wbLoading;
    }
    getWorldbookNames() {
        try { const viaCtx = this.ctx()?.getWorldInfoNames?.(); if (Array.isArray(viaCtx)) return viaCtx.filter(x => typeof x === 'string'); } catch { /* older context */ }
        const live = this.wiModule?.world_names;
        const list = Array.isArray(live) ? live : this.wbNames;
        if (!Array.isArray(live)) this.prefetchWorldbooks();     // keep the fallback copy fresh for the next click
        if (Array.isArray(list)) return list.filter(x => typeof x === 'string');
        if (this.wbFailed) { this.wbFailed = false; throw Error('读取不到世界书列表（宿主没有提供世界书模块或设置接口）；仍可使用内置规则'); }
        throw Error('世界书列表正在读取，请一秒后再点一次「读取书目」');
    }
    async getWorldbook(name) {
        const n = String(name ?? '').trim(); if (!n) throw Error('请先选择背景书');
        const c = this.ctx(); let data = null;
        if (typeof c?.loadWorldInfo === 'function') data = await c.loadWorldInfo(n);
        else {
            if (!this.wiModule) await this.prefetchWorldbooks();
            if (typeof this.wiModule?.loadWorldInfo === 'function') data = await this.wiModule.loadWorldInfo(n);
            else {
                const r = await fetch('/api/worldinfo/get', { method: 'POST', headers: c.getRequestHeaders(), credentials: 'same-origin', cache: 'no-store', body: JSON.stringify({ name: n }) });
                data = r.ok ? await r.json() : null;
            }
        }
        const missing = Error(`读取不到世界书「${n}」（可能已被删除或改名）`);
        if (!data || typeof data.entries !== 'object' || data.entries === null) throw missing;
        // SillyTavern answers a missing file with an empty dummy book ({entries: {}}): tell that apart from a real empty book.
        if (!Object.keys(data.entries).length) { let names = null; try { names = this.getWorldbookNames(); } catch { /* list unknown */ } if (names && !names.includes(n)) throw missing; }
        return toWorldbookEntries(data.entries);
    }

    // ---------- events ----------
    get events() { return this.ctx()?.eventTypes || {}; }
    eventOn(type, fn) {
        const c = this.ctx(); if (!type) return { stop() {} };
        c.eventSource.on(type, fn);
        const handle = { stop: () => { c.eventSource.removeListener(type, fn); this.stops.delete(handle); } };
        this.stops.add(handle); return handle;
    }

    // ---------- generation ----------
    /** OpenAI-compatible request: direct first (identical to the original), then through the user's own ST server if CORS blocks. */
    async customChat(config, messages, { signal, maxTokens = 1800, temperature, plain = false } = {}) {
        const cap0 = Number(config.maxTokens); if (Number.isInteger(cap0) && cap0 >= 64 && cap0 <= 65536) maxTokens = cap0;
        if (isMainApi(config.url || config.apiurl)) return { text: await this.mainChat(messages, { maxTokens, signal }), via: 'st-main' };
        const { chat, base } = endpointOf(config.url || config.apiurl);
        const model = String(config.model || '').trim();
        if (!model) throw Error('请先设置独立 API 的模型名称');
        const cap = Number(config.maxTokens); if (Number.isInteger(cap) && cap >= 64 && cap <= 65536) maxTokens = cap;
        const body = { model, messages, stream: false, max_tokens: maxTokens, ...(temperature === undefined ? (plain ? {} : { temperature: 0 }) : { temperature }) };
        // 0.8.4: streamed on both paths (see api-stream.js) — the non-stream relay was where the 502s came from.
        const send = b => fetch(chat, { method: 'POST', redirect: 'error', credentials: 'omit', cache: 'no-store', signal, headers: { 'Content-Type': 'application/json', ...(config.key ? { Authorization: 'Bearer ' + config.key } : {}) }, body: JSON.stringify(b) });
        const relay = b => fetch('/api/backends/chat-completions/generate', { method: 'POST', signal, headers: this.ctx().getRequestHeaders(), body: JSON.stringify({
            chat_completion_source: 'custom', custom_url: base, model, messages, stream: !!b.stream, max_tokens: maxTokens, temperature: body.temperature ?? 1,
            custom_include_headers: config.key ? JSON.stringify({ Authorization: 'Bearer ' + config.key }) : '',
        }) });
        let response, direct = true;
        try { response = await streamedCompletion(send, body); }
        catch (error) {
            if (signal?.aborted) throw Error('请求已取消或超时');
            direct = false;
            try { response = await streamedCompletion(relay, body); }
            catch (e2) { if (signal?.aborted) throw Error('请求已取消或超时'); throw Error('网络连接失败：浏览器直连被拦截，经酒馆服务器转发也失败（' + (e2?.message || e2) + '）'); }
        }
        const data = await response.json().catch(() => null);
        if (!response.ok) throw Error(`${direct ? '独立 API' : '酒馆转发'}返回 HTTP ${response.status}${data?.error?.message ? ' · ' + data.error.message : ''}`);
        if (data?.error) throw Error('接口错误：' + (data.error.message || JSON.stringify(data.error)).slice(0, 200));
        let text;
        try { text = completionText(data, maxTokens); }
        catch (e) {
            // One bounded retry, only for an empty truncated response. An explicit configured cap is never exceeded.
            if (e.code !== 'EMPTY_LENGTH' || config.maxTokens || maxTokens >= 8192) throw e;
            const next = Math.min(8192, Math.max(2048, maxTokens * 2));
            globalThis.toastr?.info?.(`未返回正文；仅重试一次，额度 ${next} tokens（服务商可能计费）`, '诸天 · 模型');
            return this.customChat({ ...config, maxTokens: next }, messages, { signal, maxTokens: next, temperature, plain });
        }
        return { text, via: direct ? 'direct' : 'st-proxy' };
    }
    /** Model ids for an OpenAI-compatible base URL. Direct first (skipped when the caller already saw the browser block
     *  it), then the user's own SillyTavern server (not subject to CORS). Errors carry a readable reason and .status. */
    async listModels(url, key, { direct = true, signal } = {}) {
        if (isMainApi(url)) return [MAIN_API_MODEL];
        const { base } = endpointOf(url); let error = null;
        const pick = d => (Array.isArray(d) ? d : Array.isArray(d?.data) ? d.data : Array.isArray(d?.data?.data) ? d.data.data : Array.isArray(d?.models) ? d.models : Array.isArray(d?.data?.models) ? d.data.models : [])
            .map(x => typeof x === 'string' ? x : x?.id || x?.name).filter(Boolean);
        const fail = (msg, status) => Object.assign(Error(msg), { status });
        const bare = !/\/v\d+[a-z]*$/i.test(base);
        if (direct) for (const u of [base + '/models', ...(bare ? [base + '/v1/models'] : [])]) {
            try {
                const r = await fetch(u, { headers: key ? { Authorization: 'Bearer ' + key } : {}, credentials: 'omit', cache: 'no-store', signal: signal || AbortSignal.timeout(8000) });
                if (!r.ok) { error = fail(`HTTP ${r.status} · ${errorText(await r.text().catch(() => ''), r.status)}`, r.status); continue; }
                const list = pick(await r.json().catch(() => null)); if (list.length) return list;
            } catch (e) { if (signal?.aborted) throw e; error = e; }
        }
        // ST appends /models to custom_url itself: try the base as written and, for a bare domain, base + /v1.
        let lastStatus = 0;
        for (const custom of [base, ...(bare ? [base + '/v1'] : [])]) {
            let r = null;
            try { r = await fetch('/api/backends/chat-completions/status', { method: 'POST', signal, headers: this.ctx().getRequestHeaders(), body: JSON.stringify({ chat_completion_source: 'custom', custom_url: custom, custom_include_headers: key ? JSON.stringify({ Authorization: 'Bearer ' + key }) : '' }) }); }
            catch (e) { if (signal?.aborted) throw e; error = fail('连不上酒馆服务器（' + (e?.message || e) + '）', 502); continue; }
            const t = await r.text().catch(() => ''); let d = null; try { d = JSON.parse(t); } catch { /* not json */ }
            if (!r.ok) {
                lastStatus = r.status;
                error = r.status === 403 ? fail('酒馆服务器拒绝了转发请求（HTTP 403，多半是登录/CSRF 失效：刷新酒馆页面后再试）', 403)
                    : fail(`经酒馆服务器转发：服务商返回 HTTP ${r.status}${r.status === 401 ? ' · Key 无效或缺失' : r.status === 404 ? ' · 地址不对（检查是否少了或多了 /v1）' : ''}`, r.status);
                continue;
            }
            const list = pick(d); if (list.length) return list;
            if (d?.error) error = fail('经酒馆服务器转发也没拿到模型列表：' + (typeof d.error === 'string' ? d.error : d.error?.message || '请检查地址和 Key'), 502);
            else error = fail('服务商返回了空的模型列表：可以直接手动填写模型名', 404);
        }
        throw error || fail('没有拉取到模型', lastStatus || 502);
    }
    /** SillyTavern's currently connected main API (generateRaw), for the API center's explicit "酒馆主API" choice and
     *  for status-bar calls without an independent API. Messages keep their roles (system prompts stay separate). */
    async mainChat(messages, { maxTokens, signal } = {}) {
        const raw = this.adapter.host?.generateRaw;
        if (typeof raw !== 'function') throw Error('当前酒馆没有 generateRaw，无法使用主 API');
        if (signal?.aborted) throw Error('请求已取消或超时');
        const list = (messages || []).filter(m => m && typeof m.content === 'string' && m.content);
        const system = list.filter(m => m.role === 'system').map(m => m.content).join('\n\n');
        const rest = list.filter(m => m.role !== 'system');
        const options = { prompt: rest.length === 1 && rest[0].role === 'user' ? rest[0].content : rest, systemPrompt: system };
        if (Number.isInteger(Number(maxTokens)) && Number(maxTokens) > 0) options.responseLength = Number(maxTokens);
        const text = await raw(options);
        if (typeof text !== 'string' || !text.trim()) throw Error('酒馆主 API 未返回文字内容');
        return text;
    }
    /** Subset of Tavern Helper generateRaw used by the 3.1 status bar (AI 进货 / 抽卡 / 许愿 / 天眼 …).
     *  The status bar passes its limits inside custom_api (max_tokens, temperature 0.7) — both are honoured. */
    async generateRaw({ user_input = '', ordered_prompts, custom_api, max_tokens, route = '' } = {}) {
        const prompts = Array.isArray(ordered_prompts) ? ordered_prompts : [{ role: 'system', content: '' }, 'user_input'];
        const messages = prompts.map(p => p === 'user_input' ? { role: 'user', content: String(user_input) } : (p && typeof p === 'object' && typeof p.content === 'string' ? { role: p.role || 'system', content: p.content } : null)).filter(m => m && m.content);
        let limit = Number(custom_api?.max_tokens) || Number(max_tokens) || 4096;
        // 1.0 分功能 API: the status bar still builds custom_api from the default connection; a feature with its own
        // route (preset / own config / 酒馆主 API) is pointed there on the way out. No route → unchanged.
        const id = route || classifyStatus(messages.find(m => m.role === 'system')?.content);
        const over = id ? resolveRoute(readRoutes(this), id) : null;
        const defaultCap = Number(this.getVariables({ type: 'global' })?.诸天系统_API?.maxTokens);
        const configuredCap = Number(over?.maxTokens) || (Number.isInteger(defaultCap) && defaultCap >= 64 && defaultCap <= 65536 ? defaultCap : 0);
        if (configuredCap) limit = configuredCap;
        if (over) {
            this.lastRoute = { id, via: over.via, at: Date.now() };
            const tag = e => Object.assign(Error(`${e?.message || e}（${routeLabel(id)} 用的是${over.via}）`), { status: e?.status });
            try {
                if (over.maxTokens) limit = over.maxTokens;
                if (over.main) return await this.mainChat(messages, { maxTokens: limit });
                custom_api = { ...(custom_api || {}), apiurl: over.url, key: over.key, model: over.model };
            } catch (e) { throw tag(e); }
            if (custom_api.apiurl && !isMainApi(custom_api.apiurl)) {
                const control = new AbortController(), timer = setTimeout(() => control.abort(), 90000);
                const temperature = Number.isFinite(Number(custom_api.temperature)) ? Number(custom_api.temperature) : undefined;
                try { return (await this.customChat({ url: custom_api.apiurl, key: custom_api.key, model: custom_api.model, ...(configuredCap ? { maxTokens: configuredCap } : {}) }, messages, { signal: control.signal, maxTokens: limit, temperature, plain: temperature === undefined })).text; }
                catch (e) { throw tag(e); } finally { clearTimeout(timer); }
            }
        }
        if (custom_api?.apiurl && !isMainApi(custom_api.apiurl)) {
            const control = new AbortController(), timer = setTimeout(() => control.abort(), 90000);
            const temperature = Number.isFinite(Number(custom_api.temperature)) ? Number(custom_api.temperature) : undefined;
            try { return (await this.customChat({ url: custom_api.apiurl, key: custom_api.key, model: custom_api.model, ...(configuredCap ? { maxTokens: configuredCap } : {}) }, messages, { signal: control.signal, maxTokens: limit, temperature, plain: temperature === undefined })).text; }
            finally { clearTimeout(timer); }
        }
        return this.mainChat(messages, { maxTokens: limit });
    }

    // ---------- Tavern Helper script storage import (old saves) ----------
    /** Finds the old v1.1 helper script's stored data inside Tavern Helper settings, read-only. */
    findLegacyScriptData() {
        const seen = new Set(), stack = [this.ctx()?.extensionSettings];
        let steps = 0;
        while (stack.length && steps++ < 20000) {
            const x = stack.pop();
            if (!x || typeof x !== 'object' || seen.has(x)) continue; seen.add(x);
            if (x.id === LEGACY_SCRIPT_ID && plainObject(x.data)) return clone(x.data);
            for (const v of Object.values(x)) if (v && typeof v === 'object') stack.push(v);
        }
        for (const ch of this.ctx()?.characters || []) {
            const stack2 = [ch?.data?.extensions]; const seen2 = new Set();
            while (stack2.length) { const x = stack2.pop(); if (!x || typeof x !== 'object' || seen2.has(x)) continue; seen2.add(x); if (x.id === LEGACY_SCRIPT_ID && plainObject(x.data)) return clone(x.data); for (const v of Object.values(x)) if (v && typeof v === 'object') stack2.push(v); }
        }
        return null;
    }

    /** API exposed to status-bar iframes. `messageId` is the floor that hosts the iframe. */
    frameApi(messageId, lastId) {
        const self = this;
        return {
            getVariables: o => self.getVariables(o),
            replaceVariables: (v, o) => self.replaceVariables(v, { ...o, engine: true }),
            updateVariablesWith: (fn, o) => self.updateVariablesWith(fn, { ...o, engine: true }),
            insertOrAssignVariables: (v, o) => self.insertOrAssignVariables(v, { ...o, engine: true }),
            getCurrentMessageId: () => messageId(),
            getLastMessageId: () => (typeof lastId === 'function' ? lastId() : self.getLastMessageId()),
            generateRaw: o => self.generateRaw(o),
            listModels: (u, k) => self.listModels(u, k),
        };
    }
    dispose() { this.dead = true; for (const s of [...this.stops]) s.stop(); this.listeners.clear(); }
}

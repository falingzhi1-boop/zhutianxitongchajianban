// Native replacement for the small Tavern Helper surface that the original 诸天 v1.1 sources call.
// Storage locations are the ones SillyTavern itself (and Tavern Helper) already use, so old saves need no conversion:
//   chat   -> chat_metadata.variables               (ST core /setvar, TH type:'chat')
//   global -> extension_settings.variables.global   (ST core /setglobalvar, TH type:'global')
//   script -> extension_settings[ID].scriptVariables (this extension; one-click import from the old TH helper script)
// Every chat write is serialized under the same Web Lock as the guarded ledger service and refuses to run
// while a previous ledger write is uncertain.
import { ID, STORAGE, LEGACY_SCRIPT_ID, identity } from './contracts.js';
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
    async updateVariablesWith(updater, { type = 'chat' } = {}) {
        if (this.dead) throw Error('扩展已停用，未写入。');
        if (type === 'chat') return this.#writeChat(updater);
        if (type === 'global') {
            const c = this.ctx(); c.extensionSettings.variables ??= {};
            const draft = clone(plainObject(c.extensionSettings.variables.global) ? c.extensionSettings.variables.global : {});
            const next = (await updater(draft)) ?? draft;
            if (!plainObject(next)) throw Error('全局变量必须是对象，未写入。');
            c.extensionSettings.variables.global = next; c.saveSettingsDebounced(); this.emit('global'); return clone(next);
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
    async #writeChat(updater) {
        const expected = identity(this.ctx());
        if (!expected) throw Error('请先打开单角色聊天；群聊暂不写入。');
        if (this.adapter.transactions?.uncertain?.has(expected)) throw Error('此前原生结算写入状态不明，已冻结此聊天的所有账本写入；请重载核对。');
        if (!navigator.locks) throw Error('浏览器缺少 Web Locks，无法安全写入账本。');
        return navigator.locks.request('zhutian-ledger:' + expected, { signal: AbortSignal.timeout(20000) }, async () => {
            const c = this.ctx();
            if (this.dead || identity(c) !== expected) throw Error('聊天已经切换，取消写入。');
            const before = plainObject(c.chatMetadata.variables) ? c.chatMetadata.variables : {};
            const serialized = JSON.stringify(before), draft = clone(before);
            const next = (await updater(draft)) ?? draft;
            if (!plainObject(next)) throw Error('聊天变量必须是对象，未写入。');
            if (identity(this.ctx()) !== expected) throw Error('聊天已经切换，取消写入。');
            if (JSON.stringify(next) === serialized) return clone(next);
            this.#backup(c, before, next);
            c.chatMetadata.variables = next;
            await c.saveMetadata();
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
    async restoreBackup(at) {
        const item = this.backups().find(x => x.at === at);
        if (!item) throw Error('备份不存在。');
        await this.updateVariablesWith(v => { v.诸天系统 = clone(item.ledger); return v; });
        const c = this.ctx(); const meta = c.chatMetadata[STORAGE];
        meta.ledgerBackups = (meta.ledgerBackups || []).filter(x => x.at < at);
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
    uninjectPrompts(ids) { const c = this.ctx(); for (const id of ids || []) c?.setExtensionPrompt?.(`${ID}/${id}`, '', 1, 0, false, 0); }

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
        const choice = data?.choices?.[0], text = choice?.message?.content ?? choice?.text;
        if (choice?.finish_reason === 'length' && !String(text || '').trim()) throw Error('模型思考占满了输出额度，没给出正文；可调大最大输出长度或换用不带思考的模型');
        if (typeof text !== 'string' || !text.trim()) throw Error('接口未返回文字内容');
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
    async generateRaw({ user_input = '', ordered_prompts, custom_api, max_tokens } = {}) {
        const prompts = Array.isArray(ordered_prompts) ? ordered_prompts : [{ role: 'system', content: '' }, 'user_input'];
        const messages = prompts.map(p => p === 'user_input' ? { role: 'user', content: String(user_input) } : (p && typeof p === 'object' && typeof p.content === 'string' ? { role: p.role || 'system', content: p.content } : null)).filter(m => m && m.content);
        const limit = Number(custom_api?.max_tokens) || Number(max_tokens) || 4096;
        if (custom_api?.apiurl && !isMainApi(custom_api.apiurl)) {
            const control = new AbortController(), timer = setTimeout(() => control.abort(), 90000);
            const temperature = Number.isFinite(Number(custom_api.temperature)) ? Number(custom_api.temperature) : undefined;
            try { return (await this.customChat({ url: custom_api.apiurl, key: custom_api.key, model: custom_api.model }, messages, { signal: control.signal, maxTokens: limit, temperature, plain: temperature === undefined })).text; }
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
            replaceVariables: (v, o) => self.replaceVariables(v, o),
            updateVariablesWith: (fn, o) => self.updateVariablesWith(fn, o),
            insertOrAssignVariables: (v, o) => self.insertOrAssignVariables(v, o),
            getCurrentMessageId: () => messageId(),
            getLastMessageId: () => (typeof lastId === 'function' ? lastId() : self.getLastMessageId()),
            generateRaw: o => self.generateRaw(o),
            listModels: (u, k) => self.listModels(u, k),
        };
    }
    dispose() { this.dead = true; for (const s of [...this.stops]) s.stop(); this.listeners.clear(); }
}

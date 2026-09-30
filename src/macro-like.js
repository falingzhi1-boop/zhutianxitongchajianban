// Native replacement for Tavern Helper's "macro-likes" (酒馆助手宏). The original 诸天 worldbook uses
// {{get_chat_variable::诸天系统.xxx}} 80 times (实时数据, 系统点, 资源行, 盲盒保底 …). SillyTavern itself does not know these
// macros, so without Tavern Helper the model used to receive the literal text instead of the ledger.
//
// Semantics are copied from Tavern Helper (src/function/macro_like.ts + src/panel/render/macro_like.ts, 4.11.x):
//   {{get_<type>_variable::path}}     lodash path (HTML-unescaped), keys starting with `$` removed,
//                                     string -> as is, anything else -> JSON.stringify (missing -> "null")
//   {{format_<type>_variable::path}}  same value as YAML, continuation lines indented to the macro column
//   types: message | chat | character | preset | global
// Replacement happens where Tavern Helper does it: on the final prompt (GENERATE_AFTER_DATA, not on dry runs) and
// when a chat message is displayed (the story renderer calls replaceMacroLike()).

export const GET_RE = /\{\{get_(message|chat|character|preset|global)_variable::(.*?)\}\}/gi;
export const FORMAT_RE = /^(.*)\{\{format_(message|chat|character|preset|global)_variable::(.*?)\}\}/gim;
const FORMAT_ONE = /^(.*)\{\{format_(message|chat|character|preset|global)_variable::(.*?)\}\}/im;
const plain = v => v && typeof v === 'object' && !Array.isArray(v);

/** lodash _.unescape */
export function unescapeHtml(s) {
    return String(s).replace(/&(?:amp|lt|gt|quot|#39);/g, m => ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" })[m]);
}
/** lodash _.toPath subset: a.b[0].c, a["b.c"], a['b'] */
export function toPath(path) {
    const out = [], s = String(path);
    const re = /[^.[\]]+|\[(?:(-?\d+(?:\.\d+)?)|(["'])((?:(?!\2)[^\\]|\\.)*?)\2)\]|(?=(?:\.|\[\])(?:\.|\[\]|$))/g;
    if (s.charCodeAt(0) === 46) out.push('');
    s.replace(re, (match, number, quote, sub) => { out.push(quote ? sub.replace(/\\(\\)?/g, '$1') : (number ?? match)); return match; });
    return out;
}
export function getPath(obj, path, fallback = null) {
    if (obj === null || obj === undefined) return fallback;
    if (Object.prototype.hasOwnProperty.call(Object(obj), path)) return obj[path];     // lodash: exact key first
    let cur = obj;
    for (const key of toPath(path)) { if (cur === null || cur === undefined) return fallback; cur = cur[key]; }
    return cur === undefined ? fallback : cur;
}
/** lodash-omitdeep omitDeepBy(value, (_, key) => key.startsWith('$')) */
export function omitDollar(value) {
    if (Array.isArray(value)) return value.map(omitDollar);
    if (plain(value)) { const o = {}; for (const [k, v] of Object.entries(value)) if (!k.startsWith('$')) o[k] = omitDollar(v); return o; }
    return value;
}

// ---------- minimal YAML (yaml.stringify with blockQuote:'literal' for the shapes ledgers contain) ----------
const YAML_PLAIN = /^[^\s\-?:,[\]{}#&*!|>'"%@`][^:#]*$/;
function yamlScalar(v) {
    if (v === null || v === undefined) return 'null';
    if (typeof v === 'number') return Number.isFinite(v) ? String(v) : (Number.isNaN(v) ? '.nan' : (v > 0 ? '.inf' : '-.inf'));
    if (typeof v === 'boolean') return String(v);
    const s = String(v);
    if (s === '') return '""';
    if (/^(?:true|false|null|~|yes|no|on|off|[-+]?\d[\d_.eE+-]*)$/i.test(s) || !YAML_PLAIN.test(s) || /\s$/.test(s)) return JSON.stringify(s);
    return s;
}
export function toYaml(value, indent = 0) {
    const pad = ' '.repeat(indent);
    if (typeof value === 'string' && value.includes('\n')) return '|' + (value.endsWith('\n') ? '' : '-') + '\n' + value.replace(/\n$/, '').split('\n').map(l => pad + '  ' + l).join('\n');
    if (Array.isArray(value)) {
        if (!value.length) return '[]';
        return value.map(v => {
            if (plain(v) || Array.isArray(v)) { const inner = toYaml(v, indent + 2); return pad + '- ' + inner.replace(/^\s+/, ''); }
            return pad + '- ' + toYaml(v, indent + 2);
        }).join('\n').replace(/^\s+/, '');
    }
    if (plain(value)) {
        const keys = Object.keys(value); if (!keys.length) return '{}';
        return keys.map((k, i) => {
            const v = value[k], key = yamlScalar(k), head = (i ? pad : '') + key + ':';
            if (plain(v) && Object.keys(v).length) return head + '\n' + pad + '  ' + toYaml(v, indent + 2);
            if (Array.isArray(v) && v.length) return head + '\n' + pad + '  ' + toYaml(v, indent + 2);
            return head + ' ' + toYaml(v, indent + 2);
        }).join('\n');
    }
    return yamlScalar(value);
}

/** Variable sources — the same storage Tavern Helper reads. */
export class MacroLike {
    constructor(getContext) { this.getContext = getContext; this.extra = []; }
    ctx() { return this.getContext() || {}; }
    variables(type, context = {}) {
        const c = this.ctx();
        const th = globalThis.TavernHelper?.getVariables;
        switch (type) {
            case 'chat': return plain(c.chatMetadata?.variables) ? c.chatMetadata.variables : {};
            case 'global': return plain(c.extensionSettings?.variables?.global) ? c.extensionSettings.variables.global : {};
            case 'message': {
                const chat = c.chat || [];
                const id = context.message_id ?? chat.findLastIndex(m => plain(m?.variables?.[m.swipe_id ?? 0]));
                const m = chat[id]; return plain(m?.variables?.[m?.swipe_id ?? 0]) ? m.variables[m.swipe_id ?? 0] : {};
            }
            case 'character': {
                const ch = c.characters?.[c.characterId];
                const v = ch?.data?.extensions?.tavern_helper?.variables ?? ch?.data?.extensions?.TavernHelper_characterScriptVariables;
                if (plain(v)) return v;
                try { if (typeof th === 'function') return th({ type: 'character' }) || {}; } catch { /* no TH */ }
                return {};
            }
            case 'preset': {
                try { if (typeof th === 'function') return th({ type: 'preset' }) || {}; } catch { /* no TH */ }
                return {};
            }
            default: return {};
        }
    }
    value(type, path, context) { return omitDollar(getPath(this.variables(type, context), unescapeHtml(path), null)); }
    getReplace(context, type, path) { const v = this.value(type, path, context); return typeof v === 'string' ? v : JSON.stringify(v); }
    formatReplace(context, prefix, type, path) {
        const m = prefix.match(FORMAT_ONE);
        if (m) prefix = this.formatReplace(context, m[1], m[2], m[3]) + prefix.slice(m[0].length);
        const v = this.value(type, path, context);
        return prefix + (typeof v === 'string' ? v : toYaml(v)).replaceAll('\n', '\n' + ' '.repeat(prefix.length));
    }
    /** Same order as Tavern Helper: get_* first, then format_*, then anything registered later. */
    replace(text, context = {}) {
        if (typeof text !== 'string' || !text.includes('{{')) return text;
        GET_RE.lastIndex = 0; text = text.replace(GET_RE, (_s, type, path) => this.getReplace(context, type.toLowerCase(), path));
        FORMAT_RE.lastIndex = 0; text = text.replace(FORMAT_RE, (_s, prefix, type, path) => this.formatReplace(context, prefix, type.toLowerCase(), path));
        for (const { regex, replace } of this.extra) { regex.lastIndex = 0; text = text.replace(regex, (s, ...args) => replace(context, s, ...args)); }
        return text;
    }
    has(text) { if (typeof text !== 'string' || !text.includes('{{')) return false; GET_RE.lastIndex = 0; FORMAT_RE.lastIndex = 0; return GET_RE.test(text) || FORMAT_RE.test(text) || this.extra.some(x => { x.regex.lastIndex = 0; return x.regex.test(text); }); }
    /** Tavern Helper API: registerMacroLike(regex, (context, substring, ...groups) => string) */
    register(regex, replace) {
        if (!(regex instanceof RegExp) || typeof replace !== 'function') throw Error('registerMacroLike(regex, replace)');
        if (!this.extra.some(x => x.regex.source === regex.source)) this.extra.push({ regex, replace });
        return { unregister: () => this.unregister(regex) };
    }
    unregister(regex) { const i = this.extra.findIndex(x => x.regex.source === regex.source); if (i >= 0) this.extra.splice(i, 1); }
    /** GENERATE_AFTER_DATA payload: chat-completion message array or a text-completion prompt string. */
    demacroPrompt(data) {
        if (!data) return 0;
        let n = 0;
        const fix = (s, role) => { const r = this.replace(s, { role }); if (r !== s) n++; return r; };
        if (typeof data.prompt === 'string') data.prompt = fix(data.prompt, 'system');
        else if (Array.isArray(data.prompt)) {
            for (const m of data.prompt) {
                if (!m || !m.content) continue;
                if (typeof m.content === 'string') m.content = fix(m.content, m.role);
                else if (Array.isArray(m.content)) for (const part of m.content) if (part?.type === 'text' && typeof part.text === 'string') part.text = fix(part.text, m.role);
            }
        }
        return n;
    }
}

/** Tavern Helper already does this (and its macro switch is on): leave the prompt to it so nothing runs twice. */
export function tavernHelperMacrosActive(c) {
    if (!globalThis.TavernHelper) return false;
    return c?.extensionSettings?.tavern_helper?.macro?.enabled !== false;
}

export class MacroLikeHost {
    constructor(adapter, settings) { this.adapter = adapter; this.settings = settings; this.engine = new MacroLike(() => adapter.context()); this.disposers = []; this.stats = { prompts: 0, replaced: 0, last: 0, yielded: 0 }; }
    start() {
        const c = this.adapter.context(), ev = c.eventTypes?.GENERATE_AFTER_DATA;
        if (!ev) { this.state = '宿主缺少 GENERATE_AFTER_DATA，助手宏仅在显示时替换'; return this; }
        const fn = (data, dryRun) => {
            if (dryRun || this.settings.get('macroLike') === false) return;
            if (tavernHelperMacrosActive(this.adapter.context())) { this.stats.yielded++; return; }
            try { const n = this.engine.demacroPrompt(data); this.stats.prompts++; this.stats.replaced += n; this.stats.last = Date.now(); }
            catch (e) { console.warn('[诸天] 助手宏替换失败（提示词保持原样）', e); }
        };
        c.eventSource.on(ev, fn); this.disposers.push(() => c.eventSource.removeListener(ev, fn));
        this.state = '运行中（提示词 + 楼层显示）';
        const api = { registerMacroLike: (r, f) => this.engine.register(r, f), unregisterMacroLike: r => this.engine.unregister(r) };
        globalThis.ZhuTianMacroLike = api;
        return this;
    }
    replace(text, context) { return this.settings.get('macroLike') === false ? text : this.engine.replace(text, context); }
    has(text) { return this.settings.get('macroLike') !== false && this.engine.has(text); }
    dispose() { this.disposers.splice(0).forEach(f => f()); if (globalThis.ZhuTianMacroLike) delete globalThis.ZhuTianMacroLike; }
}

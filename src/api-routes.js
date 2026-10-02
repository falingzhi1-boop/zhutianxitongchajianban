// 1.0 · 分功能 API 与接口预设.
// Player feedback: "不停更换公益站接口好麻烦" — one connection for everything meant re-typing URL / key / model every time
// a free relay died, and the heavy jobs (抽卡、聊天群) and the light ones (莉莉丝私聊) could not use different models.
//
//   * 预设 — a named copy of { url, key, model }. Saved only with a name (the button stays disabled until one is typed).
//   * 分功能 — every place that calls a model can follow the default connection (unchanged behaviour), use the model
//     SillyTavern is connected to, use a preset, or keep its own config.
//
// Storage: global variable 诸天系统_API路由 (extension_settings.variables.global, next to the default 诸天系统_API, which
// already holds a key). Global variables are never exported (data-io), never in the diagnostics, never in chat files.
// Routing happens where the request leaves: th-bridge.generateRaw (status bar, 聊天群, 品阶鉴定) and the assistant's
// fetch (assistant-host: 私聊 / 记忆 / 工作台). The original code is not changed — it still builds its request from the
// default connection, and the request is pointed at the routed config on the way out.

export const ROUTES_KEY = '诸天系统_API路由';
export const MAX_PRESETS = 30;
export const MAIN = '@main';
/** [id, label, who uses the default today, desc]. `base` = which default connection a feature follows. */
export const ROUTES = Object.freeze([
    { id: 'shop', label: '商城进货', base: 'status', group: '状态栏', desc: '万界商城「AI 进货」' },
    { id: 'gacha', label: '抽卡 / 盲盒', base: 'status', group: '状态栏', desc: '盲盒抽取的奖励生成' },
    { id: 'wish', label: '许愿', base: 'status', group: '状态栏', desc: '许愿池的定价与判定' },
    { id: 'recruit', label: '招募打手', base: 'status', group: '状态栏', desc: '诸天打手的招募卡' },
    { id: 'bag', label: '背包整理 / 万物熔炉', base: 'status', group: '状态栏', desc: '背包分类、简介补全与熔炼' },
    { id: 'assess', label: '战力评估', base: 'status', group: '状态栏', desc: '能力档位评估' },
    { id: 'appraise', label: '品阶鉴定', base: 'status', group: '终端', desc: '剧情里得到的功法 / 物品重新判定品阶' },
    { id: 'group', label: '诸天聊天群', base: 'status', group: '终端', desc: '群聊、私聊群员、招募令、降临、挂单' },
    { id: 'chat', label: '莉莉丝私聊', base: 'assistant', group: '莉莉丝', desc: '和莉莉丝私下聊天' },
    { id: 'memory', label: '莉莉丝自动记忆', base: 'assistant', group: '莉莉丝', desc: '每轮整理诸天记忆' },
    { id: 'workbench', label: '莉莉丝工作台', base: 'assistant', group: '莉莉丝', desc: '分析、规划、复核建议' },
]);
const IDS = new Set(ROUTES.map(r => r.id));
export const routeLabel = id => ROUTES.find(r => r.id === id)?.label || id;

/** The status bar's model calls, told apart by the system prompt each of them sends (statusbar 3.1, sysFetchAPI). */
const STATUS_PROMPTS = Object.freeze({
    '只输出规定的格式列表，不要任何废话。': 'shop',
    '你是诸天系统的奖励生成器，严格遵守格式。': 'gacha',
    '严格执行格式要求': 'wish',
    '你是诸天万界的招募官。': 'recruit',
    '你是背包整理助手，严格遵守格式。': 'bag',
    '严格只输出一行': 'bag',
    '严格执行格式要求，只输出一行': 'assess',
});
/** Which feature a status-bar request belongs to ('' = unknown / the connection test → default). Pure. */
export function classifyStatus(system) { return STATUS_PROMPTS[String(system || '').trim()] || ''; }
/** Which Lilith job an assistant request is (v1.1 assistant: memory recorder / workbench / private chat). Pure. */
export function classifyAssistant(messages) {
    const list = Array.isArray(messages) ? messages : [];
    // the original 连接 → 测试连接 sends one user line「只回复：成功」: it tests the DEFAULT connection, never a route
    if (list.length === 1 && list[0]?.role === 'user' && /^(只回复|回复两个字)：成功$/.test(String(list[0].content || '').trim())) return '';
    const sys = list.find(m => m?.role === 'system')?.content;
    const s = typeof sys === 'string' ? sys : '';
    if (s.startsWith('你是诸天系统外挂世界书的事实记录员')) return 'memory';
    if (s.startsWith('你是诸天系统的独立助手莉莉丝')) return 'workbench';
    return 'chat';
}

const str = (v, n) => String(v ?? '').trim().slice(0, n);
/** A preset / own config, cleaned (pure). Returns null when it has no address. */
export function cleanConfig(c) {
    if (!c || typeof c !== 'object') return null;
    const out = { url: str(c.url, 300), key: str(c.key, 400), model: str(c.model, 150) };
    if (!out.url) return null;
    const n = Number(c.maxTokens); if (Number.isInteger(n) && n >= 64 && n <= 65536) out.maxTokens = n;
    return out;
}
export function cleanName(name) { return String(name ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 24); }
/** The stored object, normalised (pure). Unknown routes / broken presets are dropped, never thrown. */
export function normalizeStore(raw) {
    const s = raw && typeof raw === 'object' ? raw : {};
    const presets = [], seen = new Set();
    for (const p of Array.isArray(s.presets) ? s.presets : []) {
        const name = cleanName(p?.name), c = cleanConfig(p);
        if (!name || !c || seen.has(name)) continue; seen.add(name); presets.push({ name, ...c });
        if (presets.length >= MAX_PRESETS) break;
    }
    const routes = {};
    for (const [id, v] of Object.entries(s.routes && typeof s.routes === 'object' ? s.routes : {})) {
        if (!IDS.has(id)) continue;
        if (v === MAIN) routes[id] = MAIN;
        else if (typeof v === 'string' && v.startsWith('preset:') && cleanName(v.slice(7))) routes[id] = 'preset:' + cleanName(v.slice(7));
        else if (v && typeof v === 'object') { const c = cleanConfig(v); if (c) routes[id] = c; }
    }
    return { v: 1, presets, routes };
}
/** Save (or replace) a named preset (pure). A name is required. */
export function withPreset(store, name, cfg) {
    const s = normalizeStore(store), n = cleanName(name), c = cleanConfig(cfg);
    if (!n) throw Error('请先输入预设名称，再保存。');
    if (!c) throw Error('请先填写接口地址。');
    const i = s.presets.findIndex(p => p.name === n);
    if (i < 0 && s.presets.length >= MAX_PRESETS) throw Error(`预设最多 ${MAX_PRESETS} 个，请先删除不用的。`);
    if (i >= 0) s.presets[i] = { name: n, ...c }; else s.presets.push({ name: n, ...c });
    return s;
}
/** Delete a preset; features that used it go back to the default connection (pure). */
export function withoutPreset(store, name) {
    const s = normalizeStore(store), n = cleanName(name);
    s.presets = s.presets.filter(p => p.name !== n);
    for (const [id, v] of Object.entries(s.routes)) if (v === 'preset:' + n) delete s.routes[id];
    return s;
}
/** Point one feature somewhere: '' (default) | MAIN | 'preset:<name>' | { url, key, model } (pure). */
export function withRoute(store, id, value) {
    if (!IDS.has(id)) throw Error('未知的功能：' + id);
    const s = normalizeStore(store);
    if (!value) delete s.routes[id];
    else if (value === MAIN) s.routes[id] = MAIN;
    else if (typeof value === 'string' && value.startsWith('preset:')) {
        const n = cleanName(value.slice(7)); if (!s.presets.some(p => p.name === n)) throw Error(`没有名为「${n}」的预设。`);
        s.routes[id] = 'preset:' + n;
    } else { const c = cleanConfig(value); if (!c) throw Error('请先填写接口地址。'); s.routes[id] = c; }
    return s;
}
/**
 * What a feature actually uses (pure). null → follow the default connection (unchanged behaviour).
 * { main: true } → the model SillyTavern is connected to. Otherwise { url, key, model, maxTokens?, via }.
 * A route to a deleted preset falls back to the default (and says so in `missing`).
 */
export function resolveRoute(store, id) {
    const s = normalizeStore(store), v = s.routes[id];
    if (!v) return null;
    if (v === MAIN) return { main: true, via: '酒馆当前主 API' };
    if (typeof v === 'string') {
        const n = v.slice(7), p = s.presets.find(x => x.name === n);
        if (!p) return null;
        const { name, ...c } = p; return { ...c, via: `预设「${name}」` };
    }
    return { ...v, via: '单独配置' };
}
/** Short, key-free description of where a feature goes (pure; for the table and the diagnostics). */
export function routeText(store, id) {
    const s = normalizeStore(store), v = s.routes[id];
    const host = c => { try { return new URL(c.url).host + (c.model ? ' · ' + c.model : ''); } catch { return '地址无法解析'; } };
    if (!v) return '跟随默认';
    if (v === MAIN) return '酒馆当前主 API';
    if (typeof v === 'string') { const p = s.presets.find(x => x.name === v.slice(7)); return p ? `预设「${p.name}」· ${host(p)}` : `预设「${v.slice(7)}」已删除 → 跟随默认`; }
    return '单独配置 · ' + host(v);
}

// ---------- storage (through the native Bridge, global variables) ----------
export function readRoutes(bridge) {
    try { return normalizeStore(bridge.getVariables({ type: 'global' })?.[ROUTES_KEY]); } catch { return normalizeStore(null); }
}
export async function writeRoutes(bridge, store) {
    const s = normalizeStore(store);
    await bridge.updateVariablesWith(v => { v[ROUTES_KEY] = s; return v; }, { type: 'global' });
    return s;
}

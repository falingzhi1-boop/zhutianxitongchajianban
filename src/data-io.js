import { migrateBonds } from './bonds-data.js';
// 1.0 导出 / 导入存档 + 账本结构版本号.
//
// 导出：一个 JSON 文件 = 插件设置 + 当前聊天的诸天账本（含聊天群、星图足迹等，都在账本里）+ 可选的记忆存档 / 莉莉丝私聊记录。
//       一律不含 API Key：键名像 key / token / secret / password 的字段删除，看起来像密钥的字符串删除，网址去掉 ? 之后的参数。
//       宿主相关的记录（一键接管日志、解绑记录、结算凭据）不导出——它们只对原来那台酒馆有意义。
// 导入：先校验文件，再显示“将要覆盖什么”的预览；确认后先强制备份当前账本（不受 90 秒合并限制），写入，读回核对。
//       读到比本插件新的结构版本：拒绝导入。
// 结构版本：chatMetadata[STORAGE].ledgerSchema（不放进账本本身，AI 看不到也改不到）。没有记录 = 0，打开聊天时按
//       LEDGER_MIGRATIONS 逐级升级（升级前先备份）；记录比插件新 = 这个聊天只读（th-bridge 写入前检查）。
import { VERSION, STORAGE, LEDGER_SCHEMA } from './contracts.js';
import { errorLine } from './errors.js';
import { copyText } from './diag-report.js';

export const BACKUP_FORMAT = 'zhutian-terminal-backup';
export const BACKUP_FORMAT_VERSION = 1;
/** Current ledger structure version (src/contracts.js). Raise it together with a new LEDGER_MIGRATIONS step. */
export { LEDGER_SCHEMA };
/** Ordered upgrade steps: `to` = the version after the step; `up(z)` mutates a clone of the 诸天系统 ledger. */
export const LEDGER_MIGRATIONS = Object.freeze([
    // 0 → 1 (1.0): the structure 0.1–0.9 already wrote; only repairs types the old engine relies on.
    { to: 1, note: '1.0 起记录结构版本；修正类型（背包 / 任务库 / 万界足迹）', up(z) {
        if (z.背包 !== undefined && !Array.isArray(z.背包)) z.背包 = [];
        if (z.任务库 !== undefined && (typeof z.任务库 !== 'object' || Array.isArray(z.任务库) || z.任务库 === null)) z.任务库 = {};
        if (z.万界足迹 !== undefined && !Array.isArray(z.万界足迹)) z.万界足迹 = [];
        if (z.系统点 !== undefined && !Number.isFinite(Number(z.系统点))) z.系统点 = 0;
        return z;
    } },
    { to: 2, note: '1.1 多人羁绊与来源记录（保留旧目标）', up: migrateBonds },
]);
const HOST_ONLY = new Set(['takeoverLog', 'wbUnbound', 'legacyImported', 'migrated070', 'ledgerReceipts']);
const SECRET_KEY = /^(api[_-]?key|key|apikey|token|access[_-]?token|secret|password|passwd|authorization|auth)$/i;
const SECRET_VALUE = /^(sk-|sk_|pk-|xai-|gsk_|AIza)[A-Za-z0-9_-]{8,}|^Bearer\s+\S{8,}/;
const plain = v => !!v && typeof v === 'object' && !Array.isArray(v);
const clone = v => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

/** Deep copy without anything that could be a credential (pure). */
export function stripSecrets(v, depth = 0) {
    if (depth > 40) return undefined;
    if (Array.isArray(v)) return v.map(x => stripSecrets(x, depth + 1)).filter(x => x !== undefined);
    if (plain(v)) {
        const out = {};
        for (const [k, x] of Object.entries(v)) {
            const memoryKey = k === 'key' && ['事件','承诺','关系','线索','地点','规则','任务','其他'].includes(v.kind) && ['active','resolved'].includes(v.status) && typeof v.text === 'string' && typeof v.evidence === 'string';
            if (SECRET_KEY.test(k) && !memoryKey) continue;
            const y = stripSecrets(x, depth + 1);
            if (y !== undefined) Object.defineProperty(out, k, { value: y, enumerable: true, configurable: true, writable: true });
        }
        return out;
    }
    if (typeof v === 'string') {
        if (SECRET_VALUE.test(v.trim())) return undefined;
        if (/^https?:\/\//i.test(v) && v.includes('?')) return v.slice(0, v.indexOf('?'));
        return v;
    }
    return v;
}

/** Runs the upgrade steps from `from` to LEDGER_SCHEMA on a copy (pure). */
export function migrateLedger(z, from = 0) {
    if (!plain(z)) return { ledger: z, from, to: from, steps: [] };
    if (from > LEDGER_SCHEMA) throw Error(`这个账本的结构版本是 ${from}，比本插件支持的 ${LEDGER_SCHEMA} 新。请先更新插件，在那之前只读。`);
    let out = clone(z); const steps = [];
    for (const m of LEDGER_MIGRATIONS) if (m.to > from && m.to <= LEDGER_SCHEMA) { out = m.up(out) ?? out; steps.push(m.to); }
    return { ledger: out, from, to: LEDGER_SCHEMA, steps };
}

/** The export object (pure — callers pass what they read). */
export function buildBackup({ settings = {}, variables = {}, meta = {}, chat = '', host = '', memoryNs = '', companionKey = '', include = {} } = {}) {
    const s = {};
    for (const [k, v] of Object.entries(settings || {})) if (!HOST_ONLY.has(k)) s[k] = v;
    const chatVars = {};
    if (variables?.诸天系统 !== undefined) chatVars.诸天系统 = variables.诸天系统;
    if (include.memory !== false && memoryNs && variables?.[memoryNs] !== undefined) chatVars[memoryNs] = variables[memoryNs];
    if (include.companion !== false && companionKey && variables?.[companionKey] !== undefined) chatVars[companionKey] = variables[companionKey];
    return stripSecrets({
        format: BACKUP_FORMAT, formatVersion: BACKUP_FORMAT_VERSION, plugin: VERSION, at: new Date().toISOString(), host,
        chat: { name: String(chat || ''), ledgerSchema: Number(meta?.ledgerSchema) || 0, variables: chatVars },
        settings: s,
    });
}

/** Validates a backup file's text; returns the parsed object or throws a readable error (pure). */
export function parseBackup(text) {
    let o;
    try { o = typeof text === 'string' ? JSON.parse(text) : text; } catch { throw Error('不是有效的 JSON 文件。请选择「导出存档」得到的 .json 文件。'); }
    if (!plain(o) || o.format !== BACKUP_FORMAT) throw Error('这不是诸天终端的存档文件（缺少 format 标记）。');
    if (!(Number(o.formatVersion) >= 1)) throw Error('存档文件版本无法识别。');
    if (Number(o.formatVersion) > BACKUP_FORMAT_VERSION) throw Error(`存档文件来自更新的插件（文件格式 ${o.formatVersion}），请先更新插件再导入。`);
    const schema = Number(o.chat?.ledgerSchema) || 0;
    if (schema > LEDGER_SCHEMA) throw Error(`存档里账本的结构版本是 ${schema}，比本插件支持的 ${LEDGER_SCHEMA} 新，请先更新插件再导入。`);
    if (o.chat?.variables !== undefined && !plain(o.chat.variables)) throw Error('存档里的聊天数据格式不对。');
    if (o.settings !== undefined && !plain(o.settings)) throw Error('存档里的设置格式不对。');
    const z = o.chat?.variables?.诸天系统;
    if (z !== undefined && !plain(z)) throw Error('存档里的诸天账本格式不对。');
    return o;
}

const n = v => (Number.isFinite(Number(v)) ? Number(v) : null);
const fmt = v => (v === null || v === undefined ? '—' : typeof v === 'number' ? v.toLocaleString('zh-CN') : String(v));
/** What an import would change, as readable rows [label, now, after] (pure). */
export function backupPreview(cur = {}, file) {
    const a = cur.variables?.诸天系统 || null, b = file.chat?.variables?.诸天系统 || null, rows = [];
    const take = (label, f) => { const x = a ? f(a) : null, y = b ? f(b) : null; rows.push([label, fmt(x), fmt(y)]); };
    take('系统点', z => n(z.系统点));
    take('当前世界', z => z.当前世界 || null);
    take('背包物品', z => (Array.isArray(z.背包) ? z.背包.length : null));
    take('任务', z => (plain(z.任务库) ? Object.keys(z.任务库).length : null));
    take('聊天群成员', z => (Array.isArray(z.聊天群?.成员) ? z.聊天群.成员.length : null));
    take('万界足迹', z => (Array.isArray(z.万界足迹) ? z.万界足迹.length : null));
    const extra = Object.keys(file.chat?.variables || {}).filter(k => k !== '诸天系统');
    const changed = Object.keys(file.settings || {}).filter(k => JSON.stringify(file.settings[k]) !== JSON.stringify(cur.settings?.[k]));
    return { rows, hasLedger: !!b, extra, settingsChanged: changed.length, from: { plugin: file.plugin, at: file.at, chat: file.chat?.name || '' } };
}

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export class DataIO {
    constructor(app) { this.app = app; this.disposers = []; this.schemaState = null; }
    start() {
        const c = this.ctx(), ev = c?.eventTypes, run = () => { clearTimeout(this.t); this.t = setTimeout(() => this.checkSchema().then(r => { this.schemaState = r; if (r.state === 'newer') globalThis.toastr?.warning(`这个聊天的账本由更新版本的插件写过（结构版本 ${r.from}），本插件只读，不会写入。请更新插件。`, '诸天'); }).catch(e => { this.schemaState = { state: 'error', error: e.message }; console.warn('[诸天] 账本结构检查', e); }), 1200); };
        if (ev?.CHAT_CHANGED) { c.eventSource.on(ev.CHAT_CHANGED, run); this.disposers.push(() => c.eventSource.removeListener(ev.CHAT_CHANGED, run)); }
        run();
        return this;
    }
    dispose() { clearTimeout(this.t); this.disposers.splice(0).forEach(f => { try { f(); } catch { /* ignore */ } }); }
    get bridge() { return this.app.bridge; }
    ctx() { return this.app.adapter.context(); }
    memoryNs() { return this.app.original?.ZhuTianMemoryCore?.NS || ''; }
    companionKey() { const ns = this.memoryNs() || '诸天记忆助手_v1'; return ns + '_LILITH_CHAT'; }
    meta() { return this.ctx()?.chatMetadata?.[STORAGE] || {}; }
    current() {
        return { variables: this.bridge.getVariables({ type: 'chat' }) || {}, settings: clone(this.app.settings.all) };
    }
    /** The export object for the open chat. */
    snapshotFile(include = {}) {
        const c = this.ctx(), cur = this.current();
        const settings = clone(cur.settings); settings.scriptVariables = stripSecrets(settings.scriptVariables || {});
        return buildBackup({ settings, variables: cur.variables, meta: this.meta(), chat: c?.getCurrentChatId?.() || '', host: `SillyTavern ${c?.version?.pkgVersion || ''}`.trim(), memoryNs: this.memoryNs(), companionKey: this.companionKey(), include });
    }
    fileName() { const d = new Date().toLocaleString('sv-SE').replace(/[-: ]/g, '').slice(0, 12); return `诸天存档-${d}.json`; }
    /** Download (or, when the browser refuses, hand back the text to copy). */
    export(include = {}) {
        const file = this.snapshotFile(include), text = JSON.stringify(file, null, 1);
        try {
            const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
            const a = document.createElement('a'); a.href = url; a.download = this.fileName(); document.body.append(a); a.click(); a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 4000);
        } catch (e) { console.warn('[诸天] 导出下载失败，改为显示文本', e); }
        return { file, text };
    }
    /** Import after preview: forced backup → write ledger (+ memory) → settings → read back. */
    async import(file, options = {}) {
        if (this.importing) throw Error('存档正在导入，请勿重复提交。');
        this.importing = true;
        try { return await this.importOnce(file, options); } finally { this.importing = false; }
    }
    async importOnce(file, { ledger = true, settings = true } = {}) {
        file = parseBackup(file);
        const expected = this.app.adapter.currentIdentity(), before = JSON.stringify(this.bridge.getVariables({ type: 'chat' }));
        const vars = file.chat?.variables || {}, out = { ledger: false, settings: 0, extra: [] };
        if (ledger && Object.keys(vars).length) {
            if (!this.ctx()?.chatMetadata) throw Error('请先打开要导入到的聊天。');
            await this.bridge.snapshot?.('导入前');
            if (!expected || this.app.adapter.currentIdentity() !== expected) throw Error('导入期间聊天已切换，未写入。');
            const mig = vars.诸天系统 ? migrateLedger(vars.诸天系统, Number(file.chat?.ledgerSchema) || 0) : null;
            const want = { ...vars, ...(mig ? { 诸天系统: mig.ledger } : {}) };
            await this.bridge.updateVariablesWith(v => { if (JSON.stringify(v) !== before) throw Error('备份后账本已变化，请重新预览导入。'); for (const [k, x] of Object.entries(want)) v[k] = clone(x); return v; }, { type: 'chat', verify: true, expectedIdentity: expected, replaceLedger: true });
            if (this.app.adapter.currentIdentity() !== expected) throw Error('导入后聊天已切换，请核对原聊天。');
            const back = this.bridge.getVariables({ type: 'chat' }) || {};
            for (const [k, x] of Object.entries(want)) if (JSON.stringify(back[k]) !== JSON.stringify(x)) throw Error(`导入后读回不一致（${k}）。当前账本已在导入前备份，可以在「账本回滚」里恢复。`);
            await this.setSchema(LEDGER_SCHEMA, expected);
            out.ledger = !!vars.诸天系统; out.extra = Object.keys(vars).filter(k => k !== '诸天系统');
        }
        if (settings && plain(file.settings)) {
            const keep = this.app.settings.all.scriptVariables || {};
            for (const [k, v] of Object.entries(file.settings)) {
                if (HOST_ONLY.has(k) || k === 'schema') continue;
                // never wipe stored API configs with the key-less copies from the file
                if (k === 'scriptVariables') { this.app.settings.set(k, mergeKeepingSecrets(keep, v)); out.settings++; continue; }
                if (JSON.stringify(this.app.settings.get(k)) !== JSON.stringify(v)) { this.app.settings.set(k, clone(v)); out.settings++; }
            }
        }
        this.app.adapter.notify?.();
        return out;
    }
    async setSchema(v, expected = this.app.adapter.currentIdentity()) {
        if (!expected || this.app.adapter.currentIdentity() !== expected) throw Error('聊天已切换，未标记结构版本。');
        const c = this.ctx(); if (!c?.chatMetadata) return;
        const meta = c.chatMetadata[STORAGE] = { schema: 1, ...(c.chatMetadata[STORAGE] || {}) };
        if (meta.ledgerSchema === v) return;
        const target = { avatar_url: c.characters?.[c.characterId]?.avatar, file_name: c.getCurrentChatId() };
        meta.ledgerSchema = v;
        try {
            await c.saveMetadata?.();
            const r = await fetch('/api/chats/get', { method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: c.getRequestHeaders(), body: JSON.stringify(target), signal: AbortSignal.timeout(15000) });
            if (!r.ok || Number((await r.json())?.[0]?.chat_metadata?.[STORAGE]?.ledgerSchema) !== v || this.app.adapter.currentIdentity() !== expected) throw Error('结构版本读回不一致或聊天已切换');
        } catch (e) { this.app.adapter.transactions?.uncertain?.add(expected); throw Error('结构版本保存未确认，已冻结写入，请重载核对。' + e.message); }
    }
    /** On chat open: upgrade an old ledger (backup first); a newer one makes the chat read-only (th-bridge checks). */
    async checkSchema() {
        const c = this.ctx(), expected = this.app.adapter.currentIdentity(), z = this.bridge.getVariables({ type: 'chat' })?.诸天系统;
        if (!c?.chatMetadata || !plain(z)) return { state: 'none' };
        const from = Number(this.meta().ledgerSchema) || 0;
        if (from > LEDGER_SCHEMA) return { state: 'newer', from };
        if (from === LEDGER_SCHEMA) return { state: 'current', from };
        const mig = migrateLedger(z, from);
        if (JSON.stringify(mig.ledger) !== JSON.stringify(z)) {
            await this.bridge.snapshot?.(`结构升级 ${from}→${LEDGER_SCHEMA} 前`);
            await this.bridge.updateVariablesWith(v => { v.诸天系统 = migrateLedger(v.诸天系统, from).ledger; return v; }, { type: 'chat', verify: true, expectedIdentity: expected, replaceLedger: true });
        }
        if (this.app.adapter.currentIdentity() !== expected) throw Error('迁移期间聊天已切换，未标记结构版本。');
        await this.setSchema(LEDGER_SCHEMA, expected);
        return { state: 'upgraded', from, to: LEDGER_SCHEMA, steps: mig.steps };
    }
    popup(html) { return this.app.features.popup(html, true); }
    open() {
        const el = this.popup(`<h3>导出 / 导入存档</h3>
<p>存档是一个 .json 文件，包含插件设置和<b>当前聊天</b>的诸天账本（聊天群、星图足迹都在账本里）。<b>不含 API Key</b>，换设备后需要重新填写接口。</p>
<h4>导出</h4>
<label class="checkbox_label"><input type="checkbox" data-io="memory" checked> 包含记忆存档（剧情记忆）</label>
<label class="checkbox_label"><input type="checkbox" data-io="companion" checked> 包含莉莉丝私聊记录</label>
<div class="zt-popup-actions"><div class="menu_button" data-io="export">导出存档文件</div><div class="menu_button" data-io="copy">复制存档文本</div></div>
<h4>导入到当前聊天</h4>
<p>导入前会先自动备份当前账本（在「旧存档迁移 / 账本回滚」里可以恢复）。</p>
<input type="file" accept=".json,application/json" data-io="file" style="display:none">
<div class="zt-popup-actions"><div class="menu_button" data-io="pick">选择存档文件…</div><div class="menu_button" data-io="paste">粘贴存档文本…</div></div>
<textarea class="text_pole" data-io="text" placeholder="把存档文本粘贴到这里" style="display:none;width:100%;height:120px;font:12px/1.4 monospace"></textarea>
<div data-io="preview"></div><p class="zt-out"></p>`);
        const $ = s => el.querySelector(`[data-io="${s}"]`), out = el.querySelector('.zt-out');
        let pending = null, pendingIdentity = '';
        const include = () => ({ memory: $('memory').checked, companion: $('companion').checked });
        const show = text => {
            try {
                pending = parseBackup(text); pendingIdentity = this.app.adapter.currentIdentity();
                const p = backupPreview(this.current(), pending);
                $('preview').innerHTML = `<h4>将要导入</h4><p>来自插件 ${esc(p.from.plugin)} · ${esc(new Date(p.from.at).toLocaleString())}${p.from.chat ? ' · 聊天「' + esc(p.from.chat) + '」' : ''}</p>
<table class="zt-table"><tr><th></th><th>现在</th><th>导入后</th></tr>${p.rows.map(r => `<tr><td>${esc(r[0])}</td><td>${esc(r[1])}</td><td>${esc(r[2])}</td></tr>`).join('')}</table>
<p>${p.hasLedger ? '' : '存档里没有诸天账本。'}${p.extra.length ? '同时写入：' + esc(p.extra.join('、')) + '。' : ''}设置变化 ${p.settingsChanged} 项（API Key 不会被清空）。</p>
<label class="checkbox_label"><input type="checkbox" data-io="ledger" checked> 写入账本和记忆</label><label class="checkbox_label"><input type="checkbox" data-io="settings" checked> 导入设置</label>
<div class="zt-popup-actions"><div class="menu_button" data-io="apply">确认导入</div></div>`;
                out.textContent = '';
            } catch (e) { pending = null; $('preview').innerHTML = ''; out.textContent = '无法导入：' + e.message; }
        };
        el.addEventListener('change', async e => {
            if (e.target === $('file') && e.target.files?.[0]) show(await e.target.files[0].text());
        });
        el.addEventListener('input', e => { if (e.target === $('text') && e.target.value.trim()) show(e.target.value); });
        el.addEventListener('click', async e => {
            const act = e.target.closest('[data-io]')?.dataset.io;
            try {
                if (act === 'export') { const r = this.export(include()); out.textContent = `已导出：${this.fileName()}（${Math.ceil(r.text.length / 1024)} KB，不含 API Key）。手机上如果没有弹出下载，请用「复制存档文本」。`; }
                else if (act === 'copy') { const t = JSON.stringify(this.snapshotFile(include()), null, 1); const ok = await copyText(t); out.textContent = ok ? '已复制存档文本（不含 API Key）。' : '浏览器不允许自动复制。'; if (!ok) { $('text').style.display = ''; $('text').value = t; $('text').select(); } }
                else if (act === 'pick') $('file').click();
                else if (act === 'paste') { $('text').style.display = ''; $('text').value = ''; $('text').focus(); }
                else if (act === 'apply' && pending) {
                    if (this.app.adapter.currentIdentity() !== pendingIdentity) throw Error('聊天已切换，请重新预览存档后再导入。');
                    if (!globalThis.confirm('用这个存档覆盖当前聊天的账本和设置？当前账本会先自动备份。')) return;
                    const r = await this.import(pending, { ledger: $('ledger')?.checked !== false, settings: $('settings')?.checked !== false });
                    out.textContent = `已导入：${r.ledger ? '账本已写入并读回一致' : '没有写入账本'}${r.extra.length ? '，' + r.extra.join('、') : ''}；设置 ${r.settings} 项。`;
                    $('preview').innerHTML = ''; pending = null; this.app.hub?.reloadEngine?.();
                }
            } catch (err) { out.textContent = '未完成：' + errorLine(err); }
        });
        return el;
    }
}

/** Imported scriptVariables never remove a stored secret: keys absent from the file keep their local value (pure). */
export function mergeKeepingSecrets(local, incoming) {
    if (!plain(incoming)) return clone(local);
    const out = clone(incoming);
    const walk = (o, l) => { if (!plain(o) || !plain(l)) return; for (const [k, v] of Object.entries(l)) { if (!(k in o)) { if (SECRET_KEY.test(k) || (typeof v === 'string' && SECRET_VALUE.test(v.trim()))) o[k] = clone(v); } else walk(o[k], v); } };
    walk(out, local || {});
    return out;
}

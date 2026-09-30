// Native-only features around the migrated originals: worldbook install/bind, new-chat init, old-save migration &
// ledger rollback, compatibility diagnostics, ledger HUD, hotkeys, slash commands and macros.
import { ID, VERSION, STORAGE, inert } from './contracts.js';
import { HOST_TESTED } from './compat.js';

export const WORLD_NAME = '诸天万界最强系统';
const esc = s => String(s ?? '').replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);

export function buildWorldbook(rules) {
    const entries = {};
    rules.forEach((rule, i) => { entries[i] = { ...structuredClone(rule), uid: i, displayIndex: rule.displayIndex ?? i }; });
    return { entries };
}
export function ledgerSummary(v) {
    const s = v?.诸天系统; if (!s || typeof s !== 'object') return null;
    const tasks = s.任务库 && typeof s.任务库 === 'object' ? Object.values(s.任务库).filter(t => t && t.状态 !== '已完成' && t.状态 !== '已失败') : [];
    return { points: s.系统点 ?? 0, world: s.当前世界 || '', tasks: tasks.length, task: tasks[0]?.名称 || '', currency: s.当前货币 || '', amount: s.持有金额 ?? '' };
}

export class Features {
    constructor(app) { this.app = app; this.disposers = []; this.hud = null; this.dead = false; }
    get ctx() { return this.app.adapter.context(); }
    popup(html, wide = false) {
        const c = this.ctx, el = document.createElement('div'); el.className = 'zt-popup'; el.innerHTML = html;
        c.callGenericPopup(el, c.POPUP_TYPE.TEXT, '', { wide, large: wide, allowVerticalScrolling: true, okButton: '关闭' });
        return el;
    }
    toast(kind, text) { globalThis.toastr?.[kind]?.(text, '诸天'); }

    // ---------- worldbook ----------
    async worldbookStatus() {
        const c = this.ctx; let book = null;
        try { book = await c.loadWorldInfo(WORLD_NAME); } catch { book = null; }
        const count = book?.entries ? Object.keys(book.entries).length : 0;
        return { exists: !!count, count, chatBound: c.chatMetadata?.world_info === WORLD_NAME, builtin: this.app.original.ZhuTianBuiltinRules.length };
    }
    async installWorldbook(bind) {
        const c = this.ctx, st = await this.worldbookStatus();
        if (!st.exists) {
            await c.saveWorldInfo(WORLD_NAME, buildWorldbook(this.app.original.ZhuTianBuiltinRules), true);
            await c.updateWorldInfoList?.();
        }
        if (bind === 'chat') {
            if (!this.app.adapter.currentIdentity()) throw Error('请先打开单角色聊天再绑定。');
            c.chatMetadata.world_info = WORLD_NAME; await c.saveMetadata();
        }
        return this.worldbookStatus();
    }
    async openWorldbook() {
        const st = await this.worldbookStatus();
        const el = this.popup(`<h3>诸天世界书（外挂，不依赖角色卡 MVU）</h3>
<p>内置规则 ${st.builtin} 条。当前酒馆：${st.exists ? `已存在“${esc(WORLD_NAME)}”（${st.count} 条，不会覆盖）` : '尚未安装'}；当前聊天${st.chatBound ? '<b>已绑定</b>' : '未绑定'}。</p>
<div class="zt-popup-actions"><div class="menu_button" data-wb="install">仅安装世界书</div><div class="menu_button" data-wb="chat">安装并绑定到当前聊天</div></div>
<p class="zt-note">绑定为“聊天世界书”（chat_metadata.world_info），只影响当前聊天，与其他角色卡隔离。已存在同名世界书时只绑定，不覆盖你改过的条目。</p><p class="zt-out"></p>`);
        el.addEventListener('click', async e => {
            const act = e.target.closest('[data-wb]')?.dataset.wb; if (!act) return;
            try { const r = await this.installWorldbook(act === 'chat' ? 'chat' : 'none'); el.querySelector('.zt-out').textContent = `完成：世界书 ${r.count} 条；当前聊天${r.chatBound ? '已绑定' : '未绑定'}。`; this.toast('success', '世界书已就绪'); }
            catch (err) { el.querySelector('.zt-out').textContent = '未完成：' + err.message; }
        });
    }

    // ---------- new chat init / migration / rollback ----------
    async initChat() {
        const a = this.app.adapter;
        if (!a.currentIdentity()) throw Error('请先打开单角色聊天。');
        const before = a.ledger();
        const ledger = await this.app.statusbar.initializeChat();
        return { created: !before, points: ledger?.系统点 ?? null };
    }
    migrationReport() {
        const a = this.app.adapter, c = this.ctx, v = a.variables(), core = this.app.original.ZhuTianMemoryCore;
        const legacyData = this.app.bridge.findLegacyScriptData();
        return {
            ledger: !!v.诸天系统, memory: !!v[core.NS], companion: !!v['诸天记忆助手_v1_LILITH_CHAT'],
            legacyScript: legacyData ? Object.keys(legacyData) : [], imported: !!this.app.settings.get('legacyImported'),
            receipts: Object.keys(a.settings().ledgerReceipts || {}).length, backups: this.app.bridge.backups(),
            thActive: !!globalThis.TavernHelper, chat: c.getCurrentChatId?.() || '',
        };
    }
    openMigration() {
        const r = this.migrationReport();
        const rows = r.backups.map(b => `<tr><td>${new Date(b.at).toLocaleString()}</td><td>楼 ${b.floor}</td><td>${esc(b.balance)}</td><td><div class="menu_button" data-restore="${b.at}">回滚到此</div></td></tr>`).reverse().join('') || '<tr><td colspan="4">暂无自动备份（账本首次被原生状态栏改动时自动生成，最多 5 份）。</td></tr>';
        const el = this.popup(`<h3>旧存档迁移与账本回滚</h3>
<p>旧存档由酒馆助手写入的聊天变量（chat_metadata.variables）与本扩展使用<b>同一位置</b>，账本、记忆、私聊记录无需转换即可直接读取。</p>
<ul><li>诸天账本：${r.ledger ? '已检测到' : '无（可用“新聊天初始化”创建）'}</li><li>原版记忆存档：${r.memory ? '已检测到' : '无'}</li><li>莉莉丝私聊记录：${r.companion ? '已检测到' : '无'}</li>
<li>旧助手脚本配置（API/界面/私聊框）：${r.legacyScript.length ? '找到 ' + esc(r.legacyScript.join('、')) : '未找到'}${r.imported ? '（已导入过）' : ''}</li><li>原生结算凭据：${r.receipts} 条</li><li>酒馆助手：${r.thActive ? '仍在运行（建议停用旧状态栏正则与旧助手脚本）' : '未运行'}</li></ul>
<div class="zt-popup-actions"><div class="menu_button" data-mig="import">重新导入旧助手配置</div></div>
<h4>账本自动备份</h4><table class="zt-table"><tr><th>时间</th><th>楼层</th><th>系统点</th><th></th></tr>${rows}</table><p class="zt-out"></p>`, true);
        el.addEventListener('click', async e => {
            const out = el.querySelector('.zt-out');
            try {
                if (e.target.closest('[data-mig="import"]')) { this.app.settings.set('legacyImported', false); const d = this.app.assistant?.importLegacyConfig(); out.textContent = d ? '已导入：' + Object.keys(d).join('、') + '；刷新页面后莉莉丝窗口使用新配置。' : '没有找到旧配置。'; }
                const at = e.target.closest('[data-restore]')?.dataset.restore;
                if (at && confirm('把诸天账本回滚到这份备份？当前账本会被替换（回滚前的状态也会先自动备份）。')) { await this.app.bridge.restoreBackup(Number(at)); out.textContent = '已回滚并保存。'; this.app.statusbar?.rebuild(); }
            } catch (err) { out.textContent = '未完成：' + err.message; }
        });
    }
    openDiagnostics() {
        const a = this.app.adapter, caps = a.capabilities || [], sb = this.app.statusbar?.state || {};
        this.popup(`<h3>兼容诊断 · ${VERSION}</h3>
<p>SillyTavern <b>${esc(a.version)}</b>：${esc(a.support?.reason)}</p><p>已验收版本：${HOST_TESTED.join(' / ')}（每个版本均在隔离真实宿主上跑过浏览器验收）。</p>
<table class="zt-table"><tr><th>接口</th><th>状态</th></tr>${caps.map(x => `<tr><td>${esc(x.label)}</td><td>${x.ok ? '✅' : '❌ 相关功能自动停用'}</td></tr>`).join('')}</table>
<p>原生状态栏：${esc(sb.mode)} — ${esc(sb.reason)}</p><p>莉莉丝助手：${(h => h ? (h.ok ? '运行中（原版代码 + 原生桥接）' : '⚠ 窗口已创建但原版未完全启动：' + esc(h.text)) : esc(this.app.assistantError || '未启动'))(this.app.assistant?.health?.())}</p>
<p>立绘：${esc(this.app.portrait?.describe?.() || '原版分层参数动画')}</p>`, true);
    }

    // ---------- HUD ----------
    mountHud() {
        const form = document.getElementById('send_form'); if (!form || this.hud) return;
        const hud = document.createElement('div'); hud.id = ID + '-hud'; hud.className = 'zt-hud'; hud.setAttribute('role', 'button'); hud.tabIndex = 0;
        hud.title = '诸天账本速览 · 点击跳到最新状态栏';
        form.parentElement.insertBefore(hud, form); this.hud = hud;
        const go = () => { if (!this.app.statusbar?.focusLatest()) this.app.assistant?.open(); };
        hud.addEventListener('click', go); hud.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
        this.refreshHud();
    }
    refreshHud() {
        if (!this.hud) return;
        const on = this.app.settings.get('hud'), s = ledgerSummary(this.app.adapter.variables());
        this.hud.hidden = !on || !s || !this.app.adapter.currentIdentity();
        if (s) this.hud.innerHTML = `<span class="zt-hud-mark">诸天</span><span>系统点 <b>${esc(s.points)}</b></span>${s.world ? `<span>${esc(s.world)}</span>` : ''}${s.currency ? `<span>${esc(s.currency)} ${esc(s.amount)}</span>` : ''}<span>任务 ${s.tasks}${s.task ? ' · ' + esc(s.task) : ''}</span>`;
    }

    // ---------- hotkeys / slash / macros ----------
    mountHotkeys() {
        const fn = e => {
            if (!this.app.settings.get('hotkeys') || !e.altKey || e.ctrlKey || e.metaKey) return;
            const k = e.key.toLowerCase();
            if (k === 'z') { e.preventDefault(); this.app.assistant?.open(); }
            else if (k === 'x') { e.preventDefault(); this.app.openTerminal(); }
            else if (k === 's') { e.preventDefault(); this.app.statusbar?.focusLatest(); }
        };
        document.addEventListener('keydown', fn); this.disposers.push(() => document.removeEventListener('keydown', fn));
    }
    registerCommands() {
        const c = this.ctx;
        if (typeof c.registerSlashCommand === 'function' && !globalThis.__zhutianSlash) {
            globalThis.__zhutianSlash = true;   // the host has no unregister for legacy commands; callbacks resolve the live app
            c.registerSlashCommand('zt', (_args, value) => {
                const app = globalThis.__zhutianApp; if (!app) return '诸天扩展未运行';
                const [cmd, ...rest] = String(value || 'open').trim().split(/\s+/);
                const f = app.features;
                switch (cmd) {
                    case 'open': app.assistant?.open(); return '';
                    case 'terminal': app.openTerminal(); return '';
                    case 'status': return app.statusbar?.focusLatest() ? '' : '当前聊天没有状态栏';
                    case 'init': f.initChat().then(r => f.toast('success', r.created ? '已初始化诸天账本' : '账本已存在，已补齐缺失字段')).catch(e => f.toast('error', e.message)); return '';
                    case 'world': f.openWorldbook(); return '';
                    case 'backup': f.openMigration(); return '';
                    case 'diag': f.openDiagnostics(); return '';
                    case 'points': return String(ledgerSummary(app.adapter.variables())?.points ?? '');
                    case 'live2d': app.portrait?.setMode(rest[0] === 'off' ? 'rig' : 'live2d'); return '';
                    default: return '用法：/zt open|terminal|status|init|world|backup|diag|points|live2d [off]';
                }
            }, ['zhutian'], '<span class="monospace">/zt open|terminal|status|init|world|backup|diag|points|live2d</span> – 诸天 · 莉莉丝契约终端', true, true);
        }
        if (!globalThis.__zhutianMacros && (typeof c.macros?.register === 'function' || typeof c.registerMacro === 'function')) {
            globalThis.__zhutianMacros = true;
            const read = f => () => { try { const s = ledgerSummary(globalThis.__zhutianApp?.adapter.variables()); return s ? inert(String(f(s))) : ''; } catch { return ''; } };
            const defs = [['zt_points', s => s.points, '诸天：当前系统点'], ['zt_world', s => s.world, '诸天：当前世界'], ['zt_task', s => s.task, '诸天：第一个进行中的任务']];
            // The new macro engine exists from 1.16 but is only ON by default from 1.17 (power_user.experimental_macro_engine).
            // Always register there; add the legacy MacrosParser entry only while the flag is off (1.16 default, or a user
            // who switched it off), re-checked on every settings save so toggling it at runtime keeps {{zt_*}} working.
            const legacyDone = new Set();
            const sync = () => {
                const ctx = globalThis.SillyTavern?.getContext?.() || c, engineOn = ctx.powerUserSettings?.experimental_macro_engine !== false && typeof ctx.macros?.register === 'function';
                for (const [name, f, description] of defs) {
                    if (!engineOn && !legacyDone.has(name) && typeof ctx.registerMacro === 'function') { ctx.registerMacro(name, read(f), description); legacyDone.add(name); }
                }
            };
            for (const [name, f, description] of defs) if (typeof c.macros?.register === 'function') c.macros.register(name, { handler: read(f), description });
            sync();
            const ev = c.eventTypes?.SETTINGS_UPDATED;
            if (ev) c.eventSource.on(ev, sync);          // registrations are process-wide (guarded by __zhutianMacros), so is this listener
        }
    }
    start() {
        this.mountHud(); this.mountHotkeys(); this.registerCommands();
        this.disposers.push(this.app.adapter.subscribe(() => this.refreshHud()));
        this.disposers.push(this.app.bridge.onChange(() => this.refreshHud()));
        this.disposers.push(this.app.settings.onChange(k => { if (k === 'hud') this.refreshHud(); }));
    }
    dispose() { this.dead = true; this.disposers.splice(0).forEach(f => f()); this.hud?.remove(); this.hud = null; }
}
export { STORAGE };

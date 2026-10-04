// Native-only features around the migrated originals: worldbook install/bind, new-chat init, old-save migration &
// ledger rollback, compatibility diagnostics, ledger HUD, hotkeys, slash commands and macros.
import { ID, VERSION, STORAGE, inert } from './contracts.js';
import { HOST_TESTED } from './compat.js';
import { detectLegacy } from './takeover.js';
import { promptFilterStats } from './prompt-filter.js';
import { readConfigs } from './api-center.js';
import { isMainApi } from './th-bridge.js';
import { tavernHelperMacrosActive } from './macro-like.js';
import { latestRules, mergeWorldbook, WORLDBOOK_REV, moduleStates, applyModules, BALANCE_MODULES } from './worldbook.js';
import { findBindings, unbindAll, restoreBindings, describe as describeBindings } from './wb-unbind.js';
import { buildReport, copyText } from './diag-report.js';
import { stable } from './ledger-plan.js';
import { errorLine } from './errors.js';

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
    toast(kind, text) { globalThis.toastr?.[kind]?.(kind === 'error' ? errorLine(text) : text, '诸天'); }

    // ---------- worldbook ----------
    async worldbookStatus() {
        const c = this.ctx; let book = null;
        try { book = await c.loadWorldInfo(WORLD_NAME); } catch { book = null; }
        const count = book?.entries ? Object.keys(book.entries).length : 0;
        const latest = this.latestRules();
        const current = count ? latest.every(r => Object.values(book.entries).some(e => e.comment === r.comment && e.content === r.content)) : false;
        return { exists: !!count, count, chatBound: c.chatMetadata?.world_info === WORLD_NAME, builtin: latest.length, current };
    }
    /** Once per session: an older copy of the book (e.g. imported from v1.1) is never overwritten automatically. */
    async staleNotice() {
        if (this.staleShown) return; this.staleShown = true;
        const st = await this.worldbookStatus().catch(() => null);
        if (st?.exists && !st.current) this.toast('info', `“${WORLD_NAME}”世界书不是插件最新版（缺少聊天群衔接等条目）。可在 设置 → 世界书安装 / 绑定 → 更新到最新版（会先备份）。`);
    }
    latestRules() { return latestRules(this.app.original.ZhuTianBuiltinRules).rules; }
    /** Brings an existing book up to this version: backup first (a separate book), then built-in entries replaced,
     *  the user's own entries and on/off choices kept. */
    async updateWorldbook() {
        if (this.wbUpdating) throw Error('世界书正在升级，请勿重复提交。');
        this.wbUpdating = true;
        try { return await this.writeWorldbookUpgrade(); } finally { this.wbUpdating = false; }
    }
    async writeWorldbookUpgrade() {
        const c = this.ctx;
        // Host loadWorldInfo returns cached data even after failed saves. Verify the server, not its cache.
        const readDisk = async name => {
            const response = await fetch('/api/worldinfo/get', { method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: c.getRequestHeaders(), body: JSON.stringify({ name }), signal: AbortSignal.timeout(15000) });
            if (!response.ok) throw Error('世界书服务器核验失败 HTTP ' + response.status);
            return response.json();
        };
        const book = await readDisk(WORLD_NAME);
        if (!book?.entries || !Object.keys(book.entries).length) return { ...(await this.installWorldbook('none')), created: true };
        const stamp = new Date().toLocaleString('sv-SE').replace(/[-: ]/g, '').slice(0, 14), backup = `${WORLD_NAME}-备份-${stamp}-${crypto.randomUUID().slice(0, 8)}`;
        await c.saveWorldInfo(backup, structuredClone(book), true);
        const backupRead = await readDisk(backup);
        if (stable(backupRead?.entries) !== stable(book.entries)) throw Error('世界书备份读回不一致，未更新原书。');
        const legacy = latestRules(this.app.original.ZhuTianBuiltinRules, { legacy: true }).rules;
        const r = mergeWorldbook(book, this.latestRules());
        let preserved = 0; const seen = new Set();
        for (const old of Object.values(book.entries)) {
            if (seen.has(old.comment)) continue; // duplicate comment rows are kept verbatim, not replaced
            seen.add(old.comment);
            const base = legacy.find(x => x.comment === old.comment), next = Object.values(r.book.entries).find(x => x.comment === old.comment);
            if (base && next && old.content !== base.content && old.content !== next.content) {
                if (!globalThis.confirm(`「${old.comment}」内容与插件旧版不同，可能有你的自定义修改。已备份到 ${backup}。确定覆盖为新版？取消只保留这一条。`)) { const uid = next.uid; r.book.entries[uid] = { ...structuredClone(old), uid }; preserved++; }
            }
        }
        if (stable(await readDisk(WORLD_NAME)) !== stable(book)) throw Error('升级期间世界书被其它操作改动，已停止覆盖；备份：' + backup);
        await c.saveWorldInfo(WORLD_NAME, r.book, true);
        await c.updateWorldInfoList?.();
        const checked = await readDisk(WORLD_NAME);
        if (stable(checked?.entries) !== stable(r.book.entries)) throw Error('更新结果未核实，请从备份书核对：' + backup);
        return { ...(await this.worldbookStatus()), backup, preserved, replaced: r.replaced, added: r.added, kept: r.kept };
    }
    /** 0.8.4 强力模块: current on/off of the switchable entries in the installed book (book-wide, all chats). */
    async moduleStates() {
        let book = null; try { book = await this.ctx.loadWorldInfo(WORLD_NAME); } catch { book = null; }
        return { exists: !!(book?.entries && Object.keys(book.entries).length), list: moduleStates(book) };
    }
    /** Switches entries of the installed book ({comment: on}). Only `disable` changes; nothing else is rewritten. */
    async setModules(want) {
        const c = this.ctx; let book = null;
        try { book = await c.loadWorldInfo(WORLD_NAME); } catch { book = null; }
        if (!book?.entries || !Object.keys(book.entries).length) throw Error(`还没有安装“${WORLD_NAME}”世界书：设置 → 世界书安装 / 绑定。`);
        const allowed = Object.fromEntries(Object.entries(want || {}).filter(([k]) => BALANCE_MODULES.some(m => m.comment === k)));
        const r = applyModules(book, allowed);
        if (r.changed) { await c.saveWorldInfo(WORLD_NAME, r.book, true); await c.updateWorldInfoList?.(); }
        return { changed: r.changed, list: moduleStates(r.book) };
    }
    /** The same book as a SillyTavern world-info JSON file (for manual import / sharing). */
    exportWorldbook() {
        const blob = new Blob([JSON.stringify(buildWorldbook(this.latestRules()), null, 2)], { type: 'application/json' });
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${WORLD_NAME}-插件${WORLDBOOK_REV}.json`;
        document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    }
    async installWorldbook(bind) {
        const c = this.ctx, st = await this.worldbookStatus();
        if (!st.exists) {
            await c.saveWorldInfo(WORLD_NAME, buildWorldbook(this.latestRules()), true);
            await c.updateWorldInfoList?.();
        }
        if (bind === 'chat') {
            if (!this.app.adapter.currentIdentity()) throw Error('请先打开单角色聊天再绑定。');
            c.chatMetadata.world_info = WORLD_NAME; await c.saveMetadata();
        }
        return this.worldbookStatus();
    }
    /** Is this an 诸天 chat? (ledger variable or a status-bar block in any floor) */
    isZhutianChat() {
        const c = this.ctx;
        return !!c.chatMetadata?.variables?.诸天系统 || (c.chat || []).some(m => typeof m?.mes === 'string' && m.mes.includes('<ZhuTianPanel>'));
    }
    /** Replaces the manual "import the worldbook and select it" step of v1.1: on an 诸天 chat the book is installed
     *  (never overwritten) and bound to the chat — unless it is already active globally / on the character, or the
     *  chat already has another chat book. Returns what happened, for diagnostics. */
    async autoWorldbook() {
        if (this.dead || this.app.settings.get('worldbookAuto') === false) return this.wbAuto = 'off';
        const c = this.ctx;
        if (!this.app.adapter.currentIdentity() || !this.isZhutianChat()) return this.wbAuto = 'not-zhutian';
        if (c.chatMetadata?.world_info === WORLD_NAME) { this.staleNotice(); return this.wbAuto = 'chat'; }
        if (c.chatMetadata?.world_info) return this.wbAuto = 'other-chat-book';
        let wi = null; try { wi = await import('/scripts/world-info.js'); } catch { /* older layout: fall back to chat binding */ }
        const ch = c.characters?.[c.characterId];
        const charBooks = [ch?.data?.extensions?.world, ...(wi?.world_info?.charLore?.find?.(e => e.name === ch?.avatar)?.extraBooks || [])];
        if ((wi?.selected_world_info || []).includes(WORLD_NAME)) return this.wbAuto = 'global';
        if (charBooks.includes(WORLD_NAME)) return this.wbAuto = 'character';
        const st = await this.installWorldbook('chat');
        if (st.chatBound) this.toast('info', `已自动安装并绑定“${WORLD_NAME}”世界书（${st.count} 条）到当前聊天。可在设置中关闭自动绑定。`);
        const b = await this.worldbookBudget().catch(() => null);
        if (b && !b.ok) this.toast('warning', `世界书预算只有 ${b.budget} token，诸天常驻规则需要约 ${b.need}，酒馆会整批跳过它们。打开“兼容诊断”可一键调整。`);
        return this.wbAuto = st.chatBound ? 'auto-bound' : 'failed';
    }
    /** The 11 constant 诸天 rules (~12k characters) must fit SillyTavern's world-info budget, otherwise ST silently
     *  drops them. Returns {need, budget, ok} in tokens, or null when the host does not expose the numbers. */
    async worldbookBudget() {
        const c = this.ctx; let wi = null; try { wi = await import('/scripts/world-info.js'); } catch { return null; }
        const max = c.mainApi === 'openai' && c.chatCompletionSettings?.openai_max_context ? Number(c.chatCompletionSettings.openai_max_context) : Number(c.maxContext), pct = Number(wi.world_info_budget), cap = Number(wi.world_info_budget_cap) || 0;
        if (!Number.isFinite(max) || !Number.isFinite(pct)) return null;
        let budget = Math.max(1, Math.round(max * pct / 100)); if (cap > 0) budget = Math.min(budget, cap);
        const text = this.latestRules().filter(r => r.constant && !r.disable).map(r => r.content).join('\n');
        let need = Math.ceil(text.length * 0.9);
        try { if (typeof c.getTokenCountAsync === 'function') need = await c.getTokenCountAsync(text); } catch { /* estimate */ }
        return this.wbBudget = { need, budget, max, pct, cap, ok: budget >= need };
    }
    /** Raises the world-info budget through SillyTavern's own controls (so ST saves it the normal way). */
    fixWorldbookBudget() {
        const b = this.wbBudget; if (!b || b.ok) return false;
        const pct = Math.min(100, Math.ceil((b.need * 1.25) / b.max * 100));
        const set = (id, v) => { const el = document.getElementById(id); if (!el) return false; el.value = String(v); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); return true; };
        const done = set('world_info_budget', pct);
        if (b.cap > 0 && b.cap < b.need) set('world_info_budget_cap', 0);
        if (pct >= 100 && b.max * 1.0 < b.need * 1.25) this.toast('warning', '上下文长度太小，即使预算 100% 也放不下诸天常驻规则，请在 API 设置中调大上下文。');
        return done;
    }
    // ---------- 0.8.2 解绑 ----------
    async bindings() { let wi = null; try { wi = await import('/scripts/world-info.js'); } catch { /* old layout */ } return findBindings(this.ctx, wi, WORLD_NAME); }
    /** 一键解绑: every card / extra book / global / open chat. Turns auto-binding off, otherwise the open 诸天 chat would be
     *  bound again on the next message. */
    async unbindWorldbook() {
        const rec = await unbindAll(this.ctx, WORLD_NAME, { chat: true });
        if (rec.count) this.app.settings.set('wbUnbound', { ...rec, auto: false, noticed: true });
        if (this.app.settings.get('worldbookAuto') !== false) this.app.settings.set('worldbookAuto', false);
        this.wbAuto = 'off';
        return rec;
    }
    async restoreWorldbook() {
        const rec = this.app.settings.get('wbUnbound'); if (!rec) throw Error('没有可恢复的解绑记录。');
        const r = await restoreBindings(this.ctx, rec);
        this.app.settings.set('wbUnbound', null);
        return r;
    }
    /** Once after re-enabling: say what the disable hook unbound. */
    unbindNotice() {
        const rec = this.app.settings.get('wbUnbound'); if (!rec?.auto || rec.noticed) return;
        this.app.settings.set('wbUnbound', { ...rec, noticed: true });
        this.toast('info', `上次关闭插件时，已把“${WORLD_NAME}”世界书从 ${describeBindings(rec)} 解绑。需要恢复：终端 → 设置 → 世界书 → 恢复绑定。`);
    }
    async openWorldbook() {
        const st = await this.worldbookStatus(), b = await this.bindings().catch(() => null), last = this.app.settings.get('wbUnbound');
        const bound = b ? [b.chars.length ? `角色卡 ${b.chars.length} 张（${esc(b.chars.slice(0, 6).map(c => c.name).join('、'))}${b.chars.length > 6 ? '…' : ''}）` : '', b.extra.length ? `附加世界书 ${b.extra.length} 张卡` : '', b.global ? '全局世界书' : '', b.chat ? '当前聊天' : ''].filter(Boolean).join('、') : '';
        const el = this.popup(`<h3>诸天世界书（外挂，不依赖角色卡 MVU）</h3>
<p>内置规则 ${st.builtin} 条（插件 ${WORLDBOOK_REV} 版）。当前酒馆：${st.exists ? `已存在“${esc(WORLD_NAME)}”（${st.count} 条，${st.current ? '<b>已是最新</b>' : '<b>不是最新版</b>，可点「更新到最新版」'}）` : '尚未安装'}；当前聊天${st.chatBound ? '<b>已绑定</b>' : '未绑定'}。</p>
<div class="zt-popup-actions"><div class="menu_button" data-wb="install">仅安装世界书</div><div class="menu_button" data-wb="chat">安装并绑定到当前聊天</div><div class="menu_button" data-wb="update">更新到最新版（先备份）</div><div class="menu_button" data-wb="export">导出 JSON</div></div>
<p class="zt-note">绑定为“聊天世界书”（chat_metadata.world_info），只影响当前聊天，与其他角色卡隔离。已存在同名世界书时只绑定，不覆盖你改过的条目。</p>
<h4>解绑</h4>
<p class="zt-wb-bound">现在绑定在：${bound || '没有任何地方'}。</p>
<div class="zt-popup-actions"><div class="menu_button" data-wb="unbind" ${b?.total ? '' : 'aria-disabled="true"'}>一键解绑全部</div>${last ? `<div class="menu_button" data-wb="restore" title="${esc(describeBindings(last))}">恢复上次解绑（${esc(describeBindings(last))}）</div>` : ''}</div>
<p class="zt-note">解绑只取消绑定，不删除世界书。会同时关闭“诸天存档自动绑定世界书”，否则当前诸天聊天下一条消息又会自动绑上。其他聊天文件里的聊天世界书不改动（只在那些诸天聊天里生效）。关闭插件时会自动做同样的解绑（设置里可关；需要 SillyTavern 1.17 及以上，1.16 没有关闭钩子）。</p><p class="zt-out"></p>`);
        el.addEventListener('click', async e => {
            const act = e.target.closest('[data-wb]')?.dataset.wb; if (!act) return;
            const out = el.querySelector('.zt-out');
            if (act === 'export') { this.exportWorldbook(); return; }
            if (act === 'unbind') {
                try { const r = await this.unbindWorldbook(); out.textContent = r.count ? `已解绑：${describeBindings(r)}。${r.errors.length ? '部分失败：' + r.errors.join('；') : ''}自动绑定已关闭。` : '没有找到需要解绑的地方。'; el.querySelector('.zt-wb-bound').textContent = '现在绑定在：没有任何地方。'; if (r.count) this.toast('success', `已解绑 ${r.count} 处`); }
                catch (err) { out.textContent = '未完成：' + errorLine(err); }
                return;
            }
            if (act === 'restore') {
                try { const r = await this.restoreWorldbook(); out.textContent = `已恢复 ${r.count} 处${r.skipped ? `，${r.skipped} 处跳过（角色卡已删除或换了别的世界书）` : ''}。`; e.target.closest('[data-wb]').remove(); }
                catch (err) { out.textContent = '未完成：' + errorLine(err); }
                return;
            }
            if (act === 'update') {
                if (!confirm('升级影响：商城改为不强制削弱，禁忌仅获得时有门槛；补充剧情收纳、多人羁绊和盲盒规则。先备份整本世界书；保留你的开关、关键词和插入设置，自改同名正文逐条询问。是否继续？')) return;
                try { const r = await this.updateWorldbook(); out.textContent = r.created ? `已安装最新版（${r.count} 条）。` : `已更新：同步 ${r.replaced - r.preserved} 条、新增 ${r.added} 条、保留自改正文 ${r.preserved} 条及自定义条目 ${r.kept} 条；旧版已备份为“${r.backup}”。`; this.toast('success', r.preserved ? '世界书已处理；保留的自改条目请手动合并新规则' : '世界书已更新到插件最新版'); }
                catch (err) { out.textContent = '未完成：' + errorLine(err); }
                return;
            }
            try { const r = await this.installWorldbook(act === 'chat' ? 'chat' : 'none'); out.textContent = `完成：世界书 ${r.count} 条；当前聊天${r.chatBound ? '已绑定' : '未绑定'}。`; this.toast('success', '世界书已就绪'); }
            catch (err) { out.textContent = '未完成：' + errorLine(err); }
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
        const rows = r.backups.map(b => `<tr><td>${new Date(b.at).toLocaleString()}${b.reason ? `<br><small>${esc(b.reason)}</small>` : ''}</td><td>楼 ${b.floor}</td><td>${esc(b.balance)}</td><td><div class="menu_button" data-restore="${b.at}">回滚到此</div></td></tr>`).reverse().join('') || '<tr><td colspan="4">暂无自动备份（账本首次被原生状态栏改动时自动生成，最多 5 份）。</td></tr>';
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
            } catch (err) { out.textContent = '未完成：' + errorLine(err); }
        });
    }
    /** 0.9.1: the two AI endpoint configs (for 复制诊断信息: only host + model are reported). */
    apiConfigs() { return readConfigs(this.app.bridge, this.app.original.ZhuTianMemoryCore?.NS); }
    /** 0.9.1: copy the diagnostic report; if the browser refuses, show it in a box to copy by hand. */
    async copyDiagnostics() {
        await this.worldbookBudget().catch(() => null);
        const text = buildReport(this.app);
        if (await copyText(text)) { this.toast('success', '已复制诊断信息（不含 API Key 和聊天内容），可以直接粘贴发送'); return text; }
        const el = this.popup(`<h3>诊断信息</h3><p>浏览器不允许自动复制：长按下面的文字框 → 全选 → 复制。</p><textarea class="text_pole" readonly style="width:100%;height:50vh;font:12px/1.4 monospace">${esc(text)}</textarea>`, true);
        el.querySelector('textarea')?.select();
        return text;
    }
    async openDiagnostics() {
        await this.worldbookBudget().catch(() => null);
        const a = this.app.adapter, caps = a.capabilities || [], sb = this.app.statusbar?.state || {};
        this.popup(`<h3>兼容诊断 · ${VERSION}</h3>
<p>SillyTavern <b>${esc(a.version)}</b>：${esc(a.support?.reason)}</p><p>已验收版本：${HOST_TESTED.join(' / ')}（每个版本均在隔离真实宿主上跑过浏览器验收）。</p>
<table class="zt-table"><tr><th>接口</th><th>状态</th></tr>${caps.map(x => `<tr><td>${esc(x.label)}</td><td>${x.ok ? '✅' : '❌ 相关功能自动停用'}</td></tr>`).join('')}</table>
<p>原生状态栏：${esc(sb.mode)} — ${esc(sb.reason)}</p>${(d => d ? `<p>最新楼层：${d.ok === true ? '✅' : d.ok === false ? '⚠' : 'ℹ'} ${esc(d.text)}</p>` : '')(this.app.statusbar?.diagnoseLast?.())}<p>莉莉丝助手：${(h => h ? (h.ok ? '运行中（原版代码 + 原生桥接）' : '⚠ 窗口已创建但原版未完全启动：' + esc(h.text)) : esc(this.app.assistantError || '未启动'))(this.app.assistant?.health?.())}</p>
<p>立绘：${esc(this.app.portrait?.describe?.() || '原版分层参数动画')}</p>
<h4>原版 v1.1 取代情况</h4><table class="zt-table"><tr><th>原版组件</th><th>插件接管</th></tr>${this.replacementRows().map(([k, v]) => `<tr><td>${esc(k)}</td><td>${v}</td></tr>`).join('')}</table>
<div class="zt-popup-actions"><div class="menu_button" data-diag="copy">复制诊断信息</div><div class="menu_button" data-diag="selftest">手机真机自检</div><div class="menu_button" data-diag="takeover">一键接管旧版</div><div class="menu_button" data-diag="api">AI 接口设置</div><div class="menu_button" data-diag="rerender">重新渲染楼层</div>${this.wbBudget && !this.wbBudget.ok ? '<div class="menu_button" data-diag="budget">调整世界书预算</div>' : ''}</div>`, true)
            .addEventListener('click', e => { const act = e.target.closest('[data-diag]')?.dataset.diag; if (act === 'copy') this.copyDiagnostics(); if (act === 'selftest') { e.target.closest('.popup')?.querySelector('.popup-button-ok')?.click(); setTimeout(() => this.app.deviceCheck?.run(), 300); } if (act === 'takeover') this.app.runTakeover?.(); if (act === 'api') this.app.openApiCenter?.(); if (act === 'rerender') { this.app.statusbar?.rebuild(); this.toast('success', '已重新渲染聊天楼层'); } if (act === 'budget' && this.fixWorldbookBudget()) { this.toast('success', '已调整世界书预算。'); this.worldbookBudget(); } });
    }
    /** One row per piece of the original v1.1 install: what replaces it now and what is still left over. */
    replacementRows() {
        const app = this.app, st = app.settings, sb = app.statusbar, legacy = (() => { try { return detectLegacy(this.ctx); } catch { return []; } })();
        const left = kind => legacy.filter(i => i.kind === kind);
        const on = (k, yes, no = '已关闭') => st.get(k) === false ? '⏸ ' + no : '✅ ' + yes;
        let api = { status: {}, assistant: {} }; try { api = readConfigs(app.bridge, app.original.ZhuTianMemoryCore?.NS); } catch { /* bridge gone */ }
        const apiText = c => c?.url ? (isMainApi(c.url) ? '酒馆主 API' : esc(new URL(c.url).host) + (c.model ? ' · ' + esc(c.model) : '')) : '⚠ 未设置（打开 AI 接口设置）';
        const counts = sb?.counts || {};
        return [
            ['世界书「诸天万界最强系统」', ({ chat: '✅ 已绑定到当前聊天', 'auto-bound': '✅ 已自动安装并绑定到当前聊天', global: '✅ 已作为全局世界书启用', character: '✅ 已绑定在角色卡上', 'other-chat-book': '⚠ 当前聊天绑定了别的世界书，未自动替换（可在“世界书安装/绑定”手动处理）', 'not-zhutian': '… 当前聊天还不是诸天存档（有账本或状态栏后自动绑定）', off: '⏸ 自动绑定已关闭' })[this.wbAuto] || esc(this.wbAuto || '检查中') + '（内置 35 条，逐条与原版一致）'],
            ['世界书预算', !this.wbBudget ? '… 未检测' : this.wbBudget.ok ? `✅ ${this.wbBudget.budget} token ≥ 常驻规则约 ${this.wbBudget.need}` : `⚠ 仅 ${this.wbBudget.budget} token，常驻规则需要约 ${this.wbBudget.need}：酒馆会跳过诸天规则 — 点“调整世界书预算”`],
            ['正则 · 状态栏 3.1', sb ? (sb.state.mode === 'terminal' ? '✅ 终端内原生渲染（8 分页全部功能），楼层只留小标签' : sb.state.mode === 'native' ? '✅ 旧兼容模式：楼层内原生渲染（0.7.0 起设置里不再提供）' : '⏸ ' + esc(sb.state.reason)) : '❌ ' + esc(app.statusbarError || '未启动')],
            ['正则 · 旧楼层精简显示', sb?.state.mode === 'native' ? on('compactHistory', `原生精简卡（本页已显示 ${counts.compact || 0} 张），点击展开完整状态栏`) : '✅ 终端模式下楼层不再显示状态栏，由“系统已记录”小标签取代（点击打开终端）'],
            ['正则 · 旧楼层不发给AI', on('promptStripPanels', `生成拦截器（保留最新 ${esc(st.get('promptPanelKeepDepth'))} 层；已处理 ${promptFilterStats.runs} 次生成 / ${promptFilterStats.floors} 层）`)],
            ['正则 · 莉莉丝专属语音框', on('voiceBox', `原生语音框（已渲染 ${counts.voices || 0} 条），语气头像、不写情绪词`, '已关闭（台词按普通正文显示）')],
            ['酒馆助手 · 变量宏', st.get('macroLike') === false ? '⏸ 已关闭' : tavernHelperMacrosActive(this.ctx) ? '↪ 酒馆助手在运行，由它处理（插件让位）' : !app.macros ? '⚠ 未启动（见控制台）' : /缺少/.test(app.macros.state || '') ? `⚠ ${esc(app.macros.state)}` : `✅ 原生处理 {{get_chat_variable::…}}（${app.macros?.stats?.prompts || 0} 次生成）`],
            ['酒馆助手脚本 · 莉莉丝契约空间', app.assistant ? '✅ 原版代码经原生桥接运行（记忆、工作台、私聊、连接、立绘）' : '❌ ' + esc(app.assistantError || '未启用')],
            ['真实触摸互动', app.touch?.stage ? on('touchGestures', `轻点 + 抚摸 + 长按 + 视线跟随（轻点 ${app.touch.stats.taps} / 抚摸 ${app.touch.stats.strokes} / 长按 ${app.touch.stats.holds}）`) : '… 打开莉莉丝窗口后挂载'],
            ['API · 状态栏', apiText(api.status)],
            ['API · 莉莉丝助手 / 私聊', apiText(api.assistant)],
            ['仍启用的旧版内容', legacy.length ? '⚠ ' + legacy.map(i => esc(`${i.kind === 'regex' ? '正则' : '脚本'}：${i.name}`)).join('；') + ' — 点“一键接管旧版”停用' + (left('script').length ? '（旧助手脚本与插件同时运行会出现两个莉莉丝）' : '') : '✅ 无，已完全由插件接管'],
        ];
    }

    // ---------- HUD ----------
    mountHud() {
        const form = document.getElementById('send_form'); if (!form || this.hud) return;
        const hud = document.createElement('div'); hud.id = ID + '-hud'; hud.className = 'zt-hud'; hud.setAttribute('role', 'button'); hud.tabIndex = 0;
        hud.title = '诸天账本速览 · 点击打开诸天终端';
        form.parentElement.insertBefore(hud, form); this.hud = hud;
        const go = () => this.app.openTerminal('ov');
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
            if (k === 'z' || k === 'x') { e.preventDefault(); if (this.app.hub?.isOpen) this.app.hub.close(); else this.app.openTerminal(); }
            else if (k === 's') { e.preventDefault(); this.app.openTerminal('ov'); }
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
                    case 'open': case 'terminal': app.openTerminal(rest[0]); return '';
                    case 'status': app.openTerminal('ov'); return '';
                    case 'shop': app.openTerminal('shop'); return '';
                    case 'bag': app.openTerminal('bag'); return '';
                    case 'init': f.initChat().then(r => f.toast('success', r.created ? '已初始化诸天账本' : '账本已存在，已补齐缺失字段')).catch(e => f.toast('error', e.message)); return '';
                    case 'world': f.openWorldbook(); return '';
                    case 'backup': f.openMigration(); return '';
                    case 'export': case 'import': app.dataIO?.open(); return '';
                    case 'diag': f.openDiagnostics(); return '';
                    case 'copydiag': f.copyDiagnostics(); return '';
                    case 'selftest': app.deviceCheck?.run(); return '';
                    case 'points': return String(ledgerSummary(app.adapter.variables())?.points ?? '');
                    case 'live2d': app.portrait?.setMode(rest[0] === 'off' ? 'rig' : 'live2d'); return '';
                    default: return '用法：/zt open [页面]|status|shop|bag|init|world|backup|export|diag|copydiag|selftest|points|live2d [off]';
                }
            }, ['zhutian'], '<span class="monospace">/zt open [页面]|status|shop|bag|init|world|backup|export|diag|copydiag|selftest|points|live2d</span> – 诸天终端', true, true);
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
        this.disposers.push(this.app.settings.onChange(k => { if (k === 'hud') this.refreshHud(); if (k === 'worldbookAuto') this.scheduleWorldbook(); }));
        const c = this.ctx, ev = c.eventTypes, run = () => this.scheduleWorldbook();
        for (const key of ['CHAT_CHANGED', 'MESSAGE_RECEIVED']) if (ev[key]) { c.eventSource.on(ev[key], run); this.disposers.push(() => c.eventSource.removeListener(ev[key], run)); }
        this.scheduleWorldbook();
        setTimeout(() => { if (!this.dead) this.unbindNotice(); }, 2500);
    }
    scheduleWorldbook() { clearTimeout(this.wbTimer); this.wbTimer = setTimeout(() => this.autoWorldbook().catch(e => { this.wbAuto = 'error: ' + e.message; console.warn('[诸天] 世界书自动绑定失败', e); }), 800); }
    dispose() { this.dead = true; clearTimeout(this.wbTimer); this.disposers.splice(0).forEach(f => f()); this.hud?.remove(); this.hud = null; }
}
export { STORAGE };

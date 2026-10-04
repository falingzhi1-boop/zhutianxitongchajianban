import { frameScope, releaseFrames } from './action-support.js';
// Presentation records are NOT receipts. Never deletes chat floors, panel snapshots or transaction IDs.
import { esc } from './hub.js';
export function trimModuleHints(s) { return String(s).replace(/【(?:本次涉及模块关键词|模块关键词)[^】]*】/g, '').replace(/\n{3,}/g, '\n\n'); }
export function recordKind(s) {
    return /商城刷新|刷新失败/.test(s) ? 'refresh' : /分解|回收/.test(s) ? 'recycle' : /购买|保留|入库|抽取|盲盒/.test(s) ? 'items' : 'story';
}
export function recordText(li) {
    const copy = li.cloneNode(true); copy.querySelectorAll('input,label[data-zt-select],.gacha-raw-result').forEach(n => n.remove());
    return copy.textContent.replace(/【模块关键词[^】]*】/g, '').replace(/\s+/g, ' ').trim();
}
export function summarizeRecords(rows) {
    const kept = rows.filter(r => r.selected && r.kind !== 'refresh');
    if (!kept.length) return '';
    const regular = kept.filter(r => r.kind !== 'recycle').map(r => r.text);
    const recycle = kept.filter(r => r.kind === 'recycle');
    if (recycle.length) regular.push(`已分解/回收 ${recycle.length} 条：${recycle.map(r => r.text.replace(/^[^:：]*[:：]\s*/, '')).join('；')}`);
    return `【诸天操作摘要】以下操作已执行，不要再次扣费、发奖或入库。\n${regular.join('\n')}\n仅据这些已确认事实衔接剧情。`;
}
/** Only recognized boilerplate is removed from a generation COPY; prose and original chat stay unchanged. */
export function compactLegacyOperation(text) {
    if (!String(text).startsWith('[系统操作：本次消费/抽取记录如下。')) return text;
    return String(text).replace(/^\[系统操作：[^\n]*\n\n/, '【诸天历史操作：账本已执行，不重复结算】\n')
        .replace(/^\d+\.\s*.*商城刷新[^\n]*\n?/gm, '')
        .replace(/【本次涉及模块关键词[^】]*】/g, '')
        .replace(/【模块关键词[^】]*】/g, '')
        .replace(/\n当前盲盒状态：[^\n]*\n/g, '\n')
        .replace(/\n注：以上分解\/回收[^\n]*\n/g, '\n')
        .replace(/\n注意：以上数据已同步，无需再更新面板数据。\]$/, '')
        .replace(/\n{3,}/g, '\n\n');
}
export class OperationRecords {
    constructor(app) { this.app = app; this.off = []; this.mounted = new WeakSet(); }
    start() {
        const sb = this.app.statusbar; if (sb) { const prev = sb.enhanceFrame, enhance = (f, d) => { prev?.(f, d); this.mount(f, d); }; sb.enhanceFrame = enhance; this.off.push(() => { if (sb.enhanceFrame === enhance) sb.enhanceFrame = prev; }); }
        this.app.hub?.hook('onEngine', (frame, doc) => this.mount(frame, doc));
        this.app.hub?.addNav('交易', 'records', '操作日志', 'flag', { title: '本地操作日志', render: el => {
            const rows = this.app.adapter.ledger()?.操作日志 || [];
            el.innerHTML = `<h3>本地操作日志</h3><p class="zt-note">最近100条，仅供核对，不自动发送给模型。不是交易撤销入口。</p>${rows.slice().reverse().map(r => `<article class="zt-card"><small>${esc(new Date(r.at).toLocaleString())} · ${esc(r.kind)}</small><p>${esc(r.text)}</p></article>`).join('') || '<p>暂无日志。</p>'}`;
        } }); return this;
    }
    mount(frame, doc) {
        if (this.dead || this.mounted.has(doc)) return; this.mounted.add(doc);
        const off = frameScope(this, frame, doc);
        const w = frame.contentWindow, insert = w?.insertIntoChatInput;
        if (typeof insert === 'function') { const wrapped = (...args) => { args[0] = trimModuleHints(args[0]); return insert.apply(w, args); }; w.insertIntoChatInput = wrapped; off.push(() => { if (w.insertIntoChatInput === wrapped) w.insertIntoChatInput = insert; }); }
        const root = doc.querySelector('.mvu-sys'), card = root?.querySelector('.cart-card'), list = card?.querySelector('.cart-items-list'); if (!list) return;
        const bar = doc.createElement('div'); bar.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;margin:8px 0';
        bar.innerHTML = '<button type="button" data-select="all">全选</button><button type="button" data-select="none">全不选</button><button type="button" data-select="items">物品</button><button type="button" data-select="recycle">分解/回收</button><button type="button" data-select="story">剧情</button><button type="button" data-select="clear">清空展示</button>';
        card.insertBefore(bar, list);
        const seen = new WeakSet();
        const paint = () => {
            for (const li of [...list.children]) {
                if (seen.has(li)) continue; seen.add(li);
                const kind = recordKind(li.textContent); if (kind === 'refresh') { li.remove(); continue; }
                li.dataset.ztKind = kind;
                const label = doc.createElement('label'); label.dataset.ztSelect = '1'; label.style.cssText = 'display:inline-flex;min-width:32px;min-height:32px;align-items:center';
                const cb = doc.createElement('input'); cb.type = 'checkbox'; cb.checked = kind !== 'recycle'; cb.setAttribute('aria-label', '选择这条记录发送'); label.append(cb); li.prepend(label);
            }
            const checkout = card.querySelector('.btn-checkout'); if (checkout) checkout.textContent = '预览选中的剧情摘要';
        };
        const observer = new MutationObserver(paint); observer.observe(list, { childList: true, subtree: true }); paint();
        bar.onclick = e => { const mode = e.target.dataset.select; if (!mode) return;
            if (mode === 'clear') { if (confirm('只清空展示记录，不退款、不删除背包、不撤销任何交易。继续？')) list.replaceChildren(); return; }
            for (const li of list.children) { const cb = li.querySelector('input[type=checkbox]'); if (cb) cb.checked = mode === 'all' || li.dataset.ztKind === mode; }
        };
        const click = e => {
            if (!e.target.closest?.('.btn-checkout')) return; e.preventDefault(); e.stopImmediatePropagation();
            const rows = [...list.children].map(li => ({ text: recordText(li), kind: li.dataset.ztKind, selected: !!li.querySelector('input[type=checkbox]')?.checked }));
            const text = summarizeRecords(rows); if (!text) return this.app.hub.toast('没有选中需要发送的剧情记录。');
            this.preview(text);
        };
        doc.addEventListener('click', click, true);
        off.push(() => { observer.disconnect(); doc.removeEventListener('click', click, true); bar.remove(); });
    }
    preview(text) {
        const h = this.app.hub, token = this.app.adapter.currentIdentity();
        let el = h.pages.get('record-preview')?.el;
        if (!el) el = h.register('record-preview', { title: '发送预览' });
        el.innerHTML = `<h3>发送预览</h3><p>仅写入主输入框，仍由你确认发送。不会再次记账。</p><textarea rows="10" style="width:100%;box-sizing:border-box">${esc(text)}</textarea><button type="button" class="zt-btn primary">写入主输入框</button>`;
        el.querySelector('button').onclick = () => {
            if (this.app.adapter.currentIdentity() !== token) return h.toast('聊天已切换，请重新选择记录。');
            const input = document.querySelector('#send_textarea'); if (!input) return h.toast('主输入框不可用');
            input.value = [input.value, el.querySelector('textarea').value].filter(Boolean).join('\n\n'); input.dispatchEvent(new Event('input', { bubbles: true })); h.inputWritten();
        }; h.go('record-preview');
    }
    dispose() { this.dead = true; releaseFrames(this); this.off.splice(0).forEach(f => f()); }
}

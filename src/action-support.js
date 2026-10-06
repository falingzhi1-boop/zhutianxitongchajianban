// Native 1.1 actions: capture chat identity BEFORE awaiting a model; commit only after validation.
import { readConfigs } from './api-center.js';
export const cleanText = (s, n = 500) => String(s ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, n);
export function capture(app) {
    const a = app.adapter, c = a.context(), id = a.currentIdentity();
    if (!id || !a.ledger()) throw Error('请先打开已初始化的单角色聊天。');
    if (a.isGenerating()) throw Error('主聊天正在生成，请结束后再操作。');
    return { id, chat: c.chat, tail: JSON.stringify(c.chat.map(m => [m.mes, m.swipe_id])) };
}
export function assertCapture(app, token) {
    if (app.bridge.dead || app.adapter.currentIdentity() !== token.id || app.adapter.context().chat !== token.chat || app.adapter.isGenerating() || JSON.stringify(token.chat.map(m => [m.mes, m.swipe_id])) !== token.tail) throw Error('聊天、正文或生成状态已变化；操作取消，未提交。');
}
export async function checkedCommit(app, token, mutate) {
    assertCapture(app, token); let result;
    await app.bridge.updateVariablesWith(v => {
        assertCapture(app, token); const z = v.诸天系统;
        if (!z) throw Error('账本不存在');
        result = mutate(z, v); z.界面记账时间 = Date.now(); return v;
    }, { type: 'chat', verify: true, expectedIdentity: token.id });
    return result;
}
/** 1.1.1 audit: did a failed commit leave the chat frozen as "written or not — unknown"? (Bridge transactions.uncertain) */
export function isUncertain(app, token) { return !!token?.id && !!app.adapter.transactions?.uncertain?.has(token.id); }
export async function askFeature(app, route, system, user, maxTokens = 4096) {
    const c = readConfigs(app.bridge).status || {};
    return app.bridge.generateRaw({ route, user_input: user, ordered_prompts: [{ role: 'system', content: system }, 'user_input'], max_tokens: maxTokens,
        custom_api: c.url ? { apiurl: c.url, key: c.key, model: c.model, max_tokens: maxTokens, temperature: .85 } : undefined });
}
export function parseObject(text) {
    const s = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    const x = JSON.parse(s); if (!x || typeof x !== 'object') throw Error('模型未返回 JSON 对象'); return x;
}
export function audit(z, kind, text) {
    z.操作日志 ||= []; z.操作日志.push({ id: crypto.randomUUID(), at: Date.now(), kind, text: cleanText(text, 1500) });
    if (z.操作日志.length > 100) z.操作日志.splice(0, z.操作日志.length - 100);
}
export function refreshEngine(app) {
    const w = app.hub?.engineFrame?.contentWindow, root = w?.document?.querySelector('.mvu-sys');
    for (const f of ['renderBag', 'renderStore', 'renderPending', 'syncPointsFromVars']) try { w?.[f]?.(root); } catch { /* next view refresh */ }
    try { w?.renderGachaUI?.(root, w.loadGachaState()); } catch { /* not loaded yet */ }
    app.hub?.scheduleEngineView(0);
}
// A module owns only live iframe resources. Engine rerenders must not retain every retired document.
export function frameScope(owner, frame, doc) {
    owner.frames ||= new Map();
    for (const [old, entry] of owner.frames) {
        if (!entry.frame.isConnected || entry.frame.contentDocument !== old) entry.release();
    }
    const off = [], w = frame.contentWindow;
    const release = () => {
        if (!owner.frames.has(doc)) return;
        owner.frames.delete(doc); w?.removeEventListener('pagehide', release);
        off.splice(0).forEach(f => { try { f(); } catch { /* detached document */ } });
    };
    owner.frames.set(doc, { frame, release }); w?.addEventListener('pagehide', release, { once: true });
    return off;
}
export function releaseFrames(owner) { for (const entry of [...(owner.frames?.values() || [])]) entry.release(); }

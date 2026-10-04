import { compactLegacyOperation } from './operation-records.js';
// "诸天状态栏 · 旧楼层不发给AI" as a native generation interceptor (manifest.generate_interceptor).
// Original regex: /<ZhuTianPanel>[\s\S]*?<\/ZhuTianPanel>/gm → '' , promptOnly, minDepth 2 (depth 0 = newest floor).
// SillyTavern calls the interceptor with its prompt copy of the chat (coreChat) before the prompt is built; the
// array is a copy but the message objects are the live chat, so changed floors are REPLACED by shallow clones —
// the saved chat, the display and the status bar never see the removal.
export const PANEL_BLOCK = /<ZhuTianPanel>[\s\S]*?<\/ZhuTianPanel>/gm;
export const INTERCEPTOR = 'zhutianGenerateInterceptor';

/** Removes status-bar blocks from floors at depth >= keepDepth. Returns how many floors were changed. */
export function stripOldPanels(chat, keepDepth = 2) {
    if (!Array.isArray(chat)) return 0;
    const keep = Number.isFinite(Number(keepDepth)) ? Math.max(0, Math.floor(Number(keepDepth))) : 2;
    let changed = 0;
    for (let i = 0; i < chat.length; i++) {
        const depth = chat.length - 1 - i, m = chat[i];
        if (depth < keep || !m || typeof m.mes !== 'string' || !m.mes.includes('<ZhuTianPanel>')) continue;
        PANEL_BLOCK.lastIndex = 0;
        const mes = m.mes.replace(PANEL_BLOCK, '');
        if (mes !== m.mes) { chat[i] = { ...m, mes }; changed++; }
    }
    return changed;
}

export const promptFilterStats = { runs: 0, floors: 0, last: 0 };
/** Installed at module load so it exists whenever SillyTavern looks it up; it only acts while the app runs. */
export function installInterceptor() {
    globalThis[INTERCEPTOR] = async function zhutianGenerateInterceptor(chat /*, contextSize, abort, type */) {
        const app = globalThis.__zhutianApp;
        if (!app?.settings || app.settings.get('promptStripPanels') === false) return;
        try {
            if (Array.isArray(chat)) for (let i = 0; i < chat.length; i++) { const m = chat[i]; if (typeof m?.mes === 'string') { const text = compactLegacyOperation(m.mes); if (text !== m.mes) chat[i] = { ...m, mes: text }; } }
            const n = stripOldPanels(chat, app.settings.get('promptPanelKeepDepth'));
            promptFilterStats.runs++; promptFilterStats.floors += n; promptFilterStats.last = Date.now();
        } catch (e) { console.warn('[诸天] 旧楼层面板过滤失败（提示词保持原样）', e); }
    };
}

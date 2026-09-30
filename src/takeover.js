// 一键接管旧版 — switch off the v1.1 pieces this plugin now replaces, reversibly.
// v1.1 consisted of: the external worldbook (kept: the plugin installs/binds the identical book), four regex scripts
// and one Tavern Helper script. Nothing is deleted: regexes get `disabled: true`, Tavern Helper scripts get
// `enabled: false`, and every change is written to settings.takeoverLog so 恢复旧版 can undo exactly those items.
// Global items live in extension_settings (regex / tavern_helper.script.scripts); character-scoped items are written
// back through writeExtensionField. Tavern Helper keeps its own in-memory copy, so the page is reloaded afterwards.
import { LEGACY_SCRIPT_ID } from './contracts.js';

export const LEGACY_REGEX = Object.freeze({
    'bd2a75db-7ddd-4311-9f5b-db21afec623a': '莉莉丝专属语音框',
    '47b6bdaf-f89c-4cc0-bb12-617286788c94': '诸天万界最强系统状态栏 3.1',
    '5c57f2cf-1bfd-4d5e-9c7d-65d792b893ac': '诸天状态栏 · 旧楼层不发给AI',
    'add53830-bdf6-49ad-9ecb-eecd7be41eb9': '诸天状态栏 · 旧楼层精简显示',
});
export function isLegacyRegex(r) {
    if (!r || typeof r !== 'object') return false;
    if (Object.hasOwn(LEGACY_REGEX, r.id)) return true;
    const name = String(r.scriptName || ''), find = String(r.findRegex || ''), rep = String(r.replaceString || '');
    if (/ZhuTianPanel/.test(find) && /诸天/.test(name)) return true;                      // re-imported copies with new ids
    return /莉莉丝/.test(name) && /data-lilith-voice/.test(rep);
}
export function isLegacyScript(s) {
    if (!s || typeof s !== 'object' || (s.type && s.type !== 'script')) return false;
    if (s.id === LEGACY_SCRIPT_ID) return true;
    const name = String(s.name || ''), content = String(s.content || '');
    return /诸天系统|莉莉丝契约空间|独立记忆助手/.test(name) && /zt-memory-assistant-v1|ZhuTianMemoryCore|ZhuTianLilith/.test(content.slice(0, 400000));
}
/** Walks a Tavern Helper script tree (scripts and folders). */
export function* walkScripts(list) {
    for (const item of Array.isArray(list) ? list : []) {
        if (!item || typeof item !== 'object') continue;
        if (item.type === 'folder') yield* walkScripts(item.scripts); else yield item;
    }
}
const thObject = v => Array.isArray(v) ? Object.fromEntries(v) : (v && typeof v === 'object' ? v : null);

/** Finds every enabled (or, with all=true, every) legacy item. Pure over the context shape; tested in node. */
export function detectLegacy(c, { all = false } = {}) {
    const found = [];
    const regs = (list, scope, chid) => (Array.isArray(list) ? list : []).forEach(r => { if (isLegacyRegex(r) && (all || !r.disabled)) found.push({ kind: 'regex', scope, chid, id: r.id, name: r.scriptName || LEGACY_REGEX[r.id] || r.id, active: !r.disabled }); });
    regs(c?.extensionSettings?.regex, 'global');
    const ths = (list, scope, chid) => { for (const s of walkScripts(list)) if (isLegacyScript(s) && (all || s.enabled !== false)) found.push({ kind: 'script', scope, chid, id: s.id, name: s.name || s.id, active: s.enabled !== false }); };
    ths(c?.extensionSettings?.tavern_helper?.script?.scripts, 'global');
    const chid = c?.characterId, ch = chid !== undefined && chid !== null ? c?.characters?.[chid] : null;
    if (ch) {
        regs(ch.data?.extensions?.regex_scripts, 'character', chid);
        ths(thObject(ch.data?.extensions?.tavern_helper)?.scripts, 'character', chid);
        ths(ch.data?.extensions?.TavernHelper_scripts, 'character', chid);
    }
    return found;
}

/** Applies enabled/disabled to the listed items in place. Returns which containers changed. */
export function applyState(c, items, active) {
    const touched = { global: false, character: new Set() };
    const want = new Map(items.map(i => [`${i.kind}:${i.scope}:${i.id}`, i]));
    const hit = (kind, scope, id) => want.has(`${kind}:${scope}:${id}`);
    for (const r of c?.extensionSettings?.regex || []) if (r && hit('regex', 'global', r.id) && !!r.disabled === active) { r.disabled = !active; touched.global = true; }
    for (const s of walkScripts(c?.extensionSettings?.tavern_helper?.script?.scripts)) if (hit('script', 'global', s.id) && (s.enabled !== false) !== active) { s.enabled = active; touched.global = true; }
    const chid = c?.characterId, ch = chid !== undefined && chid !== null ? c?.characters?.[chid] : null;
    if (ch) {
        for (const r of ch.data?.extensions?.regex_scripts || []) if (r && hit('regex', 'character', r.id) && !!r.disabled === active) { r.disabled = !active; touched.character.add('regex_scripts'); }
        const th = thObject(ch.data?.extensions?.tavern_helper);
        if (th) { for (const s of walkScripts(th.scripts)) if (hit('script', 'character', s.id) && (s.enabled !== false) !== active) { s.enabled = active; touched.character.add('tavern_helper'); } if (touched.character.has('tavern_helper')) ch.data.extensions.tavern_helper = th; }
        for (const s of walkScripts(ch.data?.extensions?.TavernHelper_scripts)) if (hit('script', 'character', s.id) && (s.enabled !== false) !== active) { s.enabled = active; touched.character.add('TavernHelper_scripts'); }
    }
    return touched;
}

async function persist(adapter, c, touched) {
    for (const field of touched.character) await c.writeExtensionField?.(c.characterId, field, c.characters[c.characterId].data.extensions[field]);
    if (touched.global) { if (typeof adapter.host?.saveSettings === 'function') await adapter.host.saveSettings(); else c.saveSettingsDebounced(); }
}

export class Takeover {
    constructor(adapter, settings) { this.adapter = adapter; this.settings = settings; }
    ctx() { return this.adapter.context(); }
    pending() { return detectLegacy(this.ctx()); }
    log() { const l = this.settings.get('takeoverLog'); return Array.isArray(l) ? l : []; }
    /** Disables the detected items. Returns the list; `reload` says whether Tavern Helper needs a page reload. */
    async run() {
        const c = this.ctx(), items = detectLegacy(c);
        if (!items.length) return { items, reload: false };
        const touched = applyState(c, items, false);
        const log = this.log().filter(x => !items.some(i => i.kind === x.kind && i.scope === x.scope && i.id === x.id));
        log.push(...items.map(i => ({ ...i, at: Date.now() })));
        this.settings.set('takeoverLog', log);
        await persist(this.adapter, c, touched);
        if (this.settings.get('statusbar') === 'off') this.settings.set('statusbar', 'auto');
        return { items, reload: items.some(i => i.kind === 'script') };
    }
    /** Re-enables exactly what run() disabled (character items only while that character is open). */
    async restore() {
        const c = this.ctx(), log = this.log();
        const here = log.filter(i => i.scope === 'global' || String(i.chid) === String(c.characterId));
        if (!here.length) return { items: [], reload: false };
        const touched = applyState(c, here, true);
        this.settings.set('takeoverLog', log.filter(i => !here.includes(i)));
        await persist(this.adapter, c, touched);
        return { items: here, reload: here.some(i => i.kind === 'script') };
    }
}

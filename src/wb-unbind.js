// 0.8.2 一键解绑世界书 / 关闭插件时自动解绑.
// The 诸天 worldbook can end up attached in four places. Only SillyTavern's own storage is touched, and every change is
// recorded so 恢复绑定 can put exactly those bindings back:
//   * character cards — primary book   (character.data.extensions.world, via ctx.writeExtensionField)
//   * character cards — extra books    (world_info.charLore[].extraBooks, saved with the settings)
//   * the global selection             (selected_world_info, through ST's own onWorldInfoChange)
//   * the open chat                    (chat_metadata.world_info — the plugin's own auto-binding; other chats are not
//                                       rewritten: their binding only matters inside those 诸天 chats)
// Nothing here needs the running app: the extension `disable` hook calls it after the terminal is gone.

const worldInfoModule = async () => { try { return await import('/scripts/world-info.js'); } catch { return null; } };

/** Where `name` is bound right now. Pure read. */
export function findBindings(ctx, wi, name) {
    const chars = [];
    (ctx?.characters || []).forEach((ch, id) => { if (ch?.data?.extensions?.world === name) chars.push({ id, avatar: ch.avatar, name: ch.name }); });
    const lore = Array.isArray(wi?.world_info?.charLore) ? wi.world_info.charLore : [];
    const extra = lore.filter(e => Array.isArray(e?.extraBooks) && e.extraBooks.includes(name)).map(e => ({ avatar: e.name, name: (ctx?.characters || []).find(ch => ch?.avatar === e.name)?.name || e.name }));
    const global = Array.isArray(wi?.selected_world_info) && wi.selected_world_info.includes(name);
    const chat = ctx?.chatMetadata?.world_info === name ? (ctx.getCurrentChatId?.() || 'current') : '';
    return { chars, extra, global, chat, total: chars.length + extra.length + (global ? 1 : 0) + (chat ? 1 : 0) };
}

/** Removes every binding found by findBindings(). Returns a record for restore(). */
export async function unbindAll(ctx, name, { wi = null, chat = true } = {}) {
    wi = wi || await worldInfoModule();
    const found = findBindings(ctx, wi, name), done = { t: Date.now(), name, chars: [], extra: [], global: false, chat: '', errors: [] };
    for (const c of found.chars) {
        try {
            if (typeof ctx.writeExtensionField === 'function') await ctx.writeExtensionField(c.id, 'world', '');
            else throw Error('宿主没有 writeExtensionField');
            done.chars.push({ avatar: c.avatar, name: c.name });
        } catch (e) { done.errors.push(`${c.name}：${e.message || e}`); }
    }
    if (found.extra.length && Array.isArray(wi?.world_info?.charLore)) {
        const lore = wi.world_info.charLore;
        for (let i = lore.length - 1; i >= 0; i--) {
            const e = lore[i]; if (!Array.isArray(e?.extraBooks) || !e.extraBooks.includes(name)) continue;
            e.extraBooks = e.extraBooks.filter(b => b !== name);
            if (!e.extraBooks.length) lore.splice(i, 1);
            done.extra.push(found.extra.find(x => x.avatar === e.name) || { avatar: e.name, name: e.name });
        }
    }
    if (found.global) {
        try {
            if (typeof wi?.onWorldInfoChange === 'function') wi.onWorldInfoChange({ state: 'off', silent: 'true' }, name);
            else wi.selected_world_info.splice(wi.selected_world_info.indexOf(name), 1);
            done.global = !wi.selected_world_info.includes(name);
        } catch (e) { done.errors.push('全局世界书：' + (e.message || e)); }
    }
    if (chat && found.chat) {
        try { delete ctx.chatMetadata.world_info; await ctx.saveMetadata?.(); done.chat = found.chat; }
        catch (e) { done.errors.push('当前聊天：' + (e.message || e)); }
    }
    try { ctx.saveSettingsDebounced?.(); } catch { /* host gone */ }
    done.count = done.chars.length + done.extra.length + (done.global ? 1 : 0) + (done.chat ? 1 : 0);
    return done;
}

/** Puts back what unbindAll() removed (cards that were deleted meanwhile are skipped). */
export async function restoreBindings(ctx, rec, { wi = null } = {}) {
    if (!rec?.name) return { count: 0, skipped: 0 };
    wi = wi || await worldInfoModule();
    let count = 0, skipped = 0;
    for (const c of rec.chars || []) {
        const id = (ctx.characters || []).findIndex(ch => ch?.avatar === c.avatar);
        const cur = ctx.characters?.[id]?.data?.extensions?.world;
        if (id < 0 || (cur && cur !== rec.name)) { skipped++; continue; }      // gone, or the user picked another book since
        try { await ctx.writeExtensionField(id, 'world', rec.name); count++; } catch { skipped++; }
    }
    if ((rec.extra || []).length && wi?.world_info) {
        const lore = wi.world_info.charLore = Array.isArray(wi.world_info.charLore) ? wi.world_info.charLore : [];
        for (const x of rec.extra) {
            let e = lore.find(l => l?.name === x.avatar);
            if (!e) { e = { name: x.avatar, extraBooks: [] }; lore.push(e); }
            if (!e.extraBooks.includes(rec.name)) { e.extraBooks.push(rec.name); count++; }
        }
    }
    if (rec.global && wi && !wi.selected_world_info?.includes(rec.name)) {
        try { wi.onWorldInfoChange?.({ state: 'on', silent: 'true' }, rec.name); if (wi.selected_world_info.includes(rec.name)) count++; } catch { skipped++; }
    }
    if (rec.chat && (ctx.getCurrentChatId?.() || 'current') === rec.chat && !ctx.chatMetadata?.world_info) {
        ctx.chatMetadata.world_info = rec.name; await ctx.saveMetadata?.(); count++;
    }
    try { ctx.saveSettingsDebounced?.(); } catch { /* ignore */ }
    return { count, skipped };
}

/** Human summary of a record. */
export function describe(rec) {
    if (!rec) return '';
    const parts = [];
    if (rec.chars?.length) parts.push(`${rec.chars.length} 张角色卡（${rec.chars.slice(0, 4).map(c => c.name).join('、')}${rec.chars.length > 4 ? '…' : ''}）`);
    if (rec.extra?.length) parts.push(`${rec.extra.length} 张角色卡的附加世界书`);
    if (rec.global) parts.push('全局世界书');
    if (rec.chat) parts.push('当前聊天');
    return parts.join('、') || '无';
}

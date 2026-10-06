// Shared multi-person model. Viewing a person never changes the legacy active romance target.
const name = x => String(x?.姓名 || x?.名称 || '').trim();
export const realName = s => !!s && !/^(暂无|无|未绑定|未知|未记录|none)$/i.test(s);
export function bondId(world, person) { return 'person:' + encodeURIComponent(String(world || '未记录')) + ':' + encodeURIComponent(person); }
export function keepPerson(z, person, world = z.当前世界 || '未记录') {
    if (!realName(name(person))) return null;
    z.羁绊库 ||= [];
    const id = person.id || bondId(person.世界 || world, name(person)), prior = z.羁绊库.find(x => x.id === id);
    const next = { ...(prior || {}), ...structuredClone(person), id, 姓名: name(person), 世界: person.世界 || world, 关系: person.关系 || prior?.关系 || '羁绊' };
    if (prior) Object.assign(prior, next); else z.羁绊库.push(next); return next;
}
export function migrateBonds(z) {
    if (z.羁绊库 !== undefined && !Array.isArray(z.羁绊库)) throw Error('羁绊库格式异常，停止迁移，保留旧数据');
    z.羁绊库 ||= [];
    const key = z.恋爱目标?.id || bondId(z.恋爱目标?.世界 || z.当前世界, name(z.恋爱目标));
    const old = z.羁绊库.find(p => p.id === key) || keepPerson(z, z.恋爱目标); if (old && !z.当前羁绊ID) z.当前羁绊ID = old.id;
    return z;
}
export function syncBonds(next, prev) {
    if (!next) return;
    const changed = JSON.stringify(next.恋爱目标) !== JSON.stringify(prev?.恋爱目标);
    if (!changed) return;
    if (prev?.恋爱目标) keepPerson(next, prev.恋爱目标, prev.当前世界);
    const activeId = next.当前羁绊ID, active = next.羁绊库?.find(x => x.id === activeId);
    let incoming = next.恋爱目标;
    const changedWorld = !!incoming?.世界 && incoming.世界 !== active?.世界;
    if (active && realName(name(incoming)) && (name(active) !== name(incoming) || changedWorld)) {
        // Original engine edits the same object in place when binding another name; do not carry its previous ID,
        // affection, tags or world into the next person. Equal unchanged fields are ambiguous, so keep known data.
        const world = incoming.世界 && incoming.世界 !== prev?.恋爱目标?.世界 ? incoming.世界 : next.当前世界 || '未记录';
        const saved = next.羁绊库?.find(x => name(x) === name(incoming) && x.世界 === world);
        const clean = { ...(saved || {}), 姓名: name(incoming), 世界: world };
        for (const [k, v] of Object.entries(incoming)) if (!['id', '世界', '姓名', '名称'].includes(k) && JSON.stringify(v) !== JSON.stringify(prev?.恋爱目标?.[k])) clean[k] = v;
        delete clean.id; incoming = clean;
    }
    const p = keepPerson(next, active && !changedWorld && name(active) === name(incoming) ? { ...incoming, id: activeId, 世界: active.世界 } : incoming);
    if (p) { next.当前羁绊ID = p.id; next.恋爱目标 = { ...p }; }

}
/**
 * Everyone shown on the 羁绊 page: 羁绊库 + 打手. 1.1.2: chat-group members are NOT listed by default — only the ones the
 * player pulled in (聊天群 / 关系图 →「拉入羁绊」), which live in 羁绊库 with 群员ID and carry the live group data in 群内.
 * People of the current world come first.
 */
export function listBonds(z) {
    const copy = structuredClone(z || {}); migrateBonds(copy);
    const members = new Map((copy.聊天群?.成员 || []).filter(m => m?.id).map(m => [m.id, m]));
    const people = copy.羁绊库.map(p => {
        const out = { ...p, source: 'bond' };
        if (p.群员ID) { const m = members.get(p.群员ID); out.群内 = m ? { 在群: true, 好感: m.好感, 身份: m.身份 || '群员', 实力档: m.档, 特产: m.特产 } : { 在群: false }; }
        return out;
    });
    for (const [i, p] of (copy.打手 || []).entries()) if (realName(name(p))) people.push({ ...p, id: 'summon:' + (p.id || i), 姓名: name(p), 世界: p.世界 || copy.当前世界 || '未记录', 关系: '打手', source: 'summon' });
    return sortBonds(people, copy.当前世界);
}
/** Current world first (stable otherwise). Pure. */
export function sortBonds(people, world) {
    const here = p => !!world && String(p.世界 || '') === String(world);
    return people.map((p, i) => [p, i]).sort((a, b) => (here(b[0]) - here(a[0])) || a[1] - b[1]).map(x => x[0]);
}
/** The 羁绊库 entry a chat-group member was pulled into, if any. */
export const pulledEntry = (z, memberId) => (Array.isArray(z?.羁绊库) ? z.羁绊库 : []).find(p => p?.群员ID && p.群员ID === memberId) || null;
/**
 * 1.1.2「拉入羁绊」: a chat-group member becomes a 羁绊 (relation 群友, starting 好感度 = group 好感). A 羁绊库 person with
 * the same name and world is the same person — it only gains the link. Mutates `z`; returns the entry.
 */
export function pullMember(z, memberId) {
    const m = (z?.聊天群?.成员 || []).find(x => x?.id === memberId);
    if (!m || !realName(name(m))) throw Error('群里没有这个群员（可能已被踢出）');
    const prior = pulledEntry(z, memberId); if (prior) return prior;
    migrateBonds(z);
    const world = String(m.世界 || z.当前世界 || '未记录'), same = z.羁绊库.find(p => name(p) === name(m) && p.世界 === world);
    const fav = Math.max(0, Math.min(100, Math.floor(Number(m.好感 ?? 20) || 0)));
    const person = same ? { ...same, 群员ID: m.id } : { 姓名: name(m), 世界: world, 关系: '群友', 群员ID: m.id, 群员拉入: true, 好感度: fav, ...(m.性格 ? { 性格: String(m.性格) } : {}), ...(m.特产 ? { 特产: String(m.特产) } : {}) };
    return keepPerson(z, person, world);
}
/**
 * 1.1.2「移出羁绊」for a pulled group member (the group itself is untouched). An entry created by the pull is removed; a
 * person who was a 羁绊 before only loses the link. Never touches the active target. Mutates `z`.
 */
export function dropPulled(z, bondIdValue) {
    const list = Array.isArray(z?.羁绊库) ? z.羁绊库 : [], i = list.findIndex(p => p?.id === bondIdValue);
    if (i < 0) throw Error('羁绊里已经没有这个人');
    const p = list[i];
    if (!p.群员ID) throw Error('只有从聊天群拉进来的群友可以移出');
    if (z.当前羁绊ID === bondIdValue) throw Error('当前攻略目标不能移出，请先切换攻略目标');
    if (p.群员拉入) return { removed: true, person: list.splice(i, 1)[0] };
    delete p.群员ID; return { removed: false, person: p };
}

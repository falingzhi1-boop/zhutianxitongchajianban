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
export function listBonds(z) {
    const copy = structuredClone(z || {}); migrateBonds(copy);
    const people = copy.羁绊库.map(p => ({ ...p, source: 'bond' }));
    for (const [i, p] of (copy.打手 || []).entries()) if (realName(name(p))) people.push({ ...p, id: 'summon:' + (p.id || i), 姓名: name(p), 世界: p.世界 || copy.当前世界 || '未记录', 关系: '打手', source: 'summon' });
    for (const p of copy.聊天群?.成员 || []) if (realName(name(p))) people.push({ ...p, id: 'group:' + p.id, 姓名: name(p), 关系: '群员', source: 'group' });
    return people;
}

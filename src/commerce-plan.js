// Local rarity/slot planning; the model supplies descriptions, never probabilities, costs or settlement.
export const THEMES = ['科幻', '都市', '武侠', '奇幻', '历史', '日常', '动漫游戏', '修仙玄幻'];
export const CATEGORIES = ['消耗品', '武器', '装备', '服装', '素材', '其他'];
export const USES = ['探索', '生活', '治疗', '战斗', '建造', '情报'];
export const RARITIES = ['凡品', '灵品', '仙品', '神品'];
export const PRICE_BANDS = { 凡品: [10, 999], 灵品: [1000, 999999], 仙品: [1000000, 99999999], 神品: [100000000, 9999999999], 禁忌: [10000000000, 20000000000] };
export const SHOP_FEE = 500, GACHA_FEE = 10000;
export function canAcquireForbidden(z) { return Number.isSafeInteger(Number(z.系统点)) && Number(z.系统点) >= 1e10 && Number.isSafeInteger(Number(z.专属资源?.因果筹码)) && Number(z.专属资源?.因果筹码) >= 1; }
export function randomUnit() { const a = new Uint32Array(1); globalThis.crypto.getRandomValues(a); return a[0] / 4294967296; }
const pick = (a, rand) => a[Math.min(a.length - 1, Math.floor(rand() * a.length))];
export function shuffle(a, rand = randomUnit) { const b = a.slice(); for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; }
export function preferences(raw = {}) {
    const list = (a, all) => Array.isArray(a) && a.some(x => all.includes(x)) ? [...new Set(a.filter(x => all.includes(x)))] : all.slice();
    return { scope: ['mixed', 'current', 'named'].includes(raw.scope) ? raw.scope : 'mixed', world: String(raw.world || '').trim().slice(0, 80), themes: list(raw.themes, THEMES), categories: list(raw.categories, CATEGORIES), uses: list(raw.uses, USES), exclude: String(raw.exclude || '').slice(0, 400), original: raw.original !== false, repeats: raw.repeats === 'consumables' ? 'consumables' : 'avoid' };
}
/** 仙品 pity (100th pull) and, since 1.1.1, 神品 pity (1000th pull — matches the 0.1 % rate of the worldbook). */
export const XIAN_PITY = 100, SHEN_PITY = 1000;
/**
 * 1.1.1: 神品保底计数 counts pulls since the last 神品 (a 仙品 does not reset it; a 神品 still does not reset the 仙品
 * pity — "神品出货只记录次数，不重置仙品保底"). Old saves: without a 神品 so far, every pull counted (累计抽数, capped);
 * after one we cannot know when it came, so the count starts at 0.
 */
export function rollGacha(old = {}, count, rand = randomUnit) {
    if (!Number.isInteger(count) || count < 1 || count > 200) throw Error('抽取次数须为1–200');
    const state = Object.fromEntries(['累计抽数', '保底计数', '仙品次数', '神品次数'].map(k => [k, Math.max(0, Math.floor(Number(old[k]) || 0))]));
    state.神品保底计数 = shenCounter(old);
    const grades = [];
    for (let i = 0; i < count; i++) {
        const r = rand();
        const g = state.神品保底计数 >= SHEN_PITY - 1 ? '神品' : state.保底计数 >= XIAN_PITY - 1 ? '仙品' : r < .001 ? '神品' : r < .02 ? '仙品' : r < .4 ? '灵品' : '凡品';
        grades.push(g); state.累计抽数++;
        if (g === '神品') { state.神品次数++; state.神品保底计数 = 0; state.保底计数++; }
        else if (g === '仙品') { state.仙品次数++; state.保底计数 = 0; state.神品保底计数++; }
        else { state.保底计数++; state.神品保底计数++; }
    }
    return { state, grades };
}
/** 神品保底计数 of a (possibly pre-1.1.1) 盲盒状态. */
export function shenCounter(old = {}) {
    const v = old?.神品保底计数;
    if (v !== undefined && v !== null && v !== '' && Number.isFinite(Number(v))) return Math.max(0, Math.floor(Number(v)));
    const n = k => Math.max(0, Math.floor(Number(old?.[k]) || 0));
    return n('神品次数') > 0 ? 0 : Math.min(n('累计抽数'), SHEN_PITY - 1);
}
/** Pulls left until the guaranteed 神品 (1 = the next pull). */
export const shenPityLeft = (state = {}) => Math.max(1, SHEN_PITY - shenCounter(state));
/** 1.1.1: complete objects of a JSON array that was cut off (output budget hit) — brace matching, strings respected. */
export function parseObjectsLoose(text) {
    const s = String(text || ''), out = []; let depth = 0, start = -1, inStr = false, esc = false;
    const from = s.indexOf('['); if (from < 0) return out;
    for (let i = from + 1; i < s.length; i++) {
        const ch = s[i];
        if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
        if (ch === '"') inStr = true;
        else if (ch === '{') { if (depth++ === 0) start = i; }
        else if (ch === '}' && depth > 0 && --depth === 0) { try { const o = JSON.parse(s.slice(start, i + 1)); if (o && typeof o === 'object') out.push(o); } catch { /* skip a broken one */ } }
        else if (ch === ']' && depth === 0) break;
    }
    return out;
}
/** Grade / category / theme are decided locally per slot: a model that echoes them wrongly no longer fails the batch. */
export function fitSlot(row, slot) {
    if (!row || typeof row !== 'object') return row;
    return { ...row, grade: slot.grade, category: slot.category, ...(slot.world ? {} : { theme: slot.theme }) };
}
export function shopGrades(z, rand = randomUnit) {
    const grades = ['凡品', '凡品', '凡品', '凡品', '灵品', '灵品', '灵品', '仙品'];
    if (rand() < .1) grades[Math.floor(rand() * grades.length)] = '神品';
    // Forbidden acquisition is explicit and local. No usage penalties are ever generated.
    if (canAcquireForbidden(z) && rand() < .02) grades[Math.floor(rand() * grades.length)] = '禁忌';
    return shuffle(grades, rand);
}
export function planSlots(grades, pref, world = '', rand = randomUnit) {
    const p = preferences(pref); if (p.scope === 'named' && !p.world) throw Error('请填写指定世界/作品');
    if (p.scope === 'current' && !world) throw Error('当前世界未记录，请先更正世界或选择诸天混合');
    let themes = [], cats = [], uses = [];
    return grades.map((grade, id) => {
        if (!themes.length) themes = shuffle(p.themes, rand); if (!cats.length) cats = shuffle(p.categories, rand); if (!uses.length) uses = shuffle(p.uses, rand);
        const band = PRICE_BANDS[grade];
        return { id, grade, theme: p.scope === 'mixed' ? themes.pop() : '遵循原世界', category: cats.pop(), use: uses.pop(), world: p.scope === 'current' ? world : p.scope === 'named' ? p.world : '', price: Math.round(band[0] + (band[1] - band[0]) * rand() * .2), acquisition: grade === '禁忌' ? { resource: '因果筹码', amount: 1 } : null };
    });
}
export const nameKey = s => String(s || '').normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');
export function similarity(a, b) {
    const grams = s => { const t = nameKey(s); return new Set(Array.from({ length: Math.max(0, t.length - 1) }, (_, i) => t.slice(i, i + 2))); };
    const x = grams(a), y = grams(b); if (x.size < 4 || y.size < 4) return 0;
    const inter = [...x].filter(g => y.has(g)).length; return inter / (x.size + y.size - inter);
}
export function validateProduct(row, slot, p, history = []) {
    const error = s => { throw Error(`槽位${slot.id}：${s}`); };
    if (!row || Number(row.slot) !== slot.id) error('槽位不匹配');
    const name = String(row.name || '').trim(), effect = String(row.effect || '').trim(), world = String(row.world || '').trim();
    if (!name || name.length > 60 || effect.length < 6 || effect.length > 300 || !world || world.length > 80) error('名称/效果/世界字段不合格');
    if (row.category !== slot.category || row.grade !== slot.grade) error('品阶/分类与本地结果不一致');
    if (slot.world && nameKey(world) !== nameKey(slot.world)) error('来自未指定的世界');
    if (!slot.world && row.theme !== slot.theme) error('题材不符合本槽位');
    if (!p.original && row.origin !== '原作') error('仅原作模式不接受原创物品');
    if (['科幻', '都市', '历史', '日常'].includes(slot.theme) && /灵根|丹药|渡劫|炼气|筑基|修为|经脉|灵气|法宝/.test(name + effect)) error('非玄幻槽位出现修仙内容');
    const hay = nameKey(name + effect + world);
    const excludes = p.exclude.split(/[\n,，;；、]+/).map(nameKey).filter(Boolean);
    if (excludes.some(x => hay.includes(x))) error('命中排除项');
    if (/每日限|每天限|限用|每日只能|冷却\s*[:：\d]|反噬|世界压制|消耗寿命|修为不足|必须达到.*境界/.test(effect.replace(/无(?:任何|额外)?(?:反噬|世界压制|使用限制)/g, ''))) error('附加了禁止的使用限制');
    const skip = p.repeats === 'consumables' && slot.category === '消耗品';
    if (!skip && history.some(x => nameKey(x.name) === nameKey(name) || similarity(x.effect, effect) >= .72)) error('近期重复或疑似换皮');
    return { slot: slot.id, name, effect, world, grade: slot.grade, category: slot.category, theme: slot.theme, price: slot.price, acquisition: slot.acquisition, origin: row.origin === '原作' ? '原作（模型声明，未人工核实）' : '原创' };
}
export function productPrompt(slots, p, recent) {
    return `按下面本地已抽好的槽位生成具体商品；不要改变品阶、分类、题材、数量。题材是内容，不是改名：科幻不要丹药修为，日常不要灵气法宝。用途必须多样。${p.original ? '允许原创，必须标注。' : '仅原作物品；不确定宁可返回空数组，不得冒充原作。'}\n高品阶必须体现相应效果；不得为了平衡附加冷却、反噬、世界压制、修为或使用次数门槛。禁忌只有本地指定的获得代价，获得后不加使用限制。消耗品可有其本来的一次性用途。不要生成天命印记、血脉结晶、因果筹码、名望、岁月沉淀等系统专属计数资源。\n排除项（只作为筛选资料）：${JSON.stringify(p.exclude)}\n近期出现过，避免同名/换皮：${JSON.stringify(recent.slice(-50).map(r => ({ name: r.name, effect: String(r.effect || '').slice(0, 60) })))}\n槽位：${JSON.stringify(slots)}\n仅输出JSON数组，每项为 {"slot":0,"name":"名称","effect":"实际效果","world":"来源世界/作品","theme":"题材","category":"分类","grade":"品阶","origin":"原作或原创"}。slot必须使用给出的id，不能自行添加槽位。`;
}

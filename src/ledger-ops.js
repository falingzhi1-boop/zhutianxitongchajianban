// Ledger operations for terminal modules (聊天群, 自拟外挂, …).
// Same semantics as the original 3.1 helpers (adjustSysPoints / bagAdd): points never go negative, spending raises
// 累计消费, same 名称+品级 stacks. Every commit is ONE locked write through the native Bridge followed by a read-back
// check; callers show success only after `commit` resolves (the rule is: never show 已入库 before it is booked).
export const GRADES = ['凡品', '灵品', '仙品', '神品', '禁忌'];
export const TIER_PRICE = { 凡品: 100, 灵品: 1e4, 仙品: 1e7, 神品: 1e8, 禁忌: 1e10 };
// Original ZT_TIERS (神通 实力档): name, examples, price, highest grade that tier can carry.
export const TIERS = [null,
    { n: '凡人顶尖', p: 1e3, g: '凡品' }, { n: '武道宗师', p: 1e4, g: '灵品' }, { n: '超凡', p: 1e5, g: '灵品' },
    { n: '城市级', p: 1e6, g: '仙品' }, { n: '国家/大陆级', p: 1e7, g: '仙品' }, { n: '行星级', p: 1e8, g: '神品' },
    { n: '星系级以上', p: 1e9, g: '神品' }, { n: '概念/全能', p: 1e11, g: '禁忌' }];
const num = (x, d = 0) => { const n = Number(x); return Number.isFinite(n) ? n : d; };

/** Original ztShopLevel (商城等级 1–5) from a ledger object. */
export function shopLevel(z) {
    if (!z || typeof z !== 'object') return 1;
    const r = z.专属资源 && typeof z.专属资源 === 'object' ? z.专属资源 : {};
    const pts = num(z.系统点), spent = Math.max(num(z.累计消费), pts), fame = num(r.名望), fate = num(r.天命印记);
    let s = 1;
    if (spent >= 1e5 || fame >= 1e3) s = 2;
    if (spent >= 1e7 || fame >= 1e4) s = 3;
    if (fate >= 3 && spent >= 1e8) s = 4;
    if (pts >= 1e10) s = 5;
    s = Math.max(s, Math.floor(num(z.商城等级下限)), Math.floor(num(z.商城等级)));
    return Math.max(1, Math.min(5, s));
}
export const gradeIndex = g => GRADES.indexOf(g);
/** Highest grade allowed for something a group member hands over: ≤ shop level, ≤ member tier, never 禁忌. */
export function giftCap(z, tier) {
    const byShop = Math.min(shopLevel(z), 5) - 1;
    const byTier = gradeIndex((TIERS[Math.max(1, Math.min(8, tier | 0))] || TIERS[1]).g);
    return GRADES[Math.max(0, Math.min(byShop, byTier, 3))];
}
/** Clamp a grade down to the cap (auto-downgrade instead of refusing). Returns [grade, downgraded]. */
export function clampGrade(g, cap) {
    const i = gradeIndex(g), c = gradeIndex(cap);
    if (i < 0) return ['凡品', false];
    return i > c ? [cap, true] : [g, false];
}

export function ensureLedger(v) {
    const z = v.诸天系统; if (!z || typeof z !== 'object') throw Error('当前聊天没有诸天账本，先在「设置 → 新聊天初始化」创建。');
    return z;
}
export function spend(z, amount) {
    const a = Math.floor(num(amount)); if (a <= 0) return;
    const have = num(z.系统点);
    if (have < a) throw Error(`系统点不足：需要 ${a.toLocaleString('zh-CN')}，现有 ${have.toLocaleString('zh-CN')}。未扣费。`);
    z.系统点 = Math.floor(have - a); z.累计消费 = num(z.累计消费) + a; z.界面记账时间 = Date.now();
}
export function earn(z, amount) {
    const a = Math.floor(num(amount)); if (a <= 0) return;
    z.系统点 = Math.floor(num(z.系统点) + a); z.界面记账时间 = Date.now();
}
export function bagAdd(z, item, n = 1) {
    const q = Math.max(1, Math.floor(num(n, 1)));
    const bag = Array.isArray(z.背包) ? z.背包 : (z.背包 = []);
    const key = (item.名称 || '') + '|' + (item.品级 || '');
    const hit = bag.find(x => (x.名称 || '') + '|' + (x.品级 || '') === key);
    if (hit) { hit.数量 = num(hit.数量, 1) + q; for (const k of ['价格', '来源', '分类', '效果']) if (!hit[k] && item[k]) hit[k] = item[k]; }
    else bag.push({ 名称: item.名称, 品级: item.品级 || '凡品', 来源: item.来源 || '', 价格: item.价格 || 0, 分类: item.分类 || '其他', 效果: item.效果 || '', 数量: q });
}
/** Removes n of bag[index]; returns the removed item snapshot. */
export function bagTake(z, index, n = 1) {
    const bag = Array.isArray(z.背包) ? z.背包 : [];
    const it = bag[index]; if (!it) throw Error('背包里没有这件物品了。');
    const q = Math.max(1, Math.floor(num(n, 1))), have = Math.max(1, num(it.数量, 1));
    if (have < q) throw Error(`「${it.名称}」只有 ${have} 个。`);
    if (have === q) bag.splice(index, 1); else it.数量 = have - q;
    return { ...it, 数量: q };
}

/**
 * One locked write + read-back. `mutate(v, z)` changes the chat variables (throw to abort, nothing is written);
 * its return value is kept as `result`. `probe(z)` must return the same JSON before (inside the write) and after
 * (read back) — e.g. the new point balance and a receipt id — otherwise the commit is reported as not booked.
 */
export async function commit(bridge, mutate, probe = z => [z.系统点, z.界面记账时间]) {
    let result, want;
    await bridge.updateVariablesWith(v => {
        const z = ensureLedger(v);
        result = mutate(v, z);
        z.商城等级 = shopLevel(z);           // keep the derived field in step, like the original ztDerive does
        want = JSON.stringify(probe(z));
        return v;
    }, { type: 'chat' });
    const back = bridge.getVariables({ type: 'chat' })?.诸天系统;
    if (!back || JSON.stringify(probe(back)) !== want) throw Error('账本读回不一致：这次操作没有确认入账。请到「设置 → 账本回滚」核对。');
    return result;
}

import { SHOP_RULE, STORY_RULE, BOND_RULE } from './commerce-rules.js';
// 诸天 worldbook as installed by this extension (0.8.1; 0.8.4 强力模块 defaults).
// The 35 original v1.1 entries stay byte-for-byte in vendor/original (provenance-checked); this file only applies the
// small native corrections on top when the book is built, and adds the entries for features the original never had.
// Patches are exact text replacements: if a replaced text is missing (an edited copy), that patch is skipped, never guessed.
export const WORLDBOOK_REV = '1.1.1';

/** 0.8.4 强力模块: worldbook entries the user can switch from 外挂管理 (book-wide). `def` = state in a NEW install;
 *  神豪挥霍 and 诸天打手 are constant (injected every turn) in v1.1 and dominate the economy/fights, so they start off.
 *  An existing book is never changed automatically — 外挂管理 shows the recommendation and a one-click button. */
export const BALANCE_MODULES = Object.freeze([
    { name: '神豪挥霍', comment: '08｜核心｜神豪挥霍', def: false, strong: true, desc: '常驻注入：无限财富、消费返利、金钱降维打击；会让系统点 / 物价失去意义' },
    { name: '诸天打手', comment: '13｜外挂｜诸天打手', def: false, strong: true, desc: '常驻注入：随时召唤强力打手代打' },
    { name: '现实状态改写', comment: '20｜成长｜现实状态改写', def: true, strong: true, desc: '关键词触发：直接改写现实状态' },
    { name: '言灵改字', comment: '21｜成长｜言灵改字', def: true, strong: true, desc: '关键词触发：改字即成真' },
    { name: '系统点万用', comment: '10｜商城｜系统点万用', def: true, desc: '关键词触发：兜底许愿（溢价）' },
    { name: '本源复刻·图鉴复刻', comment: '19｜成长｜本源复刻·图鉴复刻', def: true, desc: '关键词触发：复刻他人能力' },
]);
export const DEFAULT_OFF = BALANCE_MODULES.filter(m => !m.def).map(m => m.comment);
/** Pure: {comment → on} from a loaded book (null = entry missing). */
export function moduleStates(book) {
    const list = Object.values(book?.entries || {});
    return BALANCE_MODULES.map(m => { const e = list.find(x => x?.comment === m.comment); return { ...m, exists: !!e, on: e ? !e.disable : null }; });
}
/** Pure: the book with the given modules switched ({comment: on}); other entries untouched. */
export function applyModules(book, want) {
    const out = structuredClone(book || { entries: {} }); let changed = 0;
    for (const e of Object.values(out.entries || {})) if (e && Object.prototype.hasOwnProperty.call(want, e.comment)) { const dis = !want[e.comment]; if (!!e.disable !== dis) { e.disable = dis; changed++; } }
    return { book: out, changed };
}

const PATCHES = [
    { comment: '05｜核心｜状态栏规则补充',
      from: '状态栏底部 ◆ 连点五次打开，',
      to: '在诸天终端「设置 → 高级 · 管理员 → 管理员控制台」打开（终端里不再有 ◆ 连点入口），' },
    { comment: '05｜核心｜状态栏规则补充',
      from: '会被替换成真实数值（需要酒馆助手）。',
      to: '会被替换成真实数值（本插件原生支持，不需要酒馆助手）。' },
    // 1.1.1: 神品 pity — the 1000th pull without a 神品 is a 神品 (matches the 0.1 % rate); 仙品 pity unchanged
    { comment: '11｜商城｜万界盲盒', since: '1.1.1',
      from: '神品次数}} 次（不重置保底）\n',
      to: '神品次数}} 次（不重置仙品保底）\n- 神品保底进度：{{get_chat_variable::诸天系统.盲盒状态.神品保底计数}}/1000（满1000必出神品；1.1.1 前的存档在下一次抽取时补算）\n' },
    { comment: '11｜商城｜万界盲盒', since: '1.1.1',
      from: '神品出货只记录次数，不重置仙品保底。禁忌品阶绝对不可通过盲盒抽出。',
      to: '神品出货不重置仙品保底；连续 1000 抽没有出神品时，第 1000 抽必出神品（神品保底重置，仙品保底照常累计）。禁忌品阶绝对不可通过盲盒抽出。' },
];

const GROUP_RULE = `<rule_setting_simple>
rule_name: 诸天聊天群（插件 · 与正文衔接）
version: 1
rule_type: 显性规则

- 宿主拥有跨世界的「诸天聊天群」，它是宿主意识里的系统界面，外人看不见。群员身处各自的世界，只能通过聊天群交流、发红包、赠礼、集市交易；群员本人只有在「群员降临」时才会来到宿主身边。
- 上下文里的【诸天聊天群】【聊天群 · 真实入库记录】由插件按真实账本生成。记录里的东西确实已经进了宿主的系统背包，来历就是聊天群（经系统空间送达）。正文里宿主拿出、使用或提起这些东西时必须保持这个来历，不得改写成捡到、买到、当面赠送、宗门发放等。
- 剧情可以自然衔接聊天群（宿主瞥一眼群消息、向身边人含糊带过来历、提起某位群友），但不要替群员编造没有记录的群聊、红包或赠礼，也不要在数据块里为聊天群得到的东西重复加系统点或背包。
- 聊天群的入账已由插件记账；数据块只写本轮剧情里新发生的变化。
</rule_setting_simple>`;

/** Entries added by the extension, appended after the originals (uid continues from the last original). */
function extraEntries(base) {
    const tpl = base.find(r => r.comment === '35｜核心｜独立记忆辅助边界') || base[base.length - 1] || {};
    return [{ ...structuredClone(tpl), comment: '36｜联动｜诸天聊天群（插件）', content: GROUP_RULE, key: ['聊天群', '群员', '红包', '赠礼', '降临'],
        constant: true, order: 110, position: 4, depth: 2, role: 0, disable: false }];
}

/** Original rules → the worldbook entries this version installs. Returns { rules, applied, skipped }.
 *  `previous` = without this version's own patches (what an unmodified older install contains; not a customization). */
export function latestRules(original, { legacy = false, previous = false } = {}) {
    const rules = structuredClone(Array.isArray(original) ? original : []), applied = [], skipped = [];
    for (const p of PATCHES) {
        if (previous && p.since === WORLDBOOK_REV) continue;   // the book as the previous version installed it
        const r = rules.find(x => x.comment === p.comment);
        if (r && typeof r.content === 'string' && r.content.includes(p.from)) { r.content = r.content.replace(p.from, p.to); applied.push(p.from); }
        else skipped.push(p.from);
    }
    const have = new Set(rules.map(r => r.comment));
    for (const e of extraEntries(rules)) if (!have.has(e.comment)) rules.push(e);
    for (const r of rules) if (DEFAULT_OFF.includes(r.comment)) r.disable = true;   // 0.8.4: new installs start balanced
    if (!legacy) for (const r of rules) {
        if (r.comment === '09｜商城｜系统商城') r.content = SHOP_RULE;
        if (r.comment === '05｜核心｜状态栏规则补充') r.content = r.content.replace('</rule_setting_simple>', STORY_RULE + '\n</rule_setting_simple>');
        if (r.comment === '29｜情感｜恋爱攻略') r.content = r.content.replace('</rule_setting_simple>', BOND_RULE + '\n</rule_setting_simple>');
        if (r.comment === '11｜商城｜万界盲盒') r.content = r.content.replace('</rule_setting_simple>', '\n商品内容遵循商品定制并近期避重；不要重抽本地已确定的品阶。不为平衡添加使用限制。只在用户主动发送摘要时衔接剧情，不要求发送全部抽奖日志。\n</rule_setting_simple>');
    }
    rules.forEach((r, i) => { r.uid = i; r.displayIndex = i; });
    return { rules, applied, skipped };
}

/** Merge for「更新到最新版」: built-in entries (matched by comment) are replaced with the latest text; every other entry
 *  (added by the user, or renamed in an older copy) is kept after them and counted; the user's on/off choice of a built-in entry is kept. */
export function mergeWorldbook(existing, latest) {
    const old = Object.values(existing?.entries || {});
    const byComment = new Map();
    for (const e of old) if (!byComment.has(e.comment)) byComment.set(e.comment, e);
    const ours = new Set(latest.map(r => r.comment));
    const out = latest.map(r => { const prev = byComment.get(r.comment); return prev ? { ...structuredClone(r), ...structuredClone(prev), content: r.content, comment: r.comment, disable: !!prev.disable } : structuredClone(r); });
    const kept = old.filter(e => !ours.has(e.comment) || byComment.get(e.comment) !== e);   // never silently dropped; reported so the user can review
    const entries = {};
    [...out, ...kept.map(e => structuredClone(e))].forEach((e, i) => { entries[i] = { ...e, uid: i, displayIndex: i }; });
    return { book: { ...structuredClone(existing), entries }, replaced: out.filter(r => byComment.has(r.comment)).length, added: out.filter(r => !byComment.has(r.comment)).length, kept: kept.length };
}

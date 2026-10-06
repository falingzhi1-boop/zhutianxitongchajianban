// 修行 · 熟练度 (0.8.0): makes the original 功法 mastery system matter in play, and reads 功法 from other character cards.
//
//  1. 功法实效 — every turn the model is told what each skill's CURRENT stage actually does (the original stage rewards:
//     熟练 = 消耗 −30%, 精通 = 威力 +100%, 宗师 = 专属奥义, 入道 = 无消耗瞬发) and that a skill below 入门 is unreliable.
//     Before, the stage was only a word in 实时数据; the effects lived in the UI tooltip and the model never saw them.
//  2. 实战积累 — when the newest AI floor (already settled by the original engine) shows the host actually using a library
//     skill in the story but its 功法修炼 line forgot it, a small grade-based amount is added (凡品 3 · 灵品 2 · 仙品/神品 1,
//     at most 2 skills per floor, once per floor + panel hash). Stage-ups go to the original 功法待播报 queue, so the
//     model announces them and settles them with 结算: like any other breakthrough. The gain is written after the floor's
//     snapshot, so a swipe (engine restores the snapshot) removes it together with the old reply — no double counting.
//  3. 角色卡功法 — 功法 / 技能 / 武学 … variables of the current card (chat variables of other scripts, MVU stat_data of
//     the newest message, Tavern Helper character variables) are listed with their source path and can be imported into
//     the 功法库: new skills are added, existing ones only ever go UP (熟练度 / 品阶), never down. The card's own variables
//     are never written. Each import is recorded in 功法记录 and in 诸天系统.角色卡功法同步.
//
// Every write goes through ledger-ops commit (write → read back); the derived fields (功法 mirror, 实时数据) are rebuilt
// with the original ztDerive from the engine frame when it is available.
import { STORAGE, inert } from './contracts.js';
import * as L from './ledger-ops.js';
import { esc, fmtNum } from './hub.js';
import { stripPanels } from './panel-guard.js';

export const STAGES = ['未入门', '入门', '熟练', '精通', '宗师', '入道'];
export const STAGE_AT = Object.freeze({ 入门: 100, 熟练: 500, 精通: 2000, 宗师: 10000 });
export const GRADE_CAP = Object.freeze({ 凡品: 100, 灵品: 500, 仙品: 2000, 神品: 10000, 禁忌: 10000 });
const GRADE_ORDER = ['凡品', '灵品', '仙品', '神品', '禁忌'];
/** Original ZT_STAGE_REWARD texts (statusbar 3.1), plus the 未入门 baseline. */
export const STAGE_EFFECT = Object.freeze({
    未入门: '尚未入门：施展生涩，威力不稳定，可能失败',
    入门: '掌握基础动作与原理',
    熟练: '该技能体能/法力消耗永久降低30%',
    精通: '获得微小法则感悟，技能威力提升100%',
    宗师: '技能本质蜕变，可衍生专属奥义或特殊效果',
    入道: '化为本能法则，无消耗瞬发，并一次性奖励海量系统点',
});
export const PRACTICE_GAIN = Object.freeze({ 凡品: 3, 灵品: 2, 仙品: 1, 神品: 1, 禁忌: 1 });
const PRACTICE_MAX = 2;
const num = (x, d = 0) => { const n = Number(String(x ?? '').replace(/[,，\s]/g, '')); return Number.isFinite(n) ? n : d; };

// ---------- pure helpers (same rules as the original engine) ----------
export const normName = t => String(t || '').replace(/[（(【\[〔][^）)】\]〕]*[）)】\]〕]/g, '').replace(/[「」《》“”"'\s]/g, '').trim();
export const normGrade = t => { t = String(t || ''); return t.includes('禁') ? '禁忌' : t.includes('神') ? '神品' : t.includes('仙') ? '仙品' : t.includes('灵') ? '灵品' : t.includes('凡') ? '凡品' : ''; };
/** Lowest grade whose cap holds this mastery (card skills without a grade). */
export const gradeFor = m => m <= 100 ? '凡品' : m <= 500 ? '灵品' : m <= 2000 ? '仙品' : '神品';
export const gradeOfCap = c => c >= 1e4 ? '神品' : c >= 2e3 ? '仙品' : c >= 500 ? '灵品' : '凡品';
/** Normalised copy of a 功法库 entry (the original ztFixSkill, without mutating the input). */
export function fixSkill(s) {
    const o = { ...(s || {}) };
    o.名称 = String(o.名称 || '无名功法').trim();
    const cap = Math.floor(num(o.上限, 0)), g = normGrade(o.品阶) || (cap ? gradeOfCap(cap) : '凡品');
    o.品阶 = g; o.上限 = cap > 0 ? cap : GRADE_CAP[g]; o.熟练度 = Math.max(0, Math.floor(num(o.熟练度, 0)));
    return o;
}
export function stageOf(s) {
    if (!s) return '未入门'; if (s.入道) return '入道';
    const m = Math.min(num(s.熟练度), 1e4);
    return m >= 1e4 ? '宗师' : m >= 2e3 ? '精通' : m >= 500 ? '熟练' : m >= 100 ? '入门' : '未入门';
}
export function nextTarget(s) {
    const t = { 未入门: 100, 入门: 500, 熟练: 2000, 精通: 10000 }[stageOf(s)];
    return t && t <= num(s.上限, 100) ? t : null;
}
/** Effects that are in force for this skill now (cumulative up to its stage). */
export function effectsOf(s) {
    const st = stageOf(s), i = STAGES.indexOf(st);
    if (i <= 0) return [STAGE_EFFECT.未入门];
    return STAGES.slice(1, i + 1).map(k => STAGE_EFFECT[k].replace(/，并一次性奖励海量系统点$/, ''));
}
/** 功法实效 prompt (pure). Main skill first, at most 12. */
export function masteryPrompt(z) {
    const lib = (Array.isArray(z?.功法库) ? z.功法库 : []).map(fixSkill);
    if (!lib.length) return '';
    const main = normName(z?.功法?.名称);
    lib.sort((a, b) => (normName(b.名称) === main) - (normName(a.名称) === main));
    const lines = ['【诸天系统 · 功法实效】以下效果已由系统结算并真实生效。正文中宿主施展这些功法时必须体现对应阶段的效果，不得超出当前阶段；未入门的功法施展不稳定。'];
    for (const s of lib.slice(0, 12)) {
        const st = stageOf(s), nx = nextTarget(s), full = !s.入道 && s.熟练度 >= s.上限;
        lines.push(`- ${s.名称}〔${s.品阶}〕${s.熟练度}/${s.上限}【${st}${full ? '·圆满' : ''}】：${effectsOf(s).join('；')}${nx ? `（下一阶段「${STAGES[STAGES.indexOf(st) + 1]}」需 ${nx}）` : full ? '（已达本品上限，需升品或冲击入道）' : ''}`);
    }
    if (lib.length > 12) lines.push(`- ……另有 ${lib.length - 12} 部功法，效果同上规则。`);
    lines.push('宿主在正文中实际施展、苦练或领悟某门功法时，在数据块「功法修炼」写「功法名+N(原因)」：日常施展 1–5，苦练 5–20，生死搏杀或顿悟 20–100；没用到就不写。漏记的实战使用系统会自动补记少量熟练度。');
    return lines.join('\n');
}
/** Panel field 功法修炼 (pure; same field syntax as the original ztParsePanel). */
export function panelField(panel, key) {
    let cur = null; const out = {};
    for (const line of String(panel || '').replace(/\r/g, '').split('\n')) {
        const m = line.match(/^\s*[-*•]?\s*([\u4e00-\u9fa5]{2,4})\s*[:：]\s*(.*)$/);
        if (m) { cur = m[1]; out[cur] = m[2].trim(); } else if (cur && line.trim()) out[cur] += '\n' + line.trim();
    }
    return out[key] ?? '';
}
/** Story text of a floor without data blocks, tags and code. */
export function storyText(mes) {
    return stripPanels(mes).replace(/<(style|script)[\s\S]*?<\/\1>/gi, ' ').replace(/```[\s\S]*?```/g, ' ').replace(/<[^>]+>/g, ' ');
}
/** 实战积累 candidates (pure). Returns [{name, gain, before, after, from, to}] — nothing when the panel already handled it. */
export function practiceGains(z, story, practiceLine, max = PRACTICE_MAX) {
    const lib = (Array.isArray(z?.功法库) ? z.功法库 : []).map(fixSkill);
    const text = String(story || ''), handled = String(practiceLine || '');
    const main = normName(z?.功法?.名称), out = [];
    const order = lib.map((s, i) => ({ s, i })).sort((a, b) => (normName(b.s.名称) === main) - (normName(a.s.名称) === main));
    for (const { s } of order) {
        if (out.length >= max) break;
        const n = normName(s.名称); if (n.length < 2 || s.入道 || s.熟练度 >= s.上限) continue;
        if (!text.includes(n) || handled.includes(n)) continue;
        const gain = Math.min(PRACTICE_GAIN[s.品阶] || 1, s.上限 - s.熟练度); if (gain <= 0) continue;
        const after = { ...s, 熟练度: s.熟练度 + gain };
        out.push({ name: s.名称, gain, before: s.熟练度, after: after.熟练度, from: stageOf(s), to: stageOf(after), cap: s.上限 });
    }
    return out;
}

const practiced = (z, mark) => (Array.isArray(z?.功法记录) ? z.功法记录 : []).some(r => r?.凭据 === mark);
/** 实战积累 entries of 功法记录 as {名称, 增加, 楼层, 时间}. */
export const practiceLog = z => (Array.isArray(z?.功法记录) ? z.功法记录 : []).filter(r => /实战积累/.test(String(r?.变化 || ''))).map(r => ({ 名称: r.名称, 增加: num(String(r.变化).match(/\+(\d+)/)?.[1]), 楼层: r.楼层 ?? '?', 时间: r.时间 }));

// ---------- 角色卡功法 (pure) ----------
const SKILL_KEY = /功法|技能|武技|武学|法术|神通|秘籍|招式|心法|绝学|^skills?$|^abilities$|^spells?$/i;
const NAME_KEYS = ['名称', '名字', '功法名', '技能名', '名', 'name', 'title'];
const MASTERY_KEYS = ['熟练度', '熟练', '进度', '经验', '修炼进度', 'proficiency', 'mastery', 'exp'];
const STAGE_KEYS = ['境界', '阶段', '层次', '火候', '程度', 'stage', 'level', '等级'];
const GRADE_KEYS = ['品阶', '品级', '品质', '等阶', '品', 'grade', 'rank', 'tier'];
const DESC_KEYS = ['描述', '效果', '说明', '简介', 'desc', 'description', 'effect'];
const STAGE_WORDS = [[/入道|化境|返璞归真/, 10000], [/宗师|圆满|大圆满|登峰造极|出神入化/, 10000], [/精通|大成|炉火纯青/, 2000], [/熟练|小成|得心应手/, 500], [/入门|初学|初窥门径|略懂/, 100], [/未入门|未学/, 0]];
const pick = (o, keys) => { for (const k of keys) for (const kk of Object.keys(o)) if (kk.toLowerCase() === k.toLowerCase() && o[kk] != null && o[kk] !== '') return unwrap(o[kk]); return undefined; };
/** MVU stores [value, description] pairs. */
const looksDesc = s => /[。：:，,；;！!？?\s]/.test(s) || s.length > 12;
// ['轻功', '暗器'] is a two-skill list, ['太极拳', '武当派入门拳法，……'] and [35, '基础'] are MVU pairs
const unwrap = v => Array.isArray(v) && v.length === 2 && typeof v[1] === 'string' && !Array.isArray(v[0]) && (typeof v[0] !== 'string' || looksDesc(v[1])) ? v[0] : v;
function masteryFrom(m, stage) {
    if (m != null && m !== '') {
        const s = String(m), frac = s.match(/^\s*(\d[\d,]*)\s*\/\s*(\d[\d,]*)\s*$/);
        if (frac) return num(frac[1]);
        if (/^\s*-?[\d,.]+\s*%?\s*$/.test(s)) return Math.max(0, Math.floor(num(s.replace('%', ''))));
        for (const [re, v] of STAGE_WORDS) if (re.test(s)) return v;
    }
    if (stage != null) { const s = String(stage); for (const [re, v] of STAGE_WORDS) if (re.test(s)) return v; }
    return null;
}
function skillFrom(o, name, path) {
    const nm = inert(String(name ?? pick(o, NAME_KEYS) ?? '')).trim().slice(0, 30); if (!normName(nm)) return null;
    const stage = pick(o, STAGE_KEYS), m = masteryFrom(pick(o, MASTERY_KEYS), stage);
    const g = normGrade(pick(o, GRADE_KEYS)) || '';
    return { 名称: nm, 熟练度: m, 品阶: g, 描述: inert(String(pick(o, DESC_KEYS) ?? '')).trim().slice(0, 80), path };
}
function parseContainer(v, path, out) {
    v = unwrap(v);
    if (typeof v === 'string') { v.split(/[、,，;；\n|｜]+/).map(x => x.trim()).filter(Boolean).slice(0, 40).forEach(x => { const m = x.match(/^(.+?)\s*[〔（(【\[]([^〕）)】\]]*)[〕）)】\]]\s*(.*)$/); const s = skillFrom(m ? { 品阶: m[2], 境界: m[2], 熟练度: m[3] || undefined } : {}, m ? m[1] : x, path); if (s) out.push(s); }); return; }
    if (Array.isArray(v)) { v.slice(0, 60).forEach((it, i) => { it = unwrap(it); if (typeof it === 'string') parseContainer(it, `${path}[${i}]`, out); else if (it && typeof it === 'object') { const s = skillFrom(it, undefined, `${path}[${i}]`); if (s) out.push(s); } }); return; }
    if (!v || typeof v !== 'object') return;
    if (pick(v, NAME_KEYS) !== undefined) { const s = skillFrom(v, undefined, path); if (s) out.push(s); return; }
    for (const [k, raw] of Object.entries(v).slice(0, 60)) {
        if (k.startsWith('$') || k.startsWith('_')) continue;
        const it = unwrap(raw), p = `${path}.${k}`;
        if (it && typeof it === 'object' && !Array.isArray(it)) { const s = skillFrom(it, k, p); if (s) out.push(s); }
        else if (typeof it === 'number' || typeof it === 'string') { const s = skillFrom(typeof it === 'number' ? { 熟练度: it } : /^\s*[\d,./%\s]+$/.test(it) ? { 熟练度: it } : { 境界: it, 品阶: it, 描述: it }, k, p); if (s) out.push(s); }
    }
}
/** Walks any variable tree (depth ≤ 6) and returns the skill entries found under 功法-like keys. */
export function scanSkills(tree, root = '') {
    const out = [], seen = new Set();
    const walk = (o, path, depth) => {
        if (!o || typeof o !== 'object' || depth > 6 || seen.has(o)) return; seen.add(o);
        for (const [k, raw] of Object.entries(o).slice(0, 200)) {
            const p = path ? `${path}.${k}` : k, v = unwrap(raw);
            if (SKILL_KEY.test(k) && !/记录|待播报|日志|log|冷却|cd$/i.test(k)) parseContainer(v, p, out);
            else if (v && typeof v === 'object') walk(v, p, depth + 1);
        }
    };
    walk(tree, root, 0);
    // one entry per name (the first source wins; a later one only fills a missing 熟练度 / 品阶)
    const by = new Map();
    for (const s of out) { const n = normName(s.名称); const had = by.get(n); if (!had) by.set(n, s); else { if (had.熟练度 == null && s.熟练度 != null) had.熟练度 = s.熟练度; if (!had.品阶 && s.品阶) had.品阶 = s.品阶; } }
    return [...by.values()];
}
/** Merge card skills into a 功法库 copy: add new, raise only. Returns { lib, changes:[{name, kind, from, to}] }. */
export function mergeSkills(libIn, items, source = '角色卡') {
    const lib = (Array.isArray(libIn) ? libIn : []).map(s => ({ ...s })), changes = [];
    for (const it of items) {
        const n = normName(it.名称); if (!n) continue;
        const m = it.熟练度 == null ? null : Math.max(0, Math.floor(num(it.熟练度)));
        const g = it.品阶 || (m != null ? gradeFor(m) : '');
        const hit = lib.find(s => normName(s.名称) === n);
        if (!hit) {
            const grade = g || '凡品', cap = GRADE_CAP[grade];
            const s = { 名称: n, 品阶: grade, 上限: cap, 熟练度: Math.min(cap, m ?? 0), 来源: source };
            if (it.描述) s.描述 = it.描述;
            lib.push(s); changes.push({ name: n, kind: '收录', to: `${grade} ${s.熟练度}/${cap}` }); continue;
        }
        const cur = fixSkill(hit);
        if (g && GRADE_ORDER.indexOf(g) > GRADE_ORDER.indexOf(cur.品阶)) { const before = cur.品阶; hit.品阶 = g; hit.上限 = Math.max(cur.上限, GRADE_CAP[g]); changes.push({ name: cur.名称, kind: '升品', from: before, to: g }); }
        const cap = Math.max(num(hit.上限, cur.上限), cur.上限);
        if (m != null && m > cur.熟练度) { const to = Math.min(cap, m); if (to > cur.熟练度) { hit.熟练度 = to; changes.push({ name: cur.名称, kind: '熟练度', from: cur.熟练度, to }); } }
    }
    return { lib, changes };
}

// ---------- runtime ----------
export class SkillSync {
    constructor(app) { this.app = app; this.disposers = []; this.timer = 0; this.cardTimer = 0; this.lastPrompt = null; }
    get settings() { return this.app.settings; }
    get cfg() { return { prompt: true, practice: true, cardAuto: false, ...(this.settings.get('skills') || {}) }; }
    get ctx() { return this.app.adapter.context(); }
    ledger() { try { const z = this.app.bridge.getVariables({ type: 'chat' })?.诸天系统; return z && typeof z === 'object' ? z : null; } catch { return null; } }
    start() {
        const hub = this.app.hub;
        if (hub) {
            hub.register('skills', { title: '修行 · 熟练度', render: el => this.render(el) });
            hub.hook('onEngineTab', (n, tools) => this.strip(n, tools));
            hub.hook('onEngineView', () => this.schedulePractice());
            hub.hook('onTop', () => { if (hub.engineTab === 4 && hub.page === 'cult') this.refreshStrip(); });
        }
        this.app.hubSettings?.addSection({ title: '修行 · 熟练度', sub: '让熟练度真正影响剧情。', items: [
            { type: 'switch', k: 'skills.prompt', label: '告诉 AI 每门功法当前阶段的真实效果', desc: '熟练：消耗 −30%；精通：威力 +100%；宗师：专属奥义；入道：无消耗瞬发。未入门施展不稳定。' },
            { type: 'switch', k: 'skills.practice', label: '实战积累：正文用了功法但数据块漏记时自动补记少量熟练度', desc: '凡品 +3 · 灵品 +2 · 仙品 / 神品 +1，每层最多 2 部；重新生成（换页）时随旧回复一起撤销。' },
            { type: 'switch', k: 'skills.cardAuto', label: '角色卡功法自动同步（只升不降）', desc: '关闭时可在「修行」页手动导入。不会改写角色卡自己的变量。' },
        ] });
        this.disposers.push(this.app.bridge.onChange(() => { this.syncPrompt(); this.scheduleCard(); }));
        this.disposers.push(this.app.adapter.subscribe(() => { this.syncPrompt(); this.scheduleCard(); }));
        this.disposers.push(this.settings.onChange(k => { if (k === 'skills') { this.lastPrompt = null; this.syncPrompt(); this.scheduleCard(); } }));
        this.syncPrompt();
        return this;
    }
    // ---------- 1. 功法实效 ----------
    syncPrompt() {
        try {
            const z = this.app.adapter.currentIdentity() ? this.ledger() : null;
            const text = z && this.cfg.prompt ? masteryPrompt(z) : '';
            // 1.0: SillyTavern empties its extension prompts when a chat is (re)loaded — compare with what is really there
            const live = this.app.bridge.livePrompt?.('mastery') ?? text;
            if (text === this.lastPrompt && live === text) return; this.lastPrompt = text;
            if (text) this.app.bridge.injectPrompts([{ id: 'mastery', content: text, position: 'in_chat', depth: 4, role: 'system' }]);
            else this.app.bridge.uninjectPrompts(['mastery']);
        } catch (e) { console.warn('[诸天修行] 注入失败', e); }
    }
    // ---------- 2. 实战积累 ----------
    schedulePractice() { clearTimeout(this.timer); this.timer = setTimeout(() => this.practice().catch(e => console.warn('[诸天修行] 实战积累未记录', e)), 400); }
    /** The original ztDerive from the engine frame (rebuilds 功法 mirror, 当前熟练度 …, 实时数据). */
    derive() { try { const f = this.app.hub?.engineFrame?.contentWindow?.ztDerive; return typeof f === 'function' ? f : null; } catch { return null; } }
    async practice() {
        if (!this.cfg.practice || this.busy) return;
        const a = this.app.adapter, sb = this.app.statusbar;
        if (!a.currentIdentity() || a.isGenerating() || (sb?.state?.mode || 'terminal') !== 'terminal') return;
        const lp = sb?.latestPanel?.(); const chat = this.ctx.chat || [];
        if (!lp || lp.id !== chat.length - 1) return;                      // only the newest floor, and only an AI floor with a block
        const z = this.ledger(); const rec = z?.面板账本?.[String(lp.id)];
        if (!z || !rec?.h) return;                                         // the engine has not settled this floor yet
        // The receipt lives in 功法记录 (a snapshot key): when a swipe restores the floor snapshot, the receipt goes with
        // the old gain, and the new reply is judged again.
        const mark = `${lp.id}:${rec.h}`; if (practiced(z, mark) || this.lastMark === `${a.currentIdentity()}|${mark}`) return;
        const gains = practiceGains(z, storyText(chat[lp.id]?.mes), panelField(lp.panel, '功法修炼'));
        if (!gains.length) { this.lastMark = `${a.currentIdentity()}|${mark}`; return; }   // nothing to add: no ledger write
        this.busy = true;
        try {
            const derive = this.derive();
            const out = await L.commit(this.app.bridge, (v, zz) => {
                if (practiced(zz, mark) || String(zz.面板账本?.[String(lp.id)]?.h || '') !== String(rec.h)) return [];
                const lib = Array.isArray(zz.功法库) ? zz.功法库 : (zz.功法库 = []);
                const done = [];
                for (const g of gains) {
                    const s = lib.find(x => normName(x?.名称) === normName(g.name)); if (!s) continue;
                    const f = fixSkill(s); if (f.熟练度 !== g.before) continue;   // changed meanwhile: skip this one
                    s.熟练度 = g.after;
                    const log = Array.isArray(zz.功法记录) ? zz.功法记录 : (zz.功法记录 = []);
                    log.push({ 名称: f.名称, 变化: `+${g.gain}(实战积累)`, 时间: Date.now(), 楼层: lp.id, 凭据: mark }); while (log.length > 30) log.shift();
                    const pend = Array.isArray(zz.功法待播报) ? zz.功法待播报 : (zz.功法待播报 = []);
                    if (g.to !== g.from) pend.push({ 名称: f.名称, 阶段: g.to, 奖励: STAGE_EFFECT[g.to] || '', 楼层: lp.id });
                    if (g.after >= f.上限 && !s.圆满) { s.圆满 = true; pend.push({ 名称: f.名称, 阶段: '圆满', 奖励: `〔${f.品阶}〕已练至上限，可升品（岁月沉淀/商城）或冲击入道`, 楼层: lp.id }); }
                    while (pend.length > 8) pend.shift();
                    done.push(g);
                }
                zz.界面记账时间 = Date.now();
                if (derive) try { derive(v); } catch { /* engine not ready: next engine write derives */ }
                return done;
            }, zz => [practiced(zz, mark), JSON.stringify((zz.功法库 || []).map(s => [s?.名称, s?.熟练度]))]);
            if (out?.length) {
                this.app.hub?.toast?.(`实战积累：${out.map(g => `${g.name} +${g.gain}${g.to !== g.from ? `（${g.to}！）` : ''}`).join('，')}`, 3600);
                this.app.hub?.scheduleEngineView?.(200);
            }
        } finally { this.busy = false; }
    }
    // ---------- 3. 角色卡功法 ----------
    /** All card-side skill sources: [{label, path, items}] (read only). */
    cardSources() {
        const out = [], c = this.ctx;
        try {
            const vars = this.app.bridge.getVariables({ type: 'chat' }) || {};
            const other = Object.fromEntries(Object.entries(vars).filter(([k]) => !['诸天系统', '诸天记忆助手_v1', STORAGE].includes(k)));
            const items = scanSkills(other, '聊天变量'); if (items.length) out.push({ label: '聊天变量（其他脚本 / 卡片）', items });
        } catch { /* ignore */ }
        try {
            const chat = c.chat || [];
            for (let i = chat.length - 1; i >= Math.max(0, chat.length - 30); i--) {
                const m = chat[i], v = m?.variables?.[m.swipe_id ?? 0];
                if (v && typeof v === 'object' && Object.keys(v).length) { const tree = v.stat_data && typeof v.stat_data === 'object' ? v.stat_data : v; const items = scanSkills(tree, `第${i}层.stat_data`); if (items.length) out.push({ label: `MVU 楼层变量（第 ${i} 层）`, items }); break; }
            }
        } catch { /* ignore */ }
        try {
            const ch = c.characters?.[c.characterId], ext = ch?.data?.extensions;
            const th = ext?.tavern_helper ?? ext?.TavernHelper_characterVariables;
            if (th && typeof th === 'object') { const items = scanSkills(th.variables ?? th, '角色卡.tavern_helper'); if (items.length) out.push({ label: `角色卡变量（${ch.name || '当前角色'}）`, items }); }
        } catch { /* ignore */ }
        return out;
    }
    cardPlan(z = this.ledger()) {
        const sources = this.cardSources(), by = new Map();
        for (const src of sources) for (const it of src.items) { const n = normName(it.名称); if (!by.has(n)) by.set(n, { ...it }); }
        const all = [...by.values()];
        const plan = mergeSkills(z?.功法库, all.map(s => ({ ...s })));
        return { sources, items: all, changes: plan.changes };
    }
    scheduleCard() { if (!this.cfg.cardAuto) return; clearTimeout(this.cardTimer); this.cardTimer = setTimeout(() => this.importCard({ auto: true }).catch(e => console.warn('[诸天修行] 角色卡功法未同步', e)), 1500); }
    async importCard({ auto = false } = {}) {
        if (this.busy || !this.app.adapter.currentIdentity() || this.app.adapter.isGenerating()) return null;
        const z = this.ledger(); if (!z) { if (!auto) throw Error('当前聊天还没有诸天账本，先在「设置 → 新聊天初始化」创建。'); return null; }
        const plan = this.cardPlan(z); if (!plan.changes.length) { if (!auto) this.app.hub?.toast?.('角色卡功法与功法库一致，没有需要同步的。'); return plan; }
        const paths = [...new Set(plan.items.map(s => s.path.split(/[.[]/)[0]))];
        this.busy = true;
        try {
            const derive = this.derive();
            const res = await L.commit(this.app.bridge, (v, zz) => {
                const m = mergeSkills(zz.功法库, plan.items, '角色卡'); if (!m.changes.length) return m;
                zz.功法库 = m.lib;
                // every floor snapshot gets the same raise, so a later swipe does not take the imported skills away again
                for (const r of Object.values(zz.面板账本 || {})) if (r?.snap && Array.isArray(r.snap.功法库)) r.snap.功法库 = mergeSkills(r.snap.功法库, plan.items, '角色卡').lib;
                const log = Array.isArray(zz.功法记录) ? zz.功法记录 : (zz.功法记录 = []);
                for (const ch of m.changes) log.push({ 名称: ch.name, 变化: ch.kind === '收录' ? `收录(角色卡) ${ch.to}` : `${ch.kind} ${ch.from}→${ch.to}(角色卡)`, 时间: Date.now() });
                while (log.length > 30) log.shift();
                zz.角色卡功法同步 = { 时间: Date.now(), 来源: paths, 部数: plan.items.length, 变化: m.changes.length, 自动: auto };
                zz.界面记账时间 = Date.now();
                if (derive) try { derive(v); } catch { /* ignore */ }
                return m;
            }, zz => [JSON.stringify((zz.功法库 || []).map(s => [s?.名称, s?.熟练度, s?.品阶])), zz.角色卡功法同步?.时间]);
            this.app.hub?.toast?.(`角色卡功法已同步：${res.changes.length} 处变化（${res.changes.slice(0, 3).map(c => c.name + ' ' + c.kind).join('、')}${res.changes.length > 3 ? '…' : ''}）`, 4200);
            this.app.hub?.scheduleEngineView?.(150);
            if (this.app.hub?.page === 'skills') this.render(this.app.hub.pages.get('skills').el);
            return res;
        } finally { this.busy = false; }
    }
    // ---------- UI ----------
    strip(n, tools) {
        if (n !== 4) { if (tools.dataset.owner === 'skills') { tools.innerHTML = ''; delete tools.dataset.owner; tools.onclick = null; } return; }
        tools.dataset.owner = 'skills'; this.tools = tools; this.refreshStrip();
        tools.onclick = e => {
            if (e.target.closest('[data-sk-more]')) return this.app.hub.go('skills');
            if (e.target.closest('[data-sk-appraise]')) return this.app.hub.go('appraise');
            if (e.target.closest('[data-sk-import]')) this.importCard().catch(err => this.app.hub.toast(err.message, 4000));
        };
    }
    refreshStrip() {
        const tools = this.tools; if (!tools || tools.dataset.owner !== 'skills') return;
        const z = this.ledger() || {}, lib = (z.功法库 || []).map(fixSkill), main = lib.find(s => normName(s.名称) === normName(z.功法?.名称));
        let card = { items: [], changes: [] }; try { card = this.cardPlan(z); } catch { /* ignore */ }
        const nx = main ? nextTarget(main) : null, last = practiceLog(z).at(-1);
        tools.innerHTML = `<div class="zt-plug-strip"><span class="zt-plug-title">修行</span>${main ? `<span class="zt-chip" title="${esc(effectsOf(main).join('；'))}">${esc(main.名称)} · ${stageOf(main)}${nx ? ` · 距下一阶段 ${fmtNum(nx - main.熟练度)}` : ''}</span>` : '<span class="zt-note">尚无主修功法</span>'}${last ? `<span class="zt-chip">实战 ${esc(last.名称)} +${last.增加}</span>` : ''}${card.items.length ? `<span class="zt-chip">角色卡功法 ${card.items.length} 部${card.changes.length ? ` · ${card.changes.length} 处可同步` : ' · 已同步'}</span>${card.changes.length ? '<button type="button" class="zt-btn small primary" data-sk-import>导入 / 同步</button>' : ''}` : ''}<button type="button" class="zt-btn small" data-sk-appraise title="剧情里得到、被记成凡品的功法可以重新鉴定" style="margin-left:auto">品阶鉴定 ›</button><button type="button" class="zt-btn small" data-sk-more>阶段效果与来源 ›</button></div>`;
    }
    render(el) {
        const z = this.ledger(), lib = (z?.功法库 || []).map(fixSkill), main = normName(z?.功法?.名称);
        let card = { sources: [], items: [], changes: [] }; try { card = this.cardPlan(z || {}); } catch { /* ignore */ }
        const rows = lib.map(s => { const st = stageOf(s), nx = nextTarget(s), pct = Math.min(100, Math.round(s.熟练度 / Math.max(1, s.上限) * 100));
            return `<div class="zt-row"><span><b style="font-weight:500">${esc(s.名称)}</b> <span class="zt-grade" data-g="${esc(s.品阶)}">${esc(s.品阶)}</span>${normName(s.名称) === main ? ' <span class="zt-chip">主修</span>' : ''}<span class="zt-desc">${effectsOf(s).map(esc).join('；')}${nx ? ` · 下一阶段「${STAGES[STAGES.indexOf(st) + 1]}」：${esc(STAGE_EFFECT[STAGES[STAGES.indexOf(st) + 1]])}（还差 ${fmtNum(nx - s.熟练度)}）` : (!s.入道 && s.熟练度 >= s.上限 ? ' · 已达本品上限：升品或冲击入道' : '')}</span></span><span class="zt-chip" title="${pct}%">${st} ${fmtNum(s.熟练度)}/${fmtNum(s.上限)}</span></div>`; }).join('');
        const practice = practiceLog(z).reverse().slice(0, 10).map(r => `<div class="zt-row"><span>${esc(r.名称)} <span class="zt-desc">第 ${r.楼层} 层 · ${new Date(r.时间).toLocaleString('zh-CN')}</span></span><span class="zt-chip">+${r.增加}</span></div>`).join('');
        const src = card.sources.map(s => `<div class="zt-row"><span><b style="font-weight:500">${esc(s.label)}</b><span class="zt-desc">${s.items.map(i => `${esc(i.名称)}${i.品阶 ? '〔' + esc(i.品阶) + '〕' : ''}${i.熟练度 != null ? ' ' + fmtNum(i.熟练度) : ''} <code>${esc(i.path)}</code>`).join('；')}</span></span></div>`).join('');
        const sync = z?.角色卡功法同步;
        el.innerHTML = `<div class="zt-eyebrow">CULTIVATION</div><h2 class="zt-h">修行 · 熟练度</h2><p class="zt-sub">阶段效果会告诉 AI 并在剧情里生效；熟练度由数据块「功法修炼」和实战积累增长。</p>
<div class="zt-actions" style="margin-bottom:10px"><button class="zt-btn" type="button" data-sk-back>‹ 回到修行页</button><button class="zt-btn" type="button" data-sk-appraise>品阶鉴定 ›</button></div>
<section class="zt-card"><h3>功法库 <small>${lib.length} 部</small></h3>${rows || '<div class="zt-note">功法库还是空的。AI 在数据块写「功法修炼：收录:功法名〔品阶〕」后会出现在这里，也可以从角色卡导入。</div>'}</section>
<section class="zt-card"><h3>阶段与效果 <small>原版规则</small></h3>${STAGES.map(st => `<div class="zt-row"><span>${st}<span class="zt-desc">${esc(STAGE_EFFECT[st])}</span></span><span class="zt-chip">${STAGE_AT[st] ? '≥ ' + fmtNum(STAGE_AT[st]) : st === '入道' ? 'AI 写「入道:」' : '< 100'}</span></div>`).join('')}<div class="zt-note">品阶上限：凡品 100 · 灵品 500 · 仙品 2,000 · 神品 / 禁忌 10,000。到上限后需升品（岁月沉淀 / 商城）才能继续。</div></section>
<section class="zt-card"><h3>实战积累 <small>最近 10 次</small></h3>${practice || '<div class="zt-note">还没有补记过。正文里用了功法、数据块却漏记时会出现在这里。</div>'}</section>
<section class="zt-card"><h3>角色卡功法 <small>只读取，不改写角色卡</small></h3>${src || '<div class="zt-note">当前角色卡没有找到功法 / 技能 / 武学类变量（会查找聊天变量、MVU 楼层 stat_data、角色卡酒馆助手变量）。</div>'}
${card.changes.length ? `<div class="zt-note">可同步 ${card.changes.length} 处：${card.changes.slice(0, 12).map(c => `${esc(c.name)} ${esc(c.kind)}${c.from != null ? ' ' + esc(c.from) + '→' : ' '}${esc(c.to)}`).join('；')}</div><div class="zt-actions"><button class="zt-btn primary" type="button" data-sk-import>导入 / 同步到功法库</button></div>` : card.items.length ? '<div class="zt-note">已与功法库一致。</div>' : ''}
${sync ? `<div class="zt-note">上次同步：${new Date(sync.时间).toLocaleString('zh-CN')} · 来源 ${esc((sync.来源 || []).join('、'))} · ${sync.变化} 处变化${sync.自动 ? '（自动）' : ''}</div>` : ''}</section>`;
        el.onclick = e => {
            if (e.target.closest('[data-sk-back]')) return this.app.hub.go('cult');
            if (e.target.closest('[data-sk-appraise]')) return this.app.hub.go('appraise');
            if (e.target.closest('[data-sk-import]')) this.importCard().catch(err => this.app.hub.toast(err.message, 4000));
        };
    }
    dispose() { clearTimeout(this.timer); clearTimeout(this.cardTimer); this.disposers.splice(0).forEach(f => { try { f(); } catch { /* ignore */ } }); try { this.app.bridge.uninjectPrompts(['mastery']); } catch { /* ignore */ } }
}

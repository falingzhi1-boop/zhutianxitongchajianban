// Do not expose reasoning text. Metadata is used only to distinguish truncation from network/format errors.
export function textContent(v) {
    if (typeof v === 'string') return v;
    if (Array.isArray(v)) return v.map(p => typeof p?.text === 'string' ? p.text : '').join('');
    return '';
}
export function completionText(data, budget) {
    const c = data?.choices?.[0], text = textContent(c?.message?.content ?? c?.text);
    if (text.trim()) return text;
    if (c?.finish_reason === 'length' || c?.finish_reason === 'max_tokens') {
        const thinking = !!(data?.zt_reasoning_present || c?.message?.reasoning_content || c?.message?.reasoning);
        throw Object.assign(Error(`输出达到额度（${budget} tokens），未返回正文${thinking ? '，接口返回了思考内容' : '；接口未提供足够信息判断是否由思考导致'}。可提高此功能的输出上限。`), { code: 'EMPTY_LENGTH' });
    }
    throw Error('接口未返回正文（结束原因：' + (c?.finish_reason || '未提供') + '）；请检查模型/接口，不会写入结果。');
}
const KIND = { event: '事件', promise: '承诺', relationship: '关系', clue: '线索', location: '地点', rule: '规则', task: '任务', other: '其他' };
const STATE = { '进行中': 'active', '有效': 'active', '未解决': 'active', '已完成': 'resolved', '已解决': 'resolved' };
// 1.1.4: 「记忆整理失败：记忆键重复或不安全」. The original validator (vendor, hash-locked) only accepts keys made of
// A-Z a-z 0-9 _ - / and CJK (U+3400–9FFF), 1–64 chars, no __proto__/constructor/prototype, each key once per batch.
// Models write「林雪·关系」「任务：取钥匙」「Lin Xue」, kana, full-width letters, or the same key twice — and one bad key
// threw away the whole batch. Keys are now cleaned to that alphabet and duplicates merged (the later entry wins, as the
// original commit does for the same key) BEFORE the unchanged original validation runs.
const KEY_BAD = /[^A-Za-z0-9_\-\u3400-\u9fff/]+/g;
const hashKey = t => { let h = 2166136261; for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); };
/** One memory key → a key the original accepts (pure, for tests). `fallback` is used when nothing usable is left. */
export function memoryKey(key, fallback = 'mem') {
    let k = String(key ?? '').normalize('NFKC').trim().replace(KEY_BAD, '_').replace(/__proto__|constructor|prototype/gi, '_')
        .replace(/_{2,}/g, '_').replace(/\/{2,}/g, '/').replace(/^[_/]+|[_/]+$/g, '');
    if (!k) k = String(fallback || 'mem').replace(KEY_BAD, '_') || 'mem';
    return k.slice(0, 64).replace(/[_/]+$/, '') || 'mem';
}
export function normalizeMemory(raw) {
    let o; try { o = JSON.parse(String(raw).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')); } catch { return raw; }
    if (!Array.isArray(o?.upserts)) return raw;
    for (const [i, x] of o.upserts.entries()) if (x && typeof x === 'object') {
        const kind = String(x.kind ?? '').trim(), status = String(x.status ?? '').trim();
        x.kind = KIND[kind.toLowerCase()] || kind;
        x.status = STATE[status] || status.toLowerCase();
        if (typeof x.key === 'string' || typeof x.key === 'number') x.key = memoryKey(x.key, `mem_${hashKey(String(x.text ?? i))}`);
        else if (x.key === undefined || x.key === null) x.key = memoryKey('', `mem_${hashKey(String(x.text ?? i))}`);
    }
    // same key twice in one batch: keep the later entry, in its position
    const seen = new Set();
    o.upserts = o.upserts.slice().reverse().filter(x => { if (!x || typeof x !== 'object' || typeof x.key !== 'string') return true; if (seen.has(x.key)) return false; seen.add(x.key); return true; }).reverse();
    return JSON.stringify(o);
}
export function memoryCore(core) {
    return Object.create(core, { validate: { value(raw, source) {
        try { return core.validate(normalizeMemory(raw), source); }
        catch (e) { throw Error('记忆整理失败：' + e.message + '。旧记忆保留；不是交易失败，不要重复购买。'); }
    }, enumerable: true } });
}

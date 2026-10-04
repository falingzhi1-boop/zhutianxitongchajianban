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
export function normalizeMemory(raw) {
    let o; try { o = JSON.parse(String(raw).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')); } catch { return raw; }
    if (!Array.isArray(o?.upserts)) return raw;
    for (const x of o.upserts) if (x && typeof x === 'object') {
        const kind = String(x.kind ?? '').trim(), status = String(x.status ?? '').trim();
        x.kind = KIND[kind.toLowerCase()] || kind;
        x.status = STATE[status] || status.toLowerCase();
    }
    return JSON.stringify(o);
}
export function memoryCore(core) {
    return Object.create(core, { validate: { value(raw, source) {
        try { return core.validate(normalizeMemory(raw), source); }
        catch (e) { throw Error('记忆整理失败：' + e.message + '。旧记忆保留；不是交易失败，不要重复购买。'); }
    }, enumerable: true } });
}

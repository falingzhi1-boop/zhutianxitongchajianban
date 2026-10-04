// These fields are written by explicit native actions, never a model's generic 变量更新 line.
export const NATIVE_FIELDS = ['羁绊库', '当前羁绊ID', '剧情收纳库', '世界品阶映射', '商品历史', '操作日志'];
export function preserveNative(next, before) {
    if (!next) return;
    for (const field of NATIVE_FIELDS) {
        if (before && Object.hasOwn(before, field)) next[field] = structuredClone(before[field]); else delete next[field];
    }
}

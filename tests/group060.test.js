// 0.6.0 聊天群 pure logic: reply parsing with the hard floor, 拼手气 split, recruit parsing, ledger helpers.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseGroupReply, parseRecruit, parseItem, splitShares, normGroup, signReward, QTY_CAP } from '../src/hub-group.js';
import * as L from '../src/ledger-ops.js';

const members = [
    { id: 'a', 名称: '叶清寒', 世界: '问剑宗', 档: 2 },
    { id: 'b', 名称: '白浅', 世界: '青丘', 档: 4 },
    { id: 'c', 名称: '苏小蛮', 世界: '东海', 档: 1, 禁言轮: 2 },
];

test('reply lines map to members; unknown and muted members are ignored', () => {
    const r = parseGroupReply('@叶清寒: 群主好\n白浅：我在\n@苏小蛮: 我被禁言了还说话\n@路人甲: 不在群里\n旁白：夜色深沉', members);
    assert.deepEqual(r.map(x => [x.who.id, x.text]), [['a', '群主好'], ['b', '我在']]);
});

test('at most 6 speakers per round', () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ id: 'm' + i, 名称: '群员' + i, 世界: 'w', 档: 1 }));
    assert.equal(parseGroupReply(many.map(m => `@${m.名称}: hi`).join('\n'), many).length, 6);
});

test('item packet: grade clamped to shop level and member tier (auto-downgrade), qty capped', () => {
    const r = parseGroupReply('@白浅: [红包] 物品 青丘桃花酿/仙品/消耗品/心神安宁 9 | 尝尝', members, { cap: '灵品', shop: 2 });
    assert.equal(r[0].packet.kind, 'item');
    assert.equal(r[0].packet.item.品级, '灵品');
    assert.equal(r[0].packet.downgraded, true);
    assert.equal(r[0].packet.qty, QTY_CAP['灵品']);
    const low = parseGroupReply('@叶清寒: [赠礼] 剑谱/神品/功法/太虚剑意 | 给你', members, { cap: '神品', shop: 4 });
    assert.equal(low[0].gift.item.品级, '灵品', 'tier 2 (武道宗师) carries at most 灵品');
});

test('禁忌 never passes, even at shop level 5 and tier 8', () => {
    const god = [{ id: 'g', 名称: '概念神', 世界: '虚无', 档: 8 }];
    const r = parseGroupReply('@概念神: [赠礼] 因果律武器/禁忌/装备/改写因果 | 拿去', god, { cap: '神品', shop: 5 });
    assert.equal(r[0].gift.item.品级, '神品');
    assert.equal(L.giftCap({ 商城等级: 5 }, 8), '神品');
});

test('points packet: capped by member tier price and shop level', () => {
    const r = parseGroupReply('@叶清寒: [红包] 系统点 999999 3 | 见者有份', members, { shop: 5 });
    assert.equal(r[0].packet.amount, 1500, 'tier 2: capped by its 入群费 (0.8.2)');
    const s = parseGroupReply('@白浅: [红包] 系统点 999999 3 | 见者有份', members, { shop: 1 });
    assert.equal(s[0].packet.amount, 2000, 'shop Lv1 cap');
    assert.equal(s[0].packet.downgraded, true);
});

test('拼手气 shares are positive integers that sum to the total', () => {
    let seed = 7; const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (const [total, count] of [[3000, 3], [5, 5], [10, 1], [7, 20], [100000, 10]]) {
        const s = splitShares(total, count, rand);
        assert.equal(s.reduce((a, b) => a + b, 0), total);
        assert.ok(s.every(v => Number.isInteger(v) && v >= 1));
        assert.equal(s.length, Math.min(count, total));
    }
});

test('recruit card parsing: tier clamped 1–8, junk rejected', () => {
    assert.deepEqual(parseRecruit('白浅|青丘|4|清冷护短|青丘桃花酿'), { 名称: '白浅', 世界: '青丘', 档: 4, 性格: '清冷护短', 特产: '青丘桃花酿' });
    assert.equal(parseRecruit('超人|DC|12|正直|氪石').档, 8);
    assert.equal(parseRecruit('没有竖线的一段话'), null);
    assert.ok(!parseRecruit('{{char}}<b>|w|1|x|y').名称.includes('<'));
});

test('item spec parsing and defaults', () => {
    assert.deepEqual(parseItem('回春丹/灵品/消耗品/恢复伤势'), { 名称: '回春丹', 品级: '灵品', 分类: '消耗品', 效果: '恢复伤势' });
    assert.equal(parseItem('怪东西/超神品').品级, '凡品');
    assert.equal(parseItem(''), null);
});

test('group state normalisation keeps defaults and resets the daily counter', () => {
    const g = normGroup({ 日计: { day: '2000-01-01', 收: 6, 发: 10 }, 容量: 999 });
    assert.equal(g.容量, 30); assert.equal(g.日计.收, 0); assert.equal(g.日计.发, 0);
    assert.ok(g.群规.length >= 3); assert.equal(g.设置.摘要注入, true); assert.equal(g.设置.自动闲聊, false);
});

test('sign-in reward grows with the streak (capped at 7) and group size', () => {
    assert.equal(signReward(1, 0), 100); assert.equal(signReward(3, 5), 350); assert.equal(signReward(30, 2), 720);
});

test('ledger helpers follow the original adjustSysPoints / bagAdd semantics', () => {
    const z = { 系统点: 1000, 累计消费: 0, 背包: [{ 名称: '灵草', 品级: '凡品', 数量: 2 }] };
    assert.throws(() => L.spend(z, 5000), /系统点不足/); assert.equal(z.系统点, 1000);
    L.spend(z, 300); assert.equal(z.系统点, 700); assert.equal(z.累计消费, 300);
    L.earn(z, 50); assert.equal(z.系统点, 750);
    L.bagAdd(z, { 名称: '灵草', 品级: '凡品', 来源: '白浅@青丘' }, 3); assert.equal(z.背包[0].数量, 5); assert.equal(z.背包[0].来源, '白浅@青丘');
    L.bagAdd(z, { 名称: '灵草', 品级: '灵品' }, 1); assert.equal(z.背包.length, 2);
    const took = L.bagTake(z, 0, 5); assert.equal(took.数量, 5); assert.equal(z.背包.length, 1);
    assert.throws(() => L.bagTake(z, 0, 2), /只有 1 个/);
});

test('shop level follows the original thresholds', () => {
    assert.equal(L.shopLevel({ 系统点: 1000 }), 1);
    assert.equal(L.shopLevel({ 系统点: 200000 }), 2);
    assert.equal(L.shopLevel({ 系统点: 10, 专属资源: { 名望: 10000 } }), 3);
    assert.equal(L.shopLevel({ 系统点: 1, 商城等级下限: 4 }), 4);
});

test('commit reads back and refuses when the booked value differs', async () => {
    let store = { 诸天系统: { 系统点: 100 } };
    const good = { updateVariablesWith: async fn => { store = fn(structuredClone(store)); }, getVariables: () => structuredClone(store) };
    await L.commit(good, (v, z) => { L.earn(z, 5); });
    assert.equal(store.诸天系统.系统点, 105);
    const lying = { updateVariablesWith: async fn => { fn(structuredClone(store)); }, getVariables: () => structuredClone(store) };
    await assert.rejects(L.commit(lying, (v, z) => { L.earn(z, 5); }), /读回不一致/);
    await assert.rejects(L.commit({ updateVariablesWith: async fn => fn({}), getVariables: () => ({}) }, () => {}), /没有诸天账本/);
});

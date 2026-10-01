// 0.8.1 pure logic: Lilith API model discovery through the ST relay, 聊天群 recruit randomness / budget / rhythm /
// story provenance, and the worldbook patches + update merge.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { proxiedFetch } from '../src/assistant-host.js';
import { Bridge } from '../src/th-bridge.js';
import { recruitPrompt, affordableTier, JOIN_PRICE, RECRUIT_FEE, packetAllowed, groupStoryPrompt, normGroup } from '../src/hub-group.js';
import { latestRules, mergeWorldbook } from '../src/worldbook.js';
import original from '../vendor/original/runtime.js';

const root = new URL('../', import.meta.url);

test('assistant: the original connection page gets the shim fetch on its private globalThis (root.fetch)', () => {
    const src = readFileSync(new URL('src/assistant-host.js', root), 'utf8');
    assert.match(src, /G\.fetch = shimFetch/);
    // the vendored original really reads root.fetch for /models — this is why the shim must be on G
    assert.match(readFileSync(new URL('vendor/original/assistant-runtime.js', root), 'utf8'), /root\.fetch\(config\.url\+'\/models'/);
});

test('assistant fetch shim: CORS-blocked GET /v1/models keeps the /v1 base when relaying', async () => {
    const real = globalThis.fetch; const seen = [];
    globalThis.location ??= { href: 'http://127.0.0.1:8000/', origin: 'http://127.0.0.1:8000' };
    globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };
    try {
        const f = proxiedFetch({ listModels: async (base, key) => { seen.push([base, key]); return ['m1', 'm2']; } });
        const r = await f('https://api.example.com/v1/models', { method: 'GET', headers: { Authorization: 'Bearer sk-x' } });
        assert.deepEqual(seen, [['https://api.example.com/v1', 'sk-x']]);
        assert.deepEqual((await r.json()).data.map(x => x.id), ['m1', 'm2']);
    } finally { globalThis.fetch = real; }
});

test('bridge.listModels: direct blocked → ST status relay, bare domain also tried with /v1', async () => {
    const real = globalThis.fetch; const relayed = [];
    globalThis.fetch = async (url, init) => {
        if (String(url).startsWith('https://')) throw new TypeError('Failed to fetch');
        const body = JSON.parse(init.body); relayed.push(body.custom_url);
        if (body.custom_url.endsWith('/v1')) return new Response(JSON.stringify({ object: 'list', data: [{ id: 'gpt-x' }] }), { status: 200 });
        return new Response(JSON.stringify({ error: true, bypass: true, data: { data: [] } }), { status: 200 });
    };
    try {
        const b = new Bridge({ context: () => ({ getRequestHeaders: () => ({}) }) }, {});
        assert.deepEqual(await b.listModels('https://catiecli.example.top', 'k'), ['gpt-x']);
        assert.deepEqual(relayed, ['https://catiecli.example.top', 'https://catiecli.example.top/v1']);
        relayed.length = 0;
        assert.deepEqual(await b.listModels('https://catiecli.example.top/v1', 'k'), ['gpt-x']);
        assert.deepEqual(relayed, ['https://catiecli.example.top/v1']);
    } finally { globalThis.fetch = real; }
});

test('入群费: own curve starting at 300; budget picks the highest affordable tier', () => {
    assert.equal(RECRUIT_FEE, 100);
    assert.deepEqual(JOIN_PRICE.slice(1, 4), [300, 1500, 6000]);
    assert.ok(JOIN_PRICE[7] < 1e8, 'no more billions for a 星系级 member');
    assert.equal(affordableTier(0), 1); assert.equal(affordableTier(450), 1); assert.equal(affordableTier(1600), 2); assert.equal(affordableTier(5e8), 8);
});

test('random recruit: genre and target tier drawn locally, never above budget, recent names excluded', () => {
    const g = normGroup({ 成员: [{ id: 'a', 名称: '叶清寒', 世界: '问剑宗', 档: 2 }], 候选历史: ['孙悟空'] });
    let r = 0; const seq = [0.0, 0.0, 0.99, 0.99];
    const a = recruitPrompt(g, { mode: 'rand', budget: 400, maxTier: affordableTier(400), rand: () => seq[r++] });
    assert.equal(a.target, 1); assert.match(a.text, /必须是 1/); assert.match(a.text, /【不要选】叶清寒、孙悟空/);
    const b = recruitPrompt(g, { mode: 'rand', budget: 1e6, maxTier: affordableTier(1e6), rand: () => seq[r++] });
    assert.ok(b.target >= 3 && b.target <= 5, String(b.target)); assert.notEqual(a.seed, b.seed);
    const prompts = new Set(Array.from({ length: 20 }, () => recruitPrompt(g, { budget: 1e6, maxTier: 5 }).text));
    assert.ok(prompts.size > 3, 'consecutive random recruits send different prompts');
    const c = recruitPrompt(g, { mode: 'char', hint: '孙悟空', budget: 100, maxTier: 1 });
    assert.equal(c.target, 0); assert.match(c.text, /如实评估/);
});

test('红包节奏: due every 3–4 rounds; the host asking overrides', () => {
    assert.equal(packetAllowed(normGroup({}), ''), 'due');                                   // new group: allowed once
    assert.equal(packetAllowed(normGroup({ 节奏: { 距上次: 0, 间隔: 3 } }), '大家好'), '');
    assert.equal(packetAllowed(normGroup({ 节奏: { 距上次: 1, 间隔: 3 } }), '大家好'), '');
    assert.equal(packetAllowed(normGroup({ 节奏: { 距上次: 2, 间隔: 3 } }), '大家好'), 'due');
    assert.equal(packetAllowed(normGroup({ 节奏: { 距上次: 2, 间隔: 4 } }), '大家好'), '');
    assert.equal(packetAllowed(normGroup({ 节奏: { 距上次: 0, 间隔: 4 } }), '谁给我发个红包'), 'asked');
    assert.equal(normGroup({ 节奏: { 间隔: 9 } }).节奏.间隔, 4);
});

test('story prompt carries the real source of what came through the group', () => {
    const g = normGroup({ 成员: [{ id: 'b', 名称: '白浅', 世界: '青丘', 档: 4 }], 入库记录: [{ t: 1, what: '青丘桃花酿（仙品）×1', src: '白浅@青丘', how: '红包' }] });
    const p = groupStoryPrompt(g, t => '档' + t);
    assert.match(p, /真实入库记录/); assert.match(p, /青丘桃花酿（仙品）×1（白浅@青丘，红包）/);
    assert.match(p, /不得改写成捡到、买到/); assert.match(p, /不要替群员编造/);
    assert.equal(normGroup({ 入库记录: Array.from({ length: 30 }, (_, i) => ({ what: 'x' + i })) }).入库记录.length, 20);
});

test('worldbook: original 35 kept, outdated admin/TH notes patched, 聊天群 entry added', () => {
    const base = original.ZhuTianBuiltinRules, { rules, applied, skipped } = latestRules(base);
    assert.equal(base.length, 35); assert.equal(rules.length, 36); assert.equal(skipped.length, 0); assert.equal(applied.length, 2);
    const e05 = rules.find(r => r.comment === '05｜核心｜状态栏规则补充').content;
    assert.ok(!e05.includes('◆ 连点五次打开') && e05.includes('管理员控制台」打开') && e05.includes('不需要酒馆助手'));
    const g = rules[35]; assert.equal(g.comment, '36｜联动｜诸天聊天群（插件）'); assert.equal(g.uid, 35); assert.equal(g.constant, true);
    assert.ok(base.find(r => r.comment === '05｜核心｜状态栏规则补充').content.includes('◆ 连点五次打开'), 'vendor original untouched');
});

test('worldbook update merge: built-ins replaced, user entries and on/off kept', () => {
    const { rules } = latestRules(original.ZhuTianBuiltinRules);
    const old = { entries: { 0: { ...original.ZhuTianBuiltinRules[4], disable: true, content: 'old text' }, 1: { comment: '我的规则', content: 'mine', uid: 1 } } };
    const r = mergeWorldbook(old, rules);
    const list = Object.values(r.book.entries);
    assert.equal(list.length, 37); assert.equal(r.replaced, 1); assert.equal(r.added, 35); assert.equal(r.kept, 1);
    const e05 = list.find(e => e.comment === '05｜核心｜状态栏规则补充'); assert.equal(e05.disable, true); assert.notEqual(e05.content, 'old text');
    assert.equal(list[36].comment, '我的规则'); assert.deepEqual(list.map(e => e.uid), list.map((_, i) => i));
});

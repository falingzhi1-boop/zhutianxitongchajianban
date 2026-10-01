// 0.8.2: worldbook unbind / restore, floating Lilith geometry, 聊天群 provenance from the bag, packet cap, chat interval.
import test from 'node:test';
import assert from 'node:assert/strict';
import { findBindings, unbindAll, restoreBindings, describe } from '../src/wb-unbind.js';
import { settle, wantFloat, ZONE_MOOD, POKE_LINES } from '../src/lilith-float.js';
import { packetCap, expandCost, groupItems, groupStoryPrompt, groupSource, normGroup, parseGroupReply, CHAT_EVERY, JOIN_PRICE } from '../src/hub-group.js';
import { VERSION, CAPABILITIES } from '../src/contracts.js';
import { readFileSync } from 'node:fs';

const NAME = '诸天万界最强系统';
function host() {
    const writes = [];
    const ctx = {
        characters: [
            { avatar: 'a.png', name: '甲', data: { extensions: { world: NAME } } },
            { avatar: 'b.png', name: '乙', data: { extensions: { world: '别的书' } } },
            { avatar: 'c.png', name: '丙', data: { extensions: { world: NAME } } },
            { avatar: 'd.png', name: '丁', data: { extensions: {} } },
        ],
        chatMetadata: { world_info: NAME }, getCurrentChatId: () => 'chat-1',
        async writeExtensionField(id, key, value) { writes.push([id, key, value]); this.characters[id].data.extensions[key] = value; },
        async saveMetadata() { writes.push(['meta']); }, saveSettingsDebounced() { writes.push(['settings']); },
    };
    const wi = {
        world_info: { charLore: [{ name: 'd.png', extraBooks: [NAME, '其他'] }, { name: 'b.png', extraBooks: [NAME] }] },
        selected_world_info: ['x', NAME],
        onWorldInfoChange(args, name) { const i = this.selected_world_info.indexOf(name); if (args.state === 'off' && i >= 0) this.selected_world_info.splice(i, 1); if (args.state === 'on' && i < 0) this.selected_world_info.push(name); },
    };
    wi.onWorldInfoChange = wi.onWorldInfoChange.bind(wi);
    return { ctx, wi, writes };
}

test('findBindings sees primary books, extra books, the global list and the open chat', () => {
    const { ctx, wi } = host();
    const b = findBindings(ctx, wi, NAME);
    assert.deepEqual(b.chars.map(c => c.name), ['甲', '丙']);
    assert.deepEqual(b.extra.map(c => c.avatar), ['d.png', 'b.png']);
    assert.equal(b.global, true); assert.equal(b.chat, 'chat-1'); assert.equal(b.total, 6);
});

test('unbindAll removes every binding (not other books) and returns a record; restoreBindings puts them back', async () => {
    const { ctx, wi } = host();
    const rec = await unbindAll(ctx, NAME, { wi });
    assert.equal(rec.count, 6); assert.deepEqual(rec.errors, []);
    assert.equal(ctx.characters[0].data.extensions.world, ''); assert.equal(ctx.characters[1].data.extensions.world, '别的书');
    assert.deepEqual(wi.world_info.charLore, [{ name: 'd.png', extraBooks: ['其他'] }], 'empty extra-book entries removed, others kept');
    assert.deepEqual(wi.selected_world_info, ['x']);
    assert.equal(ctx.chatMetadata.world_info, undefined);
    assert.equal(findBindings(ctx, wi, NAME).total, 0);
    assert.match(describe(rec), /2 张角色卡（甲、丙）.*全局世界书.*当前聊天/);
    // the user picked another book for 丙 in the meantime: that choice is respected
    ctx.characters[2].data.extensions.world = '新书';
    const r = await restoreBindings(ctx, rec, { wi });
    assert.equal(ctx.characters[0].data.extensions.world, NAME); assert.equal(ctx.characters[2].data.extensions.world, '新书');
    assert.equal(r.skipped, 1);
    assert.ok(wi.selected_world_info.includes(NAME)); assert.equal(ctx.chatMetadata.world_info, NAME);
    assert.ok(wi.world_info.charLore.find(e => e.name === 'b.png').extraBooks.includes(NAME));
});

test('unbindAll is harmless when nothing is bound', async () => {
    const ctx = { characters: [{ avatar: 'a', name: 'a', data: { extensions: { world: '' } } }], chatMetadata: {}, saveSettingsDebounced() {} };
    const rec = await unbindAll(ctx, NAME, { wi: { world_info: {}, selected_world_info: [] } });
    assert.equal(rec.count, 0);
});

test('disable hook is wired: deactivate returns the unbind promise, default on, setting exists', () => {
    const idx = readFileSync(new URL('../index.js', import.meta.url), 'utf8');
    assert.match(idx, /export function deactivate\(\)\{const p=autoUnbind\(\);[\s\S]*return p;\}/);
    assert.match(idx, /wbUnbindOnDisable===false/);
    const set = readFileSync(new URL('../src/settings.js', import.meta.url), 'utf8');
    assert.match(set, /wbUnbindOnDisable: true/); assert.match(set, /floatLilith: 'auto'/);
});

test('floating Lilith: dropping near an edge tucks her there, elsewhere she stays (clamped)', () => {
    assert.deepEqual(settle({ x: 5, y: 300 }, 390, 844), { x: 0, y: 300, edge: 'left', tucked: true });
    assert.deepEqual(settle({ x: 330, y: 300 }, 390, 844), { x: 312, y: 300, edge: 'right', tucked: true });
    assert.deepEqual(settle({ x: 150, y: 2000 }, 390, 844), { x: 150, y: 844 - 104 - 8, edge: '', tucked: false });
    assert.equal(settle({ x: 150, y: -50 }, 390, 844).y, 8);
});

test('floating Lilith: auto = touch or narrow; on / off are forced', () => {
    assert.equal(wantFloat('auto', { coarse: true, width: 1400 }), true);
    assert.equal(wantFloat('auto', { coarse: false, width: 390 }), true);
    assert.equal(wantFloat('auto', { coarse: false, width: 1400 }), false);
    assert.equal(wantFloat('on', { width: 1400 }), true);
    assert.equal(wantFloat('off', { coarse: true, width: 390 }), false);
    for (const m of Object.values(ZONE_MOOD)) assert.ok(['neutral', 'smile', 'shy', 'pout', 'surprised', 'wink', 'smug', 'sad'].includes(m));
    assert.ok(POKE_LINES.length >= 3);
});

test('red packet total is capped by the member’s own 入群费 (no money printer)', () => {
    assert.equal(packetCap(1, 5), JOIN_PRICE[1]);
    assert.equal(packetCap(2, 5), 1500);
    assert.equal(packetCap(6, 1), 2000, 'shop Lv1 cap still applies');
    const r = parseGroupReply('@甲: [红包] 系统点 999999 3 | 拿去', [{ id: 'm1', 名称: '甲', 世界: '某界', 档: 1 }], { shop: 3 });
    assert.equal(r[0].packet.amount, 300); assert.equal(r[0].packet.downgraded, true);
    assert.equal(expandCost(5), 5000); assert.equal(expandCost(10), 10000);
});

test('story prompt lists group items from the BAG (still owned, any age) with their source', () => {
    const g = normGroup({ 成员: [{ id: 'a', 名称: '苏小蛮', 世界: '东海渔村', 档: 1 }], 入库记录: [{ what: '412 系统点', src: '苏小蛮@东海渔村', how: '红包' }] });
    const z = { 背包: [
        { 名称: '定海珠', 品级: '灵品', 数量: 1, 来源: groupSource('苏小蛮@东海渔村', '赠礼') },
        { 名称: '旧鱼干', 品级: '凡品', 数量: 2, 来源: '苏小蛮@东海渔村' },          // 0.6–0.8.1 style source
        { 名称: '商城药', 品级: '凡品', 数量: 1, 来源: '商城' },
        { 名称: '用完了', 品级: '凡品', 数量: 0, 来源: groupSource('苏小蛮@东海渔村', '红包') },
    ] };
    assert.deepEqual(groupItems(z, g).map(i => i.名称), ['定海珠', '旧鱼干']);
    const p = groupStoryPrompt(g, t => '档' + t, z);
    assert.match(p, /定海珠（灵品）×1（苏小蛮@东海渔村·赠礼）/);
    assert.match(p, /旧鱼干/); assert.doesNotMatch(p, /商城药|用完了/);
    assert.match(p, /412 系统点（苏小蛮@东海渔村，红包）/);
    assert.match(p, /不得改写成/);
});

test('自动闲聊 interval: default every 3 replies, only listed values accepted', () => {
    assert.equal(normGroup({}).设置.闲聊间隔, 3);
    assert.equal(normGroup({ 设置: { 闲聊间隔: 5 } }).设置.闲聊间隔, 5);
    assert.equal(normGroup({ 设置: { 闲聊间隔: 7 } }).设置.闲聊间隔, 3);
    assert.ok(CHAT_EVERY.includes(1) && CHAT_EVERY.includes(10));
    assert.equal(normGroup({ 节奏: { 闲聊: 2 } }).节奏.闲聊, 2);
});

test('status bar renderer keeps Tavern Helper render wrappers (character-card status bars)', () => {
    const src = readFileSync(new URL('../src/statusbar-host.js', import.meta.url), 'utf8');
    assert.match(src, /FOREIGN_SELECTOR = 'div\.TH-render'/);
    assert.doesNotMatch(src, /text\.innerHTML = /, 'no innerHTML rebuild of .mes_text any more');
    assert.match(src, /tavernHelperMacrosActive\(this\.ctx\(\)\)/);
});

test('0.8.2 capability rows (version checked in v083)', () => {
    for (const k of ['世界书一键解绑', '悬浮莉莉丝', '角色卡状态栏']) assert.ok(CAPABILITIES.some(c => c.name.includes(k)), k);
});

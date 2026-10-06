import test from 'node:test';
import assert from 'node:assert/strict';
import { rollGacha, shopGrades, planSlots, preferences, validateProduct, similarity, THEMES, PRICE_BANDS } from '../src/commerce-plan.js';
import { collectCandidates, putStory, bookStory } from '../src/story-collect.js';
import { syncBonds, listBonds, migrateBonds, keepPerson } from '../src/bonds-data.js';
import { compactLegacyOperation, summarizeRecords } from '../src/operation-records.js';
import { clampBox, launcherPosition } from '../src/window-controls.js';
import { normalizeMemory, memoryCore, completionText } from '../src/model-response.js';
import original from '../vendor/original/runtime.js';
import { latestRules, mergeWorldbook } from '../src/worldbook.js';
import { migrateLedger } from '../src/data-io.js';
import { capture, assertCapture, checkedCommit } from '../src/action-support.js';
const clone = x => structuredClone(x);

for (const [r, grade] of [[0,'神品'], [.000999,'神品'], [.001,'仙品'], [.019999,'仙品'], [.02,'灵品'], [.399999,'灵品'], [.4,'凡品'], [.99999,'凡品']]) test(`1.1 exact rarity boundary ${r}`, () => assert.equal(rollGacha({}, 1, () => r).grades[0], grade));
test('1.1 pity resets only on immortal; original state unchanged', () => {
    const s = { 保底计数: 98, 累计抽数: 98 }; const out = rollGacha(s, 2, () => 0);
    assert.deepEqual(out.grades, ['神品', '仙品']); assert.equal(out.state.保底计数, 0); assert.equal(s.保底计数, 98);
    assert.throws(() => rollGacha({}, 201));
});
test('1.1 mixed slots cover all selected themes before reuse, price stays local', () => {
    const slots = planSlots(Array(8).fill('神品'), {}, '', () => .4);
    assert.equal(new Set(slots.map(x => x.theme)).size, THEMES.length);
    assert.ok(slots.every(x => x.price >= PRICE_BANDS.神品[0]));
});
test('1.1 named/current scope requires identity, excludes other worlds', () => {
    assert.throws(() => planSlots(['凡品'], { scope:'named' }));
    assert.throws(() => planSlots(['凡品'], { scope:'current' }, ''));
    const [s] = planSlots(['凡品'], { scope:'named',world:'三体' }, '', () => .5);
    const row = { slot:0, name:'测试', effect:'可用来进行远距离探测', world:'另一个世界', grade:s.grade, category:s.category };
    assert.throws(() => validateProduct(row,s,preferences({})), /未指定/);
});
test('1.1 non-forbidden items ignore old shop level; forbidden has explicit acquisition', () => {
    assert.ok(shopGrades({系统点:0,商城等级:1},()=>.5).includes('仙品'));
    const grades=shopGrades({系统点:1e11,专属资源:{因果筹码:2}},()=>0);
    assert.ok(grades.includes('禁忌')); const s=planSlots(['禁忌'],{},'',()=>.3)[0]; assert.deepEqual(s.acquisition,{resource:'因果筹码',amount:1});
});
const slot = {id:0,grade:'神品',category:'装备',theme:'科幻',world:'',price:100000000,acquisition:null};
const good = {slot:0,name:'航道镜',effect:'实时标注星际跃迁安全路径与障碍位置',world:'测试原创宇宙',theme:'科幻',category:'装备',grade:'神品',origin:'原创'};
test('1.1 validates exact slot, grade, categories and excludes',()=>{
    assert.equal(validateProduct(good,slot,preferences()).price,slot.price);
    for(const bad of [{grade:'凡品'},{slot:3},{category:'其他'},{theme:'修仙玄幻'}]) assert.throws(()=>validateProduct({...good,...bad},slot,preferences()));
    assert.throws(()=>validateProduct(good,slot,preferences({exclude:'航道镜'})),/排除/);
    assert.throws(()=>validateProduct(good,slot,preferences({original:false})),/原作/);
});
test('1.1 repeat names normalized; reskins and imposed restrictions rejected',()=>{
    assert.throws(()=>validateProduct(good,slot,preferences(),[{name:'航 道 镜',effect:'别的作用'}]),/重复/);
    assert.throws(()=>validateProduct({...good,name:'宇宙雷达'},slot,preferences(),[good]),/换皮/);
    assert.throws(()=>validateProduct({...good,effect:good.effect+'但每日限一次'},slot,preferences()),/使用限制/);
    assert.equal(similarity('甲乙丙丁戊','甲乙丙丁戊'),1);
});
const sources=[{floor:3,sig:'abc',text:'你收下了青铜钥匙一枚，可开启古城大门。'}];
const sourceRow={floor:3,name:'青铜钥匙',evidence:'你收下了青铜钥匙一枚',owned:true,kind:'item',quantity:1,originalGrade:'天阶',grade:'待鉴定',effect:'开启古城大门'};
test('1.1 collect requires source evidence, ownership, bounded integer quantity',()=>{
    for(const bad of [{evidence:'敌人拿着金剑'},{owned:false},{quantity:0},{quantity:1.5},{floor:1}]) assert.throws(()=>collectCandidates([{...sourceRow,...bad}],sources,'古城'));
    assert.throws(()=>collectCandidates([sourceRow,sourceRow],sources,'古城'),/重复/);
});
test('1.1 local world rank is preserved; explicit mapping wins; unknown is pending not mortal',()=>{
    const [p]=collectCandidates([sourceRow],sources,'古城',{'天阶':'神品'});assert.equal(p.originalGrade,'天阶');assert.equal(p.grade,'神品');
    const [q]=collectCandidates([sourceRow],sources,'古城');const z={系统点:99};putStory(z,q);assert.equal(z.剧情收纳库[0].status,'pending');assert.equal(z.背包,undefined);assert.equal(z.系统点,99);
});
test('1.1 same source cannot duplicate; existing same-name defaults to refusal',()=>{
    const [r]=collectCandidates([{...sourceRow,grade:'灵品'}],sources,'古城');const z={背包:[]};putStory(z,r);assert.throws(()=>putStory(z,r),/已经收纳/);
    assert.throws(()=>putStory(z,{...r,receipt:'other'}),/已在/);putStory(z,{...r,receipt:'other'},{additional:true});assert.equal(z.背包.length,2);assert.equal(z.背包[0].价格,1);
});
test('1.1 pending identification does not duplicate and imported skill survives original snapshots',()=>{
    const [r]=collectCandidates([{...sourceRow,kind:'skill',grade:'仙品'}],sources,'古城');const z={功法库:[],面板账本:{3:{snap:{功法库:[]}}}};putStory(z,r);assert.equal(z.功法库[0].上限,2000);assert.equal(z.面板账本[3].snap.功法库.length,1);
    assert.throws(()=>bookStory(z,r,true),/同名功法/);
});
test('1.1 migration preserves legacy target, creates stable identities, repeat migration idempotent',()=>{
    const z={当前世界:'甲',恋爱目标:{姓名:'小雨',好感度:40}};const m=migrateLedger(z,1);assert.equal(m.to,2);assert.equal(m.ledger.羁绊库.length,1);assert.equal(z.羁绊库,undefined);
    migrateBonds(m.ledger);assert.equal(m.ledger.羁绊库.length,1);
});
test('1.1 switching incoming target retains previous data; different worlds do not merge',()=>{
    const old={当前世界:'甲',恋爱目标:{姓名:'小雨',好感度:40}};const next=clone(old);next.恋爱目标={姓名:'小雪',好感度:20};syncBonds(next,old);assert.equal(next.羁绊库.length,2);assert.equal(next.羁绊库.find(p=>p.姓名==='小雨').好感度,40);
    keepPerson(next,{姓名:'小雨',世界:'乙',好感度:3});assert.equal(next.羁绊库.length,3);
});
test('1.1 view is read-only; members and summons remain non-romance identities',()=>{
    // 1.1.2: chat-group members are no longer listed until the player pulls them in (see tests/v112.test.js)
    const z={恋爱目标:{姓名:'甲'},聊天群:{成员:[{id:'g1',名称:'乙'}]},打手:[{名称:'丙'}]};const old=JSON.stringify(z);const list=listBonds(z);assert.equal(list.length,2);assert.equal(JSON.stringify(z),old);assert.equal(list.find(x=>x.姓名==='乙'),undefined);assert.equal(list.find(x=>x.姓名==='丙').关系,'打手');
});
test('1.1 manual person edits not overwritten by stale active mirror on view',()=>{
    const z={当前世界:'甲',恋爱目标:{姓名:'小雨',好感度:40}};migrateBonds(z);keepPerson(z,{姓名:'小雨',世界:'甲',好感度:70});assert.equal(listBonds(z)[0].好感度,70);
});
test('1.1 record summaries exclude refresh, include only selected, merge recycle',()=>{
    const s=summarizeRecords([{kind:'refresh',selected:true,text:'商城刷新'},{kind:'items',selected:false,text:'未选择的购买'},{kind:'recycle',selected:true,text:'回收：A'},{kind:'recycle',selected:true,text:'分解：B'}]);assert.doesNotMatch(s,/商城刷新|未选择/);assert.match(s,/2 条/);
});
test('1.1 historical input cleanup only recognizes exact system wrapper',()=>{
    const story='正文中有人说：商城刷新';assert.equal(compactLegacyOperation(story),story);
    const raw='[系统操作：本次消费/抽取记录如下。旧说明\n\n1. 🛒 商城刷新: 已扣500\n2. 购买: 钥匙\n【本次涉及模块关键词：商城 打手】\n注意：以上数据已同步，无需再更新面板数据。]';const s=compactLegacyOperation(raw);assert.doesNotMatch(s,/商城刷新|关键词/);assert.match(s,/钥匙/);
});
test('1.1 touch window geometry allows real resizing and remains visible',()=>{
    const v={x:0,y:0,w:390,h:700};const b=clampBox({x:900,y:900,w:240,h:280},v);assert.equal(b.w,240);assert.ok(b.x+b.w<=390&&b.y+b.h<=700);
    assert.equal(launcherPosition({edge:'left',tucked:true},v).x,-46);assert.equal(launcherPosition({edge:'right',tucked:true},v).x,372);
});
test('1.1 output parser does not call every empty response reasoning',()=>{
    assert.throws(()=>completionText({choices:[{finish_reason:'length',message:{content:''}}]},300),/未提供足够信息/);
    assert.throws(()=>completionText({zt_reasoning_present:true,choices:[{finish_reason:'length',message:{content:''}}]},300),/思考内容/);
    assert.equal(completionText({choices:[{message:{content:[{text:'成功'}]}}]},4096),'成功');
});
test('1.1 memory aliases accepted but original evidence and schema gates remain',()=>{
    const obj={upserts:[{key:'test',kind:'event',status:'已完成',text:'取得钥匙',evidence:'你收下了青铜钥匙'}]};const core=memoryCore(original.ZhuTianMemoryCore);assert.equal(core.validate(JSON.stringify(obj),sources[0].text)[0].status,'resolved');
    obj.upserts[0].kind='unknown';assert.throws(()=>core.validate(JSON.stringify(obj),sources[0].text),/旧记忆保留/);
    obj.upserts[0].kind='event';obj.upserts[0].evidence='虚构的事件';assert.throws(()=>core.validate(JSON.stringify(obj),sources[0].text),/证据/);
});
test('1.1 worldbook native update preserves custom entries, flags and top-level metadata',()=>{
    const originalRules=original.ZhuTianBuiltinRules, next=latestRules(originalRules).rules;
    const shop=next.find(r=>r.comment==='09｜商城｜系统商城');assert.match(shop.content,/禁止为了平衡/);assert.doesNotMatch(shop.content,/灵品及以上必须至少带一条限制/);
    const old={name:'custom',entries:{0:{comment:shop.comment,content:'my edit',disable:true},1:{comment:'我的条目',content:'不要删除',disable:false}}};const m=mergeWorldbook(old,next);assert.equal(m.book.name,'custom');assert.ok(Object.values(m.book.entries).some(e=>e.comment==='我的条目'));assert.equal(Object.values(m.book.entries).find(e=>e.comment===shop.comment).disable,true);
});
test('1.1 late model results reject changed chat before invoking a writer',async()=>{
    const chat=[{mes:'原文'}];let writes=0;
    const app={adapter:{context:()=>({chat}),currentIdentity:()=> 'a',ledger:()=>({}),isGenerating:()=>false},bridge:{updateVariablesWith:()=>writes++}};
    const token=capture(app);chat[0].mes='改过';assert.throws(()=>assertCapture(app,token),/已变化/);await assert.rejects(()=>checkedCommit(app,token,()=>{}));assert.equal(writes,0);
});

test('1.1 inherited legacy ID/stats do not overwrite another person on bind',()=>{
    const old={当前世界:'甲',恋爱目标:{姓名:'小雨',好感度:70}};migrateBonds(old);old.恋爱目标={...old.羁绊库[0]};
    const next=clone(old);next.恋爱目标.姓名='小雪';syncBonds(next,old);
    assert.equal(next.羁绊库.length,2);assert.notEqual(next.当前羁绊ID,old.当前羁绊ID);assert.notEqual(next.恋爱目标.好感度,70);
    assert.equal(next.羁绊库.find(x=>x.姓名==='小雨').好感度,70);
});
test('1.1 source receipts survive API-key-stripping export',async()=>{
    const {buildBackup}=await import('../src/data-io.js');const z={};const [r]=collectCandidates([{...sourceRow,grade:'灵品'}],sources,'古城');putStory(z,r);
    const b=buildBackup({variables:{诸天系统:z}});assert.equal(b.chat.variables.诸天系统.剧情收纳库[0].receipt,r.receipt);assert.ok(r.receipt);
});
test('1.1 model variable directives cannot erase native receipts/catalog',async()=>{
    const {planOperation}=await import('../src/ledger-plan.js');
    const v={诸天系统:{系统点:1000,背包:[],剧情收纳库:[{receipt:'r1'}],商品历史:[{name:'A'}],羁绊库:[]}};
    const p=await planOperation(v,[{name:'test',is_user:false,mes:'<ZhuTianPanel>\n变量更新：剧情收纳库=无; 商品历史=无; 羁绊库=无\n</ZhuTianPanel>'}],'panel');
    assert.deepEqual(p.variables.诸天系统.剧情收纳库,v.诸天系统.剧情收纳库);assert.deepEqual(p.variables.诸天系统.商品历史,v.诸天系统.商品历史);
});
test('1.1 guarded purchase also enforces forbidden acquisition (no alternate-path bypass)',async()=>{
    const {planOperation}=await import('../src/ledger-plan.js');const v={诸天系统:{系统点:2e10,背包:[],专属资源:{因果筹码:2},商城库存:[{名称:'测试禁忌',品阶:'禁忌',价格:1e10,特殊代价:{resource:'因果筹码',amount:1}}]}};
    const p=await planOperation(v,[],'buy',0);assert.equal(p.balance,1e10);assert.equal(p.variables.诸天系统.专属资源.因果筹码,1);assert.match(p.detail,/一次性支付/);
    delete v.诸天系统.商城库存[0].特殊代价;await assert.rejects(()=>planOperation(v,[],'buy',0),/获得代价/);
});

 test('1.1 input shim removes only module hint wrapper, leaves operation/body intact',async()=>{
 const {trimModuleHints}=await import('../src/operation-records.js');
 assert.equal(trimModuleHints('正文关键词：商城；【模块关键词：商城 打手】购买：钥匙'), '正文关键词：商城；购买：钥匙');
 assert.equal(trimModuleHints('【剧情】世界书关键词不可删'), '【剧情】世界书关键词不可删');
});
test('1.1 worldbook merge preserves customized keys and insertion settings',()=>{
 const latest=latestRules(original.ZhuTianBuiltinRules).rules;const old={entries:{0:{...latest[8],content:'old',key:['my-key'],position:1,depth:7,disable:true}}};
 const row=Object.values(mergeWorldbook(old,latest).book.entries).find(e=>e.comment===latest[8].comment);
 assert.deepEqual(row.key,['my-key']);assert.equal(row.position,1);assert.equal(row.depth,7);assert.equal(row.content,latest[8].content);
});

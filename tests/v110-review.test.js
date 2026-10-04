// Second pre-transfer audit: negative cases that previously escaped happy-path tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import { syncBonds, migrateBonds } from '../src/bonds-data.js';
import { mergeWorldbook } from '../src/worldbook.js';
import { planOperation } from '../src/ledger-plan.js';
import { stripSecrets, DataIO, BACKUP_FORMAT } from '../src/data-io.js';
import { Appraise } from '../src/appraise.js';
import { Bridge } from '../src/th-bridge.js';
import { ID, STORAGE, identity } from '../src/contracts.js';
import { proxiedFetch } from '../src/assistant-host.js';
import { classifyAssistant } from '../src/api-routes.js';

const copy = structuredClone;
test('review: same-name target with explicit other world gets distinct ID', () => {
 const old={当前世界:'甲',恋爱目标:{姓名:'小雨',世界:'甲',好感度:80}};migrateBonds(old);old.恋爱目标={...old.羁绊库[0]};
 const next=copy(old);next.当前世界='乙';next.恋爱目标={姓名:'小雨',世界:'乙',好感度:10};syncBonds(next,old);
 assert.equal(next.羁绊库.length,2);assert.equal(next.恋爱目标.世界,'乙');assert.equal(next.羁绊库.find(x=>x.世界==='甲').好感度,80);
});
test('review: worldbook duplicate built-in comments do not silently delete a custom row', () => {
 const latest=[{comment:'shop',content:'new'}];const old={entries:{0:{comment:'shop',content:'old'},1:{comment:'shop',content:'custom-duplicate'}}};
 const r=mergeWorldbook(old,latest);assert.equal(Object.keys(r.book.entries).length,2);assert.ok(Object.values(r.book.entries).some(x=>x.content==='custom-duplicate'));
});
for(const n of [undefined,NaN,'broken',0.5]) test(`review: forbidden purchase rejects invalid acquisition resource ${String(n)}`,async()=>{
 const v={诸天系统:{系统点:2e10,背包:[],专属资源:{因果筹码:n},商城库存:[{名称:'禁忌测试',品阶:'禁忌',价格:1e10,特殊代价:{resource:'因果筹码',amount:1}}]}};
 await assert.rejects(()=>planOperation(v,[],'buy',0),/获得条件/);
});
test('review: export preserves a literal __proto__ world key without changing prototypes',()=>{
 const x=JSON.parse('{"世界品阶映射":{"__proto__":{"天阶":"仙品"}}}');const out=stripSecrets(x);
 assert.ok(Object.hasOwn(out.世界品阶映射,'__proto__'));assert.equal(Object.getPrototypeOf(out.世界品阶映射),Object.prototype);
});
test('review: appraisal result arriving in another chat must not invoke writer',async()=>{
 let id='a',writes=0;const chat=[{mes:'evidence'}],z={系统点:10,背包:[]};
 const app={adapter:{currentIdentity:()=>id,context:()=>({chat}),ledger:()=>z,isGenerating:()=>false},bridge:{getVariables:()=>({诸天系统:z}),generateRaw:async()=>{id='b';return '仙品|明确证据';}}};
 const a=new Appraise(app);a.write=async()=>{writes++;return [];};
 await assert.rejects(()=>a.appraise({kind:'item',name:'钥匙',grade:'凡品',desc:'剧情钥匙'}),/变化|切换/);assert.equal(writes,0);
});
function context(id) {return {characterId:0,characters:[{avatar:'fixture'}],getCurrentChatId:()=>id,chat:[],chatMetadata:{variables:{诸天系统:{系统点:100,背包:[]}},[STORAGE]:{ledgerSchema:2}},saveMetadata:async()=>{}};}
test('review: import chat switch during backup rejects before writer',async()=>{
 let c=context('a'),writes=0;const app={adapter:{context:()=>c,currentIdentity:()=>identity(c),notify(){}},settings:{all:{},get(){},set(){}},bridge:{snapshot:async()=>{c=context('b');},getVariables:()=>c.chatMetadata.variables,updateVariablesWith:async f=>{writes++;c.chatMetadata.variables=f(copy(c.chatMetadata.variables));}}};
 const io=new DataIO(app);await assert.rejects(()=>io.import({format:BACKUP_FORMAT,formatVersion:1,chat:{ledgerSchema:2,variables:{诸天系统:{系统点:1,背包:[]}}}},{settings:false}),/切换|变化/);assert.equal(writes,0);
});
test('review: rollback chat switch during backup rejects before writer',async()=>{
 let c=context('a'),writes=0;const b=new Bridge({context:()=>c,currentIdentity:()=>identity(c)},{});b.backups=()=>[{at:1,ledger:{系统点:1}}];b.snapshot=async()=>{c=context('b');return {at:2};};b.updateVariablesWith=async()=>{writes++;};
 await assert.rejects(()=>b.restoreBackup(1),/切换|变化/);assert.equal(writes,0);
});
test('review: whole-ledger replacement must not merge previous romance into imported save',async()=>{
 const c=context('a');c.chatMetadata.variables.诸天系统.恋爱目标={姓名:'旧目标',世界:'甲'};const oldNav=globalThis.navigator;
 Object.defineProperty(globalThis,'navigator',{value:{locks:{request:async(_n,_o,f)=>f()}},configurable:true});
 try{const b=new Bridge({context:()=>c,notify(){}},{});await b.updateVariablesWith(v=>{v.诸天系统={系统点:7,羁绊库:[],恋爱目标:{姓名:'新目标',世界:'乙'}};return v;},{replaceLedger:true});assert.equal(c.chatMetadata.variables.诸天系统.羁绊库.length,0);}
 finally{Object.defineProperty(globalThis,'navigator',{value:oldNav,configurable:true});}
});
test('review: assistant default explicit cap is respected even in legacy connection test',async()=>{
 const old=globalThis.fetch;const seen=[];globalThis.location??={href:'http://localhost/',origin:'http://localhost'};
 globalThis.fetch=async(_u,o)=>{seen.push(JSON.parse(o.body));return new Response(JSON.stringify({choices:[{message:{content:'成功'}}]}),{headers:{'Content-Type':'application/json'}});};
 try{const fetcher=proxiedFetch({getVariables:()=>({诸天系统_API:{maxTokens:1000}})});await fetcher('https://fixture.invalid/v1/chat/completions',{method:'POST',body:JSON.stringify({messages:[{role:'user',content:'回复两个字：成功'}],max_tokens:20})});assert.equal(seen[0].max_tokens,1000);}
 finally{globalThis.fetch=old;}
});
test('review: memory semantic keys survive key-free export',async()=>{
 const {buildBackup}=await import('../src/data-io.js');
 const record={key:'事件/钥匙',kind:'事件',status:'active',text:'收下钥匙',evidence:'你收下了青铜钥匙'};
 const out=buildBackup({memoryNs:'memory',variables:{memory:{frames:[{upserts:[record]}]}},settings:{scriptVariables:{api:{key:'fixture-api-secret'}}}});
 assert.equal(out.chat.variables.memory.frames[0].upserts[0].key,record.key);assert.equal(out.settings.scriptVariables.api.key,undefined);
});
test('review: guarded ledger service cannot downgrade schema or write newer schemas',async()=>{
 const {LedgerService}=await import('../src/ledger-service.js');const c=context('a');c.chatMetadata[STORAGE].ledgerSchema=99;
 const oldNav=globalThis.navigator,oldDoc=globalThis.document;
 Object.defineProperty(globalThis,'navigator',{value:{locks:{}},configurable:true});globalThis.document={querySelector:()=>null,querySelectorAll:()=>[]};
 try {const service=new LedgerService({isGenerating:()=>false,currentIdentity:()=>identity(c),context:()=>c,settings:()=>({nativeLedgerEnabled:true})});assert.throws(()=>service.ready(),/结构版本|更新版本/);}
 finally{Object.defineProperty(globalThis,'navigator',{value:oldNav,configurable:true});globalThis.document=oldDoc;}
});
test('review: pending duplicate source retains explicit additional-lot consent',async()=>{
 const {putStory}=await import('../src/story-collect.js');const z={背包:[{名称:'钥匙',数量:1}]};
 const row=putStory(z,{receipt:'another',name:'钥匙',kind:'item',grade:'待鉴定',quantity:1},{additional:true});assert.equal(row.additional,true);
});
test('review: retired frame scopes release resources once and remain bounded',async()=>{
 const {frameScope,releaseFrames}=await import('../src/action-support.js');const owner={};let cleaned=0;
 const d1={},w1=new EventTarget(),f1={isConnected:true,contentDocument:d1,contentWindow:w1};frameScope(owner,f1,d1).push(()=>cleaned++);
 f1.isConnected=false;const d2={},w2=new EventTarget(),f2={isConnected:true,contentDocument:d2,contentWindow:w2};frameScope(owner,f2,d2).push(()=>cleaned++);
 assert.equal(cleaned,1);assert.equal(owner.frames.size,1);w2.dispatchEvent(new Event('pagehide'));releaseFrames(owner);assert.equal(cleaned,2);assert.equal(owner.frames.size,0);
});
test('review: schema marker is not reported saved when server readback fails',async()=>{
 const c=context('a');c.chatMetadata[STORAGE].ledgerSchema=1; c.getRequestHeaders=()=>({});const uncertain=new Set();const old=globalThis.fetch;globalThis.fetch=async()=>new Response('{}',{status:503});
 try{const io=new DataIO({adapter:{context:()=>c,currentIdentity:()=>identity(c),transactions:{uncertain}}});await assert.rejects(()=>io.setSchema(2),/未确认/);assert.ok(uncertain.has(identity(c)));}
 finally{globalThis.fetch=old;}
});
test('review: import refuses an intervening write after its backup',async()=>{
 const c=context('a');const app={adapter:{context:()=>c,currentIdentity:()=>identity(c),notify(){}},settings:{all:{},get(){},set(){}},bridge:{snapshot:async()=>{c.chatMetadata.variables.诸天系统.系统点=200;},getVariables:()=>copy(c.chatMetadata.variables),updateVariablesWith:async f=>{const draft=copy(c.chatMetadata.variables);c.chatMetadata.variables=f(draft);}}};
 const io=new DataIO(app);await assert.rejects(()=>io.import({format:BACKUP_FORMAT,formatVersion:1,chat:{ledgerSchema:2,variables:{诸天系统:{系统点:1,背包:[]}}}},{settings:false}),/账本已变化/);assert.equal(c.chatMetadata.variables.诸天系统.系统点,200);
});
test('review: appraisal uses item source-world mapping, not current travel world',async()=>{
 const {candidates,appraisePrompt}=await import('../src/appraise.js');const z={当前世界:'乙',世界品阶映射:{甲:{天阶:'仙品'},乙:{天阶:'灵品'}},背包:[{名称:'钥匙',来源:'剧情收纳',来源世界:'甲',原世界品阶:'天阶',品级:'凡品',数量:1}]};
 const [entry]=candidates(z).items;assert.equal(entry.world,'甲');const prompt=appraisePrompt(entry,z).user;assert.match(prompt,/原世界品阶：天阶/);assert.match(prompt,/"天阶":"仙品"/);assert.doesNotMatch(prompt,/"天阶":"灵品"/);
});
test('review: module switches do not depend on upgrade-local disk reader',async()=>{
 const {Features}=await import('../src/features.js');const book={entries:{0:{comment:'08｜核心｜神豪挥霍',content:'keep',disable:true}}};let saved;
 const c={loadWorldInfo:async()=>saved||book,saveWorldInfo:async(_n,b)=>{saved=b;},updateWorldInfoList:async()=>{}};
 const f=new Features({adapter:{context:()=>c}});await f.setModules({'08｜核心｜神豪挥霍':true});assert.equal(saved.entries[0].disable,false);
});

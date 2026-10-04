import test from 'node:test';
import assert from 'node:assert/strict';
import { Bridge } from '../src/th-bridge.js';
import { HubGroup } from '../src/hub-group.js';
import { candidates, regrade } from '../src/appraise.js';
import { planOperation } from '../src/ledger-plan.js';
import { bagAdd } from '../src/ledger-ops.js';
import { identity, STORAGE } from '../src/contracts.js';
import { buildReport, ErrorLog } from '../src/diag-report.js';
import { Settings } from '../src/settings.js';
const copy = structuredClone;
function globals(values) {
 const old = Object.fromEntries(Object.keys(values).map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));
 for(const [k,value] of Object.entries(values)) Object.defineProperty(globalThis,k,{value,writable:true,configurable:true});
 return ()=>{for(const [k,d] of Object.entries(old)) d?Object.defineProperty(globalThis,k,d):delete globalThis[k];};
}
function fixture() {
 const make=id=>({characterId:0,characters:[{avatar:id+'.png'}],getCurrentChatId:()=>id,chat:[{mes:'evidence',swipe_id:0}],chatMetadata:{variables:{诸天系统:{系统点:100,背包:[],聊天群:{成员:[{id:'same',名称:'群员',世界:id,档:1,好感:20}]}}},[STORAGE]:{ledgerSchema:2}},extensionSettings:{variables:{global:{}}},getRequestHeaders:()=>({}),saveSettingsDebounced(){}});
 const chats={a:make('a'),b:make('b')},disk={a:copy(chats.a.chatMetadata),b:copy(chats.b.chatMetadata)};
 let current=chats.a,saves=0,reads=0;
 for(const [id,c] of Object.entries(chats)) c.saveMetadata=async()=>{saves++;disk[id]=copy(c.chatMetadata);};
 const adapter={context:()=>current,currentIdentity:()=>identity(current),ledger:()=>current.chatMetadata.variables.诸天系统,isGenerating:()=>false,transactions:{uncertain:new Set()},notify(){}};
 const bridge=new Bridge(adapter,{scriptVariables:()=>({})});
 const restore=globals({isSecureContext:true,navigator:{locks:{request:async(_n,_o,fn)=>fn()}},SillyTavern:{getContext:()=>current},fetch:async(_u,o)=>{reads++;const id=JSON.parse(o.body).file_name;return Response.json([{chat_metadata:copy(disk[id])}]);}});
 return {chats,disk,adapter,bridge,restore,switch:()=>{current=chats.b;},get saves(){return saves;},get reads(){return reads;}};
}
for(const action of ['help','privateSay','live','round']) test(`patch3: delayed group ${action} never writes another chat`,async()=>{
 const f=fixture();try {
  const group=new HubGroup({adapter:f.adapter,bridge:f.bridge});group.paint=()=>{};group.syncPrompt=()=>{};
  let release;group.ask=()=>new Promise(r=>release=r);
  const pending=action==='help'?group.help('A的任务','same'):action==='privateSay'?group.privateSay('same','A的私聊'):action==='live'?group.live('same'):group.round('A的群聊');
  assert.equal(typeof release,'function');const b=copy(f.chats.b.chatMetadata);f.switch();release(action==='help'?'旧任务|只属于A|100点':action==='round'?'@群员: A的回复':'A的回复');
  await assert.rejects(pending,/变化|切换/);assert.deepEqual(f.chats.b.chatMetadata,b);assert.equal(f.saves,0);
 }finally{f.restore();}
});
for(const phase of ['核验期间替换','异步更新器期间','核验期间原地改动']) test(`patch3: ${phase} preserves external 100→200, retry gives 190 not 90`,async()=>{
 const f=fixture();try {
  const oldFetch=globalThis.fetch;let changed=false;
  if(phase!=='异步更新器期间')globalThis.fetch=async(...args)=>{const res=await oldFetch(...args);if(!changed){changed=true;if(phase==='核验期间替换')f.chats.a.chatMetadata.variables=copy(f.chats.a.chatMetadata.variables);f.chats.a.chatMetadata.variables.诸天系统.系统点=200;}return res;};
  await assert.rejects(()=>f.bridge.updateVariablesWith(async v=>{if(phase==='异步更新器期间')f.chats.a.chatMetadata.variables.诸天系统.系统点=200;await Promise.resolve();v.诸天系统.系统点-=10;return v;},{verify:true}),/变化|不同/);
  assert.equal(f.saves,0);assert.equal(f.adapter.ledger().系统点,200);assert.equal(f.adapter.transactions.uncertain.size,0);
  globalThis.fetch=oldFetch;f.disk.a=copy(f.chats.a.chatMetadata);
  await f.bridge.updateVariablesWith(v=>{v.诸天系统.系统点-=10;return v;},{verify:true});assert.equal(f.adapter.ledger().系统点,190);
 }finally{f.restore();}
});
function lots(){return {系统点:0,背包:[{名称:'同名古剑',品级:'凡品',数量:1,价格:1,来源:'剧情收纳 #3',收纳凭据:'proof-a',来源世界:'甲',原世界品阶:'天阶'},{名称:'同名古剑',品级:'仙品',数量:1,价格:10000000,来源:'商城'}]};}
test('patch3: appraisal retains separate source and price; real recycle totals 1000001',async()=>{
 const z=lots();regrade(z,candidates(z).items[0],'仙品');assert.equal(z.背包.length,2);assert.equal(z.背包[0].收纳凭据,'proof-a');assert.equal(z.背包[0].价格,1);
 let v={诸天系统:z};for(let i=0;i<2;i++)v=(await planOperation(v,[],'recycle',0)).variables;assert.equal(v.诸天系统.系统点,1000001);
});
test('patch3: same-name same-grade appraisal selects the correct source lot',()=>{
 const z=lots();z.背包.push({...z.背包[0],收纳凭据:'proof-b',来源世界:'乙'});
 const [a,b]=candidates(z).items;assert.notEqual(a.key,b.key);regrade(z,b,'灵品');assert.equal(z.背包[0].品级,'凡品');assert.equal(z.背包[2].品级,'灵品');
});
test('patch3: later shop acquisition does not merge into an appraised story lot',()=>{
 const z=lots();const shop=z.背包.pop();regrade(z,candidates(z).items[0],'仙品');bagAdd(z,shop);assert.equal(z.背包.length,2);assert.equal(z.背包[0].数量,1);assert.equal(z.背包[0].价格,1);
});
function device(secure,protocol,locks=true){return {isSecureContext:secure,location:{protocol,hostname:'example.invalid',port:'8000'},navigator:{userAgent:'test',language:'zh',...(locks?{locks:{request:async(_n,_o,f)=>f()}}:{})},innerWidth:390,innerHeight:844,screen:{width:390,height:844},devicePixelRatio:1};}
for(const [secure,protocol,locks] of [[true,'http:',true],[false,'http:',false],[true,'https:',false]])test(`patch3: diagnostics separate context/protocol/locks ${secure}/${protocol}/${locks}`,()=>{
 const restore=globals(device(secure,protocol,locks));try{const r=buildReport({});assert.match(r,new RegExp('安全上下文：'+(secure?'是':'否')));assert.match(r,new RegExp('连接协议：'+protocol.replace(':','')));assert.match(r,new RegExp('Web Locks：'+(locks?'可用':'不可用')));assert.doesNotMatch(r,/HTTPS：是/);}finally{restore();}
});
test('patch3: insecure settings fail before mutation, explain localhost versus phone HTTPS, and log failure',()=>{
 const restore=globals(device(false,'http:',false)),log=new ErrorLog(),old=console.warn;console.warn=(...a)=>log.push('warn',a);
 try{let saved=0;const settings=new Settings({context:()=>({extensionSettings:store,saveSettingsDebounced(){saved++;}})}),store={};const before=settings.get('palette');
 assert.throws(()=>settings.set('palette','lilith'),/当前环境无法保存.*localhost.*HTTPS/);assert.equal(saved,0);assert.equal(settings.get('palette'),before);assert.ok(log.items.length>0);assert.match(buildReport({settings,errorLog:log}),/诸天保存/);
 }finally{console.warn=old;restore();}
});
for(const action of ['help','privateSay','live','round']) test(`patch3: unchanged chat ${action} still commits`,async()=>{
 const f=fixture();try{const g=new HubGroup({adapter:f.adapter,bridge:f.bridge});g.paint=()=>{};g.syncPrompt=()=>{};g.ask=async()=>action==='help'?'新任务|去后山|100点':action==='round'?'@群员: 正常回复':'正常回复';
 if(action==='help')await g.help('求助','same');else if(action==='privateSay')await g.privateSay('same','你好');else if(action==='live')await g.live('same');else await g.round('你好');
 assert.equal(f.saves,1);assert.equal(f.disk.a.variables.诸天系统.聊天群.rev,1);assert.deepEqual(f.disk.b,f.chats.b.chatMetadata);
 }finally{f.restore();}
});
test('patch3: global variable save still works (chat guard never leaks into settings writer)',async()=>{
 const f=fixture();try{await f.bridge.updateVariablesWith(v=>{v.test='ok';return v;},{type:'global'});assert.equal(f.bridge.getVariables({type:'global'}).test,'ok');}finally{f.restore();}
});
test('patch3: chat switches while waiting for Web Lock; writer never runs on destination',async()=>{
 const f=fixture();try{navigator.locks.request=async(_n,_o,fn)=>{f.switch();return fn();};let calls=0;await assert.rejects(()=>f.bridge.updateVariablesWith(v=>{calls++;v.诸天系统.系统点=1;return v;},{verify:true}),/切换/);assert.equal(calls,0);assert.equal(f.saves,0);assert.equal(f.adapter.ledger().系统点,100);}finally{f.restore();}
});
test('patch3: settings failure is logged and rolled back without logging config values',async()=>{
 const f=fixture(),log=new ErrorLog(),old=console.warn;console.warn=(...a)=>log.push('warn',a);try{f.chats.a.saveSettingsDebounced=async()=>{throw Error('do-not-log-private-settings');};await assert.rejects(()=>f.bridge.updateVariablesWith(v=>{v.secret='private-value';return v;},{type:'global'}));assert.deepEqual(f.bridge.getVariables({type:'global'}),{});assert.equal(log.items.length,1);assert.doesNotMatch(JSON.stringify(log.items),/private-value|do-not-log/);}finally{console.warn=old;f.restore();}
});
test('patch3: secure context without working locks rejects script saves and explains browser support',async()=>{
 const f=fixture();try{navigator.locks={};await assert.rejects(()=>f.bridge.updateVariablesWith(v=>v,{type:'script'}),/安全上下文.*Web Locks 不可用.*浏览器/);assert.equal(f.saves,0);}finally{f.restore();}
});
test('patch3: legacy ambiguous item key refuses to select the wrong duplicate',()=>{
 const z=lots();z.背包.push({...z.背包[0],收纳凭据:'other'});assert.throws(()=>regrade(z,{kind:'item',key:'同名古剑|凡品',name:'同名古剑'},'灵品'),/来源不唯一/);assert.equal(z.背包[0].品级,'凡品');
});
test('patch3: guarded purchase planner also keeps story and shop lots separate',async()=>{
 const z=lots();z.系统点=2e7;z.背包.pop();regrade(z,candidates(z).items[0],'仙品');z.商城库存=[{名称:'同名古剑',品阶:'仙品',价格:10000000}];
 const plan=await planOperation({诸天系统:z},[],'buy',0);assert.equal(plan.variables.诸天系统.背包.length,2);assert.equal(plan.variables.诸天系统.背包[0].价格,1);
});
test('patch3: host-caught debounced settings failure is recorded, sanitized and listener cleanup restores console',()=>{
 const restore=globals({addEventListener(){},removeEventListener(){}}),old=console.error;console.error=()=>{};const stub=console.error,log=new ErrorLog().start();try{console.error('Error saving settings:',Error('private-config'));assert.equal(log.items.length,1);assert.equal(log.items[0].kind,'save');assert.doesNotMatch(log.items[0].text,/private-config/);}finally{log.dispose();assert.equal(console.error,stub);console.error=old;restore();}
});

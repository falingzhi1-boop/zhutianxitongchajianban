import {assertSaveEnvironment} from './save-environment.js';
import {STORAGE,LEDGER_SCHEMA,identity,inert} from './contracts.js';
import {clone,stable,digest,history,assertHistory,planOperation} from './ledger-plan.js';
export class LedgerService {
 #drafts=new Map();
 constructor(adapter){this.adapter=adapter;this.uncertain=new Set();}
 get receipts(){return this.adapter.settings().ledgerReceipts||{};}
 legacyActive(){
  if(document.querySelector('#zt-memory-assistant-v1:not([data-zt-native])'))return true; // our native Lilith is tagged, a real old TH helper is not
  for(const frame of document.querySelectorAll('iframe[id^="TH-message--"]'))try{if(typeof frame.contentWindow?.ztApplyPanel==='function')return true;}catch{return true;}
  return false;
 }
 ready(){const a=this.adapter;const schema=Number(a.context()?.chatMetadata?.[STORAGE]?.ledgerSchema)||0;if(schema>LEDGER_SCHEMA)throw Error('账本结构版本来自更新版本，禁止写入。');if(a.dead||a.busy||a.isGenerating())throw Error('扩展已停用或已有操作正在进行。');if(!a.currentIdentity())throw Error('只支持单角色聊天。');if(!a.settings().nativeLedgerEnabled)throw Error('请先备份聊天、停用旧引擎并明确启用原生结算。');if(this.legacyActive())throw Error('检测到旧状态栏或旧助手，拒绝双引擎同时写账本。');assertSaveEnvironment({requireLocks:true});if(this.uncertain.has(a.currentIdentity()))throw Error('此前写入状态不明，已冻结本会话交易。请先重载并核对服务器记录，不要重试扣款。');}
 state(){const c=this.adapter.context();return stable([identity(c),c.chat,c.chatMetadata]);}
 async request(endpoint,target,extra={}){const r=await fetch('/api/chats/'+endpoint,{method:'POST',headers:this.adapter.context().getRequestHeaders(),credentials:'same-origin',cache:'no-store',body:JSON.stringify({...target,...extra}),signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error(`宿主存档接口 ${endpoint} 返回 ${r.status}`);return r.json();}
 async prepare(kind,index){
  this.ready();const a=this.adapter,c=a.context(),chat=clone(c.chat),metadata=clone(c.chatMetadata),stamp=this.state(),epoch=a.generationEpoch;
  const id=crypto.randomUUID(),target={avatar_url:c.characters[c.characterId].avatar,file_name:c.getCurrentChatId()};
  await assertHistory(chat,this.receipts);
  if(kind==='panel'&&a.statusbarActive?.())throw Error('原生状态栏正在运行，它是剧情结算的唯一引擎（与原版一致）；终端不再重复核算同一条正文。');
  if(kind==='panel'){
   const last=chat.map((m,i)=>({m,i})).filter(x=>!x.m.is_system).at(-1)?.i;
   const logicalHistory=history(chat),logicalHash=await digest(logicalHistory);
   if(Object.values(this.receipts).some(r=>r.kind==='panel'&&(r.sourceMessage===last||(r.historyLength===logicalHistory.length&&r.historyHash===logicalHash))))throw Error('这条正文已核算，原生凭据阻止重复结算；道具后来消耗也不会补发。');
  }
  const plan=await planOperation(metadata.variables,chat,kind,Number(index));
  if(!plan.changed&&kind!=='use')throw Error('账本没有新的可提交变化。');
  const h=history(chat),proof={id,kind,title:plan.title,detail:plan.detail,delta:plan.delta,balance:plan.balance,sourceMessage:plan.sourceMessage,historyLength:h.length,historyHash:await digest(h),variablesHash:await digest(plan.variables),at:Date.now(),schema:1};
  this.ready();if(this.state()!==stamp||a.generationEpoch!==epoch)throw Error('正文或账本已变化，请重新预览。');
  this.#drafts.clear();this.#drafts.set(id,{id,target,identity:identity(c),stamp,epoch,chat,metadata,plan,proof});
  return Object.freeze({id,...clone(proof)});
 }
 async commit(id){
  this.ready();const d=this.#drafts.get(id);if(!d)throw Error('预览已失效或已经提交，不会重复执行。');
  const a=this.adapter;const guard=()=>{if(this.uncertain.has(d.identity)||Number(a.context()?.chatMetadata?.[STORAGE]?.ledgerSchema)>LEDGER_SCHEMA||a.dead||a.isGenerating()||a.currentIdentity()!==d.identity||a.generationEpoch!==d.epoch||this.state()!==d.stamp||this.legacyActive())throw Error('聊天、账本或结算权限已变化，请重新预览。');};
  a.busy=true;a.notify();
  try{return await navigator.locks.request('zhutian-ledger:'+d.identity,{ifAvailable:true},async lock=>{
   if(!lock)throw Error('其他标签正在处理该聊天，请稍后重新预览。');
   guard();const disk=await this.request('get',d.target);guard();
   if(!Array.isArray(disk)||!disk[0]?.chat_metadata||stable(disk.slice(1))!==stable(d.chat)||stable(disk[0].chat_metadata)!==stable(d.metadata))throw Error('服务器存档与预览不一致。请等待酒馆保存或重载后再预览；未写入。');
   const metadata=clone(d.metadata);metadata.variables=clone(d.plan.variables);metadata[STORAGE]={...metadata[STORAGE],ledgerSchema:LEDGER_SCHEMA,ledgerReceipts:{...(metadata[STORAGE]?.ledgerReceipts||{}),[id]:clone(d.proof)}};
   const text=inert(`【诸天系统·已执行结算】\n${d.plan.title}\n${d.plan.detail}\n系统点变化：${d.plan.delta>=0?'+':''}${d.plan.delta}；余额：${d.plan.balance}\n凭据：${id}\n这是系统记录，不是角色或模型回复。账本已执行，不要再次扣费或发奖。`).replaceAll('[','［').replaceAll(']','］').replaceAll('`','｀');
   const message={name:'诸天系统',is_user:false,is_system:true,send_date:new Date().toISOString(),mes:text,extra:{isSmallSys:true,[STORAGE]:{kind:'ledger-receipt',id,version:1}}};
   const next=[{...clone(disk[0]),chat_metadata:metadata},...clone(d.chat),message];
   // Consume approval before issuing a possibly-ambiguous write. No retry and no compensating rollback.
   guard();this.#drafts.delete(id);this.uncertain.add(d.identity);
   const saved=await this.request('save',d.target,{chat:next,force:false});if(!saved.ok)throw Error('宿主未确认写入。');
   let verify=await this.request('get',d.target);
   // 1.1.4: one more read after a short pause (an older SillyTavern save of this chat may still have been in flight); never re-written here
   if(!Array.isArray(verify)||stable(verify)!==stable(next)){await new Promise(r=>setTimeout(r,800));verify=await this.request('get',d.target);}
   if(!Array.isArray(verify)||stable(verify)!==stable(next))throw Error('存档回读不一致，已冻结交易；请到 设置 → 诊断与维护 →「核对并解冻账本」核对；不会自动重试。');
   this.uncertain.delete(d.identity);
   // The target is captured, never inferred again after await. Do not copy into another chat.
   if(a.currentIdentity()===d.identity&&this.state()===d.stamp&&!a.dead){
    const c=a.context();c.chatMetadata.variables=clone(metadata.variables);c.chatMetadata[STORAGE]=clone(metadata[STORAGE]);c.chat.push(message);await c.addOneMessage(message);a.notify();
   }else throw Error('原聊天已保存并核实，但当前上下文发生变化。请重载原聊天查看记录；不要再次提交。');
   return clone(d.proof);
  });}catch(error){if(this.uncertain.has(d.identity))throw Error('写入状态尚未核实，已冻结交易。请不要继续操作此聊天，先重载核对服务器记录；不会自动重试。'+error.message);throw error;}finally{a.busy=false;a.notify();}
 }
 cancelPreview(){this.#drafts.clear();}
 dispose(){this.#drafts.clear();}
}

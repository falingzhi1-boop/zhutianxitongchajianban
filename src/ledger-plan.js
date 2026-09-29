import original from '../vendor/original/runtime.js';
import {createLedgerKernel} from '../vendor/original/ledger-kernel.js';
import {awardPlan,grantRewards} from '../vendor/original/reward-kernel.js';
export const clone=x=>structuredClone(x);
export const stable=x=>JSON.stringify(x,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
export async function digest(x){const bytes=new TextEncoder().encode(stable(x));return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join('');}
export const history=chat=>chat.filter(m=>!(m.is_system&&m.extra?.zhutianCovenantTerminal?.kind==='ledger-receipt')).map(m=>({name:m.name,is_user:!!m.is_user,is_system:!!m.is_system,swipe_id:m.swipe_id,mes:m.mes}));
export async function assertHistory(chat,receipts){const h=history(chat);for(const r of Object.values(receipts||{})){if(!Number.isSafeInteger(r.historyLength)||r.historyLength>h.length||await digest(h.slice(0,r.historyLength))!==r.historyHash)throw Error('正文分支与已结算凭据不一致。已冻结交易；不会自动回滚、重复扣费或再次发奖，请在备份上人工核对。');}}
function validLedger(vars){const s=vars?.诸天系统;if(!s||Array.isArray(s)||!Number.isSafeInteger(s.系统点)||s.系统点<0)throw Error('需要现有、有效的原版账本和非负整数系统点；不会生成模拟余额。');return s;}
export async function planOperation(vars,chat,kind,index){
 const before=clone(vars),next=clone(vars),s=validLedger(next);
 let info={id:chat.length-1,latest:true},title='',detail='',sourceMessage=null,given=0;
 const k=createLedgerKernel(info,fn=>{fn(next);k.ztDerive(next);return Promise.resolve(next);});
 if(kind==='panel'){
  const source=chat.map((m,i)=>({m,i})).filter(x=>!x.m.is_system).at(-1);
  if(!source||source.m.is_user)throw Error('只处理当前最后一条已保存的模型角色消息；用户消息不能作为结算源。');
  const raw=source.m.mes;const parsed=original.ZhuTianLedgerAgent.parse(raw);if(!parsed)throw Error('该回复没有唯一的 ZhuTianPanel 数据块。');
  info.id=source.i;sourceMessage=source.i;
  const fields=k.ztParsePanel(parsed.block),batch=k.ztTaskBatch(fields);if(batch.error)throw Error(batch.error);
  delete s.任务同步提示;
  await k.ztApplyPanel(null,fields,parsed.block);
  if(s.任务同步提示)throw Error(s.任务同步提示);
  // All rewards are planned on a clone. A missing promise/evidence rolls back the entire plan,
  // including points. Nothing from this function touches the host.
  const job={id:source.i,body:original.ZhuTianMemoryCore.clean(raw)};
  const rewards=awardPlan(job,parsed.updates,s);
  given=grantRewards(next,job,k.ztHash(parsed.block),rewards).granted;
  title='同步原版剧情结算';detail=`源消息 #${source.i}；任务更新 ${batch.items.length} 条；本次实物入包 ${given} 件。`;
 }else if(kind==='buy'){
  const item=s.商城库存?.[index];if(!item||item.已购)throw Error('商品已售出或库存已经变化。');
  if(!Number.isSafeInteger(Number(item.价格))||Number(item.价格)<0)throw Error('商品价格无效。');
  const discount=k.ztDiscount(s),price=Math.ceil(Number(item.价格)*(100-discount)/100);
  if(s.系统点<price)throw Error('系统点不足，未购买。');
  // Same original buy handler rules: reputation discount, ceil, one unit, stable sold flag.
  s.系统点-=price;s.累计消费=(k.toNum(s.累计消费)||0)+price;s.界面记账时间=Date.now();
  k.ztBagPush(s,{名称:item.名称,品级:item.品阶||'凡品',来源:'商城',价格:price,分类:item.分类||'其他',效果:item.效果||''},1);item.已购=true;
  title='万界商城 · 购买';detail=`${item.名称} ×1；原价 ${item.价格}；名望折扣 ${discount}%；实付 ${price} 系统点。`;
 }else if(['use','recycle'].includes(kind)){
  const item=s.背包?.[index];if(!item)throw Error('背包条目已经变化。');
  const quantity=Number(item.数量??1);if(!Number.isSafeInteger(quantity)||quantity<1)throw Error('物品数量无效。');
  const consumed=kind==='recycle'||String(item.分类||'其他').includes('消耗');
  const value=kind==='recycle'?k.recycleValue(item):0;
  if(consumed){if(quantity===1)s.背包.splice(index,1);else item.数量=quantity-1;}
  if(value){s.系统点+=value;s.界面记账时间=Date.now();}
  title=kind==='recycle'?'次元行囊 · 回收':'次元行囊 · 使用';
  detail=kind==='recycle'?`${item.名称} ×1；按原版回收估值返还 ${value} 系统点。`:`${item.名称}；${consumed?'已消耗一件':'非消耗品，保留物品'}。效果说明仅供剧情参考：${item.效果||'未记录'}。`;
 }else throw Error('未知交易类型。');
 k.ztDerive(next);
 if(Array.isArray(s.背包)&&s.背包.some(item=>!Number.isSafeInteger(Number(item.数量??1))||Number(item.数量??1)<1))throw Error('背包数量超出安全范围；未写入。');
 if(!Number.isSafeInteger(s.系统点)||s.系统点<0||!Number.isSafeInteger(Number(s.累计消费??0)))throw Error('数值超出安全范围。');
 return {variables:next,title,detail,delta:s.系统点-validLedger(before).系统点,balance:s.系统点,given,sourceMessage,changed:stable(before)!==stable(next)};
}

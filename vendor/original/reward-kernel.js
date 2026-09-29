// Original award planner and original grant callback, extracted without rewriting rules.
import original from './runtime.js';
const C=original.ZhuTianMemoryCore;
const GRADES=new Set(['凡品','灵品','仙品','神品','禁忌']);
const own=(v,k)=>v!==null&&typeof v==='object'&&Object.hasOwn(v,k);
function matchesPromise(item,promised){
    const promise=promised.replace(/\s+/g,''),name=item.名称.replace(/\s+/g,'');
    const i=promise.indexOf(name);
    if(i<0)return false;
    const after=promise.slice(i+name.length);
    const before=promise.slice(0,i);
    const explicitBefore=[...GRADES].find(g=>[g,'【'+g+'】','〔'+g+'〕','（'+g+'）'].some(tag=>before.endsWith(tag)));
    const explicitAfter=[...GRADES].find(g=>['（'+g+'）','〔'+g+'〕','【'+g+'】','['+g+']'].some(tag=>after.startsWith(tag)));
    if((explicitBefore&&explicitBefore!==item.品级)||(explicitAfter&&explicitAfter!==item.品级))return false;
    if(item.品级!=='凡品'&&explicitBefore!==item.品级&&explicitAfter!==item.品级)return false;
    if(item.数量>1){
      let quantityPart=after;
      if(explicitAfter){const tag=['（'+explicitAfter+'）','〔'+explicitAfter+'〕','【'+explicitAfter+'】','['+explicitAfter+']'].find(x=>after.startsWith(x));quantityPart=after.slice(tag.length);}
      const qty=quantityPart.match(/^[×xX*](\d{1,3})(?!\d)/);
      if(Number(qty?.[1])!==item.数量)return false;
    }
    return true;
  }
function awardPlan(job,updates,ledger){
    const plan=[];
    for(const u of updates){
      const seen=new Set();
      if(!own(u,'入包奖励'))continue;
      const r=ledger.任务结算凭据?.[u.ID],task=ledger.任务库?.[u.ID];
      if(!r||r.点数!==u.结算点数||String(r.楼层)!==String(job.id)||task?.状态!=='已完成')
        throw Error('任务凭据与当前楼层不一致；实物奖励未入包');
      const evidence=u.依据.replace(/\s+/g,''),body=job.body.replace(/\s+/g,'');
      if(!body.includes(evidence))throw Error('实物奖励依据没有出现在本轮正文；未入包');
      // The task's *pre-settlement* record is in the original engine's rollback snapshot.
      // A model cannot promise a new item and self-approve it in the same reply.
      const previous=ledger.面板账本?.[String(job.id)]?.snap?.__vars?.['任务库.'+u.ID];
      const promised=typeof previous?.奖励==='string'?previous.奖励:'';
      if(!promised)throw Error('任务结算前未记录实物奖励承诺；未入包');
      if(previous.状态==='已完成')throw Error('任务在本轮之前已完成；不可再次发实物奖励');
      const items=u.入包奖励.map(x=>({名称:x.名称.trim(),品级:x.品级,数量:x.数量,分类:x.分类||'其他',效果:C.inert(C.text(x.效果||'',160))}));
      for(const item of items){
        if(!matchesPromise(item,promised))throw Error('任务预告奖励未明确约定“'+item.名称+'”的品级或数量；未入包');
        const key=item.名称+'\u0000'+item.品级;
        if(seen.has(key))throw Error('同一轮实物奖励的名称和品级重复，请人工核对；未入包');
        seen.add(key);
      }
      plan.push({id:u.ID,points:u.结算点数,items,hash:C.hash(JSON.stringify(items))});
    }
    return plan;
  }
export {awardPlan};
export function grantRewards(vars,job,expectedHash,plan){
let granted=0;const added=new Set();const ticket=0;const current=()=>true;
const mutate=vars=>{
      if(!current(job,ticket))throw Error('聊天或正文已变化；未入包');
      const s=vars.诸天系统;
      if(!s||s.面板账本?.[String(job.id)]?.h!==expectedHash)throw Error('原状态栏凭据变化；未入包');
      if(s.背包!==undefined&&!Array.isArray(s.背包))throw Error('背包结构异常；未覆盖现有记录');
      if(s.任务实物凭据!==undefined&&(!s.任务实物凭据||typeof s.任务实物凭据!=='object'||Array.isArray(s.任务实物凭据)))throw Error('实物凭据结构异常；未覆盖现有记录');
      const bag=s.背包||[],proof=s.任务实物凭据||{};
      for(const one of plan){
        const r=s.任务结算凭据?.[one.id],task=s.任务库?.[one.id];
        if(!r||r.点数!==one.points||String(r.楼层)!==String(job.id)||task?.状态!=='已完成')throw Error('任务结算已变化；未入包');
        if(own(proof,one.id)&&proof[one.id].哈希!==one.hash)throw Error('同一任务已有不同实物凭据，需人工核对');
        // A paid item can have been consumed since its receipt was written.
        // The stable per-task receipt, not the current inventory quantity, prevents replay.
      }
      for(const one of plan){
        if(own(proof,one.id))continue;
        for(const item of one.items)bag.push({...item,来源:'任务奖励·'+one.id,价格:0});
        proof[one.id]={哈希:one.hash,楼层:job.id,物品数:one.items.reduce((n,x)=>n+x.数量,0)};
        added.add(one.id);granted+=proof[one.id].物品数;
      }
      s.背包=bag;s.任务实物凭据=proof;
      return vars;
    };
mutate(vars);return {granted,added:[...added]};
}

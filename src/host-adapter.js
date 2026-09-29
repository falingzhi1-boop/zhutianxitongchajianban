import {LedgerService} from './ledger-service.js';
import { ID, STORAGE, PROMPT, HOST_VERSION, identity, snapshotToken, normalizeIntent } from './contracts.js';
// Internal import deliberately pinned and tested: SillyTavern 1.19.0 @06bde939...
// getContext() does not expose sendMessageAsUser. No unverified universal API is invented here.
import { sendMessageAsUser, is_send_press } from '/script.js';

export class HostAdapter {
    constructor(original) {
        this.original = original;
        this.disposers = [];
        this.subscribers = new Set();
        this.busy = false;
        this.generating = false;
        this.dead = false;
        this.generationEpoch = 0;
        this.sendingReceipts = new Set();
        this.version = null;
        this.transactions = new LedgerService(this);
    }
    context() { return globalThis.SillyTavern?.getContext?.(); }
    async start() {
        const c = this.context();
        if (!c?.eventSource || !c.eventTypes || typeof c.saveChat !== 'function' || typeof sendMessageAsUser !== 'function') throw Error('宿主缺少已核验接口，停止启动，未改写数据。');
        try {
            const r = await fetch('/version', {credentials:'same-origin',signal:AbortSignal.timeout(15000)});
            if (!r.ok) throw Error('版本接口返回错误');
            const v = await r.json(); this.version = v.pkgVersion;
        } catch { throw Error('无法核对酒馆版本，已阻止写入。'); }
        if (this.dead) return;
        await new Promise(resolve => {
            const event=c.eventTypes.APP_READY;
            const ready=()=>{c.eventSource.removeListener(event,ready);resolve();};
            this.disposers.push(ready);
            c.eventSource.on(event,ready); // APP_READY auto-fires for late subscribers in the pinned host.
        });
        if (this.dead) return;
        if (this.version !== HOST_VERSION) throw Error(`当前适配器仅核验 ${HOST_VERSION}；检测到 ${this.version || '未知版本'}。请先进行接口验收，不能冒充已兼容。`);
        for (const key of ['CHAT_CHANGED','MESSAGE_RECEIVED','MESSAGE_EDITED','MESSAGE_SWIPED','MESSAGE_DELETED','USER_MESSAGE_RENDERED','CHARACTER_MESSAGE_RENDERED']) {
            const event = c.eventTypes[key]; if (!event) continue;
            const fn = () => {
                if (['CHAT_CHANGED','MESSAGE_EDITED','MESSAGE_SWIPED','MESSAGE_DELETED'].includes(key)) this.generationEpoch++;
                if (key === 'CHAT_CHANGED') this.clearPrompt();
                this.notify();
            };
            c.eventSource.on(event, fn);this.disposers.push(()=>c.eventSource.removeListener(event,fn));
        }
        const on=(key,fn)=>{const e=c.eventTypes[key];if(e){c.eventSource.on(e,fn);this.disposers.push(()=>c.eventSource.removeListener(e,fn));}};
        on('GENERATION_STARTED',(type,opts,dry)=>{if(!dry){this.generating=true;this.generationEpoch++;this.notify();}});
        on('GENERATION_ENDED',()=>{this.generating=false;this.notify();});
        on('GENERATION_STOPPED',()=>{this.generating=false;this.notify();});
        on('GENERATION_AFTER_COMMANDS',(type,opts,dry)=>{if(!dry&&!['quiet','impersonate'].includes(type))this.refreshPrompt(type);});
    }
    subscribe(fn) { this.subscribers.add(fn); return ()=>this.subscribers.delete(fn); }
    notify() { if(!this.dead)for(const fn of this.subscribers) { try{fn();}catch(e){console.warn('[诸天终端] 只读刷新失败',e.message);} } }
    isGenerating() { return this.generating||is_send_press; }
    currentIdentity() { return identity(this.context()); }
    variables() {
        // Storage corroborated against Tavern Helper variables.ts @519599bc... (type:'chat').
        // Read-only: do not silently prefer a new variable root or overwrite an old one.
        const v=this.context()?.chatMetadata?.variables;
        return v && typeof v==='object'&&!Array.isArray(v)?v:{};
    }
    ledger() { const l=this.variables().诸天系统;return l&&typeof l==='object'&&!Array.isArray(l)?l:null; }
    memory() {
        const c=this.original.ZhuTianMemoryCore;
        return c.state(this.variables()[c.NS]);
    }
    timeline() {
        return this.original.ZhuTianMemoryCore.timeline((this.context()?.chat||[]).map((m,i)=>({
            message_id:i,role:m.is_system?'system':m.is_user?'user':'assistant',name:m.name,is_hidden:!!m.is_system,message:m.mes||''
        })));
    }
    settings() { return this.context()?.chatMetadata?.[STORAGE] || {}; }
    async setRecall(enabled) {
        if(this.busy)throw Error('交易正在保存，请稍后修改设置。');
        if(!this.currentIdentity())throw Error('请先打开单角色聊天。');
        if(enabled && document.getElementById('zt-memory-assistant-v1'))throw Error('检测到旧版记忆助手：请先停用它，再启用新版回忆提示，避免重复注入。');
        const c=this.context(),chat=c.chat,id=this.currentIdentity();
        c.chatMetadata[STORAGE]={...this.settings(),schema:1,recallEnabled:!!enabled};
        await c.saveMetadata();
        if(this.currentIdentity()!==id||this.context().chat!==chat)throw Error('聊天已切换，请回到原聊天检查设置。');
        this.refreshPrompt();this.notify();
    }
    async setNativeLedger(enabled) {
        if(this.busy||this.dead||this.generating||!this.currentIdentity())throw Error('请先停止生成/交易，并打开单角色聊天。');
        if(enabled&&this.transactions.legacyActive())throw Error('请先停用旧状态栏和旧助手；不能让两个引擎写同一账本。');
        const c=this.context(),id=this.currentIdentity(),target={avatar_url:c.characters[c.characterId].avatar,file_name:c.getCurrentChatId()};
        c.chatMetadata[STORAGE]={...this.settings(),nativeLedgerEnabled:!!enabled};
        await c.saveMetadata();
        const disk=await this.transactions.request('get',target);
        if(id!==this.currentIdentity()||disk?.[0]?.chat_metadata?.[STORAGE]?.nativeLedgerEnabled!==!!enabled)throw Error('设置保存未能核实，请重载检查。');
        this.notify();
    }
    clearPrompt() { this.context()?.setExtensionPrompt?.(PROMPT,'',1,0,false,0); }
    refreshPrompt(type='') {
        const c=this.context();
        if(this.dead||!identity(c)||!this.settings().recallEnabled||document.getElementById('zt-memory-assistant-v1')){this.clearPrompt();return;}
        try{
            const core=this.original.ZhuTianMemoryCore,st=this.memory();
            if(!st.enabled){this.clearPrompt();return;}
            let time=this.timeline();if(['regenerate','swipe'].includes(type)){const last=time.findLast(x=>x.role==='assistant'&&!x.hidden);if(last)time=time.filter(x=>x.id<last.id);}
            const q=time.findLast(x=>x.role==='user'&&!x.hidden)?.body||'';
            const recalled=core.recall(st,time,this.ledger(),q),id=identity(c);
            c.setExtensionPrompt(PROMPT,recalled.content,1,0,false,0,()=>!this.dead&&this.currentIdentity()===id&&this.settings().recallEnabled&&!document.getElementById('zt-memory-assistant-v1'));
        }catch(e){this.clearPrompt();console.warn('[诸天终端] 回忆提示未启用：',e.message);}
    }
    draft(target,action) {
        const c=this.context();if(!identity(c))throw Error('请先打开单角色聊天，开发版不接管群聊。');
        return {...normalizeIntent(target,action),id:crypto.randomUUID(),chatIdentity:identity(c),chatRef:c.chat,token:snapshotToken(c),epoch:this.generationEpoch};
    }
    async send(draft) {
        if(this.dead)throw Error('扩展已停用。');
        if(this.busy||this.generating||is_send_press)throw Error('已有操作或主聊天正在生成，请稍后再试。');
        const c=this.context();
        if(!draft?.id||this.sendingReceipts.has(draft.id))throw Error('该操作已提交，不会重复发送。');
        if(identity(c)!==draft.chatIdentity||c.chat!==draft.chatRef||snapshotToken(c)!==draft.token||draft.epoch!==this.generationEpoch)throw Error('聊天或正文已变化，请重新预览再发送。');
        if(document.getElementById('file_form_input')?.files?.length)throw Error('主输入框有待发送附件，请先处理附件，避免把它附在这次互动中。');
        const normalized=normalizeIntent(draft.target,draft.action);
        const diskTarget={avatar_url:c.characters[c.characterId].avatar,file_name:c.getCurrentChatId()};
        this.busy=true;this.sendingReceipts.add(draft.id);this.notify();
        try {
            const message=await sendMessageAsUser(normalized.message,'');
            // After host events/save, use the original object identity to avoid stamping a different chat.
            if(!draft.chatRef.includes(message))throw Error('宿主未确认消息对象，停止后续操作；不要自动重发。');
            if(identity(this.context())!==draft.chatIdentity||this.context().chat!==draft.chatRef)throw Error('发送期间聊天发生变化。消息可能已写入原聊天，请人工核对；不会自动重发。');
            message.extra ||= {};
            message.extra[STORAGE]={kind:'player-interaction',id:draft.id,target:normalized.target,version:1,at:Date.now()};
            await this.context().saveChat();
            // saveChatConditional catches errors internally; its resolved promise is NOT a disk receipt.
            // Read the actual server chat back before reporting success. This endpoint is pinned too.
            const response=await fetch('/api/chats/get',{method:'POST',headers:c.getRequestHeaders(),credentials:'same-origin',cache:'no-store',body:JSON.stringify(diskTarget),signal:AbortSignal.timeout(15000)});
            if(!response.ok)throw Error('消息保存状态无法核实，已停止后续操作');
            const disk=await response.json();
            if(!Array.isArray(disk)||!disk.some(m=>m.extra?.[STORAGE]?.id===draft.id&&m.is_user&&m.mes===message.mes))throw Error('未在服务器记录中找到本次消息凭据，请人工检查存档');
            if(identity(this.context())!==draft.chatIdentity)throw Error('消息已在原聊天核实，但当前聊天已切换');
            this.notify();
            return {message,id:this.context().chat.indexOf(message)};
        } catch(e) {
            // A host call can save before rejecting. Fail closed: never silently delete or repeat it.
            throw Error(`${e.message} 如正文已出现，请勿重复发送。`);
        } finally {this.busy=false;this.notify();}
    }
    dispose() {this.transactions.dispose();this.dead=true;this.generationEpoch++;this.disposers.splice(0).forEach(fn=>fn());this.subscribers.clear();this.clearPrompt();}
}

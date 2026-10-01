import original from './vendor/original/runtime.js';
import {HostAdapter} from './src/host-adapter.js';
import {Hub} from './src/hub.js';
import {HubSettings} from './src/hub-settings.js';
import {HubPlugins} from './src/hub-plugins.js';
import {HubGroup} from './src/hub-group.js';
import {ID, VERSION} from './src/contracts.js';
import {hooksSupported, fetchHostVersion} from './src/compat.js';
import {Settings} from './src/settings.js';
import {Bridge} from './src/th-bridge.js';
import {StatusBarHost} from './src/statusbar-host.js';
import {AssistantHost} from './src/assistant-host.js';
import {Features} from './src/features.js';
import {Portrait} from './src/portrait.js';
import {MacroLikeHost} from './src/macro-like.js';
import {installInterceptor} from './src/prompt-filter.js';
import {TouchLayer} from './src/touch.js';
import {openApiCenter,mountApiInline} from './src/api-center.js';
import {Takeover} from './src/takeover.js';
import {World} from './src/world.js';
import {HubAtlas} from './src/hub-atlas.js';
import {FX} from './src/fx.js';
import {LilithStage} from './src/lilith-stage.js';
import {SkillSync} from './src/skill-sync.js';
import {LilithFloat} from './src/lilith-float.js';
import {unbindAll} from './src/wb-unbind.js';
import {WORLD_NAME} from './src/features.js';

// manifest.generate_interceptor is looked up on globalThis at generation time: define it as soon as the module loads.
installInterceptor();

const base=new URL('./',import.meta.url).href;
let app=null,starting=null,disposed=false,abortStart=0,pending=null,hooked=false;

/** Everything that runs while the extension is enabled. Each part fails independently and reports in diagnostics. */
class App {
    constructor(adapter){this.adapter=adapter;this.original=original;this.base=base;this.parts=[];}
    async start(){
        const a=this.adapter;
        this.settings=new Settings(a);
        this.bridge=new Bridge(a,this.settings);this.parts.push(this.bridge);
        a.statusbarActive=()=>!!this.statusbar?.active;
        this.macros=new MacroLikeHost(a,this.settings);try{this.macros.start();this.parts.push(this.macros);}catch(e){console.warn('[诸天] 变量宏未启动',e);}
        const V=original.ZhuTianLilithVoice,voiceKit=V?{cardStyle:V.cardStyle,labelStyle:V.labelStyle,avatarStyle:V.avatarStyle,decorate:V.decorate,avatars:original.ZhuTianLilithAvatars}:null;
        this.takeover=new Takeover(a,this.settings);
        try{this.statusbar=new StatusBarHost(a,this.bridge,this.settings,base,{macros:this.macros,voice:voiceKit});await this.statusbar.start();this.parts.push(this.statusbar);}
        catch(e){this.statusbarError=e.message;console.error('[诸天] 原生状态栏未启动',e);this.statusbar=null;}
        if(this.settings.get('assistant')){
            try{this.assistant=new AssistantHost({adapter:a,bridge:this.bridge,original,settings:this.settings,openTerminal:p=>this.openTerminal(p)}).start();this.parts.push(this.assistant);}
            catch(e){this.assistantError=e.message;this.assistant=null;console.warn('[诸天] 莉莉丝助手未启动：',e.message);globalThis.toastr?.warning(e.message,'诸天 · 莉莉丝');}
        }
        // 0.5.0: ONE window. The Lilith window is the shell; the hub adds every system page into it.
        this.hubSettings=new HubSettings(this);
        try{this.hub=new Hub(this).start();this.parts.push(this.hub);}catch(e){this.hubError=e.message;console.error('[诸天] 终端未启动',e);}
        try{this.plugins=new HubPlugins(this).start();this.parts.push(this.plugins);}catch(e){console.warn('[诸天] 外挂管理未启动',e);}
        try{this.group=new HubGroup(this).start();this.parts.push(this.group);}catch(e){console.warn('[诸天] 聊天群未启动',e);}
        // 0.7.0: world themes, 图谱, 演出 (each optional; the terminal works without them).
        try{this.world=new World(this).start();this.parts.push(this.world);}catch(e){console.warn('[诸天] 世界主题未启动',e);}
        try{this.atlas=new HubAtlas(this).start();this.parts.push(this.atlas);}catch(e){console.warn('[诸天] 图谱未启动',e);}
        try{this.fx=new FX(this).start();this.parts.push(this.fx);}catch(e){console.warn('[诸天] 演出未启动',e);}
        try{this.skills=new SkillSync(this).start();this.parts.push(this.skills);}catch(e){console.warn('[诸天] 修行熟练度未启动',e);}
        this.touch=new TouchLayer(this.settings);this.parts.push(this.touch);
        if(this.assistant){this.assistant.onMotion=m=>this.touch.attach(m);if(this.assistant.motion)this.touch.attach(this.assistant.motion);}
        this.portrait=new Portrait(this);this.parts.push(this.portrait);
        try{await this.portrait.start();}catch(e){console.warn('[诸天] 立绘模式回退到原版分层动画：',e.message);}
        try{this.lilith=new LilithStage(this).start();this.parts.push(this.lilith);}catch(e){console.warn('[诸天] 莉莉丝界面角色未启动',e);}
        // 0.8.2: phones never show the portrait inside the window — Lilith floats on the page instead (and speaks there).
        try{this.float=new LilithFloat(this).start();this.parts.push(this.float);}catch(e){console.warn('[诸天] 悬浮莉莉丝未启动',e);}
        this.features=new Features(this);this.features.start();this.parts.push(this.features);
        // 0.8.4: one API setting — the terminal's 连接 page shows the API 中心 form (the original v1.1 form wrote only Lilith's copy).
        if(this.hub)this.hub.hook('onPage',p=>{if(p==='api')try{mountApiInline(this.hub.shadow.getElementById('page-api'),this.apiOpts());}catch(e){console.warn('[诸天] 连接页',e);}});
        if(this.statusbar)this.statusbar.openApi=()=>this.openApiCenter();
        if(this.hub?.page==='api')try{mountApiInline(this.hub.shadow.getElementById('page-api'),this.apiOpts());}catch(e){console.warn('[诸天] 连接页',e);}
        this.settings.mountDrawer({open:()=>this.openTerminal(),restore:()=>this.restoreLegacy()});
        globalThis.__zhutianApp=this;
    }
    openTerminal(page){if(this.hub)this.hub.open(page);else this.assistant?.open();}
    apiOpts(){return {bridge:this.bridge,ns:original.ZhuTianMemoryCore?.NS,notify:()=>this.adapter.notify?.()};}
    /** Inside the open terminal the 连接 page is the API 中心; elsewhere (diagnostics popup) the same form opens as a dialog. */
    openApiCenter(){if(this.hub?.isOpen){this.hub.go('api');return null;}return openApiCenter(this.apiOpts());}
    async runTakeover(){
        const t=globalThis.toastr,list=this.takeover.pending();
        if(!list.length){t?.info('没有发现仍在启用的旧版正则或酒馆助手脚本；世界书由插件自动安装绑定。','诸天 · 接管');return {items:[],reload:false};}
        const names=list.map(i=>`${i.kind==='regex'?'正则':'酒馆助手脚本'}（${i.scope==='global'?'全局':'角色卡'}）：${i.name}`).join('\n');
        if(!globalThis.confirm(`将停用以下 ${list.length} 项旧版内容，由本插件接管（不会删除，可随时“恢复旧版”）：\n\n${names}`))return {items:[],reload:false,cancelled:true};
        try{const r=await this.takeover.run();this.statusbar?.rebuild();
            if(r.reload){t?.success('旧版已停用。页面将在 2 秒后刷新，让酒馆助手卸载旧脚本。','诸天 · 接管');setTimeout(()=>location.reload(),2000);}
            else t?.success(`已停用 ${r.items.length} 个旧正则，现由插件原生接管。`,'诸天 · 接管');
            return r;}catch(e){t?.error(e.message,'诸天 · 接管');throw e;}
    }
    async restoreLegacy(){
        const t=globalThis.toastr;
        try{const r=await this.takeover.restore();
            if(!r.items.length){t?.info('没有可恢复的记录（角色卡里的项目需要先打开对应角色）。','诸天 · 恢复');return r;}
            t?.warning('旧版已重新启用。为避免两个莉莉丝和重复状态栏，请在扩展列表里停用本插件后刷新。','诸天 · 恢复',{timeOut:12000});
            this.statusbar?.rebuild();return r;}catch(e){t?.error(e.message,'诸天 · 恢复');throw e;}
    }
    dispose(){if(globalThis.__zhutianApp===this)globalThis.__zhutianApp=null;for(const p of this.parts.splice(0).reverse()){try{p.dispose();}catch(e){console.warn('[诸天] 卸载',e);}}this.settings?.dispose();}
}

async function boot(){
    if(app||starting)return starting;
    const token=++abortStart;
    starting=(async()=>{
        if(document.getElementById(ID))return;
        const candidate=new HostAdapter(original);pending=candidate;let next=null;
        try{
            await candidate.start();
            if(disposed||token!==abortStart){candidate.dispose();return;}
            next=new App(candidate);await next.start();
            if(disposed||token!==abortStart){next.dispose();candidate.dispose();return;}
            app=next;
            console.info(`[诸天终端] ${VERSION} 已加载于 SillyTavern ${candidate.version}（${candidate.support.tested?'已验收':'能力探测'}）。`);
        }catch(error){next?.dispose();candidate.dispose();app=null;if(!disposed&&token===abortStart){console.error('[诸天终端]',error);globalThis.toastr?.error(error.message,'诸天契约终端：启动已阻止');}}
    })().finally(()=>{starting=null;pending=null;if(!disposed&&!app&&token!==abortStart)void boot();});
    return starting;
}
export function activate(){hooked=true;disposed=false;void boot();}
/** 0.8.2: turning the extension off also takes the 诸天 worldbook off every character card / the global list / the open
 *  chat (setting 关闭插件时自动解绑, default on). SillyTavern awaits this hook for at most 5 s, then saves the settings —
 *  the record written here is what 设置 → 世界书 → 恢复绑定 uses after re-enabling. */
async function autoUnbind(){
    const c=globalThis.SillyTavern?.getContext?.(), store=c?.extensionSettings?.[ID];
    if(!c||(store&&store.wbUnbindOnDisable===false))return null;
    try{
        const rec=await Promise.race([unbindAll(c,WORLD_NAME,{chat:true}),new Promise(r=>setTimeout(()=>r(null),4500))]);
        if(rec&&rec.count){c.extensionSettings[ID]={...(c.extensionSettings[ID]||{}),wbUnbound:{...rec,auto:true,noticed:false}};c.saveSettingsDebounced?.();console.info(`[诸天终端] 已解绑世界书：${rec.count} 处`);}
        return rec;
    }catch(e){console.warn('[诸天终端] 关闭时解绑世界书失败',e);return null;}
}
export function deactivate(){const p=autoUnbind();disposed=true;abortStart++;pending?.dispose();app?.dispose();app?.adapter?.dispose();app=null;return p;}

// SillyTavern 1.16.x has no manifest hooks: it only injects this module. Start ourselves there, after APP_READY.
// 1.17+ calls activate() right after the script loads (before APP_READY), so this path stays idle on those hosts.
(function selfStart(tries=0){
    const c=globalThis.SillyTavern?.getContext?.();
    if(!c?.eventSource||!c.eventTypes?.APP_READY){if(tries<240)setTimeout(()=>selfStart(tries+1),250);return;}
    const ready=async()=>{
        c.eventSource.removeListener(c.eventTypes.APP_READY,ready);
        if(hooked||disposed)return;
        let version='';try{version=(await fetchHostVersion()).pkgVersion;}catch{}
        if(hooked||disposed)return;
        if(version&&!hooksSupported(version)){console.info('[诸天终端] 宿主无扩展生命周期钩子（<1.17），自动启动。');void boot();}
        else setTimeout(()=>{if(!hooked&&!disposed){console.info('[诸天终端] 未收到 activate 钩子，自动启动。');void boot();}},4000);
    };
    c.eventSource.on(c.eventTypes.APP_READY,ready);
})();

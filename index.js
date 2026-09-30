import original from './vendor/original/runtime.js';
import {HostAdapter} from './src/host-adapter.js';
import {Terminal} from './src/terminal.js';
import {ID, VERSION} from './src/contracts.js';
import {hooksSupported, fetchHostVersion} from './src/compat.js';
import {Settings} from './src/settings.js';
import {Bridge} from './src/th-bridge.js';
import {StatusBarHost} from './src/statusbar-host.js';
import {AssistantHost} from './src/assistant-host.js';
import {Features} from './src/features.js';
import {Portrait} from './src/portrait.js';

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
        this.terminal=new Terminal(a,original,base);this.terminal.mount();this.parts.push(this.terminal);
        const syncLauncher=()=>{if(this.terminal.launcher)this.terminal.launcher.hidden=!this.settings.get('terminalLauncher')&&!!this.assistant;};
        try{this.statusbar=new StatusBarHost(a,this.bridge,this.settings,base);await this.statusbar.start();this.parts.push(this.statusbar);}
        catch(e){this.statusbarError=e.message;console.error('[诸天] 原生状态栏未启动',e);this.statusbar=null;}
        if(this.settings.get('assistant')){
            try{this.assistant=new AssistantHost({adapter:a,bridge:this.bridge,original,settings:this.settings,openTerminal:()=>this.openTerminal()}).start();this.parts.push(this.assistant);}
            catch(e){this.assistantError=e.message;this.assistant=null;console.warn('[诸天] 莉莉丝助手未启动：',e.message);globalThis.toastr?.warning(e.message,'诸天 · 莉莉丝');}
        }
        syncLauncher();
        this.portrait=new Portrait(this);this.parts.push(this.portrait);
        try{await this.portrait.start();}catch(e){console.warn('[诸天] 立绘模式回退到原版分层动画：',e.message);}
        this.features=new Features(this);this.features.start();this.parts.push(this.features);
        this.settings.onChange(k=>{if(k==='terminalLauncher')syncLauncher();if(k==='assistant')globalThis.toastr?.info('刷新页面后生效','诸天');});
        this.settings.mountDrawer({
            open:()=>this.assistant?this.assistant.open():this.openTerminal(),terminal:()=>this.openTerminal(),live2d:()=>this.portrait.openSettings(),
            worldbook:()=>this.features.openWorldbook(),migrate:()=>this.features.openMigration(),diagnose:()=>this.features.openDiagnostics(),
            init:()=>this.features.initChat().then(r=>globalThis.toastr?.success(r.created?`已按原版规则初始化账本（系统点 ${r.points}）`:'账本已存在；已按原版规则补齐缺失字段','诸天')).catch(e=>globalThis.toastr?.error(e.message,'诸天')),
        });
        globalThis.__zhutianApp=this;
    }
    openTerminal(){this.terminal?.open();}
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
export function deactivate(){disposed=true;abortStart++;pending?.dispose();app?.dispose();app?.adapter?.dispose();app=null;}

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

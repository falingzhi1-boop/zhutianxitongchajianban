import original from './vendor/original/runtime.js';
import {HostAdapter} from './src/host-adapter.js';
import {Terminal} from './src/terminal.js';
import {ID} from './src/contracts.js';

const base=new URL('./',import.meta.url).href;
let app=null,adapter=null,starting=null,disposed=false,abortStart=0,pending=null;
async function boot(){
    if(app||starting)return starting;
    const token=++abortStart;
    starting=(async()=>{
        if(document.getElementById(ID))return;
        const candidate=new HostAdapter(original);pending=candidate;
        try{
            await candidate.start();
            if(disposed||token!==abortStart){candidate.dispose();return;}
            adapter=candidate;app=new Terminal(adapter,original,base);app.mount();
            console.info('[诸天终端] 原生开发检查点已加载；未声明原版全功能迁移完成。');
        }catch(error){candidate.dispose();app?.dispose();app=null;adapter=null;if(!disposed&&token===abortStart){console.error('[诸天终端]',error);globalThis.toastr?.error(error.message,'诸天契约终端：启动已阻止');}}
    })().finally(()=>{starting=null;pending=null;if(!disposed&&!app&&token!==abortStart)void boot();});
    return starting;
}
export function activate(){disposed=false;void boot();}
export function deactivate(){disposed=true;abortStart++;pending?.dispose();app?.dispose();app=null;adapter?.dispose();adapter=null;}
// Host's activate hook owns startup. No auto-installation, host monkeypatching or API requests to a model.

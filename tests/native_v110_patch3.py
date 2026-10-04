"""Patch3: real isolated ST chat switches/disk writes + browser secure-context diagnostics.
Never run against a user installation. Controlled replies and delayed reads are test fixtures, not real models.
"""
import argparse, json, sys
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright
sys.path.insert(0, str(Path(__file__).parent/'qa'))
import zt_common as Z
ap=argparse.ArgumentParser();ap.add_argument('--isolated-test-only',action='store_true',required=True);ap.add_argument('--base-url',default='http://127.0.0.1:8019');ap.add_argument('--insecure-url',required=True);ap.add_argument('--output',default='/tmp/zt-patch3');args=ap.parse_args()
out=Path(args.output);out.mkdir(parents=True,exist_ok=True);Z.configure(args.base_url,'http://127.0.0.1:5001/v1',out)
EXT='/scripts/extensions/third-party/zhutianxitongchajianban/src/';SECOND='诸天补丁3 · 隔离B';results=[]
def ok(n,c,d=''):
 results.append({'name':n,'pass':bool(c),'detail':d});print(('PASS ' if c else 'FAIL ')+n+' '+str(d),flush=True)
def js(s):return page.evaluate(s)
def switch(name):
 page.evaluate("async name=>{const c=SillyTavern.getContext();await c.selectCharacterById(c.characters.findIndex(x=>x.name===name));}",name);page.wait_for_function('n=>SillyTavern.getContext().name2===n',arg=name);page.wait_for_timeout(1200)
def save(s):return js("async()=>{await __zhutianApp.bridge.updateVariablesWith(v=>{"+s+";return v;},{verify:true});}")
def disk():return js("async()=>{const c=SillyTavern.getContext();const r=await fetch('/api/chats/get',{method:'POST',headers:c.getRequestHeaders(),body:JSON.stringify({avatar_url:c.characters[c.characterId].avatar,file_name:c.getCurrentChatId()})});return (await r.json())[0].chat_metadata.variables;}")
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True,args=['--no-sandbox']);ctx=browser.new_context(viewport={'width':1280,'height':860});page=ctx.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)));page.on('dialog',lambda d:d.accept());Z.boot(page);Z.setup_chat(page)
 page.evaluate("""async name=>{let c=SillyTavern.getContext();if(!c.characters.some(x=>x.name===name)){const data={spec:'chara_card_v2',spec_version:'2.0',data:{name,description:'ISOLATED TEST ONLY',first_mes:'隔离B',extensions:{}}};const fd=new FormData();fd.append('avatar',new Blob([JSON.stringify(data)],{type:'application/json'}),'fixture.json');fd.append('file_type','json');const h=c.getRequestHeaders();delete h['Content-Type'];const r=await fetch('/api/characters/import',{method:'POST',headers:h,body:fd});if(!r.ok)throw Error('import failed');await c.getCharacters();}}""",SECOND)
 for name in [SECOND,Z.CARD]:
  switch(name);save("v.诸天系统 ||= {};Object.assign(v.诸天系统,{系统点:100,背包:[],任务库:{},聊天群:{成员:[{id:'shared-id',名称:'隔离群员',世界:'测试世界',档:1,好感:20}],设置:{自动闲聊:false}}})")
 # Delayed replies: same member id in both chats, real selectCharacterById and server readback.
 for action in ['help','privateSay','live','round']:
  switch(Z.CARD)
  page.evaluate("""action=>{const a=__zhutianApp;window.__oldGen=a.bridge.generateRaw;window.__release=null;window.__done=null;a.bridge.generateRaw=()=>new Promise(r=>window.__release=r);
 const pending=action==='help'?a.group.help('A的求助','shared-id'):action==='privateSay'?a.group.privateSay('shared-id','A的私聊'):action==='live'?a.group.live('shared-id'):a.group.round('A的群聊');pending.then(()=>window.__done='unexpected success',e=>window.__done=e.message);}""",action)
  page.wait_for_function('typeof __release==="function"');switch(SECOND);before=disk()
  page.evaluate("reply=>{__zhutianApp.bridge.generateRaw=__oldGen;__release(reply);}",'旧任务|A的内容|100点' if action=='help' else '@隔离群员: A的回复' if action=='round' else 'A的回复');page.wait_for_function('__done!==null')
  ok('delayed '+action+' rejects real chat switch and preserves B disk',('变化' in js('__done') or '切换' in js('__done')) and disk()==before,js('__done'))
 # External balance change during server preflight, both replacement and in-place mutation.
 switch(Z.CARD)
 for mode in ['replace','inplace']:
  save('v.诸天系统.系统点=100')
  js("""()=>{window.__nativeFetch=window.fetch;window.__release=null;window.__done=null;let first=true;window.fetch=async function(u,o){const r=await __nativeFetch(u,o);if(first&&String(u)==='/api/chats/get'){first=false;await new Promise(f=>window.__release=f);}return r;};__zhutianApp.bridge.updateVariablesWith(v=>{v.诸天系统.系统点-=10;return v;},{verify:true}).then(()=>window.__done='unexpected success',e=>window.__done=e.message);}""")
  page.wait_for_function('typeof __release==="function"')
  page.evaluate("""async mode=>{const c=SillyTavern.getContext();if(mode==='replace')c.chatMetadata.variables=structuredClone(c.chatMetadata.variables);c.chatMetadata.variables.诸天系统.系统点=200;await c.saveMetadata();window.fetch=__nativeFetch;__release();}""",mode)
  page.wait_for_function('__done!==null');ok(mode+' external edit survives delayed server check', '变化' in js('__done') and disk()['诸天系统']['系统点']==200,js('__done'))
  save('v.诸天系统.系统点-=10');ok(mode+' explicit retry deducts from 200 to 190',disk()['诸天系统']['系统点']==190)
 # Appraise separate lots on the real bridge; recycle via the actual planner and persist/reload.
 save("v.诸天系统.系统点=0;v.诸天系统.背包=[{名称:'同名古剑',品级:'凡品',数量:1,价格:1,来源:'剧情收纳 #3',收纳凭据:'patch3-proof',来源世界:'甲'},{名称:'同名古剑',品级:'仙品',数量:1,价格:10000000,来源:'商城'}]")
 js("async()=>{const m=await import('"+EXT+"appraise.js');const a=__zhutianApp;await a.appraise.write([{entry:m.candidates(a.adapter.ledger()).items[0],grade:'仙品'}],{how:'手动修正'});}")
 bag=disk()['诸天系统']['背包'];ok('appraisal disk preserves both source lots and frozen prices',len(bag)==2 and bag[0]['价格']==1 and bag[0]['收纳凭据']=='patch3-proof' and bag[1]['价格']==10000000,bag)
 js("async()=>{const m=await import('"+EXT+"ledger-plan.js');const a=__zhutianApp;for(let i=0;i<2;i++)await a.bridge.updateVariablesWith(async v=>(await m.planOperation(v,[],'recycle',0)).variables,{verify:true});}")
 ok('actual recycle planner and server save total exactly 1000001',disk()['诸天系统']['系统点']==1000001)
 js('SillyTavern.getContext().reloadCurrentChat()');page.wait_for_timeout(1500);ok('recycle result survives actual host reload',js('__zhutianApp.adapter.ledger().系统点')==1000001)
 # The host debounces settings and catches HTTP failure internally: diagnostics must still see it.
 page.wait_for_timeout(1200)
 js('__zhutianApp.errorLog.items.length=0')
 page.route('**/api/settings/save',lambda route:route.fulfill(status=503,content_type='text/plain',body='isolated failure'))
 js("__zhutianApp.settings.set('palette','lilith')")
 page.wait_for_function("__zhutianApp.errorLog.items.some(x=>x.kind==='save')",timeout=15000)
 ok('host-caught delayed settings HTTP failure is recorded without payload',js("__zhutianApp.errorLog.items.some(x=>x.kind==='save'&&x.text.includes('宿主设置保存'))"))
 page.unroute('**/api/settings/save');js("__zhutianApp.settings.set('palette','auto')");page.wait_for_timeout(1200)
 report=js("async()=>{const m=await import('"+EXT+"diag-report.js');return m.buildReport(__zhutianApp);}");ok('HTTP loopback is accurately reported as secure with Web Locks','安全上下文：是' in report and '连接协议：http' in report and 'Web Locks：可用' in report and 'HTTPS：是' not in report)
 ok('real host patch actions have no uncaught page errors',not errors,errors)
 page.screenshot(path=str(out/'host-patch3.png'))
 # No insecure-context override flags: a non-loopback HTTP page has genuinely absent Web Locks.
 # Standalone fixture loads the delivered modules from the same isolated server, without modifying host settings.
 envpage=ctx.new_page()  # Real HTTP response establishes the address space; an intercepted document triggers Chromium PNA.
 for label,url,missing in [('lan',args.insecure_url,False),('secure-no-locks',args.base_url,True)]:
  envpage.goto(url.rstrip('/')+'/__patch3_diag')
  envpage.evaluate("document.body.innerHTML='<main id=api></main>'")
  data=envpage.evaluate("""async ({ext,missing})=>{if(missing)Object.defineProperty(navigator,'locks',{value:undefined,configurable:true});
 const {ErrorLog,buildReport}=await import(ext+'diag-report.js');const {Bridge}=await import(ext+'th-bridge.js');const {Settings}=await import(ext+'settings.js');const {mountApiInline}=await import(ext+'api-center.js');
 window.__writes=0;const c={extensionSettings:{variables:{global:{}}},saveSettingsDebounced(){__writes++;}};const adapter={context:()=>c};const settings=new Settings(adapter),bridge=new Bridge(adapter,settings);const log=new ErrorLog(ext).start();window.__envApp={settings,bridge,errorLog:log};window.__report=()=>buildReport(__envApp);mountApiInline(document.querySelector('#api'),{bridge});return {secure:isSecureContext,protocol:location.protocol,locks:typeof navigator.locks?.request,warning:document.querySelector('[data-save-warning]')?.textContent,report:__report()};}""",{'ext':EXT,'missing':missing})
  ok(label+' pre-save warning matches actual browser capabilities',bool(data['warning']) and data['secure']==missing and data['locks']=='undefined',data)
  envpage.locator('input[name=mode][value=main]').check()
  envpage.locator('[data-act=save]').click();envpage.wait_for_timeout(200)
  state=envpage.evaluate("()=>({text:document.body.innerText,report:__report(),writes:__writes,errors:__envApp.errorLog.items.length})")
  ok(label+' Save click refuses before host mutation and is recorded in diagnostics',state['writes']==0 and state['errors']>0 and '当前环境无法保存' in state['text'] and '[诸天保存]' in state['report'],state)
  if label=='lan':ok('LAN advice distinguishes PC loopback from phone HTTPS','localhost' in state['text'] and '手机自己' in state['text'] and 'HTTPS' in state['text'])
  envpage.screenshot(path=str(out/(label+'-save.png')))
 browser.close()
(out/'results.json').write_text(json.dumps(results,ensure_ascii=False,indent=2));print(f"{sum(r['pass'] for r in results)}/{len(results)} passed");sys.exit(0 if all(r['pass'] for r in results) else 1)

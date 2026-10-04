"""Pre-transfer negative regression. DESTRUCTIVE to isolated fixtures only; never point at production.
Uses real SillyTavern chat switches/disk persistence, deterministic responses and controlled wait points.
"""
import argparse,json,sys
from pathlib import Path
from playwright.sync_api import sync_playwright
sys.path.insert(0,str(Path(__file__).parent/'qa'))
import zt_common as Z
ap=argparse.ArgumentParser();ap.add_argument('--isolated-test-only',action='store_true',required=True);ap.add_argument('--base-url',default='http://127.0.0.1:8019');ap.add_argument('--output',default='/tmp/zt-review');args=ap.parse_args()
out=Path(args.output);out.mkdir(parents=True,exist_ok=True);Z.configure(args.base_url,'http://127.0.0.1:5001/v1',out)
results=[];EXT='/scripts/extensions/third-party/zhutianxitongchajianban/';SECOND='诸天复查 · 切换隔离'
def ok(n,c,d=''):
 results.append({'name':n,'pass':bool(c),'detail':d});print(('PASS ' if c else 'FAIL ')+n+' '+str(d),flush=True)
def js(s):return page.evaluate(s)
def switch(name):
 page.evaluate("async name=>{const c=SillyTavern.getContext();await c.selectCharacterById(c.characters.findIndex(x=>x.name===name));}",name)
 page.wait_for_function("name=>SillyTavern.getContext().name2===name",arg=name);page.wait_for_timeout(1200)
def save(s):return js("async()=>{await __zhutianApp.bridge.updateVariablesWith(v=>{"+s+";return v;},{type:'chat',verify:true});}")
def bal():return js('__zhutianApp.adapter.ledger().系统点')
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True,args=['--no-sandbox']);ctx=browser.new_context(viewport={'width':1280,'height':860});page=ctx.new_page();errors=[]
 page.on('pageerror',lambda e:errors.append(str(e)));page.on('dialog',lambda d:d.accept());Z.boot(page);Z.setup_chat(page)
 js("()=>{__zhutianApp.settings.set('floatLilith','off');__zhutianApp.settings.set('mobileLayout','auto');__zhutianApp.hub.open('shop');}");page.wait_for_timeout(1500)
 # Real second character and chat (fixture only).
 page.evaluate("""async name=>{let c=SillyTavern.getContext();if(!c.characters.some(x=>x.name===name)){
 const data={spec:'chara_card_v2',spec_version:'2.0',data:{name,description:'Disposable review fixture',personality:'',scenario:'',first_mes:'第二个隔离聊天',mes_example:'',creator_notes:'ISOLATED TEST ONLY',tags:[],extensions:{}}};
 const fd=new FormData();fd.append('avatar',new Blob([JSON.stringify(data)],{type:'application/json'}),'fixture.json');fd.append('file_type','json');const headers=c.getRequestHeaders();delete headers['Content-Type'];const r=await fetch('/api/characters/import',{method:'POST',headers,body:fd});if(!r.ok)throw Error('fixture import failed');await c.getCharacters();}}""",SECOND)
 switch(SECOND)
 js("async()=>{const c=SillyTavern.getContext();c.chatMetadata.variables={诸天系统:{系统点:777,背包:[{名称:'钥匙',品级:'凡品',数量:1,来源:'剧情'}],羁绊库:[]}};c.chatMetadata.zhutianCovenantTerminal={schema:1,ledgerSchema:2};await c.saveMetadata();await c.saveChat();}");page.wait_for_timeout(800)
 switch(Z.CARD)
 # Model request paused, then real host character switch, then resolve old result.
 js("()=>{const a=__zhutianApp;window.__oldGen=a.bridge.generateRaw;a.bridge.generateRaw=()=>new Promise(r=>window.__release=r);window.__result=null;a.appraise.appraise({kind:'item',key:'钥匙|凡品',name:'钥匙',grade:'凡品',desc:'剧情钥匙'}).then(()=>window.__result='unexpected success',e=>window.__result=e.message);}")
 page.wait_for_function('typeof __release==="function"');switch(SECOND);before=bal()
 js("()=>{__zhutianApp.bridge.generateRaw=__oldGen;__release('仙品|明确证据');}");page.wait_for_function('__result!==null')
 ok('real chat switch rejects delayed appraisal without changing destination', '变化' in js('__result') and bal()==before and js('__zhutianApp.adapter.ledger().背包[0].品级')=='凡品',js('__result'))
 switch(Z.CARD)
 # Import is paused AFTER backup persisted, not just an identity stub.
 js("""()=>{const a=__zhutianApp;window.__oldSnapshot=a.bridge.snapshot;window.__paused=false;window.__result=null;
 a.bridge.snapshot=async function(...args){const r=await __oldSnapshot.apply(this,args);window.__paused=true;await new Promise(f=>window.__release=f);return r;};
 a.dataIO.import({format:'zhutian-terminal-backup',formatVersion:1,chat:{ledgerSchema:2,variables:{诸天系统:{系统点:1,背包:[],羁绊库:[]}}}},{settings:false}).then(()=>window.__result='unexpected success',e=>window.__result=e.message);}""")
 page.wait_for_function('__paused');switch(SECOND);before=bal();js("()=>{__zhutianApp.bridge.snapshot=__oldSnapshot;__release();}");page.wait_for_function('__result!==null')
 ok('real chat switch during import backup does not overwrite destination', '切换' in js('__result') and bal()==before,js('__result'))
 switch(Z.CARD)
 js("""async()=>{const a=__zhutianApp;const row=await a.bridge.snapshot('review rollback source');window.__oldSnapshot=a.bridge.snapshot;window.__paused=false;window.__result=null;
 a.bridge.snapshot=async function(...args){const r=await __oldSnapshot.apply(this,args);window.__paused=true;await new Promise(f=>window.__release=f);return r;};
 a.bridge.restoreBackup(row.at).then(()=>window.__result='unexpected success',e=>window.__result=e.message);}""")
 page.wait_for_function('__paused');switch(SECOND);before=bal();js("()=>{__zhutianApp.bridge.snapshot=__oldSnapshot;__release();}");page.wait_for_function('__result!==null')
 ok('real chat switch during rollback backup does not overwrite destination','切换' in js('__result') and bal()==before,js('__result'))
 switch(Z.CARD)
 # Repeated frame rerender: live-only listener/observer ownership.
 js("__zhutianApp.hub.open('shop')");page.wait_for_timeout(700)
 for _ in range(5):
  js('__zhutianApp.hub.reloadEngine()');page.wait_for_timeout(500)
 ownership=js("()=>{const a=__zhutianApp;return {commerceOff:a.commerce.off.length,recordsOff:a.records.off.length,commerceFrames:a.commerce.frames?.size,recordsFrames:a.records.frames?.size,bars:a.hub.engineFrame.contentDocument.querySelectorAll('[data-select=all]').length};}")
 ok('repeated engine rerender has bounded frame ownership and one records toolbar',ownership['commerceOff']<=2 and ownership['recordsOff']<=2 and ownership.get('commerceFrames',99)<=2 and ownership.get('recordsFrames',99)<=2 and ownership['bars']==1,ownership)
 # Explicitly different worlds for the SAME name through the actual Bridge writer.
 save("v.诸天系统.羁绊库=[];v.诸天系统.当前羁绊ID='';v.诸天系统.恋爱目标={姓名:'同名复查',世界:'甲',好感度:80}")
 save("v.诸天系统.恋爱目标={姓名:'同名复查',世界:'乙',好感度:10}")
 rows=js("__zhutianApp.adapter.ledger().羁绊库.filter(x=>x.姓名==='同名复查')")
 ok('same-name cross-world targets stay separate on real ledger',len(rows)==2 and sorted(x['好感度'] for x in rows)==[10,80],rows)
 # Whole replacement: no previous romance leaks into imported data; verifies server disk.
 r=js("""async()=>{const a=__zhutianApp;await a.dataIO.import({format:'zhutian-terminal-backup',formatVersion:1,chat:{ledgerSchema:2,variables:{诸天系统:{系统点:50000,背包:[],羁绊库:[],恋爱目标:{姓名:'导入目标',世界:'丙'}}}}},{settings:false});
 const c=a.adapter.context(),r=await fetch('/api/chats/get',{method:'POST',headers:c.getRequestHeaders(),body:JSON.stringify({avatar_url:c.characters[c.characterId].avatar,file_name:c.getCurrentChatId()})});return (await r.json())[0].chat_metadata.variables.诸天系统;}""")
 ok('imported ledger on server excludes pre-import romance catalog',r['系统点']==50000 and not any(x.get('姓名')=='同名复查' for x in r.get('羁绊库',[])),r.get('羁绊库'))
 # Main purchase rejects malformed acquisition resources.
 save("v.诸天系统.系统点=20000000000;v.诸天系统.专属资源={};v.诸天系统.商城库存=[{名称:'复查禁忌',品阶:'禁忌',价格:10000000000,特殊代价:{resource:'因果筹码',amount:1}}]")
 r=js("async()=>{const a=__zhutianApp,m=await import('"+EXT+"src/action-support.js');try{await a.commerce.buy({dataset:{name:'复查禁忌',price:'10000000000'}},m.capture(a));return 'unexpected success';}catch(e){return e.message;}}")
 ok('main purchase rejects missing causal resource before charging','获得条件不足' in r and bal()==20000000000,r)
 # The alternate guarded service must keep schema2 and guard >2.
 save("v.诸天系统.商城库存=[{名称:'复查普通商品',品阶:'凡品',价格:10}]")
 js("async()=>{const c=SillyTavern.getContext();c.chatMetadata.zhutianCovenantTerminal.nativeLedgerEnabled=true;await c.saveMetadata();await c.saveChat();}")
 r=js("async()=>{const a=__zhutianApp,d=await a.adapter.transactions.prepare('buy',0);await a.adapter.transactions.commit(d.id);return {schema:a.adapter.context().chatMetadata.zhutianCovenantTerminal.ledgerSchema,points:a.adapter.ledger().系统点};}")
 ok('guarded alternate purchase does not downgrade schema2',r['schema']==2 and r['points']==20000000000-10,r)
 r=js("async()=>{const a=__zhutianApp,c=a.adapter.context();c.chatMetadata.zhutianCovenantTerminal.ledgerSchema=99;try{await a.adapter.transactions.prepare('buy',0);return 'unexpected success';}catch(e){return e.message;}finally{c.chatMetadata.zhutianCovenantTerminal.ledgerSchema=2;}}")
 ok('guarded alternate writer refuses newer-schema ledger','结构版本' in r,r)
 # Worldbook duplicate comment: actual file retains the duplicate custom content.
 r=js("""async()=>{const a=__zhutianApp,c=a.adapter.context(),name='诸天万界最强系统',book=await c.loadWorldInfo(name);const source=Object.values(book.entries).find(x=>x.comment==='09｜商城｜系统商城');const uid=Math.max(...Object.keys(book.entries).map(Number))+1;book.entries[uid]={...structuredClone(source),uid,content:'REVIEW-DUPLICATE-KEEP'};await c.saveWorldInfo(name,book,true);await a.features.updateWorldbook();const r=await fetch('/api/worldinfo/get',{method:'POST',headers:c.getRequestHeaders(),body:JSON.stringify({name})});return Object.values((await r.json()).entries).filter(x=>x.comment===source.comment).map(x=>x.content);} """)
 ok('worldbook actual server preserves duplicate-comment custom row',len(r)>=2 and 'REVIEW-DUPLICATE-KEEP' in r)
 # Strictly isolated disable/enable: no leaked new module frames.
 js("()=>{window.__oldApp=__zhutianApp;__oldApp.dispose();}");page.wait_for_timeout(200)
 r=js("()=>({frames:__oldApp.commerce.frames.size+__oldApp.records.frames.size,gesture:!!__oldApp.windowControls.g,dead:__oldApp.bridge.dead})")
 ok('dispose cleans new frame resources and active touch state',r['frames']==0 and not r['gesture'] and r['dead'],r)
 ok('negative browser regression no uncaught page errors',not errors,errors)
 browser.close()
(out/'results.json').write_text(json.dumps(results,ensure_ascii=False,indent=2));print(f'{sum(r["pass"] for r in results)}/{len(results)} passed')
if not all(r['pass'] for r in results):sys.exit(1)

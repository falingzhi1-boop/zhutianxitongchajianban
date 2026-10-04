"""1.1 regression: disposable SillyTavern only. Deterministic mocked API, NOT real-model or physical-phone acceptance.
python tests/native_v110.py --isolated-test-only --base-url http://127.0.0.1:8019
"""
import argparse, json, sys, re, hashlib
from pathlib import Path
from playwright.sync_api import sync_playwright
sys.path.insert(0, str(Path(__file__).parent/'qa'))
import zt_common as Z
ap=argparse.ArgumentParser();ap.add_argument('--isolated-test-only',action='store_true',required=True);ap.add_argument('--base-url',default='http://127.0.0.1:8019');ap.add_argument('--output',default='/tmp/zt-v110-evidence');args=ap.parse_args()
out=Path(args.output);out.mkdir(parents=True,exist_ok=True);Z.configure(args.base_url,'http://127.0.0.1:5001/v1',out)
results=[];calls=[];counter=0;api_mode='good'
def ok(name, cond, detail=''):
 results.append({'name':name,'pass':bool(cond),'detail':detail});print(('PASS ' if cond else 'FAIL ')+name+' '+str(detail),flush=True)
def js(page,s):return page.evaluate(s)
def mock(route):
 global counter
 body=route.request.post_data_json;calls.append(body);counter+=1;messages=body.get('messages',[]);sysmsg=next((m.get('content','') for m in messages if m.get('role')=='system'),'');u=next((m.get('content','') for m in messages if m.get('role')=='user'),'');finish='stop'
 if api_mode=='empty':text='';finish='length'
 elif api_mode=='bad':text='not valid json'
 elif '商品内容生成器' in sysmsg:
  slots=json.loads(re.search(r'槽位：(\[.*\])\n仅输出',u).group(1)); rows=[]
  for s in slots:
   tag=hashlib.sha256(f'{counter}-{s["id"]}'.encode()).hexdigest()[:24]
   rows.append(dict(slot=s['id'],name=f'测试商品{counter}-{s["id"]}',effect=f'隔离模拟效果 {tag}，不代表真实模型质量',world=s['world'] or f'测试世界{s["theme"]}',theme=s['theme'],category=s['category'],grade=s['grade'],origin='原创'))
  text=json.dumps(rows,ensure_ascii=False)
 elif '提取正文' in sysmsg:
  data=json.loads(u);src=next(s for s in data['sources'] if '你收下了青铜钥匙一枚' in s['text']);text=json.dumps([dict(floor=src['floor'],name='青铜钥匙',evidence='你收下了青铜钥匙一枚',owned=True,kind='item',quantity=1,originalGrade='天阶',grade='待鉴定',effect='开启古城大门',reason='缺少世界品阶说明')],ensure_ascii=False)
 elif '招募系统' in sysmsg: text='测试游侠|隔离世界|1|谨慎|指南针'
 else:text='成功'
 route.fulfill(status=200,content_type='application/json',body=json.dumps({'choices':[{'finish_reason':finish,'message':{'role':'assistant','content':text}}]}))
EXT='/scripts/extensions/third-party/zhutianxitongchajianban/src/'
def z(page):return js(page,'__zhutianApp.adapter.ledger()')
def save(page,body):return js(page,'async()=>{const a=__zhutianApp;await a.bridge.updateVariablesWith(v=>{'+body+';return v;},{type:"chat"});}')
def action(page,selector):
 return js(page,"async selector=>{const a=__zhutianApp;const b=a.hub.engineFrame.contentDocument.querySelector(selector);try{await a.commerce.handle(b,a.hub.engineFrame);return 'ok'}catch(e){return e.message}}" ) if False else page.evaluate("async selector=>{const a=__zhutianApp;const b=a.hub.engineFrame.contentDocument.querySelector(selector);try{await a.commerce.handle(b,a.hub.engineFrame);return 'ok'}catch(e){return e.message}}",selector)
def touch_drag(page,session,x,y,dx,dy):
 session.send('Input.dispatchTouchEvent',{'type':'touchStart','touchPoints':[{'x':x,'y':y}]})
 for i in range(1,9):session.send('Input.dispatchTouchEvent',{'type':'touchMove','touchPoints':[{'x':x+dx*i/8,'y':y+dy*i/8}]})
 session.send('Input.dispatchTouchEvent',{'type':'touchEnd','touchPoints':[]});page.wait_for_timeout(500)
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True,args=['--no-sandbox']);ctx=browser.new_context(viewport={'width':1280,'height':860});page=ctx.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)));page.on('dialog',lambda d:d.accept());page.route('**/v1/chat/completions',mock)
 Z.boot(page);Z.setup_chat(page);page.wait_for_timeout(2500)
 js(page,f"async()=>{{const a=__zhutianApp;const api=await import('{EXT}api-center.js');await api.saveConfigs(a.bridge,'诸天记忆助手_v1',{{url:'http://127.0.0.1:5001/v1',key:'fixture-only-not-a-secret',model:'mock-zt'}});a.settings.set('floatLilith','off');a.hub.open('shop');}}")
 page.wait_for_timeout(1800)
 ok('all new modules mounted',js(page,"['commerce','collect','bonds','records','windowControls'].every(k=>!!__zhutianApp[k])"))
 save(page,"v.诸天系统.系统点=1000000;v.诸天系统.商品历史=[];v.诸天系统.商城库存=[];v.诸天系统.待处理物品=[];v.诸天系统.盲盒状态={累计抽数:0,保底计数:0};v.诸天系统.羁绊库=[];v.诸天系统.剧情收纳库=[]")
 before=z(page)['系统点'];r=action(page,'.btn-refresh-store');page.wait_for_timeout(700);state=z(page)
 ok('shop verified commit + exact fee and 8 products',r=='ok' and state['系统点']==before-500 and len(state['商城库存'])==8,r)
 first={x['名称'] for x in state['商城库存']};r=action(page,'.btn-refresh-store');state=z(page)
 ok('second refresh avoids recent products and keeps history',r=='ok' and not first.intersection(x['名称'] for x in state['商城库存']) and len(state['商品历史'])==16,r)
 ok('refresh display records absent',js(page,"![...__zhutianApp.hub.engineFrame.contentDocument.querySelectorAll('.cart-items-list li')].some(x=>x.textContent.includes('商城刷新'))"))
 # Use first affordable product button; ordinary high grades visible at low shop level.
 sel=js(page,"()=>{const d=__zhutianApp.hub.engineFrame.contentDocument;return [...d.querySelectorAll('.btn-buy-item')].find(b=>Number(b.dataset.price)<1000)?.dataset.name}")
 r=page.evaluate("async name=>{const a=__zhutianApp,b=[...a.hub.engineFrame.contentDocument.querySelectorAll('.btn-buy-item')].find(b=>b.dataset.name===name);try{await a.commerce.handle(b,a.hub.engineFrame);return 'ok'}catch(e){return e.message}}",sel)
 ok('purchase writes real inventory once',r=='ok' and any(x['名称']==sel for x in z(page)['背包']),r)
 before=z(page);api_mode='bad';r=action(page,'.btn-refresh-store');api_mode='good';after=z(page)
 ok('invalid generation no fee / inventory mutation',r!='ok' and before['系统点']==after['系统点'] and before['商城库存']==after['商城库存'],r[:120])
 before=z(page);r=action(page,'.btn-gacha[data-times="10"]');page.wait_for_timeout(600);after=z(page)
 ok('10 draws committed atomically with pending items',r=='ok' and after['系统点']==before['系统点']-100000 and len(after['待处理物品'])==len(before['待处理物品'])+10 and after['盲盒状态']['累计抽数']==before['盲盒状态']['累计抽数']+10,r)
 # Real selector capture path must block original code from executing after ours.
 before=z(page)['系统点'];js(page,"__zhutianApp.hub.engineFrame.contentDocument.querySelector('.btn-refresh-store').click()");page.wait_for_function('!__zhutianApp.commerce.busy',timeout=60000);page.wait_for_timeout(500)
 ok('capture handler prevents duplicate legacy fee',z(page)['系统点']==before-500)
 # Records selection and preview
 js(page,"()=>{const a=__zhutianApp,w=a.hub.engineFrame.contentWindow,r=w.document.querySelector('.mvu-sys');w.addCartRecord(r,'商城刷新','测试不入正文');w.addCartRecord(r,'分解','测试杂物');w.addCartRecord(r,'购买','测试实物');}")
 page.wait_for_timeout(300)
 js(page,"__zhutianApp.hub.engineFrame.contentDocument.querySelector('.btn-checkout').click()");page.wait_for_timeout(200)
 preview=js(page,"__zhutianApp.hub.pages.get('record-preview')?.el.querySelector('textarea')?.value||''")
 ok('selected-record preview excludes refresh/recycle by default',bool(preview) and '商城刷新' not in preview and '测试杂物' not in preview and '测试实物' in preview)
 # Story source and pending grade
 js(page,"async()=>{const c=__zhutianApp.adapter.context();c.chat[5].mes='你收下了青铜钥匙一枚，可开启古城大门。'+c.chat[5].mes;await c.saveChat();__zhutianApp.hub.go('collect');}")
 page.wait_for_timeout(500)
 r=js(page,"async()=>{try{await __zhutianApp.collect.extract();return 'ok'}catch(e){return e.message}}")
 ok('story candidates have cited real source and pending grade',r=='ok' and js(page,"__zhutianApp.collect.draft?.rows[0]?.grade==='待鉴定'"),r)
 if r=='ok':
  js(page,"__zhutianApp.collect.el.querySelector('[name=selected]').checked=true")
  r=js(page,"async()=>{try{await __zhutianApp.collect.confirm();return 'ok'}catch(e){return e.message}}")
  ok('unknown story item stored pending not silently mortal',r=='ok' and z(page)['剧情收纳库'][-1]['status']=='pending' and not any(x['名称']=='青铜钥匙' for x in z(page)['背包']),r)
  r=js(page,"async()=>{const a=__zhutianApp;try{await a.collect.pending(a.adapter.ledger().剧情收纳库.at(-1).receipt,'仙品');return 'ok'}catch(e){return e.message}}")
  ok('manual rank confirmation books item and preserves source rank',r=='ok' and any(x['名称']=='青铜钥匙' and x['原世界品阶']=='天阶' and x['品级']=='仙品' for x in z(page)['背包']),r)
 # Multi-person legacy changes and graph
 save(page,"v.诸天系统.恋爱目标={姓名:'甲',好感度:30,世界:'世界一'}")
 save(page,"v.诸天系统.恋爱目标={姓名:'乙',好感度:55,世界:'世界二'}")
 js(page,"__zhutianApp.hub.go('bond')")
 ok('multi-person page retains both legacy targets',len(z(page)['羁绊库'])==2 and js(page,"__zhutianApp.bonds.el.querySelectorAll('[data-person]').length===2"))
 old=z(page)['恋爱目标'];js(page,"__zhutianApp.bonds.el.querySelector('[data-person]').click()")
 ok('viewing a different person does not switch active target',z(page)['恋爱目标']==old)
 graph=js(page,f"async()=>{{const m=await import('{EXT}hub-atlas.js');return m.buildBonds(__zhutianApp.adapter.ledger()).nodes.filter(n=>n.bond).length}}")
 ok('relationship graph reads the same multi-person catalog',graph==2)
 # API truncation retry budget and cap
 api_mode='empty';n=len(calls);r=js(page,"async()=>{try{await __zhutianApp.bridge.customChat({url:'http://127.0.0.1:5001/v1',model:'mock'},[{role:'user',content:'test'}],{maxTokens:4096});return 'ok'}catch(e){return e.message}}")
 ok('empty truncated response one bounded retry, honest error',len(calls)-n==2 and calls[-1]['max_tokens']==8192 and '未提供足够信息' in r,r)
 n=len(calls);r=js(page,"async()=>{try{await __zhutianApp.bridge.customChat({url:'http://127.0.0.1:5001/v1',model:'mock',maxTokens:1000},[{role:'user',content:'test'}]);return 'ok'}catch(e){return e.message}}")
 ok('explicit configured output cap is not exceeded',len(calls)-n==1 and calls[-1]['max_tokens']==1000)
 api_mode='good';before=z(page)['系统点'];r=js(page,"async()=>{try{await __zhutianApp.group.recruit('rand','');return 'ok'}catch(e){return e.message}}")
 ok('group recruitment uses adequate budget, candidate persisted',r=='ok' and bool(z(page).get('聊天群',{}).get('候选')),r)
 api_mode='bad';before=z(page)['系统点'];r=js(page,"async()=>{try{await __zhutianApp.group.recruit('rand','');return 'ok'}catch(e){return e.message}}")
 ok('failed recruitment no system point deduction',r!='ok' and z(page)['系统点']==before,r[:120]);api_mode='good'
 # Identity-change fault injection while a real mocked API generation is in progress.
 before=z(page)
 r=js(page,"""async()=>{const a=__zhutianApp,gen=a.bridge.generateRaw,id=a.adapter.currentIdentity;
 a.bridge.generateRaw=async function(...args){const text=await gen.apply(this,args);a.adapter.currentIdentity=()=> 'fixture-switched-chat';return text;};
 try{await a.commerce.handle(a.hub.engineFrame.contentDocument.querySelector('.btn-refresh-store'),a.hub.engineFrame);return 'unexpected success';}
 catch(e){return e.message;}finally{a.bridge.generateRaw=gen;a.adapter.currentIdentity=id;}}""")
 ok('identity-change fault after generation rejects before charge', '已变化' in r and z(page)==before,r)
 # Real worldbook disk writes: preserve altered text, entry settings, extra entries; latest other rules install.
 r=js(page,f"""async()=>{{const a=__zhutianApp,c=a.adapter.context(),m=await import('{EXT}worldbook.js'), rules=m.latestRules(a.original.ZhuTianBuiltinRules,{{legacy:true}}).rules;
 const shop=rules.find(x=>x.comment==='09｜商城｜系统商城');shop.content='fixture-custom-shop-text';shop.disable=true;shop.key=['fixture-custom-key'];shop.depth=7;
 rules.push({{...rules[0],uid:99,comment:'fixture-extra-rule',content:'keep-me'}});
 await c.saveWorldInfo('诸天万界最强系统',{{fixtureMetadata:'keep-top-level',entries:Object.fromEntries(rules.map((x,i)=>[i,{{...x,uid:i}}]))}},true);
 const conf=globalThis.confirm;globalThis.confirm=()=>false;
 try{{const result=await a.features.updateWorldbook();const get=async name=>{{const r=await fetch('/api/worldinfo/get',{{method:'POST',headers:c.getRequestHeaders(),body:JSON.stringify({{name}})}});return r.json();}};
 return {{result,book:await get('诸天万界最强系统'),backup:await get(result.backup)}};}}finally{{globalThis.confirm=conf;}}}}""")
 rows=list(r['book']['entries'].values());shop=next(x for x in rows if x['comment']=='09｜商城｜系统商城')
 ok('worldbook update real disk backup + conflict refusal preserves custom text/settings',r['result']['preserved']==1 and shop['content']=='fixture-custom-shop-text' and shop['disable'] and shop['key']==['fixture-custom-key'] and shop['depth']==7)
 ok('worldbook update preserves custom entry and metadata, upgrades unaffected rules',r['book'].get('fixtureMetadata')=='keep-top-level' and any(x['comment']=='fixture-extra-rule' for x in rows) and any('剧情收纳与品阶' in x['content'] for x in rows) and len(r['backup']['entries'])==37)
 r=js(page,"""async()=>{const a=__zhutianApp,real=globalThis.fetch;globalThis.fetch=(u,o)=>String(u)==='/api/worldinfo/get' && JSON.parse(o.body).name.includes('-备份-') ? Promise.resolve(new Response('{}',{status:503})):real(u,o);
 try{await a.features.updateWorldbook();return 'unexpected success';}catch(e){return e.message;}finally{globalThis.fetch=real;}}""")
 ok('worldbook disk backup verification failure stops update (not fooled by host cache)','核验失败 HTTP 503' in r,r)
 # A server read failure before mutation: nothing changes and no uncertain marker.
 before=z(page)
 r=js(page,"""async()=>{const a=__zhutianApp,real=globalThis.fetch;globalThis.fetch=(u,o)=>String(u)==='/api/chats/get'?Promise.resolve(new Response('{}',{status:503})):real(u,o);
 try{await a.bridge.updateVariablesWith(v=>{v.诸天系统.系统点++;return v;},{type:'chat',verify:true});return 'unexpected success';}catch(e){return e.message;}finally{globalThis.fetch=real;}}""")
 ok('ledger pre-read failure leaves all variables unchanged','HTTP 503' in r and z(page)==before,r)
 # A post-save read failure: the save may have succeeded, so freeze including a writer already queued on the lock.
 r=js(page,"""async()=>{const a=__zhutianApp,real=globalThis.fetch;let reads=0,mutations=0;
 globalThis.fetch=(u,o)=>String(u)==='/api/chats/get' && ++reads===2?Promise.resolve(new Response('{}',{status:503})):real(u,o);
 const write=()=>a.bridge.updateVariablesWith(v=>{mutations++;v.诸天系统.系统点++;return v;},{type:'chat',verify:true});
 try{const results=await Promise.allSettled([write(),write()]);return {mutations,errors:results.map(x=>x.reason?.message||'success'),frozen:a.adapter.transactions.uncertain.has(a.adapter.currentIdentity())};}finally{globalThis.fetch=real;}}""")
 ok('post-save failure freezes uncertain transaction AND queued writer',r['frozen'] and r['mutations']==1 and all('冻结' in e for e in r['errors']),r)
 # Reload verifies saved actual server state.
 before=z(page);page.reload();page.wait_for_function('!!globalThis.__zhutianApp',timeout=60000);page.wait_for_timeout(3000);Z.open_chat(page);page.wait_for_timeout(1500)
 ok('reload retains purchased items and pending draw inventory',z(page)['背包']==before['背包'] and z(page)['待处理物品']==before['待处理物品'])
 js(page,"__zhutianApp.hub.open('commerce')");page.screenshot(path=str(out/'commerce-desktop.png'))
 ok('desktop runtime no pageerror',not errors,errors)
 ctx.close()
 # Touch-pointer interactions, not synthetic mouse-only testing.
 ctx=browser.new_context(viewport={'width':390,'height':844},is_mobile=True,has_touch=True,device_scale_factor=1);page=ctx.new_page();page.on('dialog',lambda d:d.accept());page.on('pageerror',lambda e:errors.append(str(e)));Z.boot(page);Z.open_chat(page)
 js(page,"()=>{const a=__zhutianApp;a.settings.set('floatLilith','off');a.settings.set('touchWindowBox',null);a.settings.set('circlePosition',null);a.settings.set('mobileLayout','full');a.hub.open('shop');}");page.wait_for_timeout(800)
 js(page,"__zhutianApp.hub.shadow.querySelector('#zt-layout-toggle').click()");page.wait_for_timeout(500)
 ok('phone visible toggle exits full layout',js(page,"!__zhutianApp.mobile.full && __zhutianApp.settings.get('mobileLayout')==='window'"))
 session=ctx.new_cdp_session(page)
 rect=js(page,"()=>{const r=__zhutianApp.hub.shadow.querySelector('#drag-handle').getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height}}")
 before=js(page,"()=>{const r=__zhutianApp.hub.shell.dialog.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height}}")
 touch_drag(page,session,rect['x']+rect['w']*.45,rect['y']+rect['h']*.6,0,70)
 after=js(page,"()=>{const r=__zhutianApp.hub.shell.dialog.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height}}")
 ok('phone real touch drags floating window',after['y']>before['y']+10,{'before':before,'after':after})
 rect=js(page,"()=>{const r=__zhutianApp.hub.shadow.querySelector('#zt-touch-resize').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}}")
 touch_drag(page,session,rect['x'],rect['y'],-75,-100)
 after2=js(page,"()=>{const r=__zhutianApp.hub.shell.dialog.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height}}")
 ok('phone real touch resizes below old 380px minimum',after2['w']<before['w']-20 and after2['h']<before['h']-40,after2)
 page.screenshot(path=str(out/'phone-window.png'))
 saved=js(page,"__zhutianApp.settings.get('touchWindowBox')")
 js(page,"()=>{__zhutianApp.hub.shadow.querySelector('#zt-layout-toggle').click();__zhutianApp.hub.shadow.querySelector('#zt-layout-toggle').click()}");page.wait_for_timeout(300)
 ok('touch size survives fullscreen round trip',js(page,"Math.abs(__zhutianApp.hub.shell.dialog.getBoundingClientRect().width-__zhutianApp.settings.get('touchWindowBox').w)<2"))
 js(page,"__zhutianApp.hub.shadow.querySelector('#reset-window').click()");page.wait_for_timeout(300)
 ok('phone reset button resets touch size, not desktop memory',js(page,"__zhutianApp.settings.get('touchWindowBox')===null&&__zhutianApp.hub.shell.dialog.getBoundingClientRect().width>350"))
 js(page,"__zhutianApp.hub.shell.dialog.close()");page.wait_for_timeout(400)
 rect=js(page,"()=>{const r=__zhutianApp.hub.shadow.querySelector('#entry').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}}")
 touch_drag(page,session,rect['x'],rect['y'],5-rect['x'],0)
 ok('circular launcher tucks at left edge',js(page,"__zhutianApp.settings.get('circlePosition')?.tucked===true"))
 page.touchscreen.tap(9,rect['y']);page.wait_for_timeout(400)
 ok('tucked circle restores with tap',js(page,"__zhutianApp.settings.get('circlePosition')?.tucked===false"))
 rect=js(page,"()=>{const r=__zhutianApp.hub.shadow.querySelector('#entry').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}}")
 touch_drag(page,session,rect['x'],rect['y'],385-rect['x'],0)
 ok('circular launcher also tucks at right edge',js(page,"__zhutianApp.settings.get('circlePosition')?.tucked===true&&__zhutianApp.settings.get('circlePosition')?.edge==='right'"))
 page.touchscreen.tap(382,rect['y']);page.wait_for_timeout(300)
 ok('right-edge circle restores without opening terminal',js(page,"!__zhutianApp.settings.get('circlePosition')?.tucked&&!__zhutianApp.hub.shell.dialog.open"))
 page.screenshot(path=str(out/'phone-circle.png'))
 ok('all browser runs no pageerror',not errors,errors)
 ctx.close();browser.close()
(out/'results.json').write_text(json.dumps(results,ensure_ascii=False,indent=2));print(f'{sum(x["pass"] for x in results)}/{len(results)} passed')
if not all(x['pass'] for x in results):sys.exit(1)

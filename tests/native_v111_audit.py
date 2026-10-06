"""1.1.1 audit regression in a REAL (disposable) SillyTavern + deterministic mock model. Not real-model / phone acceptance.
python tests/native_v111_audit.py --isolated-test-only --base-url http://127.0.0.1:8019
Needs tests/qa/mock_model.py on :5001 (main replies for 【1.1.1缺块】 and 【审计重roll】).
Covers: #1 atomic 保留/分解/回收 (real engine buttons) · #2 补记 vs a finished transaction · #3 补记 pinned to chat A ·
#4 full-length 还原原文 · #5 strict stacking · #6 nothing written after the plugin stops · #7 swipe/regenerate does not
stack 专属资源 (with a control run proving the fixture catches the old behaviour) · P2 honest gacha message.
"""
import argparse, json, sys, re, hashlib, time
from pathlib import Path
from playwright.sync_api import sync_playwright
sys.path.insert(0, str(Path(__file__).parent/'qa'))
import zt_common as Z
ap=argparse.ArgumentParser();ap.add_argument('--isolated-test-only',action='store_true',required=True);ap.add_argument('--base-url',default='http://127.0.0.1:8019');ap.add_argument('--output',default='/tmp/zt-v111-audit');args=ap.parse_args()
Path('/var/tmp/qa').mkdir(parents=True,exist_ok=True);out=Path(args.output);out.mkdir(parents=True,exist_ok=True);Z.configure(args.base_url,'http://127.0.0.1:5001/v1',out)
results=[];calls={'product':0};fail={'get':0,'save':0};saves=[]
def ok(name,cond,detail=''):
    results.append({'name':name,'pass':bool(cond),'detail':str(detail)[:300]});print(('PASS ' if cond else 'FAIL ')+name+' '+str(detail)[:300],flush=True)
def js(s,arg=None):return page.evaluate(s,arg) if arg is not None else page.evaluate(s)
EXT='/scripts/extensions/third-party/zhutianxitongchajianban/'
F='系统点: 1000\n好感度: 30/100\n当前任务: 引气入体\n任务进度: 35\n功法修炼: 无\n系统播报: 补记'
def mock(route):
    body=route.request.post_data_json or {};msgs=body.get('messages',[]);sysmsg=next((m.get('content','') for m in msgs if m.get('role')=='system'),'');u=next((m.get('content','') for m in msgs if m.get('role')=='user'),'')
    if '商品内容生成器' in sysmsg:
        calls['product']+=1;slots=json.loads(re.search(r'槽位：(\[.*\])\n仅输出',u).group(1))
        text=json.dumps([dict(slot=s['id'],name=f'审计商品{calls["product"]}-{s["id"]}',effect=f'隔离模拟效果 {hashlib.sha256(f"{calls["product"]}-{s["id"]}".encode()).hexdigest()[:24]}',world=s['world'] or f'测试世界{s["theme"]}',theme=s['theme'],category=s['category'],grade=s['grade'],origin='原创') for s in slots],ensure_ascii=False)
    elif '数据块记账员' in sysmsg: text='<ZhuTianPanel>\n'+F+'\n</ZhuTianPanel>'
    else: text='成功'
    route.fulfill(status=200,content_type='application/json',body=json.dumps({'choices':[{'finish_reason':'stop','message':{'role':'assistant','content':text}}]}))
def chats_get(route):
    if fail['get']>0: fail['get']-=1; return route.fulfill(status=500,body='injected read failure')
    route.continue_()
def chats_save(route):
    if fail['save']>0: fail['save']-=1; return route.fulfill(status=500,body='injected save failure')
    route.continue_()
def z():return js('__zhutianApp.adapter.ledger()')
def save(body):return js('async()=>{await __zhutianApp.bridge.updateVariablesWith(v=>{'+body+';return v;},{type:"chat"});}')
def disk():return js("""async()=>{const c=SillyTavern.getContext();const r=await fetch('/api/chats/get',{method:'POST',headers:c.getRequestHeaders(),body:JSON.stringify({avatar_url:c.characters[c.characterId].avatar,file_name:c.getCurrentChatId()})});const a=await r.json();return {z:a[0].chat_metadata.variables?.诸天系统,last:a.at(-1)?.mes,n:a.length-1}}""")
def idle():
    page.wait_for_function("getComputedStyle(document.querySelector('#mes_stop')).display==='none'",timeout=60000)
def send(text,settle=2500):
    n=js("SillyTavern.getContext().chat.length")
    page.locator('#send_textarea').fill(text);page.locator('#send_but').click()
    page.wait_for_function(f"SillyTavern.getContext().chat.length>={n+2}",timeout=60000);idle();page.wait_for_timeout(settle)
def wait_js(cond,ms=15000):
    try: page.wait_for_function(cond,timeout=ms);return True
    except Exception: return False
def gate():
    """Holds every 补记 model call until window.__release() — a controllable 'model still answering' window."""
    js("""()=>{const b=__zhutianApp.bridge;window.__bf=0;window.__release=null;if(b.__gated)return;b.__gated=true;const orig=b.generateRaw.bind(b);
      b.generateRaw=async o=>{if(o?.route==='panel'){window.__bf++;await new Promise(r=>window.__release=r);}return orig(o);};}""")
def guard_toasts():
    js("()=>{const g=__zhutianApp.panelGuard;window.__gt=[];const T=g.toast.bind(g);g.toast=(m,...r)=>{window.__gt.push(m);return T(m,...r)};}")
def click_engine(sel,times=1):
    """Real click events on the engine frame's buttons (the commerce capture listener sees exactly what a player clicks)."""
    return js("""async ([sel,times])=>{const a=__zhutianApp,d=a.hub.engineFrame.contentDocument,b=d.querySelector(sel);if(!b)return 'missing';
      const toasts=[];const T=a.hub.toast.bind(a.hub);a.hub.toast=(m,...r)=>{toasts.push(m);return T(m,...r)};
      for(let i=0;i<times;i++)b.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true}));
      for(let i=0;i<80&&(a.commerce.busy||!toasts.length);i++)await new Promise(r=>setTimeout(r,100));
      a.hub.toast=T;return toasts;}""",[sel,times])
def engine_view():
    js("__zhutianApp.hub.scheduleEngineView(0)");page.wait_for_timeout(900)

with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,args=['--no-sandbox']);ctx=browser.new_context(viewport={'width':1280,'height':860});page=ctx.new_page();errors=[]
    page.on('pageerror',lambda e:errors.append(f'[after step {len(results)}: {results[-1]["name"][:40] if results else "-"}] '+str(e)+' '+(getattr(e,'stack','') or '')[:3000]));page.on('dialog',lambda d:d.accept())
    page.on('request',lambda r:saves.append(time.time()) if r.url.endswith('/api/chats/save') else None)
    page.route('http://127.0.0.1:5001/v1/chat/completions',mock);page.route('**/api/chats/get',chats_get);page.route('**/api/chats/save',chats_save)
    Z.boot(page);Z.setup_chat(page);page.wait_for_timeout(2000)
    ok('main API connected to mock',Z.connect_main_api(page) not in (None,'no_connection'))
    js(f"async()=>{{const a=__zhutianApp;const api=await import('{EXT}src/api-center.js');await api.saveConfigs(a.bridge,'诸天记忆助手_v1',{{url:'http://127.0.0.1:5001/v1',key:'fixture-only-not-a-secret',model:'mock-zt'}});a.settings.set('floatLilith','off');}}")
    ok('reroll guard is the FIRST GENERATION_STARTED listener',js("()=>{const c=SillyTavern.getContext(),l=c.eventSource.events[c.eventTypes.GENERATION_STARTED]||[];return !!__zhutianApp.rerollGuard&&String(l[0]).includes('onStart')}"))

    # ---------- #7 重roll：swipe / regenerate 不叠加 专属资源 ----------
    save("Object.assign(v.诸天系统,{专属资源:{天命印记:0,血脉结晶:0,因果筹码:0,名望:100,岁月沉淀:0},资源行:'天命印记0｜血脉结晶0｜因果筹码0｜名望100｜岁月沉淀0',持有金额:'500',当前货币:'灵石'})")
    send('接委托【审计重roll】当前资源：{{get_chat_variable::诸天系统.资源行}}')
    ok('first reply booked: 名望 100 → 150',wait_js("__zhutianApp.adapter.ledger().专属资源?.名望===150"),z().get('专属资源'))
    def last_prompt():
        rows=[json.loads(l) for l in Path('/var/tmp/qa/mock.jsonl').read_text('utf8').strip().split('\n') if '【审计重roll】' in l]
        msgs=rows[-1]['body'].get('messages',[]);return next((m.get('content','') for m in reversed(msgs) if m.get('role')=='user'),'')
    ok('the first prompt showed 名望100',('名望100' in last_prompt()),re.search(r'当前资源：\S+',last_prompt()).group(0) if '当前资源：' in last_prompt() else '')
    page.locator('#chat .last_mes .swipe_right').click();page.wait_for_timeout(800);idle();page.wait_for_timeout(3000)
    sw=js("()=>{const m=SillyTavern.getContext().chat.at(-1);return {n:m.swipes?.length,id:m.swipe_id}}")
    ok('swipe generated a second reply',sw['n']==2 and sw['id']==1,sw)
    ok('swipe prompt shows the floor BEFORE the old reply (名望100, not 150)',('名望100' in last_prompt()) and ('名望150' not in last_prompt()),re.search(r'当前资源：\S+',last_prompt()).group(0) if '当前资源：' in last_prompt() else '')
    ok('after the swipe 名望 is 150, not stacked to 200',wait_js("__zhutianApp.adapter.ledger().专属资源?.名望===150",8000) and z()['专属资源']['名望']==150,z().get('专属资源'))
    page.locator('#chat .last_mes .swipe_left').click();page.wait_for_timeout(3500)
    ok('swiping back to the first reply re-books it from the snapshot (150)',wait_js("__zhutianApp.adapter.ledger().专属资源?.名望===150",8000),z().get('专属资源'))
    js("()=>{jQuery('#option_regenerate').trigger('click')}");page.wait_for_timeout(1000);idle();page.wait_for_timeout(3000)
    ok('regenerate: prompt showed 名望100 and the result is 150',('名望100' in last_prompt()) and wait_js("__zhutianApp.adapter.ledger().专属资源?.名望===150",8000),(z().get('专属资源'),re.search(r'当前资源：\S+',last_prompt()).group(0) if '当前资源：' in last_prompt() else ''))
    d=disk();ok('ledger on disk agrees (名望 150)',d['z']['专属资源']['名望']==150,d['z'].get('专属资源'))
    ok('持有金额 not stacked (600 from the 500 basis)',str(z().get('持有金额'))=='600',z().get('持有金额'))
    # control: without the guard the very same fixture stacks → the checks above are meaningful
    js("()=>__zhutianApp.rerollGuard.dispose()")
    page.locator('#chat .last_mes .swipe_right').click();page.wait_for_timeout(800);idle();page.wait_for_timeout(3500)
    ok('CONTROL (guard off): the same swipe stacks 名望 to 200 — the bug the guard prevents',wait_js("__zhutianApp.adapter.ledger().专属资源?.名望===200",8000),z().get('专属资源'))

    # ---------- #3 补记 queued in chat A must not run in chat B ----------
    Z.reboot(page);Z.open_chat(page);Z.connect_main_api(page);gate();guard_toasts()
    names=js("""async()=>{const c=SillyTavern.getContext();const a=c.getCurrentChatId();const s=await import('/script.js');await s.doNewChat({deleteCurrentChat:false});
      await new Promise(r=>setTimeout(r,1500));const b=SillyTavern.getContext().getCurrentChatId();await SillyTavern.getContext().openCharacterChat(a);await new Promise(r=>setTimeout(r,1500));return {a,b}}""")
    ok('fixture: two chats of the same character',names['a']!=names['b'] and js("SillyTavern.getContext().getCurrentChatId()")==names['a'],names)
    n=js("SillyTavern.getContext().chat.length")
    # switch to B 50 ms after the reply arrives — the 补记 timer (1.2 s) was already queued in A
    js("(b)=>{const c=SillyTavern.getContext(),e=c.eventTypes.MESSAGE_RECEIVED;const f=()=>{c.eventSource.removeListener(e,f);setTimeout(()=>SillyTavern.getContext().openCharacterChat(b),50);};c.eventSource.on(e,f);}",names['b'])
    page.locator('#send_textarea').fill('看看四周【1.1.1缺块】');page.locator('#send_but').click()
    ok('the switch to B happened',wait_js(f"SillyTavern.getContext().getCurrentChatId()==={json.dumps(names['b'])}",60000));page.wait_for_timeout(4500)
    bchat=js("()=>SillyTavern.getContext().chat.map(m=>m.mes)")
    ok('chat B: no 补记 request, nothing appended',js("window.__bf")==0 and not any('<ZhuTianPanel>' in m and '补记' in m for m in bchat),(js("window.__bf"),bchat[-1][:80] if bchat else ''))
    js("async(a)=>{await SillyTavern.getContext().openCharacterChat(a)}",names['a']);page.wait_for_timeout(2500)
    d=disk();ok('chat A: no 补记 block written after the switch (memory + disk)','系统播报: 补记' not in d['last'] and '系统播报: 补记' not in js("SillyTavern.getContext().chat.at(-1).mes"),d['last'][:80])

    # ---------- #2 补记 must not undo a transaction booked while the model answers ----------
    gate();guard_toasts()
    send('再看看【1.1.1缺块】',settle=0)
    ok('automatic 补记 is waiting for the model',wait_js("window.__bf===1",8000))
    pts=z()['系统点'];save(f"v.诸天系统.系统点={pts-200};v.诸天系统.界面记账时间=Date.now()")
    js("()=>window.__release()");page.wait_for_timeout(2500)
    m=js("SillyTavern.getContext().chat.at(-1).mes");d=disk()
    ok('补记 refused: no block written, the new balance stands (memory + disk)','<ZhuTianPanel>' not in m and z()['系统点']==pts-200 and d['z']['系统点']==pts-200 and '<ZhuTianPanel>' not in d['last'],(z()['系统点'],d['z']['系统点']))
    ok('the player is told why',any('账本有变化' in t for t in js("window.__gt")),js("window.__gt")[-1:])

    # ---------- #6 a pending 补记 writes nothing after the plugin is stopped ----------
    gate();js("()=>__zhutianApp.panelGuard.manualBackfill()")
    ok('second 补记 waiting',wait_js("window.__bf===1",8000))
    before=disk()['last']
    js(f"async()=>{{const m=await import('{EXT}index.js');window.__ztMod=m;await m.deactivate();}}");page.wait_for_timeout(1500);saves.clear()
    js("()=>window.__release()");page.wait_for_timeout(3000)
    m=js("SillyTavern.getContext().chat.at(-1).mes");d=disk()
    ok('after stop: chat not changed, no chat save, disk unchanged','<ZhuTianPanel>' not in m and not saves and d['last']==before,(len(saves),m[-60:]))
    js("async()=>{await window.__ztMod.activate();}");page.wait_for_function('!!globalThis.__zhutianApp',timeout=60000);page.wait_for_timeout(3000)

    # ---------- #4 还原原文 restores a long reply completely ----------
    raw=js("""async()=>{const c=SillyTavern.getContext(),m=c.chat.at(-1);m.mes='长正文'.repeat(21000)+'\\n<zhutianpanel>\\n系统点: 1000\\n子系统: 1\\n好感度: 20\\n当前任务: 暂无任务\\n功法修炼: 无\\n系统播报: 补记\\n</zhutianpanel>';m.swipes[m.swipe_id]=m.mes;
      await c.saveChat();__zhutianApp.panelGuard.seen='';__zhutianApp.panelGuard.check(c.chat.length-1,'received','normal');await new Promise(r=>setTimeout(r,2000));return {len:m.mes.length,bk:m.extra?.zhutianCovenantTerminal?.panelRepair?.raw?.length}}""")
    ok('long polluted reply repaired, full backup kept (63084 chars)',raw['bk']==63084,raw)
    js("async()=>{await __zhutianApp.panelGuard.restore()}");page.wait_for_timeout(2500)
    d=disk();ok('还原: memory and disk hold all 63084 characters',js("SillyTavern.getContext().chat.at(-1).mes.length")==63084 and len(d['last'])==63084,len(d['last']))

    # ---------- #1 / #5 items through the real engine buttons ----------
    js("__zhutianApp.openTerminal('shop')");page.wait_for_timeout(2500)
    js("()=>{const d=__zhutianApp.hub.engineFrame.contentDocument;d.querySelector('.mvu-nav-item input.t5')?.click();}")
    save("Object.assign(v.诸天系统,{系统点:0,操作日志:[],背包:[{名称:'玉净瓶',品级:'仙品',来源:'剧情',价格:1,分类:'其他',效果:'',数量:1}],待处理物品:[{名称:'玉净瓶',品级:'仙品',来源:'盲盒',价格:10000000,分类:'其他',效果:'',数量:1},{名称:'草',品级:'凡品',来源:'盲盒',价格:100,分类:'素材',效果:'',数量:2},{名称:'果',品级:'灵品',来源:'盲盒',价格:10000,分类:'消耗品',效果:'',数量:1}],待处理折叠:{凡品:false,灵品:false,仙品:false,神品:false}})")
    page.wait_for_timeout(1200);engine_view()
    ok('fixture: pending buttons rendered in the engine',js("!!__zhutianApp.hub.engineFrame.contentDocument.querySelector('.btn-keep-item[data-idx=\"0\"]')"))
    t=click_engine('.btn-keep-item[data-idx="0"]');zz=z();d=disk()
    ok('保留 blind-box 仙品: its own row (not merged into the price-1 story 仙品)',len(zz['背包'])==2 and sorted(x['价格'] for x in zz['背包'])==[1,10000000] and len(zz['待处理物品'])==2,(t,[(x['名称'],x['价格'],x['数量']) for x in zz['背包']]))
    ok('保留 saved and verified on disk; one log entry',d['z']['背包']==zz['背包'] and d['z']['待处理物品']==zz['待处理物品'] and sum(1 for x in zz.get('操作日志',[]) if x['kind']=='item')==1)
    engine_view()
    fail['get']=1;t=click_engine('.btn-decomp-item[data-idx="0"]');zz=z();d=disk()
    ok('分解 with a failed server check: nothing changes, player told so',zz['系统点']==0 and len(zz['待处理物品'])==2 and d['z']['系统点']==0 and any('都没有变化' in x for x in t),t)
    engine_view();t=click_engine('.btn-decomp-item[data-idx="0"]');zz=z()
    ok('分解 retried: +20 points, one item gone',zz['系统点']==20 and len(zz['待处理物品'])==1,(t,zz['系统点']))
    engine_view();t=click_engine('.btn-keep-all',times=2);zz=z();d=disk()
    grass=sum(x['数量'] for x in zz['背包'] if x['名称']=='果')
    ok('全部保留 clicked twice: kept once (果 ×1), 待处理 empty, disk agrees',zz['待处理物品']==[] and grass==1 and d['z']['背包']==zz['背包'],(t,[(x['名称'],x['数量']) for x in zz['背包']]))
    js("()=>{const d=__zhutianApp.hub.engineFrame.contentDocument;d.querySelector('.mvu-nav-item input.t5')?.click();}");engine_view()
    idx=next(i for i,x in enumerate(z()['背包']) if x['价格']==10000000)
    t=click_engine(f'.btn-recycle-item[data-idx="{idx}"]');zz=z()
    ok('回收 the blind-box 仙品 pays 1,000,000 (not 1 from a merged price)',zz['系统点']==20+1000000 and not any(x['价格']==10000000 for x in zz['背包']),(t,zz['系统点']))
    ok('无限口袋 path uses the strict stacking rule too',js("()=>!!__zhutianApp.hub.engineFrame.contentWindow.bagAdd.__zt"))

    # ---------- P2 gacha: an unverified save is never reported as 未扣系统点 ----------
    save("Object.assign(v.诸天系统,{系统点:5000000,商品历史:[],待处理物品:[],盲盒状态:{累计抽数:0,保底计数:0,仙品次数:0,神品次数:0}})");page.wait_for_timeout(1000);engine_view()
    fail['save']=1
    r=js("""async()=>{const a=__zhutianApp,d=a.hub.engineFrame.contentDocument,b=d.querySelector('.btn-gacha[data-times="10"]');try{await a.commerce.handle(b,a.hub.engineFrame);return 'ok'}catch(e){return e.message}}""")
    ok('gacha save not verified → "未能确认 … 不要重复抽取", never "未扣系统点"',('未能确认' in r) and ('未扣系统点' not in r),r[:160])
    ok('the chat is frozen afterwards (no further ledger writes until reload)',js("()=>__zhutianApp.adapter.transactions.uncertain.has(__zhutianApp.adapter.currentIdentity())"))
    ok('no page errors',not errors,errors[:3])
    page.screenshot(path=str(out/'v111-audit-final.png'))
    browser.close()
(out/'results.json').write_text(json.dumps(results,ensure_ascii=False,indent=1),'utf8')
n=sum(r['pass'] for r in results);print(f'{n}/{len(results)} passed');sys.exit(0 if n==len(results) else 1)

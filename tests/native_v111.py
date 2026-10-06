"""1.1.1 browser regression: disposable SillyTavern + deterministic mock model only (NOT real-model / phone acceptance).
python tests/native_v111.py --isolated-test-only --base-url http://127.0.0.1:8019
Needs tests/qa/mock_model.py on :5001 (main chat replies for 【1.1.1污染】/【1.1.1缺块】).
"""
import argparse, json, sys, re, hashlib
from pathlib import Path
from playwright.sync_api import sync_playwright
sys.path.insert(0, str(Path(__file__).parent/'qa'))
import zt_common as Z
ap=argparse.ArgumentParser();ap.add_argument('--isolated-test-only',action='store_true',required=True);ap.add_argument('--base-url',default='http://127.0.0.1:8019');ap.add_argument('--output',default='/tmp/zt-v111-evidence');args=ap.parse_args()
Path('/var/tmp/qa').mkdir(parents=True,exist_ok=True);out=Path(args.output);out.mkdir(parents=True,exist_ok=True);Z.configure(args.base_url,'http://127.0.0.1:5001/v1',out)
results=[];calls={'product':0,'backfill':0};mode={'cut_first':True,'bad_after':None}
def ok(name,cond,detail=''):
    results.append({'name':name,'pass':bool(cond),'detail':str(detail)[:300]});print(('PASS ' if cond else 'FAIL ')+name+' '+str(detail)[:300],flush=True)
def js(s,arg=None):return page.evaluate(s,arg) if arg is not None else page.evaluate(s)
PANEL='系统点: 1250\n好感度: 30/100\n当前任务: 引气入体\n任务进度: 35\n功法修炼: 无\n系统播报: 补记测试'
def mock(route):
    body=route.request.post_data_json or {};msgs=body.get('messages',[]);sysmsg=next((m.get('content','') for m in msgs if m.get('role')=='system'),'');u=next((m.get('content','') for m in msgs if m.get('role')=='user'),'');finish='stop'
    if '商品内容生成器' in sysmsg:
        calls['product']+=1;calls['total']=calls.get('total',0)+1;n=calls['product'];uid=calls['total']
        slots=json.loads(re.search(r'槽位：(\[.*\])\n仅输出',u).group(1))
        rows=[dict(slot=s['id'],name=f'测试商品{uid}-{s["id"]}',effect=f'隔离模拟效果 {hashlib.sha256(f"{uid}-{s["id"]}".encode()).hexdigest()[:24]}，不代表真实模型质量',world=s['world'] or f'测试世界{s["theme"]}',theme='错题材',category='错分类',grade='凡品',origin='原创') for s in slots]
        text=json.dumps(rows,ensure_ascii=False)
        if mode['cut_first']: mode['cut_first']=False;text=text[:-60];finish='length'
        elif mode['bad_after'] is not None and n>mode['bad_after']: text='not valid json'
    elif '数据块记账员' in sysmsg:
        calls['backfill']+=1;calls['backfill_prompt']=u;text='<ZhuTianPanel>\n'+PANEL+'\n</ZhuTianPanel>'
    else: text='成功'
    route.fulfill(status=200,content_type='application/json',body=json.dumps({'choices':[{'finish_reason':finish,'message':{'role':'assistant','content':text}}]}))
EXT='/scripts/extensions/third-party/zhutianxitongchajianban/src/'
def z():return js('__zhutianApp.adapter.ledger()')
def save(body):return js('async()=>{await __zhutianApp.bridge.updateVariablesWith(v=>{'+body+';return v;},{type:"chat"});}')
def gacha(times,custom=False):
    return js("""async ([t,c])=>{const a=__zhutianApp,d=a.hub.engineFrame.contentDocument;let b;
      if(c){d.querySelector('#gacha-custom-n').value=String(t);b=d.querySelector('.btn-gacha[data-custom]');}else b=d.querySelector(`.btn-gacha[data-times="${t}"]`);
      const toasts=[];const T=a.hub.toast.bind(a.hub);a.hub.toast=(m,...r)=>{toasts.push(m);return T(m,...r)};
      try{await a.commerce.handle(b,a.hub.engineFrame);return {r:'ok',toasts}}catch(e){return {r:e.message,toasts}}finally{a.hub.toast=T}}""",[times,custom])
def send(text):
    n=js("SillyTavern.getContext().chat.length")
    page.locator('#send_textarea').fill(text);page.locator('#send_but').click()
    page.wait_for_function(f"SillyTavern.getContext().chat.length>={n+2}",timeout=60000)
    page.wait_for_function("getComputedStyle(document.querySelector('#mes_stop')).display==='none'",timeout=60000)
    page.wait_for_timeout(2500)
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,args=['--no-sandbox']);ctx=browser.new_context(viewport={'width':1280,'height':860});page=ctx.new_page();errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)));page.on('dialog',lambda d:d.accept());page.route('http://127.0.0.1:5001/v1/chat/completions',mock)
    Z.boot(page);Z.setup_chat(page);page.wait_for_timeout(2000)
    ok('main API connected to mock',Z.connect_main_api(page) not in (None,'no_connection'))
    js(f"async()=>{{const a=__zhutianApp;const api=await import('{EXT}api-center.js');await api.saveConfigs(a.bridge,'诸天记忆助手_v1',{{url:'http://127.0.0.1:5001/v1',key:'fixture-only-not-a-secret',model:'mock-zt'}});a.settings.set('floatLilith','off');}}")
    ok('panel guard running, MESSAGE_RECEIVED listener is first',js("()=>{const a=__zhutianApp,c=SillyTavern.getContext();const l=c.eventSource.events[c.eventTypes.MESSAGE_RECEIVED]||[];return !!a.panelGuard&&l.length>0&&String(l[0]).includes('received')}"))
    ok('数据块补记 route listed',js(f"async()=>(await import('{EXT}api-routes.js')).ROUTES.some(r=>r.id==='panel')"))

    # ---------- #7/#4/#3 real generation with a polluted, unclosed, lowercase block ----------
    send('继续修炼【1.1.1污染】')
    m=js("()=>{const m=SillyTavern.getContext().chat.at(-1);return {mes:m.mes,sw:m.swipes?.[m.swipe_id],bk:m.extra?.zhutianCovenantTerminal?.panelRepair,rs:m.extra?.reasoning||''}}")
    ok('polluted reply repaired in chat (closed, canonical, prose out, think → reasoning)',m['mes'].rstrip().endswith('</ZhuTianPanel>') and '<ZhuTianPanel>\n系统点: 1300' in m['mes'] and m['mes'].index('他推开了洞府石门')<m['mes'].index('<ZhuTianPanel>') and m['mes'].index('石门在身后')<m['mes'].index('<ZhuTianPanel>') and '<think>' not in m['mes'] and '先想一下' in m['rs'],m['mes'][-260:])
    ok('功法 wording normalized to 收录',('功法修炼: 收录:太虚剑意[仙品]' in m['mes']),m['mes'][-160:])
    ok('swipe text equals repaired text; raw backup kept',m['sw']==m['mes'] and m['bk'] and '<zhutianpanel>' in m['bk']['raw'])
    disk=js("async()=>{const c=SillyTavern.getContext();const r=await fetch('/api/chats/get',{method:'POST',headers:c.getRequestHeaders(),body:JSON.stringify({avatar_url:c.characters[c.characterId].avatar,file_name:c.characters[c.characterId].chat,ch_name:c.name2})});const a=await r.json();return a.at(-1).mes}")
    ok('repaired text saved to disk',disk==m['mes'])
    page.wait_for_timeout(2500)
    eng=js("()=>{const a=__zhutianApp;const lp=a.statusbar.latestPanel();return {id:lp?.id,len:a.adapter.context().chat.length,pts:a.adapter.ledger().系统点,lib:(a.adapter.ledger().功法库||[]).map(x=>x.名称)}}")
    ok('status bar binds the repaired floor; engine booked it',eng['id']==eng['len']-1 and eng['pts']==1300,eng)
    ok('收录 reached the 功法库',('太虚剑意' in eng['lib']),eng['lib'])
    floor=js("()=>{const el=document.querySelector('#chat .mes:last-child .mes_text');return el?el.innerText:''}")
    ok('story shown in the floor, data lines not',('他推开了洞府石门' in floor) and ('系统播报: 宿主今天很努力' not in floor),floor[:200])
    log=[l for l in Path('/var/tmp/qa/mock.jsonl').read_text('utf8').strip().split('\n') if '继续修炼【1.1.1污染】' in l]
    ok('format reminder injected into the main prompt',bool(log) and '【诸天数据块格式】' in log[-1],len(log))

    # ---------- 补记 ----------
    send('看看四周【1.1.1缺块】')
    page.wait_for_function("()=>SillyTavern.getContext().chat.at(-1).mes.includes('<ZhuTianPanel>')",timeout=30000);page.wait_for_timeout(2000)
    m=js("()=>{const m=SillyTavern.getContext().chat.at(-1);return {mes:m.mes,bf:m.extra?.zhutianCovenantTerminal?.panelBackfill}}")
    bp=calls.get('backfill_prompt','')
    log=[l for l in Path('/var/tmp/qa/mock.jsonl').read_text('utf8').strip().split('\n') if '看看四周【1.1.1缺块】' in l]
    ok('reminder after a repaired reply is the specific one',bool(log) and '上一轮' in log[-1],re.search(r'【诸天数据块格式】[^"]{0,160}',log[-1]).group(0) if log and '【诸天数据块格式】' in log[-1] else '')
    ok('missing block backfilled once from the worldbook template',calls['backfill']==1 and m['mes'].endswith(PANEL+'\n</ZhuTianPanel>') and m['bf'] and m['bf']['via']=='auto',calls)
    ok('backfill prompt: template with real values + story + user input',('系统点: 1300' in bp) and ('白衣剑客' in bp) and ('看看四周' in bp) and ('{{get_chat_variable' not in bp),bp[:200])
    page.wait_for_timeout(2500)
    ok('backfilled block booked by the engine',z()['系统点']==1250,z()['系统点'])

    # ---------- #1 / #6 盲盒 ----------
    js("__zhutianApp.openTerminal('shop')");page.wait_for_timeout(2500)
    save("v.诸天系统.系统点=5000000;v.诸天系统.商品历史=[];v.诸天系统.待处理物品=[];v.诸天系统.盲盒状态={累计抽数:300,保底计数:0,仙品次数:0,神品次数:0}")
    page.wait_for_timeout(1500)
    js("__zhutianApp.hub.scheduleEngineView(0)");page.wait_for_timeout(800)
    ok('距神品保底 shown on the gacha card',('距神品保底 700 抽' in js("__zhutianApp.hub.engineFrame.contentDocument.querySelector('.zt-shen-pity')?.textContent||''")),js("__zhutianApp.hub.engineFrame.contentDocument.querySelector('.zt-shen-pity')?.textContent||''"))
    js("__zhutianApp.settings.set('gachaMode','chunk')")  # 1.1.2: these checks are about 十抽一结算 (default is now 经典折叠)
    before=z();r=gacha(20,True);after=z()
    ok('20 draws: cut-off answer salvaged, two 10-draw settlements, exact fee',r['r']=='ok' and after['系统点']==before['系统点']-200000 and len(after['待处理物品'])==20 and sum(1 for x in after.get('操作日志',[]) if '盲盒 10 抽' in x['text'])==2,(r,after['系统点'],len(after['待处理物品'])))
    ok('神品保底计数 migrated from 累计抽数 and advanced',after['盲盒状态'].get('神品保底计数',-1)>=300 and after['盲盒状态']['累计抽数']==320,after['盲盒状态'])
    ok('slot decides grade/category/theme (model echoed wrong ones)',all(x['分类']!='错分类' for x in after['待处理物品']))
    calls['product']=0;mode['bad_after']=2;before=z();r=gacha(20,True);after=z();mode['bad_after']=None
    ok('failure mid-way: first 10 settled, rest not charged',r['r']=='ok' and after['系统点']==before['系统点']-100000 and len(after['待处理物品'])==len(before['待处理物品'])+10 and any('已完成 10/20 抽' in t for t in r['toasts']),(r,before['系统点']-after['系统点']))
    calls['product']=0;mode['bad_after']=0;before=z();r=gacha(10);after=z();mode['bad_after']=None
    ok('failure before any settlement: nothing charged',r['r']!='ok' and '未扣系统点' in r['r'] and after['系统点']==before['系统点'] and after['盲盒状态']==before['盲盒状态'],r['r'][:120])

    js("__zhutianApp.settings.set('gachaMode',undefined)")  # leave the shared test install on the default
    # ---------- #5 page shift ----------
    js("()=>{const d=document.createElement('div');d.id='zt-qa-tall';d.style.cssText='height:3000px;width:1px';document.body.append(d);}")
    can=js("()=>{document.documentElement.scrollTop=300;document.body.scrollTop=300;const v=document.scrollingElement.scrollTop;document.documentElement.scrollTop=0;document.body.scrollTop=0;return v}")
    ok('fixture: the page CAN be scrolled programmatically (otherwise the checks below prove nothing)',can>0,can)
    js("__zhutianApp.openTerminal('plugmgr')");page.wait_for_timeout(1500)
    js("()=>{const el=__zhutianApp.hub.pages.get('plugmgr').el;el.querySelector('[data-plug-new]')?.click();}");page.wait_for_timeout(800)
    ok('外挂工坊「新建」does not move the page',js("document.scrollingElement.scrollTop+window.scrollY")==0,js("document.scrollingElement.scrollTop"))
    js("__zhutianApp.openTerminal('shop')");page.wait_for_timeout(2000)
    r=js("()=>{const w=__zhutianApp.hub.engineFrame.contentWindow;const ta=document.querySelector('#send_textarea');ta.value='';const res=w.insertIntoChatInput('（1.1.1 测试：闭关）');return {res,val:ta.value,active:document.activeElement===ta,top:document.scrollingElement.scrollTop+window.scrollY}}")
    ok('engine writes the input without focusing / scrolling while the terminal is open',r['res'] and '闭关' in r['val'] and not r['active'] and r['top']==0,r)
    js("()=>{document.documentElement.scrollTop=250;}");page.wait_for_timeout(300)
    ok('guard undoes a page scroll while the terminal is open',js("document.scrollingElement.scrollTop")==0,js("document.scrollingElement.scrollTop"))
    js("__zhutianApp.hub.close()");page.wait_for_timeout(800)
    js("()=>{document.documentElement.scrollTop=250;}");page.wait_for_timeout(300)
    ok('guard is off when the terminal is closed',js("document.scrollingElement.scrollTop")>0)
    js("()=>{document.documentElement.scrollTop=0;document.getElementById('zt-qa-tall')?.remove();document.querySelector('#send_textarea').value='';}")

    # ---------- #2 红包 补登 ----------
    save("v.诸天系统.聊天群={群名:'测试群',成员:[{id:'m1',名称:'鹧鸪哨',世界:'鬼吹灯',档:3,好感:0}],消息:[{id:'old1',t:1,from:'m1',text:'[红包] 浸血古铜钱/凡品/辟邪法器/镇水鬼 3枚 | 愿群主平安'}],红包:{}}")
    js("__zhutianApp.openTerminal('group')");page.wait_for_timeout(1500)
    has=js("!!__zhutianApp.group.el?.querySelector('[data-rebook=\"old1\"]')")
    ok('old plain-text packet shows 补登',has)
    js("__zhutianApp.group.el.querySelector('[data-rebook=\"old1\"]').click()");page.wait_for_timeout(1500)
    g=z()['聊天群'];msg=next(x for x in g['消息'] if x['id']=='old1')
    ok('补登 turns it into a grab-able packet (once)',msg.get('kind')=='packet' and msg.get('rebooked') and g['红包'][msg['ref']]['item']['名称']=='浸血古铜钱' and g['红包'][msg['ref']]['total']==3 and not js("!!__zhutianApp.group.el.querySelector('[data-rebook]')"),msg)

    # ---------- settings / diagnostics ----------
    ok('settings section with backfill select + restore action',js("()=>{const s=__zhutianApp.hubSettings.sections().find(x=>x.title==='数据块格式守卫');return !!s&&s.items.some(i=>i.k==='panelGuard.backfill')&&s.items.some(i=>i.id==='pg-restore')&&typeof s.actions['pg-restore']==='function'}"))
    rep=js(f"async()=>(await import('{EXT}diag-report.js')).buildReport(__zhutianApp)")
    ok('diagnostics line, no story text or key',('数据块格式守卫' in rep) and ('他推开了洞府石门' not in rep) and ('fixture-only-not-a-secret' not in rep),re.search(r'数据块格式守卫.*',rep).group(0) if '数据块格式守卫' in rep else '')
    js("()=>__zhutianApp.panelGuard.restore()");page.wait_for_timeout(1200)
    ok('还原 restores the newest repaired floor to the raw AI text',js("()=>SillyTavern.getContext().chat.some(m=>typeof m.mes==='string'&&m.mes.includes('<zhutianpanel>'))"))
    ok('no page errors',not errors,errors[:3])
    page.screenshot(path=str(out/'v111-final.png'))
    browser.close()
(out/'results.json').write_text(json.dumps(results,ensure_ascii=False,indent=1),'utf8')
n=sum(r['pass'] for r in results);print(f'{n}/{len(results)} passed');sys.exit(0 if n==len(results) else 1)

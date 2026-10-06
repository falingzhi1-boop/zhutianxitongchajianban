"""1.1.2 browser regression: disposable SillyTavern + deterministic mock model only (NOT real-model / phone acceptance).
python tests/native_v112.py --isolated-test-only --base-url http://127.0.0.1:8019
Covers: 抽卡模式（经典折叠默认 / 十抽一结算切换）· 羁绊页（群员默认不进、本世界优先、拉入 / 移出）· 管理员控制台新页面.
"""
import argparse, json, sys, re, hashlib
from pathlib import Path
from playwright.sync_api import sync_playwright
sys.path.insert(0, str(Path(__file__).parent/'qa'))
import zt_common as Z
ap=argparse.ArgumentParser();ap.add_argument('--isolated-test-only',action='store_true',required=True);ap.add_argument('--base-url',default='http://127.0.0.1:8019');ap.add_argument('--output',default='/tmp/zt-v112-evidence');args=ap.parse_args()
Path('/var/tmp/qa').mkdir(parents=True,exist_ok=True);out=Path(args.output);out.mkdir(parents=True,exist_ok=True);Z.configure(args.base_url,'http://127.0.0.1:5001/v1',out)
results=[];calls={'product':0,'uid':0,'items':[]}
def ok(name,cond,detail=''):
    results.append({'name':name,'pass':bool(cond),'detail':str(detail)[:300]});print(('PASS ' if cond else 'FAIL ')+name+' '+str(detail)[:300],flush=True)
def js(s,arg=None):return page.evaluate(s,arg) if arg is not None else page.evaluate(s)
def mock(route):
    body=route.request.post_data_json or {};msgs=body.get('messages',[]);sysmsg=next((m.get('content','') for m in msgs if m.get('role')=='system'),'');u=next((m.get('content','') for m in msgs if m.get('role')=='user'),'')
    if '商品内容生成器' in sysmsg:
        calls['product']+=1;calls['uid']+=1;uid=calls['uid']  # never reset: names stay unique across draws
        slots=json.loads(re.search(r'槽位：(\[.*\])\n仅输出',u).group(1));calls['items'].append([s['grade'] for s in slots])
        if '上轮问题' in u: calls.setdefault('retry',[]).append(u[u.index('上轮问题'):][:200])
        rows=[dict(slot=s['id'],name='测试'+''.join(chr(0x4e00+b*80+i) for i,b in enumerate(hashlib.sha256(f'{uid}-{s["id"]}'.encode()).digest()[:6])),effect=f'隔离模拟效果 {hashlib.sha256(f"{uid}-{s["id"]}".encode()).hexdigest()[:24]}，不代表真实模型质量',world=s['world'] or f'测试世界{s["theme"]}',theme=s['theme'],origin='原创') for s in slots]
        text=json.dumps(rows,ensure_ascii=False)
    else: text='成功'
    route.fulfill(status=200,content_type='application/json',body=json.dumps({'choices':[{'finish_reason':'stop','message':{'role':'assistant','content':text}}]}))
EXT='/scripts/extensions/third-party/zhutianxitongchajianban/src/'
def z():return js('__zhutianApp.adapter.ledger()')
def save(body):return js('async()=>{await __zhutianApp.bridge.updateVariablesWith(v=>{'+body+';return v;},{type:"chat"});}')
def sr(body):return js('async()=>{const a=__zhutianApp,h=a.hub,sr=h.shadow;'+body+'}')
def gacha(times):
    return js("""async (t)=>{const a=__zhutianApp,d=a.hub.engineFrame.contentDocument;d.querySelector('#gacha-custom-n').value=String(t);const b=d.querySelector('.btn-gacha[data-custom]');
      const toasts=[];const T=a.hub.toast.bind(a.hub);a.hub.toast=(m,...r)=>{toasts.push(m);return T(m,...r)};
      try{await a.commerce.handle(b,a.hub.engineFrame);return {r:'ok',toasts}}catch(e){return {r:e.message,toasts}}finally{a.hub.toast=T}}""",times)
def gacha_logs(zz,tag):return [x['text'] for x in zz.get('操作日志',[]) if tag in x['text']]
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,args=['--no-sandbox']);ctx=browser.new_context(viewport={'width':1280,'height':860});page=ctx.new_page();errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)));page.on('dialog',lambda d:d.accept());page.route('http://127.0.0.1:5001/v1/chat/completions',mock)
    Z.boot(page);Z.setup_chat(page);page.wait_for_timeout(2000)
    ok('main API connected to mock',Z.connect_main_api(page) not in (None,'no_connection'))
    js(f"async()=>{{const a=__zhutianApp;const api=await import('{EXT}api-center.js');await api.saveConfigs(a.bridge,'诸天记忆助手_v1',{{url:'http://127.0.0.1:5001/v1',key:'fixture-only-not-a-secret',model:'mock-zt'}});a.settings.set('floatLilith','off');a.settings.set('gachaMode',undefined);}}")  # back to the default (other suites may have chosen 十抽一结算)

    # ---------- A. 抽卡模式 ----------
    js("__zhutianApp.openTerminal('shop')");page.wait_for_timeout(2500)
    save("v.诸天系统.系统点=50000000;v.诸天系统.商品历史=[];v.诸天系统.待处理物品=[];v.诸天系统.背包=[];v.诸天系统.盲盒状态={累计抽数:0,保底计数:0,仙品次数:0,神品次数:0}")
    page.wait_for_timeout(1200);js("__zhutianApp.hub.scheduleEngineView(0)");page.wait_for_timeout(900)
    ok('default gacha mode is 经典折叠 (setting unset)',js("__zhutianApp.settings.get('gachaMode')")in(None,'classic') and js("(async()=>(await import('"+EXT+"commerce.js')).gachaMode(__zhutianApp.settings))()")=='classic')
    box=js("(()=>{const b=__zhutianApp.hub.engineFrame.contentDocument.querySelector('.zt-gacha-mode');return b?{t:b.textContent,on:b.querySelector('[aria-pressed=true]')?.dataset.ztGachaMode}:null})()")
    ok('mode switch painted next to the gacha buttons, 经典折叠 pressed',box and box['on']=='classic' and '十抽一结算' in box['t'],box)
    page.screenshot(path=str(out/'v112-gacha-mode.png'))
    before=z();r=gacha(30);after=z()
    ok('30 pulls (classic): one settlement, exact fee, nothing folded (<50)',r['r']=='ok' and after['系统点']==before['系统点']-300000 and len(after['待处理物品'])==30 and len(gacha_logs(after,'经典折叠'))==1 and calls['product']<=2,(r['r'],calls['product'],len(after['待处理物品'])))
    calls['product']=0;calls['items']=[];before=z();r=gacha(60);after=z();new=after['待处理物品'][len(before['待处理物品']):]
    fan=[x for x in new if x['品级']=='凡品']
    ok('60 pulls: every 凡品 in ONE row「凡品杂物 ×N」, Σ数量 = 60, one charge',r['r']=='ok' and len(fan)==1 and fan[0]['名称']=='凡品杂物' and sum(x['数量'] for x in new)==60 and after['系统点']==before['系统点']-600000,(r['r'],[(x['名称'],x['数量']) for x in new if x['数量']>1]))
    ok('60 pulls: no 凡品 sent to the model; 1.1.3: one request',all('凡品' not in g for g in calls['items']) and len(calls['items'])==1 and sum(len(g) for g in calls['items'])==len(new)-1,calls['items'])
    calls['product']=0;calls['items']=[];before=z();r=gacha(120);after=z();new=after['待处理物品'][len(before['待处理物品']):]
    folded={x['品级']:x['数量'] for x in new if x['名称'].endswith('杂物')}
    ok('120 pulls: 凡品 and 灵品 folded, 仙品 generated one by one',r['r']=='ok' and set(folded)<={'凡品','灵品'} and '凡品' in folded and all(x['数量']==1 for x in new if not x['名称'].endswith('杂物')) and all(set(g)<={'仙品','神品'} for g in calls['items']) and sum(x['数量'] for x in new)==120,(folded,calls['items']))
    ok('pity counted for folded pulls',after['盲盒状态']['累计抽数']==210 and after['盲盒状态'].get('神品保底计数',0)>=200 - 1000*after['盲盒状态'].get('神品次数',0),after['盲盒状态'])
    toast=' '.join(r['toasts'])
    ok('toast says what was folded',('凡品' in toast and '合为一行' in toast),toast[:120])
    # keep the folded row → bag ×N (the vendor list + the 1.1.1 takeover)
    js("__zhutianApp.hub.scheduleEngineView(0)");page.wait_for_timeout(900)
    idx=next(i for i,x in enumerate(z()['待处理物品']) if x['名称']=='凡品杂物' and x['数量']==folded['凡品'])
    # the vendor list only renders on its own tab; the takeover reads class + data-idx exactly like the real 保留 button
    res=js("async(i)=>{const a=__zhutianApp,d=a.hub.engineFrame.contentDocument;const b=d.createElement('button');b.className='api-btn btn-keep-item';b.dataset.idx=String(i);d.body.append(b);try{await a.commerce.item(b,a.hub.engineFrame);return 'ok'}catch(e){return e.message}finally{b.remove()}}",idx)
    bag=[x for x in z()['背包'] if x['名称']=='凡品杂物']
    ok('保留 the folded row → bag gets 凡品杂物 ×N',res=='ok' and bag and bag[0].get('数量')==folded['凡品'],(res,bag))
    # switch to 十抽一结算 from the engine frame
    js("(()=>{const d=__zhutianApp.hub.engineFrame.contentDocument;d.querySelector('.zt-gacha-mode [data-zt-gacha-mode=chunk]').click()})()");page.wait_for_timeout(300)
    ok('clicking 十抽一结算 saves the setting',js("__zhutianApp.settings.get('gachaMode')")=='chunk')
    calls['product']=0;calls['items']=[];before=z();r=gacha(60);after=z();new=after['待处理物品'][len(before['待处理物品']):]
    ok('十抽一结算: 60 pulls = 6 settlements, every item generated (no fold)',r['r']=='ok' and len(new)==60 and all(x['数量']==1 for x in new) and len(gacha_logs(after,'盲盒 10 抽'))-len(gacha_logs(before,'盲盒 10 抽'))==6 and sum(len(g) for g in calls['items'])==60,(r['r'],len(new),len(gacha_logs(after,'盲盒 10 抽')),len(gacha_logs(before,'盲盒 10 抽')),len(after.get('操作日志',[])),[len(g) for g in calls['items']]))
    js("__zhutianApp.openTerminal('commerce')");page.wait_for_timeout(900)
    card=sr("const c=sr.querySelector('#page-commerce [data-gacha-mode]');return c?{t:c.textContent,on:c.querySelector('[aria-pressed=true]')?.textContent}:null")
    ok('商品定制 page shows the same switch (十抽一结算 pressed)',card and '十抽一结算' in (card['on'] or ''),card)
    sr("sr.querySelector('#page-commerce [data-gacha-mode] [aria-pressed=false]')?.click();return 1");page.wait_for_timeout(400)
    ok('switching back on the 商品定制 page',js("__zhutianApp.settings.get('gachaMode')")=='classic')

    # ---------- B. 羁绊 ----------
    save("""const z=v.诸天系统;z.当前世界='斗罗大陆';z.羁绊库=[{id:'p-xw',姓名:'小舞',世界:'斗罗大陆',关系:'恋人',好感度:66,黑化值:5,悔意值:0,性格:'活泼',身份:'柔骨兔'},{id:'p-xn',姓名:'雪女',世界:'秦时明月',关系:'朋友',好感度:28,身份:'舞姬'},{id:'p-zy',姓名:'朱竹清',世界:'斗罗大陆',关系:'同伴',好感度:40}];
      z.当前羁绊ID='p-xw';z.恋爱目标={姓名:'小舞',好感度:66,黑化值:5,悔意值:0};z.打手=[{名称:'铁甲卫',忠诚:70}];
      z.聊天群={群名:'诸天群',成员:[{id:'g1',名称:'鸣人',世界:'火影',档:4,好感:45,身份:'管理员',性格:'热血',特产:'拉面'},{id:'g2',名称:'路飞',世界:'海贼',档:5,好感:30},{id:'g3',名称:'小舞',世界:'斗罗大陆',档:3,好感:12}],消息:[],红包:{}}""")
    page.wait_for_timeout(800);js("__zhutianApp.openTerminal('bond')");page.wait_for_timeout(1200)
    names=sr("return [...sr.querySelectorAll('#page-bond .zt-bd-person')].map(e=>e.querySelector('b,strong,.zt-bd-name')?.textContent||e.textContent)")
    ok('bond page opens on 本世界, current world only, group members hidden',sr("return sr.querySelector('#page-bond .zt-bd-filter.on')?.dataset.filter")=='here' and len(names)==3 and not any('鸣人' in n or '路飞' in n for n in names),names)
    sr("sr.querySelector('#page-bond [data-filter=all]').click();return 1");page.wait_for_timeout(300)
    names=sr("return [...sr.querySelectorAll('#page-bond .zt-bd-person')].map(e=>e.textContent)")
    ok('全部: 本世界 first, still no group members',len(names)==4 and '雪女' in names[-1] and not any('鸣人' in n for n in names),[n[:8] for n in names])
    page.screenshot(path=str(out/'v112-bonds-desktop.png'))
    # pull from the group member list
    js("__zhutianApp.openTerminal('group')");page.wait_for_timeout(800)
    js("(()=>{const g=__zhutianApp.group;g.view='members';g.paint(true)})()");page.wait_for_timeout(600)
    btns=js("[...__zhutianApp.group.el.querySelectorAll('[data-bond-pull],[data-bond-open]')].map(b=>[b.dataset.bondPull||b.dataset.bondOpen,b.textContent])")
    ok('group members: 拉入羁绊 per member',len(btns)==3 and all('拉入羁绊' in b[1] for b in btns),btns)
    js("__zhutianApp.group.el.querySelector('[data-bond-pull=g1]').click()");page.wait_for_timeout(2000)
    zz=z();p1=next((x for x in zz['羁绊库'] if x['姓名']=='鸣人'),None)
    ok('拉入羁绊 from the group: 群友 entry with group 好感, page jumps to it',p1 and p1['关系']=='群友' and p1['好感度']==45 and p1.get('群员ID')=='g1' and js("__zhutianApp.hub.page")=='bond' and '鸣人' in (sr("return sr.querySelector('#page-bond .zt-bd-detail h3')?.textContent") or ''),(p1,js("__zhutianApp.hub.page")))
    det=sr("return sr.querySelector('#page-bond .zt-bd-detail')?.textContent||''")
    ok('detail shows live group info',('聊天群' in det and '管理员' in det and '群内好感 45' in det),det[:160])
    page.screenshot(path=str(out/'v112-bonds-pulled.png'))
    # same name + world already a bond → linked, not duplicated
    js("__zhutianApp.openTerminal('group')");page.wait_for_timeout(600);js("(()=>{const g=__zhutianApp.group;g.view='members';g.paint(true)})()");page.wait_for_timeout(500)
    ok('already pulled member shows 已在羁绊',js("!!__zhutianApp.group.el.querySelector('[data-bond-open=g1]')"))
    js("__zhutianApp.group.el.querySelector('[data-bond-pull=g3]').click()");page.wait_for_timeout(1800)
    zz=z();ok('member 小舞 (斗罗大陆) links to the existing 小舞, no duplicate',sum(1 for x in zz['羁绊库'] if x['姓名']=='小舞')==1 and next(x for x in zz['羁绊库'] if x['id']=='p-xw').get('群员ID')=='g3',[x['姓名'] for x in zz['羁绊库']])
    # atlas
    js("__zhutianApp.openTerminal('bonds')");page.wait_for_timeout(1200)
    nodes=sr("return [...sr.querySelectorAll('#page-bonds .zt-node')].map(n=>n.dataset.node)")
    ok('关系图: pulled members drawn once, others on the member ring',('bond:m:g2' in nodes) and ('bond:m:g1' not in nodes) and ('bond:m:g3' not in nodes),nodes)
    js("__zhutianApp.atlas.select('bonds','bond:m:g2',{speak:false})");page.wait_for_timeout(500)
    sr("sr.querySelector('#page-bonds [data-pull-bond=g2]').click();return 1");page.wait_for_timeout(2000)
    ok('关系图「拉入羁绊」works',any(x['姓名']=='路飞' and x.get('群员拉入') for x in z()['羁绊库']) and js("__zhutianApp.hub.page")=='bond')
    # drop
    luffy=next(x for x in z()['羁绊库'] if x['姓名']=='路飞')['id']
    js("(id)=>__zhutianApp.bonds.open(id)",luffy);page.wait_for_timeout(600)
    sr("sr.querySelector('#page-bond [data-drop]').click();return 1");page.wait_for_timeout(1800)
    zz=z();ok('移出羁绊 removes the pulled 群友, the group keeps him',not any(x['姓名']=='路飞' for x in zz['羁绊库']) and any(m['id']=='g2' for m in zz['聊天群']['成员']))
    js("__zhutianApp.bonds.open('p-xw')");page.wait_for_timeout(500)
    ok('the active target (linked) has no 移出 button',not sr("return !!sr.querySelector('#page-bond [data-drop]')"))
    # narrow layout
    page.set_viewport_size({'width':420,'height':860});page.wait_for_timeout(800)
    page.screenshot(path=str(out/'v112-bonds-narrow.png'))
    ov=sr("const p=sr.querySelector('#page-bond');return p?p.scrollWidth-p.clientWidth:-1")
    ok('narrow window: bond page has no horizontal overflow',ov is not None and 0<=ov<=2,ov)
    page.set_viewport_size({'width':1280,'height':860});page.wait_for_timeout(600)

    # ---------- C. 管理员控制台 ----------
    save("const z=v.诸天系统;z.系统点=1000;z.专属资源={天命印记:1,血脉结晶:0,因果筹码:0,名望:100,岁月沉淀:0};z.盲盒状态={累计抽数:210,保底计数:10,仙品次数:1,神品次数:0,神品保底计数:210};const k=Object.keys(z.面板账本||{});z.面板账本={...(z.面板账本||{}),9001:{h:'qa',snap:{专属资源:{名望:80}}}}")
    page.wait_for_timeout(800)
    js("__zhutianApp.openTerminal('set')");page.wait_for_timeout(600)
    sr("const d=sr.querySelector('#page-set details[data-tier=adv]');if(d)d.open=true;return 1");page.wait_for_timeout(200)
    page.locator('#page-set [data-act="admin"]').click();page.wait_for_timeout(1000)
    ok('设置 → 管理员控制台 opens the terminal page',js("__zhutianApp.hub.page")=='admin' and sr("return sr.querySelectorAll('#page-admin .zt-adm-sec').length")==7)
    txt=sr("return sr.querySelector('#page-admin').textContent")
    ok('admin page shows pity progress and every new section',('距仙品保底 90 抽' in txt) and ('距神品保底 790 抽' in txt) and ('羁绊' in txt) and ('聊天群' in txt),re.findall(r'距.{0,12}抽',txt))
    page.screenshot(path=str(out/'v112-admin.png'),full_page=False)
    def setv(key,val):sr(f"const i=sr.querySelector('#page-admin input[data-key=\"{key}\"]');i.value={json.dumps(val)};i.dispatchEvent(new Event('input',{{bubbles:true}}));return 1")
    setv('f:系统点','5000');setv('f:专属资源.名望','1100');setv('f:盲盒状态.神品保底计数','998');setv('p:p-xw:好感度','90');setv('m:g1','88')
    ok('changed inputs highlighted, counter shows 5',sr("return sr.querySelectorAll('#page-admin input.changed').length")==5 and '5 项' in sr("return sr.querySelector('#page-admin [data-count]').textContent"))
    sr("sr.querySelector('#page-admin [data-save]').click();return 1");page.wait_for_timeout(2500)
    zz=z()
    ok('写入账本: every change saved in one go',zz['系统点']==5000 and zz['专属资源']['名望']==1100 and zz['盲盒状态']['神品保底计数']==998 and next(x for x in zz['羁绊库'] if x['id']=='p-xw')['好感度']==90 and zz['恋爱目标']['好感度']==90 and next(m for m in zz['聊天群']['成员'] if m['id']=='g1')['好感']==88,(zz['系统点'],zz['专属资源'],zz['盲盒状态']))
    ok('专属资源 delta also applied to floor snapshots',zz['面板账本']['9001']['snap']['专属资源']['名望']==1080,zz['面板账本']['9001'])
    ok('audit record 管理员修改',any('管理员修改' in x['text'] and '系统点' in x['text'] for x in zz.get('操作日志',[])))
    ok('page re-read after save (no pending changes)',sr("return sr.querySelectorAll('#page-admin input.changed').length")==0 and sr("return sr.querySelector('#page-admin input[data-key=\"f:系统点\"]').value")=='5000')
    shown=js("__zhutianApp.hub.engineFrame?.contentDocument?.querySelector('#sb-pts')?.textContent||''")
    # conflict
    setv('f:系统点','6000');save("v.诸天系统.系统点=4321")
    sr("sr.querySelector('#page-admin [data-save]').click();return 1");page.wait_for_timeout(1500)
    msg=sr("return sr.querySelector('#page-admin [role=status]').textContent")
    ok('ledger changed meanwhile → refused, nothing written',z()['系统点']==4321 and '账本已变化' in msg,msg[:100])
    sr("sr.querySelector('#page-admin [data-reload]').click();return 1");page.wait_for_timeout(600)
    setv('f:宿主实力档','9');sr("sr.querySelector('#page-admin [data-save]').click();return 1");page.wait_for_timeout(600)
    msg=sr("return sr.querySelector('#page-admin [role=status]').textContent")
    ok('out-of-range value is refused with the field name',('宿主实力档 须在 1–8' in msg) and z().get('宿主实力档')!=9,msg)
    sr("sr.querySelector('#page-admin [data-reset]').click();return 1")
    # skill (needs engine frame)
    setv('f:功法.熟练度','7');sr("sr.querySelector('#page-admin [data-save]').click();return 1");page.wait_for_timeout(2500)
    zz=z();ok('功法 熟练度 saved through the original sync',(zz.get('功法') or {}).get('熟练度')==7 and zz['面板账本']['9001']['snap']['专属资源']['名望']==1080,(zz.get('功法'),zz['面板账本']['9001']['snap'].get('专属资源')))
    # chat switched between reading and saving → nothing written
    setv('f:系统点','7777')
    sw=sr("const ad=a.adapter,o=ad.currentIdentity;ad.currentIdentity=()=>'qa-other-chat';try{sr.querySelector('#page-admin [data-save]').click();}finally{setTimeout(()=>{ad.currentIdentity=o},400)}return 1");page.wait_for_timeout(1200)
    msg=sr("return sr.querySelector('#page-admin [role=status]').textContent")
    ok('chat switched before saving → re-read, nothing written',z()['系统点']!=7777 and '聊天已切换' in msg,msg)
    sr("sr.querySelector('#page-admin [data-reload]').click();return 1");page.wait_for_timeout(500)
    # original overlay still reachable
    sr("sr.querySelector('#page-admin [data-original]').click();return 1")
    try:
        page.wait_for_function("(()=>{const d=__zhutianApp.hub.engineFrame?.contentDocument;const o=d?.querySelector('#admin-overlay');return o&&!o.hidden})()",timeout=15000);orig=True
    except Exception: orig=False
    ok('「打开原版面板」opens the original overlay',orig)
    ok('no 换皮 retries with collision-free mock items',not calls.get('retry'),calls.get('retry'));js("__zhutianApp.settings.set('gachaMode',undefined)");ok('no page errors',not errors,errors[:3])
    page.screenshot(path=str(out/'v112-final.png'))
    browser.close()
(out/'results.json').write_text(json.dumps(results,ensure_ascii=False,indent=1),'utf8')
n=sum(r['pass'] for r in results);print(f'{n}/{len(results)} passed');sys.exit(0 if n==len(results) else 1)

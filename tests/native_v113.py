"""1.1.3 browser regression: disposable SillyTavern + deterministic mock model only (emulated Pixel 7, NOT a physical phone).
python tests/native_v113.py --isolated-test-only --base-url http://127.0.0.1:8019
Covers: 悬浮窗「切换」(莉莉丝 ⇄ 头像) 与「关闭」分开 · 头像悬浮窗也能关闭 · 大小最低 20% · 终端 × 真的关闭、浮窗/全屏按钮常在 ·
经典折叠抽卡一次 API 调用（折叠的凡品 / 灵品只计数）.
"""
import argparse, json, sys, re, hashlib
from pathlib import Path
from playwright.sync_api import sync_playwright
sys.path.insert(0, str(Path(__file__).parent/'qa'))
import zt_common as Z
ap=argparse.ArgumentParser();ap.add_argument('--isolated-test-only',action='store_true',required=True);ap.add_argument('--base-url',default='http://127.0.0.1:8019');ap.add_argument('--output',default='/tmp/zt-v113-evidence');args=ap.parse_args()
Path('/var/tmp/qa').mkdir(parents=True,exist_ok=True);out=Path(args.output);out.mkdir(parents=True,exist_ok=True);Z.configure(args.base_url,'http://127.0.0.1:5001/v1',out)
results=[];calls={'product':0,'uid':0,'items':[],'max':[]}
def ok(name,cond,detail=''):
    results.append({'name':name,'pass':bool(cond),'detail':str(detail)[:300]});print(('PASS ' if cond else 'FAIL ')+name+' '+str(detail)[:300],flush=True)
def mock(route):
    body=route.request.post_data_json or {};msgs=body.get('messages',[]);sysmsg=next((m.get('content','') for m in msgs if m.get('role')=='system'),'');u=next((m.get('content','') for m in msgs if m.get('role')=='user'),'')
    if '商品内容生成器' in sysmsg:
        calls['product']+=1;calls['uid']+=1;uid=calls['uid'];calls['max'].append(body.get('max_tokens'))
        slots=json.loads(re.search(r'槽位：(\[.*\])\n仅输出',u).group(1));calls['items'].append([s['grade'] for s in slots])
        rows=[dict(slot=s['id'],name='测试'+''.join(chr(0x4e00+b*80+i) for i,b in enumerate(hashlib.sha256(f'{uid}-{s["id"]}'.encode()).digest()[:6])),effect=f'隔离模拟效果 {hashlib.sha256(f"{uid}-{s["id"]}".encode()).hexdigest()[:24]}，不代表真实模型质量',world=s['world'] or f'测试世界{s["theme"]}',theme=s['theme'],origin='原创') for s in slots]
        text=json.dumps(rows,ensure_ascii=False)
    else: text='成功'
    route.fulfill(status=200,content_type='application/json',body=json.dumps({'choices':[{'finish_reason':'stop','message':{'role':'assistant','content':text}}]}))
EXT='/scripts/extensions/third-party/zhutianxitongchajianban/src/'
STATE="""(()=>{const a=__zhutianApp,sr=a.hub.shadow,e=sr.getElementById('entry'),f=document.getElementById('zhutian-lilith-float')?.shadowRoot?.querySelector('.fl');
  const er=e?.getBoundingClientRect(),fr=f?.getBoundingClientRect(),t=sr.getElementById('zt-layout-toggle'),tr=t?.getBoundingClientRect();
  return {mode:a.settings.get('floatLilith'),lilith:!!f&&!f.hidden&&fr.width>0,lw:fr?Math.round(fr.width):0,lx:fr?Math.round(fr.x):0,ly:fr?Math.round(fr.y):0,
    avatar:!!e&&getComputedStyle(e).display!=='none'&&e.dataset.docked!=='true'&&er.width>0,docked:e?.dataset.docked==='true',ax:Math.round(er?.x||0),ay:Math.round(er?.y||0),aw:Math.round(er?.width||0),ah:Math.round(er?.height||0),
    open:a.hub.shell.dialog.open,full:!!a.mobile?.full,toggle:t&&t.isConnected&&tr.width>0?t.textContent:'',vw:innerWidth,vh:innerHeight}})()"""
def run(ctx_opts,tag):
    global page
    ctx=browser.new_context(**ctx_opts);page=ctx.new_page();errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)));page.on('dialog',lambda d:d.accept());page.route('http://127.0.0.1:5001/v1/chat/completions',mock)
    Z.boot(page);Z.setup_chat(page);page.wait_for_timeout(1500)
    global saved
    saved=js("(()=>{const s=__zhutianApp.settings;return JSON.parse(JSON.stringify({fx:s.get('fx'),floatLilith:s.get('floatLilith'),floatSize:s.get('floatSize'),avatarSize:s.get('avatarSize'),floatPos:s.get('floatPos'),circlePosition:s.get('circlePosition'),mobileLayout:s.get('mobileLayout'),gachaMode:s.get('gachaMode')}))})()")
    js("(()=>{const s=__zhutianApp.settings;s.patch('fx',{mode:'off',outside:false});s.set('floatLilith','auto');s.set('floatSize','m');s.set('avatarSize','xl');s.set('floatPos',null);s.set('circlePosition',null);s.set('mobileLayout','auto')})()");page.wait_for_timeout(700)
    return ctx,errors
def restore():   # suites share one SillyTavern: put back every setting this suite touched
    js("async(v)=>{const s=__zhutianApp.settings;for(const [k,x] of Object.entries(v))s.set(k,x??null);try{const m=await import('/script.js');await m.saveSettings();}catch{}}",saved);page.wait_for_timeout(800)
def js(s,arg=None):return page.evaluate(s,arg) if arg is not None else page.evaluate(s)
def st():return js(STATE)
def sr(body):return js('async()=>{const a=__zhutianApp,h=a.hub,sr=h.shadow;'+body+'}')
def bins(host):  # host: 'float' | 'entry'
    q="document.getElementById('zhutian-lilith-float').shadowRoot.querySelector('.bin')" if host=='float' else "__zhutianApp.hub.shadow.getElementById('zt-entry-bin')"
    return js("(()=>{const b="+q+";if(!b)return null;return {show:b.classList.contains('show'),t:[...b.querySelectorAll('.tgt')].map(x=>{const r=x.getBoundingClientRect();return {t:x.dataset.t,label:x.textContent,hot:x.classList.contains('hot'),cx:r.x+r.width/2,cy:r.y+r.height/2,top:r.y,bottom:r.bottom}})}})()")
def drag_to(sx,sy,host,target,drop=True,shot=None):
    page.mouse.move(sx,sy);page.mouse.down();page.mouse.move(sx+12,sy+12,steps=3);page.mouse.move(sx+30,sy-40,steps=4);page.wait_for_timeout(250)
    b=bins(host);tg=next((x for x in (b or {}).get('t',[]) if x['t']==target),None)
    if tg: page.mouse.move(tg['cx'],tg['cy'],steps=8);page.wait_for_timeout(200)
    b2=bins(host)
    if shot: page.screenshot(path=str(out/shot))
    if drop: page.mouse.up();page.wait_for_timeout(700)
    return b,b2
def confirm(yes=True):
    loc=page.locator('.popup-button-ok' if yes else '.popup-button-cancel').filter(has_text='关闭悬浮窗' if yes else '先不关')
    try: loc.first.wait_for(state='visible',timeout=4000);loc.first.click();page.wait_for_timeout(700);return True
    except Exception as e: return False
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,args=['--no-sandbox'])
    # ================= phone (emulated Pixel 7) =================
    ctx,errors=run(dict(**p.devices['Pixel 7']),'phone')
    s0=st();ok('phone default (auto): floating Lilith shown, avatar hidden',s0['lilith'] and not s0['avatar'],s0)
    fx,fy=s0['lx']+s0['lw']/2+(s0['lw']*0.15 if s0['lx']<0 else 0),s0['ly']+s0['lw']*0.5
    js("(()=>{const s=__zhutianApp.settings;s.set('floatPos',{x:120,y:300,edge:'',tucked:false})})()");js("__zhutianApp.float.sync()");page.wait_for_timeout(600);s0=st()
    fx,fy=s0['lx']+s0['lw']/2,s0['ly']+s0['lw']*0.5
    b,b2=drag_to(fx,fy,'float','swap',shot='v113-phone-lilith-targets.png')
    ok('dragging Lilith shows TWO targets: 切换成头像 and 关闭悬浮窗 (near the bottom, on screen)',b and b['show'] and [x['t'] for x in b['t']]==['swap','close'] and '换成头像' in b['t'][0]['label'] and '关闭悬浮窗' in b['t'][1]['label'] and all(x['bottom']<=s0['vh'] and x['top']>s0['vh']*0.6 for x in b['t']),b)
    ok('hovering the swap target highlights only it',b2 and [x['hot'] for x in b2['t']]==[True,False],b2 and [x['hot'] for x in b2['t']])
    s1=st();ok('drop on 切换: Lilith → round avatar (floatLilith=off), not closed',s1['mode']=='off' and not s1['lilith'] and s1['avatar'],s1)
    page.screenshot(path=str(out/'v113-phone-avatar.png'))
    b,b2=drag_to(s1['ax']+s1['aw']/2,s1['ay']+s1['ah']/2,'entry','swap',shot='v113-phone-avatar-targets.png')
    ok('dragging the avatar shows 换成莉莉丝 and 关闭悬浮窗',b and b['show'] and '换成莉莉丝' in b['t'][0]['label'] and '关闭悬浮窗' in b['t'][1]['label'],b)
    s2=st();ok('avatar drop on 切换: back to the floating Lilith (auto on touch)',s2['mode']=='auto' and s2['lilith'] and not s2['avatar'],s2)
    ok('the avatar went back to its old place (drop on a target is not a move)',js("JSON.stringify(__zhutianApp.settings.get('circlePosition'))") in ('null',None),js("__zhutianApp.settings.get('circlePosition')"))
    # Lilith → 关闭 (cancel first, then confirm)
    s2=st();drag_to(s2['lx']+s2['lw']/2,s2['ly']+s2['lw']*0.5,'float','close')
    ok('drop on 关闭 asks first; 先不关 keeps her',confirm(False) and st()['mode']=='auto' and st()['lilith'],st())
    s2=st();drag_to(s2['lx']+s2['lw']/2,s2['ly']+s2['lw']*0.5,'float','close')
    c=confirm(True);s3=st()
    ok('Lilith 关闭 (confirmed): floatLilith=none — no Lilith AND no avatar',c and s3['mode']=='none' and not s3['lilith'] and not s3['avatar'],s3)
    page.screenshot(path=str(out/'v113-phone-closed.png'))
    js("__zhutianApp.openTerminal('ov')");page.wait_for_timeout(1300);s4=st()
    ok('closed: terminal still opens (扩展面板 path); header avatar docked; 浮窗 toggle present',s4['open'] and s4['docked'] and s4['toggle']=='浮窗',s4)
    sr("sr.getElementById('close').click();return 1");page.wait_for_timeout(1000);s5=st()
    ok('closed: × closes the terminal and nothing turns into a floating avatar',not s5['open'] and not s5['avatar'] and not s5['lilith'],s5)
    # avatar close
    js("__zhutianApp.settings.set('floatLilith','off')");page.wait_for_timeout(600);s6=st()
    ok('settings 头像 restores the avatar',s6['avatar'] and not s6['lilith'],s6)
    drag_to(s6['ax']+s6['aw']/2,s6['ay']+s6['ah']/2,'entry','close');c=confirm(True);s7=st()
    ok('avatar 关闭 (confirmed): floatLilith=none, avatar gone',c and s7['mode']=='none' and not s7['avatar'] and not s7['lilith'],s7)
    # terminal × and toggle in both layouts, with the Lilith float back
    js("__zhutianApp.settings.set('floatLilith','auto')");page.wait_for_timeout(500)
    js("__zhutianApp.openTerminal('ov')");page.wait_for_timeout(1300);a=st()
    sr("sr.getElementById('zt-layout-toggle').click();return 1");page.wait_for_timeout(900);b_=st()
    page.screenshot(path=str(out/'v113-phone-window.png'))
    sr("sr.getElementById('close').click();return 1");page.wait_for_timeout(900);c_=st()
    js("__zhutianApp.openTerminal('ov')");page.wait_for_timeout(1300);d_=st()
    sr("sr.getElementById('zt-layout-toggle').click();return 1");page.wait_for_timeout(900);e_=st()
    sr("sr.getElementById('close').click();return 1");page.wait_for_timeout(900);f_=st()
    ok('toggle shows 浮窗 in full screen and 全屏 in window mode, after reopen too',a['toggle']=='浮窗' and b_['toggle']=='全屏' and d_['toggle']=='全屏' and e_['toggle']=='浮窗',[a['toggle'],b_['toggle'],d_['toggle'],e_['toggle']])
    ok('× closes the terminal in window and full-screen mode; Lilith stays Lilith',not c_['open'] and not f_['open'] and c_['lilith'] and f_['lilith'] and not c_['avatar'] and not f_['avatar'],[c_,f_])
    # sizes
    js("__zhutianApp.settings.set('floatSize','p20')");page.wait_for_timeout(700);s8=st()
    ok('floatSize 20%: Lilith 30 px wide and on screen',s8['lw'] in (30,31) and s8['ly']>=0 and s8['ly']<s8['vh'],s8)
    js("(()=>{const s=__zhutianApp.settings;s.set('floatSize','m');s.set('floatLilith','off');s.set('avatarSize','p20')})()");page.wait_for_timeout(700);s9=st()
    ok('avatarSize 20%: avatar ≈13 px and inside the viewport',s9['avatar'] and 11<=s9['aw']<=15 and 0<=s9['ax']<=s9['vw']-s9['aw'] and 0<=s9['ay']<=s9['vh'],s9)
    page.screenshot(path=str(out/'v113-phone-avatar20.png'))
    b,_=drag_to(s9['ax']+s9['aw']/2,s9['ay']+s9['ah']/2,'entry','swap',drop=False);page.mouse.move(200,300,steps=6);page.mouse.up();page.wait_for_timeout(700)
    cp=js("__zhutianApp.settings.get('circlePosition')");s10=st()
    ok('20% avatar still drags; lands where dropped (translate ÷ scale)',b and b['show'] and cp and abs(s10['ax']-cp['x'])<=2 and abs(s10['ay']-cp['y'])<=2 and s10['mode']=='off',[cp,s10['ax'],s10['ay']])
    js("(()=>{const s=__zhutianApp.settings;s.set('avatarSize','xl');s.set('circlePosition',null)})()");page.wait_for_timeout(500);s11=st()
    ok('avatarSize back to 100%: 64 px',s11['aw']==64,s11)
    # settings page + drawer
    js("__zhutianApp.openTerminal('set')");page.wait_for_timeout(1500)
    sp=sr("const q=k=>[...(sr.querySelector(`select[data-k=\"${k}\"]`)?.options||[])].map(o=>o.value);return {fl:q('floatLilith'),fs:q('floatSize'),as:q('avatarSize'),close:!!sr.querySelector('[data-act=\"float-close\"]'),lab:sr.querySelector('select[data-k=\"floatLilith\"]')?.closest('label,div')?.textContent?.slice(0,30)}")
    ok('设置: 悬浮窗 select = 切换 (auto / 莉莉丝 / 头像 / 已关闭) + separate 关闭悬浮窗 button',sp['fl']==['auto','on','off','none'] and sp['close'],sp)
    ok('设置: both sizes go down to 20%',sp['fs'][0]=='p20' and sp['as'][0]=='p20' and 'xl' in sp['as'],sp)
    sr("sr.querySelector('[data-act=\"float-close\"]').click();return 1");c=confirm(True);s12=st()
    ok('设置 → 关闭悬浮窗 closes every floating entry',c and s12['mode']=='none',s12)
    sr("sr.getElementById('close').click();return 1");page.wait_for_timeout(800)
    js("document.querySelector('.zt-set-actions [data-act=\"avatar\"]').click()");page.wait_for_timeout(600);s13=st()
    js("document.querySelector('.zt-set-actions [data-act=\"float\"]').click()");page.wait_for_timeout(600);s14=st()
    ok('扩展面板: 显示头像 → avatar, 显示悬浮莉莉丝 → Lilith',s13['mode']=='off' and s13['avatar'] and s14['lilith'] and not s14['avatar'],[s13['mode'],s14['mode']])
    ok('phone: no page errors',not errors,errors[:3])
    restore();ctx.close()
    # ================= desktop =================
    ctx,errors=run(dict(viewport={'width':1280,'height':860}),'desktop')
    d0=st();ok('desktop default (auto): the original launcher, no floating Lilith',d0['avatar'] and not d0['lilith'],d0)
    b,_=drag_to(d0['ax']+d0['aw']/2,d0['ay']+d0['ah']/2,'entry','swap',shot='v113-desktop-targets.png');d1=st()
    ok('desktop launcher drag → 换成莉莉丝 shows the floating Lilith (floatLilith=on)',b and b['show'] and d1['mode']=='on' and d1['lilith'] and not d1['avatar'],d1)
    page.mouse.click(d1['lx']+d1['lw']/2,d1['ly']+d1['lw']*0.5,button='right');page.wait_for_timeout(400)
    menu=js("[...document.getElementById('zhutian-lilith-float').shadowRoot.querySelectorAll('.menu [data-m]')].map(b=>b.dataset.m+':'+b.textContent)")
    ok('desktop right-click menu has 切换成头像 and 关闭悬浮窗',any(m.startswith('swap:切换成头像') for m in menu) and any(m.startswith('close:关闭悬浮窗') for m in menu),menu)
    js("document.getElementById('zhutian-lilith-float').shadowRoot.querySelector('.menu [data-m=swap]').click()");page.wait_for_timeout(600);d2=st()
    ok('menu 切换成头像 → original launcher back',d2['mode']=='off' and d2['avatar'] and not d2['lilith'],d2)
    js("__zhutianApp.settings.set('avatarSize','p40')");page.wait_for_timeout(500);d3=st()
    ok('desktop launcher scales too (40%) and stays on screen',d3['avatar'] and d3['aw']<d0['aw'] and 0<=d3['ax'] and d3['ay']+d3['aw']<=d3['vh'],[d0['aw'],d3])
    js("(()=>{const s=__zhutianApp.settings;s.set('avatarSize','xl');s.set('floatLilith','auto');s.set('circlePosition',null);s.set('floatPos',null)})()")
    # ---------- 经典折叠: one API call ----------
    ok('main API connected to mock',Z.connect_main_api(page) not in (None,'no_connection'))
    js(f"async()=>{{const a=__zhutianApp;const api=await import('{EXT}api-center.js');await api.saveConfigs(a.bridge,'诸天记忆助手_v1',{{url:'http://127.0.0.1:5001/v1',key:'fixture-only-not-a-secret',model:'mock-zt'}});}}")
    js("__zhutianApp.openTerminal('shop')");page.wait_for_timeout(2500)
    js("async()=>{await __zhutianApp.bridge.updateVariablesWith(v=>{v.诸天系统.系统点=50000000;v.诸天系统.商品历史=[];v.诸天系统.待处理物品=[];v.诸天系统.背包=[];v.诸天系统.盲盒状态={累计抽数:0,保底计数:0,仙品次数:0,神品次数:0};return v;},{type:'chat'});}")
    page.wait_for_timeout(1200);js("__zhutianApp.hub.scheduleEngineView(0)");page.wait_for_timeout(900)
    def gacha(t):
        return js("""async (t)=>{const a=__zhutianApp,d=a.hub.engineFrame.contentDocument;d.querySelector('#gacha-custom-n').value=String(t);const b=d.querySelector('.btn-gacha[data-custom]');
          try{await a.commerce.handle(b,a.hub.engineFrame);return 'ok'}catch(e){return e.message}}""",t)
    for n in (49,60,120):
        calls['product']=0;calls['items']=[];calls['max']=[];before=js('__zhutianApp.adapter.ledger()');r=gacha(n);after=js('__zhutianApp.adapter.ledger()')
        new=after['待处理物品'][len(before['待处理物品']):];folded={x['品级']:x['数量'] for x in new if x['名称'].endswith('杂物')}
        singles=[x for x in new if not x['名称'].endswith('杂物')]
        exp={'凡品'} if n>=50 else set()
        if n>=100: exp|={'灵品'}
        ok(f'经典折叠 {n} 抽: ONE API call with every unfolded item; folded grades only counted',r=='ok' and calls['product']==1 and len(calls['items'][0])==len(singles) and not (set(calls['items'][0])&exp) and set(folded)<=exp and sum(x['数量'] for x in new)==n and after['系统点']==before['系统点']-n*10000,
           dict(r=r,calls=calls['product'],items=len(calls['items'][0]) if calls['items'] else 0,singles=len(singles),folded=folded,max=calls['max']))
    ok('desktop: no page errors',not errors,errors[:3])
    restore();ctx.close();browser.close()
(out/'results.json').write_text(json.dumps(results,ensure_ascii=False,indent=1),'utf8')
f=[r for r in results if not r['pass']];print(f'{len(results)-len(f)}/{len(results)} passed');sys.exit(1 if f else 0)

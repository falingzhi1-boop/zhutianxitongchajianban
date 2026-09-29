import {ID,STORAGE,CAPABILITIES,evidenceRows,identity} from './contracts.js';
const esc = x => String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=x=>x!==null&&x!==undefined&&x!==''&&Number.isFinite(Number(x))?Number(x).toLocaleString('zh-CN'):'未建立';
export class Terminal {
 constructor(adapter,original,base){this.adapter=adapter;this.original=original;this.base=base;this.page='home';this.prepared=null;this.draftText='';this.draftTarget='莉莉丝';this.lastIdentity='';this.motion=null;this.txPreview=null;this.disposers=[];this.toastTimer=null;}
 mount(){
  this.host=document.createElement('div');this.host.id=ID;document.body.append(this.host);this.shadow=this.host.attachShadow({mode:'open'});
  this.shadow.innerHTML=`<link rel="stylesheet" href="${this.base}styles/shell.css"><dialog aria-label="诸天契约终端"><div class="terminal"><header class="top"><div class="brand"><div>诸天<small>THE COVENANT TERMINAL</small></div></div><div class="top-meta" id="host-status">读取当前聊天…</div><span class="status-badge">原生开发版 · 0.2.0</span><button class="mobile-portrait-button" data-act="portrait" aria-label="查看原版莉莉丝">✧</button><button data-act="close" aria-label="关闭终端">×</button></header><div class="layout"><nav class="rail" aria-label="终端导航"><div class="rail-label">BEYOND THE STATUS BAR</div>${[['home','命运中枢'],['book','世界规则'],['ledger','任务行囊'],['interact','契约互动'],['commerce','万界交易'],['memory','原版记忆'],['diagnostics','迁移诊断']].map(([id,title])=>`<button data-page="${id}">${title}</button>`).join('')}<p class="motto">诸界皆是过客，<br>唯有契约永恒。</p></nav><main class="content" id="content"></main><aside class="char-column"><div class="char-head"><span>ORIGINAL LILITH · 原版形象</span><i></i></div><div class="portrait"><img id="lilith-portrait" src="${this.base}assets/original/lilith.webp" alt="原版莉莉丝"></div><div class="char-info"><h2>莉莉丝</h2><p class="english">LILITH · YOUR COVENANT</p><blockquote id="lilith-note">「界面之外的故事，也可以有我的身影。把想说的话，带回正文吧。」</blockquote><button class="outline" data-act="lilith">与她互动，写入正文 →</button><small>点触为原版本地反馈 · 正文发送另行确认</small></div></aside></div><footer class="foot"><span id="footer-status">宿主连接中</span><span>真实宿主数据 · 非概念版模拟账本</span><b>SILLYTAVERN 1.19.0</b></footer></div><div class="toast" id="toast" hidden role="status"></div></dialog>`;
  this.shadow.host.style.setProperty('--world-image',`url("${this.base}assets/star-sea.jpg")`);this.dialog=this.shadow.querySelector('dialog');
  this.launcher=document.createElement('button');this.launcher.id='zt-covenant-launcher';this.launcher.title='诸天 · 打开莉莉丝契约终端';this.launcher.setAttribute('aria-label','打开诸天契约终端');this.launcher.innerHTML=`<img src="${this.base}assets/original/avatar.webp" alt="">`;document.body.append(this.launcher);
  const open=()=>this.open();this.launcher.addEventListener('click',open);this.disposers.push(()=>this.launcher.removeEventListener('click',open));
  this.onClick=e=>this.click(e);this.shadow.addEventListener('click',this.onClick);this.disposers.push(()=>this.shadow.removeEventListener('click',this.onClick));
  this.onInput=e=>{if(e.target.id==='action-text'){this.draftText=e.target.value;this.prepared=null;this.disableConfirm();}if(e.target.id==='target-name'){this.draftTarget=e.target.value;this.prepared=null;this.disableConfirm();}if(e.target.id==='rule-search'){this.filterRules(e.target.value);}};
  this.shadow.addEventListener('input',this.onInput);this.disposers.push(()=>this.shadow.removeEventListener('input',this.onInput));
  this.onGesture=e=>{const z=e.target.closest?.('.zt-zone');if(!z)return;const actions={cheek:'我轻轻碰了碰莉莉丝的脸颊，想听听她的回应。',arm:'我向莉莉丝伸出手，邀请她陪我继续这段旅途。',wing:'我好奇地看向莉莉丝的羽翼，询问她关于翅膀的故事。',horn:'我指了指莉莉丝的角，问她这是否与契约有关。'};this.draftText=actions[z.dataset.zone]||'我走近莉莉丝，向她示意，希望与她聊一聊。';this.draftTarget='莉莉丝';this.prepared=null;this.el('lilith-note').textContent='已准备一段玩家行动草稿。点击下方按钮预览，确认后才会写入正文。';if(this.page==='interact')this.render();};
  this.shadow.addEventListener('click',this.onGesture,true);this.disposers.push(()=>this.shadow.removeEventListener('click',this.onGesture,true));
  this.onGestureKey=e=>{if(['Enter',' '].includes(e.key)&&!e.repeat)this.onGesture(e);};this.shadow.addEventListener('keydown',this.onGestureKey,true);this.disposers.push(()=>this.shadow.removeEventListener('keydown',this.onGestureKey,true));
  this.disposers.push(this.adapter.subscribe(()=>this.refresh()));
  this.onCancel=()=>this.shadow.querySelector('.char-column')?.classList.remove('mobile-open');this.dialog.addEventListener('close',this.onCancel);this.disposers.push(()=>this.dialog.removeEventListener('close',this.onCancel));
  this.refresh();
  try{this.motion=this.original.ZhuTianLilithMotion.mount({shadow:this.shadow,doc:document,openChat:()=>this.navigate('interact')});}catch(e){this.el('lilith-note').textContent='分层动效未启动，已保留原版静态立绘：'+e.message;}
  this.decorateStory();
 }
 el(id){return this.shadow.getElementById(id);}
 open(){if(!this.dialog.open)this.dialog.showModal();this.refresh();this.motion?.stages?.[0]?.start();}
 close(){this.dialog.close();this.launcher.focus();}
 navigate(page){this.page=page;this.render();this.shadow.querySelector('.char-column')?.classList.remove('mobile-open');}
 notify(text){clearTimeout(this.toastTimer);this.el('toast').textContent=text;this.el('toast').hidden=false;this.toastTimer=setTimeout(()=>{if(this.host.isConnected)this.el('toast').hidden=true;},6000);}
 refresh(){
  const c=this.adapter.context(),id=identity(c),changed=id!==this.lastIdentity;if(changed){this.lastIdentity=id;this.prepared=null;this.txPreview=null;this.draftText='';this.draftTarget='莉莉丝';}
  this.el('host-status').textContent=id?`${c.name2||'当前角色'} / ${c.getCurrentChatId()}`:'请先打开一个单角色聊天';this.el('footer-status').textContent=this.adapter.generating?'主聊天正在生成 · 互动发送已锁定':id?'宿主已连接 · 数据来自当前聊天':'未绑定聊天 · 不初始化账本';
  if(changed||this.page!=='interact'||!this.shadow.activeElement?.matches('input,textarea'))this.render();
  this.decorateStory();
 }
 header(en,title,num,subtitle=''){return `<div class="heading"><div><div class="eyebrow">${en}</div><h1>${title}</h1>${subtitle?`<p class="subtitle">${subtitle}</p>`:''}</div><span class="number">${num}</span></div>`;}
 render(){
  this.shadow.querySelectorAll('[data-page]').forEach(b=>{b.classList.toggle('active',b.dataset.page===this.page);b.setAttribute('aria-current',b.dataset.page===this.page?'page':'false');});
  const content=this.el('content');content.classList.remove('view-enter');
  const f={home:()=>this.home(),book:()=>this.book(),ledger:()=>this.ledger(),interact:()=>this.interact(),commerce:()=>this.commerce(),memory:()=>this.memory(),diagnostics:()=>this.diagnostics()};
  content.innerHTML=(f[this.page]||f.home)();content.scrollTop=0;content.classList.add('view-enter');
 }
 home(){
  const c=this.adapter.context(),l=this.adapter.ledger(),tasks=evidenceRows(l),bag=Array.isArray(l?.背包)?l.背包:[];
  const currentName=l?.当前世界||l?.世界名称||c.name2||'尚未选择聊天';
  return this.header('A REAL CONNECTION BETWEEN WORLDS','命运中枢','01')+`<section class="chart"><div class="chart-caption"><div class="eyebrow">FROM THE ACTUAL CHAT</div><h2>${esc(currentName)}</h2><p>不再隔着一块状态栏。<br>让每一次互动，成为故事本身。</p></div><div class="chart-mark"></div><div class="chart-bottom"><p>${l?'已读取原版诸天系统账本':'没有检测到原账本；不生成虚构余额'}</p><button class="primary" data-page="interact">走入正文，开始互动 →</button></div></section><div class="grid3"><div class="stat"><div class="value">${l?fmt(l.系统点):'—'}</div><p>系统点 · 原账本只读</p></div><div class="stat"><div class="value">${tasks.length}</div><p>已记录任务</p></div><div class="stat"><div class="value">${bag.length}</div><p>背包条目</p></div></div><div class="notice">原版莉莉丝的立绘、分层参数动画、表情与点触已接入。现在可把玩家互动作为真实用户消息写入主聊天，由当前聊天模型继续回应，而不是播放预设 AI 答案。</div><div class="section"><h2 class="section-title">原版能力迁移中</h2><div class="record"><div><h3>视觉终端与正文互动已连通</h3><p>原版剧情结算内核、已有库存购买及单件使用/回收已接入。自动记忆整理、AI 进货与抽取仍待迁移。</p></div><button data-page="diagnostics">查看边界 →</button></div></div>`;
 }
 book(){return this.header('THE ORIGINAL WORLD RULES','世界规则','02','保留原版条目。此处只读预览，不擅自向提示中塞入全部世界书。')+`<input class="search" id="rule-search" placeholder="搜索原版规则名称或关键词…" aria-label="搜索规则"><div class="book-list" id="book-list">${this.rulesHTML('')}</div><p class="review-notice">当前为原版内置规则快照；自动安装、世界书绑定、关键字触发与预算等价性仍待迁移验收。</p>`;}
 rulesHTML(q){const list=(this.original.ZhuTianBuiltinRules||[]).filter(e=>!q||(String(e.comment)+JSON.stringify(e.key||[])).toLowerCase().includes(q.toLowerCase()));return list.map(e=>`<details><summary>${esc(e.comment||'未命名规则')} <small class="muted">${e.disable?'已禁用':e.constant?'常驻':'条件触发'}</small></summary><div class="book-content">${esc(e.content||'')}</div></details>`).join('')||'<div class="empty">没有匹配的规则。</div>';}
 filterRules(q){this.el('book-list').innerHTML=this.rulesHTML(q);}
 ledger(){
  const l=this.adapter.ledger();if(!l)return this.header('ONE LEDGER · NO SHADOW ECONOMY','任务与行囊','03')+'<div class="empty">当前聊天未发现原版诸天系统账本。<br>开发版不会自动创建模拟余额，也不会初始化或覆盖旧存档。</div><div class="notice warning">本版不凭空初始化账本。请先在隔离副本核对已有变量；原生交易与旧引擎不可同时启用。</div>';
  const tasks=evidenceRows(l),bag=Array.isArray(l.背包)?l.背包:[];
  return this.header('ONE LEDGER · NO SHADOW ECONOMY','任务与行囊','03','直接读取原版变量。此页只读。购买、扣点和结算需在“万界交易”中逐项确认。')+`<div class="grid3" style="margin-top:0"><div class="stat"><div class="value">${fmt(l.系统点)}</div><p>真实记录的系统点</p></div><div class="stat"><div class="value">${fmt(l.累计消费)}</div><p>累计消费</p></div><div class="stat"><div class="value">${tasks.filter(t=>t.状态==='已完成').length}</div><p>已完成任务记录</p></div></div><section class="section"><h2 class="section-title">命运中的篇章</h2>${tasks.map(t=>`<article class="record"><div><h3>${esc(t.名称||'未命名任务')}</h3><p>${esc(t.内容||'无任务说明')}</p><small>${esc(t.状态||'未记录状态')} · ${esc(t.奖励||'无奖励说明')}</small></div><button data-task-discuss="${esc(t.ID||t.名称)}">带入正文 →</button></article>`).join('')||'<div class="empty">原账本尚未记录任务。</div>'}</section><section class="section"><h2 class="section-title">次元行囊</h2><div class="inventory">${bag.map((i,n)=>`<article class="record"><div class="item-symbol">◇</div><h3>${esc(i.名称||'未命名物品')}</h3><p>${esc(i.效果||i.简介||'尚无物品描述')}</p><small>${esc(i.品级||'未知品级')} · 数量 ${esc(i.数量??'未记录')}</small><div style="margin-top:13px"><button data-item-discuss="${n}">询问或观察 →</button></div></article>`).join('')||'<div class="empty">背包没有已记录物品。</div>'}</div></section><div class="notice warning">正文中的“观察/询问”不是消耗物品或领取奖励。实际交易需到“万界交易”明确启用并确认，不能与旧引擎同时运行。</div>`;
 }
 commerce(){
  const l=this.adapter.ledger(),enabled=this.adapter.settings().nativeLedgerEnabled,tx=this.txPreview,receipts=Object.values(this.adapter.transactions.receipts).slice(-6).reverse();
  const buy=Array.isArray(l?.商城库存)?l.商城库存:[],bag=Array.isArray(l?.背包)?l.背包:[];
  return this.header('THE EXCHANGE · EVERY CHANGE HAS A RECEIPT','万界交易','07','原版结算逻辑，真实聊天账本。视觉反馈不是交易凭据，服务器确认才是。')+`
  <section class="exchange-hero"><div><div class="eyebrow">ONE LEDGER / ORIGINAL RULES</div><h2>契约有价，凭据长存。</h2><p>每笔已执行的交易都会在正文留下系统记录，不冒充莉莉丝的模型回复。</p></div><div class="exchange-balance"><small>当前账本 · 系统点</small><strong>${l?fmt(l.系统点):'未建立'}</strong><span>${enabled?'原生结算已明确开启':'写入默认关闭'}</span></div></section>
  <div class="notice warning">仅在已备份的单角色聊天启用。先停用旧状态栏与旧助手，不能让两个引擎同时结算。当前支持已有货架购买、单件使用/回收、最新剧情数据块确认结算；AI 进货和抽卡尚未接通。</div>
  <div class="actions">${enabled?'<button class="outline" data-act="disable-ledger">停用原生结算</button>':'<label><input id="ledger-consent" type="checkbox">我已备份，并已停用旧状态栏/旧助手</label><button class="primary" data-act="enable-ledger">启用原生结算</button>'}<button class="outline" data-tx="panel" ${!enabled?'disabled':''}>预览最新剧情结算 →</button><button class="outline" data-act="return">查看正文凭据 →</button></div>
  ${tx?`<section class="settlement-preview" role="region" aria-label="结算预览"><div class="eyebrow">REVIEW BEFORE COMMIT</div><h2>${esc(tx.title)}</h2><p>${esc(tx.detail)}</p><div class="receipt-numbers"><span>系统点变化 <b>${tx.delta>=0?'+':''}${fmt(tx.delta)}</b></span><span>确认后余额 <b>${fmt(tx.balance)}</b></span></div><small>凭据 ${esc(tx.id)} · 正文变化会使本预览失效</small><div class="actions"><label><input type="checkbox" id="transaction-consent">确认执行，并把系统结算记录写入正文</label><button class="primary" data-act="commit-ledger" ${this.adapter.busy?'disabled':''}>${this.adapter.busy?'正在核验存档…':'确认执行一次 →'}</button><button class="outline" data-act="cancel-ledger">取消</button></div></section>`:''}
  <section class="section"><div class="exchange-section-title"><h2 class="section-title">万界货架</h2><span class="chip">原库存 · ${buy.filter(x=>!x.已购).length} 件待售</span></div><div class="market-grid">${buy.map((item,i)=>`<article class="market-card ${item.已购?'sold':''}"><div class="market-symbol">◇</div><small>${esc(item.品阶||'凡品')} / ${esc(item.分类||'其他')}</small><h3>${esc(item.名称||'未命名')}</h3><p>${esc(item.效果||'原库存未记录描述')}</p><footer><strong>${fmt(item.价格)} <small>原价 / 点</small></strong><button class="outline" data-tx="buy" data-index="${i}" ${item.已购||!enabled?'disabled':''}>${item.已购?'已售出':'预览购买 →'}</button></footer></article>`).join('')||'<div class="empty">当前原账本没有货架。不会填充虚构商品；AI 进货仍待迁移。</div>'}</div></section>
  <section class="section"><h2 class="section-title">行囊 · 使用与回收</h2>${bag.map((item,i)=>`<article class="record"><div><h3>${esc(item.名称)} <small>×${esc(item.数量??1)}</small></h3><p>${esc(item.品级||'凡品')} · ${esc(item.分类||'其他')}</p></div><div class="actions"><button data-tx="use" data-index="${i}" ${!enabled?'disabled':''}>预览使用</button><button data-tx="recycle" data-index="${i}" ${!enabled?'disabled':''}>回收一件</button></div></article>`).join('')||'<div class="empty">行囊无已记录物品。</div>'}</section>
  <section class="section"><h2 class="section-title">最近的系统凭据</h2>${receipts.map(r=>`<article class="record"><div><h3>${esc(r.title)}</h3><p>${esc(r.detail)}</p><small>${esc(r.id)}</small></div><span class="receipt-delta">${r.delta>=0?'+':''}${fmt(r.delta)}</span></article>`).join('')||'<div class="empty">尚无本扩展已执行记录。</div>'}</section>`;
 }
 targets(){const c=this.adapter.context(),l=this.adapter.ledger(),names=['莉莉丝',c.name2,l?.恋爱目标?.姓名,...(Array.isArray(l?.打手)?l.打手.map(x=>x.名称||x.姓名):[])].filter(x=>typeof x==='string'&&x.trim());return [...new Set(names)];}
 interact(){
  const preview=this.prepared?`<div class="section"><h2 class="section-title">即将进入正文的玩家消息</h2><div class="preview-box">${esc(this.prepared.message)}</div><p class="review-notice">只写入你的行动和台词，不替莉莉丝或其他人编造回答。不会自动请求模型，也不会把按钮动画作为账本凭据。</p><div class="actions"><label><input type="checkbox" id="send-consent">我确认把上面的内容写入当前主聊天</label><button class="primary" data-act="send" ${this.adapter.busy||this.adapter.generating?'disabled':''}>确认写入正文 →</button></div></div>`:'';
  return this.header('LET THE INTERACTION BECOME THE STORY','契约互动','04','这是通往主聊天的真实通路。发送前可以逐字检查；模型回复仍属于正常剧情。')+`<div class="connection">${identity(this.adapter.context())?esc(this.adapter.context().name2||'当前角色')+' · 当前聊天已连接':'请先打开一个单角色聊天'}</div><div class="form-group"><label for="target-name">互动对象 · 可选择或填写正文中的其他角色</label><input id="target-name" list="target-options" value="${esc(this.draftTarget)}" maxlength="80"><datalist id="target-options">${this.targets().map(n=>`<option value="${esc(n)}"></option>`).join('')}</datalist></div><div class="quick-actions"><button data-suggestion="companion">邀请同行</button><button data-suggestion="task">询问当前任务</button><button data-suggestion="quiet">片刻交谈</button><button class="mobile-portrait-button" data-act="portrait">原版互动立绘</button></div><div class="form-group"><label for="action-text">你的行动与台词</label><textarea id="action-text" maxlength="1200" placeholder="描述你想做的事。不要在这里伪造对方回复…">${esc(this.draftText)}</textarea></div><div class="actions"><button class="outline" data-act="return">返回主聊天</button><button class="primary" data-act="preview" ${this.adapter.busy||this.adapter.generating?'disabled':''}>预览正文消息 →</button></div><div class="status-line" id="interaction-status" role="status">${this.adapter.generating?'主聊天正在生成，发送已暂时锁定。':'默认不自动发送、不自动计费。聊天发生变化时，旧预览会被拒绝。'}</div>${preview}`;
 }
 disableConfirm(){const b=this.shadow.querySelector('[data-act="send"]');if(b){b.disabled=true;b.textContent='内容已更改，请重新预览';}}
 memory(){
  let st,v,err='';try{st=this.adapter.memory();v=this.original.ZhuTianMemoryCore.view(st,this.adapter.timeline());}catch(e){err=e.message;}
  const enabled=this.adapter.settings().recallEnabled;
  return this.header('MEMORY WITHOUT REWRITING THE PAST','原版记忆','05','读取原版记忆格式，使用原版回忆算法，不把本地预设对白当成记忆事实。')+`<div class="notice ${err?'warning':''}">${esc(err||(!st.enabled?'原聊天尚未启用记忆。此开发版不会替你开启自动整理或收费补读。':`原版有效记忆 ${v.facts.length} 条，历史分支记录 ${v.stale} 份。`))}</div><div class="actions"><button class="outline" data-act="recall" ${!st?.enabled?'disabled':''}>${enabled?'停用本扩展的回忆提示':'启用原版回忆提示'}</button><span class="chip">${enabled?'已明确开启':'默认关闭'}</span></div><p class="review-notice">仅影响本扩展命名空间的提示注入。旧助手仍在运行时拒绝重复启用；不会删除历史记忆、接管旧提示或启动独立 API 请求。</p><section class="section"><h2 class="section-title">当前分支的有效记录</h2><div class="memory-preview">${esc(v?.facts?.map(f=>`${f.key} · ${f.status}\n${f.text}\n证据：${f.evidence}`).join('\n\n')||'暂无可用记忆。')}</div></section><section class="section"><h2 class="section-title">固定提醒</h2><div class="memory-preview">${esc(st?.pins?.join('\n')||'未记录固定提醒。')}</div></section>`;
 }
 diagnostics(){return this.header('HONEST CAPABILITIES · TRACEABLE EVIDENCE','迁移诊断','06','开发检查点不是完整发行版。已接通与尚未迁移的能力，在这里明确区分。')+`<div class="record"><div><h3>原生扩展宿主</h3><p>SillyTavern ${esc(this.adapter.version)} · 无需酒馆助手即可打开终端与发送玩家消息</p><small>仓库：falingzhi1-boop/zhutianxitongchajianban · 开发版 · 不自动更新</small></div><span class="chip ok">已连接</span></div>${CAPABILITIES.map(c=>`<div class="migration-row"><div><h3>${c.name}</h3><span class="chip ${c.state==='implemented'?'ok':'pending'}">${c.state==='implemented'?'已实现':c.state==='read-only'?'只读接入':'待迁移'}</span></div><p>${c.scope}</p></div>`).join('')}<div class="notice warning">当前版本不替代原版全套功能。确认完整功能矩阵、旧存档兼容、安装和真实模型验收后，才可发布“直接安装即可使用全部原版功能”的版本。</div>`;}
 async click(e){
  const b=e.target.closest('button');if(!b||b.disabled)return;
  try{
   if(b.dataset.tx){this.el('toast').hidden=true;this.txPreview=await this.adapter.transactions.prepare(b.dataset.tx,b.dataset.index);this.navigate('commerce');this.shadow.querySelector('.settlement-preview')?.scrollIntoView({block:'center',behavior:'smooth'});return;}
   if(b.dataset.page){this.navigate(b.dataset.page);return;}
   if(b.dataset.suggestion){const s={companion:'我向她伸出手，邀请她陪我一起探索接下来的世界。',task:'我询问她对当前任务的看法，希望听到具体建议，而不是直接替我完成任务。',quiet:'我请她暂时放下手中的事，想与她安静地聊一会儿。'};this.draftText=s[b.dataset.suggestion];this.prepared=null;this.render();return;}
   if(b.dataset.taskDiscuss){const t=evidenceRows(this.adapter.ledger()).find(x=>(x.ID||x.名称)===b.dataset.taskDiscuss);if(!t)return;this.draftText=`我拿出关于「${t.名称}」的任务记录，询问她目前掌握的线索，以及下一步应该如何行动。`;this.prepared=null;this.navigate('interact');return;}
   if(b.dataset.itemDiscuss!==undefined){const i=this.adapter.ledger()?.背包?.[Number(b.dataset.itemDiscuss)];if(!i)return;this.draftText=`我取出「${i.名称}」，请她与我一起观察它，并解释它可能的用途。我暂时不消耗这件物品。`;this.prepared=null;this.navigate('interact');return;}
   switch(b.dataset.act){
    case 'enable-ledger':if(!this.el('ledger-consent')?.checked)throw Error('必须先确认备份与停用旧引擎。');await this.adapter.setNativeLedger(true);this.render();break;
    case 'disable-ledger':await this.adapter.setNativeLedger(false);this.txPreview=null;this.render();break;
    case 'cancel-ledger':this.adapter.transactions.cancelPreview();this.txPreview=null;this.render();break;
    case 'commit-ledger':{
      if(!this.el('transaction-consent')?.checked)throw Error('请先勾选执行确认。');
      this.el('toast').hidden=true;const id=this.txPreview?.id;if(!id)throw Error('请重新预览。');
      try{await this.adapter.transactions.commit(id);this.txPreview=null;this.render();this.notify('服务器凭据已核实，系统结算记录已写入正文。不会自动请求模型。');}catch(error){this.txPreview=null;this.render();throw error;}break;
    }
    case 'close':case 'return':this.close();break;
    case 'portrait':this.shadow.querySelector('.char-column').classList.toggle('mobile-open');this.motion?.stages?.[0]?.start();break;
    case 'lilith':this.draftTarget='莉莉丝';this.prepared=null;this.navigate('interact');break;
    case 'preview':this.prepared=this.adapter.draft(this.draftTarget,this.draftText);this.render();this.shadow.querySelector('.preview-box')?.scrollIntoView({block:'center',behavior:'smooth'});break;
    case 'send':{
      if(!this.el('send-consent')?.checked)throw Error('请先勾选确认，内容才会写入主聊天。');
      const draft=this.prepared;if(!draft)throw Error('请重新预览内容。');
      b.disabled=true;b.textContent='正在交给主聊天…';
      try{await this.adapter.send(draft);this.prepared=null;this.draftText='';this.render();this.decorateStory();this.close();globalThis.toastr?.success('玩家互动已写入正文。请在主聊天继续生成，让当前模型回应。','诸天契约');}catch(error){this.prepared=null;this.render();throw error;}
      break;
    }
    case 'recall':await this.adapter.setRecall(!this.adapter.settings().recallEnabled);this.render();this.notify('回忆提示设置已保存到当前聊天。');break;
   }
  }catch(error){this.notify(error.message);if(this.el('interaction-status'))this.el('interaction-status').textContent=error.message;}
 }
 decorateStory(){
  const chat=this.adapter.context()?.chat||[];
  for(let i=0;i<chat.length;i++){
   const m=chat[i],meta=m.extra?.[STORAGE];
   if(m.is_system&&meta?.kind==='ledger-receipt'){
    const record=document.querySelector(`#chat .mes[mesid="${i}"] .mes_text`);
    if(record){record.classList.add('zt-ledger-record');if(!record.querySelector(':scope > .zt-ledger-label')){const tag=document.createElement('div');tag.className='zt-ledger-label';tag.textContent='✧  诸天系统 · 已核实结算 / SYSTEM RECEIPT';record.prepend(tag);}}
    continue;
   }
   if(!m.is_user||meta?.kind!=='player-interaction')continue;
   // Host DOM integration pinned to the tested message selector; adds inert decoration, never replaces host message content.
   const node=document.querySelector(`#chat .mes[mesid="${i}"] .mes_text`);if(!node)continue;
   let label=node.querySelector(':scope > .zt-covenant-story-label');if(label&&label.dataset.id===meta.id)continue;if(label)label.remove();
   label=document.createElement('div');label.className='zt-covenant-story-label';label.dataset.id=meta.id;
   if(meta.target==='莉莉丝'){const img=document.createElement('img');img.src=this.base+'assets/original/avatar.webp';img.alt='';label.append(img);}
   const text=document.createElement('span');text.textContent='契约互动 · '+String(meta.target||'未知对象');const small=document.createElement('small');small.textContent='玩家行动';label.append(text,small);node.prepend(label);
  }
 }
 dispose(){clearTimeout(this.toastTimer);this.motion?.dispose();this.disposers.splice(0).forEach(fn=>fn());this.dialog.close();this.launcher.remove();this.host.remove();document.querySelectorAll('.zt-covenant-story-label,.zt-ledger-label').forEach(el=>el.remove());document.querySelectorAll('.zt-ledger-record').forEach(el=>el.classList.remove('zt-ledger-record'));}
}

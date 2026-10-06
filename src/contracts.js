export const ID = 'zhutian-covenant-terminal';
export const STORAGE = 'zhutianCovenantTerminal';
/** 1.0: structure version of the 诸天系统 ledger, kept in chatMetadata[STORAGE].ledgerSchema (see src/data-io.js). */
export const LEDGER_SCHEMA = 2;
export const PROMPT = `${ID}/memory`;
export const VERSION = '1.1.1';
export const PATCH_REV = '1.1.1';
// Host range replaces the former exact 1.19.0 gate; see src/compat.js for the per-version evidence.
export { HOST_MIN, HOST_TESTED } from './compat.js';
export const ASSISTANT_ID = 'zhutian-lilith-native';          // NOT 'zt-memory-assistant-v1' so a still-installed old helper stays detectable.
export const STATUSBAR_CLASS = 'zt-native-statusbar';
export const LEGACY_SCRIPT_ID = 'd9764037-5fda-4203-89ab-9b94f27255ab'; // v1.1 Tavern Helper helper script id (config import only).
export const BRIDGE_KEY = '__zhutianNativeBridge';
export const MAX_ACTION = 1200;
export function inert(value) {
    return String(value ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replaceAll('{{', '｛｛').replaceAll('}}', '｝｝').replaceAll('<', '＜').replaceAll('>', '＞');
}
export function normalizeIntent(target, action) {
    const who = inert(target).trim();
    const text = inert(action).trim();
    if (!who || who.length > 80) throw Error('请选择有效的互动对象（最多80字）。');
    if (!text || text.length > MAX_ACTION) throw Error(`互动内容须为1至${MAX_ACTION}字。`);
    return { target: who, action: text, message: `我转向${who}。\n\n${text}` };
}
export function identity(context) {
    if (!context || context.groupId || context.characterId === undefined || context.characterId === null) return '';
    const avatar = context.characters?.[context.characterId]?.avatar;
    const chat = context.getCurrentChatId?.();
    return avatar && chat ? `${avatar}/${chat}` : '';
}
export function snapshotToken(context) {
    const chat = context.chat || [];
    const last = chat.at(-1);
    return JSON.stringify([identity(context), chat.length, last?.swipe_id, last?.mes, last?.send_date]);
}
export function evidenceRows(ledger) {
    if (!ledger || typeof ledger !== 'object' || Array.isArray(ledger)) return [];
    const tasks = ledger.任务库;
    return tasks && typeof tasks === 'object' && !Array.isArray(tasks) ? Object.values(tasks).filter(x => x && typeof x === 'object') : [];
}
export const CAPABILITIES = [
    {name:'原版莉莉丝立绘、分层动效与点触',state:'implemented',scope:'原版素材和参数动画；另可切换 AI 差分立绘或加载用户提供的真 Live2D 模型（莉莉丝本人的 .moc3 需用导出的 PSD 在 Cubism Editor 绑定）'},
    {name:'原生扩展安装、入口与全屏终端',state:'implemented',scope:'无需酒馆助手；已在 SillyTavern 1.16.0 / 1.17.0 / 1.18.0 / 1.19.0 隔离真实宿主验收'},
    {name:'原版状态栏 v3.1（8 分页）原生渲染',state:'implemented',scope:'无需正则与酒馆助手；数据写回 chat_metadata.variables 并读盘核验'},
    {name:'原版莉莉丝助手窗口（工作台、记忆、规则、连接、状态）',state:'implemented',scope:'原版代码经原生桥接完整启动；需要模型的功能见下方待验收项'},
    {name:'互动进入真实主聊天',state:'implemented',scope:'玩家消息、明确确认、真实保存；模型回应须由用户在主聊天继续生成'},
    {name:'其他角色的正文互动',state:'implemented',scope:'读取当前角色及原账本角色名；不伪造对方回复'},
    {name:'原账本、任务、背包与角色档案',state:'read-only',scope:'读取现有 chatMetadata.variables；新聊天可用 /zt init 按原版结构创建，不填模拟余额'},
    {name:'原版记忆回忆提示',state:'implemented',scope:'明确启用后使用原版回忆算法；不启用自动付费整理'},
    {name:'原版 4 个正则全部原生取代',state:'implemented',scope:'状态栏 3.1（0.7.0 起只在终端内显示，楼层留“系统已记录”小标签；旧兼容模式不再在设置中提供）、旧楼层不发给AI（生成拦截器，同 minDepth 2）、莉莉丝专属语音框（原正则逐字节、可开关）；无需导入正则'},
    {name:'世界书变量宏 {{get_chat_variable::…}}',state:'implemented',scope:'无需酒馆助手：生成前替换提示词、渲染时替换正文；酒馆助手宏开启时自动让位'},
    {name:'真实触摸互动',state:'implemented',scope:'原版轻点反应之上加入抚摸（三档）、长按、手机视线跟随手指与震动反馈；可开关'},
    {name:'API 中心与酒馆主 API',state:'implemented',scope:'一处配置状态栏与莉莉丝助手（写入原版同一存储）；可选直接使用酒馆当前主 API；修复状态栏 max_tokens / temperature 被忽略'},
    {name:'一键接管 / 恢复旧版',state:'implemented',scope:'停用（不删除）旧正则与旧酒馆助手脚本并记录，可一键恢复；角色卡内项目经 writeExtensionField 保存'},
    {name:'外挂世界书安装与聊天绑定',state:'implemented',scope:'35 条内置规则；已存在同名世界书时只绑定不覆盖；不依赖角色卡 MVU'},
    {name:'原版自动记忆整理、补读及独立 API',state:'experimental',scope:'1.0 实验性（模拟模型验收）：界面已迁移；原逻辑已运行，但没有凭据，未完成真实模型请求验收'},
    {name:'原版工作台完整工具与建议接续',state:'experimental',scope:'1.0 实验性（模拟模型验收）：界面已迁移，真实模型未验收'},
    {name:'原剧情结算、已有商城库存购买、单件使用与回收',state:'implemented',scope:'默认关闭；预览确认、原版规则、Web Locks、服务器存档凭据及正文系统记录；分支变化冻结交易'},
    {name:'AI 商城进货、许愿、抽取、外挂与神通支付动作',state:'experimental',scope:'1.0 实验性（模拟模型验收）：原版状态栏按钮已在原生桥接上运行，模型结果回写未验收'},
    {name:'私聊 API 与真实模型生成',state:'experimental',scope:'1.0 实验性（模拟模型验收）：没有密钥，不进行收费请求；主聊天互动仅完成发送与保存验证'},
    {name:'世界主题（仙侠 / 赛博 / 诡异）',state:'implemented',scope:'0.7.0：按 当前世界 / 世界类型 / 货币自动判断，可在设置固定；只换颜色与装饰，控件位置不变；减少动态效果时静止；万界足迹记录到访世界'},
    {name:'莉莉丝界面角色与镜头',state:'implemented',scope:'0.7.0：选中任务 / 物品 / 功法、结算成败时用原版部位反应（动作 + 表情）配账本台词；系统页半身、工作台全身、私聊面部特写、剧情提示胸像；不新增动作、不伪造 Live2D'},
    {name:'图谱：事件线、羁绊图、星图、能力树',state:'implemented',scope:'0.7.0：节点全部来自账本记录，详情显示原始字段与来源路径，可跳回任务页 / 聊天群 / 外挂 / 楼层；星图可加锁记录穿越'},
    {name:'演出：穿越、突破、契约、任务完成、抽取、奖励入库',state:'implemented',scope:'0.7.0：只在账本保存并读回后播放，播放前再次核对，回滚的标为未入账；≤2.1 秒可跳过，结果卡片可跳转记录；可只显示卡片或关闭'},
    {name:'AI 自动写入 当前世界 / 世界类型',state:'experimental',scope:'1.0 实验性：0.7.0：已注入提示并由原版 变量更新 写入；仅用模拟模型验收，真实模型遵循度未验证'},
    {name:'旧存档迁移、账本备份与回滚',state:'implemented',scope:'1.0：迁移报告、旧助手配置导入；账本回滚在弹窗里点击验收（tests/native_v100.py），回滚前的状态总会先备份并保留'},
    {name:'修行 · 熟练度（功法实效 / 实战积累 / 角色卡功法）',state:'implemented',scope:'0.8.0：每轮把各功法当前阶段的原版效果注入提示；正文用了功法而数据块漏记时按品阶补记少量熟练度（换页随旧回复撤销）；读取角色卡 / MVU / 其他脚本的功法变量并只升不降地导入功法库。真实模型是否按阶段效果演绎未验证'},
    {name:'莉莉丝气泡播报与剧情台词',state:'implemented',scope:'0.8.0：终端内不再显示状态栏底部的“莉莉丝：……”一行，数据块的系统播报由立绘气泡说出；点立绘空白处按账本说剧情台词；无立绘（手机）时用终端提示条'},
    {name:'管理员控制台入口',state:'implemented',scope:'0.8.0：从 设置 → 高级 · 管理员 打开原版管理员面板；终端内隐藏 ◆ 连点入口'},
    {name:'莉莉丝原版页面跟随世界主题',state:'implemented',scope:'0.8.0：工作台 / 记忆 / 规则 / 连接 / 状态页、底部状态行、私聊面板在仙侠 / 赛博 / 诡异主题下使用同一套颜色；默认主题保持原版紫色'},
    {name:'莉莉丝连接页拉取模型（CORS 时经酒馆服务器转发）',state:'implemented',scope:'0.8.1：修复原版连接页拉取模型必报“CORS”的问题（私有作用域缺 fetch）；浏览器被拦截时经酒馆自己的服务器转发，保留 /v1 基础路径'},
    {name:'聊天群：真随机招募、按预算定实力档、红包节奏、剧情来源',state:'implemented',scope:'0.8.1：招募在本地抽世界类型与目标实力档并排除刚出现过的人；入群费独立曲线（300 起）；红包/赠礼三四轮一次（宿主主动要求除外，账本层强制）；聊天群入库记录注入正文提示，保持物品来历'},
    {name:'世界书更新到插件版本',state:'implemented',scope:'0.8.1：在原版 35 条上修正过时说明并新增「36｜联动｜诸天聊天群」；设置里可「更新到最新版（先备份）」或导出 JSON；旧书不会被自动覆盖'},
    {name:'世界书一键解绑 / 关闭插件时自动解绑',state:'implemented',scope:'0.8.2：设置 → 一键解绑：把“诸天万界最强系统”从所有角色卡（主世界书与附加世界书）、全局世界书和当前聊天取下（不删除），记录可恢复；停用插件时（SillyTavern 1.17+ disable 钩子）自动执行，可关'},
    {name:'悬浮莉莉丝（手机）',state:'implemented',scope:'0.8.2：手机/触屏上唤醒按钮换成莉莉丝表情立绘：点开终端、双击戳、长按拖动、拖到边缘躲起来并记住位置；立绘不可见时台词气泡在这里弹出；0.8.3：大小可调（默认 75%），终端开着时点她只说话、不再关闭终端'},
    {name:'角色卡状态栏兼容（酒馆助手前端渲染）',state:'implemented',scope:'0.8.2：楼层渲染不再整段重建 .mes_text，保留酒馆助手的 TH-render 包装，角色卡自带状态栏不再消失；助手宏开启时楼层宏让位'},
    {name:'独立 API 流式传输与可读报错（502 / “CORS” 误报修复）',state:'implemented',scope:'0.8.4：私聊 / 记忆 / 工作台 / 状态栏 AI 的请求一律以 stream 发出（直连与酒馆转发都是），插件拼回普通 JSON 交给原版；拉取模型失败显示真实原因（HTTP 状态 + 说明），不再统一报“CORS”；原版固定 60 秒超时可调（默认 180 秒，包装层适配，原版代码不变）。以模拟服务商 + SillyTavern 1.16 / 1.19 转发验收；真实服务商未验收'},
    {name:'手机终端内打开私聊',state:'implemented',scope:'0.8.4：打开私聊不再关闭主窗口（= 终端），私聊面板浮在终端上；“返回”回到终端'},
    {name:'一处 API 设置（连接页 = API 中心）',state:'implemented',scope:'0.8.4：终端「连接」页直接显示 API 中心表单（同时写入状态栏与莉莉丝两份存储），原版连接表单隐藏；状态栏 ⚙ API 也打开同一表单'},
    {name:'强力模块开关（神豪挥霍 / 诸天打手默认关闭）',state:'implemented',scope:'0.8.4：外挂管理 → 强力模块：直接开关世界书条目（所有聊天生效），关掉的模块在终端隐藏并告诉 AI 未装载；新安装默认关闭神豪挥霍、诸天打手，已有世界书不自动改动，提供一键平衡'},
    {name:'配色方案',state:'implemented',scope:'0.8.4：设置 → 世界与演出 → 配色方案，7 套固定配色（紫夜 / 墨金 / 青瓷 / 绯樱 / 霜蓝 / 赤霞 / 石墨）或跟随世界；仙侠主题改为墨玉金'},
    {name:'其他美化 / 渲染扩展兼容',state:'implemented',scope:'0.8.4：楼层重建时对照酒馆原始渲染，其他扩展加入或替换的节点（iframe 渲染、美化包装）原地保留、不重复；以模拟渲染器在 1.16 / 1.19 验收，具体第三方美化未逐一验收'},
    {name:'AI 接口设置（新手版排版）',state:'implemented',scope:'0.8.5：连接页改为一句话状态 + 三步（选择用哪个 AI → 填写接口 → 测试并保存）；“状态栏 / 莉莉丝助手”两行与“应用到…”收进高级设置；修复单选框被原版样式拉伸成半行宽。'},
    {name:'账本核验引导',state:'implemented',scope:'0.8.5：记忆页「立即核验最新正文」下方说明用途与前提；未开启时高亮「在当前聊天启用助手与记忆注入」「莉莉丝监管账本与奖励」「保存当前聊天设置」并给出白话提示，替换原版“请先启用当前聊天与账本核验；未写入。”。原版检查逻辑不变。'},
    {name:'生成状态自愈（手机状态栏不渲染修复）',state:'implemented',scope:'0.8.5：漏掉生成结束事件时（手机切后台、思考模型等），本次生成中出现过的酒馆停止按钮一旦隐藏，过期的“正在生成”自动清除（从未出现过则不解锁，发送锁不变），最后一层照常渲染；停止按钮消失时主动重扫；兼容诊断显示最新楼层是否已渲染并可一键重新渲染。'},
    {name:'手机端适配',state:'implemented',scope:'0.9.0：手机上终端全屏（竖屏顶部导航、横屏左侧导航栏），窗口跟随输入法键盘变矮、输入框不被挡住，安全区留白；私聊同样全屏；点按目标放大、输入框 16px 防止 iOS 放大页面；浮动莉莉丝在终端打开时停在下角、点台词即收起；手机会话不再覆盖电脑上记住的窗口大小。设置 → 手机上的终端与私聊窗口（自动 / 总是全屏 / 浮动窗口）。仅 Playwright 触摸模拟验收，未在真机上测试'},
    {name:'复制诊断信息',state:'implemented',scope:'0.9.1：设置 → 兼容与维护 / 兼容诊断 / /zt copydiag：插件与酒馆版本、设备与屏幕、手机布局、宿主接口、状态栏与最新楼层、AI 接口（只有域名和模型名）、插件设置（白名单）、上次真机自检和最近 30 条插件报错；不含 API Key、脚本变量、聊天内容，输出前再统一脱敏；非安全上下文时用备用复制方式，仍不行就显示文本框手动复制'},
    {name:'手机真机自检',state:'implemented',scope:'0.9.1：设置 → 兼容与维护 → 手机真机自检（或 /zt selftest）：在用户自己的手机上逐步检查全屏、全部终端页面、聊天群与私聊的键盘、悬浮莉莉丝、横屏、返回键，需要操作的步骤可跳过；不写账本和聊天；结果保存在设置里并可一键复制。键盘检测新增整页缩放的 WebView。仅在 Chromium 手机模拟中验收，尚未收到真机结果'},
    {name:'楼层美化不重复',state:'implemented',scope:'0.9.2：别的扩展（关键词高亮等）先改过的段落、或变量扩展在酒馆画完后又改了消息时，【莉莉丝】台词不再出现“原文 + 语音框”两份，<ZhuTianPanel> 的 系统点 / 好感度 原文不再露在楼层里；代码块（角色卡前端状态栏）里的 莉莉丝：… 不再被改成语音框。iframe 前端卡与原地美化照常保留。真机待复测'},
    {name:'额外世界背景读取世界书',state:'implemented',scope:'0.9.3：规则 → 额外世界背景的「读取书目 / 读取所选」不再提示“当前助手缺少世界书读取接口”。原生桥接补上酒馆助手同名的 getWorldbookNames / getWorldbook（只读）：书名来自酒馆 getContext().getWorldInfoNames（1.19+）、world-info 模块或 /api/settings/get，条目来自 loadWorldInfo 或 /api/worldinfo/get；SillyTavern 与 TauriTavern 共用同一路径，不需要酒馆助手。'},
    {name:'星图更正当前世界',state:'implemented',scope:'0.9.3：星图里选中世界 →「识别错了？更正这个世界」：改世界名 / 世界类型（加锁写入并读回，不算穿越、不播放演出），同名足迹自动合并；非当前世界可从足迹删除。按名称猜的类型在节点上标「?」；当前世界的节点类型与顶栏主题一致（以前可能一个仙侠一个全息）。在记录穿越里填当前世界名也会变成更正类型。'},
    {name:'新手引导',state:'implemented',scope:'0.9.3：首次打开终端且还有步骤没完成时自动打开一次（终端 → 引导，或 设置 → 上手 → 新手引导）：① 导入或更新世界书 ② 设置 AI 接口（一键用酒馆当前主模型，或去连接页填写）③ 在当前聊天启用（按原版规则建账本 + 打开莉莉丝记忆）。每步按真实状态打勾，可跳过；跳过 / 完成会记住。'},
    {name:'招募令输入框跟随模式',state:'implemented',scope:'0.9.4：聊天群 → 群员 → 发布招募令：选「随机世界」时在输入框里打字，会自动改为「指定世界」（之后仍可改成指定角色），不再出现“填了名字却还是随机”；切回随机会清空输入框；输入框提示随模式变化；指定世界 / 指定角色没填名字时直接提示，不扣 100 点。'},
    {name:'悬浮莉莉丝抠图立绘',state:'implemented',scope:'1.0：手机悬浮莉莉丝改为从原版分层抠出的人物（无卡片），翅膀分层扇动、表情补丁、眨眼与说话口型；素材与校验见 assets/lilith/float/PROVENANCE.md；只在手机模拟里验收'},
    {name:'导出 / 导入存档',state:'implemented',scope:'1.0：设置 → 账本与存档 → 导出 / 导入存档（或 /zt export）：.json 文件含插件设置和当前聊天的账本（可选记忆、私聊记录），不含 API Key；导入先预览、先备份、写入后读回，不会清空本机密钥'},
    {name:'账本结构版本',state:'implemented',scope:'1.0：结构版本记在 chatMetadata.zhutianCovenantTerminal.ledgerSchema（AI 看不到）；打开旧聊天时先备份再升级，更新版本插件写过的账本只读'},
    {name:'设置分层与搜索',state:'implemented',scope:'1.0：设置页分 常用 / 进阶设置 / 诊断与维护，搜索框按标题与说明过滤并自动展开'},
    {name:'统一错误提示',state:'implemented',scope:'1.0：失败提示统一为「发生了什么。账本：有没有改动。下一步：…」，账本状态只在能确定时才写'},
    {name:'手机横屏导航精简',state:'implemented',scope:'1.0：横屏左侧导航只放 总览 / 任务 / 商城 / 背包 / 聊天群 / 设置 + 「更多」，当前页总会显示；只在手机模拟里验收'},
    {name:'动态效果自动降级',state:'implemented',scope:'1.0：设置 → 进阶设置 → 动态效果：自动（系统减少动态效果或触屏设备帧率 < 40 时精简）/ 完整 / 精简；精简时悬浮莉莉丝不摆动、装饰动画停止、演出只显示结果；真实低端机未测'},
    {name:'品阶鉴定（剧情功法 / 物品）',state:'implemented',scope:'1.0 玩家反馈：剧情 / 角色卡 / 旧存档来的功法和物品（非系统来源）可手动修正品阶，只升不降、最高神品；物品回收价保持原值；写入读回并同步楼层快照；「收录:功法名[更高品阶]」可更正（跟随楼层）。浏览器点击验收（1.19）'},
    {name:'品阶鉴定 · AI 判断',state:'experimental',scope:'1.0 实验性（模拟模型验收）：按诸天统一标准给出「品阶|理由」，走分功能 API「品阶鉴定」；真实模型的判断质量未验证'},
    {name:'分功能 API 与接口预设',state:'implemented',scope:'1.0 玩家反馈：12 处模型调用（1.1.1 加「数据块补记」）各自跟随默认 / 酒馆主 API / 预设 / 单独配置；预设必须输入名称才能保存；存在全局变量 诸天系统_API路由，不进聊天和导出。以模拟模型请求日志验收地址、密钥、模型的改写；真实服务商未验收'},
    {name:'一键关闭插件与关闭悬浮莉莉丝',state:'implemented',scope:'1.0 玩家反馈：设置 → 插件开关 调用酒馆 disableExtension（先确认）；悬浮莉莉丝拖到底部或右键关闭，确认框提示从酒馆「扩展」面板重新进入控制台，扩展面板可让她回来。1.19 浏览器验收'},
    {name:'数据块格式守卫',state:'implemented',scope:'1.1.1 玩家反馈：新回复的 <ZhuTianPanel> 混入正文 / 思维链 / 其他卡变量、没闭合、大小写或代码块、只写在思维链里、多个块时自动整理（健康的块一字不改；原文备份在楼层，可还原）；旧楼层显示与提示词过滤按整理后的块；每轮格式提醒；「激活/领悟《X》」改写为 收录:X'},
    {name:'数据块补记',state:'experimental',scope:'1.1.1 实验性（模拟模型验收）：回复缺少数据块时按世界书模板和本轮正文让「数据块补记」接口补写一次（默认只在缺失时，可关闭）；写入前核对聊天 / 楼层 / 分页 / 正文未变；真实模型未验收'},
];

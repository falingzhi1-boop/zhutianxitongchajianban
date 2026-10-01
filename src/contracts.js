export const ID = 'zhutian-covenant-terminal';
export const STORAGE = 'zhutianCovenantTerminal';
export const PROMPT = `${ID}/memory`;
export const VERSION = '0.5.0';
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
    {name:'原版 4 个正则全部原生取代',state:'implemented',scope:'状态栏 3.1、旧楼层精简显示（点击展开）、旧楼层不发给AI（生成拦截器，同 minDepth 2）、莉莉丝专属语音框（原正则逐字节、可开关）；无需导入正则'},
    {name:'世界书变量宏 {{get_chat_variable::…}}',state:'implemented',scope:'无需酒馆助手：生成前替换提示词、渲染时替换正文；酒馆助手宏开启时自动让位'},
    {name:'真实触摸互动',state:'implemented',scope:'原版轻点反应之上加入抚摸（三档）、长按、手机视线跟随手指与震动反馈；可开关'},
    {name:'API 中心与酒馆主 API',state:'implemented',scope:'一处配置状态栏与莉莉丝助手（写入原版同一存储）；可选直接使用酒馆当前主 API；修复状态栏 max_tokens / temperature 被忽略'},
    {name:'一键接管 / 恢复旧版',state:'implemented',scope:'停用（不删除）旧正则与旧酒馆助手脚本并记录，可一键恢复；角色卡内项目经 writeExtensionField 保存'},
    {name:'外挂世界书安装与聊天绑定',state:'implemented',scope:'35 条内置规则；已存在同名世界书时只绑定不覆盖；不依赖角色卡 MVU'},
    {name:'原版自动记忆整理、补读及独立 API',state:'pending',scope:'界面已迁移·待模型验收：原逻辑已运行，但没有凭据，未完成真实模型请求验收'},
    {name:'原版工作台完整工具与建议接续',state:'pending',scope:'界面已迁移·待模型验收'},
    {name:'原剧情结算、已有商城库存购买、单件使用与回收',state:'implemented',scope:'默认关闭；预览确认、原版规则、Web Locks、服务器存档凭据及正文系统记录；分支变化冻结交易'},
    {name:'AI 商城进货、许愿、抽取、外挂与神通支付动作',state:'pending',scope:'界面已迁移·待模型验收：原版状态栏按钮已在原生桥接上运行，模型结果回写未验收'},
    {name:'私聊 API 与真实模型生成',state:'pending',scope:'没有密钥，不进行收费请求；主聊天互动仅完成发送与保存验证'},
    {name:'旧存档迁移、账本备份与回滚',state:'pending',scope:'迁移报告、旧助手配置导入与回滚界面已提供；尚未完成浏览器点击验收'}
];

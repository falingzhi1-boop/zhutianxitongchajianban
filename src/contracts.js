export const ID = 'zhutian-covenant-terminal';
export const STORAGE = 'zhutianCovenantTerminal';
export const PROMPT = `${ID}/memory`;
export const HOST_VERSION = '1.19.0';
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
    {name:'原版莉莉丝立绘、分层动效与点触',state:'implemented',scope:'复用原版素材和参数动画；不是完整 Cubism 模型'},
    {name:'原生扩展安装、入口与全屏终端',state:'implemented',scope:'无需酒馆助手即可打开；仅核验 SillyTavern 1.19.0'},
    {name:'互动进入真实主聊天',state:'implemented',scope:'玩家消息、明确确认、真实保存；模型回应须由用户在主聊天继续生成'},
    {name:'其他角色的正文互动',state:'implemented',scope:'读取当前角色及原账本角色名；不伪造对方回复'},
    {name:'原账本、任务、背包与角色档案',state:'read-only',scope:'读取现有 chatMetadata.variables；不迁移、重置或创建第二结算器'},
    {name:'原版记忆回忆提示',state:'implemented',scope:'明确启用后使用原版回忆算法；不启用自动付费整理'},
    {name:'世界书内置条目预览',state:'read-only',scope:'保留原规则数据；尚未完成自动安装、绑定及触发等价验收'},
    {name:'原版自动记忆整理、补读及独立 API',state:'pending',scope:'未迁移，开发版不显示伪成功'},
    {name:'原版工作台完整工具与建议接续',state:'pending',scope:'未迁移，原源码保留为迁移基线'},
    {name:'原剧情结算、已有商城库存购买、单件使用与回收',state:'implemented',scope:'默认关闭；预览确认、原版规则、Web Locks、服务器存档凭据及正文系统记录；分支变化冻结交易'},
    {name:'AI 商城进货、许愿、抽取及其余交易模块',state:'pending',scope:'未迁移，不使用概念样机的虚构交易规则'},
    {name:'私聊 API 与真实模型生成',state:'pending',scope:'没有密钥，不进行收费请求；主聊天互动仅完成发送与保存验证'},
    {name:'自动安装包、全功能迁移与旧存档兼容',state:'pending',scope:'新仓库已提供，完整迁移仍待完成；禁止标记为全功能发行版'}
];

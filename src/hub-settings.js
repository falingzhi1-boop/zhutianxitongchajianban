// 终端 · 设置页: every switch and tool that used to hide in the Extensions drawer, grouped, in the terminal itself.
import { VERSION } from './contracts.js';
import { HOST_TESTED } from './compat.js';
import { esc } from './hub.js';

const sw = (k, label, desc = '') => ({ type: 'switch', k, label, desc });
const sel = (k, label, options, desc = '') => ({ type: 'select', k, label, options, desc });
const num = (k, label, min, max, desc = '') => ({ type: 'number', k, label, min, max, desc });
const act = (id, label, desc = '', cls = '') => ({ type: 'action', id, label, desc, cls });

export class HubSettings {
    constructor(app) { this.app = app; this.extra = []; }
    get s() { return this.app.settings; }
    /** Later modules (演出 / 主题 / 聊天群) add their own group. */
    addSection(section) { this.extra.push(section); }
    sections() {
        const app = this.app;
        return [
            { title: '显示', sub: '终端就是诸天系统；聊天楼层保持干净。', items: [
                sel('statusbar', '聊天楼层里的系统数据块', [['terminal', '终端记账，楼层只留小标签（推荐）'], ['off', '关闭（不处理数据块）'], ...(this.s.get('statusbar') === 'native' ? [['native', '旧兼容模式（0.7.0 起不再提供，切走后不再显示）']] : [])], '终端模式下 AI 输出的 <ZhuTianPanel> 由终端记账，楼层里不再出现状态栏。'),
                sw('floorTag', '楼层小标签“系统已记录”', '点击标签直接打开终端。'),
                sw('voiceBox', '莉莉丝专属语音框（语音美化）'),
                sw('hud', '输入框上方账本速览'),
                sw('hotkeys', '快捷键 Alt+Z / Alt+X 开关终端 · Alt+S 总览'),
                sel('hubOutsideClose', '点击终端外部时关闭', [['auto', '仅手机'], ['always', '总是'], ['never', '从不']]),
                sw('hubBackClose', '手机返回手势关闭终端'),
            ] },
            { title: '提示词与世界书', items: [
                sw('promptStripPanels', '旧楼层数据块不发给 AI（省 token）'),
                num('promptPanelKeepDepth', '保留最新几层的数据块', 0, 6, 'AI 每轮都会从世界书“实时数据”读到最新账本，所以可以设为 0（数据块全部不回传，最省 token）；保留 1–2 层能让 AI 照抄格式更稳。'),
                sw('macroLike', '世界书变量宏 {{get_chat_variable::…}}', '酒馆助手宏开启时自动让位。'),
                sw('worldbookAuto', '诸天存档自动安装并绑定世界书', '不覆盖你改过的条目。'),
                act('worldbook', '世界书安装 / 绑定…'),
            ] },
            { title: '账本与存档', items: [
                act('init', '新聊天初始化', '按原版规则创建账本；已存在时只补齐缺失字段。'),
                act('migrate', '旧存档迁移 / 账本回滚…', '最近 5 份自动备份，可一键回滚。'),
            ] },
            { title: '连接', items: [
                act('api', 'API 中心…', '状态栏 AI 功能与莉莉丝共用；可直接用酒馆当前主 API。'),
                act('go-api', '莉莉丝连接页'),
            ] },
            { title: '莉莉丝', items: [
                sw('touchGestures', '真实触摸互动（抚摸 / 长按 / 视线跟随）'),
                sw('haptics', '触摸震动反馈（手机）'),
                sel('portrait.mode', '立绘模式', [['rig', '原版分层动画（伪 Live2D）'], ['variants', '原版 + 表情差分（随语气切换）'], ['live2d', '真 Live2D（需自备 Cubism 模型）']]),
                act('live2d', '立绘 / Live2D 设置…'),
                sw('lilith.react', '界面角色：对选中任务 / 物品 / 功法和结算成败作出反应', '只用原版表情与分层动作；台词来自账本数据。'),
                sw('lilith.pageLines', '进入系统页时说一句（每页每次会话一次）'),
                sw('lilith.camera', '镜头：系统页半身 · 工作台全身 · 私聊面部特写'),
                sw('lilith.story', '气泡播报：数据块里的「系统播报」由立绘气泡说出；点立绘空白处说剧情台词', '原来在状态栏底部的“莉莉丝：……”一行已移到这里。'),
            ] },
            { title: '世界与演出', sub: '主题只换颜色和装饰，按钮位置不变。', items: [
                sel('world.theme', '界面主题', [['auto', '跟随当前世界（自动判断）'], ['default', '诸天（默认）'], ['xianxia', '仙侠 · 玉简 / 星图 / 阵纹'], ['cyber', '赛博 · 全息终端'], ['eerie', '诡异 · 异常与侵蚀']], this.worldDesc()),
                sw('world.prompt', '提示 AI 记录穿越（当前世界 / 世界类型）', '穿越时 AI 在数据块「变量更新」里写一行；星图也可以手动记录。'),
                sel('fx.mode', '演出', [['full', '完整演出（≤2 秒，可跳过）'], ['brief', '只显示结果卡片'], ['off', '关闭']], '只在账本写入并读回后播放；失败则显示失败。系统开启“减少动态效果”时自动只显示卡片。'),
                sw('fx.outside', '终端关闭时在聊天角落显示剧情提示卡片'),
                act('fx-preview', '预览演出', '播放一段示例（不写账本，卡片会标明“预览”）。'),
            ] },
            ...this.extra.map(x => (typeof x === 'function' ? x(app) : x)),
            { title: '高级 · 管理员', sub: '直接改账本，慎用。', items: [
                act('admin', '管理员控制台…', '原版管理员面板：直接改系统点、专属资源、好感 / 黑化 / 悔意、主修功法、货币、实力档。保存即真实写入账本（原 ◆ 连点五次的入口已从终端里移除）。'),
            ] },
            { title: '兼容与维护', items: [
                act('diagnose', '兼容诊断…'),
                act('takeover', '一键接管旧版', '停用（不删除）旧正则与旧酒馆助手脚本。'),
                act('restore', '恢复旧版', '', 'danger'),
            ] },
        ];
    }
    worldDesc() {
        const w = this.app.world?.current?.(); if (!w) return '';
        return `当前：${w.name || '未记录世界'}${w.type ? '（' + w.type + '）' : ''} → 自动判断为「${({ default: '诸天', xianxia: '仙侠', cyber: '赛博', eerie: '诡异' })[w.auto]}」`;
    }
    read(k) { return k.split('.').reduce((o, x) => o?.[x], this.s.all); }
    write(k, v) { const [head, tail] = k.split('.'); if (tail) this.s.patch(head, { [tail]: v }); else this.s.set(head, v); }
    render(el) {
        const control = it => {
            const v = it.k ? this.read(it.k) : undefined;
            if (it.type === 'switch') return `<label class="zt-switch"><input type="checkbox" data-k="${it.k}" ${v !== false && v ? 'checked' : ''} aria-label="${esc(it.label)}"><i></i></label>`;
            if (it.type === 'select') return `<select data-k="${it.k}" aria-label="${esc(it.label)}">${it.options.map(([val, t]) => `<option value="${val}" ${String(v) === val ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>`;
            if (it.type === 'number') return `<input type="number" data-k="${it.k}" min="${it.min}" max="${it.max}" value="${esc(v)}" aria-label="${esc(it.label)}">`;
            return `<button type="button" class="zt-btn ${it.cls || ''}" data-act="${it.id}">${esc(it.label.replace(/…$/, ''))}${it.label.endsWith('…') ? ' ›' : ''}</button>`;
        };
        el.innerHTML = `<div class="zt-eyebrow">TERMINAL SETTINGS</div><h2 class="zt-h">设置</h2><p class="zt-sub">诸天终端 ${VERSION} · 已验收 SillyTavern ${HOST_TESTED.join(' / ')} · 无需酒馆助手</p>
<div class="zt-grid2">${this.sections().map(sec => `<section class="zt-card"><h3>${esc(sec.title)}${sec.sub ? ` <small>${esc(sec.sub)}</small>` : ''}</h3>${sec.items.map(it => `<div class="zt-row"><span>${it.type === 'action' ? `<b style="font-weight:500">${esc(it.label.replace(/…$/, ''))}</b>` : esc(it.label)}${it.desc ? `<span class="zt-desc">${esc(it.desc)}</span>` : ''}</span>${control(it)}</div>`).join('')}</section>`).join('')}</div>`;
        el.onchange = e => {
            const input = e.target.closest('[data-k]'); if (!input) return;
            const v = input.type === 'checkbox' ? input.checked : input.type === 'number' ? Math.max(Number(input.min) || 0, Math.min(Number(input.max) || 6, Math.floor(Number(input.value)) || 0)) : input.value;
            this.write(input.dataset.k, v);
            this.app.hub?.toast('已保存');
        };
        el.onclick = e => { const b = e.target.closest('[data-act]'); if (b) this.run(b.dataset.act); };
    }
    run(id) {
        const app = this.app, t = globalThis.toastr;
        const map = {
            worldbook: () => app.features.openWorldbook(), migrate: () => app.features.openMigration(), diagnose: () => app.features.openDiagnostics(),
            api: () => app.openApiCenter(), 'go-api': () => app.hub.go('api'), live2d: () => app.portrait?.openSettings(),
            takeover: () => app.runTakeover(), restore: () => app.restoreLegacy(),
            'fx-preview': () => app.fx?.preview(),
            admin: () => app.hub.openAdmin(),
            init: () => app.features.initChat().then(r => { t?.success(r.created ? `已按原版规则初始化账本（系统点 ${r.points}）` : '账本已存在；已按原版规则补齐缺失字段', '诸天'); app.hub.reloadEngine(); }).catch(e => t?.error(e.message, '诸天')),
        };
        try { const r = map[id]?.(); r?.catch?.(e => t?.error(e.message, '诸天')); } catch (e) { t?.error(e.message, '诸天'); }
    }
}

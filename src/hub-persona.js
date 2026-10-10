// 1.1.5 终端 · 系统助手人设页: preset (莉莉丝 / 系统光球 / 自定义), name, form of address, personality, way of
// speaking, avatar, and (advanced) full replacements of the story rule / private-chat prompt, with a live preview.
// Saving writes the `persona` setting; PersonaHost applies it everywhere without a reload.
import { esc } from './hub.js';
import { PRESETS, PERSONA_DEFAULTS, resolvePersona, storyRule, chatPersona, cleanAvatar, AVATAR_MAX } from './persona.js';
import { errorLine } from './errors.js';

/** Settings value from the form (pure; keeps only known keys, trims, drops oversized / unsafe avatars). */
export function personaFromForm(form, prev = {}) {
    const out = { ...PERSONA_DEFAULTS, ...(prev && typeof prev === 'object' ? prev : {}) };
    for (const k of Object.keys(PERSONA_DEFAULTS)) if (k in (form || {})) out[k] = String(form[k] ?? '');
    if (!PRESETS.some(p => p.id === out.preset)) out.preset = 'lilith';
    out.avatar = cleanAvatar(out.avatar);
    for (const k of ['name', 'code', 'call', 'en']) out[k] = out[k].trim().slice(0, 24);
    for (const k of ['personality', 'style']) out[k] = out[k].trim().slice(0, 600);
    for (const k of ['story', 'chat']) out[k] = out[k].trim().slice(0, 4000);
    if (out.preset !== 'lilith' && out.name && out.name.replace(/\s+/g, '').length < 2) throw Error('名字至少 2 个字：太短会把正文里的「我说：“…”」之类误认成系统台词。');
    return out;
}

/** Shrinks a picked image to a 256 px square (cover) data URI that fits the settings file. Browser only. */
export function shrinkAvatar(file, size = 256) {
    return new Promise((resolve, reject) => {
        if (!file || !/^image\//.test(file.type)) { reject(new Error('请选择图片文件（png / jpg / webp / gif）。')); return; }
        if (file.size > 8 * 1024 * 1024) { reject(new Error('图片超过 8 MB，请换一张小一点的。')); return; }
        const url = URL.createObjectURL(file), img = new Image();
        img.onload = () => {
            try {
                const c = document.createElement('canvas'); c.width = c.height = size;
                const g = c.getContext('2d'), s = Math.min(img.naturalWidth, img.naturalHeight);
                g.drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 2, s, s, 0, 0, size, size);
                let data = c.toDataURL('image/webp', 0.86);
                if (!data.startsWith('data:image/webp')) data = c.toDataURL('image/jpeg', 0.86);
                if (data.length > AVATAR_MAX) data = c.toDataURL('image/jpeg', 0.6);
                if (data.length > AVATAR_MAX) throw new Error('图片压缩后仍然太大。');
                resolve(data);
            } catch (e) { reject(e); } finally { URL.revokeObjectURL(url); }
        };
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('图片读取失败。')); };
        img.src = url;
    });
}

export class HubPersona {
    constructor(app) { this.app = app; this.draft = null; }
    get hub() { return this.app.hub; }
    get s() { return this.app.settings; }
    start() {
        const hub = this.hub; if (!hub) return this;
        hub.register('persona', { title: '系统助手人设', render: el => this.render(el) });
        return this;
    }
    dispose() { /* the hub removes its pages */ }
    saved() { return { ...PERSONA_DEFAULTS, ...(this.s.get('persona') || {}) }; }
    render(el) {
        if (!el) return; this.el = el;
        const d = this.draft || (this.draft = this.saved());
        const p = resolvePersona(d), lilith = p.lilith, cur = resolvePersona(this.saved());
        const field = (k, label, ph = '', max = 24) => `<label class="zt-field"><span>${esc(label)}</span><input data-p="${k}" value="${esc(d[k])}" maxlength="${max}" placeholder="${esc(ph)}"></label>`;
        const area = (k, label, ph = '', max = 600, rows = 3) => `<label class="zt-field"><span>${esc(label)}</span><textarea data-p="${k}" maxlength="${max}" rows="${rows}" placeholder="${esc(ph)}">${esc(d[k])}</textarea></label>`;
        el.innerHTML = `<div class="zt-persona-page">
<div class="zt-eyebrow">SYSTEM PERSONA</div><h2 class="zt-h">系统助手人设</h2>
<p class="zt-sub">现在：<b>${esc(cur.name)}</b>${cur.lilith ? '（默认，原版莉莉丝）' : ''}。改人设不会改动你的世界书文件，也不会改原版代码：剧情里由插件在每次生成时临时替换「莉莉丝」那条规则，私聊 / 记忆 / 工作台的请求里换掉莉莉丝的人设，界面上的名字和头像跟着换。随时可以换回莉莉丝。</p>
<section class="zt-card"><h3>选择预设</h3>
<div class="zt-persona-presets" role="radiogroup" aria-label="人设预设">${PRESETS.map(x => `<label class="zt-persona-preset${d.preset === x.id ? ' on' : ''}"><input type="radio" name="zt-persona-preset" value="${x.id}" ${d.preset === x.id ? 'checked' : ''}><b>${esc(x.label)}</b><small>${esc(x.desc)}</small></label>`).join('')}</div>
</section>
${lilith ? `<section class="zt-card"><h3>莉莉丝（原版）</h3><p class="zt-note">原版人设、分层立绘、表情差分、触摸互动、悬浮莉莉丝都保持原样。选「系统光球」或「自定义」后可以编辑名字、性格和头像。</p></section>` : `
<section class="zt-card"><h3>身份</h3>
<div class="zt-persona-id"><div class="zt-persona-av"><img data-p-av alt="头像预览" src="${esc(p.avatar)}"><div class="zt-actions"><label class="zt-btn small">上传头像<input type="file" accept="image/*" data-p-file hidden></label><button type="button" class="zt-btn small" data-p-act="av-clear" ${d.avatar ? '' : 'disabled'}>用默认</button></div><small class="zt-note">自动裁成正方形并压缩到 256 像素，保存在酒馆的扩展设置里。没有头像时用${d.preset === 'orb' ? '编号光球' : '首字光球'}。</small></div>
<div class="zt-persona-fields">${field('name', '名字', d.preset === 'orb' ? `留空 = 系统${esc(p.code || '001')}` : '例如：小九、天道、零号')}
${d.preset === 'orb' ? field('code', '编号（光球上显示，最多 8 位字母数字）', '001', 8) : ''}
${field('call', '怎么称呼你', '宿主', 8)}
${field('en', '英文名（界面副标题，可留空）', d.preset === 'orb' ? `SYSTEM-${p.code}` : '', 16)}</div></div>
</section>
<section class="zt-card"><h3>性格与说话方式</h3>
${area('personality', '性格与人设', d.preset === 'orb' ? '留空 = 光球默认：冷静、理性、简洁，绝对忠诚' : '例如：毒舌但护短的老怪物，嘴上嫌弃，关键时刻比谁都靠谱。', 600, 4)}
${area('style', '说话方式', d.preset === 'orb' ? '留空 = 短句、条目式播报，常用「检测到」「已发放」' : '例如：文绉绉的半白话，自称「本座」。', 300, 2)}
<details class="zt-persona-adv"><summary>高级：整段替换（可选）</summary>
<p class="zt-note">留空 = 用上面的名字、性格自动生成。填了就整段代替原版的剧情规则 / 私聊人设（请保留台词格式和「对话不改账本」等约束，下面「预览」可以先看自动生成的版本）。</p>
${area('story', '剧情里的人设规则（代替世界书 02｜核心｜系统助手莉莉丝）', '', 4000, 6)}
${area('chat', '私聊人设（代替私聊的系统提示词）', '', 4000, 5)}
</details>
</section>
<section class="zt-card"><h3>预览</h3>
<p class="zt-note">剧情里的台词格式：<b>【${esc(p.name)}】：“……”</b>（语音框跟着换名字）。悬浮莉莉丝只属于莉莉丝；其他人设用圆形头像唤醒按钮（设置 → 系统助手 → 悬浮窗）。分层立绘、表情差分、触摸互动只对莉莉丝生效，其他人设显示头像。</p>
<details><summary>剧情规则（发给正文模型）</summary><pre class="zt-persona-pre">${esc(storyRule(p))}</pre></details>
<details><summary>私聊人设（发给私聊模型）</summary><pre class="zt-persona-pre">${esc(chatPersona(p))}</pre></details>
</section>`}
<div class="zt-actions zt-persona-bar"><button type="button" class="zt-btn primary" data-p-act="save">保存并生效</button><button type="button" class="zt-btn" data-p-act="revert">放弃修改</button>${cur.lilith ? '' : '<button type="button" class="zt-btn danger" data-p-act="lilith">换回莉莉丝</button>'}<button type="button" class="zt-btn" data-p-act="back">返回设置</button></div>
</div>`;
        el.oninput = e => { const k = e.target.dataset?.p; if (k) { this.draft[k] = e.target.value; } };
        el.onchange = async e => {
            if (e.target.name === 'zt-persona-preset') { this.draft.preset = e.target.value; this.render(el); return; }
            if (e.target.matches('[data-p-file]')) {
                const f = e.target.files?.[0]; if (!f) return;
                try { this.draft.avatar = await shrinkAvatar(f); this.render(el); }
                catch (err) { this.hub?.toast(errorLine(err), 6000); }
            }
            if (['code', 'name'].includes(e.target.dataset?.p)) this.render(el);
        };
        el.onclick = e => { const b = e.target.closest('[data-p-act]'); if (b) this.act(b.dataset.pAct); };
    }
    act(id) {
        const el = this.el;
        if (id === 'av-clear') { this.draft.avatar = ''; return this.render(el); }
        if (id === 'revert') { this.draft = null; return this.render(el); }
        if (id === 'back') { this.draft = null; return this.hub?.go('set'); }
        if (id === 'lilith') { this.draft = { ...this.saved(), preset: 'lilith' }; }
        try {
            const v = personaFromForm(this.draft, this.saved());
            this.s.set('persona', v); this.draft = null;
            const p = resolvePersona(v);
            this.hub?.toast(p.lilith ? '已换回莉莉丝（原版人设）' : `系统助手已换成「${p.name}」：下一次生成、私聊和界面立即生效`, 5000);
        } catch (err) { this.hub?.toast(errorLine(err), 7000); }
        this.render(el);
    }
}


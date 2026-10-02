// Lilith portrait modes on the ORIGINAL stage (the .zt-stage built by ZhuTianLilithMotion in the Lilith window):
//   rig       original layered parameter animation (default, untouched)
//   variants  AI-drawn expression / pose variants, cross-faded like Cubism exp3 (1.0 s fade), breathing, static background
//   live2d    a real Cubism 3/4/5 model (.model3.json + .moc3) rendered by the Cubism Framework (pixi-live2d-display, MIT)
// In every mode the original logic still decides the mood: we mirror `.zt-stage[data-expression]`, which the original
// motion module sets from part taps, story tone and chat events. Bubbles, zones and the static backdrop stay original.
import { LIVE2D_CORE_URL } from './settings.js';
import { errorLine } from './errors.js';

export const MOODS = ['neutral', 'smile', 'shy', 'pout', 'surprised', 'wink', 'smug', 'sad'];
export const VARIANTS = [
    { id: 'neutral', label: '平静', file: 'neutral.webp', mood: 'neutral' },
    { id: 'smile', label: '微笑', file: 'smile.webp', mood: 'smile' },
    { id: 'shy', label: '害羞', file: 'shy.webp', mood: 'shy' },
    { id: 'pout', label: '嘟嘴', file: 'pout.webp', mood: 'pout' },
    { id: 'surprised', label: '惊讶', file: 'surprised.webp', mood: 'surprised' },
    { id: 'wink', label: '眨眼', file: 'wink.webp', mood: 'wink' },
    { id: 'smug', label: '坏笑', file: 'smug.webp', mood: 'smug' },
    { id: 'sad', label: '委屈', file: 'sad.webp', mood: 'sad' },
];
// 0.5.0: the three AI pose sheets (比心 / 抱臂 / 侧坐) were removed — they changed the original outfit. A retry with the
// original full-body art as reference was refused by the image model, so no pose sheet ships; the original layered rig
// (breath, wings, tail, hair, arm swing) provides body motion instead.
export const POSES = [];
// Heuristic mood -> model expression names (Cubism samples use f00…, many community models use words).
const MOOD_HINTS = {
    neutral: /^(f00|normal|neutral|default|idle|平静|普通)/i, smile: /(smile|happy|joy|laugh|f01|f07|笑|开心)/i,
    shy: /(shy|blush|embarrass|f05|害羞|脸红)/i, pout: /(pout|angry|anger|mad|f03|生气|嘟)/i,
    surprised: /(surpris|shock|f06|惊)/i, wink: /(wink|眨眼)/i, smug: /(smug|grin|evil|smirk|f02|坏笑|得意)/i, sad: /(sad|cry|tear|f04|伤心|委屈)/i,
};
export function pickExpression(mood, names, map = {}) {
    if (map[mood] && names.includes(map[mood])) return map[mood];
    const re = MOOD_HINTS[mood]; if (!re) return null;
    return names.find(n => re.test(n)) || null;
}
export function fitModel(box, size, s = {}) {
    // Fit by height (no empty band above or below the portrait), bottom-anchored, centred horizontally.
    const scale = (box.height / size.height) * (Number(s.scale) || 1);
    return { scale, x: box.width / 2 - (size.width * scale) / 2 + (Number(s.x) || 0) * box.width, y: box.height - size.height * scale + (Number(s.y) || 0) * box.height };
}
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
function loadScript(src, attrs = {}) {
    return new Promise((resolve, reject) => {
        const el = document.createElement('script'); el.src = src; el.async = false; Object.assign(el.dataset, attrs);
        el.onload = () => resolve(el); el.onerror = () => reject(Error('脚本加载失败：' + src)); document.head.append(el);
    });
}

export class Portrait {
    constructor(app) { this.app = app; this.mode = 'rig'; this.layer = null; this.l2d = null; this.observer = null; this.mood = 'neutral'; this.disposers = []; this.speakUntil = 0; this.error = ''; }
    get settings() { return this.app.settings; }
    stage() { return this.app.assistant?.shadow?.querySelector('.zt-stage') || null; }
    media() { return this.stage()?.querySelector('.zt-media') || null; }
    describe() { return { rig: '原版分层参数动画', variants: 'AI 差分立绘（交叉淡入 1.0s）', live2d: this.l2d ? '真 Live2D：' + (this.l2d.name || '模型') : '真 Live2D（未加载：' + (this.error || '未配置模型') + '）' }[this.mode] || this.mode; }
    async start() {
        this.disposers.push(this.settings.onChange(k => { if (k === 'portrait' || k === 'live2d') this.applying = this.apply().catch(e => this.fail(e)); }));
        const c = this.app.adapter.context(), speak = () => this.speak();
        for (const key of ['CHARACTER_MESSAGE_RENDERED']) { const e = c.eventTypes[key]; if (e) { c.eventSource.on(e, speak); this.disposers.push(() => c.eventSource.removeListener(e, speak)); } }
        await this.waitForStage();
        const st = this.stage();
        if (st) {
            this.observer = new MutationObserver(() => this.onMood(st.dataset.expression || 'neutral'));
            this.observer.observe(st, { attributes: true, attributeFilter: ['data-expression'] });
        }
        await this.apply();
    }
    async waitForStage() { for (let i = 0; i < 40 && !this.stage(); i++) await new Promise(r => setTimeout(r, 100)); }
    fail(e) { this.error = e.message; console.warn('[诸天立绘]', e); globalThis.toastr?.warning(e.message + '；已回退到原版分层动画。', '诸天 · 立绘'); this.teardown(); this.mode = 'rig'; }
    setMode(mode) { this.settings.patch('portrait', { mode }); }
    async apply() {
        const want = this.settings.get('portrait').mode || 'rig', gen = this.gen = (this.gen || 0) + 1;   // newest apply wins
        this.teardown(); this.mode = want; this.error = '';
        if (!this.media()) { if (want !== 'rig') this.error = '莉莉丝窗口未运行'; return; }
        if (want === 'variants') this.mountVariants();
        else if (want === 'live2d') await this.mountLive2D(gen).catch(e => { if (gen === this.gen) this.fail(e); });
    }
    hideOriginal(hide) {
        const media = this.media(); if (!media) return;
        for (const el of media.querySelectorAll(':scope > img, :scope > canvas')) el.style.visibility = hide ? 'hidden' : '';
    }
    layerBox(cls) {
        const media = this.media(), layer = document.createElement('div');
        layer.className = 'zt-portrait-layer ' + cls;
        layer.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:1;overflow:hidden;';
        const zones = media.querySelector('svg.zt-figure'); media.insertBefore(layer, zones || null);
        return layer;
    }
    // ---------- AI variants ----------
    mountVariants() {
        const p = this.settings.get('portrait'), base = this.app.base + 'assets/lilith/variants/';
        const img0 = this.media().querySelector(':scope > img'), fit = img0 ? getComputedStyle(img0) : null;
        const layer = this.layerBox('zt-variants');
        const style = document.createElement('style');
        style.textContent = `.zt-variants img{position:absolute;inset:0;width:100%;height:100%;object-fit:${fit?.objectFit || 'contain'};object-position:${fit?.objectPosition || '50% 100%'};opacity:0;transition:opacity 1s cubic-bezier(.4,0,.2,1);transform-origin:50% 100%;animation:zt-breathe 3.2345s ease-in-out infinite;will-change:opacity,transform}
.zt-variants img.on{opacity:1}@keyframes zt-breathe{0%,100%{transform:translateY(0) scale(1,1)}50%{transform:translateY(-.25%) scale(1.004,1.008)}}@media (prefers-reduced-motion:reduce){.zt-variants img{animation:none;transition-duration:.2s}}`;
        layer.append(style);
        const pose = POSES.find(x => x.id === p.variant);
        // Pose art is keyed to transparency, so it sits on the original character-free plate. The plate is
        // never animated: the background stays static while only the figure breathes.
        const plate = this.app.original?.ZhuTianLilithLayers?.plate;
        if (pose && plate) {
            const bg = document.createElement('img'); bg.alt = ''; bg.draggable = false; bg.dataset.id = 'plate'; bg.className = 'zt-plate';
            bg.style.animation = 'none'; bg.style.transition = 'opacity 1s'; bg.src = plate; layer.append(bg);
        }
        // Expression set is always present (full-frame art incl. background) so a missing pose file degrades to it.
        const list = pose ? [pose, ...VARIANTS] : VARIANTS;
        for (const v of list) {
            const im = document.createElement('img'); im.alt = ''; im.draggable = false; im.decoding = 'async';
            im.dataset.id = v.id; im.dataset.mood = v.mood || ''; if (v === pose) im.dataset.pose = '1';
            im.onerror = () => { im.dataset.missing = '1'; if (im.classList.contains('on')) this.showVariant(this.mood || 'neutral'); };
            im.src = base + v.file; layer.append(im);
        }
        this.layer = layer; this.pose = pose && plate ? pose.id : null; this.hideOriginal(true);
        this.showVariant(this.pose || (p.autoMood ? this.mood : (VARIANTS.find(v => v.id === p.variant) ? p.variant : 'neutral')));
    }
    showVariant(id) {
        if (!this.layer) return;
        const all = [...this.layer.querySelectorAll('img:not(.zt-plate)')];
        for (const im of all) if (im.dataset.missing) im.classList.remove('on');       // never show a broken-image frame
        const imgs = all.filter(i => !i.dataset.missing);
        // A selected pose stays up while it loads fine; moods only apply to the standard expression set.
        const want = this.pose && imgs.some(i => i.dataset.id === this.pose) ? this.pose : id;
        const target = imgs.find(i => i.dataset.id === want) || imgs.find(i => i.dataset.mood === want) || imgs.find(i => i.dataset.id === 'neutral') || imgs[0];
        for (const im of imgs) im.classList.toggle('on', im === target);   // opacity cross-fade, never a hard swap
        const bg = this.layer.querySelector('img.zt-plate'); if (bg) bg.classList.toggle('on', !!target?.dataset.pose);
        this.layer.dataset.current = target?.dataset.id || '';
    }
    // ---------- Live2D ----------
    async ensureRuntime(coreUrl) {
        if (!globalThis.Live2DCubismCore) await loadScript(coreUrl || LIVE2D_CORE_URL, { zhutianLive2d: 'core' });
        if (!globalThis.Live2DCubismCore) throw Error('Cubism Core 未能初始化');
        if (this.constructor.PIXI) return this.constructor.PIXI;
        const previous = globalThis.PIXI;                       // do not clobber another extension's PixiJS
        if (previous && !String(previous.VERSION || '').startsWith('6.')) delete globalThis.PIXI;
        await loadScript(this.app.base + 'vendor/live2d/pixi.min.js', { zhutianLive2d: 'pixi' });
        await loadScript(this.app.base + 'vendor/live2d/cubism4.min.js', { zhutianLive2d: 'framework' });
        const ours = globalThis.PIXI;
        if (!ours?.live2d?.Live2DModel) throw Error('Live2D 框架未能加载');
        if (previous && previous !== ours) globalThis.PIXI = previous;
        this.constructor.PIXI = ours; return ours;
    }
    async mountLive2D(gen = this.gen) {
        const s = this.settings.get('live2d');
        if (!s.accepted) throw Error('尚未同意 Live2D Proprietary Software License（Cubism Core）');
        if (!s.model) throw Error('尚未设置 .model3.json 地址');
        const PIXI = await this.ensureRuntime(s.coreUrl);
        if (gen !== this.gen) return;                                // a newer apply started while the runtime loaded
        const layer = this.layerBox('zt-live2d'); layer.style.pointerEvents = 'auto'; this.layer = layer;
        const canvas = document.createElement('canvas'); canvas.style.cssText = 'width:100%;height:100%;display:block'; layer.append(canvas);
        const box = () => ({ width: Math.max(1, layer.clientWidth), height: Math.max(1, layer.clientHeight) });
        const app = new PIXI.Application({ view: canvas, backgroundAlpha: 0, antialias: true, autoDensity: true, resolution: Math.min(2, devicePixelRatio || 1), width: box().width, height: box().height });
        let model;
        try { model = await PIXI.live2d.Live2DModel.from(s.model, { autoInteract: false, autoUpdate: true }); }
        catch (e) { app.destroy(true); layer.remove(); this.layer = null; throw Error('模型加载失败：' + (e?.message || e)); }
        if (gen !== this.gen || this.layer !== layer) { model.destroy(); app.destroy(true); if (this.layer === layer) { layer.remove(); this.layer = null; } else layer.remove(); return; }
        app.stage.addChild(model);
        const natural = { width: model.width / model.scale.x, height: model.height / model.scale.y };
        const layout = () => { const b = box(); app.renderer.resize(b.width, b.height); const f = fitModel(b, natural, s); model.scale.set(f.scale); model.position.set(f.x, f.y); };
        layout(); const ro = new ResizeObserver(layout); ro.observe(layer);
        const internal = model.internalModel, core = internal.coreModel;
        const expressions = (internal.settings?.expressions || []).map(e => e.Name ?? e.name).filter(Boolean);
        const groups = Object.keys(internal.settings?.motions || {});
        const hitNames = (internal.settings?.hitAreas || []).map(h => h.Name ?? h.name);
        // Motions load lazily; the first motion() call while loading only reserves and returns false. Preload taps.
        const mm = internal.motionManager;
        for (const g of groups.filter(g => !/idle/i.test(g))) (mm.definitions?.[g] || []).forEach((_, i) => { try { mm.loadMotion?.(g, i)?.catch?.(() => {}); } catch { /* optional */ } });
        const play = async group => { if (await model.motion(group, undefined, 3)) return true; await new Promise(r => setTimeout(r, 180)); return model.motion(group, undefined, 3); };
        // Lip sync: ST TTS audio when available, otherwise a text-length envelope while the story voice box speaks.
        let mouth = 0, analyser = null, buf = null;
        const onUpdate = () => {
            let target = 0;
            if (analyser) { analyser.getByteTimeDomainData(buf); let sum = 0; for (const v of buf) { const d = (v - 128) / 128; sum += d * d; } target = Math.min(1, Math.sqrt(sum / buf.length) * 6); }
            if (!target && s.lipsync && performance.now() < this.speakUntil) target = 0.35 + 0.35 * Math.abs(Math.sin(performance.now() / 95)) * (0.6 + 0.4 * Math.sin(performance.now() / 37));
            mouth += (target - mouth) * 0.35;
            if (mouth > 0.01) try { core.setParameterValueById('ParamMouthOpenY', mouth); } catch { /* model without mouth param */ }
        };
        internal.on('beforeModelUpdate', onUpdate);
        const tts = document.getElementById('tts_audio');
        const hookTts = () => { if (analyser || !tts || !s.lipsync) return; try { const ac = new AudioContext(), src = ac.createMediaElementSource(tts); analyser = ac.createAnalyser(); analyser.fftSize = 512; buf = new Uint8Array(analyser.fftSize); src.connect(analyser); analyser.connect(ac.destination); } catch { analyser = null; } };
        tts?.addEventListener('play', hookTts);
        // Gaze follows the pointer (Cubism focus controller), taps use the model's own hit areas.
        const move = e => { if (!s.follow) return; const r = canvas.getBoundingClientRect(); model.focus(e.clientX - r.left, e.clientY - r.top); };
        const tap = e => {
            const r = canvas.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top, hits = model.hitTest(x, y);
            const name = hits[0]; if (!name) return;
            const group = groups.find(g => g.toLowerCase() === ('tap' + name).toLowerCase()) || groups.find(g => /tap/i.test(g));
            if (group) play(group).catch(() => {});
            const zone = /head|face|hair/i.test(name) ? 'cheek' : /body|chest/i.test(name) ? 'chest' : 'arm';
            this.playReaction(zone);
            this.bubble(zone, x, y);
        };
        window.addEventListener('pointermove', move, { passive: true }); canvas.addEventListener('pointerdown', tap);
        this.l2d = { app, model, ro, expressions, groups, hitNames, name: String(s.model).split('/').pop(), off: () => { window.removeEventListener('pointermove', move); canvas.removeEventListener('pointerdown', tap); tts?.removeEventListener('play', hookTts); internal.off?.('beforeModelUpdate', onUpdate); } };
        this.hideOriginal(true);
        layer.dataset.expressions = expressions.join(','); layer.dataset.groups = groups.join(','); layer.dataset.ready = '1';
        this.onMood(this.mood);
    }
    bubble(zone, x, y) {
        const lines = this.app.original.ZhuTianLilithMotion.LINES?.[zone]; if (!lines?.length || !this.layer) return;
        const b = document.createElement('div'); b.className = 'zt-l2d-bubble'; b.textContent = lines[Math.floor(Math.random() * lines.length)];
        b.style.cssText = `position:absolute;left:${Math.max(8, Math.min(x - 90, this.layer.clientWidth - 188))}px;top:${Math.max(8, y - 70)}px;max-width:180px;padding:8px 11px;border-radius:14px;background:rgba(32,20,42,.9);color:#f6e9fb;font:13px/1.5 system-ui;border:1px solid #c89bd655;pointer-events:none;opacity:0;transition:opacity .35s`;
        this.layer.append(b); requestAnimationFrame(() => { b.style.opacity = '1'; });
        setTimeout(() => { b.style.opacity = '0'; setTimeout(() => b.remove(), 400); }, 2600);
    }
    /** Same face timeline the original rig plays for a part tap (e.g. surprised → pout → neutral), not just its last frame. */
    playReaction(zone) {
        const face = this.app.original.ZhuTianLilithMotion.REACTIONS?.[zone]?.face || [];
        (this.faceTimers || []).forEach(clearTimeout); this.faceTimers = [];
        let at = 0;
        for (const [name, ms] of face) { const t = at; this.faceTimers.push(setTimeout(() => this.onMood(name), t)); at += Number(ms) || 0; }
        this.faceTimers.push(setTimeout(() => this.onMood(this.stage()?.dataset.expression || 'neutral'), at || 2600));
        this.lastReaction = face.map(f => f[0]);
    }
    speak() { const last = this.app.adapter.context().chat?.at(-1); if (!last || last.is_user) return; this.speakUntil = performance.now() + Math.min(7000, 900 + String(last.mes || '').length * 45); }
    onMood(mood, hold = 0) {
        this.mood = MOODS.includes(mood) ? mood : (mood || 'neutral');
        if (this.mode === 'variants' && this.settings.get('portrait').autoMood) this.showVariant(this.mood);
        if (this.mode === 'live2d' && this.l2d) {
            const name = pickExpression(this.mood, this.l2d.expressions, this.settings.get('live2d').moodMap || {});
            if (name) this.l2d.model.expression(name); else if (this.mood === 'neutral') this.l2d.model.internalModel.motionManager.expressionManager?.resetExpression?.();
        }
        clearTimeout(this.holdTimer); if (hold) this.holdTimer = setTimeout(() => this.onMood(this.stage()?.dataset.expression || 'neutral'), hold);
    }
    teardown() {
        if (this.l2d) { try { this.l2d.off(); this.l2d.ro.disconnect(); this.l2d.app.destroy(true, { children: true, texture: true, baseTexture: true }); } catch (e) { console.warn(e); } this.l2d = null; }
        this.layer?.remove(); this.layer = null; this.hideOriginal(false);
    }
    // ---------- settings UI ----------
    openSettings() {
        const f = this.app.features, s = this.settings.get('live2d'), p = this.settings.get('portrait');
        const el = f.popup(`<h3>莉莉丝立绘 · 真 Live2D / AI 差分</h3>
<p><label>模式 <select data-f="mode" class="text_pole"><option value="rig">原版分层参数动画</option><option value="variants">AI 差分立绘</option><option value="live2d">真 Live2D</option></select></label></p>
<fieldset><legend>AI 差分立绘</legend><label>姿势 <select data-f="variant" class="text_pole"><option value="default">标准站姿（表情随语气自动切换）</option>${POSES.map(x => `<option value="${x.id}">${x.label}${x.pending ? '（素材待补，暂回落标准站姿）' : ''}</option>`).join('')}</select></label>
<label class="checkbox_label"><input type="checkbox" data-f="autoMood"> 表情跟随原版语气/点触</label></fieldset>
<fieldset><legend>真 Live2D（Cubism 3/4/5）</legend>
<p class="zt-note">Live2D 需要两样东西：<b>Cubism Core</b>（Live2D 公司的专有运行库，按其许可证不随扩展分发）与<b>绑定好的模型</b>（.model3.json + .moc3 + 贴图，必须在 Cubism Editor 中制作；程序无法凭空生成 .moc3）。把模型文件夹放进酒馆的 <code>data/&lt;用户&gt;/user/files/</code> 后填 <code>/user/files/…/xxx.model3.json</code>。</p>
<label class="checkbox_label"><input type="checkbox" data-f="accepted"> 我已阅读并同意 <a href="https://www.live2d.com/eula/live2d-proprietary-software-license-agreement_en.html" target="_blank" rel="noopener">Live2D Proprietary Software License</a>（Cubism Core）</label>
<label>Cubism Core 地址 <input data-f="coreUrl" class="text_pole" placeholder="${LIVE2D_CORE_URL}"></label>
<label>模型 .model3.json 地址 <input data-f="model" class="text_pole" placeholder="/user/files/lilith/lilith.model3.json"></label>
<label>缩放 <input type="number" step="0.05" min="0.2" max="4" data-f="scale" class="text_pole"></label> <label>水平偏移 <input type="number" step="0.02" min="-1" max="1" data-f="x" class="text_pole"></label> <label>垂直偏移 <input type="number" step="0.02" min="-1" max="1" data-f="y" class="text_pole"></label>
<label class="checkbox_label"><input type="checkbox" data-f="follow"> 视线跟随鼠标</label> <label class="checkbox_label"><input type="checkbox" data-f="lipsync"> 口型同步（TTS 音量或文字节奏）</label>
<div class="zt-moodmap"></div>
<div class="zt-popup-actions"><div class="menu_button" data-l2d="apply">应用并加载</div><div class="menu_button" data-l2d="psd">导出莉莉丝分层 PSD（供 Cubism Editor 绑定）</div></div>
<p class="zt-out"></p></fieldset>`, true);
        const vals = { mode: p.mode, variant: p.variant, autoMood: p.autoMood, ...s };
        for (const input of el.querySelectorAll('[data-f]')) { const k = input.dataset.f; if (input.type === 'checkbox') input.checked = !!vals[k]; else input.value = vals[k] ?? ''; }
        const out = el.querySelector('.zt-out');
        this.renderMoodMap(el);
        el.addEventListener('change', e => {
            const mood = e.target.closest('[data-mood-map]')?.dataset.moodMap;
            if (mood) {   // stored without a settings event: remapping must not reload the model
                const all = this.settings.all, map = { ...(all.live2d.moodMap || {}) };
                if (e.target.value) map[mood] = e.target.value; else delete map[mood];
                all.live2d.moodMap = map; this.settings.save();
                if (this.l2d && e.target.value) this.l2d.model.expression(e.target.value);
                return;
            }
            const input = e.target.closest('[data-f]'); if (!input) return; const k = input.dataset.f;
            const v = input.type === 'checkbox' ? input.checked : input.type === 'number' ? Number(input.value) : input.value.trim();
            if (['mode', 'variant', 'autoMood'].includes(k)) this.settings.patch('portrait', { [k]: v }); else this.settings.patch('live2d', { [k]: v });
        });
        el.addEventListener('click', async e => {
            const act = e.target.closest('[data-l2d]')?.dataset.l2d; if (!act) return;
            try {
                if (act === 'apply') { this.settings.patch('portrait', { mode: 'live2d' }); await this.applying; this.renderMoodMap(el); out.textContent = this.l2d ? `已加载：表情 ${this.l2d.expressions.length} 个（${this.l2d.expressions.join('、') || '无'}）；动作组 ${this.l2d.groups.join('、') || '无'}；点触区域 ${this.l2d.hitNames.join('、') || '无'}。` : '未加载：' + this.error; }
                if (act === 'psd') { const { exportLayeredPsd } = await import('./psd-export.js'); const n = await exportLayeredPsd(this.app.original, this.app.base); out.textContent = `已导出 ${n} 个图层的 PSD。用 Cubism Editor 打开后即可切 ArtMesh、绑定参数，导出 .model3.json 再填回上面。`; }
            } catch (err) { out.textContent = '未完成：' + errorLine(err); }
        });
    }
    /** Mood → expression table for models whose expression names are opaque (f00…f07) or in another language. */
    renderMoodMap(el) {
        const box = el?.querySelector('.zt-moodmap'); if (!box) return;
        if (!this.l2d) { box.innerHTML = '<p class="zt-note">加载模型后，这里会列出它的全部表情，可逐个指定莉莉丝的 8 种语气对应哪个表情。</p>'; return; }
        const names = this.l2d.expressions, map = this.settings.get('live2d').moodMap || {};
        const auto = m => pickExpression(m, names, {});
        const label = m => VARIANTS.find(v => v.mood === m)?.label || m;
        const unmatched = MOODS.filter(m => !map[m] && !auto(m)).length;
        box.innerHTML = `<h4>表情映射</h4><p class="zt-note">${unmatched ? `有 ${unmatched} 种语气无法按表情名自动识别（模型表情名：${names.map(esc).join('、') || '无'}），请手动指定；选中即在模型上预览。` : '全部语气都已对应到模型表情。'}</p>
<table class="zt-table"><tr><th>语气</th><th>模型表情</th></tr>${MOODS.map(m => `<tr><td>${label(m)}</td><td><select class="text_pole" data-mood-map="${m}"><option value="">${auto(m) ? '自动：' + esc(auto(m)) : '不切换'}</option>${names.map(n => `<option value="${esc(n)}"${map[m] === n ? ' selected' : ''}>${esc(n)}</option>`).join('')}</select></td></tr>`).join('')}</table>`;
    }
    dispose() { (this.faceTimers || []).forEach(clearTimeout); clearTimeout(this.holdTimer); this.observer?.disconnect(); this.disposers.splice(0).forEach(f => f()); this.teardown(); }
}

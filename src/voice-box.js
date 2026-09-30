// 莉莉丝专属语音框 (Lilith voice box) — native replacement for the v1.1 regex script
// "莉莉丝专属语音框" (id bd2a75db-7ddd-4311-9f5b-db21afec623a, placement AI output, markdownOnly).
// The match pattern below is the original findRegex, byte for byte; cue = $1$2$4 and text = $3$5 exactly like the
// original replaceString. The card is the same markup the regex produced; the original ZhuTianLilithVoice.decorate()
// (v1.7.1) then adds the tone avatar and removes the mood word, so the look is identical to the old install.
// Differences: it is a setting (可开关) instead of a regex, and it works without the Lilith window being enabled.

export const VOICE_SOURCE = "(?:(?:\\*\\*)?(?:【[ \\t]*莉莉[丝絲][ \\t]*】|\\[[ \\t]*莉莉[丝絲][ \\t]*\\]|莉莉[丝絲]|Lilith)(?:\\*\\*)?(?:[ \\t]*[（(]([^）)\\n:：\"<>]{1,12})[）)])?[ \\t]*[:：][ \\t]*(?:\\*\\*)?[ \\t]*|莉莉[丝絲](轻声|笑着|微笑着|轻笑着?|低声|柔声|小声|害羞地|红着脸|惊讶地|得意地|坏笑着|嘟着嘴|哼了一声|眨眨眼|俏皮地)?(?:说|道|回应|回答)[：:][ \\t]*)[“\"「『]((?:(?!\\r?\\n[ \\t]*(?:【[^】\\n]{1,30}】|\\[[^\\]\\n]{1,30}\\]|[^\\s：:<>\\n]{1,20})[ \\t]*[:：])[^<>]){1,8000}?)[”\"」』](?=[ \\t]*(?:\\r?\\n|$|<|【莉莉[丝絲]】))|^[ \\t]*(?:>[ \\t]*)?(?:\\*\\*)?(?:【[ \\t]*莉莉[丝絲][ \\t]*】|\\[[ \\t]*莉莉[丝絲][ \\t]*\\]|莉莉[丝絲]|Lilith)(?:\\*\\*)?(?:[ \\t]*[（(]([^）)\\n:：\"<>]{1,12})[）)])?[ \\t]*[:：][ \\t]*(?:\\*\\*)?[ \\t]*([^\\r\\n<>]{1,4000})";
export const VOICE_FLAGS = 'gmi';
export const LEGACY_VOICE_ID = 'bd2a75db-7ddd-4311-9f5b-db21afec623a';
export const voiceRegex = () => new RegExp(VOICE_SOURCE, VOICE_FLAGS);
export const VOICE_SLOT = i => `ZTVOICESLOT${i}ZT`;

/** Replaces every voice line with a slot token. Returns the new source text and the extracted voices. */
export function extractVoices(text) {
    const voices = [];
    const out = String(text ?? '').replace(voiceRegex(), (_m, g1, g2, g3, g4, g5) => {
        const cue = (g1 || '') + (g2 || '') + (g4 || ''), body = (g3 || '') + (g5 || '');
        voices.push({ cue, text: body });
        return VOICE_SLOT(voices.length - 1);
    });
    return { text: out, voices };
}
export function hasVoice(text) { return voiceRegex().test(String(text ?? '')); }

// Styles of the original regex card (identical to ZhuTianLilithVoice.cardStyle/labelStyle/avatarStyle).
const CARD = "display:block;position:relative;box-sizing:border-box;width:100%;max-width:760px;margin:14px 0;padding:16px 19px;border:1px solid rgba(198,168,217,.30);border-left:2px solid #c4a0d6;border-radius:4px 18px 18px 18px;background:linear-gradient(125deg,#2c2038,#19151f);color:#eee5f5;box-shadow:0 8px 25px #10081725;font:14px/1.9 system-ui,'Microsoft YaHei',sans-serif;overflow-wrap:anywhere;min-width:0;text-align:left;";
const HEAD = 'display:flex;align-items:center;gap:11px;margin-bottom:10px;line-height:1.35;';
const AVATAR = 'flex:none;width:46px;height:46px;border-radius:50%;box-sizing:border-box;border:1.5px solid #c4a0d6aa;background:radial-gradient(circle at 35% 30%,#5b4270,#241a2e);background-size:cover;background-position:center;box-shadow:0 0 0 3px #1a121f,0 4px 14px #0008;display:inline-flex;align-items:center;justify-content:center;color:#e9d3f5;font-size:16px;overflow:hidden;';
const TEXT = 'display:block;white-space:pre-wrap;overflow-wrap:anywhere;color:inherit;letter-spacing:.2px';

const esc = s => String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
/** Inline markdown the regex output used to get from showdown: **bold**, *italic*, `code`. Nothing else, no HTML. */
export function inlineMarkdown(s) {
    return esc(s).replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>').replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>').replace(/`([^`\n]+)`/g, '<code>$1</code>');
}
export function buildVoiceCard(doc, { cue, text }, voice) {
    const box = doc.createElement('span');
    box.className = 'zt-lilith-voice'; box.dataset.lilithVoice = '1'; box.dataset.ztNative = '1';
    if (cue) box.dataset.lilithCue = String(cue).slice(0, 24);
    box.setAttribute('style', voice?.cardStyle || CARD);
    const head = doc.createElement('span'); head.dataset.lilithHead = '1'; head.setAttribute('style', voice?.labelStyle || HEAD);
    const avatar = doc.createElement('span'); avatar.dataset.lilithAvatar = '1'; avatar.setAttribute('style', voice?.avatarStyle || AVATAR); avatar.textContent = '✧';
    const names = doc.createElement('span'); names.setAttribute('style', 'display:flex;flex-direction:column;min-width:0;');
    const name = doc.createElement('span'); name.setAttribute('style', 'color:#e3c7f0;font-size:13px;font-weight:600;letter-spacing:3px;'); name.textContent = '莉莉丝 ';
    const en = doc.createElement('span'); en.setAttribute('style', 'font-size:9px;color:#aa91b8;letter-spacing:2px;font-weight:400;'); en.textContent = 'LILITH';
    name.append(en); names.append(name); head.append(avatar, names);
    const body = doc.createElement('span'); body.dataset.lilithText = '1'; body.setAttribute('style', TEXT);
    body.innerHTML = inlineMarkdown(String(text ?? '').replace(/^\s+|\s+$/g, ''));
    box.append(head, body);
    // Original 1.7.x presentation: tone avatar (expression crop) + tone border colour, no mood word.
    try { voice?.decorate?.(box, voice.avatars); } catch { /* plain card still fine */ }
    return box;
}

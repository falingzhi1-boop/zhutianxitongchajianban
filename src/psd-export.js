// Exports the original layered Lilith art as a real layered PSD (RGB 8-bit, raw channels, Unicode layer names) so it can be
// opened in Live2D Cubism Editor, cut into ArtMeshes and rigged into a genuine .moc3 model. Pure browser code, no deps.
const loadImage = src => new Promise((resolve, reject) => { const im = new Image(); im.onload = () => resolve(im); im.onerror = () => reject(Error('图层解码失败')); im.src = src; });

function trimmed(canvas) {
    const ctx = canvas.getContext('2d'), { width: w, height: h } = canvas, data = ctx.getImageData(0, 0, w, h).data;
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (data[(y * w + x) * 4 + 3]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    if (x1 < 0) return null;
    return { left: x0, top: y0, right: x1 + 1, bottom: y1 + 1, pixels: ctx.getImageData(x0, y0, x1 + 1 - x0, y1 + 1 - y0).data };
}
class Writer {
    constructor() { this.parts = []; this.size = 0; }
    bytes(b) { this.parts.push(b); this.size += b.length; }
    u8(v) { this.bytes(Uint8Array.of(v)); }
    u16(v) { const b = new Uint8Array(2); new DataView(b.buffer).setUint16(0, v); this.bytes(b); }
    i16(v) { const b = new Uint8Array(2); new DataView(b.buffer).setInt16(0, v); this.bytes(b); }
    u32(v) { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, v); this.bytes(b); }
    i32(v) { const b = new Uint8Array(4); new DataView(b.buffer).setInt32(0, v); this.bytes(b); }
    ascii(s) { this.bytes(new TextEncoder().encode(s)); }
    blob() { return new Blob(this.parts, { type: 'image/vnd.adobe.photoshop' }); }
}
function planes(pixels, w, h) {
    const out = [new Uint8Array(w * h), new Uint8Array(w * h), new Uint8Array(w * h), new Uint8Array(w * h)];
    for (let i = 0; i < w * h; i++) { out[0][i] = pixels[i * 4 + 3]; out[1][i] = pixels[i * 4]; out[2][i] = pixels[i * 4 + 1]; out[3][i] = pixels[i * 4 + 2]; }
    return out; // alpha, R, G, B  (channel ids -1, 0, 1, 2)
}
/** layers: [{name, left, top, right, bottom, pixels(RGBA), hidden}] bottom-to-top. */
export function encodePsd(width, height, layers, composite) {
    const records = new Writer(), channelData = new Writer();
    for (const L of layers) {
        const w = L.right - L.left, h = L.bottom - L.top, ch = planes(L.pixels, w, h);
        records.i32(L.top); records.i32(L.left); records.i32(L.bottom); records.i32(L.right);
        records.u16(4); for (const id of [-1, 0, 1, 2]) { records.i16(id); records.u32(2 + w * h); }
        records.ascii('8BIM'); records.ascii('norm'); records.u8(255); records.u8(0); records.u8(L.hidden ? 0x02 : 0x00); records.u8(0);
        const extra = new Writer();
        extra.u32(0); extra.u32(0);
        const ascii = L.name.replace(/[^\x20-\x7e]/g, '_').slice(0, 255) || 'layer';
        const padLen = (4 - ((ascii.length + 1) % 4)) % 4;
        extra.u8(ascii.length); extra.ascii(ascii); for (let i = 0; i < padLen; i++) extra.u8(0);
        const units = [...L.name].flatMap(c => { const cp = c.codePointAt(0); return cp > 0xffff ? [0xd800 + ((cp - 0x10000) >> 10), 0xdc00 + ((cp - 0x10000) & 0x3ff)] : [cp]; });
        const luniLen = 4 + units.length * 2 + (units.length % 2 ? 2 : 0);
        extra.ascii('8BIM'); extra.ascii('luni'); extra.u32(luniLen); extra.u32(units.length); for (const u of units) extra.u16(u); if (units.length % 2) extra.u16(0);
        records.u32(extra.size); for (const p of extra.parts) records.bytes(p);
        for (const plane of ch) { channelData.u16(0); channelData.bytes(plane); }
    }
    let layerInfoLen = 2 + records.size + channelData.size; const pad = layerInfoLen % 2; layerInfoLen += pad;
    const out = new Writer();
    out.ascii('8BPS'); out.u16(1); out.bytes(new Uint8Array(6)); out.u16(4); out.u32(height); out.u32(width); out.u16(8); out.u16(3);
    out.u32(0); out.u32(0);
    out.u32(4 + layerInfoLen + 4); out.u32(layerInfoLen); out.i16(-layers.length);
    for (const p of records.parts) out.bytes(p); for (const p of channelData.parts) out.bytes(p); if (pad) out.u8(0);
    out.u32(0);
    out.u16(0); const cp = planes(composite, width, height); for (const i of [1, 2, 3, 0]) out.bytes(cp[i]);
    return out.blob();
}
export async function buildLayers(original) {
    const data = original.ZhuTianLilithLayers; if (!data) throw Error('原版分层素材缺失');
    const [W, H] = data.size, canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const layer = async (name, src, clip, hidden = false, rect = null) => {
        ctx.clearRect(0, 0, W, H); const im = await loadImage(src);
        ctx.save(); if (clip) { ctx.beginPath(); ctx.rect(clip[0], clip[1], clip[2] - clip[0], clip[3] - clip[1]); ctx.clip(); }
        if (rect) ctx.drawImage(im, rect[0], rect[1], rect[2], rect[3]); else ctx.drawImage(im, 0, 0, W, H);
        ctx.restore(); const t = trimmed(canvas); return t ? { name, hidden, ...t } : null;
    };
    // boxes are in logical portrait units (424×632) while the layer art is data.size (636×948): scale the clips.
    const [LW, LH] = data.logical || data.size, sx = W / LW, sy = H / LH;
    const b = Object.fromEntries(Object.entries(data.boxes || {}).map(([k, [x0, y0, x1, y1]]) => [k, [x0 * sx, y0 * sy, x1 * sx, y1 * sy]])), out = [];
    out.push(await layer('背景（静止）', data.plate));
    out.push(await layer('左翼', data.wings, b.wingL)); out.push(await layer('右翼', data.wings, b.wingR));
    out.push(await layer('尾巴', data.tail)); out.push(await layer('身体', data.body));
    for (const [name, face] of Object.entries(data.faces || {})) out.push(await layer('表情_' + name, face.src, null, true, face.rect));
    ctx.clearRect(0, 0, W, H);
    for (const L of out.filter(x => x && !x.hidden)) { const id = new ImageData(new Uint8ClampedArray(L.pixels), L.right - L.left, L.bottom - L.top); const c2 = document.createElement('canvas'); c2.width = id.width; c2.height = id.height; c2.getContext('2d').putImageData(id, 0, 0); ctx.drawImage(c2, L.left, L.top); }
    return { W, H, layers: out.filter(Boolean), composite: ctx.getImageData(0, 0, W, H).data };
}
export async function exportLayeredPsd(original) {
    const { W, H, layers, composite } = await buildLayers(original);
    const blob = encodePsd(W, H, layers, composite), url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = '莉莉丝-分层-用于CubismEditor.psd'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 2000);
    return layers.length;
}

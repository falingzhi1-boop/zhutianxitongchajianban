// 0.8.4 — streamed chat completions, returned as one ordinary (non-stream) OpenAI response.
//
// Why: long non-stream requests (莉莉丝私聊 with 附带当前剧情, memory, status-bar AI) send nothing back until the whole
// answer is ready. Reverse proxies / tunnels in front of SillyTavern or the provider (cloudflare, nginx, phone hotspots)
// cut an idle connection after ~60–100 s, and SillyTavern's own relay answers 502 when its upstream request dies.
// Asking for `stream: true` keeps bytes flowing the whole time; the caller still receives a normal JSON response, so the
// original Lilith code (which only understands non-stream JSON) is unchanged.
//
// Pure helpers (no DOM); fetch is passed in so the same code runs for the direct path and the SillyTavern relay.

/** Parses an OpenAI-compatible SSE body (string) into { content, reasoning, finish, model, id, error }. */
export function parseSse(text) {
    const out = { content: '', reasoning: '', finish: null, model: '', id: '', error: null, chunks: 0 };
    for (const raw of String(text ?? '').split(/\r?\n/)) {
        const line = raw.trim();
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (!data || data === '[DONE]') continue;
        let j; try { j = JSON.parse(data); } catch { continue; }
        out.chunks++;
        if (j?.error) { out.error = j.error; continue; }
        if (j?.model && !out.model) out.model = j.model;
        if (j?.id && !out.id) out.id = j.id;
        const c = j?.choices?.[0]; if (!c) continue;
        const d = c.delta || c.message || {};
        if (typeof d.content === 'string') out.content += d.content;
        else if (Array.isArray(d.content)) out.content += d.content.map(p => p?.text || '').join('');
        else if (typeof c.text === 'string') out.content += c.text;
        const r = d.reasoning_content ?? d.reasoning; if (typeof r === 'string') out.reasoning += r;
        if (c.finish_reason) out.finish = c.finish_reason;
    }
    return out;
}

/** The parsed stream as the non-stream JSON body the original code expects. */
export function toCompletion(p, model = '') {
    return { zt_reasoning_present: !!p.reasoning, id: p.id || 'zt-stream', object: 'chat.completion', model: p.model || model,
        choices: [{ index: 0, finish_reason: p.finish || 'stop', message: { role: 'assistant', content: p.content } }] };
}

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** Reads a whole body as text with a size cap (default 4 MB; an SSE stream is much larger than its text). */
async function readText(response, cap = 4_000_000) {
    if (!response.body?.getReader) return response.text();
    const reader = response.body.getReader(), dec = new TextDecoder(); let s = '', size = 0;
    try {
        while (true) {
            const x = await reader.read(); if (x.done) break;
            size += x.value.byteLength; if (size > cap) { await reader.cancel().catch(() => {}); throw Error('响应过大'); }
            s += dec.decode(x.value, { stream: true });
        }
    } finally { try { reader.releaseLock(); } catch { /* already released */ } }
    return s + dec.decode();
}

/** Short readable reason from an error body (JSON {error:{message}} / {error:"…"} / {message} / text). */
export function errorText(text, status) {
    let msg = '';
    try { const j = JSON.parse(text); const e = j?.error; msg = typeof e === 'string' ? e : (e?.message || j?.message || j?.detail || ''); } catch { msg = String(text || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(); }
    if (typeof msg !== 'string') msg = JSON.stringify(msg);
    msg = msg.slice(0, 220);
    const hint = { 401: 'Key 无效或缺失', 403: '没有权限（Key/分组/地区）', 404: '地址或模型不存在（检查是否少了 /v1）', 413: '请求太大', 429: '请求过于频繁或余额不足', 500: '服务商内部错误', 502: '网关错误：上游断开或超时', 503: '服务暂不可用', 504: '网关超时', 524: '代理等待超时' }[status] || '';
    return [hint, msg].filter(Boolean).join(' · ') || ('HTTP ' + status);
}

/**
 * POST a chat completion with `stream: true` and resolve to a non-stream Response.
 *   send(bodyObject) → Promise<Response>      (direct fetch, or the SillyTavern relay)
 * Behaviour:
 *   - SSE reply → parsed and returned as { choices:[{ message:{ content }, finish_reason }] } (HTTP 200)
 *   - JSON reply (provider ignored stream) → passed through unchanged
 *   - HTTP error → same status, body { error:{ message } } with a readable reason
 *   - a provider that rejects streaming (400/415/422 mentioning stream) → retried once without stream
 *   - in-stream error event and no text → HTTP 502 { error }
 * Network errors and aborts are thrown to the caller (it decides between relay and "cancelled").
 */
export async function streamedCompletion(send, body) {
    const want = { ...body, stream: true };
    let r = await send(want);
    if (!r.ok && [400, 415, 422].includes(r.status)) {
        const t = await r.text().catch(() => '');
        if (/stream/i.test(t)) r = await send({ ...body, stream: false });
        else return json({ error: { message: errorText(t, r.status) } }, r.status);
    }
    if (!r.ok) { const t = await r.text().catch(() => ''); return json({ error: { message: errorText(t, r.status) } }, r.status); }
    const type = String(r.headers.get('content-type') || '');
    const text = await readText(r);
    if (!/event-stream/i.test(type) && !/^\s*data:/m.test(text)) {
        // not a stream: pass JSON through (SillyTavern relay non-stream errors arrive as HTTP 200 + {error})
        let j = null; try { j = JSON.parse(text); } catch { return json({ error: { message: '接口返回的不是 JSON：' + text.slice(0, 120) } }, 502); }
        if (j?.error && !j?.choices) return json({ error: { message: errorText(text, 502) } }, 502);
        return json(j);
    }
    const p = parseSse(text);
    if (p.error && !p.content) return json({ error: { message: errorText(JSON.stringify({ error: p.error }), 502) } }, 502);
    if (!p.chunks) return json({ error: { message: '流式响应为空（上游提前断开）' } }, 502);
    return json(toCompletion(p, body.model));
}

/** Toast + console for API failures the original UI can only show as a bare status code. */
export function reportApiError(where, message) {
    console.warn('[诸天 · API]', where, message);
    try { globalThis.toastr?.error?.(String(message), '诸天 · ' + where, { timeOut: 9000 }); } catch { /* no toastr */ }
}

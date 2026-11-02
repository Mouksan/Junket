// Junket — запрос к модели для интервью.
// Порт из Koma (а там — из DS Comments): профиль подключения таверны
// или свой OpenAI-совместимый адрес напрямую, плюс джейлбрейк.

import { ctx, getSettings, substitute } from './store.js';

// Запрос не потоковый, так что это потолок на весь ответ целиком.
const CUSTOM_TIMEOUT_MS = 300_000;
// Что уходит в reasoning_effort при «Размышления: минимум». 'low' понимают
// почти все OpenAI-совместимые прокси; 'minimal' — только часть моделей.
const CUSTOM_REASONING_MIN = 'low';

/**
 * Отправляет запрос выбранной модели и возвращает текст ответа.
 * instruction — системная инструкция, contextText — всё, что модель должна знать.
 */
export async function requestModel({ instruction, contextText }, signal) {
    const settings = getSettings();
    const maxTokens = Number(settings.maxTokens) || 6000;

    // Джейлбрейк: одна из трёх позиций, как в Koma.
    let prefill = '';
    const jailbreak = settings.jailbreakEnabled ? substitute(String(settings.jailbreakText || '').trim()) : '';
    if (jailbreak) {
        if (settings.jailbreakRole === 'user') contextText = `${jailbreak}\n\n${contextText}`;
        else if (settings.jailbreakRole === 'assistant') prefill = jailbreak;
        else instruction = `${instruction}\n\n${jailbreak}`;
    }

    let raw;
    if (settings.promptSource === 'custom') {
        raw = await requestCustomEndpoint({ instruction, contextText, prefill, maxTokens }, signal);
    } else if (settings.profileId) {
        const messages = [
            { role: 'system', content: instruction },
            { role: 'user', content: contextText },
        ];
        if (prefill) messages.push({ role: 'assistant', content: prefill });
        // includePreset: false — ролевой пресет профиля притащил бы свой системный промпт.
        // Веб-поиск служебному запросу не нужен: с ним Claude может уйти гуглить и вернуть пустоту.
        const overridePayload = { enable_web_search: false };
        if (settings.reasoningEffort && settings.reasoningEffort !== 'auto') {
            overridePayload.reasoning_effort = settings.reasoningEffort;
        }
        const result = await ctx().ConnectionManagerRequestService.sendRequest(
            settings.profileId,
            messages,
            maxTokens,
            { includePreset: false, extractData: true, signal },
            overridePayload,
        );
        raw = String(result?.content ?? result ?? '');
    } else {
        // Профиль не выбран — текущее подключение таверны.
        const result = await ctx().generateRaw({
            prompt: [{ role: 'user', content: contextText }],
            systemPrompt: instruction,
            responseLength: maxTokens,
            prefill,
        });
        raw = typeof result === 'string' ? result : String(result?.content || result?.text || result || '');
    }

    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    return stripPreamble(raw);
}

// ---------- Напрямую: свой OpenAI-совместимый адрес ----------

/** Адрес как в комментах: можно с /v1 или полным до /chat/completions. */
function normalizeCustomEndpoint(raw) {
    let url;
    try {
        url = new URL(String(raw || '').trim());
    } catch {
        return null;
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    const path = url.pathname.replace(/\/+$/, '');
    if (/\/chat\/completions$/i.test(path)) return url.origin + path;
    if (/\/v1$/i.test(path)) return `${url.origin}${path}/chat/completions`;
    return `${url.origin}/v1/chat/completions`;
}

/** Достаёт текст из ответа (OpenAI, Claude-подобный, Gemini) — как в комментах. */
function extractCustomText(data) {
    if (!data) return '';
    if (typeof data === 'string') return data;
    const fromBlocks = (blocks) => blocks.filter((b) => b?.type === 'text' && typeof b.text === 'string').map((b) => b.text).join('\n');
    const choice = data.choices?.[0]?.message?.content;
    if (typeof choice === 'string') return choice;
    if (Array.isArray(choice)) return fromBlocks(choice);
    if (typeof data.content === 'string') return data.content;
    if (Array.isArray(data.content)) return fromBlocks(data.content);
    const parts = data.candidates?.[0]?.content?.parts;
    if (Array.isArray(parts)) return parts.filter((p) => typeof p?.text === 'string' && !p.thought).map((p) => p.text).join('');
    if (typeof data.text === 'string') return data.text;
    return '';
}

async function requestCustomEndpoint({ instruction, contextText, prefill, maxTokens }, signal) {
    const settings = getSettings();
    const url = normalizeCustomEndpoint(settings.customEndpoint);
    if (!url) throw new Error('Не указан адрес модели — загляни в настройки Junket, «Модель для интервью».');

    const messages = [
        { role: 'system', content: instruction },
        { role: 'user', content: contextText },
    ];
    if (prefill) messages.push({ role: 'assistant', content: prefill });
    const body = { messages, stream: false, max_tokens: maxTokens };
    const model = String(settings.customModel || '').trim();
    if (model) body.model = model;
    if (settings.reasoningEffort === 'min') body.reasoning_effort = CUSTOM_REASONING_MIN;

    const headers = { 'Content-Type': 'application/json' };
    const key = String(settings.customKey || '').trim();
    if (key) headers.Authorization = `Bearer ${key}`;

    const timeout = new AbortController();
    let timedOut = false;
    const onAbort = () => timeout.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => {
        timedOut = true;
        timeout.abort();
    }, CUSTOM_TIMEOUT_MS);

    let response;
    try {
        response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: timeout.signal });
    } catch (error) {
        if (timedOut) throw new Error(`Endpoint did not respond within ${CUSTOM_TIMEOUT_MS / 1000} s`);
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
        throw error;
    } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
    }
    if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`Endpoint HTTP ${response.status}${text ? `: ${text.slice(0, 300)}` : ''}`);
    }
    return extractCustomText(await response.json());
}

// ---------- Чистка ответа ----------

/** Срезает рассуждения, обёртку ``` и вступление модели («Okay, here is…»). */
export function stripPreamble(text) {
    let out = String(text || '').replace(/\r\n?/g, '\n').trim();
    out = out.replace(/<(think|thinking|reasoning|thought|rp_preflight)>[\s\S]*?<\/\1>/gi, '').trim();
    out = out.replace(/^[\s\S]*?<\/(?:think|thinking|reasoning|thought|rp_preflight)>/i, '').trim();
    out = out.replace(/^```[a-z]*\s*\n?/i, '').replace(/\n?```\s*$/, '').trim();
    // Всё, что до первой реплики интервью, — вступление модели.
    const firstTag = out.search(/^\s*\[(?:TITLE|Q|A)\b/im);
    if (firstTag > 0) out = out.slice(firstTag).trim();
    return out;
}

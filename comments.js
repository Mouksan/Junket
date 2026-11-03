// Junket — реакции фандома: лента комментов под интервью.
//
// Порт из ST-Comments (DS Comments): JSON-контракт ответа, парсер с починкой
// JSON и вёрстка комментов (ник градиентом по хешу, плашка ответа, реакции).
// Без гифок, стикеров, мемов, эмоутов, закрепов и звуков.
// Стили ленты — копии chat-styles/*.md из ST-Comments, лежат в feeds/.

import { escapeHtml, substitute } from './store.js';

export const FEED_STYLES = [
    { id: 'bl-feed', label: 'BL-лента' },
    { id: 'bl-omegaverse', label: 'BL-омегаверс' },
    { id: 'fandom-chaos', label: 'Фандомный хаос' },
    { id: 'main', label: 'Обычный' },
];

export const FEED_COUNT_MIN = 5;
export const FEED_COUNT_MAX = 30;

export function getFeedStyle(id) {
    return FEED_STYLES.find((s) => s.id === id) || FEED_STYLES[0];
}

const styleCache = new Map();

/** Текст стиля ленты; макросы таверны ({{random::…}} и т.п.) раскрываются при каждом запросе. */
export async function loadFeedStyle(id) {
    const style = getFeedStyle(id);
    if (!styleCache.has(style.id)) {
        const url = new URL(`./feeds/${style.id}.md`, import.meta.url);
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Feed style "${style.id}" HTTP ${response.status}`);
        styleCache.set(style.id, await response.text());
    }
    return substitute(styleCache.get(style.id));
}

// ---------- Контракт (как в ST-Comments, переписан под интервью) ----------

export function feedContract(count) {
    return `#Interview Comments

Generate exactly ${count} comments reacting to the interview below. Use the EXACT format below.

## OUTPUT FORMAT — respond with ONLY a JSON array. No markdown, no code blocks, no extra text.

Example (note: reply's "content" is a real message, and its "quote" is copied from the target's message):
[
  {"username": "coder_42", "content": "I can't believe he just said that on air", "reactions": [{"emoji": "😭", "count": "12"}, {"emoji": "🐈", "count": "25"}]},
  {"username": "ghost_reader", "content": "SAME. I had to put my phone down and stare at the wall for a minute", "reply": {"to": "coder_42", "quote": "he just said that on air"}, "reactions": [{"emoji": "🙏", "count": "10"}]},
  {"username": "ALLCAPS_CHAOS", "content": "АХАХАХА ОН ЖЕ ПРОСТО КОТ А НЕ ИМПЕРАТОР", "reactions": [{"emoji": "🤣", "count": "45"}, {"emoji": "💀", "count": "20"}]}
]

## FORMAT RULES

- Respond with ONLY the JSON array — nothing else before or after
- Each object: "username" (required), "content" (required)
- "content": message text. Can be multi-line with \\n. Can contain markdown, roleplay actions, ANY text
- "reactions": optional array of {emoji, count} objects — only for messages that genuinely hit
- "reply": optional object {to, quote} — quote is 4-8 words copied from the target's message; the reply's "content" is the commenter's own real reaction — NEVER a placeholder like "reply text here"
- Nickname: max 32 chars, NO colons inside nickname
- Max 1–4 reactions per message — only messages that genuinely hit
- Counts: realistic numbers like "3", "17", "2.4K" — NOT every message needs reactions

## WHAT THEY ARE REACTING TO

The story is a TV series. \`[Episode]\` is the episode that just aired — the commenters watched it. \`[Interview]\` is the fresh interview about those scenes, just published (with audience Q&A segments, if there are any). The comment section is under that interview: commenters react to what was said in it, quote its lines, ship the people in it, catch small details, and connect it back to the episode. Wherever the style below says "chapter" or "update", read "this interview".

\`[Earlier comments]\`, when present, is this same community's earlier discussion under this interview. Returning commenters keep their nicknames and takes, may reply to those earlier messages and continue arguments and inside jokes. Never repeat an earlier comment.`;
}

// ---------- Парсер (порт parser.js из ST-Comments, без медиа) ----------

function stripReasoningBlocks(text) {
    if (!text) return text;
    return text
        .replace(/<(think|thinking|reasoning|thought|reflection|rp_preflight)>[\s\S]*?<\/\1>/gi, '')
        .replace(/<\/?think>/gi, '')
        .replace(/^\s+/, '');
}

function cleanUsername(raw) {
    if (!raw) return raw;
    let name = raw.trim();
    name = name.replace(/^\*\*(.+)\*\*$/, '$1');
    name = name.replace(/^\*(.+)\*$/, '$1');
    name = name.replace(/^__(.+)__$/, '$1');
    name = name.replace(/^_(.+)_$/, '$1');
    name = name.replace(/^`(.+)`$/, '$1');
    name = name.replace(/^~~(.+)~~$/, '$1');
    name = name.replace(/^[*`~_]+|[*`~_]+$/g, '');
    return name.trim();
}

/** Лёгкая починка JSON: пропущенные и лишние запятые, переносы и управляющие символы в строках. */
function tryRepairJson(text) {
    const out = [];
    let inStr = false;
    let esc = false;

    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (esc) { out.push(ch); esc = false; continue; }
        if (ch === '\\' && inStr) { out.push(ch); esc = true; continue; }

        if (inStr) {
            if (ch === '\n') { out.push('\\n'); continue; }
            if (ch === '\r') { continue; }
            if (ch === '\t') { out.push('\\t'); continue; }
            if (ch < ' ') {
                if (ch === '\b') out.push('\\b');
                else if (ch === '\f') out.push('\\f');
                else out.push('\\u' + ch.charCodeAt(0).toString(16).padStart(4, '0'));
                continue;
            }
            if (ch === '"') {
                let j = i + 1;
                while (j < text.length && ' \t\r\n'.includes(text[j])) j++;
                const next = text[j];
                if (next === ',' || next === '}' || next === ']' || next === ':') {
                    inStr = false;
                    out.push(ch);
                    continue;
                }
                if (next === '"') {
                    inStr = false;
                    out.push(ch);
                    out.push(',');
                    continue;
                }
                inStr = false;
                out.push(ch);
                continue;
            }
            out.push(ch);
            continue;
        }

        if (ch === '"') { inStr = true; out.push(ch); continue; }
        if (ch === '}' || ch === ']') {
            let j = i + 1;
            while (j < text.length && ' \t\r\n'.includes(text[j])) j++;
            const next = text[j];
            if (next === '"' || next === '{' || next === '[') {
                out.push(ch);
                out.push(',');
                continue;
            }
        }
        out.push(ch);
    }

    return out.join('').replace(/,(\s*[}\]])/g, '$1');
}

function findMatchingBrace(text, start) {
    const open = text[start];
    const close = open === '{' ? '}' : ']';
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let j = start; j < text.length; j++) {
        const ch = text[j];
        if (esc) { esc = false; continue; }
        if (ch === '\\' && inStr) { esc = true; continue; }
        if (ch === '"') { inStr = !inStr; continue; }
        if (inStr) continue;
        if (ch === open) depth++;
        if (ch === close) {
            depth--;
            if (depth === 0) return j;
        }
    }
    return -1;
}

function parseObject(objText) {
    try {
        return JSON.parse(objText);
    } catch {
        try {
            return JSON.parse(tryRepairJson(objText));
        } catch {
            return null;
        }
    }
}

/** Достаёт отдельные {…} из текста, не глядя на общую структуру массива. */
function extractObjectsFromText(text) {
    const objects = [];
    const firstBrace = text.indexOf('{');
    const firstUsername = text.indexOf('"username"');
    if (firstUsername !== -1 && (firstBrace === -1 || firstUsername < firstBrace)) {
        const candidate = '{' + text.slice(firstUsername);
        const end = findMatchingBrace(candidate, 0);
        if (end !== -1) {
            const obj = parseObject(candidate.slice(0, end + 1));
            if (obj && typeof obj === 'object' && !Array.isArray(obj)) objects.push(obj);
        }
    }
    let i = 0;
    while (i < text.length) {
        const start = text.indexOf('{', i);
        if (start === -1) break;
        const end = findMatchingBrace(text, start);
        if (end === -1) { i = start + 1; continue; }
        const obj = parseObject(text.slice(start, end + 1));
        if (obj && typeof obj === 'object' && !Array.isArray(obj)) objects.push(obj);
        i = end + 1;
    }
    return objects.length > 0 ? objects : null;
}

function asCommentsArray(p) {
    if (p && !Array.isArray(p) && typeof p === 'object') {
        for (const v of Object.values(p)) {
            if (Array.isArray(v) && v.some((it) => it && typeof it === 'object' && (it.username || it.content))) {
                p = v;
                break;
            }
        }
    }
    if (!Array.isArray(p)) return null;
    return p.some((it) => it && typeof it === 'object' && (it.username || it.content)) ? p : null;
}

/**
 * Разбирает ответ модели в список комментов.
 * Порядок попыток как в ST-Comments: прямой разбор → починка → поштучное
 * извлечение объектов → спасение обрезанного ответа.
 * Возвращает [{ username, content, replyTo, replyQuote, reactions }] или null.
 */
export function parseComments(rawText) {
    if (!rawText) return null;
    let text = stripReasoningBlocks(String(rawText));
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    text = text.replace(/^```\w*\s*\n?/gm, '').replace(/```\s*$/gm, '').trim();
    if (text.length > 100_000) return null;

    let parsed = null;
    try { parsed = asCommentsArray(JSON.parse(text)); } catch { /* дальше */ }
    if (!parsed) {
        try { parsed = asCommentsArray(JSON.parse(tryRepairJson(text))); } catch { /* дальше */ }
    }
    if (!parsed) {
        try { parsed = asCommentsArray(extractObjectsFromText(text)); } catch { /* дальше */ }
    }
    if (!parsed) {
        try {
            const lastObjEnd = text.lastIndexOf('}');
            if (lastObjEnd > 0) {
                const truncated = text.slice(0, lastObjEnd + 1);
                const stack = [];
                let inStr = false;
                let esc = false;
                for (const ch of truncated) {
                    if (esc) { esc = false; continue; }
                    if (ch === '\\' && inStr) { esc = true; continue; }
                    if (ch === '"') { inStr = !inStr; continue; }
                    if (inStr) continue;
                    if (ch === '{' || ch === '[') stack.push(ch);
                    else if (ch === '}' && stack[stack.length - 1] === '{') stack.pop();
                    else if (ch === ']' && stack[stack.length - 1] === '[') stack.pop();
                }
                if (stack.length > 0 && stack.includes('[')) {
                    let repaired = truncated;
                    for (let i = stack.length - 1; i >= 0; i--) repaired += stack[i] === '{' ? '}' : ']';
                    parsed = asCommentsArray(parseObject(repaired));
                }
            }
        } catch { /* сдаёмся */ }
    }
    if (!parsed) return null;

    const messages = [];
    for (const item of parsed) {
        if (!item || typeof item !== 'object') continue;
        const username = cleanUsername(String(item.username || ''));
        const content = String(item.content || '').trim();
        if (!username || !content) continue;

        const reactions = Array.isArray(item.reactions)
            ? item.reactions
                .filter((r) => r && typeof r === 'object')
                .map((r) => ({ emoji: String(r.emoji || ''), count: String(r.count || '') }))
                .filter((r) => r.emoji)
            : [];

        let replyTo = null;
        let replyQuote = null;
        if (item.reply && typeof item.reply === 'object') {
            const target = cleanUsername(String(item.reply.to || ''));
            if (target) {
                replyTo = target;
                replyQuote = String(item.reply.quote || '').trim();
            }
        }
        messages.push({ username, content, replyTo, replyQuote, reactions });
    }
    return messages.length > 0 ? messages : null;
}

// ---------- Вёрстка (порт renderer.js из ST-Comments) ----------

export function hashHue(name) {
    let hash = 0;
    const str = String(name ?? '');
    for (let i = 0; i < str.length; i++) {
        hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    return Math.abs(hash) % 360;
}

function formatMessageContent(text) {
    let out = escapeHtml(text);
    out = out.replace(/\*\*([^*]+?)\*\*/g, '<strong>$1</strong>');
    out = out.replace(/```[a-zA-Z0-9]*\n?/g, '');
    out = out.replace(/`([^`]+?)`/g, '<code>$1</code>');
    out = out.replace(/(^|[^*])\*([^*\n]+?)\*(?!\*)/g, '$1<em>$2</em>');
    out = out.replace(/~~([^~]+?)~~/g, '<del>$1</del>');
    out = out.replace(/\n/g, '<br>');
    return out;
}

function messageHtml(msg) {
    const hue = hashHue(msg.username);
    const nickA = `hsl(${hue}, 80%, 65%)`;
    const nickB = `hsl(${(hue + 35) % 360}, 78%, 55%)`;

    let replyBar = '';
    if (msg.replyTo) {
        const replyColor = `hsl(${hashHue(msg.replyTo)}, 75%, 62%)`;
        replyBar = `
            <div class="jnk-cm-reply">
                <span class="jnk-cm-reply-line"></span>
                <span class="jnk-cm-reply-avatar" style="background:${replyColor}">${escapeHtml(msg.replyTo.charAt(0).toUpperCase())}</span>
                <span class="jnk-cm-reply-name" style="color:${replyColor}">@${escapeHtml(msg.replyTo)}</span>
                <span class="jnk-cm-reply-quote">${escapeHtml(msg.replyQuote || '')}</span>
            </div>`;
    }

    const reactions = (msg.reactions || []).slice(0, 6)
        .map((r) => `<span class="jnk-cm-reaction"><span>${escapeHtml(r.emoji)}</span>${r.count ? `<span class="jnk-cm-count">${escapeHtml(r.count)}</span>` : ''}</span>`)
        .join('');

    return `
        <div class="jnk-cm">
            ${replyBar}
            <div class="jnk-cm-nick" style="--jnk-nick-a:${nickA};--jnk-nick-b:${nickB}">${escapeHtml(msg.username)}</div>
            <div class="jnk-cm-text">${formatMessageContent(msg.content)}</div>
            ${reactions ? `<div class="jnk-cm-reactions">${reactions}</div>` : ''}
        </div>`;
}

/** Стрим-чат: коммент — строчка «ник: текст», цвет ника по хешу (оттенок подстраивает тема). */
function streamLineHtml(msg) {
    const reply = msg.replyTo
        ? `<div class="jnk-tw-reply">↳ в ответ <span style="--jnk-hue:${hashHue(msg.replyTo)}" class="jnk-tw-reply-nick">@${escapeHtml(msg.replyTo)}</span>${msg.replyQuote ? `: «${escapeHtml(msg.replyQuote)}»` : ''}</div>`
        : '';
    const reactions = (msg.reactions || []).slice(0, 6)
        .map((r) => `<span class="jnk-tw-react">${escapeHtml(r.emoji)}${r.count ? ` ${escapeHtml(r.count)}` : ''}</span>`)
        .join('');
    return `
        <div class="jnk-tw-line jnk-cm">
            ${reply}
            <span class="jnk-tw-nick" style="--jnk-hue:${hashHue(msg.username)}">${escapeHtml(msg.username)}</span>: <span class="jnk-tw-msg jnk-cm-text">${formatMessageContent(msg.content)}</span>
            ${reactions ? `<span class="jnk-tw-reacts">${reactions}</span>` : ''}
        </div>`;
}

/** Все комменты ленты подряд (пачки склеены). */
export function feedMessages(feed) {
    return (Array.isArray(feed) ? feed : []).flatMap((batch) => Array.isArray(batch?.messages) ? batch.messages : []);
}

// Заголовок ленты под тему
const FEED_TITLES = {
    newspaper: 'Отклики читателей',
    dossier: 'Перехваченные сообщения',
    scroll: 'Заметки на полях',
    stream: '💬 Чат после стрима',
    subtitles: 'Соцсети в эфире',
};

export function renderFeedHtml(feed, theme = 'magazine') {
    const messages = feedMessages(feed);
    if (!messages.length) return '';
    const title = FEED_TITLES[theme] || '💬 Комментарии';
    return `
        <section class="jnk-feed">
            <div class="jnk-round-head">
                <span>${title} · ${messages.length}</span>
                <button class="jnk-icon-btn jnk-feed-delete" type="button" title="Удалить ленту"><i class="fa-solid fa-trash-can"></i></button>
            </div>
            <div class="jnk-feed-list">${messages.map(theme === 'stream' ? streamLineHtml : messageHtml).join('')}</div>
        </section>`;
}

/** Лента текстом: для копирования и для «прошлых комментов» в промпте. */
export function feedPlainText(feed) {
    return feedMessages(feed).map((m) => {
        const reply = m.replyTo ? ` (в ответ @${m.replyTo}: «${m.replyQuote || ''}»)` : '';
        return `${m.username}${reply}: ${m.content}`;
    }).join('\n');
}

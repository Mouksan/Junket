// Junket — разбор разметки интервью и журнальная вёрстка.
//
// Разметка от модели:
//   [TITLE] заголовок
//   [Q] вопрос интервьюера
//   [A: Актёр (Veyne)] ответ актёра — в скобках имя из карточки/персоны
// Внутри реплик: *ремарка*, **жирное**, абзацы через пустую строку.

import { ctx, escapeHtml, formatDate } from './store.js';
import { user_avatar } from '../../../personas.js';

// Цвета для актёров сверх первых двух (перс — цвет цитат темы, персона — цвет выделения)
const EXTRA_COLORS = ['#7fb3d5', '#c39bd3', '#82c9a5', '#e6b673', '#e59a9a', '#8fc1c4'];

const TAG_RE = /^\s*\[(TITLE|Q|A)(?:\s*:\s*([^\]]*))?\]\s*(.*)$/i;

/**
 * Разбирает сырой текст.
 * Возвращает { title, turns: [{ kind: 'q' | 'a', actor, character, lines: [] }] }.
 * Если реплик нет совсем — turns пустой (тогда показываем текст как есть).
 */
export function parseInterview(text) {
    const result = { title: '', turns: [] };
    let current = null;

    for (const line of String(text || '').replace(/\r\n?/g, '\n').split('\n')) {
        const m = line.match(TAG_RE);
        if (m) {
            const tag = m[1].toUpperCase();
            const rest = m[3] || '';
            if (tag === 'TITLE') {
                if (!result.title) result.title = cleanTitle(rest);
                current = null;
                continue;
            }
            if (tag === 'Q') {
                current = { kind: 'q', actor: '', character: '', lines: [rest] };
            } else {
                const speaker = String(m[2] || '').trim();
                const sm = speaker.match(/^(.*?)\s*\(([^)]*)\)\s*$/);
                current = {
                    kind: 'a',
                    actor: (sm ? sm[1] : speaker).trim() || '???',
                    character: sm ? sm[2].trim() : '',
                    lines: [rest],
                };
            }
            result.turns.push(current);
            continue;
        }
        if (current) current.lines.push(line);
    }

    for (const turn of result.turns) {
        turn.body = turn.lines.join('\n').trim();
        delete turn.lines;
    }
    result.turns = result.turns.filter((t) => t.body);
    return result;
}

/** Снимает кавычки, только если ими обёрнут весь заголовок целиком. */
function cleanTitle(raw) {
    const t = String(raw || '').trim();
    const m = t.match(/^(?:"([^"]*)"|«([^«»]*)»)$/);
    return m ? (m[1] ?? m[2]).trim() : t;
}

// ---------- Кто есть кто ----------

function thumb(type, file) {
    if (!file) return '';
    try {
        return ctx().getThumbnailUrl(type, file);
    } catch {
        return `/thumbnail?type=${type}&file=${encodeURIComponent(file)}`;
    }
}

/** Персонажи и персона текущего чата: имя → { avatar, color }. */
function buildCastMap() {
    const c = ctx();
    const map = new Map();
    let extra = 0;
    const nextExtra = () => EXTRA_COLORS[extra++ % EXTRA_COLORS.length];

    const characters = [];
    if (c.groupId) {
        const group = c.groups?.find((g) => g.id === c.groupId);
        for (const avatar of group?.members || []) {
            const member = c.characters?.find((ch) => ch.avatar === avatar);
            if (member) characters.push(member);
        }
    } else if (c.characterId !== undefined && c.characterId !== null && c.characters?.[c.characterId]) {
        characters.push(c.characters[c.characterId]);
    }

    characters.forEach((ch, i) => {
        if (!ch?.name) return;
        map.set(ch.name.trim().toLowerCase(), {
            avatar: thumb('avatar', ch.avatar),
            color: i === 0 ? 'var(--SmartThemeQuoteColor)' : nextExtra(),
        });
    });

    if (c.name1) {
        map.set(c.name1.trim().toLowerCase(), {
            avatar: thumb('persona', user_avatar),
            color: 'var(--SmartThemeEmColor)',
        });
    }

    return { map, nextExtra };
}

// ---------- Вёрстка ----------

function inlineHtml(text) {
    return escapeHtml(text)
        .replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*([^*\n]+?)\*/g, '<em class="jnk-dir">$1</em>');
}

function bodyHtml(body) {
    return body
        .split(/\n\s*\n/)
        .map((p) => p.trim())
        .filter(Boolean)
        .map((p) => `<p>${inlineHtml(p).replace(/\n/g, '<br>')}</p>`)
        .join('');
}

function initialOf(name) {
    return escapeHtml((String(name || '?').trim()[0] || '?').toUpperCase());
}

export function defaultTitle(range) {
    return range ? `Интервью · сообщения ${range.from}–${range.to}` : 'Интервью';
}

/**
 * Готовая вёрстка интервью (шапка + реплики).
 * item: { title, range, createdAt, text, test }
 */
export function renderInterviewHtml(item) {
    const meta = [
        item.range ? `Сообщения ${item.range.from}–${item.range.to}` : '',
        item.createdAt ? formatDate(item.createdAt) : '',
    ].filter(Boolean).join(' · ');

    const head = `
        <header class="jnk-iv-head">
            <h2 class="jnk-iv-title">${escapeHtml(item.title || defaultTitle(item.range))}</h2>
            ${meta ? `<div class="jnk-iv-meta">${escapeHtml(meta)}</div>` : ''}
        </header>`;

    if (!String(item.text || '').trim()) {
        return `<article class="jnk-iv">${head}<div class="jnk-empty">Пустая тестовая запись.</div></article>`;
    }

    const parsed = parseInterview(item.text);
    if (!parsed.turns.length) {
        // Модель не выдала разметку — показываем как есть, чтобы ничего не потерялось
        return `<article class="jnk-iv">${head}<div class="jnk-iv-plain">${bodyHtml(item.text)}</div></article>`;
    }

    const { map, nextExtra } = buildCastMap();
    const unknown = new Map();   // актёры, которых не нашли в чате: имя → цвет

    const turns = parsed.turns.map((turn) => {
        if (turn.kind === 'q') {
            return `
                <section class="jnk-iv-q">
                    <div class="jnk-iv-q-label">🎤 Интервьюер</div>
                    <div class="jnk-iv-text">${bodyHtml(turn.body)}</div>
                </section>`;
        }

        const known = map.get(turn.character.toLowerCase());
        let color = known?.color;
        if (!color) {
            const key = (turn.character || turn.actor).toLowerCase();
            if (!unknown.has(key)) unknown.set(key, nextExtra());
            color = unknown.get(key);
        }
        const avatar = known?.avatar
            ? `<img class="jnk-iv-avatar" src="${escapeHtml(known.avatar)}" alt="" loading="lazy">`
            : `<span class="jnk-iv-avatar jnk-iv-initial" style="background:${color}">${initialOf(turn.actor)}</span>`;

        return `
            <section class="jnk-iv-a" style="--jnk-speaker:${color}">
                <div class="jnk-iv-speaker">
                    ${avatar}
                    <span class="jnk-iv-actor">${escapeHtml(turn.actor)}</span>
                    ${turn.character ? `<span class="jnk-iv-role">${escapeHtml(turn.character)}</span>` : ''}
                </div>
                <div class="jnk-iv-text">${bodyHtml(turn.body)}</div>
            </section>`;
    }).join('');

    return `<article class="jnk-iv">${head}<div class="jnk-iv-turns">${turns}</div></article>`;
}

/** Чистый текст для буфера обмена: без тегов, с подписями говорящих. */
export function interviewPlainText(item) {
    const title = item.title || defaultTitle(item.range);
    const parsed = parseInterview(item.text);
    if (!parsed.turns.length) return `${title}\n\n${String(item.text || '').trim()}`;
    const parts = parsed.turns.map((turn) => {
        const who = turn.kind === 'q' ? 'Интервьюер' : (turn.character ? `${turn.actor} (${turn.character})` : turn.actor);
        return `${who}: ${turn.body}`;
    });
    return `${title}\n\n${parts.join('\n\n')}`;
}

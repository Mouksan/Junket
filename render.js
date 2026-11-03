// Junket — разбор разметки интервью и вёрстка по темам (Журнал, Мессенджер, Газета, Сценарий, Досье).
//
// Разметка от модели:
//   [TITLE] заголовок
//   [Q] вопрос интервьюера
//   [A: Актёр (Veyne)] ответ актёра — в скобках имя из карточки/персоны
//   [F: @ник] вопрос из зала (раунды «Вопросов из зала»)
// Внутри реплик: *ремарка*, **жирное**, абзацы через пустую строку.

import { ctx, escapeHtml, formatDate } from './store.js';
import { formatLabel } from './formats.js';
import { getTheme, normalizePaper } from './themes.js';
import { user_avatar } from '../../../personas.js';

// Цвета для актёров сверх первых двух (перс — цвет цитат темы, персона — цвет выделения)
const EXTRA_COLORS = ['#7fb3d5', '#c39bd3', '#82c9a5', '#e6b673', '#e59a9a', '#8fc1c4'];

const TAG_RE = /^\s*\[(TITLE|Q|A|F)(?:\s*:\s*([^\]]*))?\]\s*(.*)$/i;

/**
 * Разбирает сырой текст.
 * Возвращает { title, turns: [{ kind: 'q' | 'a' | 'f', actor, character, body }] }.
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
            } else if (tag === 'F') {
                current = { kind: 'f', actor: String(m[2] || '').trim() || 'Из зала', character: '', lines: [rest] };
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

// Цензура как в Control и SCP: каждый [BLEEP] — чёрная плашка своей ширины
const BLEEP_RE = /\[(?:BLEEP|BEEP|пип|пи-ип|бип)\]/gi;
const REDACT_WIDTHS = [3.2, 2.4, 4.1, 2.9, 3.6, 2.2, 4.6];
let redactCounter = 0;

function inlineHtml(text) {
    return escapeHtml(text)
        .replace(BLEEP_RE, () => {
            const width = REDACT_WIDTHS[redactCounter++ % REDACT_WIDTHS.length];
            return `<span class="jnk-redact" style="width:${width}em" title="Вырезано цензурой"></span>`;
        })
        .replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*([^*\n]+?)\*/g, '<em class="jnk-dir">$1</em>');
}

function bodyHtml(body, lead = '') {
    const paras = String(body || '')
        .split(/\n\s*\n/)
        .map((p) => p.trim())
        .filter(Boolean);
    if (!paras.length) return lead ? `<p>${lead}</p>` : '';
    return paras
        .map((p, i) => `<p>${i === 0 ? lead : ''}${inlineHtml(p).replace(/\n/g, '<br>')}</p>`)
        .join('');
}

function initialOf(name) {
    return escapeHtml((String(name || '?').trim()[0] || '?').toUpperCase());
}

export function defaultTitle(range) {
    return range ? `Интервью · сообщения ${range.from}–${range.to}` : 'Интервью';
}

// ---------- Шапки тем ----------

const THEMES_PLAIN = new Set(['newspaper', 'script', 'dossier']);
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
const APPENDIX = 'БВГДЕЖЗИКЛМНОПРСТУФХЦЧШЭЮЯ';

/** Номер протокола в Досье — стабильный, из id интервью. */
function protocolNumber(id) {
    let h = 0;
    for (const ch of String(id || '')) h = (h * 31 + ch.charCodeAt(0)) % 9000;
    return String(1000 + h);
}

function headHtml(env) {
    const { item, theme } = env;
    const title = escapeHtml(item.title || defaultTitle(item.range));
    const label = formatLabel(item.format, item.venue);
    // На бумаге эмодзи формата смотрятся чужеродно — снимаем
    const format = THEMES_PLAIN.has(theme) ? label.replace(/^\p{Extended_Pictographic}\uFE0F?\s*/u, '') : label;
    const range = item.range ? `Сообщения ${item.range.from}–${item.range.to}` : '';
    const date = item.createdAt ? formatDate(item.createdAt) : '';

    if (theme === 'newspaper') {
        const sub = [format, range].filter(Boolean).join(' · ');
        return `
            <header class="jnk-iv-head jnk-np-head">
                <div class="jnk-np-mast"><span>Junket · №${protocolNumber(item.id).slice(-3)}</span><span>${escapeHtml(date)}</span></div>
                <h2 class="jnk-iv-title">${title}</h2>
                ${sub ? `<div class="jnk-iv-meta">${escapeHtml(sub)}</div>` : ''}
            </header>`;
    }
    if (theme === 'script') {
        const sub = [format, range, date].filter(Boolean).join(' · ');
        return `
            <header class="jnk-iv-head jnk-sc-head">
                <div class="jnk-sc-slug">ИНТ. СТУДИЯ — <span class="jnk-sc-time">${env.paper === 'night' ? 'НОЧЬ' : 'ДЕНЬ'}</span></div>
                <h2 class="jnk-iv-title">${title}</h2>
                ${sub ? `<div class="jnk-iv-meta">${escapeHtml(sub)}</div>` : ''}
            </header>`;
    }
    if (theme === 'dossier') {
        const field = (label, value) => (value ? `<div class="jnk-ds-field"><span>${label}:</span> ${escapeHtml(value)}</div>` : '');
        return `
            <header class="jnk-iv-head jnk-ds-head">
                <div class="jnk-ds-top">
                    <span>Протокол беседы № ${protocolNumber(item.id)}</span>
                    <span class="jnk-ds-stamp">Секретно</span>
                </div>
                <div class="jnk-ds-field jnk-ds-subject"><span>Тема:</span> <h2 class="jnk-iv-title">${title}</h2></div>
                ${field('Формат', format)}
                ${field('Материалы', range.toLowerCase())}
                ${field('Дата', date)}
            </header>`;
    }

    // Журнал и мессенджер
    const meta = [format, range, date].filter(Boolean).join(' · ');
    return `
        <header class="jnk-iv-head">
            <h2 class="jnk-iv-title">${title}</h2>
            ${meta ? `<div class="jnk-iv-meta">${escapeHtml(meta)}</div>` : ''}
        </header>`;
}

function roundHeadText(theme, i) {
    if (theme === 'newspaper') return `Письма читателей${i > 0 ? ` · ${ROMAN[i] || i + 1}` : ''}`;
    if (theme === 'script') return `Сцена ${i + 2}. Инт. зрительный зал — вопросы из зала`;
    if (theme === 'dossier') return `Приложение ${APPENDIX[i] || i + 1}. Вопросы посторонних лиц`;
    return `🎤 Вопросы из зала${i > 0 ? ` · раунд ${i + 1}` : ''}`;
}

/**
 * Готовая вёрстка интервью (шапка + реплики + раунды).
 * item: { id, title, range, createdAt, text, rounds }
 * opts: { theme, paper, personaName, preview }
 */
export function renderInterviewHtml(item, opts = {}) {
    redactCounter = 0;
    const persona = opts.personaName ?? ctx().name1 ?? '';
    const env = {
        item,
        theme: getTheme(opts.theme).id,
        paper: normalizePaper(opts.paper),
        personaKey: String(persona).trim().toLowerCase(),
        preview: Boolean(opts.preview),
    };
    const head = headHtml(env);

    if (!String(item.text || '').trim()) {
        return `<article class="jnk-iv">${head}<div class="jnk-empty">Пустая тестовая запись.</div></article>`;
    }

    const parsed = parseInterview(item.text);
    if (!parsed.turns.length) {
        // Модель не выдала разметку — показываем как есть, чтобы ничего не потерялось
        return `<article class="jnk-iv">${head}<div class="jnk-iv-plain">${bodyHtml(item.text)}</div></article>`;
    }

    const cast = { ...buildCastMap(), unknown: new Map() };   // цвета общие для интервью и раундов
    const rounds = (item.rounds || []).filter((r) => String(r?.text || '').trim());
    const roundsHtml = rounds.map((round, i) => {
        const roundTurns = parseInterview(round.text).turns;
        const body = roundTurns.length
            ? `<div class="jnk-iv-turns">${turnsHtml(roundTurns, cast, round.ownNick, env)}</div>`
            : `<div class="jnk-iv-plain">${bodyHtml(round.text)}</div>`;
        return `
            <section class="jnk-round" data-round="${escapeHtml(round.id)}">
                <div class="jnk-round-head">
                    <span>${escapeHtml(roundHeadText(env.theme, i))}</span>
                    ${env.preview ? '' : '<button class="jnk-icon-btn jnk-round-delete" type="button" title="Удалить раунд"><i class="fa-solid fa-trash-can"></i></button>'}
                </div>
                ${body}
            </section>`;
    }).join('');

    const tail = env.theme === 'dossier' ? '<div class="jnk-ds-end">— Конец протокола —</div>' : '';
    return `<article class="jnk-iv">${head}<div class="jnk-iv-turns">${turnsHtml(parsed.turns, cast, '', env)}</div>${roundsHtml}${tail}</article>`;
}

// ---------- Реплики ----------

/** Цвет и аватарка говорящего (одни и те же во всём интервью). */
function speakerLook(turn, cast) {
    const known = cast.map.get(turn.character.toLowerCase());
    let color = known?.color;
    if (!color) {
        const key = (turn.character || turn.actor).toLowerCase();
        if (!cast.unknown.has(key)) cast.unknown.set(key, cast.nextExtra());
        color = cast.unknown.get(key);
    }
    const avatar = known?.avatar
        ? `<img class="jnk-iv-avatar" src="${escapeHtml(known.avatar)}" alt="" loading="lazy">`
        : `<span class="jnk-iv-avatar jnk-iv-initial" style="background:${color}">${initialOf(turn.actor)}</span>`;
    return { color, avatar };
}

function isOwnTurn(turn, own) {
    return Boolean(own) && turn.kind === 'f' && turn.actor.trim().toLowerCase() === own;
}

function speakerName(turn) {
    return turn.character ? `${turn.actor} (${turn.character})` : turn.actor;
}

function turnsHtml(turns, cast, ownNick, env) {
    const own = String(ownNick || '').trim().toLowerCase();
    if (env.theme === 'messenger') return messengerTurns(turns, cast, own, env);
    if (env.theme === 'newspaper') return newspaperTurns(turns, own);
    if (env.theme === 'script') return scriptTurns(turns, own);
    if (env.theme === 'dossier') return dossierTurns(turns, own);
    return magazineTurns(turns, cast, own);
}

function magazineTurns(turns, cast, own) {
    return turns.map((turn) => {
        if (turn.kind === 'q') {
            return `
                <section class="jnk-iv-q">
                    <div class="jnk-iv-q-label">🎤 Интервьюер</div>
                    <div class="jnk-iv-text">${bodyHtml(turn.body)}</div>
                </section>`;
        }
        if (turn.kind === 'f') {
            const isOwn = isOwnTurn(turn, own);
            return `
                <section class="jnk-iv-f ${isOwn ? 'jnk-iv-own' : ''}">
                    <div class="jnk-iv-q-label">💬 ${escapeHtml(turn.actor)}${isOwn ? ' <span class="jnk-badge">автор</span>' : ''}</div>
                    <div class="jnk-iv-text">${bodyHtml(turn.body)}</div>
                </section>`;
        }
        const { color, avatar } = speakerLook(turn, cast);
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
}

/** Мессенджер: персонажи слева, персона справа, интервьюер и зал — плашками по центру. */
function messengerTurns(turns, cast, own, env) {
    let prevKey = null;
    return turns.map((turn) => {
        if (turn.kind === 'q') {
            prevKey = null;
            return `
                <div class="jnk-msg-sys">
                    <div class="jnk-msg-sys-label">🎤 Интервьюер</div>
                    <div class="jnk-iv-text">${bodyHtml(turn.body)}</div>
                </div>`;
        }
        if (turn.kind === 'f') {
            prevKey = null;
            const isOwn = isOwnTurn(turn, own);
            return `
                <div class="jnk-msg-sys jnk-msg-fan ${isOwn ? 'jnk-own' : ''}">
                    <div class="jnk-msg-sys-label">💬 ${escapeHtml(turn.actor)}${isOwn ? ' <span class="jnk-badge">автор</span>' : ''}</div>
                    <div class="jnk-iv-text">${bodyHtml(turn.body)}</div>
                </div>`;
        }
        const key = (turn.character || turn.actor).trim().toLowerCase();
        const right = Boolean(env.personaKey) && key === env.personaKey;
        const cont = key === prevKey;
        prevKey = key;
        const { color, avatar } = speakerLook(turn, cast);
        const name = cont ? '' : `
            <div class="jnk-msg-name">${escapeHtml(turn.actor)}${turn.character ? ` <span class="jnk-msg-role">${escapeHtml(turn.character)}</span>` : ''}</div>`;
        return `
            <div class="jnk-msg-row ${right ? 'jnk-msg-right' : ''} ${cont ? 'jnk-msg-cont' : ''}" style="--jnk-speaker:${color}">
                <div class="jnk-msg-ava">${cont ? '' : avatar}</div>
                <div class="jnk-msg-bubble">${name}<div class="jnk-iv-text">${bodyHtml(turn.body)}</div></div>
            </div>`;
    }).join('');
}

/** Газета: вопрос жирным, у ответа имя в начале абзаца, у первого вопроса буквица. */
function newspaperTurns(turns, own) {
    return turns.map((turn) => {
        if (turn.kind === 'q') {
            return `<div class="jnk-np-q jnk-iv-text">${bodyHtml(turn.body)}</div>`;
        }
        if (turn.kind === 'f') {
            const isOwn = isOwnTurn(turn, own);
            const lead = `<span class="jnk-np-name">${isOwn ? 'От редакции' : `${escapeHtml(turn.actor)} спрашивает`}:</span> `;
            return `<div class="jnk-np-letter jnk-iv-text ${isOwn ? 'jnk-own' : ''}">${bodyHtml(turn.body, lead)}</div>`;
        }
        const role = turn.character ? ` <span class="jnk-np-role">(${escapeHtml(turn.character)})</span>` : '';
        const lead = `<span class="jnk-np-name">${escapeHtml(turn.actor)}${role}:</span> `;
        return `<div class="jnk-np-a jnk-iv-text">${bodyHtml(turn.body, lead)}</div>`;
    }).join('');
}

/** Сценарий: имя по центру капсом, ремарка в начале реплики — отдельной строкой. */
function scriptTurns(turns, own) {
    return turns.map((turn) => {
        const isOwn = isOwnTurn(turn, own);
        const name = turn.kind === 'q' ? 'Интервьюер'
            : turn.kind === 'f' ? `${isOwn ? 'Автор' : 'Голос из зала'} (${turn.actor})`
                : speakerName(turn);
        let body = turn.body;
        let paren = '';
        const m = body.match(/^\*([^*\n]+)\*\s*/);
        if (m && body.slice(m[0].length).trim()) {
            paren = m[1].trim();
            body = body.slice(m[0].length);
        }
        return `
            <div class="jnk-sc-turn ${turn.kind === 'f' ? 'jnk-sc-fan' : ''} ${isOwn ? 'jnk-own' : ''}">
                <div class="jnk-sc-name">${escapeHtml(name)}</div>
                ${paren ? `<div class="jnk-sc-paren">(${inlineHtml(paren)})</div>` : ''}
                <div class="jnk-sc-line jnk-iv-text">${bodyHtml(body)}</div>
            </div>`;
    }).join('');
}

/** Досье: стенограмма с метками говорящих. */
function dossierTurns(turns, own) {
    return turns.map((turn) => {
        const isOwn = isOwnTurn(turn, own);
        const label = turn.kind === 'q' ? 'Опрашивающий'
            : turn.kind === 'f' ? `${isOwn ? 'Куратор дела' : 'Постороннее лицо'} (${turn.actor})`
                : speakerName(turn);
        const lead = `<span class="jnk-ds-label">${escapeHtml(label)}:</span> `;
        return `<div class="jnk-ds-turn jnk-ds-${turn.kind} jnk-iv-text ${isOwn ? 'jnk-own' : ''}">${bodyHtml(turn.body, lead)}</div>`;
    }).join('');
}

/** Чистый текст для буфера обмена: без тегов, с подписями говорящих. */
export function interviewPlainText(item) {
    const title = item.title || defaultTitle(item.range);
    const sections = [title, plainTurns(item.text)];
    (item.rounds || []).forEach((round, i) => {
        if (!String(round?.text || '').trim()) return;
        sections.push(`— Вопросы из зала${i > 0 ? ` · раунд ${i + 1}` : ''} —`, plainTurns(round.text));
    });
    return sections.join('\n\n').replace(BLEEP_RE, '█████');
}

function plainTurns(text) {
    const parsed = parseInterview(text);
    if (!parsed.turns.length) return String(text || '').trim();
    return parsed.turns.map((turn) => {
        const who = turn.kind === 'q' ? 'Интервьюер'
            : turn.kind === 'f' ? turn.actor
                : (turn.character ? `${turn.actor} (${turn.character})` : turn.actor);
        return `${who}: ${turn.body}`;
    }).join('\n\n');
}

/** Интервью вместе с раундами — сырой текст для модели и для «Закрепить каст». */
export function fullInterviewText(item) {
    const parts = [String(item.text || '').trim()];
    for (const round of item.rounds || []) {
        if (String(round?.text || '').trim()) parts.push(String(round.text).trim());
    }
    return parts.join('\n\n');
}

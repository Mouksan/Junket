// Junket — «Что знает модель»: карточка, персона, первое сообщение, лорбуки,
// плюс текст выбранных сообщений сцены.
//
// Порт из Realmweaver (sources.js). Отличие одно: выбор хранится не в пакете,
// а в метаданных чата (store.sources), у каждого чата свой.
//
// Лорбуки читаются целиком через loadWorldInfo() — без активации по ключам,
// как в Realmweaver: актёрам нужна фактура мира целиком. Отключённые записи пропускаются.

import { ctx, getSettings } from './store.js';
import { selected_world_info, world_info, METADATA_KEY } from '../../../world-info.js';

// ---------------------------------------------------------------------------
// Активные лорбуки
// ---------------------------------------------------------------------------

export const ACTIVE_KIND_LABELS = {
    chat: 'чат',
    character: 'персонаж',
    persona: 'персона',
    global: 'глобальный',
};

function characterFileName(character) {
    return String(character?.avatar || '').replace(/\.[^/.]+$/, '');
}

/** Персонажи текущего чата (в групповом — все участники). */
function chatCharacters() {
    const c = ctx();
    const characters = [];
    if (c.groupId) {
        const group = c.groups?.find((g) => g.id === c.groupId);
        for (const avatar of group?.members || []) {
            const member = c.characters?.find((ch) => ch.avatar === avatar);
            if (member) characters.push(member);
        }
    } else if (c.characterId !== undefined && c.characterId !== null) {
        const character = c.characters?.[c.characterId];
        if (character) characters.push(character);
    }
    return characters;
}

/** Имена персонажей чата — для кастинга. */
export function getCharacterNames() {
    const names = chatCharacters().map((ch) => ch?.name).filter(Boolean);
    if (names.length) return names;
    const fallback = ctx().name2;
    return fallback ? [fallback] : [];
}

export function getUserName() {
    return ctx().name1 || 'User';
}

/**
 * Лорбуки, которые таверна сейчас подключает к этому чату.
 * Map: имя → вид ('chat' | 'character' | 'persona' | 'global'),
 * в порядке: чат, персонаж, персона, глобальные.
 */
export function getActiveLorebooks() {
    const c = ctx();
    const result = new Map();
    const add = (name, kind) => {
        if (name && !result.has(name)) result.set(name, kind);
    };

    add(c.chatMetadata?.[METADATA_KEY], 'chat');

    for (const character of chatCharacters()) {
        add(character?.data?.extensions?.world, 'character');
        const extra = world_info?.charLore?.find((e) => e.name === characterFileName(character));
        for (const name of extra?.extraBooks || []) add(name, 'character');
    }

    add(c.powerUserSettings?.persona_description_lorebook, 'persona');

    for (const name of selected_world_info || []) add(name, 'global');

    // Отбрасываем то, чего уже нет среди лорбуков (удалили, а ссылка осталась).
    const existing = new Set(c.getWorldInfoNames?.() || []);
    for (const name of [...result.keys()]) {
        if (!existing.has(name)) result.delete(name);
    }
    return result;
}

/** Полный список: сначала активные (в их порядке), потом остальные по алфавиту. */
export function getLorebookList() {
    const active = getActiveLorebooks();
    const all = ctx().getWorldInfoNames?.() || [];
    const rest = all
        .filter((name) => !active.has(name))
        .sort((a, b) => a.localeCompare(b, 'ru'));
    return [
        ...[...active.entries()].map(([name, kind]) => ({ name, activeKind: kind })),
        ...rest.map((name) => ({ name, activeKind: null })),
    ];
}

// ---------------------------------------------------------------------------
// Выбор в чате
// ---------------------------------------------------------------------------

/**
 * Какие лорбуки отмечены в этом чате прямо сейчас.
 * saved.lorebooks — что отмечено, saved.knownActive — какие были активны в момент сохранения.
 * Новый активный лорбук отмечается сам, а снятая галочка остаётся снятой.
 * Если в чате ещё ничего не сохраняли — отмечены все активные.
 */
export function resolveLoreSelection(saved) {
    const active = getActiveLorebooks();
    if (!saved || !Array.isArray(saved.lorebooks)) return new Set(active.keys());
    const selected = new Set(saved.lorebooks);
    const known = new Set(saved.knownActive || []);
    for (const name of active.keys()) {
        if (!known.has(name)) selected.add(name);
    }
    return selected;
}

export function defaultSourceFlags() {
    return { card: true, persona: true, firstMes: false };
}

export function getSourceFlags(saved) {
    const defaults = defaultSourceFlags();
    const s = saved || {};
    return {
        card: typeof s.card === 'boolean' ? s.card : defaults.card,
        persona: typeof s.persona === 'boolean' ? s.persona : defaults.persona,
        firstMes: typeof s.firstMes === 'boolean' ? s.firstMes : defaults.firstMes,
    };
}

/** Записывает выбор в хранилище чата (вместе со снимком активных лорбуков). */
export function storeSources(store, flags, selectedNames) {
    if (!store) return;
    store.sources = {
        ...getSourceFlags(store.sources),
        ...flags,
        lorebooks: [...selectedNames],
        knownActive: [...getActiveLorebooks().keys()],
    };
}

// ---------------------------------------------------------------------------
// Тексты источников
// ---------------------------------------------------------------------------

function cardFields() {
    try {
        return ctx().getCharacterCardFields?.() || {};
    } catch (error) {
        console.warn('[Junket] не удалось прочитать карточку персонажа', error);
        return {};
    }
}

export function getCardText() {
    const fields = cardFields();
    const parts = [];
    if (fields.description) parts.push(`## Description\n${fields.description}`);
    if (fields.personality) parts.push(`## Personality\n${fields.personality}`);
    if (fields.scenario) parts.push(`## Scenario\n${fields.scenario}`);
    return parts.join('\n\n');
}

export function getFirstMessageText() {
    const c = ctx();
    if (c.groupId) return '';
    const character = c.characters?.[c.characterId];
    const raw = String(character?.first_mes || '').trim();
    if (!raw) return '';
    try {
        return c.substituteParams(raw);
    } catch {
        return raw;
    }
}

export function getPersonaText() {
    return String(cardFields().persona || '').trim();
}

async function loadLoreEntries(name) {
    try {
        const book = await ctx().loadWorldInfo?.(name);
        const entries = book?.entries && typeof book.entries === 'object' ? Object.values(book.entries) : [];
        return entries
            .filter((e) => !e?.disable && String(e?.content || '').trim())
            .sort((a, b) => (a.displayIndex ?? a.uid ?? 0) - (b.displayIndex ?? b.uid ?? 0))
            .map((e) => {
                const title = String(e.comment || '').trim();
                const content = String(e.content).trim();
                return title ? `### ${title}\n${content}` : content;
            });
    } catch (error) {
        console.warn(`[Junket] не удалось прочитать лорбук "${name}"`, error);
        return [];
    }
}

// ---------------------------------------------------------------------------
// Токены
// ---------------------------------------------------------------------------

export async function countTokens(text) {
    const str = String(text || '');
    if (!str.trim()) return 0;
    try {
        return await ctx().getTokenCountAsync(str);
    } catch {
        // Подстраховка, если токенайзер недоступен: грубо — 1 токен на ~3.5 символа.
        return Math.ceil(str.length / 3.5);
    }
}

// Вес лорбука считаем один раз за открытие окна.
const loreTokenCache = new Map();

export function resetLoreTokenCache() {
    loreTokenCache.clear();
}

export function countLorebookTokens(name) {
    if (loreTokenCache.has(name)) return loreTokenCache.get(name);
    const promise = loadLoreEntries(name).then((entries) => countTokens(entries.join('\n\n')));
    loreTokenCache.set(name, promise);
    return promise;
}

// ---------------------------------------------------------------------------
// Сообщения сцены
// ---------------------------------------------------------------------------

/** Текст сообщения для модели: без мыслей, картинок, стилей и html-тегов. */
export function cleanMessageText(text) {
    return String(text ?? '')
        .replace(/<(think|thinking|reasoning|thought|rp_preflight)>[\s\S]*?<\/\1>/gi, '')
        .replace(/^[\s\S]*?<\/(?:think|thinking|reasoning|thought|rp_preflight)>/i, '')
        .replace(/<(style|script)[^>]*>[\s\S]*?<\/\1>/gi, '')
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/<[^>]*>/g, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

/** Выбранные сообщения в виде «#520 Levi: текст». Скрытые тоже идут. */
export function buildSceneText(from, to) {
    const chat = ctx().chat || [];
    const lines = [];
    for (let i = from; i <= to; i++) {
        const msg = chat[i];
        if (!msg) continue;
        const text = cleanMessageText(msg.mes);
        if (!text) continue;
        lines.push(`#${i} ${msg.name || (msg.is_user ? getUserName() : '???')}: ${text}`);
    }
    return lines.join('\n\n');
}

// ---------------------------------------------------------------------------
// Сборка источников
// ---------------------------------------------------------------------------

/**
 * Собирает карточку, персону, первое сообщение и лорбуки в один текст.
 * Лорбуки идут в порядке списка (сначала активные). Не влезли в лимит —
 * записи с конца отрезаются целиком.
 * Возвращает { text, loreTokens, loreLimit, droppedEntries }.
 */
export async function collectSources(saved) {
    const flags = getSourceFlags(saved);
    const blocks = [];

    if (flags.card) {
        const card = getCardText();
        if (card) blocks.push(`# CHARACTER CARD\n${card}`);
    }
    if (flags.firstMes) {
        const first = getFirstMessageText();
        if (first) blocks.push(`# FIRST MESSAGE\n${first}`);
    }
    if (flags.persona) {
        const persona = getPersonaText();
        if (persona) blocks.push(`# USER PERSONA (${getUserName()})\n${persona}`);
    }

    const loreLimit = Number(getSettings().loreTokenLimit) || 30000;
    const selected = resolveLoreSelection(saved);
    const ordered = getLorebookList().map((item) => item.name).filter((name) => selected.has(name));

    let loreTokens = 0;
    let droppedEntries = 0;
    let limitReached = false;

    for (const name of ordered) {
        const entries = await loadLoreEntries(name);
        const kept = [];
        for (const entry of entries) {
            if (limitReached) {
                droppedEntries++;
                continue;
            }
            const tokens = await countTokens(entry);
            if (loreTokens + tokens > loreLimit) {
                limitReached = true;
                droppedEntries++;
                continue;
            }
            loreTokens += tokens;
            kept.push(entry);
        }
        if (kept.length) blocks.push(`# LOREBOOK: ${name}\n${kept.join('\n\n')}`);
    }

    return { text: blocks.join('\n\n'), loreTokens, loreLimit, droppedEntries };
}

// ---------------------------------------------------------------------------
// Источники для «Сочинить список» (банк вопросов)
// ---------------------------------------------------------------------------

export const BANK_RECENT_MESSAGES = 30;

/** Имя лорбука, привязанного к чату (или '' — не привязан / удалён). */
export function getChatLorebookName() {
    const c = ctx();
    const name = c.chatMetadata?.[METADATA_KEY];
    return name && (c.getWorldInfoNames?.() || []).includes(name) ? name : '';
}

/**
 * Карточка, персона, лорбук, привязанный к чату (в лимите токенов), и по желанию
 * последние сообщения. Возвращает { text, droppedEntries, hasLore }.
 */
export async function collectBankSources({ recent = false } = {}) {
    const c = ctx();
    const blocks = [];
    const card = getCardText();
    if (card) blocks.push(`# CHARACTER CARD\n${card}`);
    const persona = getPersonaText();
    if (persona) blocks.push(`# USER PERSONA (${getUserName()})\n${persona}`);

    let droppedEntries = 0;
    const chatBook = c.chatMetadata?.[METADATA_KEY];
    const hasLore = Boolean(chatBook) && (c.getWorldInfoNames?.() || []).includes(chatBook);
    if (hasLore) {
        const loreLimit = Number(getSettings().loreTokenLimit) || 30000;
        let loreTokens = 0;
        const kept = [];
        for (const entry of await loadLoreEntries(chatBook)) {
            const tokens = await countTokens(entry);
            if (loreTokens + tokens > loreLimit) {
                droppedEntries++;
                continue;
            }
            loreTokens += tokens;
            kept.push(entry);
        }
        if (kept.length) blocks.push(`# LOREBOOK: ${chatBook} (story summaries)\n${kept.join('\n\n')}`);
    }

    if (recent) {
        const last = (c.chat || []).length - 1;
        if (last >= 0) {
            const from = Math.max(0, last - BANK_RECENT_MESSAGES + 1);
            const text = buildSceneText(from, last);
            if (text) blocks.push(`# RECENT MESSAGES (#${from}–#${last})\n${text}`);
        }
    }

    return { text: blocks.join('\n\n'), droppedEntries, hasLore };
}

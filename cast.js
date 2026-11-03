// Junket — кастинг: кто играет персов, персону и НПС в этом чате.
//
// В метаданных чата (store.cast):
//   mains — { 'Имя из карточки': { actor, notes } } — главные роли (персы и персона)
//   npcs  — [{ id, name, actor, notes }] — НПС, которых можно звать в студию
// Пустое имя актёра — модель придумывает его заново в каждом интервью.

import { ctx, makeId } from './store.js';
import { user_avatar } from '../../../personas.js';

function thumb(type, file) {
    if (!file) return '';
    try {
        return ctx().getThumbnailUrl(type, file);
    } catch {
        return `/thumbnail?type=${type}&file=${encodeURIComponent(file)}`;
    }
}

/** Главные роли текущего чата: персы (в группе — все участники) и персона. */
export function getMainRoles() {
    const c = ctx();
    const roles = [];
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
    for (const ch of characters) {
        if (ch?.name) roles.push({ name: ch.name, avatar: thumb('avatar', ch.avatar), kind: 'char' });
    }
    if (c.name1 && !roles.some((r) => r.name === c.name1)) {
        roles.push({ name: c.name1, avatar: thumb('persona', user_avatar), kind: 'persona' });
    }
    return roles;
}

function cleanEntry(entry) {
    return {
        actor: typeof entry?.actor === 'string' ? entry.actor : '',
        notes: typeof entry?.notes === 'string' ? entry.notes : '',
    };
}

/** Приводит сохранённый каст к правильному виду. */
export function normalizeCast(saved) {
    const s = saved && typeof saved === 'object' ? saved : {};
    const mains = {};
    if (s.mains && typeof s.mains === 'object') {
        for (const [name, entry] of Object.entries(s.mains)) mains[name] = cleanEntry(entry);
    }
    const npcs = Array.isArray(s.npcs)
        ? s.npcs
            .filter((n) => n && typeof n === 'object')
            .map((n) => ({ id: typeof n.id === 'string' && n.id ? n.id : makeId(), name: typeof n.name === 'string' ? n.name : '', ...cleanEntry(n) }))
        : [];
    return { mains, npcs };
}

export function newNpc() {
    return { id: makeId(), name: '', actor: '', notes: '' };
}

/** НПС, которых можно позвать (с непустым именем). */
export function invitableNpcs(cast) {
    return cast.npcs.filter((n) => n.name.trim());
}

/**
 * Что вписать в каст из готового интервью: персонаж → актёр.
 * Возвращает { mains: [{ name, actor }], npcs: [{ name, actor, existingId|null }] }.
 */
export function castFromTurns(turns, cast) {
    const roles = getMainRoles();
    const seen = new Map();
    for (const turn of turns) {
        if (turn.kind !== 'a' || !turn.character || !turn.actor) continue;
        const key = turn.character.trim().toLowerCase();
        if (!seen.has(key)) seen.set(key, { character: turn.character.trim(), actor: turn.actor.trim() });
    }
    const result = { mains: [], npcs: [] };
    for (const { character, actor } of seen.values()) {
        const role = roles.find((r) => r.name.trim().toLowerCase() === character.toLowerCase());
        if (role) {
            result.mains.push({ name: role.name, actor });
        } else {
            const existing = cast.npcs.find((n) => n.name.trim().toLowerCase() === character.toLowerCase());
            result.npcs.push({ name: existing?.name || character, actor, existingId: existing?.id || null });
        }
    }
    return result;
}

/** Записывает найденное castFromTurns в каст (заметки «каков в жизни» не трогает). */
export function applyCast(cast, found) {
    for (const { name, actor } of found.mains) {
        cast.mains[name] = { ...cleanEntry(cast.mains[name]), actor };
    }
    for (const { name, actor, existingId } of found.npcs) {
        const existing = existingId ? cast.npcs.find((n) => n.id === existingId) : null;
        if (existing) existing.actor = actor;
        else cast.npcs.push({ ...newNpc(), name, actor });
    }
    return cast;
}

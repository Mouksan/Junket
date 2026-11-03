// Junket — интервью персонажей как актёров
// Этап 1: фундамент — окно, вкладки, архив интервью у каждого чата свой
// Этап 2: выбор диапазона сообщений с превью
// Этап 3: подключение к модели, «Что знает модель», первая сырая генерация
// Этап 4: журнальная вёрстка интервью и архив
// Этап 5а: «Как снимаем» — формат, вопросы, болтовня, вайбы, пожелания
// Этап 5б: кастинг — актёры и НПС в чате, «Кто в студии», «Закрепить каст»

import {
    ctx, getSettings, escapeHtml, makeId, formatDate, formatNumber, confirmPopup,
    currentChatId, getChatStore, saveChatStore, saveChatStoreDebounced, TOAST_TITLE,
} from './store.js';
import {
    ACTIVE_KIND_LABELS, getLorebookList, resolveLoreSelection, getSourceFlags, storeSources,
    countLorebookTokens, resetLoreTokenCache, collectSources, buildSceneText,
} from './sources.js';
import { buildInterviewPrompt } from './prompt.js';
import { requestModel } from './connection.js';
import { addSettingsDrawer } from './settings.js';
import { parseInterview, renderInterviewHtml, interviewPlainText, defaultTitle } from './render.js';
import {
    FORMATS, FAN_VENUES, BANTER, VIBES, STUDIO, QUESTIONS_MIN, QUESTIONS_MAX,
    getFormat, normalizeShoot, formatLabel,
} from './formats.js';
import { getMainRoles, normalizeCast, newNpc, invitableNpcs, castFromTurns, applyCast } from './cast.js';

// ---------- Окно ----------

let overlayEl = null;
let activeTab = 'new';

function buildWindow() {
    const overlay = document.createElement('div');
    overlay.id = 'jnk-overlay';
    overlay.className = 'jnk-overlay';
    overlay.innerHTML = `
        <div class="jnk-window" role="dialog" aria-label="Junket">
            <div class="jnk-header">
                <div class="jnk-title"><i class="fa-solid fa-clapperboard"></i><span>「 JUNKET 」</span></div>
                <div class="jnk-chatname"></div>
                <button class="jnk-close" type="button" title="Закрыть"><i class="fa-solid fa-xmark"></i></button>
            </div>
            <div class="jnk-tabs">
                <button class="jnk-tab" type="button" data-tab="new">Новое интервью</button>
                <button class="jnk-tab" type="button" data-tab="cast">Кастинг</button>
                <button class="jnk-tab" type="button" data-tab="archive">Архив</button>
            </div>
            <div class="jnk-body">
                <section class="jnk-pane" data-pane="new"></section>
                <section class="jnk-pane" data-pane="cast"></section>
                <section class="jnk-pane" data-pane="archive"></section>
            </div>
        </div>`;

    overlay.querySelector('.jnk-close').addEventListener('click', closeWindow);

    // Клик мимо окна закрывает его (mousedown, чтобы выделение текста не закрывало случайно)
    overlay.addEventListener('mousedown', (e) => {
        if (e.target === overlay) closeWindow();
    });

    overlay.querySelectorAll('.jnk-tab').forEach((btn) => {
        btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });

    document.body.appendChild(overlay);
    return overlay;
}

function onKeyDown(e) {
    if (e.key === 'Escape' && isOpen()) {
        // Если поверх открыт попап таверны — пусть он сам обработает Esc
        if (document.querySelector('dialog[open]')) return;
        closeWindow();
    }
}

function isOpen() {
    return Boolean(overlayEl && overlayEl.classList.contains('jnk-open'));
}

function openWindow(tab) {
    if (!overlayEl) overlayEl = buildWindow();
    if (tab) activeTab = tab;
    overlayEl.classList.add('jnk-open');
    document.addEventListener('keydown', onKeyDown);
    // Лорбуки могли поменяться, пока окно было закрыто — веса пересчитаем
    resetLoreTokenCache();
    renderAll();
}

function closeWindow() {
    if (!overlayEl) return;
    overlayEl.classList.remove('jnk-open');
    document.removeEventListener('keydown', onKeyDown);
}

function switchTab(tab) {
    activeTab = tab;
    renderTabs();
    // Каст могли поменять — «Кто в студии» на новом интервью должен это увидеть
    if (tab === 'new') renderNewPane();
    if (tab === 'cast') renderCast();
    if (tab === 'archive') renderArchive();
}

function renderAll() {
    renderHeader();
    renderTabs();
    renderNewPane();
    renderCast();
    renderArchive();
}

function renderHeader() {
    if (!overlayEl) return;
    const el = overlayEl.querySelector('.jnk-chatname');
    const chatId = currentChatId();
    el.textContent = chatId ? `Чат: ${chatId}` : 'Чат не открыт';
    el.title = chatId || '';
}

function renderTabs() {
    if (!overlayEl) return;
    overlayEl.querySelectorAll('.jnk-tab').forEach((btn) => {
        btn.classList.toggle('jnk-active', btn.dataset.tab === activeTab);
    });
    overlayEl.querySelectorAll('.jnk-pane').forEach((pane) => {
        pane.classList.toggle('jnk-active', pane.dataset.pane === activeTab);
    });
}

// ---------- Выбор сообщений ----------

const QUICK_LAST = [10, 20];   // кнопки «Последние N»; первое число — заодно выбор по умолчанию
const PREVIEW_CHARS = 120;     // сколько символов показывать в превью

// Черновик диапазона для каждого чата (живёт до перезагрузки страницы)
const rangeDrafts = new Map();

function getChatMessages() {
    return ctx().chat || [];
}

function lastIndex() {
    return getChatMessages().length - 1;
}

function defaultRange() {
    const last = lastIndex();
    if (last < 0) return { from: '', to: '' };
    return { from: Math.max(0, last - (QUICK_LAST[0] - 1)), to: last };
}

function getDraft() {
    const chatId = currentChatId();
    if (!chatId) return { from: '', to: '' };
    if (!rangeDrafts.has(chatId)) rangeDrafts.set(chatId, defaultRange());
    return rangeDrafts.get(chatId);
}

function setDraft(from, to) {
    const chatId = currentChatId();
    if (!chatId) return;
    rangeDrafts.set(chatId, { from, to });
}

function parseIndex(value) {
    if (value === '' || value === null || value === undefined) return null;
    const n = Number(value);
    return Number.isInteger(n) ? n : NaN;
}

// Проверка диапазона: возвращает { ok, from, to, error }
function validateRange(draft) {
    const last = lastIndex();
    if (last < 0) return { ok: false, error: 'В этом чате пока нет сообщений.' };

    const from = parseIndex(draft.from);
    const to = parseIndex(draft.to);

    if (from === null || to === null) return { ok: false, error: 'Укажи, с какого и по какое сообщение.' };
    if (Number.isNaN(from) || Number.isNaN(to)) return { ok: false, error: 'Номера сообщений — целые числа.' };
    if (from < 0 || to < 0 || from > last || to > last) {
        return { ok: false, error: `В этом чате сообщения с 0 по ${last}.` };
    }
    if (from > to) return { ok: false, error: '«С» должно быть не больше, чем «По».' };

    return { ok: true, from, to };
}

// Готовый диапазон для генерации; null, если выбран неверно
function getSelectedRange() {
    const result = validateRange(getDraft());
    return result.ok ? { from: result.from, to: result.to } : null;
}

function lastInterviewRangeEnd() {
    const store = getChatStore();
    if (!store) return null;
    const withRange = store.interviews.filter((item) => item.range && Number.isInteger(item.range.to));
    if (!withRange.length) return null;
    return Math.max(...withRange.map((item) => item.range.to));
}

function cleanPreviewText(text) {
    return String(text ?? '')
        .replace(/<(think|thinking|reasoning|thought|rp_preflight)>[\s\S]*?<\/\1>/gi, ' ')
        .replace(/<[^>]*>/g, ' ')
        .replace(/[*_~`]+/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function previewRowHtml(index) {
    const msg = getChatMessages()[index];
    if (!msg) return '';
    const text = cleanPreviewText(msg.mes);
    const short = text.length > PREVIEW_CHARS ? `${text.slice(0, PREVIEW_CHARS).trimEnd()}…` : (text || '(пусто)');
    const who = msg.is_user ? 'jnk-from-user' : 'jnk-from-char';
    const hidden = msg.is_system ? '<span class="jnk-badge" title="Сообщение скрыто от модели в самом чате">скрыто</span>' : '';
    return `
        <div class="jnk-preview-row ${who}">
            <span class="jnk-preview-id">#${index}</span>
            <span class="jnk-preview-name">${escapeHtml(msg.name || '???')}</span>${hidden}
            <span class="jnk-preview-text">${escapeHtml(short)}</span>
        </div>`;
}

function renderPreview() {
    if (!overlayEl) return;
    const box = overlayEl.querySelector('.jnk-preview');
    const summary = overlayEl.querySelector('.jnk-range-summary');
    if (!box || !summary) return;

    const result = validateRange(getDraft());
    if (!result.ok) {
        summary.innerHTML = `<span class="jnk-error">${escapeHtml(result.error)}</span>`;
        box.innerHTML = '';
        box.classList.add('jnk-hidden');
        updateGoButton();
        return;
    }

    const { from, to } = result;
    const count = to - from + 1;
    summary.textContent = `Выбрано сообщений: ${count}`;

    // Только первое и последнее — чтобы проверить, что не промахнулась
    let rows = previewRowHtml(from);
    if (count > 2) rows += `<div class="jnk-preview-gap">… ещё ${count - 2} сообщ. между ними …</div>`;
    if (count > 1) rows += previewRowHtml(to);

    box.innerHTML = rows;
    box.classList.remove('jnk-hidden');
    updateGoButton();
}

function applyRange(from, to) {
    setDraft(from, to);
    if (!overlayEl) return;
    const fromInput = overlayEl.querySelector('.jnk-range-from');
    const toInput = overlayEl.querySelector('.jnk-range-to');
    if (fromInput) fromInput.value = from;
    if (toInput) toInput.value = to;
    renderPreview();
}

function rangeSectionHtml() {
    const draft = getDraft();
    const sinceLast = lastInterviewRangeEnd();
    const quickButtons = QUICK_LAST
        .map((n) => `<button class="jnk-chip" type="button" data-last="${n}">Последние ${n}</button>`)
        .join('');

    return `
        <div class="jnk-section">
            <div class="jnk-section-title">Какие сообщения</div>
            <div class="jnk-range-row">
                <label class="jnk-range-field">
                    <span>С</span>
                    <input class="jnk-range-from text_pole" type="number" min="0" step="1" inputmode="numeric" value="${escapeHtml(draft.from)}">
                </label>
                <label class="jnk-range-field">
                    <span>По</span>
                    <input class="jnk-range-to text_pole" type="number" min="0" step="1" inputmode="numeric" value="${escapeHtml(draft.to)}">
                </label>
            </div>
            <div class="jnk-chips">
                ${quickButtons}
                <button class="jnk-chip jnk-since-last" type="button" ${sinceLast === null ? 'disabled title="В этом чате ещё не было интервью"' : ''}>С прошлого интервью</button>
            </div>
            <div class="jnk-hint">Номера — как у сообщений в таверне (#520).</div>
            <div class="jnk-range-summary"></div>
            <div class="jnk-preview jnk-hidden"></div>
        </div>`;
}

function bindRangeSection(pane) {
    const fromInput = pane.querySelector('.jnk-range-from');
    const toInput = pane.querySelector('.jnk-range-to');
    let typingTimer = null;
    const onType = () => {
        setDraft(fromInput.value, toInput.value);
        clearTimeout(typingTimer);
        typingTimer = setTimeout(renderPreview, 250);
    };
    fromInput.addEventListener('input', onType);
    toInput.addEventListener('input', onType);

    pane.querySelectorAll('[data-last]').forEach((btn) => {
        btn.addEventListener('click', () => {
            const last = lastIndex();
            if (last < 0) return;
            const n = Number(btn.dataset.last);
            applyRange(Math.max(0, last - n + 1), last);
        });
    });

    pane.querySelector('.jnk-since-last').addEventListener('click', () => {
        const end = lastInterviewRangeEnd();
        const last = lastIndex();
        if (end === null || last < 0) return;
        if (end >= last) {
            toastr.info('После прошлого интервью новых сообщений ещё нет', TOAST_TITLE);
            return;
        }
        applyRange(end + 1, last);
    });
}

// ---------- Как снимаем ----------

function getShoot() {
    return normalizeShoot(getChatStore()?.shoot);
}

function saveShoot(shoot) {
    const store = getChatStore();
    if (!store) return;
    store.shoot = shoot;
    saveChatStoreDebounced();
}

function chipsHtml(items, selectedId, attr) {
    return items.map((item) => `
        <button class="jnk-chip ${item.id === selectedId ? 'jnk-chip-on' : ''}" type="button" ${attr}="${item.id}">${item.icon ? `${item.icon} ` : ''}${escapeHtml(item.label)}</button>`).join('');
}

function shootSectionHtml() {
    const shoot = getShoot();
    // «Актёры между собой» в режиме «Персонажи» не нужны: у героев своя динамика из ролки
    const vibeRows = VIBES.map((group) => `
        <div class="jnk-vibe-row" ${group.id === 'chemistry' ? `data-actors-only ${shoot.studio === 'characters' ? 'hidden' : ''}` : ''}>
            <span class="jnk-vibe-name">${escapeHtml(group.label)}</span>
            <div class="jnk-chips" data-vibe-group="${group.id}">
                ${chipsHtml(group.options, shoot.vibes[group.id], 'data-vibe')}
            </div>
        </div>`).join('');

    return `
        <div class="jnk-section jnk-shoot">
            <div class="jnk-section-title">Как снимаем</div>

            <div class="jnk-subtitle">Кто в студии</div>
            <div class="jnk-seg jnk-studio">
                ${STUDIO.map((x) => `<button type="button" class="jnk-seg-btn ${x.id === shoot.studio ? 'active' : ''}" data-studio="${x.id}">${escapeHtml(x.label)}</button>`).join('')}
            </div>
            ${guestChipsHtml(shoot)}

            <div class="jnk-subtitle">Формат</div>
            <div class="jnk-chips">${chipsHtml(FORMATS, shoot.format, 'data-format')}</div>

            <div class="jnk-venue" ${shoot.format === 'fans' ? '' : 'hidden'}>
                <div class="jnk-subtitle">Где</div>
                <div class="jnk-chips">${chipsHtml(FAN_VENUES, shoot.venue, 'data-venue')}</div>
            </div>

            <div class="jnk-questions">
                <label class="jnk-subtitle" for="jnk_questions">Вопросов: <span class="jnk-qcount">${shoot.questions}</span></label>
                <input id="jnk_questions" class="jnk-range-slider" type="range" min="${QUESTIONS_MIN}" max="${QUESTIONS_MAX}" step="1" value="${shoot.questions}">
                <div class="jnk-hint">Уточнения и болтовня между вопросами не считаются.</div>
            </div>

            <div class="jnk-subtitle">Болтовня</div>
            <div class="jnk-seg jnk-banter">
                ${BANTER.map((b) => `<button type="button" class="jnk-seg-btn ${b.id === shoot.banter ? 'active' : ''}" data-banter="${b.id}">${escapeHtml(b.label)}</button>`).join('')}
            </div>
            <div class="jnk-hint jnk-wild-hint" ${shoot.banter === 'wild' ? '' : 'hidden'}>Длинные интервью — следи за лимитом токенов ответа.</div>

            <div class="jnk-subtitle">Вайбы</div>
            <div class="jnk-vibes">${vibeRows}</div>

            <label class="jnk-subtitle" for="jnk_wishes">Пожелания</label>
            <textarea id="jnk_wishes" class="text_pole jnk-wishes" rows="2" placeholder="Например: пусть Маркус постоянно спойлерит, а Киллиан его пинает под столом.">${escapeHtml(shoot.wishes)}</textarea>
        </div>`;
}

function getCast() {
    return normalizeCast(getChatStore()?.cast);
}

function guestChipsHtml(shoot) {
    const npcs = invitableNpcs(getCast());
    if (!npcs.length) return '';
    return `
        <div class="jnk-guests">
            <span class="jnk-vibe-name">НПС в студию</span>
            <div class="jnk-chips">
                ${npcs.map((n) => `<button class="jnk-chip ${shoot.guests.includes(n.id) ? 'jnk-chip-on' : ''}" type="button" data-guest="${escapeHtml(n.id)}">${escapeHtml(n.name)}</button>`).join('')}
            </div>
        </div>`;
}

function bindShootSection(pane) {
    const section = pane.querySelector('.jnk-shoot');
    if (!section) return;

    const setOn = (selector, el) => {
        section.querySelectorAll(selector).forEach((b) => b.classList.toggle('jnk-chip-on', b === el));
    };

    section.addEventListener('click', (e) => {
        const btn = e.target.closest('button');
        if (!btn) return;
        const shoot = getShoot();

        if (btn.dataset.studio) {
            shoot.studio = btn.dataset.studio;
            section.querySelectorAll('[data-studio]').forEach((b) => b.classList.toggle('active', b === btn));
            section.querySelectorAll('[data-actors-only]').forEach((row) => { row.hidden = shoot.studio === 'characters'; });
        } else if (btn.dataset.guest) {
            const id = btn.dataset.guest;
            const on = !shoot.guests.includes(id);
            shoot.guests = on ? [...shoot.guests, id] : shoot.guests.filter((g) => g !== id);
            btn.classList.toggle('jnk-chip-on', on);
        } else if (btn.dataset.format) {
            shoot.format = btn.dataset.format;
            shoot.questions = getFormat(shoot.format).questions;
            setOn('[data-format]', btn);
            section.querySelector('.jnk-venue').hidden = shoot.format !== 'fans';
            section.querySelector('#jnk_questions').value = shoot.questions;
            section.querySelector('.jnk-qcount').textContent = shoot.questions;
        } else if (btn.dataset.venue) {
            shoot.venue = btn.dataset.venue;
            setOn('[data-venue]', btn);
        } else if (btn.dataset.banter) {
            shoot.banter = btn.dataset.banter;
            section.querySelectorAll('[data-banter]').forEach((b) => b.classList.toggle('active', b === btn));
            section.querySelector('.jnk-wild-hint').hidden = shoot.banter !== 'wild';
        } else if (btn.dataset.vibe) {
            const group = btn.closest('[data-vibe-group]').dataset.vibeGroup;
            // Повторный клик по выбранному вайбу снимает его
            const turnOff = shoot.vibes[group] === btn.dataset.vibe;
            shoot.vibes[group] = turnOff ? null : btn.dataset.vibe;
            btn.closest('[data-vibe-group]').querySelectorAll('[data-vibe]').forEach((b) => {
                b.classList.toggle('jnk-chip-on', !turnOff && b === btn);
            });
        } else {
            return;
        }
        saveShoot(shoot);
    });

    const slider = section.querySelector('#jnk_questions');
    slider.addEventListener('input', () => {
        section.querySelector('.jnk-qcount').textContent = slider.value;
    });
    slider.addEventListener('change', () => {
        const shoot = getShoot();
        shoot.questions = Number(slider.value);
        saveShoot(shoot);
    });

    const wishes = section.querySelector('#jnk_wishes');
    wishes.addEventListener('input', () => {
        const shoot = getShoot();
        shoot.wishes = wishes.value;
        saveShoot(shoot);
    });
}

// ---------- Что знает модель ----------

let loreList = [];   // текущий список лорбуков в окне: { name, activeKind }

function sourcesSectionHtml() {
    const store = getChatStore();
    const flags = getSourceFlags(store?.sources);
    const selected = resolveLoreSelection(store?.sources);
    loreList = getLorebookList();

    const check = (flag, label) => `
        <label class="checkbox_label jnk-check">
            <input type="checkbox" data-flag="${flag}" ${flags[flag] ? 'checked' : ''}>
            <span>${label}</span>
        </label>`;

    const loreRows = loreList.length
        ? loreList.map((item, i) => `
            <label class="jnk-lore-row ${item.activeKind ? 'jnk-lore-active' : ''}">
                <input type="checkbox" data-lore="${i}" ${selected.has(item.name) ? 'checked' : ''}>
                <span class="jnk-lore-name">${escapeHtml(item.name)}</span>
                ${item.activeKind ? `<span class="jnk-badge">${escapeHtml(ACTIVE_KIND_LABELS[item.activeKind] || '')}</span>` : ''}
                <span class="jnk-lore-tokens" data-tokens="${i}">…</span>
            </label>`).join('')
        : '<div class="jnk-muted jnk-lore-empty">Лорбуков нет.</div>';

    return `
        <div class="jnk-section jnk-sources">
            <div class="jnk-section-title">Что знает модель</div>
            <div class="jnk-checks">
                ${check('card', 'Карточка персонажа')}
                ${check('persona', 'Персона')}
                ${check('firstMes', 'Первое сообщение')}
            </div>
            <div class="jnk-subtitle">Лорбуки</div>
            <div class="jnk-lore-list">${loreRows}</div>
            <div class="jnk-lore-summary"></div>
        </div>`;
}

function readSourcesFromPane(pane) {
    const flags = {};
    pane.querySelectorAll('[data-flag]').forEach((input) => {
        flags[input.dataset.flag] = input.checked;
    });
    const selectedNames = [];
    pane.querySelectorAll('[data-lore]').forEach((input) => {
        const item = loreList[Number(input.dataset.lore)];
        if (item && input.checked) selectedNames.push(item.name);
    });
    return { flags, selectedNames };
}

function bindSourcesSection(pane) {
    const section = pane.querySelector('.jnk-sources');
    if (!section) return;
    section.addEventListener('change', (e) => {
        if (!e.target.matches('[data-flag], [data-lore]')) return;
        const store = getChatStore();
        if (!store) return;
        const { flags, selectedNames } = readSourcesFromPane(section);
        storeSources(store, flags, selectedNames);
        saveChatStoreDebounced();
        if (e.target.matches('[data-lore]')) renderLoreSummary();
    });

    // Веса лорбуков подгружаются асинхронно
    loreList.forEach((item, i) => {
        countLorebookTokens(item.name).then((tokens) => {
            const el = section.querySelector(`[data-tokens="${i}"]`);
            if (el && el.isConnected) el.textContent = formatNumber(tokens);
        });
    });
    renderLoreSummary();
}

async function renderLoreSummary() {
    if (!overlayEl) return;
    const box = overlayEl.querySelector('.jnk-lore-summary');
    if (!box) return;
    const section = overlayEl.querySelector('.jnk-sources');
    const { selectedNames } = readSourcesFromPane(section);
    const limit = Number(getSettings().loreTokenLimit) || 30000;

    if (!loreList.length) {
        box.textContent = '';
        return;
    }
    if (!selectedNames.length) {
        box.innerHTML = '<span class="jnk-muted">Лорбуки не выбраны.</span>';
        return;
    }

    box.innerHTML = '<span class="jnk-muted">Считаю токены…</span>';
    const weights = await Promise.all(selectedNames.map((name) => countLorebookTokens(name)));
    if (!box.isConnected) return;
    const total = weights.reduce((sum, n) => sum + (Number(n) || 0), 0);
    const over = total > limit;
    box.innerHTML = `<span class="${over ? 'jnk-warn' : ''}">Лорбуки: ${formatNumber(total)} из ${formatNumber(limit)} токенов${over ? ' — лишнее отрежется с конца' : ''}</span>`;
}

// ---------- Генерация ----------

let generation = null;           // { controller, chatId } пока идёт запрос

function actionsSectionHtml() {
    return `
        <div class="jnk-actions">
            <button class="jnk-go" type="button"></button>
            <span class="jnk-status"></span>
        </div>`;
}

function updateGoButton() {
    if (!overlayEl) return;
    const btn = overlayEl.querySelector('.jnk-go');
    const status = overlayEl.querySelector('.jnk-status');
    if (!btn) return;
    const running = generation && generation.chatId === currentChatId();
    btn.classList.toggle('jnk-stop', Boolean(running));
    btn.innerHTML = running ? '<i class="fa-solid fa-stop"></i> Стоп' : 'Мотор! 🎬';
    btn.disabled = !running && !getSelectedRange();
    if (status) status.innerHTML = running ? '<i class="fa-solid fa-spinner fa-spin"></i> Снимаем…' : '';
}

function updateSinceLastChip() {
    if (!overlayEl) return;
    const chip = overlayEl.querySelector('.jnk-since-last');
    if (!chip) return;
    const has = lastInterviewRangeEnd() !== null;
    chip.disabled = !has;
    chip.title = has ? '' : 'В этом чате ещё не было интервью';
}

async function onGoClick() {
    if (generation) {
        // Стоп: кнопку отпускаем сразу. Если запрос идёт через текущее подключение
        // таверны, прервать его нельзя — ответ просто выбросим, когда придёт.
        generation.controller.junketQuiet = true;
        generation.controller.abort();
        generation = null;
        updateGoButton();
        toastr.info('Генерация остановлена', TOAST_TITLE);
        return;
    }

    const range = getSelectedRange();
    if (!range) {
        toastr.warning('Сначала выбери сообщения', TOAST_TITLE);
        return;
    }

    const chatId = currentChatId();
    const store = getChatStore();
    const controller = new AbortController();
    generation = { controller, chatId };
    let savedId = null;
    updateGoButton();

    try {
        const sources = await collectSources(store?.sources);
        if (controller.signal.aborted) throw new DOMException('Aborted', 'AbortError');

        const sceneText = buildSceneText(range.from, range.to);
        if (!sceneText) throw new Error('В выбранных сообщениях нет текста.');

        const shoot = getShoot();
        const { instruction, contextText } = buildInterviewPrompt({ sourcesText: sources.text, sceneText, ...range, shoot, cast: getCast() });
        const text = await requestModel({ instruction, contextText }, controller.signal);
        if (controller.signal.aborted) throw new DOMException('Aborted', 'AbortError');
        if (!text.trim()) throw new Error('Модель вернула пустой ответ — попробуй ещё раз или увеличь лимит токенов ответа.');

        // Сразу в архив чата: храним сырой текст, вёрстка собирается при показе
        const parsed = parseInterview(text);
        const item = {
            id: makeId(),
            createdAt: Date.now(),
            title: parsed.title || defaultTitle(range),
            range: { from: range.from, to: range.to },
            format: shoot.format,
            studio: shoot.studio,
            venue: shoot.format === 'fans' ? shoot.venue : null,
            text,
        };
        const saveTo = getChatStore();
        if (saveTo && currentChatId() === chatId) {
            saveTo.interviews.unshift(item);
            await saveChatStore();
            savedId = item.id;
            // Готовое интервью сразу открывается в архиве (и при следующем открытии окна тоже)
            archiveOpenId = item.id;
            activeTab = 'archive';
        }
        if (sources.droppedEntries) {
            toastr.warning(`Лорбуки не влезли в лимит, отрезано записей: ${sources.droppedEntries}`, TOAST_TITLE);
        }
        toastr.success('Интервью снято и лежит в архиве 🎬', TOAST_TITLE);
    } catch (error) {
        if (controller.signal.aborted || error?.name === 'AbortError') {
            if (!controller.junketQuiet) toastr.info('Генерация остановлена', TOAST_TITLE);
        } else {
            console.error('[Junket]', error);
            toastr.error(String(error?.message || error), TOAST_TITLE);
        }
    } finally {
        if (generation?.controller === controller) generation = null;
        if (isOpen()) {
            updateGoButton();
            if (currentChatId() === chatId) {
                updateSinceLastChip();
                renderArchive();
                if (savedId) {
                    renderTabs();
                    overlayEl.querySelector('.jnk-body')?.scrollTo?.({ top: 0 });
                }
            }
        }
    }
}

// ---------- Вкладка «Новое интервью» ----------

function renderNewPane() {
    if (!overlayEl) return;
    const pane = overlayEl.querySelector('[data-pane="new"]');
    if (!currentChatId()) {
        pane.innerHTML = `<div class="jnk-empty">Открой чат, чтобы снять интервью по его сценам 🎬</div>`;
        return;
    }

    pane.innerHTML = `${rangeSectionHtml()}${shootSectionHtml()}${sourcesSectionHtml()}${actionsSectionHtml()}`;

    bindRangeSection(pane);
    bindShootSection(pane);
    bindSourcesSection(pane);
    pane.querySelector('.jnk-go').addEventListener('click', onGoClick);

    renderPreview();
}

function onChatMessagesChanged() {
    // Новое/удалённое/изменённое сообщение — освежаем превью, если окно открыто
    if (isOpen()) renderPreview();
}

// ---------- Кастинг ----------

function saveCast(cast) {
    const store = getChatStore();
    if (!store) return;
    store.cast = cast;
    saveChatStoreDebounced();
}

function castFieldsHtml(entry, { withName = false } = {}) {
    return `
        ${withName ? `
        <label class="jnk-cast-field">
            <span>Персонаж</span>
            <input class="text_pole" data-field="name" type="text" placeholder="Как в сюжете, например: Эмин" value="${escapeHtml(entry.name)}">
        </label>` : ''}
        <label class="jnk-cast-field">
            <span>Актёр</span>
            <input class="text_pole" data-field="actor" type="text" placeholder="Пусто — модель придумает сама" value="${escapeHtml(entry.actor)}">
        </label>
        <label class="jnk-cast-field jnk-cast-notes">
            <span>Каков в жизни</span>
            <input class="text_pole" data-field="notes" type="text" placeholder="Например: в жизни булочка, вечно опаздывает, обожает лимоны" value="${escapeHtml(entry.notes)}">
        </label>`;
}

function renderCast() {
    if (!overlayEl) return;
    const pane = overlayEl.querySelector('[data-pane="cast"]');
    if (!getChatStore()) {
        pane.innerHTML = `<div class="jnk-empty">Открой чат — у каждого чата свой каст.</div>`;
        return;
    }
    const cast = getCast();
    const roles = getMainRoles();

    const mains = roles.map((role) => {
        const entry = cast.mains[role.name] || { actor: '', notes: '' };
        return `
            <div class="jnk-cast-row" data-main="${escapeHtml(role.name)}">
                <div class="jnk-cast-who">
                    ${role.avatar ? `<img class="jnk-iv-avatar" src="${escapeHtml(role.avatar)}" alt="" loading="lazy">` : ''}
                    <span class="jnk-cast-role">${escapeHtml(role.name)}</span>
                    <span class="jnk-badge">${role.kind === 'persona' ? 'персона' : 'персонаж'}</span>
                </div>
                <div class="jnk-cast-fields">${castFieldsHtml(entry)}</div>
            </div>`;
    }).join('');

    const npcs = cast.npcs.map((npc) => `
        <div class="jnk-cast-row" data-npc="${escapeHtml(npc.id)}">
            <div class="jnk-cast-fields">
                ${castFieldsHtml(npc, { withName: true })}
                <button class="jnk-icon-btn jnk-npc-delete" type="button" title="Убрать НПС из каста"><i class="fa-solid fa-trash-can"></i></button>
            </div>
        </div>`).join('');

    pane.innerHTML = `
        <div class="jnk-hint jnk-cast-intro">Каст у каждого чата свой. Заполненные имена важнее правила про национальность актёров.</div>
        <div class="jnk-section">
            <div class="jnk-section-title">Главные роли</div>
            <div class="jnk-cast-list">${mains || '<div class="jnk-muted">В этом чате нет персонажей.</div>'}</div>
        </div>
        <div class="jnk-section jnk-cast-npcs">
            <div class="jnk-section-title">НПС</div>
            <div class="jnk-cast-list">${npcs}</div>
            <div><button class="jnk-btn jnk-add-npc" type="button">+ Добавить НПС</button></div>
        </div>`;

    pane.oninput = onCastInput;
    pane.querySelector('.jnk-add-npc').addEventListener('click', () => {
        const c = getCast();
        c.npcs.push(newNpc());
        saveCast(c);
        renderCast();
        overlayEl.querySelector('[data-pane="cast"] [data-npc]:last-of-type [data-field="name"]')?.focus();
    });
    pane.querySelectorAll('.jnk-npc-delete').forEach((btn) => {
        btn.addEventListener('click', () => {
            const id = btn.closest('[data-npc]').dataset.npc;
            const c = getCast();
            c.npcs = c.npcs.filter((n) => n.id !== id);
            saveCast(c);
            renderCast();
        });
    });
}

// Сохраняем на лету (oninput на панели — чтобы при перерисовке не копились слушатели)
function onCastInput(e) {
    const input = e.target.closest('[data-field]');
    if (!input) return;
    const row = input.closest('.jnk-cast-row');
    const field = input.dataset.field;
    const cast = getCast();
    if (row.dataset.main !== undefined) {
        const name = row.dataset.main;
        cast.mains[name] = { ...(cast.mains[name] || { actor: '', notes: '' }), [field]: input.value };
    } else {
        const npc = cast.npcs.find((n) => n.id === row.dataset.npc);
        if (!npc) return;
        npc[field] = input.value;
    }
    saveCast(cast);
}

// ---------- Архив ----------

let archiveOpenId = null;   // какое интервью открыто в архиве (null — список)

function renderArchive() {
    if (!overlayEl) return;
    const pane = overlayEl.querySelector('[data-pane="archive"]');
    const store = getChatStore();

    if (!store) {
        pane.innerHTML = `<div class="jnk-empty">Открой чат — у каждого чата свой архив интервью.</div>`;
        return;
    }

    const opened = archiveOpenId ? store.interviews.find((item) => item.id === archiveOpenId) : null;
    if (opened) {
        renderArchiveViewer(pane, opened);
        return;
    }
    archiveOpenId = null;

    const items = store.interviews;
    if (!items.length) {
        pane.innerHTML = `<div class="jnk-empty">В этом чате ещё не было интервью.<br><span class="jnk-muted">Сними первое на вкладке «Новое интервью» 🎬</span></div>`;
        return;
    }

    pane.innerHTML = `<div class="jnk-archive-list">${items.map((item) => {
        const meta = [
            formatLabel(item.format, item.venue),
            item.range ? `Сообщения ${item.range.from}–${item.range.to}` : (String(item.text || '').trim() ? '' : 'Пустая тестовая запись'),
            formatDate(item.createdAt),
        ].filter(Boolean).join(' · ');
        return `
            <div class="jnk-archive-item" data-id="${escapeHtml(item.id)}" tabindex="0" role="button">
                <div class="jnk-archive-main">
                    <div class="jnk-archive-title">${escapeHtml(item.title || defaultTitle(item.range))}</div>
                    <div class="jnk-archive-meta">${escapeHtml(meta)}</div>
                </div>
                <button class="jnk-icon-btn jnk-delete" type="button" title="Удалить из архива">
                    <i class="fa-solid fa-trash-can"></i>
                </button>
            </div>`;
    }).join('')}</div>`;

    pane.querySelectorAll('.jnk-archive-item').forEach((row) => {
        const open = () => {
            archiveOpenId = row.dataset.id;
            renderArchive();
            pane.scrollIntoView?.({ block: 'start' });
        };
        row.addEventListener('click', (e) => {
            if (e.target.closest('.jnk-delete')) return;
            open();
        });
        row.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') open();
        });
        row.querySelector('.jnk-delete').addEventListener('click', () => deleteInterview(row.dataset.id));
    });
}

function renderArchiveViewer(pane, item) {
    pane.innerHTML = `
        <div class="jnk-viewer-bar">
            <button class="jnk-btn jnk-back" type="button"><i class="fa-solid fa-arrow-left"></i> Все интервью</button>
            <div class="jnk-viewer-actions">
                ${item.studio === 'characters' || !String(item.text || '').trim() ? '' : '<button class="jnk-btn jnk-pin" type="button">📌 Закрепить каст</button>'}
                <button class="jnk-btn jnk-copy" type="button"><i class="fa-regular fa-copy"></i> Скопировать</button>
                <button class="jnk-btn jnk-btn-danger jnk-remove" type="button"><i class="fa-solid fa-trash-can"></i> Удалить</button>
            </div>
        </div>
        ${renderInterviewHtml(item)}`;

    pane.querySelector('.jnk-back').addEventListener('click', () => {
        archiveOpenId = null;
        renderArchive();
    });
    pane.querySelector('.jnk-copy').addEventListener('click', async () => {
        const ok = await copyToClipboard(interviewPlainText(item));
        if (ok) toastr.success('Интервью скопировано', TOAST_TITLE);
        else toastr.error('Не получилось скопировать', TOAST_TITLE);
    });
    pane.querySelector('.jnk-remove').addEventListener('click', () => deleteInterview(item.id));
    pane.querySelector('.jnk-pin')?.addEventListener('click', () => pinCast(item));
}

async function pinCast(item) {
    const cast = getCast();
    const found = castFromTurns(parseInterview(item.text).turns, cast);
    const pairs = [...found.mains, ...found.npcs].map((p) => `${p.name} — ${p.actor}`);
    if (!pairs.length) {
        toastr.info('В этом интервью не нашлось актёров, которых можно закрепить', TOAST_TITLE);
        return;
    }
    const ok = await confirmPopup(`Закрепить в касте: ${escapeHtml(pairs.join(', '))}?`);
    if (!ok) return;
    saveCast(applyCast(cast, found));
    toastr.success('Каст закреплён', TOAST_TITLE);
}

async function copyToClipboard(text) {
    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch {
        // Запасной путь для браузеров без доступа к буферу
        const area = document.createElement('textarea');
        area.value = text;
        area.style.position = 'fixed';
        area.style.opacity = '0';
        document.body.appendChild(area);
        area.select();
        let ok = false;
        try {
            ok = document.execCommand('copy');
        } catch {
            ok = false;
        }
        area.remove();
        return ok;
    }
}

async function deleteInterview(id) {
    const ok = await confirmPopup('Удалить это интервью из архива? Отменить не получится.');
    if (!ok) return;
    const store = getChatStore();
    if (!store) return;
    const index = store.interviews.findIndex((item) => item.id === id);
    if (index === -1) return;
    store.interviews.splice(index, 1);
    await saveChatStore();
    if (archiveOpenId === id) archiveOpenId = null;
    renderArchive();
    updateSinceLastChip();
}

// ---------- Встраивание в таверну ----------

function addWandButton() {
    const menu = document.getElementById('extensionsMenu');
    if (!menu || document.getElementById('jnk-wand')) return;

    const item = document.createElement('div');
    item.id = 'jnk-wand';
    item.className = 'list-group-item flex-container flexGap5 interactable';
    item.tabIndex = 0;
    item.innerHTML = `<div class="fa-solid fa-clapperboard extensionsMenuExtensionButton"></div><span>Junket</span>`;
    item.addEventListener('click', () => openWindow());
    menu.appendChild(item);
}

function onChatChanged() {
    // Запрос по старому чату больше не нужен
    if (generation) {
        generation.controller.junketQuiet = true;
        generation.controller.abort();
        generation = null;
        toastr.info('Генерация остановлена: сменился чат', TOAST_TITLE);
    }
    resetLoreTokenCache();
    archiveOpenId = null;
    // Окно открыто — перерисовываем под новый чат, иначе ничего не делаем
    if (isOpen()) renderAll();
}

jQuery(async () => {
    getSettings();
    addSettingsDrawer(() => openWindow());
    addWandButton();

    const { eventSource, event_types } = ctx();
    eventSource.on(event_types.CHAT_CHANGED, onChatChanged);

    for (const key of ['MESSAGE_RECEIVED', 'MESSAGE_SENT', 'MESSAGE_DELETED', 'MESSAGE_EDITED', 'MESSAGE_SWIPED']) {
        if (event_types[key]) eventSource.on(event_types[key], onChatMessagesChanged);
    }
});

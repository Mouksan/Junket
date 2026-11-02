// Junket — интервью персонажей как актёров
// Этап 1: фундамент — окно, вкладки, архив интервью у каждого чата свой
// Этап 2: выбор диапазона сообщений с превью
// Этап 3: подключение к модели, «Что знает модель», первая сырая генерация

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
                <button class="jnk-tab" type="button" data-tab="archive">Архив</button>
            </div>
            <div class="jnk-body">
                <section class="jnk-pane" data-pane="new"></section>
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
    if (tab === 'archive') renderArchive();
}

function renderAll() {
    renderHeader();
    renderTabs();
    renderNewPane();
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
const rawResults = new Map();    // chatId → { text, from, to } — сырой ответ, живёт до перезагрузки

function actionsSectionHtml() {
    return `
        <div class="jnk-actions">
            <button class="jnk-go" type="button"></button>
            <span class="jnk-status"></span>
        </div>
        <div class="jnk-result"></div>`;
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

function renderResult() {
    if (!overlayEl) return;
    const box = overlayEl.querySelector('.jnk-result');
    if (!box) return;
    const result = rawResults.get(currentChatId());
    if (!result) {
        box.innerHTML = '';
        return;
    }
    box.innerHTML = `
        <div class="jnk-section-title">Сырой ответ модели</div>
        <div class="jnk-hint">Сообщения ${result.from}–${result.to} · красивый вид будет на этапе 4</div>
        <pre class="jnk-raw">${escapeHtml(result.text)}</pre>`;
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
    updateGoButton();

    try {
        const sources = await collectSources(store?.sources);
        if (controller.signal.aborted) throw new DOMException('Aborted', 'AbortError');

        const sceneText = buildSceneText(range.from, range.to);
        if (!sceneText) throw new Error('В выбранных сообщениях нет текста.');

        const { instruction, contextText } = buildInterviewPrompt({ sourcesText: sources.text, sceneText, ...range });
        const text = await requestModel({ instruction, contextText }, controller.signal);
        if (controller.signal.aborted) throw new DOMException('Aborted', 'AbortError');
        if (!text.trim()) throw new Error('Модель вернула пустой ответ — попробуй ещё раз или увеличь лимит токенов ответа.');

        rawResults.set(chatId, { text, ...range });
        if (sources.droppedEntries) {
            toastr.warning(`Лорбуки не влезли в лимит, отрезано записей: ${sources.droppedEntries}`, TOAST_TITLE);
        }
        toastr.success('Интервью снято 🎬', TOAST_TITLE);
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
            if (currentChatId() === chatId) renderResult();
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

    pane.innerHTML = `${rangeSectionHtml()}${sourcesSectionHtml()}${actionsSectionHtml()}`;

    bindRangeSection(pane);
    bindSourcesSection(pane);
    pane.querySelector('.jnk-go').addEventListener('click', onGoClick);

    renderPreview();
    renderResult();
}

function onChatMessagesChanged() {
    // Новое/удалённое/изменённое сообщение — освежаем превью, если окно открыто
    if (isOpen()) renderPreview();
}

// ---------- Архив ----------

function renderArchive() {
    if (!overlayEl) return;
    const pane = overlayEl.querySelector('[data-pane="archive"]');
    const store = getChatStore();

    if (!store) {
        pane.innerHTML = `<div class="jnk-empty">Открой чат — у каждого чата свой архив интервью.</div>`;
        return;
    }

    const items = store.interviews;
    const listHtml = items.length
        ? items.map((item) => `
            <div class="jnk-archive-item" data-id="${escapeHtml(item.id)}">
                <div class="jnk-archive-main">
                    <div class="jnk-archive-title">${escapeHtml(item.title || 'Без названия')}</div>
                    <div class="jnk-archive-meta">
                        ${item.range ? `Сообщения ${escapeHtml(item.range.from)}–${escapeHtml(item.range.to)} · ` : ''}${escapeHtml(formatDate(item.createdAt))}
                    </div>
                </div>
                <button class="jnk-icon-btn jnk-delete" type="button" title="Удалить из архива">
                    <i class="fa-solid fa-trash-can"></i>
                </button>
            </div>`).join('')
        : `<div class="jnk-empty">В этом чате ещё не было интервью.<br><span class="jnk-muted">Сними первое на вкладке «Новое интервью» 🎬</span></div>`;

    pane.innerHTML = `
        <div class="jnk-archive-list">${listHtml}</div>
        <div class="jnk-devbar">
            <button class="jnk-btn jnk-test-add" type="button">🧪 Добавить тестовую запись</button>
            <span class="jnk-muted">Временная кнопка для проверки, уберём на этапе 4.</span>
        </div>`;

    pane.querySelectorAll('.jnk-delete').forEach((btn) => {
        btn.addEventListener('click', () => {
            const id = btn.closest('.jnk-archive-item')?.dataset.id;
            if (id) deleteInterview(id);
        });
    });
    pane.querySelector('.jnk-test-add').addEventListener('click', addTestRecord);
}

async function addTestRecord() {
    const store = getChatStore();
    if (!store) return;
    const n = store.interviews.length + 1;
    store.interviews.unshift({
        id: makeId(),
        createdAt: Date.now(),
        title: `Тестовое интервью №${n}`,
        range: null,
        test: true,
        text: '',
    });
    await saveChatStore();
    renderArchive();
    toastr.success('Тестовая запись добавлена в этот чат', TOAST_TITLE);
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
    renderArchive();
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

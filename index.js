// Junket — интервью персонажей как актёров
// Этап 1: фундамент — окно, вкладки, архив интервью у каждого чата свой
// Этап 2: выбор диапазона сообщений с превью

const MODULE = 'junket';     // ключ в extension_settings
const META_KEY = 'junket';   // ключ в метаданных чата

const DEFAULT_SETTINGS = Object.freeze({
    version: 1,
});

// ---------- Общее ----------

function ctx() {
    // Всегда берём свежий контекст: после смены чата объекты внутри меняются
    return SillyTavern.getContext();
}

function getSettings() {
    const c = ctx();
    if (!c.extensionSettings[MODULE] || typeof c.extensionSettings[MODULE] !== 'object') {
        c.extensionSettings[MODULE] = structuredClone(DEFAULT_SETTINGS);
    }
    const s = c.extensionSettings[MODULE];
    for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
        if (s[key] === undefined) s[key] = structuredClone(value);
    }
    return s;
}

function escapeHtml(text) {
    return String(text ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function makeId() {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function formatDate(ts) {
    try {
        return new Date(ts).toLocaleString('ru-RU', {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        });
    } catch {
        return '';
    }
}

async function confirmPopup(text) {
    const c = ctx();
    if (typeof c.callGenericPopup === 'function' && c.POPUP_TYPE) {
        const result = await c.callGenericPopup(text, c.POPUP_TYPE.CONFIRM);
        return result === 1;
    }
    return window.confirm(text);
}

// ---------- Данные чата ----------

function currentChatId() {
    return ctx().getCurrentChatId?.() || null;
}

function getChatStore() {
    if (!currentChatId()) return null;
    const meta = ctx().chatMetadata;
    if (!meta) return null;
    if (!meta[META_KEY] || typeof meta[META_KEY] !== 'object') {
        meta[META_KEY] = { interviews: [], cast: null };
    }
    const store = meta[META_KEY];
    if (!Array.isArray(store.interviews)) store.interviews = [];
    if (store.cast === undefined) store.cast = null;
    return store;
}

async function saveChatStore() {
    await ctx().saveMetadata();
}

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

const QUICK_LAST = [10, 20];          // кнопки «Последние N»
const PREVIEW_CHARS = 120;            // сколько символов показывать в превью
const PREVIEW_COLLAPSE_AFTER = 40;    // длиннее — показываем начало и конец, середину сворачиваем
const PREVIEW_EDGE = 15;              // сколько сообщений показывать с каждого края при сворачивании

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

// Готовый диапазон для генерации (понадобится на этапе 3); null, если выбран неверно
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
        .replace(/<(think|thinking|reasoning)>[\s\S]*?<\/\1>/gi, ' ')
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
        return;
    }

    const { from, to } = result;
    const count = to - from + 1;
    summary.textContent = `Выбрано сообщений: ${count}`;

    let rows = '';
    if (count > PREVIEW_COLLAPSE_AFTER) {
        for (let i = from; i < from + PREVIEW_EDGE; i++) rows += previewRowHtml(i);
        rows += `<div class="jnk-preview-gap">… ещё ${count - PREVIEW_EDGE * 2} сообщ. посередине …</div>`;
        for (let i = to - PREVIEW_EDGE + 1; i <= to; i++) rows += previewRowHtml(i);
    } else {
        for (let i = from; i <= to; i++) rows += previewRowHtml(i);
    }
    box.innerHTML = rows;
    box.classList.remove('jnk-hidden');
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

function renderNewPane() {
    if (!overlayEl) return;
    const pane = overlayEl.querySelector('[data-pane="new"]');
    if (!currentChatId()) {
        pane.innerHTML = `<div class="jnk-empty">Открой чат, чтобы снять интервью по его сценам 🎬</div>`;
        return;
    }

    const draft = getDraft();
    const sinceLast = lastInterviewRangeEnd();
    const quickButtons = QUICK_LAST
        .map((n) => `<button class="jnk-chip" type="button" data-last="${n}">Последние ${n}</button>`)
        .join('');

    pane.innerHTML = `
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
        </div>
        <div class="jnk-empty jnk-later">
            Источники, формат и вайбы появятся на следующем этапе.
        </div>`;

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
            toastr.info('После прошлого интервью новых сообщений ещё нет');
            return;
        }
        applyRange(end + 1, last);
    });

    renderPreview();
}

function onChatMessagesChanged() {
    // Новое/удалённое/изменённое сообщение — освежаем превью, если окно открыто
    if (isOpen()) renderPreview();
}

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

// ---------- Действия с архивом ----------

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
    toastr.success('Тестовая запись добавлена в этот чат');
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

function addSettingsDrawer() {
    const host = document.getElementById('extensions_settings2') || document.getElementById('extensions_settings');
    if (!host || document.getElementById('jnk-settings')) return;

    const wrap = document.createElement('div');
    wrap.id = 'jnk-settings';
    wrap.innerHTML = `
        <div class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b><i class="fa-solid fa-clapperboard" style="margin-right: 6px;"></i>「 JUNKET 」</b>
                <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content">
                <div class="jnk-drawer-hint">Интервью с актёрами по выбранным сценам чата.</div>
                <button class="menu_button jnk-open-btn" type="button">
                    <i class="fa-solid fa-clapperboard"></i> Открыть Junket
                </button>
            </div>
        </div>`;
    wrap.querySelector('.jnk-open-btn').addEventListener('click', () => openWindow());
    host.appendChild(wrap);
}

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
    // Окно открыто — перерисовываем под новый чат, иначе ничего не делаем
    if (isOpen()) renderAll();
}

jQuery(async () => {
    getSettings();
    addSettingsDrawer();
    addWandButton();

    const { eventSource, event_types } = ctx();
    eventSource.on(event_types.CHAT_CHANGED, onChatChanged);

    for (const key of ['MESSAGE_RECEIVED', 'MESSAGE_SENT', 'MESSAGE_DELETED', 'MESSAGE_EDITED', 'MESSAGE_SWIPED']) {
        if (event_types[key]) eventSource.on(event_types[key], onChatMessagesChanged);
    }
});

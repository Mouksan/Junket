// Junket — интервью персонажей как актёров
// Этап 1: фундамент — окно, вкладки, архив интервью у каждого чата свой

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
                <div class="jnk-title"><i class="fa-solid fa-clapperboard"></i><span>Junket</span></div>
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

function renderNewPane() {
    if (!overlayEl) return;
    const pane = overlayEl.querySelector('[data-pane="new"]');
    if (!currentChatId()) {
        pane.innerHTML = `<div class="jnk-empty">Открой чат, чтобы снять интервью по его сценам 🎬</div>`;
        return;
    }
    pane.innerHTML = `
        <div class="jnk-empty">
            Здесь будет площадка: выбор сообщений, источники, формат и вайбы.<br>
            <span class="jnk-muted">Появится на следующем этапе.</span>
        </div>`;
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
                <b><i class="fa-solid fa-clapperboard"></i> Junket</b>
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
});

// Junket — интервью персонажей как актёров
// Этап 1: фундамент — окно, вкладки, архив интервью у каждого чата свой
// Этап 2: выбор диапазона сообщений с превью
// Этап 3: подключение к модели, «Что знает модель», первая сырая генерация
// Этап 4: журнальная вёрстка интервью и архив
// Этап 5а: «Как снимаем» — формат, вопросы, болтовня, вайбы, пожелания
// Этап 5б: кастинг — актёры и НПС в чате, «Кто в студии», «Закрепить каст»
// Этап 5в: банк вопросов — списки, «именно эти» / «как примеры», редактор
// Этап 5г: вопросы из зала — раунды под интервью
// Реакции фандома: лента комментов под интервью (порт из ST-Comments)
// Темы: Журнал, Мессенджер, Газета, Сценарий, Досье; настройки переехали в окно (шестерёнка)
// «Сценарист в студии»: сюжет из Скетчбука Plotweaver, формат и сегмент под «После пилота»

import {
    ctx, getSettings, saveSettings, escapeHtml, makeId, formatDate, formatNumber, confirmPopup,
    currentChatId, getChatStore, saveChatStore, saveChatStoreDebounced, TOAST_TITLE, stripModelJunk,
} from './store.js';
import {
    ACTIVE_KIND_LABELS, getLorebookList, resolveLoreSelection, getSourceFlags, storeSources,
    countLorebookTokens, resetLoreTokenCache, collectSources, buildSceneText,
    collectBankSources, getChatLorebookName, normalizeRecentCount, BANK_RECENT_MIN, BANK_RECENT_MAX, BANK_RECENT_STEP,
} from './sources.js';
import { buildInterviewPrompt, buildAudiencePrompt, buildFeedPrompt, buildBankPrompt, buildWriterSegmentPrompt } from './prompt.js';
import { getSketchbookPlots, getSketchbookPage, planFromPage, getWriterPlan, setWriterPlan, ensureWriterPlan, getWriter } from './writer.js';
import {
    FEED_STYLES, FEED_COUNT_MIN, FEED_COUNT_MAX, getFeedStyle, loadFeedStyle, feedContract,
    parseComments, renderFeedHtml, feedPlainText,
} from './comments.js';
import { requestModel } from './connection.js';
import { addSettingsDrawer, settingsPaneHtml, bindSettingsPane, syncLookControls } from './settings.js';
import { initLaunchers, syncLaunchers, setLauncherBusy } from './launcher.js';
import { getTheme, normalizePaper, stageClass } from './themes.js';
import { parseInterview, renderInterviewHtml, interviewPlainText, defaultTitle, fullInterviewText, isWriterRound } from './render.js';
import {
    FORMATS, FAN_VENUES, BANTER, VIBES, STUDIO, BANK_MODES,
    getFormat, normalizeShoot, formatLabel, isReaction, WATCH_PLACES, PILOT_VENUES,
    isPilot, isWriter, WRITER_VENUES, WRITER_Q_MIN, WRITER_Q_MAX, questionsRange,
} from './formats.js';
import { getMainRoles, normalizeCast, newNpc, invitableNpcs, castFromTurns, applyCast } from './cast.js';
import { getBank, getList, listQuestions, addList, updateList, deleteList, questionsWord, parseGeneratedQuestions } from './bank.js';

// ---------- Окно ----------

let overlayEl = null;
let activeTab = 'new';
let settingsOpen = false;   // экран настроек поверх вкладок

function buildWindow() {
    const overlay = document.createElement('div');
    overlay.id = 'jnk-overlay';
    overlay.className = 'jnk-overlay';
    overlay.innerHTML = `
        <div class="jnk-window" role="dialog" aria-label="Junket">
            <div class="jnk-header">
                <div class="jnk-title"><i class="fa-solid fa-clapperboard"></i><span>「 JUNKET 」</span></div>
                <div class="jnk-chatname"></div>
                <button class="jnk-icon-btn jnk-gear" type="button" title="Настройки" aria-pressed="false"><i class="fa-solid fa-gear"></i></button>
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
                <section class="jnk-pane" data-pane="settings">
                    <div class="jnk-viewer-bar">
                        <button class="jnk-btn jnk-settings-back" type="button"><i class="fa-solid fa-arrow-left"></i> Назад</button>
                        <span class="jnk-settings-heading">Настройки</span>
                    </div>
                    ${settingsPaneHtml()}
                </section>
            </div>
        </div>`;

    overlay.querySelector('.jnk-close').addEventListener('click', closeWindow);
    overlay.querySelector('.jnk-gear').addEventListener('click', () => (settingsOpen ? closeSettings() : openSettings()));
    overlay.querySelector('.jnk-settings-back').addEventListener('click', closeSettings);

    // Клик мимо окна закрывает его (mousedown, чтобы выделение текста не закрывало случайно)
    overlay.addEventListener('mousedown', (e) => {
        if (e.target === overlay) closeWindow();
    });

    overlay.querySelectorAll('.jnk-tab').forEach((btn) => {
        btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });

    document.body.appendChild(overlay);
    bindSettingsPane();
    return overlay;
}

function openSettings() {
    settingsOpen = true;
    renderTabs();
    overlayEl?.querySelector('.jnk-body')?.scrollTo?.(0, 0);
}

function closeSettings() {
    settingsOpen = false;
    renderTabs();
    // Тему, язык или лимиты могли поменять — перерисуем то, что от них зависит
    renderNewPane();
    renderArchive();
}

function onKeyDown(e) {
    if (e.key === 'Escape' && isOpen()) {
        // Если поверх открыт попап таверны — пусть он сам обработает Esc
        if (document.querySelector('dialog[open]')) return;
        if (bankEditorEl && !bankEditorEl.hidden) {
            closeBankEditor();
            return;
        }
        if (settingsOpen) {
            closeSettings();
            return;
        }
        closeWindow();
    }
}

function isOpen() {
    return Boolean(overlayEl && overlayEl.classList.contains('jnk-open'));
}

/**
 * Высота видимой части экрана → --jnk-vh у подложки. На телефоне это надёжнее dvh:
 * учитывает панель браузера и открытую клавиатуру.
 */
function syncViewportHeight() {
    if (!overlayEl) return;
    const height = window.visualViewport?.height || window.innerHeight;
    if (height > 0) overlayEl.style.setProperty('--jnk-vh', `${Math.round(height)}px`);
    keepOverlayOnScreen();
}

/**
 * Страховка: если страницу под окном что-то прокрутило (в мобильном Firefox подложка
 * привязана к странице), сдвигаем подложку обратно, чтобы она снова начиналась с верха экрана.
 */
function keepOverlayOnScreen() {
    if (!isOpen()) return;
    // Подложку саму по себе тоже могли прокрутить (scrollIntoView умеет и overflow: hidden)
    if (overlayEl.scrollTop || overlayEl.scrollLeft) overlayEl.scrollTo(0, 0);
    const current = parseFloat(overlayEl.style.getPropertyValue('--jnk-top')) || 0;
    const drift = overlayEl.getBoundingClientRect().top;
    if (Math.abs(drift) < 1) return;
    overlayEl.style.setProperty('--jnk-top', `${Math.round(current - drift)}px`);
}

let viewportBound = false;
function bindViewport() {
    if (viewportBound) return;
    viewportBound = true;
    window.addEventListener('resize', syncViewportHeight);
    window.visualViewport?.addEventListener('resize', syncViewportHeight);
    window.addEventListener('scroll', keepOverlayOnScreen, { passive: true });
    overlayEl?.addEventListener('scroll', keepOverlayOnScreen, { passive: true });
}

function openWindow(tab) {
    if (!overlayEl) overlayEl = buildWindow();
    syncViewportHeight();
    bindViewport();
    if (tab) activeTab = tab;
    settingsOpen = false;
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
    settingsOpen = false;
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
    overlayEl.classList.toggle('jnk-settings-on', settingsOpen);
    const gear = overlayEl.querySelector('.jnk-gear');
    gear?.classList.toggle('jnk-active', settingsOpen);
    gear?.setAttribute('aria-pressed', String(settingsOpen));
    overlayEl.querySelectorAll('.jnk-tab').forEach((btn) => {
        btn.classList.toggle('jnk-active', btn.dataset.tab === activeTab);
    });
    const shown = settingsOpen ? 'settings' : activeTab;
    overlayEl.querySelectorAll('.jnk-pane').forEach((pane) => {
        pane.classList.toggle('jnk-active', pane.dataset.pane === shown);
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
    // «Интервьюер» не нужен в «Реакции»: там интервьюера нет
    const reaction = isReaction(shoot);
    const rowAttrs = (id) => {
        if (id === 'chemistry') return `data-actors-only ${shoot.studio === 'characters' ? 'hidden' : ''}`;
        if (id === 'interviewer') return `data-no-reaction ${reaction ? 'hidden' : ''}`;
        return '';
    };
    const vibeRows = VIBES.map((group) => `
        <div class="jnk-vibe-row" ${rowAttrs(group.id)}>
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

            <div class="jnk-venue jnk-fan-venue" ${shoot.format === 'fans' ? '' : 'hidden'}>
                <div class="jnk-subtitle">Где</div>
                <div class="jnk-chips">${chipsHtml(FAN_VENUES, shoot.venue, 'data-venue')}</div>
            </div>

            <div class="jnk-venue jnk-pilot-venue" ${shoot.format === 'pilot' ? '' : 'hidden'}>
                <div class="jnk-subtitle">Где снимаем</div>
                <div class="jnk-chips">${chipsHtml(PILOT_VENUES, shoot.pilotVenue, 'data-pilotvenue')}</div>
                <div class="jnk-hint">В конце каждый делает ставку на будущее — это отдельный вопрос, он не входит в число вопросов.</div>
            </div>

            <div class="jnk-venue jnk-writer-venue" ${isWriter(shoot) ? '' : 'hidden'}>
                <div class="jnk-subtitle">Где снимаем</div>
                <div class="jnk-chips">${chipsHtml(WRITER_VENUES, shoot.writerVenue, 'data-writervenue')}</div>
                <div class="jnk-hint">В конце — вопрос всем, сценаристке тоже: «Что бы вы переписали в этом сценарии?» Он не входит в число вопросов. Кто такая сценаристка — в ⚙.</div>
                ${isWriter(shoot) ? planBlockHtml() : '<div class="jnk-plan-slot"></div>'}
            </div>

            <div class="jnk-reaction" ${reaction ? '' : 'hidden'}>
                <div class="jnk-subtitle">Где смотрят</div>
                <div class="jnk-chips" data-place-group>${chipsHtml(WATCH_PLACES, shoot.place, 'data-place')}</div>
                <div class="jnk-hint">Ничего не выбрано — как решит модель.</div>
            </div>

            <div class="jnk-questions">
                <label class="jnk-subtitle" for="jnk_questions"><span class="jnk-qlabel">${reaction ? 'Моментов' : 'Вопросов'}</span>: <span class="jnk-qcount">${shoot.questions}</span></label>
                <input id="jnk_questions" class="jnk-range-slider" type="range" min="${questionsRange(shoot.format)[0]}" max="${questionsRange(shoot.format)[1]}" step="1" value="${shoot.questions}">
                <div class="jnk-hint jnk-qhint">${questionsHint(reaction)}</div>
            </div>

            <div class="jnk-reaction" ${reaction ? '' : 'hidden'}>
                <label class="jnk-subtitle" for="jnk_topics">О чём обязательно поговорить</label>
                <textarea id="jnk_topics" class="text_pole jnk-wishes" rows="3" placeholder="По одной теме на строку. Например: ревность Кевы">${escapeHtml(shoot.topics)}</textarea>
                <div class="jnk-hint">Необязательно. Темы входят в число моментов.</div>
            </div>

            <div class="jnk-bank-wrap" ${reaction || isWriter(shoot) ? 'hidden' : ''}>${bankRowHtml(shoot)}</div>

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

function questionsHint(reaction) {
    return reaction
        ? 'Остановки по ходу сцены, по порядку. Болтовня на паузах не считается.'
        : 'Уточнения и болтовня между вопросами не считаются.';
}

/** Переключение формата: «Реакция» прячет вопросы, банк и интервьюера, показывает свои поля. */
function applyFormatUi(section, shoot) {
    const reaction = isReaction(shoot);
    section.querySelector('.jnk-fan-venue').hidden = shoot.format !== 'fans';
    section.querySelector('.jnk-pilot-venue').hidden = shoot.format !== 'pilot';
    const writerBox = section.querySelector('.jnk-writer-venue');
    writerBox.hidden = !isWriter(shoot);
    // Блок сюжета рисуем при первом показе: черновик берётся из Скетчбука только когда он нужен
    const slot = writerBox.querySelector('.jnk-plan-slot');
    if (slot && isWriter(shoot)) {
        slot.outerHTML = planBlockHtml();
        bindPlanBlock(writerBox.querySelector('.jnk-plan'));
    }
    section.querySelectorAll('.jnk-reaction').forEach((el) => { el.hidden = !reaction; });
    section.querySelector('.jnk-bank-wrap').hidden = reaction || isWriter(shoot);
    section.querySelectorAll('[data-no-reaction]').forEach((row) => { row.hidden = reaction; });
    section.querySelector('.jnk-qlabel').textContent = reaction ? 'Моментов' : 'Вопросов';
    section.querySelector('.jnk-qhint').textContent = questionsHint(reaction);
    const slider = section.querySelector('#jnk_questions');
    [slider.min, slider.max] = questionsRange(shoot.format).map(String);
    slider.value = shoot.questions;
    section.querySelector('.jnk-qcount').textContent = shoot.questions;
}

// ---------- Сюжет для сценаристки (общий черновик чата) ----------

function planOptionLabel(page) {
    const title = String(page.title || '').trim() || 'Без названия';
    return `${page.favorite ? '★ ' : ''}${title}`;
}

/** Выбор страницы Скетчбука + поле сюжета. Один и тот же черновик и у чипса, и под «После пилота». */
function planBlockHtml() {
    const plan = ensureWriterPlan();
    const plots = getSketchbookPlots();
    const options = plots.map((p) => `<option value="${escapeHtml(p.id)}" ${p.id === plan.pageId ? 'selected' : ''}>${escapeHtml(planOptionLabel(p))}</option>`).join('');
    const picker = plots.length
        ? `<div class="jnk-bank-row">
                <select class="text_pole jnk-bank-select jnk-plan-select" aria-label="Страница Скетчбука">
                    <option value="" ${plan.pageId && getSketchbookPage(plan.pageId) ? '' : 'selected'}>— свой текст —</option>
                    ${options}
                </select>
                <button class="jnk-btn jnk-plan-reload" type="button" title="Взять текст страницы из Скетчбука заново" ${plan.pageId && getSketchbookPage(plan.pageId) ? '' : 'disabled'}>↺ Взять из Скетчбука заново</button>
            </div>`
        : '<div class="jnk-hint">В Скетчбуке Plotweaver этого чата нет сюжетов — вставь сюжет сюда сам.</div>';
    return `
        <div class="jnk-plan">
            <div class="jnk-subtitle">Сюжет сценаристки</div>
            ${picker}
            <textarea class="text_pole jnk-wishes jnk-plan-text" rows="7" placeholder="Что будет дальше: главные повороты, финал, кто с кем окажется. Сценаристка раскроет это в интервью.">${escapeHtml(plan.text)}</textarea>
            <div class="jnk-hint">Правки остаются здесь, общие для этого чата. Страница в Plotweaver не меняется.</div>
        </div>`;
}

/** Черновик отличается от страницы, из которой взят (или страница уже удалена)? */
function planEdited(plan) {
    if (!String(plan?.text || '').trim()) return false;
    const page = getSketchbookPage(plan.pageId);
    return !page || planFromPage(page) !== plan.text;
}

function bindPlanBlock(box) {
    if (!box || box.dataset.bound) return;
    box.dataset.bound = '1';
    const select = box.querySelector('.jnk-plan-select');
    const reload = box.querySelector('.jnk-plan-reload');
    const area = box.querySelector('.jnk-plan-text');

    const takePage = async (page) => {
        const current = getWriterPlan() || { pageId: null, text: '' };
        if (planEdited(current) && planFromPage(page) !== current.text
            && !await confirmPopup('Заменить текст сюжета страницей из Скетчбука? Твои правки пропадут.')) {
            return false;
        }
        const text = planFromPage(page);
        setWriterPlan({ pageId: page.id, text });
        area.value = text;
        return true;
    };

    select?.addEventListener('change', async () => {
        const plan = getWriterPlan() || { pageId: null, text: '' };
        const page = getSketchbookPage(select.value);
        if (!page) {
            // «Свой текст»: текст остаётся, связь со страницей рвётся
            setWriterPlan({ pageId: null, text: area.value });
        } else if (!await takePage(page)) {
            select.value = plan.pageId && getSketchbookPage(plan.pageId) ? plan.pageId : '';
        }
        if (reload) reload.disabled = !getSketchbookPage(getWriterPlan()?.pageId);
    });

    reload?.addEventListener('click', async () => {
        const page = getSketchbookPage(getWriterPlan()?.pageId);
        if (page && await takePage(page)) toastr.info('Сюжет взят из Скетчбука заново', TOAST_TITLE);
    });

    area.addEventListener('input', () => {
        const plan = getWriterPlan() || { pageId: null, text: '' };
        setWriterPlan({ pageId: plan.pageId, text: area.value });
    });
}

/** Текст сюжета, с которым пойдём к модели (пусто — генерировать нечего). */
function currentPlanText() {
    return String(getWriterPlan()?.text || '').trim();
}

// ---------- Банк вопросов: строчка в «Как снимаем» ----------

function bankCountText(list) {
    const n = listQuestions(list).length;
    return n ? `В списке ${n} ${questionsWord(n)}` : 'В списке пока нет вопросов';
}

function bankRowHtml(shoot) {
    const bank = getBank();
    const list = getList(shoot.bankId);
    const options = bank.map((l) => `<option value="${escapeHtml(l.id)}" ${list && l.id === list.id ? 'selected' : ''}>${escapeHtml(l.name || 'Без названия')}</option>`).join('');
    return `
        <div class="jnk-bank">
            <label class="jnk-subtitle" for="jnk_bank">Банк вопросов</label>
            <div class="jnk-bank-row">
                <select id="jnk_bank" class="text_pole jnk-bank-select">
                    <option value="">— не использовать —</option>
                    ${options}
                </select>
                <button class="jnk-btn jnk-bank-edit" type="button">✎ Списки</button>
            </div>
            <div class="jnk-bank-opts" ${list ? '' : 'hidden'}>
                <div class="jnk-seg jnk-bank-mode">
                    ${BANK_MODES.map((m) => `<button type="button" class="jnk-seg-btn ${m.id === shoot.bankMode ? 'active' : ''}" data-bankmode="${m.id}">${escapeHtml(m.label)}</button>`).join('')}
                </div>
                <div class="jnk-hint jnk-bank-count">${list ? escapeHtml(bankCountText(list)) : ''}</div>
            </div>
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

        if (btn.classList.contains('jnk-bank-edit')) {
            openBankEditor(shoot.bankId);
            return;
        } else if (btn.dataset.bankmode) {
            shoot.bankMode = btn.dataset.bankmode;
            section.querySelectorAll('[data-bankmode]').forEach((b) => b.classList.toggle('active', b === btn));
        } else if (btn.dataset.studio) {
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
            applyFormatUi(section, shoot);
        } else if (btn.dataset.place) {
            // Повторный клик снимает выбор — «не важно»
            const turnOff = shoot.place === btn.dataset.place;
            shoot.place = turnOff ? null : btn.dataset.place;
            section.querySelectorAll('[data-place]').forEach((b) => b.classList.toggle('jnk-chip-on', !turnOff && b === btn));
        } else if (btn.dataset.venue) {
            shoot.venue = btn.dataset.venue;
            setOn('[data-venue]', btn);
        } else if (btn.dataset.pilotvenue) {
            shoot.pilotVenue = btn.dataset.pilotvenue;
            setOn('[data-pilotvenue]', btn);
        } else if (btn.dataset.writervenue) {
            shoot.writerVenue = btn.dataset.writervenue;
            setOn('[data-writervenue]', btn);
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

    section.querySelector('#jnk_bank').addEventListener('change', (e) => {
        const shoot = getShoot();
        const list = getList(e.target.value);
        shoot.bankId = list ? list.id : null;
        section.querySelector('.jnk-bank-opts').hidden = !list;
        section.querySelector('.jnk-bank-count').textContent = list ? bankCountText(list) : '';
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

    const plan = section.querySelector('.jnk-plan');
    if (plan) bindPlanBlock(plan);

    const topics = section.querySelector('#jnk_topics');
    topics.addEventListener('input', () => {
        const shoot = getShoot();
        shoot.topics = topics.value;
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
        refreshBusy();
        updateGoButton();
        toastr.info('Генерация остановлена', TOAST_TITLE);
        return;
    }

    const range = getSelectedRange();
    if (!range) {
        toastr.warning('Сначала выбери сообщения', TOAST_TITLE);
        return;
    }
    if (isWriter(getShoot()) && !currentPlanText()) {
        toastr.warning('Сценаристке нужен сюжет: выбери страницу Скетчбука или вставь текст', TOAST_TITLE);
        return;
    }

    const chatId = currentChatId();
    const store = getChatStore();
    const controller = new AbortController();
    generation = { controller, chatId };
    refreshBusy();
    let savedId = null;
    updateGoButton();

    try {
        const sources = await collectSources(store?.sources);
        if (controller.signal.aborted) throw new DOMException('Aborted', 'AbortError');

        const sceneText = buildSceneText(range.from, range.to);
        if (!sceneText) throw new Error('В выбранных сообщениях нет текста.');

        const shoot = getShoot();
        const withWriter = isWriter(shoot);
        const plan = withWriter ? currentPlanText() : '';
        const writer = withWriter ? getWriter() : null;
        const { instruction, contextText } = buildInterviewPrompt({ sourcesText: sources.text, sceneText, ...range, shoot, cast: getCast(), plan, writer });
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
            shoot: { ...shoot },    // весь выбор «Как снимаем» — чтобы вопросы из зала звучали тем же голосом
            rounds: [],
            venue: shoot.format === 'fans' ? shoot.venue
                : shoot.format === 'pilot' ? shoot.pilotVenue
                    : withWriter ? shoot.writerVenue : null,
            text,
        };
        // Сюжет и сценаристка — какими были на съёмке: по ним потом отвечает зал
        if (withWriter) Object.assign(item, { plan, writer });
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
        toastr.success(isReaction(shoot) ? 'Реакция снята и лежит в архиве 👀' : 'Интервью снято и лежит в архиве 🎬', TOAST_TITLE);
    } catch (error) {
        if (controller.signal.aborted || error?.name === 'AbortError') {
            if (!controller.junketQuiet) toastr.info('Генерация остановлена', TOAST_TITLE);
        } else {
            console.error('[Junket]', error);
            toastr.error(String(error?.message || error), TOAST_TITLE);
        }
    } finally {
        if (generation?.controller === controller) generation = null;
        refreshBusy();
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

// ---------- Банк вопросов: редактор списков ----------

let bankEditorEl = null;
let bankEditorId = null;
let bankCompose = false;      // справа открыта панель «Сочинить список»
let bankGen = null;           // { controller, chatId } пока модель сочиняет
let bankGenWishes = '';       // черновик пожеланий (живёт, пока открыта таверна)

const BANK_GEN_MIN = 10;
const BANK_GEN_MAX = 30;

function bankComposeHtml() {
    const s = getSettings();
    if (!currentChatId()) return '<div class="jnk-empty">Открой чат — вопросы сочиняются по его карточке, персоне и лорбуку.</div>';
    const running = Boolean(bankGen);
    const lore = getChatLorebookName();
    const samples = getBank().filter((l) => listQuestions(l).length);
    return `
        <div class="jnk-section-title">✨ Сочинить список</div>
        <div class="jnk-hint">Модель прочитает карточку, персону и лорбук чата и придумает вопросы героям — от серьёзных и «если бы» до смешных и пошлых. Получится новый список: лишнее вычеркнешь.</div>
        <div class="jnk-bank-gen-row">
            <label class="jnk-cast-field jnk-bank-gen-count">
                <span>Сколько вопросов</span>
                <input class="text_pole" type="number" min="${BANK_GEN_MIN}" max="${BANK_GEN_MAX}" step="1" value="${escapeHtml(s.bankGenCount)}">
            </label>
            <label class="jnk-cast-field">
                <span>Образец стиля</span>
                <select class="text_pole jnk-bank-gen-sample">
                    <option value="">— без образца —</option>
                    ${samples.map((l) => `<option value="${escapeHtml(l.id)}" ${l.id === s.bankGenSample ? 'selected' : ''}>${escapeHtml(l.name || 'Без названия')}</option>`).join('')}
                </select>
            </label>
        </div>
        <label class="checkbox_label jnk-check">
            <input type="checkbox" class="jnk-bank-gen-recent" ${s.bankGenRecent ? 'checked' : ''}>
            <span>Последние сообщения чата</span>
        </label>
        <div class="jnk-bank-gen-recent-box" ${s.bankGenRecent ? '' : 'hidden'}>
            <label class="jnk-subtitle" for="jnk_bank_recent">Сообщений: <span class="jnk-bank-recent-count">${normalizeRecentCount(s.bankGenRecentCount)}</span></label>
            <input id="jnk_bank_recent" class="jnk-range-slider" type="range" min="${BANK_RECENT_MIN}" max="${BANK_RECENT_MAX}" step="${BANK_RECENT_STEP}" value="${normalizeRecentCount(s.bankGenRecentCount)}">
        </div>
        <div class="jnk-hint">Свежие события, которых ещё нет в саммари. Это заметно больше контекста.</div>
        <label class="jnk-cast-field jnk-bank-gen-wishes-field">
            <span>Пожелания (необязательно)</span>
            <textarea class="text_pole jnk-bank-gen-wishes" rows="3" placeholder="Например: побольше про беременность, без Кевы">${escapeHtml(bankGenWishes)}</textarea>
        </label>
        <div class="jnk-hint">${lore ? `Лорбук чата: «${escapeHtml(lore)}»` : 'Лорбук к чату не привязан — вопросы будут по карточке, персоне и сообщениям.'}</div>
        <div class="jnk-actions">
            <button class="jnk-go jnk-bank-gen-go ${running ? 'jnk-stop' : ''}" type="button">${running ? '<i class="fa-solid fa-stop"></i> Стоп' : '✨ Сочинить'}</button>
            <span class="jnk-status">${running ? '<i class="fa-solid fa-spinner fa-spin"></i> Модель сочиняет…' : ''}</span>
        </div>`;
}

function bindBankCompose() {
    const s = getSettings();
    const count = bankEditorEl.querySelector('.jnk-bank-gen-count input');
    if (!count) return;
    count.addEventListener('change', () => {
        let n = Math.round(Number(count.value));
        if (!Number.isFinite(n)) n = 20;
        n = Math.min(BANK_GEN_MAX, Math.max(BANK_GEN_MIN, n));
        count.value = n;
        s.bankGenCount = n;
        saveSettings();
    });
    bankEditorEl.querySelector('.jnk-bank-gen-sample').addEventListener('change', (e) => {
        s.bankGenSample = getList(e.target.value)?.id || null;
        saveSettings();
    });
    bankEditorEl.querySelector('.jnk-bank-gen-recent').addEventListener('change', (e) => {
        s.bankGenRecent = Boolean(e.target.checked);
        saveSettings();
        bankEditorEl.querySelector('.jnk-bank-gen-recent-box').hidden = !s.bankGenRecent;
    });
    const recent = bankEditorEl.querySelector('#jnk_bank_recent');
    recent.addEventListener('input', () => {
        bankEditorEl.querySelector('.jnk-bank-recent-count').textContent = recent.value;
    });
    recent.addEventListener('change', () => {
        s.bankGenRecentCount = normalizeRecentCount(recent.value);
        saveSettings();
    });
    bankEditorEl.querySelector('.jnk-bank-gen-wishes').addEventListener('input', (e) => {
        bankGenWishes = e.target.value;
    });
    bankEditorEl.querySelector('.jnk-bank-gen-go').addEventListener('click', onBankGenClick);
}

async function onBankGenClick() {
    if (bankGen) {
        bankGen.controller.abort();
        return;
    }
    const chatId = currentChatId();
    if (!chatId) return;
    const s = getSettings();
    const controller = new AbortController();
    bankGen = { controller, chatId };
    refreshBusy();
    renderBankEditor();

    try {
        const sources = await collectBankSources({ recent: s.bankGenRecent, recentCount: s.bankGenRecentCount });
        if (controller.signal.aborted) throw new DOMException('Aborted', 'AbortError');
        if (!sources.text.trim()) throw new Error('Нечего читать: у чата нет ни карточки, ни персоны, ни лорбука.');

        const names = getMainRoles().map((r) => r.name);
        const count = Math.min(BANK_GEN_MAX, Math.max(BANK_GEN_MIN, Number(s.bankGenCount) || 20));
        const sample = listQuestions(getList(s.bankGenSample));
        const { instruction, contextText } = buildBankPrompt({ sourcesText: sources.text, names, count, wishes: bankGenWishes, sample });
        const text = await requestModel({ instruction, contextText }, controller.signal);
        if (controller.signal.aborted) throw new DOMException('Aborted', 'AbortError');

        const questions = parseGeneratedQuestions(text);
        if (questions.length < 3) throw new Error('Не получилось разобрать вопросы — попробуй ещё раз.');
        const date = new Date().toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
        const list = addList(`✨ ${names.join(' и ') || 'Авторский'} · ${date}`, questions);
        bankEditorId = list.id;
        bankCompose = false;
        if (sources.droppedEntries) {
            toastr.warning(`Лорбук не влез в лимит, отрезано записей: ${sources.droppedEntries}`, TOAST_TITLE);
        }
        toastr.success(`Готово: ${questions.length} ${questionsWord(questions.length)} в новом списке ✨`, TOAST_TITLE);
    } catch (error) {
        if (controller.signal.aborted || error?.name === 'AbortError') {
            if (!controller.junketQuiet) toastr.info('Остановлено', TOAST_TITLE);
        } else {
            console.error('[Junket]', error);
            toastr.error(String(error?.message || error), TOAST_TITLE);
        }
    } finally {
        if (bankGen?.controller === controller) bankGen = null;
        refreshBusy();
        if (bankEditorEl && !bankEditorEl.hidden) renderBankEditor();
    }
}

function openBankEditor(selectedId) {
    if (!overlayEl) return;
    const bank = getBank();
    bankEditorId = (selectedId && bank.some((l) => l.id === selectedId)) ? selectedId : (bank[0]?.id || null);
    if (!bankEditorEl) {
        bankEditorEl = document.createElement('div');
        bankEditorEl.className = 'jnk-modal';
        overlayEl.querySelector('.jnk-window').appendChild(bankEditorEl);
    }
    bankEditorEl.hidden = false;
    renderBankEditor();
}

function closeBankEditor() {
    if (!bankEditorEl) return;
    bankEditorEl.hidden = true;
    // Списки могли поменяться — освежаем выпадашку в «Как снимаем»
    renderNewPane();
}

function renderBankEditor() {
    const bank = getBank();
    const current = bank.find((l) => l.id === bankEditorId) || null;
    // Выделение в списке слева — только когда открыт сам список, а не «Сочинить»
    const selectedId = bankCompose ? null : current?.id;
    bankEditorEl.innerHTML = `
        <div class="jnk-modal-card">
            <div class="jnk-modal-head">
                <div class="jnk-section-title">Банк вопросов</div>
                <button class="jnk-btn jnk-bank-done" type="button">Готово</button>
            </div>
            <div class="jnk-bank-editor">
                <div class="jnk-bank-lists">
                    ${bank.map((l) => `<button class="jnk-bank-item ${l.id === selectedId ? 'jnk-chip-on' : ''}" type="button" data-list="${escapeHtml(l.id)}">${escapeHtml(l.name || 'Без названия')}</button>`).join('')}
                    <button class="jnk-btn jnk-bank-new" type="button">+ Новый список</button>
                    <button class="jnk-btn jnk-bank-compose ${bankCompose ? 'jnk-chip-on' : ''}" type="button">✨ Сочинить список</button>
                </div>
                <div class="jnk-bank-form">
                    ${bankCompose ? bankComposeHtml() : current ? `
                        <label class="jnk-cast-field">
                            <span>Название</span>
                            <input class="text_pole jnk-bank-name" type="text" value="${escapeHtml(current.name)}">
                        </label>
                        <label class="jnk-cast-field jnk-bank-text-field">
                            <span>Вопросы — по одному на строку</span>
                            <textarea class="text_pole jnk-bank-text" spellcheck="true">${escapeHtml(current.questions.join('\n'))}</textarea>
                        </label>
                        <div class="jnk-bank-form-foot">
                            <span class="jnk-hint jnk-bank-editor-count">${escapeHtml(bankCountText(current))}</span>
                            <button class="jnk-btn jnk-btn-danger jnk-bank-delete" type="button"><i class="fa-solid fa-trash-can"></i> Удалить список</button>
                        </div>` : '<div class="jnk-empty">Списков нет. Создай первый.</div>'}
                </div>
            </div>
        </div>`;

    bankEditorEl.querySelector('.jnk-bank-done').addEventListener('click', closeBankEditor);
    bankEditorEl.querySelectorAll('[data-list]').forEach((btn) => {
        btn.addEventListener('click', () => {
            bankEditorId = btn.dataset.list;
            bankCompose = false;
            renderBankEditor();
        });
    });
    bankEditorEl.querySelector('.jnk-bank-new').addEventListener('click', () => {
        bankEditorId = addList().id;
        bankCompose = false;
        renderBankEditor();
        bankEditorEl.querySelector('.jnk-bank-name')?.select();
    });
    bankEditorEl.querySelector('.jnk-bank-compose').addEventListener('click', () => {
        bankCompose = true;
        renderBankEditor();
    });
    if (bankCompose) {
        bindBankCompose();
        return;
    }
    if (!current) return;

    const nameInput = bankEditorEl.querySelector('.jnk-bank-name');
    nameInput.addEventListener('input', () => {
        updateList(current.id, { name: nameInput.value });
        const item = bankEditorEl.querySelector(`[data-list="${CSS.escape(current.id)}"]`);
        if (item) item.textContent = nameInput.value || 'Без названия';
    });
    const textArea = bankEditorEl.querySelector('.jnk-bank-text');
    textArea.addEventListener('input', () => {
        // Храним строки как есть, чтобы не мешать печатать; чистка — при использовании
        updateList(current.id, { questions: textArea.value.split('\n') });
        bankEditorEl.querySelector('.jnk-bank-editor-count').textContent = bankCountText(getList(current.id));
    });
    bankEditorEl.querySelector('.jnk-bank-delete').addEventListener('click', async () => {
        const ok = await confirmPopup(`Удалить список «${escapeHtml(current.name || 'Без названия')}»? Отменить не получится.`);
        if (!ok) return;
        deleteList(current.id);
        bankEditorId = getBank()[0]?.id || null;
        renderBankEditor();
    });
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
        overlayEl.querySelector('[data-pane="cast"] [data-npc]:last-of-type [data-field="name"]')?.focus({ preventScroll: true });
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
let archiveEditId = null;   // какое интервью сейчас редактируется (✎)

function renderArchive() {
    if (!overlayEl) return;
    const pane = overlayEl.querySelector('[data-pane="archive"]');
    const store = getChatStore();

    if (!store) {
        pane.innerHTML = `<div class="jnk-empty">Открой чат — у каждого чата свой архив интервью.</div>`;
        return;
    }

    const opened = archiveOpenId ? store.interviews.find((item) => item.id === archiveOpenId) : null;
    if (opened && archiveEditId === opened.id) {
        renderArchiveEditor(pane, opened);
        return;
    }
    archiveEditId = null;
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

    // Избранные — сверху (новые первыми), под ними разделитель «Остальные»
    const favorites = items.filter((i) => i.favorite).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    const rest = items.filter((i) => !i.favorite);
    const rowHtml = (item) => {
        const meta = [
            formatLabel(item.format, item.venue),
            item.range ? `Сообщения ${item.range.from}–${item.range.to}` : (String(item.text || '').trim() ? '' : 'Пустая тестовая запись'),
            formatDate(item.createdAt),
        ].filter(Boolean).join(' · ');
        return `
            <div class="jnk-archive-item ${item.favorite ? 'jnk-archive-fav' : ''}" data-id="${escapeHtml(item.id)}" tabindex="0" role="button">
                <div class="jnk-archive-main">
                    <div class="jnk-archive-title">${item.favorite ? '<span class="jnk-fav-mark">★</span>' : ''}${escapeHtml(item.title || defaultTitle(item.range))}</div>
                    <div class="jnk-archive-meta">${escapeHtml(meta)}</div>
                </div>
                <button class="jnk-icon-btn jnk-delete" type="button" title="Удалить из архива">
                    <i class="fa-solid fa-trash-can"></i>
                </button>
            </div>`;
    };
    const divider = favorites.length && rest.length ? '<div class="jnk-archive-divider"><span>Остальные</span></div>' : '';
    pane.innerHTML = `<div class="jnk-archive-list">${favorites.map(rowHtml).join('')}${divider}${rest.map(rowHtml).join('')}</div>`;

    pane.querySelectorAll('.jnk-archive-item').forEach((row) => {
        const open = () => {
            archiveOpenId = row.dataset.id;
            renderArchive();
            // Только внутри окна! scrollIntoView крутил и страницу таверны под ним,
            // а в мобильном Firefox окно уезжало вместе с ней за верх экрана
            overlayEl?.querySelector('.jnk-body')?.scrollTo?.(0, 0);
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

function paperButtonHtml(paper) {
    const night = paper === 'night';
    return `<button class="jnk-btn jnk-icon-only jnk-paper-btn" type="button" title="${night ? 'Дневная бумага' : 'Ночная бумага'}">${night ? '☀' : '🌙'}</button>`;
}

/** ☀/🌙 в панели интервью: меняем классы на месте, без перерисовки. */
function togglePaper(pane) {
    const s = getSettings();
    s.paper = normalizePaper(s.paper) === 'night' ? 'day' : 'night';
    saveSettings();
    const stage = pane.querySelector('.jnk-stage');
    if (stage) stage.className = stageClass(s.theme, s.paper);
    pane.querySelectorAll('.jnk-sc-time').forEach((el) => {
        el.textContent = s.paper === 'night' ? 'НОЧЬ' : 'ДЕНЬ';
    });
    const btn = pane.querySelector('.jnk-paper-btn');
    if (btn) btn.outerHTML = paperButtonHtml(s.paper);
    pane.querySelector('.jnk-paper-btn')?.addEventListener('click', () => togglePaper(pane));
    syncLookControls();
}

function renderArchiveViewer(pane, item) {
    const s = getSettings();
    const theme = getTheme(s.theme);
    const paper = normalizePaper(s.paper);
    pane.innerHTML = `
        <div class="jnk-viewer-bar">
            <button class="jnk-btn jnk-icon-only jnk-back" type="button" title="Все интервью" aria-label="Все интервью"><i class="fa-solid fa-arrow-left"></i></button>
            <div class="jnk-viewer-actions">
                ${theme.paper ? paperButtonHtml(paper) : ''}
                <button class="jnk-btn jnk-icon-only jnk-fav ${item.favorite ? 'jnk-fav-on' : ''}" type="button" title="${item.favorite ? 'Убрать из избранного' : 'В избранное'}">${item.favorite ? '★' : '☆'}</button>
                ${item.studio === 'characters' || !String(item.text || '').trim() ? '' : '<button class="jnk-btn jnk-icon-only jnk-pin" type="button" title="Закрепить каст" aria-label="Закрепить каст"><i class="fa-solid fa-thumbtack"></i></button>'}
                ${String(item.text || '').trim() ? '<button class="jnk-btn jnk-icon-only jnk-edit" type="button" title="Редактировать" aria-label="Редактировать"><i class="fa-solid fa-pen"></i></button>' : ''}
                <button class="jnk-btn jnk-icon-only jnk-copy" type="button" title="Скопировать" aria-label="Скопировать"><i class="fa-regular fa-copy"></i></button>
                <button class="jnk-btn jnk-icon-only jnk-btn-danger jnk-remove" type="button" title="Удалить" aria-label="Удалить"><i class="fa-solid fa-trash-can"></i></button>
            </div>
        </div>
        <div class="${stageClass(theme.id, paper)}">
            ${renderInterviewHtml(item, { theme: theme.id, paper })}
            ${renderFeedHtml(item.feed, theme.id)}
        </div>
        ${String(item.text || '').trim() && !isReaction(item.format)
        ? audiencePanelHtml(item)
        : `<div class="jnk-bottom-row"><div class="jnk-extras-buttons">${toTopButtonHtml()}</div></div>`}`;

    pane.querySelector('.jnk-back').addEventListener('click', () => {
        archiveOpenId = null;
        renderArchive();
    });
    pane.querySelector('.jnk-copy').addEventListener('click', async () => {
        const feedText = feedPlainText(item.feed);
        const ok = await copyToClipboard(`${interviewPlainText(item)}${feedText ? `\n\n— Комментарии —\n\n${feedText}` : ''}`);
        if (ok) toastr.success(isReaction(item.format) ? 'Реакция скопирована' : 'Интервью скопировано', TOAST_TITLE);
        else toastr.error('Не получилось скопировать', TOAST_TITLE);
    });
    pane.querySelector('.jnk-remove').addEventListener('click', () => deleteInterview(item.id));
    pane.querySelector('.jnk-to-top')?.addEventListener('click', () => {
        overlayEl?.querySelector('.jnk-body')?.scrollTo?.({ top: 0, behavior: 'smooth' });
    });
    pane.querySelector('.jnk-edit')?.addEventListener('click', () => {
        archiveEditId = item.id;
        renderArchive();
        overlayEl?.querySelector('.jnk-body')?.scrollTo?.(0, 0);
    });
    pane.querySelector('.jnk-paper-btn')?.addEventListener('click', () => togglePaper(pane));
    pane.querySelector('.jnk-pin')?.addEventListener('click', () => pinCast(item));
    pane.querySelector('.jnk-fav').addEventListener('click', (e) => toggleFavorite(item.id, e.currentTarget));
    pane.querySelector('.jnk-feed-delete')?.addEventListener('click', () => deleteFeed(item.id));
    pane.querySelectorAll('.jnk-round-delete').forEach((btn) => {
        btn.addEventListener('click', () => deleteRound(item.id, btn.closest('[data-round]').dataset.round));
    });
    bindAudiencePanel(pane, item);
    bindFeedPanel(pane, item);
    bindWriterPanel(pane, item);
}

/** ↑ в нижнем ряду — обратно к началу интервью. */
function toTopButtonHtml() {
    return '<button class="jnk-btn jnk-icon-only jnk-to-top" type="button" title="К началу" aria-label="К началу"><i class="fa-solid fa-arrow-up"></i></button>';
}

// ---------- Редактирование (✎): сырой текст с разметкой ----------

/** Текст интервью для правки: без строки [TITLE] (заголовок — отдельным полем) и без мусора модели. */
function editableText(text) {
    return stripModelJunk(text)
        .split('\n')
        .filter((line) => !/^\s*\[TITLE\b/i.test(line))
        .join('\n')
        .trim();
}

/** Подписи раундов в редакторе: сценаристку не считаем в номерах вопросов из зала. */
function editorRoundLabels(rounds) {
    let n = 0;
    return rounds.map((round) => {
        if (isWriterRound(round)) return [round, '✍️ Сценарист в студии'];
        const i = n++;
        return [round, `🎤 Вопросы из зала${i > 0 ? ` · раунд ${i + 1}` : ''}`];
    });
}

function renderArchiveEditor(pane, item) {
    const rounds = (item.rounds || []).filter((r) => String(r?.text || '').trim());
    pane.innerHTML = `
        <div class="jnk-viewer-bar">
            <span class="jnk-settings-heading">✎ Редактирование</span>
            <div class="jnk-viewer-actions">
                <button class="jnk-btn jnk-edit-cancel" type="button">Отмена</button>
                <button class="jnk-btn jnk-go jnk-edit-save" type="button">Сохранить</button>
            </div>
        </div>
        <div class="jnk-edit">
            <label class="jnk-cast-field">
                <span>Заголовок</span>
                <input class="text_pole jnk-edit-title" type="text" value="${escapeHtml(item.title || defaultTitle(item.range))}">
            </label>
            <label class="jnk-cast-field">
                <span>${isReaction(item.format) ? 'Реакция' : 'Интервью'}</span>
                <textarea class="text_pole jnk-edit-text" spellcheck="false">${escapeHtml(editableText(item.text))}</textarea>
            </label>
            <details class="jnk-edit-help">
                <summary>Шпаргалка по разметке</summary>
                <ul>
                    <li><code>[Q] …</code> — вопрос или реплика интервьюера</li>
                    <li><code>[A: Актёр (Персонаж)] …</code> — ответ; в скобках имя как в карточке</li>
                    <li><code>[F: @ник] …</code> — вопрос из зала</li>
                    <li><code>[M: 541] подпись</code> — момент в «Реакции на сцену»</li>
                    <li><code>[A: Сценаристка (Автор)] …</code> — реплика сценаристки</li>
                    <li><code>*ремарка*</code>, <code>**жирное**</code>, <code>[BLEEP]</code> — плашка цензуры</li>
                    <li>Каждая реплика начинается с тега на новой строке, абзацы — через пустую строку.</li>
                </ul>
            </details>
            ${editorRoundLabels(rounds).map(([round, label]) => `
                <label class="jnk-cast-field">
                    <span>${label}</span>
                    <textarea class="text_pole jnk-edit-text jnk-edit-round" data-round="${escapeHtml(round.id)}" spellcheck="false">${escapeHtml(stripModelJunk(round.text))}</textarea>
                </label>`).join('')}
            <div class="jnk-hint">Пустой раунд при сохранении удалится. Лента фандома не редактируется — лишнюю пачку можно удалить корзиной.</div>
        </div>`;

    pane.querySelector('.jnk-edit-cancel').addEventListener('click', () => {
        archiveEditId = null;
        renderArchive();
    });
    pane.querySelector('.jnk-edit-save').addEventListener('click', () => saveArchiveEdit(pane, item.id));
}

async function saveArchiveEdit(pane, id) {
    const store = getChatStore();
    const item = store?.interviews.find((x) => x.id === id);
    if (!item) return;
    const body = pane.querySelector('.jnk-edit-text:not(.jnk-edit-round)').value.replace(/\r\n?/g, '\n').trim();
    if (!body) {
        toastr.warning('Текст пустой — если интервью не нужно, удали его корзиной', TOAST_TITLE);
        return;
    }
    const title = pane.querySelector('.jnk-edit-title').value.trim() || defaultTitle(item.range);
    item.title = title;
    // [TITLE] держим в тексте — его видят «Вопросы из зала» и лента фандома
    item.text = `[TITLE] ${title}\n${body}`;
    const edited = new Map([...pane.querySelectorAll('.jnk-edit-round')].map((t) => [t.dataset.round, t.value.replace(/\r\n?/g, '\n').trim()]));
    item.rounds = (item.rounds || [])
        .map((round) => (edited.has(round.id) ? { ...round, text: edited.get(round.id) } : round))
        .filter((round) => String(round?.text || '').trim());
    await saveChatStore();
    archiveEditId = null;
    renderArchive();
    toastr.success('Сохранено', TOAST_TITLE);
}

// ---------- Вопросы из зала ----------

let audienceGen = null;            // { controller, chatId, itemId } пока идёт запрос
let audienceOpenFor = null;        // у какого интервью раскрыта панель
const audienceDrafts = new Map();  // id интервью → черновик своих вопросов

/** Сценаристка в этом интервью: формат «Сценарист» или её сегмент после пилота. */
function writerOf(item) {
    if (isWriter(item?.format)) return { writer: item.writer || getWriter(), plan: item.plan || '' };
    const round = (item?.rounds || []).find((r) => isWriterRound(r) && String(r.text || '').trim());
    return round ? { writer: round.writer || getWriter(), plan: round.plan || '' } : null;
}

/** Кнопка «Сценарист в студии» — только под «После пилота», и один раз на интервью. */
function canCallWriter(item) {
    return isPilot(item?.format) && !(item.rounds || []).some(isWriterRound);
}

/** Подпись кнопки: на узком экране, когда кнопок три, — короткая. */
function extrasLabel(long, short) {
    return `<span class="jnk-lbl-long">${long}</span><span class="jnk-lbl-short">${short}</span>`;
}

function audiencePanelHtml(item) {
    const s = getSettings();
    const open = audienceOpenFor === item.id;
    const running = audienceGen && audienceGen.itemId === item.id;
    const writerBtn = canCallWriter(item);
    return `
        <div class="jnk-audience">
            <div class="jnk-extras-buttons ${writerBtn ? 'jnk-extras-3' : ''}">
                <button class="jnk-btn jnk-audience-toggle" type="button" title="Вопросы из зала">🎤 ${extrasLabel('Вопросы из зала', 'Зал')}</button>
                <button class="jnk-btn jnk-feed-toggle" type="button" title="Реакция фандома">💬 ${extrasLabel('Реакция фандома', 'Фандом')}</button>
                ${writerBtn ? `<button class="jnk-btn jnk-writer-toggle" type="button" title="Сценарист в студии">✍️ ${extrasLabel('Сценарист в студии', 'Сценарист')}</button>` : ''}
                ${toTopButtonHtml()}
            </div>
            ${writerBtn ? writerPanelHtml(item) : ''}
            <div class="jnk-audience-panel" ${open || running ? '' : 'hidden'}>
                <label class="jnk-cast-field">
                    <span>Свои вопросы (необязательно)</span>
                    <textarea class="text_pole jnk-audience-own" rows="3" placeholder="По одному на строку">${escapeHtml(audienceDrafts.get(item.id) || '')}</textarea>
                </label>
                <div class="jnk-hint">Пусто — спрашивают только зрители.</div>
                <div class="jnk-audience-row">
                    <label class="jnk-cast-field jnk-audience-count-field">
                        <span>Зрительских вопросов</span>
                        <input class="text_pole jnk-audience-count" type="number" min="1" max="5" step="1" value="${escapeHtml(s.audienceCount)}">
                    </label>
                    <label class="jnk-cast-field">
                        <span>Твой ник в зале</span>
                        <input class="text_pole jnk-audience-nick" type="text" value="${escapeHtml(s.audienceNick)}">
                    </label>
                </div>
                <div class="jnk-actions jnk-audience-actions">
                    <button class="jnk-go jnk-audience-go ${running ? 'jnk-stop' : ''}" type="button">${running ? '<i class="fa-solid fa-stop"></i> Стоп' : 'Задать'}</button>
                    <span class="jnk-status">${running ? '<i class="fa-solid fa-spinner fa-spin"></i> Зал спрашивает…' : ''}</span>
                </div>
            </div>
            ${feedPanelHtml(item)}
        </div>`;
}

function bindAudiencePanel(pane, item) {
    const box = pane.querySelector('.jnk-audience');
    if (!box) return;
    box.querySelector('.jnk-audience-toggle').addEventListener('click', () => {
        const panel = box.querySelector('.jnk-audience-panel');
        panel.hidden = !panel.hidden;
        audienceOpenFor = panel.hidden ? null : item.id;
    });
    box.querySelector('.jnk-audience-own').addEventListener('input', (e) => {
        audienceDrafts.set(item.id, e.target.value);
    });
    const count = box.querySelector('.jnk-audience-count');
    count.addEventListener('change', () => {
        let n = Math.round(Number(count.value));
        if (!Number.isFinite(n)) n = 2;
        n = Math.min(5, Math.max(1, n));
        count.value = n;
        getSettings().audienceCount = n;
        saveSettings();
    });
    const nick = box.querySelector('.jnk-audience-nick');
    nick.addEventListener('input', () => {
        getSettings().audienceNick = nick.value;
        saveSettings();
    });
    box.querySelector('.jnk-audience-go').addEventListener('click', () => onAudienceClick(item.id));
}

function refreshViewer(itemId) {
    if (isOpen() && activeTab === 'archive' && archiveOpenId === itemId) renderArchive();
}

async function onAudienceClick(itemId) {
    if (audienceGen) {
        audienceGen.controller.junketQuiet = true;
        audienceGen.controller.abort();
        const stopped = audienceGen.itemId;
        audienceGen = null;
        refreshBusy();
        toastr.info('Генерация остановлена', TOAST_TITLE);
        refreshViewer(stopped);
        return;
    }
    const store = getChatStore();
    const item = store?.interviews.find((i) => i.id === itemId);
    if (!item?.range) {
        toastr.warning('У этого интервью нет диапазона сообщений — вопросы из зала задать не получится', TOAST_TITLE);
        return;
    }

    const s = getSettings();
    const count = Math.min(5, Math.max(1, Math.round(Number(s.audienceCount)) || 2));
    const nick = String(s.audienceNick || '').trim() || 'Из зала';
    const own = String(audienceDrafts.get(itemId) || '').split('\n').map((q) => q.trim()).filter(Boolean);
    const chatId = currentChatId();
    const controller = new AbortController();
    audienceGen = { controller, chatId, itemId };
    refreshBusy();
    audienceOpenFor = itemId;
    refreshViewer(itemId);

    try {
        const last = lastIndex();
        if (item.range.from > last) throw new Error('Сообщений из этого интервью в чате больше нет.');
        const to = Math.min(item.range.to, last);
        const sources = await collectSources(store.sources);
        if (controller.signal.aborted) throw new DOMException('Aborted', 'AbortError');
        const sceneText = buildSceneText(item.range.from, to);

        const { instruction, contextText } = buildAudiencePrompt({
            sourcesText: sources.text,
            sceneText,
            from: item.range.from,
            to,
            shoot: item.shoot || getShoot(),
            cast: getCast(),
            interviewText: fullInterviewText(item),
            count,
            ownQuestions: own,
            nick,
            ...(writerOf(item) || {}),
        });
        const text = await requestModel({ instruction, contextText }, controller.signal);
        if (controller.signal.aborted) throw new DOMException('Aborted', 'AbortError');
        if (!text.trim()) throw new Error('Модель вернула пустой ответ — попробуй ещё раз или увеличь лимит токенов ответа.');

        const fresh = getChatStore()?.interviews.find((i) => i.id === itemId);
        if (!fresh || currentChatId() !== chatId) return;
        if (!Array.isArray(fresh.rounds)) fresh.rounds = [];
        fresh.rounds.push({ id: makeId(), createdAt: Date.now(), text, ownNick: own.length ? nick : '' });
        await saveChatStore();
        audienceDrafts.delete(itemId);
        toastr.success('Вопросы из зала добавлены 🎤', TOAST_TITLE);
    } catch (error) {
        if (controller.signal.aborted || error?.name === 'AbortError') {
            if (!controller.junketQuiet) toastr.info('Генерация остановлена', TOAST_TITLE);
        } else {
            console.error('[Junket]', error);
            toastr.error(String(error?.message || error), TOAST_TITLE);
        }
    } finally {
        if (audienceGen?.controller === controller) audienceGen = null;
        refreshBusy();
        refreshViewer(itemId);
    }
}

// ---------- Сценаристка под «После пилота» ----------

let writerGen = null;        // { controller, chatId, itemId } пока идёт запрос
let writerOpenFor = null;    // у какого интервью раскрыта панель

function writerQuestionsSetting() {
    const n = Math.round(Number(getSettings().writerQuestions));
    return Number.isFinite(n) ? Math.min(WRITER_Q_MAX, Math.max(WRITER_Q_MIN, n)) : WRITER_Q_MIN;
}

function writerPanelHtml(item) {
    const running = writerGen && writerGen.itemId === item.id;
    const open = writerOpenFor === item.id || running;
    const n = writerQuestionsSetting();
    return `
        <div class="jnk-writer-panel" ${open ? '' : 'hidden'}>
            <div class="jnk-hint">Сценаристка входит после ставок: раскрывает сюжет и проходится по теориям. Студия, каст, вайбы и площадка — как у этого интервью. Кто она такая — в ⚙.</div>
            ${open ? planBlockHtml() : '<div class="jnk-plan-slot"></div>'}
            <div class="jnk-questions">
                <label class="jnk-subtitle">Вопросов: <span class="jnk-writer-qcount">${n}</span></label>
                <input class="jnk-range-slider jnk-writer-q" type="range" min="${WRITER_Q_MIN}" max="${WRITER_Q_MAX}" step="1" value="${n}" aria-label="Вопросов сценаристке">
                <div class="jnk-hint">В конце — вопрос всем: «Что бы вы переписали в этом сценарии?» Он не входит в число вопросов.</div>
            </div>
            <div class="jnk-actions jnk-audience-actions">
                <button class="jnk-go jnk-writer-go ${running ? 'jnk-stop' : ''}" type="button">${running ? '<i class="fa-solid fa-stop"></i> Стоп' : 'Снять ✍️'}</button>
                <span class="jnk-status">${running ? '<i class="fa-solid fa-spinner fa-spin"></i> Сценаристка входит…' : ''}</span>
            </div>
        </div>`;
}

function bindWriterPanel(pane, item) {
    const box = pane.querySelector('.jnk-audience');
    const panel = box?.querySelector('.jnk-writer-panel');
    if (!panel) return;
    const plan = panel.querySelector('.jnk-plan');
    if (plan) bindPlanBlock(plan);
    box.querySelector('.jnk-writer-toggle').addEventListener('click', () => {
        panel.hidden = !panel.hidden;
        writerOpenFor = panel.hidden ? null : item.id;
        const slot = panel.querySelector('.jnk-plan-slot');
        if (slot && !panel.hidden) {
            slot.outerHTML = planBlockHtml();
            bindPlanBlock(panel.querySelector('.jnk-plan'));
        }
    });
    const slider = panel.querySelector('.jnk-writer-q');
    slider.addEventListener('input', () => {
        panel.querySelector('.jnk-writer-qcount').textContent = slider.value;
    });
    slider.addEventListener('change', () => {
        getSettings().writerQuestions = Number(slider.value);
        saveSettings();
    });
    panel.querySelector('.jnk-writer-go').addEventListener('click', () => onWriterClick(item.id));
}

async function onWriterClick(itemId) {
    if (writerGen) {
        writerGen.controller.junketQuiet = true;
        writerGen.controller.abort();
        const stopped = writerGen.itemId;
        writerGen = null;
        refreshBusy();
        toastr.info('Генерация остановлена', TOAST_TITLE);
        refreshViewer(stopped);
        return;
    }
    const store = getChatStore();
    const item = store?.interviews.find((i) => i.id === itemId);
    if (!item?.range) {
        toastr.warning('У этого интервью нет диапазона сообщений — позвать сценаристку не получится', TOAST_TITLE);
        return;
    }
    if (!canCallWriter(item)) {
        toastr.info('Сценаристка уже была в этом интервью', TOAST_TITLE);
        return;
    }
    const plan = currentPlanText();
    if (!plan) {
        toastr.warning('Сценаристке нужен сюжет: выбери страницу Скетчбука или вставь текст', TOAST_TITLE);
        return;
    }

    const writer = getWriter();
    const count = writerQuestionsSetting();
    const chatId = currentChatId();
    const controller = new AbortController();
    writerGen = { controller, chatId, itemId };
    refreshBusy();
    writerOpenFor = itemId;
    refreshViewer(itemId);

    try {
        const last = lastIndex();
        if (item.range.from > last) throw new Error('Сообщений из этого интервью в чате больше нет.');
        const to = Math.min(item.range.to, last);
        const sources = await collectSources(store.sources);
        if (controller.signal.aborted) throw new DOMException('Aborted', 'AbortError');

        const { instruction, contextText } = buildWriterSegmentPrompt({
            sourcesText: sources.text,
            sceneText: buildSceneText(item.range.from, to),
            from: item.range.from,
            to,
            shoot: item.shoot || getShoot(),
            cast: getCast(),
            interviewText: fullInterviewText(item),
            count,
            plan,
            writer,
        });
        const text = await requestModel({ instruction, contextText }, controller.signal);
        if (controller.signal.aborted) throw new DOMException('Aborted', 'AbortError');
        if (!text.trim()) throw new Error('Модель вернула пустой ответ — попробуй ещё раз или увеличь лимит токенов ответа.');

        const fresh = getChatStore()?.interviews.find((i) => i.id === itemId);
        if (!fresh || currentChatId() !== chatId) return;
        if (!Array.isArray(fresh.rounds)) fresh.rounds = [];
        // Сюжет и сценаристка — какими были на съёмке: по ним потом отвечает зал
        fresh.rounds.push({ id: makeId(), createdAt: Date.now(), kind: 'writer', text, plan, writer });
        await saveChatStore();
        writerOpenFor = null;
        toastr.success('Сценаристка в студии ✍️', TOAST_TITLE);
    } catch (error) {
        if (controller.signal.aborted || error?.name === 'AbortError') {
            if (!controller.junketQuiet) toastr.info('Генерация остановлена', TOAST_TITLE);
        } else {
            console.error('[Junket]', error);
            toastr.error(String(error?.message || error), TOAST_TITLE);
        }
    } finally {
        if (writerGen?.controller === controller) writerGen = null;
        refreshBusy();
        refreshViewer(itemId);
    }
}

// ---------- Реакции фандома ----------

let feedGen = null;          // { controller, chatId, itemId } пока идёт запрос
let feedOpenFor = null;      // у какого интервью раскрыта панель

function feedPanelHtml(item) {
    const s = getSettings();
    const running = feedGen && feedGen.itemId === item.id;
    const styleId = getFeedStyle(s.feedStyle).id;
    return `
        <div class="jnk-feed-panel" ${feedOpenFor === item.id || running ? '' : 'hidden'}>
            <div class="jnk-audience-row">
                <label class="jnk-cast-field">
                    <span>Стиль ленты</span>
                    <select class="text_pole jnk-feed-style">
                        ${FEED_STYLES.map((f) => `<option value="${f.id}" ${f.id === styleId ? 'selected' : ''}>${escapeHtml(f.label)}</option>`).join('')}
                    </select>
                </label>
                <label class="jnk-cast-field jnk-audience-count-field">
                    <span>Комментариев</span>
                    <input class="text_pole jnk-feed-count" type="number" min="${FEED_COUNT_MIN}" max="${FEED_COUNT_MAX}" step="1" value="${escapeHtml(s.feedCount)}">
                </label>
            </div>
            <div class="jnk-actions jnk-audience-actions">
                <button class="jnk-go jnk-feed-go ${running ? 'jnk-stop' : ''}" type="button">${running ? '<i class="fa-solid fa-stop"></i> Стоп' : 'Собрать'}</button>
                <span class="jnk-status">${running ? '<i class="fa-solid fa-spinner fa-spin"></i> Фандом печатает…' : ''}</span>
            </div>
        </div>`;
}

function bindFeedPanel(pane, item) {
    const box = pane.querySelector('.jnk-audience');
    if (!box) return;
    box.querySelector('.jnk-feed-toggle').addEventListener('click', () => {
        const panel = box.querySelector('.jnk-feed-panel');
        panel.hidden = !panel.hidden;
        feedOpenFor = panel.hidden ? null : item.id;
    });
    box.querySelector('.jnk-feed-style').addEventListener('change', (e) => {
        getSettings().feedStyle = getFeedStyle(e.target.value).id;
        saveSettings();
    });
    const count = box.querySelector('.jnk-feed-count');
    count.addEventListener('change', () => {
        let n = Math.round(Number(count.value));
        if (!Number.isFinite(n)) n = 12;
        n = Math.min(FEED_COUNT_MAX, Math.max(FEED_COUNT_MIN, n));
        count.value = n;
        getSettings().feedCount = n;
        saveSettings();
    });
    box.querySelector('.jnk-feed-go').addEventListener('click', () => onFeedClick(item.id));
}

async function onFeedClick(itemId) {
    if (feedGen) {
        feedGen.controller.junketQuiet = true;
        feedGen.controller.abort();
        const stopped = feedGen.itemId;
        feedGen = null;
        refreshBusy();
        toastr.info('Генерация остановлена', TOAST_TITLE);
        refreshViewer(stopped);
        return;
    }
    const store = getChatStore();
    const item = store?.interviews.find((i) => i.id === itemId);
    if (!item?.range) {
        toastr.warning('У этого интервью нет диапазона сообщений — собрать ленту не получится', TOAST_TITLE);
        return;
    }

    const s = getSettings();
    const count = Math.min(FEED_COUNT_MAX, Math.max(FEED_COUNT_MIN, Math.round(Number(s.feedCount)) || 12));
    const styleId = getFeedStyle(s.feedStyle).id;
    const chatId = currentChatId();
    const controller = new AbortController();
    feedGen = { controller, chatId, itemId };
    refreshBusy();
    feedOpenFor = itemId;
    refreshViewer(itemId);

    try {
        const last = lastIndex();
        if (item.range.from > last) throw new Error('Сообщений из этого интервью в чате больше нет.');
        const to = Math.min(item.range.to, last);
        const styleText = await loadFeedStyle(styleId);
        if (controller.signal.aborted) throw new DOMException('Aborted', 'AbortError');

        const { instruction, contextText } = buildFeedPrompt({
            contract: feedContract(count),
            styleText,
            count,
            sceneText: buildSceneText(item.range.from, to),
            from: item.range.from,
            to,
            interviewText: interviewPlainText(item),
            earlierText: feedPlainText(item.feed),
            cast: getCast(),
            studio: item.studio,
        });
        const text = await requestModel({ instruction, contextText }, controller.signal);
        if (controller.signal.aborted) throw new DOMException('Aborted', 'AbortError');
        const messages = parseComments(text);
        if (!messages) throw new Error('Не получилось разобрать ответ модели — попробуй ещё раз.');

        const fresh = getChatStore()?.interviews.find((i) => i.id === itemId);
        if (!fresh || currentChatId() !== chatId) return;
        if (!Array.isArray(fresh.feed)) fresh.feed = [];
        fresh.feed.push({ id: makeId(), createdAt: Date.now(), styleId, messages });
        await saveChatStore();
        toastr.success(`Фандом высказался: ${messages.length} 💬`, TOAST_TITLE);
    } catch (error) {
        if (controller.signal.aborted || error?.name === 'AbortError') {
            if (!controller.junketQuiet) toastr.info('Генерация остановлена', TOAST_TITLE);
        } else {
            console.error('[Junket]', error);
            toastr.error(String(error?.message || error), TOAST_TITLE);
        }
    } finally {
        if (feedGen?.controller === controller) feedGen = null;
        refreshBusy();
        refreshViewer(itemId);
    }
}

async function deleteFeed(itemId) {
    const ok = await confirmPopup('Удалить всю ленту комментариев под этим интервью? Отменить не получится.');
    if (!ok) return;
    const item = getChatStore()?.interviews.find((i) => i.id === itemId);
    if (!item) return;
    item.feed = [];
    await saveChatStore();
    refreshViewer(itemId);
}

async function deleteRound(itemId, roundId) {
    const target = getChatStore()?.interviews.find((i) => i.id === itemId)?.rounds?.find((r) => r.id === roundId);
    const ok = await confirmPopup(isWriterRound(target)
        ? 'Удалить сегмент сценаристки? Отменить не получится — зато её можно будет позвать заново.'
        : 'Удалить этот раунд вопросов из зала? Отменить не получится.');
    if (!ok) return;
    const item = getChatStore()?.interviews.find((i) => i.id === itemId);
    if (!item || !Array.isArray(item.rounds)) return;
    item.rounds = item.rounds.filter((r) => r.id !== roundId);
    await saveChatStore();
    refreshViewer(itemId);
}

function toggleFavorite(itemId, btn) {
    const item = getChatStore()?.interviews.find((i) => i.id === itemId);
    if (!item) return;
    item.favorite = !item.favorite;
    saveChatStoreDebounced();
    btn.classList.toggle('jnk-fav-on', item.favorite);
    btn.textContent = item.favorite ? '★' : '☆';
    btn.title = item.favorite ? 'Убрать из избранного' : 'В избранное';
}

async function pinCast(item) {
    const cast = getCast();
    const found = castFromTurns(parseInterview(fullInterviewText(item)).turns, cast);
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

/** Кнопки запуска пульсируют, пока идёт любая генерация. */
function refreshBusy() {
    setLauncherBusy(Boolean(generation || audienceGen || feedGen || bankGen || writerGen));
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
    // Запрос по старому чату больше не нужен
    if (generation) {
        generation.controller.junketQuiet = true;
        generation.controller.abort();
        generation = null;
        refreshBusy();
        toastr.info('Генерация остановлена: сменился чат', TOAST_TITLE);
    }
    if (audienceGen) {
        audienceGen.controller.junketQuiet = true;
        audienceGen.controller.abort();
        audienceGen = null;
        refreshBusy();
        toastr.info('Вопросы из зала остановлены: сменился чат', TOAST_TITLE);
    }
    if (feedGen) {
        feedGen.controller.junketQuiet = true;
        feedGen.controller.abort();
        feedGen = null;
        refreshBusy();
        toastr.info('Лента комментариев остановлена: сменился чат', TOAST_TITLE);
    }
    if (bankGen) {
        bankGen.controller.junketQuiet = true;
        bankGen.controller.abort();
        bankGen = null;
        refreshBusy();
        toastr.info('Сочинение вопросов остановлено: сменился чат', TOAST_TITLE);
    }
    if (writerGen) {
        writerGen.controller.junketQuiet = true;
        writerGen.controller.abort();
        writerGen = null;
        refreshBusy();
        toastr.info('Сценаристка остановлена: сменился чат', TOAST_TITLE);
    }
    audienceOpenFor = null;
    feedOpenFor = null;
    writerOpenFor = null;
    resetLoreTokenCache();
    archiveOpenId = null;
    archiveEditId = null;
    if (bankEditorEl) bankEditorEl.hidden = true;
    // Кнопки запуска прячутся, когда чата нет (главная страница)
    syncLaunchers();
    // Окно открыто — перерисовываем под новый чат, иначе ничего не делаем
    if (isOpen()) renderAll();
}

jQuery(async () => {
    getSettings();
    addSettingsDrawer(() => openWindow());
    addWandButton();
    initLaunchers(() => openWindow());

    const { eventSource, event_types } = ctx();
    eventSource.on(event_types.CHAT_CHANGED, onChatChanged);

    for (const key of ['MESSAGE_RECEIVED', 'MESSAGE_SENT', 'MESSAGE_DELETED', 'MESSAGE_EDITED', 'MESSAGE_SWIPED']) {
        if (event_types[key]) eventSource.on(event_types[key], onChatMessagesChanged);
    }
});

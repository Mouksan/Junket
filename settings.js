// Junket — настройки. Живут в самом окне (шестерёнка в шапке),
// в ящике расширений осталась только кнопка «Открыть Junket».
// Категории сворачиваются, как в Koma и DS Comments. Открыто сразу только «Оформление».

import { ctx, getSettings, saveSettings, escapeHtml } from './store.js';
import { LANGUAGES } from './formats.js';
import { THEMES, PAPERS, getTheme, normalizePaper, stageClass, DEMO_ITEM, DEMO_PERSONA } from './themes.js';
import { renderInterviewHtml } from './render.js';

function categoryHtml(icon, title, body, open = false) {
    return `
        <div class="jnk-cat">
            <button type="button" class="jnk-cat-head" aria-expanded="${open}">
                <span><i class="fa-solid ${icon} fa-fw"></i> ${title}</span>
                <i class="fa-solid fa-chevron-down jnk-cat-chevron"></i>
            </button>
            <div class="jnk-cat-body" ${open ? '' : 'hidden'}>${body}</div>
        </div>`;
}

/** Содержимое экрана настроек в окне. */
export function settingsPaneHtml() {
    const s = getSettings();
    const paper = normalizePaper(s.paper);

    const look = `
        <div class="jnk-label">Тема интервью</div>
        <div class="jnk-theme-grid" id="jnk_theme_grid"></div>
        <div class="jnk-label">Бумага</div>
        <div class="jnk-seg" id="jnk_paper">
            ${PAPERS.map((p) => `<button type="button" class="jnk-seg-btn ${p.id === paper ? 'active' : ''}" data-paper="${p.id}">${p.label}</button>`).join('')}
        </div>
        <div class="jnk-set-hint">Для Газеты, Сценария и Досье. Переключается и прямо в интервью.</div>`;

    const custom = s.promptSource === 'custom';

    const model = `
        <div class="jnk-label">Источник</div>
        <div class="jnk-seg" id="jnk_source">
            <button type="button" class="jnk-seg-btn ${custom ? '' : 'active'}" data-src="profile">Профиль</button>
            <button type="button" class="jnk-seg-btn ${custom ? 'active' : ''}" data-src="custom">Напрямую</button>
        </div>

        <div id="jnk_src_profile" ${custom ? 'hidden' : ''}>
            <label for="jnk_profile" class="jnk-label">Профиль подключения</label>
            <select id="jnk_profile" class="text_pole"></select>
            <div class="jnk-set-hint" id="jnk_profile_hint">Пусто — используется текущее подключение таверны.</div>
        </div>

        <div id="jnk_src_custom" ${custom ? '' : 'hidden'}>
            <label for="jnk_custom_endpoint" class="jnk-label">Endpoint URL</label>
            <input type="url" id="jnk_custom_endpoint" class="text_pole" placeholder="https://api.example.com/v1" value="${escapeHtml(s.customEndpoint)}">
            <label for="jnk_custom_key" class="jnk-label">API-ключ</label>
            <input type="password" id="jnk_custom_key" class="text_pole" autocomplete="off" placeholder="sk-..." value="${escapeHtml(s.customKey)}">
            <label for="jnk_custom_model" class="jnk-label">ID модели (необязательно)</label>
            <input type="text" id="jnk_custom_model" class="text_pole" placeholder="по умолчанию у API" value="${escapeHtml(s.customModel)}">
            <div class="jnk-set-hint">Любой OpenAI-совместимый адрес, можно с /v1 или полным до /chat/completions. Профиль таверны не трогается.</div>
        </div>

        <label for="jnk_max_tokens" class="jnk-label">Лимит токенов ответа</label>
        <input type="number" id="jnk_max_tokens" class="text_pole" min="1000" max="32000" step="500" value="${escapeHtml(s.maxTokens)}">
        <div class="jnk-set-hint">Размышления модели тратятся из этого же лимита. Если интервью обрывается на полуслове — увеличь.</div>

        <label for="jnk_reasoning" class="jnk-label">Размышления модели</label>
        <select id="jnk_reasoning" class="text_pole">
            <option value="min" ${s.reasoningEffort === 'auto' ? '' : 'selected'}>Минимум</option>
            <option value="auto" ${s.reasoningEffort === 'auto' ? 'selected' : ''}>На усмотрение модели</option>
        </select>
        <div class="jnk-set-hint">Работает и с профилем, и напрямую.</div>

        <label for="jnk_language" class="jnk-label">Язык интервью</label>
        <select id="jnk_language" class="text_pole">
            ${LANGUAGES.map((l) => `<option value="${l.id}" ${s.language === l.id ? 'selected' : ''}>${l.label}</option>`).join('')}
        </select>`;

    const lore = `
        <label for="jnk_lore_limit" class="jnk-label">Лимит токенов на лорбуки</label>
        <input type="number" id="jnk_lore_limit" class="text_pole" min="0" max="200000" step="1000" value="${escapeHtml(s.loreTokenLimit)}">
        <div class="jnk-set-hint">Если отмеченные лорбуки толще, записи с конца отрезаются целиком.</div>`;

    const jailbreak = `
        <label class="checkbox_label jnk-set-section">
            <input type="checkbox" id="jnk_jb_enabled" ${s.jailbreakEnabled ? 'checked' : ''}>
            <span>Блок джейлбрейка</span>
        </label>
        <div id="jnk_jb_body" class="jnk-subsection" ${s.jailbreakEnabled ? '' : 'hidden'}>
            <label for="jnk_jb_role" class="jnk-label">Роль</label>
            <select id="jnk_jb_role" class="text_pole">
                <option value="system" ${s.jailbreakRole === 'system' ? 'selected' : ''}>System</option>
                <option value="user" ${s.jailbreakRole === 'user' ? 'selected' : ''}>User</option>
                <option value="assistant" ${s.jailbreakRole === 'assistant' ? 'selected' : ''}>Assistant</option>
            </select>
            <div class="jnk-set-hint">System — дописывается к инструкции. User — перед контекстом, как будто от тебя. Assistant — начало ответа за модель (префилл), не все модели его принимают.</div>
            <label for="jnk_jb_text" class="jnk-label">Текст</label>
            <textarea id="jnk_jb_text" class="text_pole jnk-jb-text" rows="8" spellcheck="false">${escapeHtml(s.jailbreakText)}</textarea>
            <div class="jnk-set-hint">Макросы таверны работают.</div>
        </div>`;

    return `
        <div class="jnk-settings jnk-settings-window" id="jnk_settings_root">
            ${categoryHtml('fa-palette', 'Оформление', look, true)}
            ${categoryHtml('fa-plug', 'Модель для интервью', model)}
            ${categoryHtml('fa-book', 'Лорбуки', lore)}
            ${categoryHtml('fa-key', 'Джейлбрейк', jailbreak)}
        </div>`;
}

function drawerHtml() {
    return `
        <div class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b><i class="fa-solid fa-clapperboard" style="margin-right: 6px;"></i>「 JUNKET 」</b>
                <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content">
                <div class="jnk-settings">
                    <div class="jnk-drawer-hint">Интервью с актёрами по выбранным сценам чата. Настройки — под шестерёнкой в окне.</div>
                    <button class="menu_button jnk-open-btn" type="button">
                        <i class="fa-solid fa-clapperboard"></i>
                        <span>Открыть Junket</span>
                    </button>
                </div>
            </div>
        </div>`;
}

// ---------- Оформление ----------

/** Карточки тем: в каждой — демо-кусочек, нарисованный настоящей вёрсткой. */
function renderThemeGrid() {
    const grid = document.getElementById('jnk_theme_grid');
    if (!grid) return;
    const s = getSettings();
    const current = getTheme(s.theme).id;
    grid.innerHTML = THEMES.map((t) => `
        <div class="jnk-theme-card ${t.id === current ? 'jnk-theme-on' : ''}" data-theme="${t.id}" role="button" tabindex="0" aria-pressed="${t.id === current}">
            <div class="jnk-theme-name">${escapeHtml(t.label)}</div>
            <div class="jnk-theme-preview" aria-hidden="true">
                <div class="${stageClass(t.id, s.paper)}">
                    ${renderInterviewHtml(DEMO_ITEM, { theme: t.id, paper: s.paper, personaName: DEMO_PERSONA, preview: true })}
                </div>
            </div>
        </div>`).join('');
}

/** Обновить выбор темы и бумаги на экране настроек (если бумагу переключили из интервью). */
export function syncLookControls() {
    const paper = normalizePaper(getSettings().paper);
    document.querySelectorAll('#jnk_paper .jnk-seg-btn').forEach((b) => b.classList.toggle('active', b.dataset.paper === paper));
    renderThemeGrid();
}

/** Выпадашку профилей рисует и обновляет сама таверна (как в Koma). */
function setupProfileDropdown() {
    const hint = document.getElementById('jnk_profile_hint');
    try {
        ctx().ConnectionManagerRequestService.handleDropdown(
            '#jnk_profile',
            getSettings().profileId,
            (profile) => {
                getSettings().profileId = profile?.id || '';
                saveSettings();
            },
        );
    } catch (error) {
        console.warn('[Junket] профили подключений недоступны:', error?.message);
        const select = document.getElementById('jnk_profile');
        if (select) select.style.display = 'none';
        if (hint) hint.textContent = 'Connection Manager отключён — будет использовано текущее подключение таверны.';
    }
}

function bindText(id, key, transform = (v) => v) {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('input', () => {
        getSettings()[key] = transform(el.value);
        saveSettings();
    });
}

function bindNumber(id, key, min, max, fallback) {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('change', () => {
        let n = Math.round(Number(el.value));
        if (!Number.isFinite(n)) n = fallback;
        n = Math.min(max, Math.max(min, n));
        el.value = n;
        getSettings()[key] = n;
        saveSettings();
    });
}

/** Ящик в расширениях таверны: только кнопка открытия окна. */
export function addSettingsDrawer(onOpenWindow) {
    const host = document.getElementById('extensions_settings2') || document.getElementById('extensions_settings');
    if (!host || document.getElementById('jnk-settings')) return;

    const wrap = document.createElement('div');
    wrap.id = 'jnk-settings';
    wrap.innerHTML = drawerHtml();
    host.appendChild(wrap);

    wrap.querySelector('.jnk-open-btn').addEventListener('click', () => onOpenWindow());
}

/**
 * Оживить экран настроек. Вызывается один раз, когда окно уже в документе
 * (выпадашку профилей таверна ищет по id).
 */
export function bindSettingsPane() {
    const root = document.getElementById('jnk_settings_root');
    if (!root) return;

    // Категории
    root.addEventListener('click', (e) => {
        const head = e.target.closest('.jnk-cat-head');
        if (!head) return;
        const expanded = head.getAttribute('aria-expanded') === 'true';
        head.setAttribute('aria-expanded', String(!expanded));
        const body = head.nextElementSibling;
        if (body) body.hidden = expanded;
    });

    // Оформление
    renderThemeGrid();
    const grid = document.getElementById('jnk_theme_grid');
    const pickTheme = (card) => {
        if (!card) return;
        getSettings().theme = getTheme(card.dataset.theme).id;
        saveSettings();
        renderThemeGrid();
    };
    grid.addEventListener('click', (e) => pickTheme(e.target.closest('.jnk-theme-card')));
    grid.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        pickTheme(e.target.closest('.jnk-theme-card'));
    });
    document.getElementById('jnk_paper').addEventListener('click', (e) => {
        const btn = e.target.closest('.jnk-seg-btn');
        if (!btn) return;
        getSettings().paper = normalizePaper(btn.dataset.paper);
        saveSettings();
        syncLookControls();
    });

    // Источник модели
    document.getElementById('jnk_source').addEventListener('click', (e) => {
        const btn = e.target.closest('.jnk-seg-btn');
        if (!btn) return;
        const custom = btn.dataset.src === 'custom';
        getSettings().promptSource = custom ? 'custom' : 'profile';
        saveSettings();
        document.querySelectorAll('#jnk_source .jnk-seg-btn').forEach((b) => b.classList.toggle('active', b === btn));
        document.getElementById('jnk_src_profile').hidden = custom;
        document.getElementById('jnk_src_custom').hidden = !custom;
    });

    setupProfileDropdown();
    bindText('jnk_custom_endpoint', 'customEndpoint', (v) => v.trim());
    bindText('jnk_custom_key', 'customKey', (v) => v.trim());
    bindText('jnk_custom_model', 'customModel', (v) => v.trim());
    bindNumber('jnk_max_tokens', 'maxTokens', 1000, 32000, 6000);
    document.getElementById('jnk_language').addEventListener('change', (e) => {
        getSettings().language = LANGUAGES.some((l) => l.id === e.target.value) ? e.target.value : 'ru';
        saveSettings();
    });
    document.getElementById('jnk_reasoning').addEventListener('change', (e) => {
        getSettings().reasoningEffort = e.target.value === 'auto' ? 'auto' : 'min';
        saveSettings();
    });

    // Лорбуки
    bindNumber('jnk_lore_limit', 'loreTokenLimit', 0, 200000, 30000);

    // Джейлбрейк
    document.getElementById('jnk_jb_enabled').addEventListener('change', (e) => {
        getSettings().jailbreakEnabled = !!e.target.checked;
        saveSettings();
        document.getElementById('jnk_jb_body').hidden = !e.target.checked;
    });
    document.getElementById('jnk_jb_role').addEventListener('change', (e) => {
        const v = e.target.value;
        getSettings().jailbreakRole = ['system', 'user', 'assistant'].includes(v) ? v : 'system';
        saveSettings();
    });
    bindText('jnk_jb_text', 'jailbreakText');
}

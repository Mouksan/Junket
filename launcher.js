// Junket — кнопки запуска: в панели быстрых ответов и плавающая.
// Порт из DS Comments (src/ui/floating-launcher.js и ensureLauncher в index.js).
// Пункт «Junket» в меню расширений живёт отдельно (index.js) и есть всегда.

import { ctx, getSettings } from './store.js';

export const LAUNCHER_MODES = [
    { id: 'menu', label: 'Только меню расширений' },
    { id: 'bar', label: 'Панель быстрых ответов' },
    { id: 'floating', label: 'Плавающая кнопка' },
    { id: 'both', label: 'Обе' },
];

const BAR_ID = 'jnk-launcher';
const FAB_ID = 'jnk-fab';
const POSITION_KEY = 'jnk_fab_position';
const FAB_SIZE = 36;
const DRAG_THRESHOLD_PX = 6;          // сколько надо протащить, чтобы это был не клик
const DEFAULT_RIGHT = 20;
const DEFAULT_BOTTOM = 80;
const DEFAULT_RIGHT_MOBILE = 16;
const DEFAULT_BOTTOM_MOBILE = 120;    // на телефоне — выше поля ввода

let onOpen = () => {};
let busy = false;
let observer = null;
let remountTimer = null;
let resizeBound = false;

export function launcherMode() {
    const mode = getSettings().launcherMode;
    return LAUNCHER_MODES.some((m) => m.id === mode) ? mode : 'menu';
}

function hasOpenChat() {
    try {
        return Boolean(ctx().getCurrentChatId?.());
    } catch {
        return true;
    }
}

// ---------- Панель быстрых ответов ----------

function getQuickReplyBar() {
    return document.querySelector('#send_form #qr--bar')
        || document.getElementById('qr--bar')
        || document.querySelector('#send_form .qr--bar');
}

/** Стили кнопок у таверны висят на .qr--buttons — встаём туда, если ряд есть. */
function getBarHost() {
    const bar = getQuickReplyBar();
    if (!bar) return null;
    return bar.querySelector('.qr--buttons') || bar;
}

function ensureBarButton(want) {
    let btn = document.getElementById(BAR_ID);
    const host = want ? getBarHost() : null;
    if (!host) {
        btn?.remove();
        return;
    }
    if (!btn) {
        btn = document.createElement('div');
        btn.id = BAR_ID;
        btn.className = 'qr--button menu_button interactable jnk-launcher';
        btn.tabIndex = 0;
        btn.setAttribute('role', 'button');
        btn.setAttribute('aria-label', 'Junket');
        btn.title = 'Junket';
        btn.innerHTML = '<i class="fa-solid fa-clapperboard" aria-hidden="true"></i>';
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            onOpen();
        });
        btn.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onOpen();
            }
        });
    }
    if (btn.parentElement !== host) host.appendChild(btn);
}

// ---------- Плавающая кнопка ----------

function viewport() {
    return { width: window.innerWidth, height: window.innerHeight };
}

function isMobileViewport() {
    return window.innerWidth < 768;
}

function defaultPosition() {
    const v = viewport();
    const mobile = isMobileViewport();
    return {
        left: Math.max(0, v.width - FAB_SIZE - (mobile ? DEFAULT_RIGHT_MOBILE : DEFAULT_RIGHT)),
        top: Math.max(0, v.height - FAB_SIZE - (mobile ? DEFAULT_BOTTOM_MOBILE : DEFAULT_BOTTOM)),
    };
}

/** Верхняя панель таверны рисуется поверх кнопки — не даём под неё заехать. */
function topBarInset() {
    const bar = document.getElementById('top-bar');
    if (!bar) return 0;
    const bottom = bar.getBoundingClientRect().bottom;
    return Number.isFinite(bottom) && bottom > 0 ? Math.min(bottom, window.innerHeight) : 0;
}

function clamp(pos) {
    const v = viewport();
    const out = {
        left: Math.max(0, Math.min(pos.left, v.width - FAB_SIZE)),
        top: Math.max(0, Math.min(pos.top, v.height - FAB_SIZE)),
    };
    const inset = topBarInset();
    if (inset > 0) out.top = Math.min(Math.max(out.top, inset), v.height - FAB_SIZE);
    return out;
}

function place(fab, pos) {
    fab.style.left = `${pos.left}px`;
    fab.style.top = `${pos.top}px`;
}

function restorePosition(fab) {
    let saved = null;
    try {
        const raw = localStorage.getItem(POSITION_KEY);
        if (raw) saved = JSON.parse(raw);
    } catch {
        try { localStorage.removeItem(POSITION_KEY); } catch { /* приватный режим */ }
    }
    const v = viewport();
    const valid = saved
        && Number.isFinite(saved.left) && Number.isFinite(saved.top)
        && saved.left >= 0 && saved.top >= 0
        && saved.left + FAB_SIZE <= v.width
        && saved.top + FAB_SIZE <= v.height;
    place(fab, clamp(valid ? saved : defaultPosition()));
}

function persistPosition(fab) {
    try {
        localStorage.setItem(POSITION_KEY, JSON.stringify({
            left: parseFloat(fab.style.left),
            top: parseFloat(fab.style.top),
        }));
    } catch { /* не сохранится — не страшно */ }
}

function makeDraggable(fab) {
    let dragging = false;
    let offsetX = 0;
    let offsetY = 0;
    let startX = 0;
    let startY = 0;

    fab.addEventListener('pointerdown', (e) => {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        dragging = false;
        const r = fab.getBoundingClientRect();
        offsetX = e.clientX - r.left;
        offsetY = e.clientY - r.top;
        startX = r.left;
        startY = r.top;
        fab.setPointerCapture?.(e.pointerId);
        e.preventDefault();
    });

    fab.addEventListener('pointermove', (e) => {
        if (!fab.hasPointerCapture?.(e.pointerId)) return;
        const x = e.clientX - offsetX;
        const y = e.clientY - offsetY;
        if (!dragging && Math.hypot(x - startX, y - startY) > DRAG_THRESHOLD_PX) {
            dragging = true;
            fab.classList.add('jnk-fab-dragging');
        }
        if (dragging) place(fab, clamp({ left: x, top: y }));
    });

    fab.addEventListener('pointerup', (e) => {
        if (fab.hasPointerCapture?.(e.pointerId)) fab.releasePointerCapture(e.pointerId);
        const wasDragging = dragging;
        dragging = false;
        fab.classList.remove('jnk-fab-dragging');
        if (wasDragging) persistPosition(fab);
        else onOpen();
    });

    fab.addEventListener('pointercancel', (e) => {
        if (fab.hasPointerCapture?.(e.pointerId)) fab.releasePointerCapture(e.pointerId);
        dragging = false;
        fab.classList.remove('jnk-fab-dragging');
    });
}

function onResize() {
    const fab = document.getElementById(FAB_ID);
    if (!fab) return;
    const left = parseFloat(fab.style.left);
    const top = parseFloat(fab.style.top);
    if (Number.isFinite(left) && Number.isFinite(top)) place(fab, clamp({ left, top }));
}

function ensureFab(want) {
    let fab = document.getElementById(FAB_ID);
    if (!want) {
        fab?.remove();
        if (resizeBound) {
            window.removeEventListener('resize', onResize);
            resizeBound = false;
        }
        return;
    }
    if (fab) return;
    fab = document.createElement('div');
    fab.id = FAB_ID;
    fab.className = 'jnk-fab';
    fab.tabIndex = 0;
    fab.setAttribute('role', 'button');
    fab.setAttribute('aria-label', 'Junket');
    fab.title = 'Junket — клик открывает, перетаскивание двигает';
    fab.innerHTML = '<i class="fa-solid fa-clapperboard" aria-hidden="true"></i>';
    fab.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onOpen();
        }
    });
    document.body.appendChild(fab);
    restorePosition(fab);
    makeDraggable(fab);
    if (!resizeBound) {
        window.addEventListener('resize', onResize);
        resizeBound = true;
    }
}

// ---------- Общее ----------

/** Поставить или убрать кнопки по настройке, обновить «нет чата» и пульсацию. */
export function syncLaunchers() {
    const mode = launcherMode();
    ensureFab(mode === 'floating' || mode === 'both');
    ensureBarButton(mode === 'bar' || mode === 'both');
    document.body.classList.toggle('jnk-no-chat', !hasOpenChat());
    setLauncherBusy(busy);
}

/** Пульсация, пока что-то генерируется (окно можно закрыть — видно, что работа идёт). */
export function setLauncherBusy(value) {
    busy = Boolean(value);
    for (const id of [BAR_ID, FAB_ID]) {
        document.getElementById(id)?.classList.toggle('jnk-generating', busy);
    }
}

/**
 * Запуск: запоминает, что открывать, и следит за панелью быстрых ответов —
 * таверна её перестраивает, и кнопка должна вставать обратно.
 */
export function initLaunchers(openFn) {
    onOpen = openFn;
    const attach = () => {
        const sendForm = document.getElementById('send_form');
        if (sendForm && !observer) {
            observer = new MutationObserver(() => {
                if (launcherMode() !== 'bar' && launcherMode() !== 'both') return;
                if (document.getElementById(BAR_ID)?.isConnected && getBarHost()?.contains(document.getElementById(BAR_ID))) return;
                clearTimeout(remountTimer);
                remountTimer = setTimeout(syncLaunchers, 150);
            });
            observer.observe(sendForm, { childList: true, subtree: true });
        }
        syncLaunchers();
    };
    if (document.getElementById('send_form')) {
        attach();
    } else {
        const c = ctx();
        const ready = c.eventTypes?.APP_READY || c.event_types?.APP_READY;
        if (ready) c.eventSource.on(ready, attach);
        else attach();
    }
}

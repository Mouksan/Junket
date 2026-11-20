// Junket — «Сценарист в студии»: сюжет из Скетчбука Plotweaver и общий черновик чата.
// Скетчбук только читаем (chatMetadata.plotweaver_pages), страницы Plotweaver не трогаем.
// Черновик сюжета общий на чат: и для чипса формата, и для кнопки под «После пилота».

import { ctx, getChatStore, getSettings, saveChatStoreDebounced, DEFAULT_WRITER_PORTRAIT } from './store.js';

/** Сюжетные страницы Скетчбука (без персон Alter): сначала избранные. */
export function getSketchbookPlots() {
    const pages = ctx().chatMetadata?.plotweaver_pages?.pages;
    if (!Array.isArray(pages)) return [];
    const plots = pages.filter((p) => p && typeof p === 'object' && p.kind !== 'persona' && String(p.text || '').trim());
    return [...plots.filter((p) => p.favorite), ...plots.filter((p) => !p.favorite)];
}

export function getSketchbookPage(id) {
    return id ? getSketchbookPlots().find((p) => p.id === id) || null : null;
}

/**
 * Текст страницы для модели: без декораций Скетчбука, которых нет в обычном маркдауне
 * (++подчёркнутый++, ==хайлайт==). Жирный, курсив, заголовки и списки модель понимает сама.
 */
export function planFromPage(page) {
    return String(page?.text || '')
        .replace(/\r\n?/g, '\n')
        .replace(/==(?:(?:yellow|pink|green|blue):)?(.+?)==/g, '$1')
        .replace(/\+\+(.+?)\+\+/g, '$1')
        .trim();
}

/** Общий черновик сюжета этого чата: { pageId, text } или null. */
export function getWriterPlan() {
    const plan = getChatStore()?.writerPlan;
    if (!plan || typeof plan !== 'object') return null;
    return { pageId: typeof plan.pageId === 'string' ? plan.pageId : null, text: typeof plan.text === 'string' ? plan.text : '' };
}

export function setWriterPlan(plan) {
    const store = getChatStore();
    if (!store) return;
    store.writerPlan = plan ? { pageId: plan.pageId || null, text: String(plan.text || '') } : null;
    saveChatStoreDebounced();
}

/** Черновик ещё не тронут, а в Скетчбуке есть сюжет — берём первую (избранную) страницу. */
export function ensureWriterPlan() {
    const plan = getWriterPlan();
    if (plan) return plan;
    const first = getSketchbookPlots()[0];
    if (!first) return { pageId: null, text: '' };
    const fresh = { pageId: first.id, text: planFromPage(first) };
    setWriterPlan(fresh);
    return fresh;
}

/** Имя и портрет сценаристки из настроек (пустое — по умолчанию). */
export function getWriter() {
    const s = getSettings();
    return {
        name: String(s.writerName || '').trim() || 'Сценаристка',
        portrait: String(s.writerPortrait ?? '').trim() || DEFAULT_WRITER_PORTRAIT,
    };
}

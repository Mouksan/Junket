// Junket — темы оформления интервью.
// Тема меняет только вид: текст, копирование и промпты от неё не зависят.

export const THEMES = [
    { id: 'magazine', label: 'Журнал', paper: false },
    { id: 'messenger', label: 'Мессенджер', paper: false },
    { id: 'newspaper', label: 'Газета', paper: true },
    { id: 'script', label: 'Сценарий', paper: true },
    { id: 'dossier', label: 'Досье', paper: true },
];

export const PAPERS = [
    { id: 'day', label: '☀ День' },
    { id: 'night', label: '🌙 Ночь' },
];

export function getTheme(id) {
    return THEMES.find((t) => t.id === id) || THEMES[0];
}

export function normalizePaper(id) {
    return id === 'night' ? 'night' : 'day';
}

/** Классы сцены, внутри которой рисуются интервью и лента. */
export function stageClass(themeId, paperId) {
    const theme = getTheme(themeId);
    return `jnk-stage jnk-th-${theme.id}${theme.paper ? ` jnk-paper jnk-paper-${normalizePaper(paperId)}` : ''}`;
}

/** Кусочек для превью тем в настройках. Рисуется тем же кодом, что и настоящее интервью. */
export const DEMO_PERSONA = 'Адриан';
export const DEMO_ITEM = Object.freeze({
    id: 'demo-preview',
    title: '«Лифт был по сценарию»',
    format: 'junket',
    range: { from: 10, to: 20 },
    createdAt: 0,
    text: [
        '[TITLE] «Лифт был по сценарию»',
        '[Q] Сцена в лифте — это была импровизация?',
        '[A: Дэн Ким (Вейн)] *смеётся* По сценарию. А вот поцелуй — нет, это мы [BLEEP] сами придумали.',
        '[A: Ира Сон (Адриан)] Дэн, ты обещал молчать.',
    ].join('\n'),
    rounds: [],
});

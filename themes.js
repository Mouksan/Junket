// Junket — темы оформления интервью.
// Тема меняет только вид: текст, копирование и промпты от неё не зависят.

// own — своя палитра вместо цветов таверны; paper — у палитры есть день и ночь (☀/🌙)
export const THEMES = [
    { id: 'magazine', label: 'Журнал', own: false, paper: false },
    { id: 'messenger', label: 'Мессенджер', own: false, paper: false },
    { id: 'newspaper', label: 'Газета', own: true, paper: true },
    { id: 'script', label: 'Сценарий', own: true, paper: true },
    { id: 'dossier', label: 'Досье', own: true, paper: true },
    { id: 'scroll', label: 'Свиток', own: true, paper: true },
    { id: 'stream', label: 'Стрим-чат', own: true, paper: true },
    { id: 'subtitles', label: 'Субтитры', own: true, paper: false },
];

/** Темы, где работает ☀/🌙 — для подсказки в настройках. */
export function paperThemeLabels() {
    return THEMES.filter((t) => t.paper).map((t) => t.label);
}

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
    const own = theme.own ? ' jnk-paper' : '';
    const paper = theme.paper ? ` jnk-paper-${normalizePaper(paperId)}` : '';
    return `jnk-stage jnk-th-${theme.id}${own}${paper}`;
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

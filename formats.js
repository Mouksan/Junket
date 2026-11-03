// Junket — «Как снимаем»: форматы, площадки вопросов фанатов, болтовня, вайбы.
// Подписи — для окна (по-русски), prompt — что уходит модели (по-английски).

export const FORMATS = [
    {
        id: 'junket',
        formality: 'formal',
        icon: '🎬',
        label: 'Джанкет',
        questions: 6,
        prompt: `A press junket: a short promotional interview on a press day.
Formality: professional and on message. It is promo, so the actors are careful, praise the project and their partners and stay polished. No vulgar jokes, no slang, no swearing.`,
    },
    {
        id: 'talkshow',
        formality: 'formal',
        icon: '📺',
        label: 'Ток-шоу',
        questions: 5,
        prompt: `An evening talk show segment with a live studio audience.
Formality: neutral. Relaxed, the host jokes, the actors tell anecdotes, the audience laughs and reacts (you may note audience reactions in stage directions). It still stays within the bounds of broadcast TV: no vulgar jokes, no slang, no swearing.`,
    },
    {
        id: 'podcast',
        formality: 'informal',
        icon: '🎙️',
        label: 'Подкаст',
        questions: 12,
        prompt: `A long, relaxed podcast episode.
Formality: completely informal. Jokes, fandom memes and bait, fanservice, teasing, slang and swearing are welcome. Tangents and deep dives into small details are fine.`,
    },
    {
        id: 'fans',
        formality: null,   // у фанатов градус задаёт площадка
        icon: '💌',
        label: 'Вопросы фанатов',
        questions: 8,
        prompt: `Fan questions: the host reads questions that fans sent on social media. Fan questions are bold, weird, shippy and sometimes outrageous; the host may mention a fan's nickname.`,
    },
    {
        id: 'bts',
        formality: 'informal',
        icon: '🎞️',
        label: 'Закулисье',
        questions: 6,
        prompt: `Behind the scenes and bloopers: the actors share stories about takes, mistakes, corpsing, pranks on set, props, costume and makeup mishaps.
Formality: informal and playful.`,
    },
    {
        id: 'tabloid',
        formality: 'informal',
        icon: '📰',
        label: 'Жёлтая пресса',
        questions: 6,
        prompt: `A tabloid interview: the journalist digs for gossip, ships the actors with each other, asks provocative and loaded questions and tries to catch them off guard. The actors dodge, deflect and sometimes slip.`,
    },
    {
        id: 'reaction',
        formality: 'informal',
        icon: '👀',
        label: 'Реакция на сцену',
        questions: 6,          // здесь это моменты — остановки по ходу сцены
        prompt: `A reaction video, like a commentary track: they watch the footage of SCENES together and react out loud. There is no interviewer, no host and no audience: only the people listed in WHO IS WATCHING, talking to each other.
Formality: completely informal. Teasing, fandom jokes, slang and swearing are welcome.`,
    },
];

/** «Реакция на сцену»: без интервьюера, вместо вопросов — моменты. */
export function isReaction(shootOrFormat) {
    const id = typeof shootOrFormat === 'string' ? shootOrFormat : shootOrFormat?.format;
    return id === 'reaction';
}

// Только для «Реакции»: где смотрят. Ничего не выбрано — модель решает сама
export const WATCH_PLACES = [
    { id: 'studio', label: 'Студия', prompt: 'They watch in a studio, on camera, with a small crew around them.' },
    { id: 'home', label: 'Диван дома', prompt: 'They watch at home on a couch, with snacks and drinks: relaxed, unfiltered, nobody is filming them.' },
    { id: 'screening', label: 'Закрытый показ', prompt: 'They watch at a private screening in a small, dark cinema hall, seated next to each other, whispering and reacting.' },
];

// Только для «Вопросов фанатов»: где проходит встреча — от этого градус
export const FAN_VENUES = [
    {
        id: 'qa',
        formality: 'formal',
        label: 'Официальный Q&A',
        prompt: `Venue: an official fan Q&A at a promo event. Formality of a press junket: the host rephrases even the wildest fan question into polite, professional wording before asking it, and the actors answer carefully. No vulgar jokes, no slang, no swearing.`,
    },
    {
        id: 'show',
        formality: 'formal',
        label: 'На шоу',
        prompt: `Venue: a talk show segment. Neutral formality: wild fan questions are softened into broadcast-safe wording, and the answers stay within the bounds of TV. No vulgar jokes, no slang, no swearing.`,
    },
    {
        id: 'stream',
        formality: 'informal',
        label: 'Стрим',
        prompt: `Venue: a live stream. Completely informal, like a podcast: questions are read out as they are, the actors laugh and actually answer them. Slang and swearing are fine.`,
    },
];

export const BANTER = [
    {
        id: 'tight',
        label: 'По делу',
        prompt: 'Banter: none. Question, answers, next question. No follow-ups.',
        reaction: 'Banter: minimal. Short reactions at each pause, then they press play again.',
    },
    {
        id: 'light',
        label: 'Немного',
        prompt: 'Banter: light. The interviewer may occasionally follow up on an answer, and the actors may tease each other or react to each other\'s answers.',
        reaction: 'Banter: light. They react, tease each other and argue a little at each pause, then move on.',
    },
    {
        id: 'wild',
        label: 'Понеслось',
        prompt: 'Banter: free. Any topic may turn into a back-and-forth discussion over several turns; the actors interrupt each other and go on tangents, and the interviewer follows the fun threads.',
        reaction: 'Banter: free. Any pause may spiral into a long argument or tangent; they forget to press play, rewind to rewatch a bit, and bring up earlier moments again.',
    },
];

// Вайбы: в каждой строке один вариант или ничего (тогда модель решает сама)
export const VIBES = [
    {
        id: 'chemistry',
        label: 'Актёры между собой',
        options: [
            { id: 'friends', label: 'Лучшие друзья', prompt: 'The actors are best friends off camera: comfortable together, inside jokes, finishing each other\'s sentences.' },
            { id: 'rivals', label: 'Бесят друг друга', prompt: 'The actors genuinely get on each other\'s nerves. Real friction, not playful flirting: they contradict each other, interrupt, roll their eyes, mock each other\'s acting choices and on-set habits, compete for the last word, and the interviewer can feel the tension. They stay just professional enough to finish the interview.' },
            { id: 'flirt', label: 'Подозрительно много флиртуют', prompt: 'The actors flirt with each other suspiciously much, and everyone notices.' },
            { id: 'dating', label: 'Встречаются', prompt: 'The actors are dating in real life, and it is public: open flirting on air, private jokes, touches. Being a couple makes some scenes easier to play and others harder (it is awkward to do a fake fight with someone you love, or a kiss with half the crew watching), and they talk about it.' },
            { id: 'strangers', label: 'Только познакомились', prompt: 'The actors barely know each other yet: polite, a little awkward, getting to know each other during the interview.' },
        ],
    },
    {
        id: 'interviewer',
        label: 'Интервьюер',
        options: [
            { id: 'fangirl', label: 'Фанатка', prompt: 'The interviewer is an excited fangirl of the show: gushing, squealing, openly shipping the characters.' },
            { id: 'troll', label: 'Тролль', prompt: 'The interviewer is a troll: teasing, provocative, loves to embarrass the actors.' },
            { id: 'critic', label: 'Серьёзный критик', prompt: 'The interviewer is a serious critic: thoughtful, analytical questions about craft, themes and character arcs.' },
            { id: 'cynic', label: 'Циник-профи', prompt: 'The interviewer is a jaded, cynical professional: dry, sardonic, has seen it all and is hard to impress, until something genuinely surprises them.' },
        ],
    },
    {
        id: 'rating',
        label: 'Рейтинг',
        options: [
            { id: 'prime', label: 'Прайм-тайм (намёками)', prompt: 'Rating: prime time. Explicit content is only hinted at. Any swearing is bleeped, even in an informal format: write each bleeped word as [BLEEP], and people shush each other in the spirit of "shh, kids are watching".' },
            { id: 'adult', label: '18+ (прямо)', prompt: 'Rating: 18+. Explicit scenes may be discussed openly within the tone of the format: professionally in a formal format, with no brakes in an informal one. No bleeping.' },
        ],
    },
];

// Кто в студии: актёры (с кастом) или сами персонажи
export const STUDIO = [
    { id: 'actors', label: 'Актёры' },
    { id: 'characters', label: 'Персонажи' },
];

export const BANK_MODES = [
    { id: 'exact', label: 'Задать именно эти' },
    { id: 'examples', label: 'Как примеры' },
];

export const QUESTIONS_MIN = 3;
export const QUESTIONS_MAX = 15;
export const MOMENTS_MAX = 12;    // у «Реакции» потолок моментов ниже

export function getFormat(id) {
    return FORMATS.find((f) => f.id === id) || FORMATS[0];
}

/** 'formal' | 'informal' — градус выбранного формата (у фанатов — по площадке). */
export function getFormality(shoot) {
    const format = getFormat(shoot.format);
    return format.formality || getVenue(shoot.venue).formality;
}

export function getVenue(id) {
    return FAN_VENUES.find((v) => v.id === id) || FAN_VENUES[2];
}

export function getBanter(id) {
    return BANTER.find((b) => b.id === id) || BANTER[1];
}

export function defaultShoot() {
    return {
        format: 'junket',
        questions: getFormat('junket').questions,
        venue: 'stream',
        banter: 'light',
        vibes: { chemistry: null, interviewer: null, rating: null },
        wishes: '',
        studio: 'actors',
        guests: [],     // id НПС из каста, позванных в это интервью
        bankId: null,   // выбранный список из банка вопросов (null — не использовать)
        bankMode: 'examples',   // 'exact' — задать именно эти, 'examples' — как примеры
        topics: '',     // «Реакция»: о чём обязательно поговорить, по строке на тему
        place: null,    // «Реакция»: где смотрят (null — не важно)
    };
}

export function getWatchPlace(id) {
    return WATCH_PLACES.find((p) => p.id === id) || null;
}

/** Зацепки «Реакции» списком: непустые строки. */
export function topicList(shoot) {
    return String(shoot?.topics || '').split('\n').map((t) => t.trim()).filter(Boolean);
}

/** Приводит сохранённый в чате выбор к правильному виду (что-то могло пропасть или устареть). */
export function normalizeShoot(saved) {
    const base = defaultShoot();
    const s = saved && typeof saved === 'object' ? saved : {};
    const format = FORMATS.some((f) => f.id === s.format) ? s.format : base.format;
    let questions = Math.round(Number(s.questions));
    if (!Number.isFinite(questions)) questions = getFormat(format).questions;
    questions = Math.min(isReaction(format) ? MOMENTS_MAX : QUESTIONS_MAX, Math.max(QUESTIONS_MIN, questions));
    const vibes = {};
    for (const group of VIBES) {
        const value = s.vibes?.[group.id];
        vibes[group.id] = group.options.some((o) => o.id === value) ? value : null;
    }
    return {
        format,
        questions,
        venue: FAN_VENUES.some((v) => v.id === s.venue) ? s.venue : base.venue,
        banter: BANTER.some((b) => b.id === s.banter) ? s.banter : base.banter,
        vibes,
        wishes: typeof s.wishes === 'string' ? s.wishes : '',
        studio: STUDIO.some((x) => x.id === s.studio) ? s.studio : base.studio,
        guests: Array.isArray(s.guests) ? s.guests.filter((g) => typeof g === 'string') : [],
        bankId: typeof s.bankId === 'string' && s.bankId ? s.bankId : null,
        bankMode: s.bankMode === 'exact' ? 'exact' : 'examples',
        topics: typeof s.topics === 'string' ? s.topics : '',
        place: getWatchPlace(s.place) ? s.place : null,
    };
}

/** Подпись формата для архива: «📺 Ток-шоу», «💌 Вопросы фанатов (Стрим)». */
export function formatLabel(formatId, venueId) {
    const f = FORMATS.find((x) => x.id === formatId);
    if (!f) return '';
    const venue = f.id === 'fans' && venueId ? ` (${getVenue(venueId).label})` : '';
    return `${f.icon} ${f.label}${venue}`;
}

export const LANGUAGES = [
    { id: 'ru', label: 'Русский', prompt: 'Russian' },
    { id: 'en', label: 'English', prompt: 'English' },
];

export function getLanguage(id) {
    return LANGUAGES.find((l) => l.id === id) || LANGUAGES[0];
}

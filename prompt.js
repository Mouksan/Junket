// Junket — промпты: само интервью и раунд «Вопросы из зала».
// Формат, вайбы, мат, ритм, каст, имена и язык — общие для обоих.

import { getMainRoles, normalizeCast } from './cast.js';
import { getList, listQuestions, pickQuestions } from './bank.js';
import { getFormat, getVenue, getBanter, getFormality, VIBES, normalizeShoot, getLanguage, isReaction, isPilot, getPilotVenue, getWatchPlace, topicList, isWriter, getWriterVenue, WRITER_ROLE } from './formats.js';
import { getSettings } from './store.js';

/** Описание формата и площадки (у фанатов и «После пилота» градус задаёт площадка). */
function formatPromptLines(shoot) {
    const format = getFormat(shoot.format);
    const lines = [format.prompt];
    if (format.id === 'fans') lines.push(getVenue(shoot.venue).prompt);
    if (format.id === 'pilot') lines.push(getPilotVenue(shoot.pilotVenue).prompt);
    if (format.id === 'writer') lines.push(getWriterVenue(shoot.writerVenue).prompt);
    return lines;
}

function formatBlock(shoot) {
    const lines = formatPromptLines(shoot);
    lines.push(`Exactly ${shoot.questions} main questions from the interviewer.`);
    if (isPilot(shoot)) {
        lines.push('After the main questions, the interviewer always ends with one final question: everyone places a bet on how the story ends — where their relationship stands in the finale. Each person answers it with one or two sentences. This final question does not count toward the main questions.');
    }
    if (isWriter(shoot)) lines.push(rewriteQuestionLine());
    lines.push(`${getBanter(shoot.banter).prompt} Follow-ups and reactions do not count toward the number of main questions.`);
    lines.push('Several actors may answer the same question.');
    return lines.join('\n');
}

// «Сценарист в студии»: последний вопрос всем, сценаристке тоже
function rewriteQuestionLine() {
    return 'After the main questions, the interviewer always ends with one final question to everyone, the screenwriter included: "What would you rewrite in this script?" Each person answers it with one sentence. This final question does not count toward the main questions.';
}

/**
 * Кто такая сценаристка и как раскрывается сюжет.
 * writer — { name, portrait }; segment — она входит посреди готового интервью «После пилота».
 */
function writerBlock(writer, actors, segment = false) {
    const reactions = actors
        ? '- The actors react to each reveal as themselves: shock, delight, outrage, laughter, "you can\'t do that to him!". They say what they love or hate about what is coming, what will be hard, painful or embarrassing to play, and what they would beg her to change.'
        : '- The characters learn their own fate from their author, right here. They react from where they stand at the end of SCENES: denial, outrage, horror, smugness, bargaining, gloating over each other. They argue with her, plead, refuse to accept it. Their relationship and physical closeness stay exactly as at the end of SCENES while they hear about the future.';
    const bets = segment
        ? '\n- She has heard everything in INTERVIEW SO FAR, including the theories and the final bets. She reacts to them: mocks the wrong guesses, gets cagey or delighted about the ones close to the truth, quotes them back. The others react to how wrong or right they were.'
        : '';
    return `

THE SCREENWRITER
- ${writer.name} wrote the whole story and knows exactly where it goes. Tag her turns exactly [A: ${writer.name} (${WRITER_ROLE})]. She is a woman unless her name clearly says otherwise.
- Her manner: ${writer.portrait}
- She talks about the story, the characters and her work on the script. Her private life stays off the table: no family, partner, day job or personal anecdotes.
- SCREENWRITER'S PLAN in the context is her plan for the rest of the story. She reveals it here on purpose: spoilers are the whole point of this ${segment ? 'segment' : 'interview'}.
- She reveals the plan piece by piece, roughly in its order: the interviewer's questions lead her from one turn of the plot to the next. Use the concrete events, twists and details of the plan; never invent major events that contradict it. She may tease, hold back a detail for a beat, explain why she wrote it that way, or enjoy their suffering.
${reactions}${bets}
- She defends her choices and does not change the plan just because someone is upset.`;
}

function writerNamesLine(writer) {
    return `\n- The screenwriter is the only exception: her tag is exactly [A: ${writer.name} (${WRITER_ROLE})].`;
}

function planContext(plan) {
    return `\n\n# SCREENWRITER'S PLAN (the rest of the story; only the screenwriter knows it)\n${String(plan || '').trim()}`;
}

// «Реакция на сцену»: вместо вопросов — моменты, остановки по ходу сцены
function reactionFormatBlock(shoot) {
    const lines = [getFormat('reaction').prompt];
    const place = getWatchPlace(shoot.place);
    if (place) lines.push(place.prompt);
    const actors = shoot.studio !== 'characters';
    lines.push(`Structure:
- The footage plays in order, and they pause it at exactly ${shoot.questions} moments, in the chronological order of SCENES.
- Each moment is a concrete beat of SCENES worth stopping on: a line, an action, a look, a turn of events. Pick the juiciest ones; never stop on filler.
- At each pause they react and discuss it, usually in 2–6 turns. Someone may ask to rewind or replay a bit.
- ${actors
        ? 'At each pause the actors recall filming that moment (takes, improvisation, what was hard, funny or embarrassing) and cringe at or gush over their own acting.'
        : 'At each pause the characters react to themselves on screen: each defends their own version of what happened and why, they argue and call each other out ("you were jealous — look, right there").'}
- A few closing lines after the last moment are fine.`);
    lines.push(getBanter(shoot.banter).reaction);
    return lines.join('\n');
}

// «После пилота»: всё, что дальше SCENES, никому не известно — только догадки
function pilotBlock(shoot) {
    if (!isPilot(shoot)) return '';
    const actors = shoot.studio !== 'characters';
    const own = actors
        ? `- The actors also share first impressions of the pilot, of their characters and of each other, and what they hope the writers will do with their characters.`
        : `- The characters predict where they will be "when all this is over" with full conviction and in their own voice, with whatever denial, pride or lies their personalities bring: sworn enemies insist nothing will ever happen between them ("by the end I'll be on the throne and he'll be in chains"). Their relationships are exactly as they stand at the end of SCENES.`;
    return `

PREDICTIONS
- Everything beyond SCENES is unknown to everyone. They guess, theorize, argue and bet on the story as a whole.
- Think big: seasons and the finale, not the next scene or episode. Do not dwell on what happens right after SCENES.
- The main thread is the endgame: how each of them will change, where their relationship ends up in the hypothetical finale (together, apart, enemies forever, married, one of them dead or betrayed, at war), what the final scene might look like.
- Along the way they may name milestones as steps toward that ending: who confesses first, the first kiss, the big fight, a betrayal, a sacrifice. Milestones serve the endgame, they are not the focus.
- Guesses are concrete, varied and grounded in details of SCENES and the setting: twists, secrets, alliances, romance, rivalries, what each of them fears and hopes for.
- The character card, persona and lorebooks give knowledge of the world only. If they contain plans, summaries or events beyond SCENES, nobody knows those: never state them as facts. At most, someone may make a guess that happens to point that way.
${own}`;
}

function topicsBlock(shoot) {
    const topics = topicList(shoot);
    if (!topics.length) return '';
    return `\n\nTOPICS THEY MUST DISCUSS
Each of these must come up. Attach each one to the moment of SCENES where it fits best, or give it a pause of its own. They count toward the ${shoot.questions} moments.
${topics.map((t) => `- ${t}`).join('\n')}`;
}

function vibesBlock(shoot) {
    const lines = [];
    for (const group of VIBES) {
        // В режиме «Персонажи» отношения берутся из самой ролки, а не из вайба
        if (group.id === 'chemistry' && shoot.studio === 'characters') continue;
        // В «Реакции» интервьюера нет
        if (group.id === 'interviewer' && isReaction(shoot)) continue;
        const option = group.options.find((o) => o.id === shoot.vibes[group.id]);
        if (option) lines.push(`- ${option.prompt}`);
    }
    return lines.length ? `\n\nVIBE\n${lines.join('\n')}` : '';
}

// Ритм живого разговора: при «По делу» мягче, при «Понеслось» — на полную
function rhythmBlock(shoot) {
    const base = `RHYTHM
This is a live conversation, not a series of essays.
- Most turns are short: one to three sentences. A longer story is the exception, and someone usually cuts into it.`;
    if (shoot.banter === 'tight') {
        return `${base}
- Answers stay focused and to the point; keep them crisp rather than long.`;
    }
    const extra = `
- People interrupt each other, trail off mid-sentence (—), talk over each other and react with quick one-liners ("Ha!", "Oh come on!", "Wait, what?") — written in the interview's language.
- Several short turns in a row between the actors are normal.`;
    const wild = shoot.banter === 'wild'
        ? `\n- Let it get messy: overlapping jokes, callbacks to something said earlier, tangents that ${isReaction(shoot) ? 'someone' : 'the interviewer'} has to rein in.`
        : '';
    return `${base}${extra}${wild}`;
}

// Кто и сколько матерится — по характеру (у актёров — по характеру самого актёра)
function swearByCharacter(shoot) {
    const actors = shoot.studio !== 'characters';
    return `Who swears, and how often, depends on who they are. Coarse personalities and backgrounds (soldiers, criminals, athletes, working-class, hot-tempered or brash people) swear often and naturally; refined, reserved or well-mannered people swear rarely, only when genuinely provoked or overwhelmed. Consider personality, social class, occupation, region, age and the heat of the moment: heated arguments and embarrassing moments push it up, calm talk brings it down. No filler swearing: every swear word should feel earned.${actors ? " For actors this follows the actor's own off-camera personality, not the character they play." : ''}`;
}

// Мат: «Прайм-тайм» — запикан, формальный формат — нет, неформальный — да, но по характеру
function swearingBlock(shoot, language) {
    if (getFormality(shoot) === 'formal') {
        return '\n\nSWEARING\nNo swearing at all: this is a formal setting, even if explicit topics are allowed. Do not use [BLEEP].';
    }
    if (shoot.vibes.rating === 'prime') {
        // Само правило про [BLEEP] — в вайбе рейтинга; тут — кто вообще стал бы ругаться
        return `\n\nSWEARING\n${swearByCharacter(shoot)} Every swear word is bleeped as [BLEEP], as the rating says.`;
    }
    const profanity = language === 'Russian' ? 'real Russian profanity (мат)' : `real ${language} profanity`;
    return `\n\nSWEARING\nThis is an informal setting, so ${profanity} is allowed. ${swearByCharacter(shoot)}
When someone does swear, write the word in full, not a euphemism. Never censor, bleep or mask words: no [BLEEP], no letters replaced with symbols or dashes (write the word in full, not like х*й).`;
}

// Живой интервьюер: без «вопрос первый», мостики между темами (в «Реакции» интервьюера нет)
function interviewerBlock(shoot) {
    if (isReaction(shoot)) return '';
    return `

THE INTERVIEWER
- The interviewer is a real person, not a script. They never announce or number questions: no "Question one", "Next question", "Moving on to question three".
- Each question grows out of what was just said: pick up an answer, a joke or a slip and use it as a bridge to the next topic ("Speaking of jealousy…", "Wait, go back — you said…"). The conversation flows from topic to topic.
- Not every interviewer turn is a question: reactions, teasing, comments and short follow-ups are welcome.
- Stage directions for the interviewer are rare and varied; never open every turn with the same gesture.`;
}

// Банк вопросов: «именно эти» — случайные N из списка (не хватает — досочинить), «как примеры» — образец тона
function bankBlock(shoot) {
    if (isReaction(shoot)) return '';
    const list = getList(shoot.bankId);
    const questions = listQuestions(list);
    if (!questions.length) return '';
    const who = shoot.format === 'fans' ? 'They are read out as fan questions.' : 'They are asked by the interviewer.';
    const adapt = shoot.studio === 'characters'
        ? ' Questions about actors or filming are turned into questions the characters themselves can answer.'
        : '';

    if (shoot.bankMode === 'exact') {
        const picked = pickQuestions(questions, shoot.questions);
        const rest = shoot.questions - picked.length;
        const more = rest > 0 ? `\nThen add ${rest} more main question${rest === 1 ? '' : 's'} of your own about concrete moments of SCENES, in the same spirit.` : '';
        return `\n\nQUESTIONS TO ASK
These are the main questions, in this order. ${who} You may adjust the wording slightly to fit the format and the scene, but keep the meaning.${adapt}
${picked.map((q, i) => `${i + 1}. ${q}`).join('\n')}${more}`;
    }

    return `\n\nQUESTION EXAMPLES
These show the tone, boldness and kind of questions wanted. They are NOT the questions to ask: write your own questions about the concrete moments of SCENES in the same spirit.${adapt}
${questions.map((q) => `- ${q}`).join('\n')}`;
}

function wishesBlock(shoot) {
    const wishes = String(shoot.wishes || '').trim();
    return wishes ? `\n\nUSER WISHES (follow them)\n${wishes}` : '';
}

function modeOf(shoot) {
    if (isReaction(shoot)) return 'reaction';
    if (isWriter(shoot)) return 'writer';
    if (isPilot(shoot)) return 'pilot';
    return 'interview';
}

// Кто в студии: главные роли + позванные НПС (каст — из вкладки «Кастинг»)
function studioPeople(shoot, cast) {
    const mains = getMainRoles().map((role) => ({ name: role.name, ...(cast.mains[role.name] || { actor: '', notes: '' }), npc: false }));
    const guests = cast.npcs
        .filter((n) => n.name.trim() && shoot.guests.includes(n.id))
        .map((n) => ({ name: n.name.trim(), actor: n.actor, notes: n.notes, npc: true }));
    return [...mains, ...guests];
}

function whoActors(people) {
    return people.map((p) => {
        const role = p.npc ? `${p.name} (supporting character)` : p.name;
        const actor = p.actor.trim() ? `played by ${p.actor.trim()}` : 'actor not cast yet: invent one';
        const notes = p.notes.trim() ? `. Off camera: ${p.notes.trim()}` : '';
        return `- ${role} — ${actor}${notes}`;
    }).join('\n');
}

/**
 * Справка по касту: НПС с записанным актёром, которых не позвали в студию.
 * Если о них заговорят, имя и характер актёра должны совпадать с «Кастингом».
 */
function otherCastBlock(shoot, cast) {
    const others = cast.npcs.filter((n) => n.name.trim() && n.actor.trim() && !shoot.guests.includes(n.id));
    if (!others.length) return '';
    return `

OTHER CAST (not in the studio, reference only)
If anyone mentions one of these characters or the actor who plays them, use exactly this actor name and off-camera personality. Do not bring them up just because they are listed.
${others.map((n) => `- ${n.name.trim()} (supporting character) — played by ${n.actor.trim()}${n.notes.trim() ? `. Off camera: ${n.notes.trim()}` : ''}`).join('\n')}`;
}

/** Весь каст с актёрами — для ленты фандома (фанаты знают актёров по именам). */
function feedCastBlock(cast) {
    const lines = [];
    for (const role of getMainRoles()) {
        const entry = cast.mains[role.name];
        if (entry?.actor?.trim()) lines.push(`- ${role.name} — played by ${entry.actor.trim()}${entry.notes?.trim() ? `. Off camera: ${entry.notes.trim()}` : ''}`);
    }
    for (const n of cast.npcs) {
        if (n.name.trim() && n.actor.trim()) lines.push(`- ${n.name.trim()} (supporting character) — played by ${n.actor.trim()}${n.notes.trim() ? `. Off camera: ${n.notes.trim()}` : ''}`);
    }
    if (!lines.length) return '';
    return `

CAST (reference only)
If a comment mentions one of these characters' actors, use exactly this name. Actors not listed here are named as in the interview.
${lines.join('\n')}`;
}

function whoCharacters(people) {
    return people.map((p) => `- ${p.npc ? `${p.name} (supporting character)` : p.name}`).join('\n');
}

// Что известно о будущем: в «Сценаристе» — всё, что дальше SCENES, рассказывает она
function knowledgeLine(who, mode) {
    return mode === 'writer'
        ? `- ${who} know the story only up to the end of SCENES. Everything beyond it they learn here, from the screenwriter, as she reveals it.`
        : `- ${who} know the story only up to the end of SCENES. No spoilers or guesses beyond it presented as facts.`;
}

// mode: 'interview' | 'reaction' | 'pilot' | 'writer'
function actorsPart(people, language, mode = 'interview', otherCast = '') {
    const premise = {
        interview: 'The scenes in SCENES were just filmed. Now the actors sit down together for the interview described in FORMAT, about filming these scenes.',
        reaction: 'The scenes in SCENES were just filmed. Now the actors watch the edited footage of these scenes together, as described in FORMAT.',
        pilot: 'SCENES is the pilot episode, just filmed. The actors have only read and played the pilot: the rest of the script is kept secret from them. Now they sit down together for the interview described in FORMAT.',
        writer: 'The scenes in SCENES were just filmed. The actors have only read and played the story up to the end of SCENES: the rest of the script is kept secret from them. Now they sit down together for the interview described in FORMAT, and the screenwriter joins them.',
    }[mode];
    return `PREMISE
The roleplay story in the context is treated as a TV series being filmed. Its characters are played by actors. ${premise}

WHO IS INTERVIEWED
${whoActors(people)}${otherCast}

THE ACTORS
- Each actor is a distinct person with their own name, personality and manner, clearly different from the character they play (the actor behind a menacing character may be sweet and shy off camera, and so on).
- Each actor has the same gender as the character they play: a male character is played by a male actor, a female character by a female actor. Keep the actor's gender consistent in every verb and pronoun.
- Where WHO IS INTERVIEWED names an actor, use exactly that name (in tags and in the text) and follow the off-camera description if one is given; a given name always overrides the nationality rule below. Invent an actor's name and personality only where it says to invent one.
- The actors' nationality follows the story's setting: a story set in Russia has Russian actors, Japan — Japanese, China — Chinese, and so on. For a fictional world, use the real-world culture it is modeled on: medieval European-style fantasy — American and Western European actors; xianxia or wuxia — Chinese; East-Asian-inspired worlds — the matching country.
- If a character is explicitly a foreigner within the setting (for example, a Briton in China), only that character's actor comes from the matching other country.
- Write the actors' names in ${language} script (Cyrillic for Russian), both in tags and in the text. The script is only a transliteration (for example, Маркус Лин, Юлиан Ветмор) — it is never a reason to pick Russian names.
- Actors talk about their characters in the third person, and about filming: takes, improvisation, chemistry, what was hard, embarrassing, funny or memorable on set.
- Ground everything in concrete moments from SCENES: specific lines, actions, details. Avoid generic answers that could fit any story.
${knowledgeLine('The actors', mode)}`;
}

function charactersPart(people, mode = 'interview') {
    const premise = {
        interview: 'The roleplay story in the context was filmed as a TV series, and its characters have just watched the footage of SCENES. Now the characters themselves — not actors — sit down together for the interview described in FORMAT, about what happened in these scenes and how it was shown.',
        reaction: 'The roleplay story in the context was filmed as a TV series. Now the characters themselves — not actors — watch the footage of SCENES together, as described in FORMAT, and react to what happened and how it was shown.',
        pilot: 'The roleplay story in the context is being filmed as a TV series, and SCENES is its pilot episode, which the characters have just watched. Now the characters themselves — not actors — sit down together for the interview described in FORMAT, about where they think all of this will lead them in the end.',
        writer: 'The roleplay story in the context is being filmed as a TV series, and the characters have just watched the footage of SCENES. Now the characters themselves — not actors — sit down together for the interview described in FORMAT, face to face with their author: the screenwriter who decides what happens to them next.',
    }[mode];
    return `PREMISE
${premise}

WHO IS INTERVIEWED
${whoCharacters(people)}

THE CHARACTERS
- They speak in the first person as themselves, with the personalities, speech manners, knowledge and relationships they have in the story at the end of SCENES.
- Their relationship, intimacy and physical closeness with each other are exactly as they stand at the end of SCENES, not where the story may go later. If they have not even held hands yet, they do not touch, sit close or flirt openly now; any tension shows in looks, distance and words. Stage directions and body language match that level.
- They react to the footage: comment on what they did and felt, argue about how they were portrayed, tease, defend themselves, confront each other.
- They know they are in a show (the fourth wall is broken) but stay fully themselves. There are no actors and no talk about filming technique.
- Ground everything in concrete moments from SCENES: specific lines, actions, details. Avoid generic answers that could fit any story.
${knowledgeLine('They', mode)}`;
}

/**
 * Собирает инструкцию и контекст для модели.
 * sourcesText — карточка/персона/лорбуки, sceneText — выбранные сообщения, shoot — выбор «Как снимаем».
 */
export function buildInterviewPrompt({ sourcesText, sceneText, from, to, shoot: rawShoot, cast: rawCast, plan = '', writer = null }) {
    const shoot = normalizeShoot(rawShoot);
    const cast = normalizeCast(rawCast);
    const language = getLanguage(getSettings().language).prompt;
    const people = studioPeople(shoot, cast);
    const actors = shoot.studio !== 'characters';
    const reaction = isReaction(shoot);
    const withWriter = isWriter(shoot) && writer;
    const piece = reaction ? 'reaction video' : 'interview';
    const example = people[0]?.name || 'Name';
    const speakerTag = actors
        ? '[A: Actor Name (Character Name)] an actor\'s ' + (reaction ? 'line' : 'answer') + ' — Character Name exactly as listed in WHO IS INTERVIEWED'
        : `[A: Speaker Name (Character Name)] a character's ${reaction ? 'line' : 'answer'} — Speaker Name is the character's own name in ${language} as the story uses it, Character Name exactly as listed in WHO IS INTERVIEWED`;

    const turnTags = reaction
        ? `Then the moments, in chronological order. Each moment starts with a marker line:
[M: number] a short caption of the moment in ${language}, a few words about what happens on screen; the number is the #number of the message in SCENES where this moment happens
After the marker, every turn starts on a new line with a tag:
${speakerTag}
There is no interviewer and there are no [Q] lines.`
        : `Then every turn starts on a new line with a tag:
[Q] the interviewer's question or remark
${speakerTag}`;

    let instruction = `You are writing a fictional ${actors && !reaction ? 'behind-the-scenes ' : ''}${piece}.

${actors ? actorsPart(people, language, modeOf(shoot), otherCastBlock(shoot, cast)) : charactersPart(people, modeOf(shoot))}

FORMAT
${reaction ? reactionFormatBlock(shoot) : formatBlock(shoot)}${pilotBlock(shoot)}${withWriter ? writerBlock(writer, actors) : ''}${vibesBlock(shoot)}${swearingBlock(shoot, language)}${isWriter(shoot) ? '' : bankBlock(shoot)}${reaction ? topicsBlock(shoot) : ''}${wishesBlock(shoot)}

${rhythmBlock(shoot)}${interviewerBlock(shoot)}

OUTPUT MARKUP (strict)
The first line is the headline:
[TITLE] a catchy headline for this ${piece} in ${language}, in the style of the format; it may quote a memorable line from it
${turnTags}
A turn may span several paragraphs until the next tag.
Stage directions go in *asterisks* inside a turn: *laughs*, *covers face with both hands*. Emoji are allowed sparingly inside stage directions.
Start immediately with the [TITLE] line. No preamble, no closing notes.

NAMES
- In [A: …] tags, the name in parentheses is the character's name exactly as listed in WHO IS INTERVIEWED, for example [A: ${actors ? 'Actor Name' : 'Speaker Name'} (${example})]. Never translate, transliterate or decline it.${withWriter ? writerNamesLine(writer) : ''}
- Everywhere else — in ${reaction ? 'captions, lines' : 'questions, answers'} and stage directions — use every name (characters, NPCs, places) in the form the story itself uses in SCENES, in ${language} and declined according to ${language} grammar. The character card, persona and lorebooks may spell names in another script; do not copy those spellings into the text.
- If a name never appears in SCENES, transliterate it into ${language} the way the story would.

LANGUAGE
Write the whole ${piece} in ${language}, except the character names inside the [A: …] tag parentheses.
No words or phrases in other languages: no English (or any other) interjections, catchphrases or quotes mixed in. Everything is said in ${language}.`;

    // В «Реакции» людей не интервьюируют — они смотрят
    if (reaction) instruction = instruction.replaceAll('WHO IS INTERVIEWED', 'WHO IS WATCHING');

    const contextText = `${sourcesText ? `${sourcesText}\n\n` : ''}# SCENES (messages #${from}–#${to})
${sceneText}${withWriter ? planContext(plan) : ''}

# TASK
Write the ${piece} now, following the instruction exactly.`;

    return { instruction, contextText };
}

// ---------- Вопросы из зала ----------

/**
 * Раунд вопросов из зала: продолжение готового интервью.
 * interviewText — интервью вместе с прошлыми раундами; count — сколько зрительских вопросов;
 * ownQuestions — вопросы автора (могут быть пустыми); nick — ник автора в зале.
 */
export function buildAudiencePrompt({ sourcesText, sceneText, from, to, shoot: rawShoot, cast: rawCast, interviewText, count, ownQuestions, nick, writer = null, plan = '' }) {
    const shoot = normalizeShoot(rawShoot);
    const cast = normalizeCast(rawCast);
    const language = getLanguage(getSettings().language).prompt;
    const people = studioPeople(shoot, cast);
    const actors = shoot.studio !== 'characters';
    const example = people[0]?.name || 'Name';
    const own = (ownQuestions || []).filter((q) => String(q).trim());
    const total = count + own.length;
    // Сценаристка уже в студии (формат «Сценарист» или её сегмент после пилота): сюжет раскрыт
    const mode = writer ? 'writer' : modeOf(shoot);
    const speakerTag = actors
        ? '[A: Actor Name (Character Name)] an answer — Character Name exactly as listed in WHO IS INTERVIEWED'
        : `[A: Speaker Name (Character Name)] an answer — Speaker Name is the character's own name in ${language}, Character Name exactly as listed in WHO IS INTERVIEWED`;

    const formatLines = formatPromptLines(shoot);
    formatLines.push(getBanter(shoot.banter).prompt);

    const ownBlock = own.length
        ? `
- The other ${own.length} question${own.length === 1 ? '' : 's'} come${own.length === 1 ? 's' : ''} from the audience member "${nick}". Ask them as written: you may adjust the wording slightly to fit the format, never the meaning. Sign each of them exactly [F: ${nick}]. Mix them in among the invented questions, not all at the start or at the end.
${own.map((q, i) => `  ${i + 1}. ${q}`).join('\n')}`
        : '';

    const instruction = `You are continuing a fictional ${actors ? 'behind-the-scenes ' : ''}interview with a segment of questions from the audience.

${actors ? actorsPart(people, language, mode, otherCastBlock(shoot, cast)) : charactersPart(people, mode)}

FORMAT OF THE INTERVIEW
${formatLines.join('\n')}${writer ? audienceWriterBlock(writer) : pilotBlock(shoot)}${vibesBlock(shoot)}${swearingBlock(shoot, language)}${wishesBlock(shoot)}

AUDIENCE SEGMENT
- INTERVIEW SO FAR contains the interview already recorded. Continue it: the host briefly opens the floor to the audience in one short [Q] line, even if the interview already said goodbye.
- Exactly ${total} audience question${total === 1 ? '' : 's'}.
- ${count} of them come from audience members you invent: each has a fandom-style nickname, like a real social media handle (Latin or Cyrillic letters, underscores). Their questions are bold, shippy, funny or touching, about concrete moments of SCENES and of the interview so far.${ownBlock}
- The same people answer as in INTERVIEW SO FAR: the same names, personalities, relationships and running jokes. Do not repeat jokes or stories that were already told.
- Several people may answer one question; follow-ups and short reactions are welcome. The host may close with one short line at the end.

${rhythmBlock(shoot)}${interviewerBlock(shoot)}

OUTPUT MARKUP (strict)
Every turn starts on a new line with a tag:
[Q] the host's remark
[F: Nickname] an audience question — the nickname exactly as it should be shown
${speakerTag}
A turn may span several paragraphs until the next tag.
Stage directions go in *asterisks* inside a turn. Emoji are allowed sparingly inside stage directions.
No [TITLE]. Start immediately with the host's [Q] line. No preamble, no closing notes.

NAMES
- In [A: …] tags, the name in parentheses is the character's name exactly as listed in WHO IS INTERVIEWED, for example [A: ${actors ? 'Actor Name' : 'Speaker Name'} (${example})]. Never translate, transliterate or decline it. Use the same speaker names as in INTERVIEW SO FAR.${writer ? writerNamesLine(writer) : ''}
- Everywhere else, use every name (characters, NPCs, places) in the form the story itself uses in SCENES, in ${language} and declined according to ${language} grammar.

LANGUAGE
Write everything in ${language}, except the character names inside the [A: …] tag parentheses and the audience nicknames.
No words or phrases in other languages: no English (or any other) interjections, catchphrases or quotes mixed in.`;

    const contextText = `${sourcesText ? `${sourcesText}\n\n` : ''}# SCENES (messages #${from}–#${to})
${sceneText}

# INTERVIEW SO FAR
${interviewText}${writer ? planContext(plan) : ''}

# TASK
Write the audience segment now, following the instruction exactly.`;

    return { instruction, contextText };
}

// Зал при сценаристке: она уже в студии и тоже отвечает
function audienceWriterBlock(writer) {
    return `

THE SCREENWRITER IS IN THE STUDIO
- ${writer.name}, the screenwriter, is part of INTERVIEW SO FAR and is still in the studio. Tag her turns exactly [A: ${writer.name} (${WRITER_ROLE})].
- Her manner: ${writer.portrait}
- Audience members may address questions to her, and she may answer any question, especially about the plot. She stays consistent with what she already revealed and with SCREENWRITER'S PLAN; she may reveal a little more of it, never anything that contradicts it.
- Everyone already knows what she revealed in INTERVIEW SO FAR and reacts with that knowledge.
- Her private life stays off the table: no family, partner, day job or personal anecdotes.`;
}

// ---------- Сценаристка после «После пилота» ----------

/**
 * Сегмент «Сценарист в студии» под готовым интервью «После пилота»: она входит после ставок.
 * shoot — настройки того интервью (студия, каст, вайбы, площадка); count — сколько главных вопросов;
 * plan — сюжет; writer — { name, portrait }.
 */
export function buildWriterSegmentPrompt({ sourcesText, sceneText, from, to, shoot: rawShoot, cast: rawCast, interviewText, count, plan, writer }) {
    const shoot = normalizeShoot(rawShoot);
    const cast = normalizeCast(rawCast);
    const language = getLanguage(getSettings().language).prompt;
    const people = studioPeople(shoot, cast);
    const actors = shoot.studio !== 'characters';
    const example = people[0]?.name || 'Name';
    const speakerTag = actors
        ? '[A: Actor Name (Character Name)] an answer — Character Name exactly as listed in WHO IS INTERVIEWED'
        : `[A: Speaker Name (Character Name)] an answer — Speaker Name is the character's own name in ${language}, Character Name exactly as listed in WHO IS INTERVIEWED`;

    const formatLines = formatPromptLines(shoot);
    formatLines.push('Until now nobody knew how the story goes on. From this moment on, the screenwriter tells them.');

    const instruction = `You are continuing a fictional ${actors ? 'behind-the-scenes ' : ''}interview with a surprise segment: the screenwriter of the series walks into the studio.

${actors ? actorsPart(people, language, 'writer', otherCastBlock(shoot, cast)) : charactersPart(people, 'writer')}

FORMAT OF THE INTERVIEW
${formatLines.join('\n')}${writerBlock(writer, actors, true)}${vibesBlock(shoot)}${swearingBlock(shoot, language)}${wishesBlock(shoot)}

SCREENWRITER SEGMENT
- INTERVIEW SO FAR is the interview already recorded right after the pilot: everyone guessed where the story is going and placed their bets. Continue it, even if the interview already said goodbye.
- Open with the host's [Q] line announcing a surprise guest. The screenwriter walks in (a stage direction), and the room reacts.
- Then exactly ${count} main questions from the interviewer, to the screenwriter and to everyone else, as the plan unfolds.
- ${rewriteQuestionLine()}
- ${getBanter(shoot.banter).prompt} Follow-ups and reactions do not count toward the number of main questions.
- The same people answer as in INTERVIEW SO FAR: the same names, personalities, relationships and running jokes. Do not repeat jokes or stories that were already told.

${rhythmBlock(shoot)}${interviewerBlock(shoot)}

OUTPUT MARKUP (strict)
Every turn starts on a new line with a tag:
[Q] the interviewer's question or remark
${speakerTag}
A turn may span several paragraphs until the next tag.
Stage directions go in *asterisks* inside a turn. Emoji are allowed sparingly inside stage directions.
No [TITLE]. Start immediately with the interviewer's [Q] line. No preamble, no closing notes.

NAMES
- In [A: …] tags, the name in parentheses is the character's name exactly as listed in WHO IS INTERVIEWED, for example [A: ${actors ? 'Actor Name' : 'Speaker Name'} (${example})]. Never translate, transliterate or decline it. Use the same speaker names as in INTERVIEW SO FAR.${writerNamesLine(writer)}
- Everywhere else, use every name (characters, NPCs, places) in the form the story itself uses in SCENES, in ${language} and declined according to ${language} grammar. The plan, card, persona and lorebooks may spell names in another script; do not copy those spellings into the text.

LANGUAGE
Write everything in ${language}, except the character names inside the [A: …] tag parentheses.
No words or phrases in other languages: no English (or any other) interjections, catchphrases or quotes mixed in.`;

    const contextText = `${sourcesText ? `${sourcesText}\n\n` : ''}# SCENES (messages #${from}–#${to})
${sceneText}

# INTERVIEW SO FAR
${interviewText}${planContext(plan)}

# TASK
Write the screenwriter segment now, following the instruction exactly.`;

    return { instruction, contextText };
}

// ---------- Реакции фандома ----------

/**
 * Лента комментов под интервью. contract и styleText — из comments.js
 * (контракт ответа и стиль ленты из ST-Comments); interviewText — интервью с раундами;
 * earlierText — прошлые комменты этой ленты (пусто, если лента новая).
 */
export function buildFeedPrompt({ contract, styleText, count, sceneText, from, to, interviewText, earlierText, cast: rawCast, studio }) {
    const language = getLanguage(getSettings().language).prompt;
    // В режиме «Персонажи» актёров нет — справку не шлём
    const castText = studio === 'characters' ? '' : feedCastBlock(normalizeCast(rawCast));
    const instruction = `${contract}

Language of the comments: ${language}, unless the style below says otherwise. Keep the characters' and actors' names exactly as the interview writes them.${castText}

${styleText}`;

    const contextText = `[Episode] (messages #${from}–#${to})
${sceneText}

[Interview]
${interviewText}${earlierText ? `

[Earlier comments]
${earlierText}` : ''}

# TASK
Write exactly ${count} new comments now, as a JSON array only.`;

    return { instruction, contextText };
}

// ---------- «Сочинить список» для банка вопросов ----------

/**
 * Авторский список вопросов героям истории.
 * names — главные роли (персы и персона); sample — вопросы списка-образца (может быть пустым).
 */
export function buildBankPrompt({ sourcesText, names, count, wishes, sample }) {
    const language = getLanguage(getSettings().language).prompt;
    const who = names.length ? names.join(', ') : 'the main characters';
    const sampleBlock = sample?.length
        ? `

STYLE SAMPLE
These questions show the tone, boldness and kind of wording wanted. Do NOT copy them or reuse their topics: write new questions about this story in the same spirit.
${sample.map((q) => `- ${q}`).join('\n')}`
        : '';
    const wishText = String(wishes || '').trim();

    const instruction = `You are writing a list of questions for a fictional interview with the characters of a roleplay story. The story is in the context: the character card, the user persona${sourcesText.includes('# LOREBOOK') ? ', a lorebook with plot summaries' : ''}${sourcesText.includes('# RECENT MESSAGES') ? ' and the most recent messages' : ''}.

WHO IS ASKED
The main characters: ${who}. A question may be addressed to one of them by name, or to all of them at once ("Who of you…", "Both of you…").

THE QUESTIONS
- Write exactly ${count} questions.
- Every question is grounded in concrete details of this story: events, decisions, secrets, promises, relationships, running jokes, side characters, objects. No generic questions that could fit any story.
- Mix registers across the list, shuffled rather than grouped: serious and deep; "what if" questions and alternate turns of the plot; role swaps and other twists of the premise; funny and absurd; spicy, explicit and indiscreet; tricky, loaded and embarrassing.
- Some questions may use playful formats: "answer at the same time, on the count of three", "one word each", "each answers for themselves, then compare", "name a red flag".
- One or two sentences per question. Sharp, specific, a little provocative. No near-duplicates.${sampleBlock}${wishText ? `

USER WISHES (follow them)
${wishText}` : ''}

NAMES
Use every name (characters, side characters, places) in the form the story itself uses in its messages, in ${language} and declined according to ${language} grammar. The card, persona and lorebook may spell names in another script; do not copy those spellings.

OUTPUT (strict)
Exactly ${count} lines, one question per line. No numbering, no bullets, no headings, no blank lines, no quotes around the questions, no preamble, no closing notes.

LANGUAGE
Write everything in ${language}. No words or phrases in other languages.`;

    const contextText = `${sourcesText}

# TASK
Write the ${count} questions now, following the instruction exactly.`;

    return { instruction, contextText };
}

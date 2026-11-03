// Junket — промпты: само интервью и раунд «Вопросы из зала».
// Формат, вайбы, мат, ритм, каст, имена и язык — общие для обоих.

import { getMainRoles, normalizeCast } from './cast.js';
import { getList, listQuestions, pickQuestions } from './bank.js';
import { getFormat, getVenue, getBanter, getFormality, VIBES, normalizeShoot, getLanguage } from './formats.js';
import { getSettings } from './store.js';

function formatBlock(shoot) {
    const format = getFormat(shoot.format);
    const lines = [format.prompt];
    if (format.id === 'fans') lines.push(getVenue(shoot.venue).prompt);
    lines.push(`Exactly ${shoot.questions} main questions from the interviewer.`);
    lines.push(`${getBanter(shoot.banter).prompt} Follow-ups and reactions do not count toward the number of main questions.`);
    lines.push('Several actors may answer the same question.');
    return lines.join('\n');
}

function vibesBlock(shoot) {
    const lines = [];
    for (const group of VIBES) {
        // В режиме «Персонажи» отношения берутся из самой ролки, а не из вайба
        if (group.id === 'chemistry' && shoot.studio === 'characters') continue;
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
        ? '\n- Let it get messy: overlapping jokes, callbacks to something said earlier, tangents that the interviewer has to rein in.'
        : '';
    return `${base}${extra}${wild}`;
}

// Мат: «Прайм-тайм» — запикан, формальный формат — нет, неформальный — да
function swearingBlock(shoot, language) {
    if (shoot.vibes.rating === 'prime') return '';   // правило про [BLEEP] уже в вайбе рейтинга
    if (getFormality(shoot) === 'formal') {
        return '\n\nSWEARING\nNo swearing at all: this is a formal setting, even if explicit topics are allowed. Do not use [BLEEP].';
    }
    const profanity = language === 'Russian' ? 'strong Russian profanity (мат)' : `strong ${language} profanity`;
    return `\n\nSWEARING\nThis is an informal setting. Use real ${profanity} naturally and more than once, the way people actually talk off camera. Not euphemisms. Never censor, bleep or mask words: no [BLEEP], no letters replaced with symbols or dashes (write the word in full, not like х*й).`;
}

// Банк вопросов: «именно эти» — случайные N из списка (не хватает — досочинить), «как примеры» — образец тона
function bankBlock(shoot) {
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

function whoCharacters(people) {
    return people.map((p) => `- ${p.npc ? `${p.name} (supporting character)` : p.name}`).join('\n');
}

function actorsPart(people, language) {
    return `PREMISE
The roleplay story in the context is treated as a TV series being filmed. Its characters are played by actors. The scenes in SCENES were just filmed. Now the actors sit down together for the interview described in FORMAT, about filming these scenes.

WHO IS INTERVIEWED
${whoActors(people)}

THE ACTORS
- Each actor is a distinct person with their own name, personality and manner, clearly different from the character they play (the actor behind a menacing character may be sweet and shy off camera, and so on).
- Each actor has the same gender as the character they play: a male character is played by a male actor, a female character by a female actor. Keep the actor's gender consistent in every verb and pronoun.
- Where WHO IS INTERVIEWED names an actor, use exactly that name (in tags and in the text) and follow the off-camera description if one is given; a given name always overrides the nationality rule below. Invent an actor's name and personality only where it says to invent one.
- The actors' nationality follows the story's setting: a story set in Russia has Russian actors, Japan — Japanese, China — Chinese, and so on. For a fictional world, use the real-world culture it is modeled on: medieval European-style fantasy — American and Western European actors; xianxia or wuxia — Chinese; East-Asian-inspired worlds — the matching country.
- If a character is explicitly a foreigner within the setting (for example, a Briton in China), only that character's actor comes from the matching other country.
- Write the actors' names in ${language} script (Cyrillic for Russian), both in tags and in the text. The script is only a transliteration (for example, Маркус Лин, Юлиан Ветмор) — it is never a reason to pick Russian names.
- Actors talk about their characters in the third person, and about filming: takes, improvisation, chemistry, what was hard, embarrassing, funny or memorable on set.
- Ground everything in concrete moments from SCENES: specific lines, actions, details. Avoid generic answers that could fit any story.
- The actors know the story only up to the end of SCENES. No spoilers or guesses beyond it presented as facts.`;
}

function charactersPart(people) {
    return `PREMISE
The roleplay story in the context was filmed as a TV series, and its characters have just watched the footage of SCENES. Now the characters themselves — not actors — sit down together for the interview described in FORMAT, about what happened in these scenes and how it was shown.

WHO IS INTERVIEWED
${whoCharacters(people)}

THE CHARACTERS
- They speak in the first person as themselves, with the personalities, speech manners, knowledge and relationships they have in the story at the end of SCENES.
- They react to the footage: comment on what they did and felt, argue about how they were portrayed, tease, defend themselves, confront each other.
- They know they are in a show (the fourth wall is broken) but stay fully themselves. There are no actors and no talk about filming technique.
- Ground everything in concrete moments from SCENES: specific lines, actions, details. Avoid generic answers that could fit any story.
- They know the story only up to the end of SCENES. No spoilers or guesses beyond it presented as facts.`;
}

/**
 * Собирает инструкцию и контекст для модели.
 * sourcesText — карточка/персона/лорбуки, sceneText — выбранные сообщения, shoot — выбор «Как снимаем».
 */
export function buildInterviewPrompt({ sourcesText, sceneText, from, to, shoot: rawShoot, cast: rawCast }) {
    const shoot = normalizeShoot(rawShoot);
    const cast = normalizeCast(rawCast);
    const language = getLanguage(getSettings().language).prompt;
    const people = studioPeople(shoot, cast);
    const actors = shoot.studio !== 'characters';
    const example = people[0]?.name || 'Name';
    const speakerTag = actors
        ? '[A: Actor Name (Character Name)] an actor\'s answer — Character Name exactly as listed in WHO IS INTERVIEWED'
        : `[A: Speaker Name (Character Name)] a character's answer — Speaker Name is the character's own name in ${language} as the story uses it, Character Name exactly as listed in WHO IS INTERVIEWED`;

    const instruction = `You are writing a fictional ${actors ? 'behind-the-scenes ' : ''}interview.

${actors ? actorsPart(people, language) : charactersPart(people)}

FORMAT
${formatBlock(shoot)}${vibesBlock(shoot)}${swearingBlock(shoot, language)}${bankBlock(shoot)}${wishesBlock(shoot)}

${rhythmBlock(shoot)}

OUTPUT MARKUP (strict)
The first line is the headline:
[TITLE] a catchy headline for this interview in ${language}, in the style of the format; it may quote a memorable line from the interview
Then every turn starts on a new line with a tag:
[Q] the interviewer's question or remark
${speakerTag}
A turn may span several paragraphs until the next tag.
Stage directions go in *asterisks* inside a turn: *laughs*, *covers face with both hands*. Emoji are allowed sparingly inside stage directions.
Start immediately with the [TITLE] line. No preamble, no closing notes.

NAMES
- In [A: …] tags, the name in parentheses is the character's name exactly as listed in WHO IS INTERVIEWED, for example [A: ${actors ? 'Actor Name' : 'Speaker Name'} (${example})]. Never translate, transliterate or decline it.
- Everywhere else — in questions, answers and stage directions — use every name (characters, NPCs, places) in the form the story itself uses in SCENES, in ${language} and declined according to ${language} grammar. The character card, persona and lorebooks may spell names in another script; do not copy those spellings into the text.
- If a name never appears in SCENES, transliterate it into ${language} the way the story would.

LANGUAGE
Write the whole interview in ${language}, except the character names inside the [A: …] tag parentheses.
No words or phrases in other languages: no English (or any other) interjections, catchphrases or quotes mixed in. Everything is said in ${language}.`;

    const contextText = `${sourcesText ? `${sourcesText}\n\n` : ''}# SCENES (messages #${from}–#${to})
${sceneText}

# TASK
Write the interview now, following the instruction exactly.`;

    return { instruction, contextText };
}

// ---------- Вопросы из зала ----------

/**
 * Раунд вопросов из зала: продолжение готового интервью.
 * interviewText — интервью вместе с прошлыми раундами; count — сколько зрительских вопросов;
 * ownQuestions — вопросы автора (могут быть пустыми); nick — ник автора в зале.
 */
export function buildAudiencePrompt({ sourcesText, sceneText, from, to, shoot: rawShoot, cast: rawCast, interviewText, count, ownQuestions, nick }) {
    const shoot = normalizeShoot(rawShoot);
    const cast = normalizeCast(rawCast);
    const language = getLanguage(getSettings().language).prompt;
    const people = studioPeople(shoot, cast);
    const actors = shoot.studio !== 'characters';
    const example = people[0]?.name || 'Name';
    const own = (ownQuestions || []).filter((q) => String(q).trim());
    const total = count + own.length;
    const speakerTag = actors
        ? '[A: Actor Name (Character Name)] an answer — Character Name exactly as listed in WHO IS INTERVIEWED'
        : `[A: Speaker Name (Character Name)] an answer — Speaker Name is the character's own name in ${language}, Character Name exactly as listed in WHO IS INTERVIEWED`;

    const format = getFormat(shoot.format);
    const formatLines = [format.prompt];
    if (format.id === 'fans') formatLines.push(getVenue(shoot.venue).prompt);
    formatLines.push(getBanter(shoot.banter).prompt);

    const ownBlock = own.length
        ? `
- The other ${own.length} question${own.length === 1 ? '' : 's'} come${own.length === 1 ? 's' : ''} from the audience member "${nick}". Ask them as written: you may adjust the wording slightly to fit the format, never the meaning. Sign each of them exactly [F: ${nick}]. Mix them in among the invented questions, not all at the start or at the end.
${own.map((q, i) => `  ${i + 1}. ${q}`).join('\n')}`
        : '';

    const instruction = `You are continuing a fictional ${actors ? 'behind-the-scenes ' : ''}interview with a segment of questions from the audience.

${actors ? actorsPart(people, language) : charactersPart(people)}

FORMAT OF THE INTERVIEW
${formatLines.join('\n')}${vibesBlock(shoot)}${swearingBlock(shoot, language)}${wishesBlock(shoot)}

AUDIENCE SEGMENT
- INTERVIEW SO FAR contains the interview already recorded. Continue it: the host briefly opens the floor to the audience in one short [Q] line, even if the interview already said goodbye.
- Exactly ${total} audience question${total === 1 ? '' : 's'}.
- ${count} of them come from audience members you invent: each has a fandom-style nickname, like a real social media handle (Latin or Cyrillic letters, underscores). Their questions are bold, shippy, funny or touching, about concrete moments of SCENES and of the interview so far.${ownBlock}
- The same people answer as in INTERVIEW SO FAR: the same names, personalities, relationships and running jokes. Do not repeat jokes or stories that were already told.
- Several people may answer one question; follow-ups and short reactions are welcome. The host may close with one short line at the end.

${rhythmBlock(shoot)}

OUTPUT MARKUP (strict)
Every turn starts on a new line with a tag:
[Q] the host's remark
[F: Nickname] an audience question — the nickname exactly as it should be shown
${speakerTag}
A turn may span several paragraphs until the next tag.
Stage directions go in *asterisks* inside a turn. Emoji are allowed sparingly inside stage directions.
No [TITLE]. Start immediately with the host's [Q] line. No preamble, no closing notes.

NAMES
- In [A: …] tags, the name in parentheses is the character's name exactly as listed in WHO IS INTERVIEWED, for example [A: ${actors ? 'Actor Name' : 'Speaker Name'} (${example})]. Never translate, transliterate or decline it. Use the same speaker names as in INTERVIEW SO FAR.
- Everywhere else, use every name (characters, NPCs, places) in the form the story itself uses in SCENES, in ${language} and declined according to ${language} grammar.

LANGUAGE
Write everything in ${language}, except the character names inside the [A: …] tag parentheses and the audience nicknames.
No words or phrases in other languages: no English (or any other) interjections, catchphrases or quotes mixed in.`;

    const contextText = `${sourcesText ? `${sourcesText}\n\n` : ''}# SCENES (messages #${from}–#${to})
${sceneText}

# INTERVIEW SO FAR
${interviewText}

# TASK
Write the audience segment now, following the instruction exactly.`;

    return { instruction, contextText };
}

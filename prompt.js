// Junket — промпт интервью.
// Этап 5а: формат, площадка для вопросов фанатов, число вопросов, болтовня, вайбы, пожелания, язык.
// Кастинг (5б), банк вопросов (5в) и вопросы из зала (5г) подключатся позже.

import { getCharacterNames, getUserName } from './sources.js';
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

function wishesBlock(shoot) {
    const wishes = String(shoot.wishes || '').trim();
    return wishes ? `\n\nUSER WISHES (follow them)\n${wishes}` : '';
}

/**
 * Собирает инструкцию и контекст для модели.
 * sourcesText — карточка/персона/лорбуки, sceneText — выбранные сообщения, shoot — выбор «Как снимаем».
 */
export function buildInterviewPrompt({ sourcesText, sceneText, from, to, shoot: rawShoot }) {
    const shoot = normalizeShoot(rawShoot);
    const language = getLanguage(getSettings().language).prompt;
    const characters = getCharacterNames();
    const user = getUserName();
    const castList = [...characters, user].map((name) => `- the actor who plays ${name}`).join('\n');

    const instruction = `You are writing a fictional behind-the-scenes interview.

PREMISE
The roleplay story in the context is treated as a TV series being filmed. Its characters are played by actors. The scenes in SCENES were just filmed. Now the actors sit down together for the interview described in FORMAT, about filming these scenes.

WHO IS INTERVIEWED
${castList}

THE ACTORS
- Each actor is a distinct person with their own name, personality and manner, clearly different from the character they play (the actor behind a menacing character may be sweet and shy off camera, and so on).
- Each actor has the same gender as the character they play: a male character is played by a male actor, a female character by a female actor. Keep the actor's gender consistent in every verb and pronoun.
- Invent the actors' names and personalities. Names should feel plausible for the story's vibe and the characters' backgrounds. Write the actors' names in ${language} script (Cyrillic for Russian), both in tags and in the text.
- Actors talk about their characters in the third person, and about filming: takes, improvisation, chemistry, what was hard, embarrassing, funny or memorable on set.
- Ground everything in concrete moments from SCENES: specific lines, actions, details. Avoid generic answers that could fit any story.
- The actors know the story only up to the end of SCENES. No spoilers or guesses beyond it presented as facts.

FORMAT
${formatBlock(shoot)}${vibesBlock(shoot)}${swearingBlock(shoot, language)}${wishesBlock(shoot)}

${rhythmBlock(shoot)}

OUTPUT MARKUP (strict)
The first line is the headline:
[TITLE] a catchy headline for this interview in ${language}, in the style of the format; it may quote a memorable line from the interview
Then every turn starts on a new line with a tag:
[Q] the interviewer's question or remark
[A: Actor Name (Character Name)] an actor's answer — Character Name exactly as listed in WHO IS INTERVIEWED
A turn may span several paragraphs until the next tag.
Stage directions go in *asterisks* inside a turn: *laughs*, *covers face with both hands*. Emoji are allowed sparingly inside stage directions.
Start immediately with the [TITLE] line. No preamble, no closing notes.

NAMES
- In [A: …] tags, the name in parentheses is the character's name exactly as listed in WHO IS INTERVIEWED, for example [A: Actor Name (${characters[0] || user})]. Never translate, transliterate or decline it.
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

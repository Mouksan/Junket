// Junket — промпт интервью.
// Этап 3–4: базовый вариант + заголовок [TITLE] — джанкет, 6 вопросов, болтовня «Немного», актёры, русский.
// Форматы, вайбы, банк вопросов и кастинг подключатся на этапе 5.

import { getCharacterNames, getUserName } from './sources.js';

const BASE = Object.freeze({
    questions: 6,
    language: 'Russian',
});

/**
 * Собирает инструкцию и контекст для модели.
 * sourcesText — карточка/персона/лорбуки, sceneText — выбранные сообщения.
 */
export function buildInterviewPrompt({ sourcesText, sceneText, from, to }) {
    const characters = getCharacterNames();
    const user = getUserName();
    const castList = [...characters, user].map((name) => `- the actor who plays ${name}`).join('\n');

    const instruction = `You are writing a fictional behind-the-scenes press interview.

PREMISE
The roleplay story in the context is treated as a TV series being filmed. Its characters are played by actors. The scenes in SCENES were just filmed. Now the actors sit down together for a press junket interview about filming these scenes.

WHO IS INTERVIEWED
${castList}

THE ACTORS
- Each actor is a distinct person with their own name, personality and manner, clearly different from the character they play (the actor behind a menacing character may be sweet and shy off camera, and so on).
- Invent the actors' names and personalities. Names should feel plausible for the story's vibe and the characters' backgrounds.
- Actors talk about their characters in the third person, and about filming: takes, improvisation, chemistry, what was hard, embarrassing, funny or memorable on set.
- Ground everything in concrete moments from SCENES: specific lines, actions, details. Avoid generic answers that could fit any story.
- The actors know the story only up to the end of SCENES. No spoilers or guesses beyond it presented as facts.

FORMAT
A press junket interview. Exactly ${BASE.questions} main questions from the interviewer.
Banter: light. The interviewer may occasionally follow up on an answer, and the actors may tease each other or react to each other's answers. Follow-ups and reactions do not count toward the number of main questions.
Several actors may answer the same question.

OUTPUT MARKUP (strict)
The first line is the headline:
[TITLE] a catchy magazine-style headline for this interview in ${BASE.language}; it may quote a memorable line from the interview
Then every turn starts on a new line with a tag:
[Q] the interviewer's question or remark
[A: Actor Name (Character Name)] an actor's answer — Character Name exactly as listed in WHO IS INTERVIEWED
A turn may span several paragraphs until the next tag.
Stage directions go in *asterisks* inside a turn: *laughs*, *covers face with both hands*. Emoji are allowed sparingly inside stage directions.
Start immediately with the [TITLE] line. No preamble, no closing notes.

NAMES
- In [A: …] tags, the name in parentheses is the character's name exactly as listed in WHO IS INTERVIEWED, for example [A: Actor Name (${characters[0] || user})]. Never translate, transliterate or decline it.
- Everywhere else — in questions, answers and stage directions — use every name (characters, NPCs, places) in the form the story itself uses in SCENES, in ${BASE.language} and declined according to ${BASE.language} grammar. The character card, persona and lorebooks may spell names in another script; do not copy those spellings into the text.
- If a name never appears in SCENES, transliterate it into ${BASE.language} the way the story would.

LANGUAGE
Write the whole interview in ${BASE.language}, except the character names inside the [A: …] tag parentheses.`;

    const contextText = `${sourcesText ? `${sourcesText}\n\n` : ''}# SCENES (messages #${from}–#${to})
${sceneText}

# TASK
Write the interview now, following the instruction exactly.`;

    return { instruction, contextText };
}

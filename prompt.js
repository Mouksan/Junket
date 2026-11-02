// Junket — промпт интервью.
// Этап 3: базовый вариант — джанкет, 6 вопросов, болтовня «Немного», актёры, русский.
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
Every turn starts on a new line with a tag:
[Q] the interviewer's question or remark
[A: Actor Name (Character Name)] an actor's answer
A turn may span several paragraphs until the next tag.
Stage directions go in *asterisks* inside a turn: *laughs*, *covers face with both hands*. Emoji are allowed sparingly inside stage directions.
Start immediately with the first [Q] line. No title, no preamble, no closing notes.

LANGUAGE
Write the whole interview in ${BASE.language}. Keep character names spelled as in the story.`;

    const contextText = `${sourcesText ? `${sourcesText}\n\n` : ''}# SCENES (messages #${from}–#${to})
${sceneText}

# TASK
Write the interview now, following the instruction exactly.`;

    return { instruction, contextText };
}

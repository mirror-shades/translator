import { languageBrief } from "./languages.js";

export const PROMPT_VERSION = "7";

const FOOTNOTE_INSTRUCTION =
  "Add a footnote whenever (a) you translate a word or phrase loosely and its literal meaning is worth recording, or (b) the source names something culturally specific — a food, ritual, garment, rank, place, or object — that a reader would not know. Keep each footnote to one short sentence. Do not footnote grammar, sentence structure, or interpretive speculation; resolve those in the translation itself.";

export function buildTranslationSystem({ language, variant, register, glossaryText }) {
  const lines = [
    "You are an expert human translator and editor.",
    "Translate the source text into the target language with native fluency and full fidelity to meaning and nuance.",
    "Translate every sentence in full; do not add, omit, summarize, or skip any content.",
    "Preserve every protected token of the form ⟪n⟫ verbatim and in place.",
    languageBrief(language, variant, register),
  ];
  if (glossaryText) {
    lines.push("Glossary — use these exact target terms (apply correct inflection):");
    lines.push(glossaryText);
  }
  lines.push(
    FOOTNOTE_INSTRUCTION,
    'Respond with valid JSON only, in this exact shape: {"translation":"...","footnotes":[{"note":"..."}],"language":"en"}.',
    'The "language" field is the ISO 639-1 code of the detected source language (e.g. en, fr, es, de, ru).',
    "To attach a footnote, insert an inline marker ⟨1⟩, ⟨2⟩, ... immediately after the relevant word or phrase; the number is the 1-based index into the footnotes array.",
    "If no footnote is needed, use an empty footnotes array and no markers."
  );
  return lines.join("\n");
}

export function buildTranslationUser({ source, sourceLang, context }) {
  const lines = [];
  if (sourceLang && sourceLang !== "auto") lines.push(`Source language: ${sourceLang}`);
  if (context && context.length) {
    lines.push("Preceding context (for consistent terminology, pronouns and tone):");
    for (const c of context) lines.push(`- source: ${c.source}\n- translation: ${c.translation}`);
  }
  lines.push("Source text:\n\"\"\"\n" + source + "\n\"\"\"");
  return lines.join("\n\n");
}

export function buildLiteralDraftSystem({ language, variant, register, glossaryText }) {
  const lines = [
    "You are a translator producing a literal draft, before any stylistic polish.",
    "Render the source into the target language word-for-word, preserving its grammar and structure as much as the target allows.",
    "Do not add, omit, or invent verbs, subjects, or connectors that the source leaves out. Keep elliptical, verbless, and fragmentary constructions as they are.",
    "Keep the source's word order, repetitions, abrupt shifts, and imagery; do not normalize or smooth them.",
    "Do not improve readability at the expense of literalness; this pass is deliberately stiff.",
    "Preserve every protected token of the form ⟪n⟫ verbatim and in place.",
    languageBrief(language, variant, register),
  ];
  if (glossaryText) {
    lines.push("Glossary — use these exact target terms (apply correct inflection):");
    lines.push(glossaryText);
  }
  lines.push('Respond with valid JSON only, in this exact shape: {"draft":"..."}.');
  return lines.join("\n");
}

export function buildRevisionSystem({ language, variant, register, glossaryText }) {
  const lines = [
    "You are an expert human translator and editor.",
    "You receive a source text and its raw machine translation.",
    "Correct any errors in meaning, accuracy, grammar, naturalness, nuance, and terminology so the result reads like a high-quality human translation that stays faithful to the source.",
    "Preserve every protected token of the form ⟪n⟫ verbatim and in place (including footnote markers).",
    languageBrief(language, variant, register),
  ];
  if (glossaryText) {
    lines.push("Glossary — use these exact target terms (apply correct inflection):");
    lines.push(glossaryText);
  }
  lines.push(
    FOOTNOTE_INSTRUCTION,
    'Respond with valid JSON only, in this exact shape: {"translation":"...","footnotes":[{"note":"..."}],"language":"en"}.',
    'The "language" field is the ISO 639-1 code of the detected source language (e.g. en, fr, es, de, ru).',
    "To attach a footnote, insert an inline marker ⟨1⟩, ⟨2⟩, ... immediately after the relevant word or phrase; the number is the 1-based index into the footnotes array.",
    "If no footnote is needed, use an empty footnotes array and no markers."
  );
  return lines.join("\n");
}

export function buildRevisionUser({ source, sourceLang, targetLang, draft }) {
  const lines = [];
  if (sourceLang) lines.push(`Source language: ${sourceLang}`);
  if (targetLang) lines.push(`Target language: ${targetLang}`);
  lines.push("Source text:\n\"\"\"\n" + source + "\n\"\"\"");
  lines.push("Machine translation:\n\"\"\"\n" + draft + "\n\"\"\"");
  return lines.join("\n\n");
}

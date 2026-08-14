import { protect, restore } from "./protect.js";
import { segmentDocument, chunkByParagraphs } from "./tokenize.js";
import { parseGlossary, glossaryPrompt } from "./glossary.js";
import {
  buildTranslationSystem,
  buildTranslationUser,
  buildLiteralDraftSystem,
  buildRevisionSystem,
  buildRevisionUser,
  PROMPT_VERSION,
} from "./prompts.js";
import { createEngine } from "./engine.js";
import { withRetry, mapConcurrent, chunkItems, stripMarkers, resolveMarkers } from "./util.js";
import { resolveTarget, languageBrief } from "./languages.js";
import { getDraftProvider } from "./mtdraft.js";

const CONCURRENCY = 3;
const RETRY_ATTEMPTS = 3;
const RETRY_BASE_DELAY = 1000;
const CONTEXT_WINDOW = 2;

export const MAX_CALL_CHARS = 32000;

function makeEngine(settings) {
  return createEngine(settings);
}

function buildContext(segments, index, windowSize) {
  const ctx = [];
  for (let j = Math.max(0, index - windowSize); j < index; j++) {
    const s = segments[j];
    if (s.status === "ok" && s.translation) {
      ctx.push({ source: s.source, translation: stripMarkers(s.translation) });
    }
  }
  return ctx;
}

function memoryKey(source, settings, glossary) {
  return JSON.stringify([
    source,
    settings.targetLang,
    settings.register,
    settings.sourceLang,
    settings.model,
    settings.protectNames,
    settings.faithful,
    settings.draftSource,
    settings.engine,
    glossary.map((g) => `${g.src}=${g.tgt}:${g.hint || ""}`).join("|"),
    PROMPT_VERSION,
  ]);
}

async function fetchDraft({ seg, settings, engine, system, signal }) {
  const provider = getDraftProvider(settings.draftSource);
  if (provider) {
    try {
      return await provider({
        source: seg.masked,
        sourceLang: settings.sourceLang,
        targetLang: settings.targetLang,
        signal,
      });
    } catch (err) {
      if (err && err.name === "AbortError") throw err;
    }
  }
  const user = buildTranslationUser({ source: seg.masked, sourceLang: settings.sourceLang, context: [] });
  const draft = await engine.translate({ system, user, signal });
  return { text: draft.draft || "", detectedLang: "" };
}

async function extractNames({ sourceText, engine, signal }) {
  const sentences = segmentDocument(sourceText).map((s) => s.source);
  const batches = chunkItems(sentences, (s) => s.length + 1, MAX_CALL_CHARS);
  const results = await mapConcurrent(batches, CONCURRENCY, (batch) =>
    extractNamesFromBatch(batch.join(" "), engine, signal)
  );
  return validateNames(results.flat(), sourceText);
}

async function extractNamesFromBatch(text, engine, signal) {
  const system = [
    "You are a named-entity extractor for a translation pipeline.",
    "From the source text, extract proper names, brand names, product names, and other entities that must be copied verbatim (not translated or transliterated).",
    "Return only genuine entities; do not return common nouns, pronouns, or ordinary words.",
    'Respond with valid JSON only, in this exact shape: {"names":["...","..."]}.',
    'If there are none, return {"names":[]}.',
  ].join("\n");

  const user = `Source text:\n"""\n${text}\n"""`;

  const parsed = await engine.translate({ system, user, signal });
  return Array.isArray(parsed.names) ? parsed.names : [];
}

function validateNames(names, sourceText) {
  const out = [];
  const seen = new Set();
  for (const raw of names) {
    const name = String(raw || "").trim();
    if (name.length < 2) continue;
    if (!/[A-Za-z\u00C0-\u024F\u0400-\u04FF]/.test(name)) continue;
    if (sourceText.indexOf(name) === -1) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out.sort((a, b) => b.length - a.length);
}

async function verifyGlossaryWithLLM({ segments, glossary, engine, targetLabel, sourceLang, signal }) {
  if (!segments.length || !glossary.length) return;
  const batches = chunkItems(
    segments,
    (s) => s.source.length + s.translation.length + 4,
    MAX_CALL_CHARS
  );
  await mapConcurrent(batches, CONCURRENCY, (batch) =>
    verifyGlossaryBatch({ segments: batch, glossary, tokens, engine, targetLabel, sourceLang, signal })
  );
}

async function verifyGlossaryBatch({ segments, glossary, engine, targetLabel, sourceLang, signal }) {
  const system = [
    "You are a terminology verifier for a translation.",
    "You are given a glossary of fixed source→target term pairs (each may carry a domain hint) and a list of sentence pairs (source and its translation).",
    "For every glossary entry whose source term appears in a source sentence, check that the translation uses the target term with the correct sense and inflection.",
    "To judge sense, back-translate the phrase around the target term into the source language and confirm it maps to the source term, respecting the domain hint.",
    "Report entries that are missing, mistranslated, or used in the wrong sense.",
    'Respond with valid JSON only, in this exact shape: {"misses":[{"segment":0,"src":"...","tgt":"...","note":"..."}]}.',
    "The segment index is the 0-based position of the pair in the list you were given. The note should be a short reason.",
    'If nothing is missing, return {"misses":[]}.',
  ].join("\n");

  const user = [
    `Source language: ${sourceLang && sourceLang !== "auto" ? sourceLang : "auto-detect"}`,
    `Target language: ${targetLabel}`,
    "Glossary:",
    glossaryPrompt(glossary),
    "Sentence pairs:",
    segments.map((s, i) => `S${i}:\n  src: ${s.source}\n  tgt: ${s.translation}`).join("\n"),
  ].join("\n\n");

  const parsed = await engine.translate({ system, user, signal });
  const misses = Array.isArray(parsed.misses) ? parsed.misses : [];
  for (const miss of misses) {
    const idx = Number(miss.segment);
    const seg = segments[idx];
    if (!seg || !miss.tgt) continue;
    seg.glossaryMisses.push({ src: miss.src || "", tgt: miss.tgt, note: miss.note || "" });
  }
}

export function segmentText(seg, tokens) {
  return resolveMarkers(restore(seg.translation, tokens), seg.footnotes, 1).text;
}

export function assemble(segments, tokens) {
  let text = "";
  const notes = [];
  const markers = [];
  let num = 0;
  segments.forEach((seg, i) => {
    if (seg.status !== "ok") return;
    if (i > 0) text += seg.paragraphBreak ? "\n\n" : " ";
    const resolved = resolveMarkers(restore(seg.translation, tokens), seg.footnotes, num + 1);
    const base = text.length;
    text += resolved.text;
    notes.push(...resolved.notes);
    for (const off of resolved.markers) markers.push(base + off);
    num += resolved.notes.length;
  });
  return { text, notes, markers };
}

export async function runPipeline({ sourceText, settings, signal, onProgress, memory }) {
  const target = resolveTarget(settings.targetLang);
  if (!target) throw new Error("Unknown target language.");
  const { language, variant } = target;
  const glossary = parseGlossary(settings.glossary);
  const glossaryText = glossaryPrompt(glossary);
  const engine = makeEngine(settings);

  let tokens = [];
  let segments = [];
  let aborted = false;
  let fatal = null;

  try {
    let names = [];
    if (settings.protectNames && /\p{Lu}/u.test(sourceText)) {
      onProgress && onProgress({ message: "Extracting names...", done: 0, total: 0 });
      try {
        names = await extractNames({ sourceText, engine, signal });
      } catch (err) {
        if (err && err.name === "AbortError") throw err;
        names = [];
      }
    }

    const { masked, tokens: protectedTokens } = protect(sourceText, { names });
    tokens = protectedTokens;
    const maskedSegments = settings.faithful
      ? chunkByParagraphs(masked)
      : segmentDocument(masked);

    const system = buildTranslationSystem({ language, variant, register: settings.register, glossaryText });
    const draftSystem = buildLiteralDraftSystem({ language, variant, register: settings.register, glossaryText });
    const revisionSystem = buildRevisionSystem({ language, variant, register: settings.register, glossaryText });

    segments = maskedSegments.map((m, i) => ({
      id: "s" + i,
      masked: m.source,
      source: restore(m.source, tokens),
      paragraphBreak: m.paragraphBreak,
      translation: "",
      footnotes: [],
      status: "pending",
      error: null,
      glossaryMisses: [],
      fromMemory: false,
      detectedLang: "",
    }));

    const total = segments.length;
    let done = 0;
    const progress = (message) => onProgress && onProgress({ message, done, total });

    const inflight = new Map();

    const translate = async (seg, i) =>
      withRetry(
        async () => {
          const context = buildContext(segments, i, CONTEXT_WINDOW);
          if (settings.faithful) {
            const draft = await fetchDraft({ seg, settings, engine, system: draftSystem, signal });
            const user = buildRevisionUser({
              source: seg.masked,
              sourceLang: draft.detectedLang || settings.sourceLang,
              targetLang: settings.targetLang,
              draft: draft.text,
            });
            const parsed = await engine.translate({ system: revisionSystem, user, signal });
            return {
              translation: restore(parsed.translation || "", tokens),
              footnotes: Array.isArray(parsed.footnotes) ? parsed.footnotes : [],
              language: parsed.language || draft.detectedLang || "",
            };
          }
          const user = buildTranslationUser({
            source: seg.masked,
            sourceLang: settings.sourceLang,
            context,
          });
          const parsed = await engine.translate({ system, user, signal });
          return {
            translation: restore(parsed.translation || "", tokens),
            footnotes: Array.isArray(parsed.footnotes) ? parsed.footnotes : [],
            language: parsed.language || "",
          };
        },
        {
          attempts: RETRY_ATTEMPTS,
          baseDelay: RETRY_BASE_DELAY,
          onRetry: (attempt) => progress(`Retrying segment ${i + 1}/${total} (attempt ${attempt})...`),
        }
      );

    const resultFor = async (seg, i) => {
      const key = memoryKey(seg.source, settings, glossary);
      if (memory) {
        const cached = memory.get(key);
        if (cached) return { ...cached, fromMemory: true };
      }
      if (inflight.has(key)) return inflight.get(key);
      const promise = translate(seg, i);
      inflight.set(key, promise);
      try {
        const result = await promise;
        if (memory) memory.set(key, { translation: result.translation, footnotes: result.footnotes, language: result.language });
        return result;
      } finally {
        inflight.delete(key);
      }
    };

    await mapConcurrent(segments, CONCURRENCY, async (seg, i) => {
      try {
        const result = await resultFor(seg, i);
        seg.translation = result.translation;
        seg.footnotes = result.footnotes;
        seg.detectedLang = result.language || "";
        seg.status = "ok";
        seg.fromMemory = !!result.fromMemory;
      } catch (err) {
        if (err && err.name === "AbortError") throw err;
        seg.status = "error";
        seg.error = err && err.message ? err.message : String(err);
      } finally {
        done++;
        progress(`Processing segment ${Math.min(done + 1, total)}/${total}...`);
      }
    });

    if (glossary.length) {
      try {
        await verifyGlossaryWithLLM({
          segments: segments.filter((s) => s.status === "ok"),
          glossary,
          engine,
          targetLabel: variant.name,
          sourceLang: settings.sourceLang,
          signal,
        });
      } catch (err) {
        if (err && err.name === "AbortError") throw err;
      }
    }
  } catch (err) {
    if (err && err.name === "AbortError") aborted = true;
    else fatal = err;
  }

  if (aborted || fatal) {
    for (const seg of segments) {
      if (seg.status === "pending") {
        seg.status = "error";
        seg.error = aborted ? "Stopped before translation." : fatal.message || String(fatal);
      }
    }
  }

  return { segments, tokens, aborted, error: fatal };
}

export async function rerollSegment({ segments, segId, settings, signal, tokens, memory }) {
  const index = segments.findIndex((s) => s.id === segId);
  if (index === -1) return null;
  const seg = segments[index];
  const target = resolveTarget(settings.targetLang);
  const glossary = parseGlossary(settings.glossary);
  const glossaryText = glossaryPrompt(glossary);
  const engine = makeEngine(settings);
  const system = buildTranslationSystem({
    language: target.language,
    variant: target.variant,
    register: settings.register,
    glossaryText,
  });
  const draftSystem = buildLiteralDraftSystem({
    language: target.language,
    variant: target.variant,
    register: settings.register,
    glossaryText,
  });
  const revisionSystem = buildRevisionSystem({
    language: target.language,
    variant: target.variant,
    register: settings.register,
    glossaryText,
  });
  const context = buildContext(segments, index, CONTEXT_WINDOW);

  await withRetry(
    async () => {
      if (settings.faithful) {
        const draft = await fetchDraft({ seg, settings, engine, system: draftSystem, signal });
        const user = buildRevisionUser({
          source: seg.masked,
          sourceLang: draft.detectedLang || settings.sourceLang,
          targetLang: settings.targetLang,
          draft: draft.text,
        });
        const parsed = await engine.translate({ system: revisionSystem, user, signal });
        seg.translation = restore(parsed.translation || "", tokens);
        seg.footnotes = Array.isArray(parsed.footnotes) ? parsed.footnotes : [];
        seg.detectedLang = parsed.language || draft.detectedLang || "";
        seg.status = "ok";
        seg.error = null;
        return;
      }
      const user = buildTranslationUser({
        source: seg.masked,
        sourceLang: settings.sourceLang,
        context,
      });
      const parsed = await engine.translate({ system, user, signal });
      seg.translation = restore(parsed.translation || "", tokens);
      seg.footnotes = Array.isArray(parsed.footnotes) ? parsed.footnotes : [];
      seg.detectedLang = parsed.language || "";
      seg.status = "ok";
      seg.error = null;
    },
    { attempts: RETRY_ATTEMPTS, baseDelay: RETRY_BASE_DELAY }
  );

  if (memory) {
    memory.set(memoryKey(seg.source, settings, glossary), {
      translation: seg.translation,
      footnotes: seg.footnotes,
      language: seg.detectedLang,
    });
  }

  seg.glossaryMisses = [];
  if (glossary.length) {
    try {
      await verifyGlossaryWithLLM({
        segments: [seg],
        glossary,
        engine,
        targetLabel: target.variant.name,
        sourceLang: settings.sourceLang,
        signal,
      });
    } catch (err) {
      if (err && err.name === "AbortError") throw err;
    }
  }

  return seg;
}

export async function runReconcile({ sourceText, segments, tokens, settings, signal }) {
  const target = resolveTarget(settings.targetLang);
  const { language, variant } = target;
  const glossary = parseGlossary(settings.glossary);
  const engine = makeEngine(settings);
  const base = assemble(segments, tokens);

  if (sourceText.length + base.text.length > MAX_CALL_CHARS) {
    return { text: base.text, skipped: true };
  }

  const { masked, tokens: draftTokens } = protect(base.text, { markers: /\[(\d+)\]/g });

  const lines = [
    "You are an expert editor reviewing a complete translation assembled from separately translated sentences.",
    "Improve cross-sentence coherence only: unify terminology, pronouns, formality/register and tone. Correct any remaining errors.",
    "Preserve the full meaning of the source. Do not summarize, omit, or re-order content.",
    "Preserve every protected token of the form ⟪n⟫ verbatim and in place (including footnote markers).",
    languageBrief(language, variant, settings.register),
  ];
  const glossaryText = glossaryPrompt(glossary);
  if (glossaryText) lines.push("Glossary — keep these target terms consistent:\n" + glossaryText);
  lines.push('Respond with valid JSON only, in this exact shape: {"translation":"the polished full translation"}.');
  const system = lines.join("\n");

  const user = [
    "Source document:\n\"\"\"\n" + sourceText + "\n\"\"\"",
    "Draft translation:\n\"\"\"\n" + masked + "\n\"\"\"",
  ].join("\n\n");

  try {
    const parsed = await withRetry(
      () => engine.translate({ system, user, signal }),
      { attempts: RETRY_ATTEMPTS, baseDelay: RETRY_BASE_DELAY }
    );
    return { text: restore(parsed.translation || base.text, draftTokens), skipped: false };
  } catch (err) {
    if (err && err.name === "AbortError") throw err;
    return { text: base.text, skipped: false };
  }
}

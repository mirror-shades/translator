(() => {
  // src/js/protect.js
  var TOKEN_RE = /⟪(\d+)⟫/g;
  var BASE_PATTERNS = [
    { re: /⟪\d+⟫/g },
    { re: /```[\s\S]*?```/g },
    { re: /`[^`\n]+`/g },
    { re: /<[^>\n]+>/g },
    { re: /https?:\/\/[^\s]*[^\s.,;:!?()"'<>[\]]/g },
    { re: /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g },
    { re: /\{\{[\s\S]*?\}\}/g },
    { re: /\b\d+(?:[.,]\d+)?\s*(?:%|€|\$|£|¥|km|mi|cm|mm|kg|g|mg|l|ml|°[CF]|USD|EUR|GBP)\b/gi },
    { re: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g },
    { re: /\b\d{4}-\d{2}-\d{2}\b/g },
    { re: /\b\d+\.\d+\b/g }
  ];
  function nameRegex(name) {
    const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const lead = /^\w/.test(name) ? "\\b" : "";
    const tail = /\w$/.test(name) ? "\\b" : "";
    return new RegExp(lead + esc + tail, "g");
  }
  function protect(text, { markers = null, names = [] } = {}) {
    const tokens2 = [];
    const patterns = [...BASE_PATTERNS];
    for (const name of [...names].sort((a, b) => b.length - a.length)) {
      patterns.push({ re: nameRegex(name) });
    }
    if (markers) patterns.push({ re: markers });
    const stash = (match) => {
      const id = tokens2.length;
      tokens2.push(match);
      return `\u27EA${id}\u27EB`;
    };
    let masked = String(text);
    for (const { re } of patterns) {
      masked = masked.replace(re, stash);
    }
    return { masked, tokens: tokens2 };
  }
  function restore(text, tokens2) {
    return String(text).replace(TOKEN_RE, (m, idStr) => {
      const id = Number(idStr);
      return tokens2 && id < tokens2.length ? tokens2[id] : m;
    });
  }

  // src/js/tokenize.js
  var segmenterCache = null;
  var segmenterTried = false;
  function segmenter() {
    if (!segmenterTried) {
      segmenterTried = true;
      segmenterCache = typeof Intl !== "undefined" && Intl.Segmenter ? new Intl.Segmenter(void 0, { granularity: "sentence" }) : null;
    }
    return segmenterCache;
  }
  var ABBREV_RE = /(?:Mr|Mrs|Ms|Mx|Dr|Prof|St|Jr|Sr|Rev|Hon|Gen|Sen|Rep|Gov|Capt|Lt|Sgt|Col|etc|e\.g|i\.e|vs|viz|cf|al|no|vol|ed|p|pp|fig|sec|dept|assn|inc|ltd|co|corp|approx)\.$/i;
  function mergeAbbreviations(sentences) {
    const out = [];
    for (const s of sentences) {
      if (out.length && ABBREV_RE.test(out[out.length - 1])) {
        out[out.length - 1] = out[out.length - 1] + " " + s;
      } else {
        out.push(s);
      }
    }
    return out;
  }
  function splitIntoSentences(text) {
    const seg = segmenter();
    if (seg) {
      const parts = [];
      for (const part of seg.segment(text)) {
        const t = part.segment.trim();
        if (t) parts.push(t);
      }
      if (parts.length) return mergeAbbreviations(parts);
    }
    const matches = text.match(/[^.!?…]+[.!?…]+["'”’)\]]*\s*|[^.!?…]+$/g);
    return mergeAbbreviations((matches || [text]).map((s) => s.trim()).filter(Boolean));
  }
  function segmentDocument(text) {
    const paragraphs = String(text).split(/\r?\n+/).map((p) => p.trim()).filter(Boolean);
    const segments = [];
    for (let p = 0; p < paragraphs.length; p++) {
      splitIntoSentences(paragraphs[p]).forEach((sentence, i) => {
        segments.push({ source: sentence, paragraphBreak: i === 0 && p > 0 });
      });
    }
    return segments;
  }
  function chunkByParagraphs(text, maxLen = 1500) {
    const paragraphs = String(text).split(/\r?\n+/).map((p) => p.trim()).filter(Boolean);
    const chunks = [];
    for (const para of paragraphs) {
      if (para.length <= maxLen) {
        chunks.push({ source: para, paragraphBreak: chunks.length > 0 });
        continue;
      }
      let current = "";
      let isFirst = true;
      for (const sent of splitIntoSentences(para)) {
        const candidate = current ? current + " " + sent : sent;
        if (current && candidate.length > maxLen) {
          chunks.push({ source: current.trim(), paragraphBreak: isFirst && chunks.length > 0 });
          current = sent;
          isFirst = false;
        } else {
          current = candidate;
        }
      }
      if (current.trim()) {
        chunks.push({ source: current.trim(), paragraphBreak: isFirst && chunks.length > 0 });
      }
    }
    return chunks;
  }

  // src/js/glossary.js
  function parseGlossary(text) {
    const out = [];
    for (const line of String(text || "").split(/\r?\n/)) {
      const entry = parseEntry(line);
      if (entry) out.push(entry);
    }
    return out;
  }
  function parseEntry(line) {
    const m = line.trim().match(/^(.*?)\s*(?:=>|->|=)\s*(.*)$/);
    if (!m || !m[1] || !m[2]) return null;
    let src = m[1].trim();
    const tgt = m[2].trim();
    let hint = null;
    const hm = src.match(/^(.*?)\s*(?:\(([^)]*)\)|\[([^\]]*)\])\s*$/);
    if (hm && (hm[2] || hm[3])) {
      src = hm[1].trim();
      hint = (hm[2] || hm[3]).trim() || null;
    }
    if (!src || !tgt) return null;
    return { src, tgt, hint };
  }
  function glossaryPrompt(entries) {
    if (!entries.length) return "";
    return entries.map((g) => `- "${g.src}"${g.hint ? ` (${g.hint})` : ""} \u2192 "${g.tgt}"`).join("\n");
  }

  // src/js/languages.js
  var WRITING_SYSTEMS = {
    latin: {
      id: "latin",
      name: "Latin",
      direction: "ltr",
      segmentation: "spaced",
      shaping: "none",
      protectCharset: null
    },
    cyrillic: {
      id: "cyrillic",
      name: "Cyrillic",
      direction: "ltr",
      segmentation: "spaced",
      shaping: "none",
      protectCharset: null
    }
  };
  var LANGUAGES = [
    {
      code: "en",
      name: "English",
      writingSystem: "latin",
      features: { case: false, wordOrder: "SVO" },
      variants: [
        { code: "en", name: "English", locale: { quotes: { open: "\u201C", close: "\u201D" } } }
      ]
    },
    {
      code: "fr",
      name: "French",
      writingSystem: "latin",
      features: { case: false, gender: ["m", "f"], formality: ["tu", "vous"], wordOrder: "SVO" },
      variants: [
        { code: "fr", name: "French", locale: { quotes: { open: "\xAB", close: "\xBB" } } }
      ]
    },
    {
      code: "es",
      name: "Spanish",
      writingSystem: "latin",
      features: { case: false, gender: ["m", "f"], formality: ["t\xFA", "usted"], wordOrder: "SVO" },
      variants: [
        { code: "es", name: "Spanish (Spain)", locale: { quotes: { open: "\xAB", close: "\xBB" } } }
      ]
    },
    {
      code: "pt",
      name: "Portuguese",
      writingSystem: "latin",
      features: { case: false, gender: ["m", "f"], wordOrder: "SVO" },
      variants: [
        { code: "pt-BR", name: "Portuguese (Brazil)", locale: { quotes: { open: '"', close: '"' }, formality: ["voc\xEA", "o senhor / a senhora"] } },
        { code: "pt-PT", name: "Portuguese (Portugal)", locale: { quotes: { open: "\xAB", close: "\xBB" }, formality: ["tu", "voc\xEA"] } }
      ]
    },
    {
      code: "de",
      name: "German",
      writingSystem: "latin",
      features: { case: 4, gender: ["m", "f", "n"], formality: ["du", "Sie"], wordOrder: "V2 (SOV in subordinate clauses)" },
      variants: [
        { code: "de", name: "German", locale: { quotes: { open: "\u201E", close: "\u201C" } } }
      ]
    },
    {
      code: "ru",
      name: "Russian",
      writingSystem: "cyrillic",
      features: { case: 6, gender: ["m", "f", "n"], formality: ["\u0442\u044B", "\u0432\u044B"], wordOrder: "free (SVO default)" },
      variants: [
        { code: "ru", name: "Russian", locale: { quotes: { open: "\xAB", close: "\xBB" } } }
      ]
    },
    {
      code: "la",
      name: "Latin",
      writingSystem: "latin",
      features: {
        case: "6\u20137",
        gender: ["m", "f", "n"],
        formality: ["tu", "vos"],
        wordOrder: "free (SOV default)",
        notes: "classical dead language; use established classical usage, paraphrase modern concepts or footnote them"
      },
      variants: [
        { code: "la", name: "Latin", locale: { quotes: { open: '"', close: '"' } } }
      ]
    }
  ];
  var byVariant = /* @__PURE__ */ new Map();
  for (const language of LANGUAGES) {
    for (const variant of language.variants) byVariant.set(variant.code, { language, variant });
  }
  function resolveTarget(code) {
    return byVariant.get(code) || null;
  }
  function targetOptions() {
    const out = [];
    for (const language of LANGUAGES) {
      for (const variant of language.variants) out.push({ value: variant.code, label: variant.name });
    }
    return out;
  }
  function sourceOptions() {
    const out = [{ value: "auto", label: "Auto-detect" }];
    for (const language of LANGUAGES) {
      for (const variant of language.variants) out.push({ value: variant.code, label: variant.name });
    }
    return out;
  }
  function languageBrief(language, variant, register) {
    const ws = WRITING_SYSTEMS[language.writingSystem];
    const lines = [`Target: ${variant.name} (${language.name}, ${ws.name} script).`];
    const f = language.features;
    const formality = variant.locale && variant.locale.formality ? variant.locale.formality : f.formality;
    if (f.case) lines.push(`- case system: ${f.case}`);
    if (f.gender && f.gender.length) lines.push(`- grammatical gender: ${f.gender.join("/")}`);
    if (formality && formality.length) lines.push(`- formality (T/V): ${formality.join("/")}`);
    if (f.wordOrder) lines.push(`- word order: ${f.wordOrder}`);
    if (f.notes) lines.push(`- note: ${f.notes}`);
    if (variant.locale) {
      const parts = [];
      const q = variant.locale.quotes;
      if (q) parts.push(`quotes ${q.open}\u2026${q.close}`);
      if (variant.locale.preferredAddress) parts.push(`preferred address "${variant.locale.preferredAddress}"`);
      if (parts.length) lines.push(`Locale: ${parts.join(", ")}.`);
    }
    if (register && register !== "auto" && formality && formality.length) {
      const idx = register === "formal" ? formality.length - 1 : 0;
      lines.push(`Register: ${register} \u2014 use "${formality[idx]}" form of address consistently.`);
    }
    return lines.join("\n");
  }

  // src/js/prompts.js
  var PROMPT_VERSION = "7";
  var FOOTNOTE_INSTRUCTION = "Add a footnote whenever (a) you translate a word or phrase loosely and its literal meaning is worth recording, or (b) the source names something culturally specific \u2014 a food, ritual, garment, rank, place, or object \u2014 that a reader would not know. Keep each footnote to one short sentence. Do not footnote grammar, sentence structure, or interpretive speculation; resolve those in the translation itself.";
  function buildTranslationSystem({ language, variant, register, glossaryText }) {
    const lines = [
      "You are an expert human translator and editor.",
      "Translate the source text into the target language with native fluency and full fidelity to meaning and nuance.",
      "Translate every sentence in full; do not add, omit, summarize, or skip any content.",
      "Preserve every protected token of the form \u27EAn\u27EB verbatim and in place.",
      languageBrief(language, variant, register)
    ];
    if (glossaryText) {
      lines.push("Glossary \u2014 use these exact target terms (apply correct inflection):");
      lines.push(glossaryText);
    }
    lines.push(
      FOOTNOTE_INSTRUCTION,
      'Respond with valid JSON only, in this exact shape: {"translation":"...","footnotes":[{"note":"..."}],"language":"en"}.',
      'The "language" field is the ISO 639-1 code of the detected source language (e.g. en, fr, es, de, ru).',
      "To attach a footnote, insert an inline marker \u27E81\u27E9, \u27E82\u27E9, ... immediately after the relevant word or phrase; the number is the 1-based index into the footnotes array.",
      "If no footnote is needed, use an empty footnotes array and no markers."
    );
    return lines.join("\n");
  }
  function buildTranslationUser({ source, sourceLang, context }) {
    const lines = [];
    if (sourceLang && sourceLang !== "auto") lines.push(`Source language: ${sourceLang}`);
    if (context && context.length) {
      lines.push("Preceding context (for consistent terminology, pronouns and tone):");
      for (const c of context) lines.push(`- source: ${c.source}
- translation: ${c.translation}`);
    }
    lines.push('Source text:\n"""\n' + source + '\n"""');
    return lines.join("\n\n");
  }
  function buildLiteralDraftSystem({ language, variant, register, glossaryText }) {
    const lines = [
      "You are a translator producing a literal draft, before any stylistic polish.",
      "Render the source into the target language word-for-word, preserving its grammar and structure as much as the target allows.",
      "Do not add, omit, or invent verbs, subjects, or connectors that the source leaves out. Keep elliptical, verbless, and fragmentary constructions as they are.",
      "Keep the source's word order, repetitions, abrupt shifts, and imagery; do not normalize or smooth them.",
      "Do not improve readability at the expense of literalness; this pass is deliberately stiff.",
      "Preserve every protected token of the form \u27EAn\u27EB verbatim and in place.",
      languageBrief(language, variant, register)
    ];
    if (glossaryText) {
      lines.push("Glossary \u2014 use these exact target terms (apply correct inflection):");
      lines.push(glossaryText);
    }
    lines.push('Respond with valid JSON only, in this exact shape: {"draft":"..."}.');
    return lines.join("\n");
  }
  function buildRevisionSystem({ language, variant, register, glossaryText }) {
    const lines = [
      "You are an expert human translator and editor.",
      "You receive a source text and its raw machine translation.",
      "Correct any errors in meaning, accuracy, grammar, naturalness, nuance, and terminology so the result reads like a high-quality human translation that stays faithful to the source.",
      "Preserve every protected token of the form \u27EAn\u27EB verbatim and in place (including footnote markers).",
      languageBrief(language, variant, register)
    ];
    if (glossaryText) {
      lines.push("Glossary \u2014 use these exact target terms (apply correct inflection):");
      lines.push(glossaryText);
    }
    lines.push(
      FOOTNOTE_INSTRUCTION,
      'Respond with valid JSON only, in this exact shape: {"translation":"...","footnotes":[{"note":"..."}],"language":"en"}.',
      'The "language" field is the ISO 639-1 code of the detected source language (e.g. en, fr, es, de, ru).',
      "To attach a footnote, insert an inline marker \u27E81\u27E9, \u27E82\u27E9, ... immediately after the relevant word or phrase; the number is the 1-based index into the footnotes array.",
      "If no footnote is needed, use an empty footnotes array and no markers."
    );
    return lines.join("\n");
  }
  function buildRevisionUser({ source, sourceLang, targetLang, draft }) {
    const lines = [];
    if (sourceLang) lines.push(`Source language: ${sourceLang}`);
    if (targetLang) lines.push(`Target language: ${targetLang}`);
    lines.push('Source text:\n"""\n' + source + '\n"""');
    lines.push('Machine translation:\n"""\n' + draft + '\n"""');
    return lines.join("\n\n");
  }

  // src/js/util.js
  var FOOTNOTE_MARKER_RE = /⟨(\d+)⟩/g;
  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
  function escapeHtml(str) {
    return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function parseJson(content) {
    const cleaned = String(content || "").replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
    try {
      return JSON.parse(cleaned);
    } catch {
      const start = cleaned.indexOf("{");
      const end = cleaned.lastIndexOf("}");
      if (start !== -1 && end !== -1 && end > start) {
        return JSON.parse(cleaned.slice(start, end + 1));
      }
      throw new Error("Could not parse model output as JSON.");
    }
  }
  function isRetryable(err) {
    if (err && err.name === "AbortError") return false;
    if (err && typeof err.status === "number") return err.status === 429 || err.status >= 500;
    return true;
  }
  async function withRetry(fn, { attempts = 3, baseDelay = 1e3, onRetry } = {}) {
    for (let attempt = 1; ; attempt++) {
      try {
        return await fn();
      } catch (err) {
        if (attempt >= attempts || !isRetryable(err)) throw err;
        if (onRetry) onRetry(attempt, attempts, err);
        await sleep(baseDelay * 2 ** (attempt - 1));
      }
    }
  }
  async function mapConcurrent(items, limit, worker) {
    const results = new Array(items.length);
    let next = 0;
    const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (true) {
        const i = next++;
        if (i >= items.length) return;
        results[i] = await worker(items[i], i);
      }
    });
    await Promise.all(runners);
    return results;
  }
  function chunkItems(items, measure, maxSize) {
    const chunks = [];
    let current = [];
    let size = 0;
    for (const item of items) {
      const n = measure(item);
      if (current.length && size + n > maxSize) {
        chunks.push(current);
        current = [];
        size = 0;
      }
      current.push(item);
      size += n;
    }
    if (current.length) chunks.push(current);
    return chunks;
  }
  function stripMarkers(text) {
    return String(text).replace(FOOTNOTE_MARKER_RE, "");
  }
  function scanMarkers(text) {
    const out = [];
    const re = /\[(\d+)\]/g;
    let m;
    while (m = re.exec(text)) out.push({ offset: m.index, number: Number(m[1]) });
    return out;
  }
  function rebuildAfterDelete(text, offsets, idx) {
    let out = "";
    let prev = 0;
    const outOffsets = [];
    for (let i = 0; i < offsets.length; i++) {
      const off = offsets[i];
      const len = String(i + 1).length + 2;
      out += text.slice(prev, off);
      if (i === idx) {
        prev = off + len;
        continue;
      }
      const newNum = i < idx ? i + 1 : i;
      outOffsets.push(out.length);
      out += `[${newNum}]`;
      prev = off + len;
    }
    out += text.slice(prev);
    return { text: out, offsets: outOffsets };
  }
  function resolveMarkers(translation, footnotes, startNum = 1) {
    const notes = (Array.isArray(footnotes) ? footnotes : []).filter((fn) => fn && typeof fn.note === "string" && fn.note).map((fn) => fn.note);
    const spots = [];
    const re = new RegExp(FOOTNOTE_MARKER_RE.source, "g");
    let m;
    while (m = re.exec(translation)) spots.push({ index: m.index, end: re.lastIndex });
    let text = "";
    const markers = [];
    let n = startNum;
    let cursor = 0;
    let assigned = 0;
    for (const spot of spots) {
      text += translation.slice(cursor, spot.index);
      if (notes[assigned] !== void 0) {
        markers.push(text.length);
        text += `[${n++}]`;
        assigned++;
      }
      cursor = spot.end;
    }
    text += translation.slice(cursor);
    for (let i = assigned; i < notes.length; i++) {
      if (text && !/\s$/.test(text)) text += " ";
      markers.push(text.length);
      text += `[${n++}]`;
    }
    return { text, notes, markers };
  }
  function download(filename, content, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  // src/js/engine.js
  var DEEPSEEK_URL = "https://api.deepseek.com/chat/completions";
  var REQUEST_TIMEOUT_MS = 12e4;
  var DEFAULT_MODEL = "deepseek-v4-flash";
  var ENGINE_PROVIDERS = {
    deepseek: ({ apiKey, model }) => new DeepSeekEngine({ apiKey, model: model || DEFAULT_MODEL })
  };
  function createEngine(settings) {
    const id = settings.engine || "deepseek";
    const factory = ENGINE_PROVIDERS[id];
    if (!factory) throw new Error(`Unknown engine provider: ${id}`);
    return factory(settings);
  }
  function abortWithTimeout(signal, ms) {
    const controller2 = new AbortController();
    const onAbort = () => controller2.abort(signal.reason);
    const timer = setTimeout(() => controller2.abort(new DOMException("Request timed out", "TimeoutError")), ms);
    if (signal) {
      if (signal.aborted) {
        controller2.abort(signal.reason);
        clearTimeout(timer);
      } else {
        signal.addEventListener("abort", onAbort, { once: true });
      }
    }
    return {
      signal: controller2.signal,
      dispose: () => {
        clearTimeout(timer);
        if (signal) signal.removeEventListener("abort", onAbort);
      }
    };
  }
  var DeepSeekEngine = class {
    constructor({ apiKey, model }) {
      this.apiKey = apiKey;
      this.model = model || DEFAULT_MODEL;
    }
    async translate({ system, user, signal }) {
      if (!this.apiKey) {
        const err = new Error("DeepSeek API key is required.");
        err.status = 400;
        throw err;
      }
      const request = abortWithTimeout(signal, REQUEST_TIMEOUT_MS);
      try {
        const resp = await fetch(DEEPSEEK_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.apiKey}`
          },
          body: JSON.stringify({
            model: this.model,
            temperature: 0.3,
            response_format: { type: "json_object" },
            messages: [
              { role: "system", content: system },
              { role: "user", content: user }
            ]
          }),
          signal: request.signal
        });
        if (!resp.ok) {
          const text = await resp.text();
          const err = new Error(`DeepSeek error (${resp.status}): ${text}`);
          err.status = resp.status;
          throw err;
        }
        const data = await resp.json();
        return parseJson(data.choices?.[0]?.message?.content || "");
      } finally {
        request.dispose();
      }
    }
  };

  // src/js/mtdraft.js
  var GTX_URL = "https://translate.googleapis.com/translate_a/single";
  function gtxLanguage(code) {
    if (code === "pt-BR" || code === "pt-PT") return "pt";
    return code;
  }
  async function googleGtxDraft({ source, sourceLang, targetLang, signal }) {
    const params = new URLSearchParams({
      client: "gtx",
      sl: sourceLang && sourceLang !== "auto" ? gtxLanguage(sourceLang) : "auto",
      tl: gtxLanguage(targetLang),
      dt: "t",
      q: source
    });
    const resp = await fetch(`${GTX_URL}?${params}`, { signal });
    if (!resp.ok) throw new Error(`Google Translate error (${resp.status})`);
    const data = await resp.json();
    const segments = Array.isArray(data) && Array.isArray(data[0]) ? data[0] : [];
    const text = segments.map((s) => Array.isArray(s) ? s[0] : "").join("");
    if (!text) throw new Error("Google Translate returned no translation.");
    const detectedLang = typeof data[2] === "string" ? data[2] : "";
    return { text, detectedLang };
  }
  var DRAFT_PROVIDERS = {
    google: { id: "google", label: "Google Translate (gtx)", draft: googleGtxDraft }
  };
  function getDraftProvider(id) {
    return DRAFT_PROVIDERS[id] ? DRAFT_PROVIDERS[id].draft : null;
  }
  function draftOptions() {
    return Object.values(DRAFT_PROVIDERS).map(({ id, label }) => ({ value: id, label }));
  }

  // src/js/pipeline.js
  var CONCURRENCY = 3;
  var RETRY_ATTEMPTS = 3;
  var RETRY_BASE_DELAY = 1e3;
  var CONTEXT_WINDOW = 2;
  var MAX_CALL_CHARS = 32e3;
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
      PROMPT_VERSION
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
          signal
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
    const results = await mapConcurrent(
      batches,
      CONCURRENCY,
      (batch) => extractNamesFromBatch(batch.join(" "), engine, signal)
    );
    return validateNames(results.flat(), sourceText);
  }
  async function extractNamesFromBatch(text, engine, signal) {
    const system = [
      "You are a named-entity extractor for a translation pipeline.",
      "From the source text, extract proper names, brand names, product names, and other entities that must be copied verbatim (not translated or transliterated).",
      "Return only genuine entities; do not return common nouns, pronouns, or ordinary words.",
      'Respond with valid JSON only, in this exact shape: {"names":["...","..."]}.',
      'If there are none, return {"names":[]}.'
    ].join("\n");
    const user = `Source text:
"""
${text}
"""`;
    const parsed = await engine.translate({ system, user, signal });
    return Array.isArray(parsed.names) ? parsed.names : [];
  }
  function validateNames(names, sourceText) {
    const out = [];
    const seen = /* @__PURE__ */ new Set();
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
    await mapConcurrent(
      batches,
      CONCURRENCY,
      (batch) => verifyGlossaryBatch({ segments: batch, glossary, tokens, engine, targetLabel, sourceLang, signal })
    );
  }
  async function verifyGlossaryBatch({ segments, glossary, engine, targetLabel, sourceLang, signal }) {
    const system = [
      "You are a terminology verifier for a translation.",
      "You are given a glossary of fixed source\u2192target term pairs (each may carry a domain hint) and a list of sentence pairs (source and its translation).",
      "For every glossary entry whose source term appears in a source sentence, check that the translation uses the target term with the correct sense and inflection.",
      "To judge sense, back-translate the phrase around the target term into the source language and confirm it maps to the source term, respecting the domain hint.",
      "Report entries that are missing, mistranslated, or used in the wrong sense.",
      'Respond with valid JSON only, in this exact shape: {"misses":[{"segment":0,"src":"...","tgt":"...","note":"..."}]}.',
      "The segment index is the 0-based position of the pair in the list you were given. The note should be a short reason.",
      'If nothing is missing, return {"misses":[]}.'
    ].join("\n");
    const user = [
      `Source language: ${sourceLang && sourceLang !== "auto" ? sourceLang : "auto-detect"}`,
      `Target language: ${targetLabel}`,
      "Glossary:",
      glossaryPrompt(glossary),
      "Sentence pairs:",
      segments.map((s, i) => `S${i}:
  src: ${s.source}
  tgt: ${s.translation}`).join("\n")
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
  function segmentText(seg, tokens2) {
    return resolveMarkers(restore(seg.translation, tokens2), seg.footnotes, 1).text;
  }
  function assemble(segments, tokens2) {
    let text = "";
    const notes = [];
    const markers = [];
    let num = 0;
    segments.forEach((seg, i) => {
      if (seg.status !== "ok") return;
      if (i > 0) text += seg.paragraphBreak ? "\n\n" : " ";
      const resolved = resolveMarkers(restore(seg.translation, tokens2), seg.footnotes, num + 1);
      const base = text.length;
      text += resolved.text;
      notes.push(...resolved.notes);
      for (const off of resolved.markers) markers.push(base + off);
      num += resolved.notes.length;
    });
    return { text, notes, markers };
  }
  async function runPipeline({ sourceText, settings, signal, onProgress, memory: memory2 }) {
    const target = resolveTarget(settings.targetLang);
    if (!target) throw new Error("Unknown target language.");
    const { language, variant } = target;
    const glossary = parseGlossary(settings.glossary);
    const glossaryText = glossaryPrompt(glossary);
    const engine = makeEngine(settings);
    let tokens2 = [];
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
      tokens2 = protectedTokens;
      const maskedSegments = settings.faithful ? chunkByParagraphs(masked) : segmentDocument(masked);
      const system = buildTranslationSystem({ language, variant, register: settings.register, glossaryText });
      const draftSystem = buildLiteralDraftSystem({ language, variant, register: settings.register, glossaryText });
      const revisionSystem = buildRevisionSystem({ language, variant, register: settings.register, glossaryText });
      segments = maskedSegments.map((m, i) => ({
        id: "s" + i,
        masked: m.source,
        source: restore(m.source, tokens2),
        paragraphBreak: m.paragraphBreak,
        translation: "",
        footnotes: [],
        status: "pending",
        error: null,
        glossaryMisses: [],
        fromMemory: false,
        detectedLang: ""
      }));
      const total = segments.length;
      let done = 0;
      const progress = (message) => onProgress && onProgress({ message, done, total });
      const inflight = /* @__PURE__ */ new Map();
      const translate2 = async (seg, i) => withRetry(
        async () => {
          const context = buildContext(segments, i, CONTEXT_WINDOW);
          if (settings.faithful) {
            const draft = await fetchDraft({ seg, settings, engine, system: draftSystem, signal });
            const user2 = buildRevisionUser({
              source: seg.masked,
              sourceLang: draft.detectedLang || settings.sourceLang,
              targetLang: settings.targetLang,
              draft: draft.text
            });
            const parsed2 = await engine.translate({ system: revisionSystem, user: user2, signal });
            return {
              translation: restore(parsed2.translation || "", tokens2),
              footnotes: Array.isArray(parsed2.footnotes) ? parsed2.footnotes : [],
              language: parsed2.language || draft.detectedLang || ""
            };
          }
          const user = buildTranslationUser({
            source: seg.masked,
            sourceLang: settings.sourceLang,
            context
          });
          const parsed = await engine.translate({ system, user, signal });
          return {
            translation: restore(parsed.translation || "", tokens2),
            footnotes: Array.isArray(parsed.footnotes) ? parsed.footnotes : [],
            language: parsed.language || ""
          };
        },
        {
          attempts: RETRY_ATTEMPTS,
          baseDelay: RETRY_BASE_DELAY,
          onRetry: (attempt) => progress(`Retrying segment ${i + 1}/${total} (attempt ${attempt})...`)
        }
      );
      const resultFor = async (seg, i) => {
        const key = memoryKey(seg.source, settings, glossary);
        if (memory2) {
          const cached = memory2.get(key);
          if (cached) return { ...cached, fromMemory: true };
        }
        if (inflight.has(key)) return inflight.get(key);
        const promise = translate2(seg, i);
        inflight.set(key, promise);
        try {
          const result = await promise;
          if (memory2) memory2.set(key, { translation: result.translation, footnotes: result.footnotes, language: result.language });
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
            signal
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
    return { segments, tokens: tokens2, aborted, error: fatal };
  }
  async function rerollSegment({ segments, segId, settings, signal, tokens: tokens2, memory: memory2 }) {
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
      glossaryText
    });
    const draftSystem = buildLiteralDraftSystem({
      language: target.language,
      variant: target.variant,
      register: settings.register,
      glossaryText
    });
    const revisionSystem = buildRevisionSystem({
      language: target.language,
      variant: target.variant,
      register: settings.register,
      glossaryText
    });
    const context = buildContext(segments, index, CONTEXT_WINDOW);
    await withRetry(
      async () => {
        if (settings.faithful) {
          const draft = await fetchDraft({ seg, settings, engine, system: draftSystem, signal });
          const user2 = buildRevisionUser({
            source: seg.masked,
            sourceLang: draft.detectedLang || settings.sourceLang,
            targetLang: settings.targetLang,
            draft: draft.text
          });
          const parsed2 = await engine.translate({ system: revisionSystem, user: user2, signal });
          seg.translation = restore(parsed2.translation || "", tokens2);
          seg.footnotes = Array.isArray(parsed2.footnotes) ? parsed2.footnotes : [];
          seg.detectedLang = parsed2.language || draft.detectedLang || "";
          seg.status = "ok";
          seg.error = null;
          return;
        }
        const user = buildTranslationUser({
          source: seg.masked,
          sourceLang: settings.sourceLang,
          context
        });
        const parsed = await engine.translate({ system, user, signal });
        seg.translation = restore(parsed.translation || "", tokens2);
        seg.footnotes = Array.isArray(parsed.footnotes) ? parsed.footnotes : [];
        seg.detectedLang = parsed.language || "";
        seg.status = "ok";
        seg.error = null;
      },
      { attempts: RETRY_ATTEMPTS, baseDelay: RETRY_BASE_DELAY }
    );
    if (memory2) {
      memory2.set(memoryKey(seg.source, settings, glossary), {
        translation: seg.translation,
        footnotes: seg.footnotes,
        language: seg.detectedLang
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
          signal
        });
      } catch (err) {
        if (err && err.name === "AbortError") throw err;
      }
    }
    return seg;
  }
  async function runReconcile({ sourceText, segments, tokens: tokens2, settings, signal }) {
    const target = resolveTarget(settings.targetLang);
    const { language, variant } = target;
    const glossary = parseGlossary(settings.glossary);
    const engine = makeEngine(settings);
    const base = assemble(segments, tokens2);
    if (sourceText.length + base.text.length > MAX_CALL_CHARS) {
      return { text: base.text, skipped: true };
    }
    const { masked, tokens: draftTokens } = protect(base.text, { markers: /\[(\d+)\]/g });
    const lines = [
      "You are an expert editor reviewing a complete translation assembled from separately translated sentences.",
      "Improve cross-sentence coherence only: unify terminology, pronouns, formality/register and tone. Correct any remaining errors.",
      "Preserve the full meaning of the source. Do not summarize, omit, or re-order content.",
      "Preserve every protected token of the form \u27EAn\u27EB verbatim and in place (including footnote markers).",
      languageBrief(language, variant, settings.register)
    ];
    const glossaryText = glossaryPrompt(glossary);
    if (glossaryText) lines.push("Glossary \u2014 keep these target terms consistent:\n" + glossaryText);
    lines.push('Respond with valid JSON only, in this exact shape: {"translation":"the polished full translation"}.');
    const system = lines.join("\n");
    const user = [
      'Source document:\n"""\n' + sourceText + '\n"""',
      'Draft translation:\n"""\n' + masked + '\n"""'
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

  // src/js/render.js
  function languageName(code) {
    try {
      if (typeof Intl !== "undefined" && Intl.DisplayNames) {
        return new Intl.DisplayNames(["en"], { type: "language" }).of(code) || code;
      }
    } catch {
    }
    return code;
  }
  function setStatus(els2, text) {
    els2.status.textContent = text;
  }
  function setStatusError(els2, text) {
    els2.status.innerHTML = `<span class="error">${escapeHtml(text)}</span>`;
  }
  function renderAll(els2, state2, isBusy2, actions2) {
    renderFinal(els2, state2, actions2);
    renderSegments(els2, state2, isBusy2, actions2);
    setBusy(els2, isBusy2, !!state2.finalText);
  }
  function setBusy(els2, busy, hasResult) {
    els2.translateBtn.disabled = busy;
    els2.stopBtn.hidden = !busy;
    els2.addFootnoteBtn.disabled = busy || !hasResult;
    els2.copyBtn.disabled = busy || !hasResult;
    els2.exportTxtBtn.disabled = busy || !hasResult;
    els2.exportMdBtn.disabled = busy || !hasResult;
    els2.sections.querySelectorAll(".reroll").forEach((b) => b.disabled = busy);
  }
  function renderFinal(els2, state2, actions2) {
    els2.finalOutput.textContent = state2.finalText;
    els2.finalOutput.classList.toggle("placeholder", !state2.finalText);
    els2.footnotesList.innerHTML = "";
    state2.finalNotes.forEach((note, i) => {
      const li = document.createElement("li");
      const num = document.createElement("span");
      num.className = "fn-num";
      num.textContent = `[${i + 1}]`;
      const input = document.createElement("input");
      input.className = "fn-input";
      input.value = note;
      input.placeholder = "Add clarification...";
      input.addEventListener("input", () => {
        state2.finalNotes[i] = input.value;
      });
      const del = document.createElement("button");
      del.className = "fn-del";
      del.textContent = "\xD7";
      del.title = "Delete footnote";
      del.addEventListener("click", () => actions2.deleteFootnote(i));
      li.append(num, input, del);
      els2.footnotesList.appendChild(li);
    });
    els2.footnotesHint.style.display = state2.finalNotes.length ? "none" : "block";
  }
  function renderSegments(els2, state2, isBusy2, actions2) {
    els2.reviewSection.hidden = state2.segments.length === 0;
    els2.sections.innerHTML = "";
    state2.segments.forEach((seg, i) => {
      const card = document.createElement("div");
      card.className = "section" + (seg.status === "error" ? " failed" : "");
      const head = document.createElement("div");
      head.className = "section-head";
      const title = document.createElement("span");
      const bits = [`Segment ${i + 1} of ${state2.segments.length}`];
      if (seg.detectedLang) bits.push(languageName(seg.detectedLang));
      if (seg.fromMemory) bits.push("cached");
      title.textContent = bits.join(" \xB7 ");
      const btn = document.createElement("button");
      btn.className = "reroll";
      btn.textContent = "Re-roll";
      btn.disabled = isBusy2;
      btn.addEventListener("click", () => actions2.reroll(seg.id));
      head.append(title, btn);
      const cols = document.createElement("div");
      cols.className = "section-cols";
      const srcCol = document.createElement("div");
      srcCol.className = "col";
      const srcLabel = document.createElement("div");
      srcLabel.className = "col-label";
      srcLabel.textContent = "Original";
      const srcText = document.createElement("div");
      srcText.className = "text";
      srcText.textContent = seg.source;
      srcCol.append(srcLabel, srcText);
      const dstCol = document.createElement("div");
      dstCol.className = "col";
      const dstLabel = document.createElement("div");
      dstLabel.className = "col-label";
      dstLabel.textContent = "Translation";
      const dstText = document.createElement("div");
      dstText.className = "text";
      if (seg.status === "error") dstText.classList.add("error-text");
      dstText.textContent = seg.status === "error" ? seg.error || "Failed" : segmentText(seg, state2.tokens);
      dstCol.append(dstLabel, dstText);
      if (seg.status === "ok" && seg.glossaryMisses.length) {
        const warn = document.createElement("div");
        warn.className = "warn";
        warn.textContent = "Check glossary term(s): " + seg.glossaryMisses.map((g) => `"${g.tgt}"` + (g.note ? ` \u2014 ${g.note}` : "")).join("; ");
        dstCol.appendChild(warn);
      }
      cols.append(srcCol, dstCol);
      card.append(head, cols);
      if (seg.footnotes.length) {
        const ol = document.createElement("ol");
        ol.className = "sec-notes";
        seg.footnotes.forEach((fn) => {
          if (fn && typeof fn.note === "string" && fn.note) {
            const li = document.createElement("li");
            li.textContent = fn.note;
            ol.appendChild(li);
          }
        });
        card.appendChild(ol);
      }
      els2.sections.appendChild(card);
    });
  }

  // src/js/store.js
  var KEYS = {
    apiKey: "translator.deepseek.key",
    remember: "translator.deepseek.remember",
    model: "translator.model",
    engine: "translator.engine",
    draftSource: "translator.draftSource",
    sourceLang: "translator.sourceLang",
    targetLang: "translator.targetLang",
    register: "translator.register",
    glossary: "translator.glossary",
    finalPass: "translator.finalPass",
    protectNames: "translator.protectNames",
    faithful: "translator.faithful"
  };
  function getStored(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v === null ? fallback : v;
    } catch {
      return fallback;
    }
  }
  function setStored(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {
    }
  }
  function removeStored(key) {
    try {
      localStorage.removeItem(key);
    } catch {
    }
  }

  // src/js/tm.js
  var STORAGE_KEY = "translator.tm";
  var MAX_ENTRIES = 500;
  var TranslationMemory = class {
    constructor(storage) {
      this.entries = /* @__PURE__ */ new Map();
      this.storage = storage || (typeof localStorage !== "undefined" ? localStorage : null);
      this.load();
    }
    load() {
      if (!this.storage) return;
      try {
        const raw = this.storage.getItem(STORAGE_KEY);
        if (!raw) return;
        const data = JSON.parse(raw);
        if (Array.isArray(data)) {
          for (const [key, value] of data) this.entries.set(key, value);
        }
      } catch {
      }
    }
    save() {
      if (!this.storage) return;
      try {
        this.storage.setItem(STORAGE_KEY, JSON.stringify(Array.from(this.entries.entries())));
      } catch {
      }
    }
    get(key) {
      return this.entries.get(key);
    }
    set(key, value) {
      this.entries.delete(key);
      this.entries.set(key, value);
      while (this.entries.size > MAX_ENTRIES) {
        const oldest = this.entries.keys().next().value;
        this.entries.delete(oldest);
      }
      this.save();
    }
  };

  // src/js/app.js
  var els = {
    apiKey: document.getElementById("apiKey"),
    rememberKey: document.getElementById("rememberKey"),
    model: document.getElementById("model"),
    draftSource: document.getElementById("draftSource"),
    sourceLang: document.getElementById("sourceLang"),
    targetLang: document.getElementById("targetLang"),
    register: document.getElementById("register"),
    glossary: document.getElementById("glossary"),
    finalPass: document.getElementById("finalPass"),
    protectNames: document.getElementById("protectNames"),
    faithful: document.getElementById("faithful"),
    source: document.getElementById("source"),
    finalOutput: document.getElementById("finalOutput"),
    footnotesList: document.getElementById("footnotesList"),
    footnotesHint: document.getElementById("footnotesHint"),
    addFootnoteBtn: document.getElementById("addFootnoteBtn"),
    reviewSection: document.getElementById("reviewSection"),
    sections: document.getElementById("sections"),
    translateBtn: document.getElementById("translateBtn"),
    stopBtn: document.getElementById("stopBtn"),
    copyBtn: document.getElementById("copyBtn"),
    exportTxtBtn: document.getElementById("exportTxtBtn"),
    exportMdBtn: document.getElementById("exportMdBtn"),
    status: document.getElementById("status")
  };
  var state = {
    segments: [],
    tokens: [],
    finalText: "",
    finalNotes: [],
    finalMarkers: [],
    finalEdited: false,
    activeSource: ""
  };
  var actions = { deleteFootnote, reroll };
  var memory = new TranslationMemory();
  var controller = null;
  var isBusy = false;
  function init() {
    populateSelect(els.sourceLang, sourceOptions());
    populateSelect(els.targetLang, targetOptions());
    populateSelect(els.draftSource, [{ value: "none", label: "None (LLM literal draft)" }, ...draftOptions()]);
    populateSelect(els.register, [
      { value: "auto", label: "Default register" },
      { value: "formal", label: "Formal" },
      { value: "informal", label: "Informal" }
    ]);
    els.model.value = getStored(KEYS.model, DEFAULT_MODEL);
    els.draftSource.value = getStored(KEYS.draftSource, "google");
    els.sourceLang.value = getStored(KEYS.sourceLang, "auto");
    els.targetLang.value = getStored(KEYS.targetLang, "es");
    els.register.value = getStored(KEYS.register, "auto");
    els.glossary.value = getStored(KEYS.glossary, "");
    els.finalPass.checked = getStored(KEYS.finalPass, "") === "1";
    els.protectNames.checked = getStored(KEYS.protectNames, "1") === "1";
    els.faithful.checked = getStored(KEYS.faithful, "") === "1";
    const remember = getStored(KEYS.remember, "") === "1";
    els.rememberKey.checked = remember;
    if (remember) els.apiKey.value = getStored(KEYS.apiKey, "");
    bindPersistence();
    els.translateBtn.addEventListener("click", translate);
    els.stopBtn.addEventListener("click", () => controller?.abort());
    els.copyBtn.addEventListener("click", copyResult);
    els.exportTxtBtn.addEventListener("click", () => exportResult("txt"));
    els.exportMdBtn.addEventListener("click", () => exportResult("md"));
    els.addFootnoteBtn.addEventListener("click", addFootnote);
    els.finalOutput.addEventListener("input", onFinalEdit);
  }
  function populateSelect(select, options) {
    for (const o of options) {
      const opt = document.createElement("option");
      opt.value = o.value;
      opt.textContent = o.label;
      select.appendChild(opt);
    }
  }
  function bindPersistence() {
    els.model.addEventListener("input", () => setStored(KEYS.model, els.model.value));
    els.draftSource.addEventListener("change", () => setStored(KEYS.draftSource, els.draftSource.value));
    els.sourceLang.addEventListener("change", () => setStored(KEYS.sourceLang, els.sourceLang.value));
    els.targetLang.addEventListener("change", () => setStored(KEYS.targetLang, els.targetLang.value));
    els.register.addEventListener("change", () => setStored(KEYS.register, els.register.value));
    els.glossary.addEventListener("input", () => setStored(KEYS.glossary, els.glossary.value));
    els.finalPass.addEventListener(
      "change",
      () => setStored(KEYS.finalPass, els.finalPass.checked ? "1" : "")
    );
    els.protectNames.addEventListener(
      "change",
      () => setStored(KEYS.protectNames, els.protectNames.checked ? "1" : "")
    );
    els.faithful.addEventListener(
      "change",
      () => setStored(KEYS.faithful, els.faithful.checked ? "1" : "")
    );
    els.apiKey.addEventListener("input", () => {
      if (els.rememberKey.checked) setStored(KEYS.apiKey, els.apiKey.value.trim());
    });
    els.rememberKey.addEventListener("change", () => {
      if (els.rememberKey.checked) {
        const ok = window.confirm(
          "Remember this API key? It will be stored in plaintext in this browser's local storage, readable by any script on this page or anyone with access to this device.\n\nClick OK to remember, Cancel to keep it in memory only."
        );
        if (!ok) {
          els.rememberKey.checked = false;
          return;
        }
        setStored(KEYS.remember, "1");
        setStored(KEYS.apiKey, els.apiKey.value.trim());
      } else {
        removeStored(KEYS.remember);
        removeStored(KEYS.apiKey);
      }
    });
  }
  function readSettings() {
    return {
      apiKey: els.apiKey.value.trim(),
      model: els.model.value.trim() || DEFAULT_MODEL,
      draftSource: els.draftSource.value,
      sourceLang: els.sourceLang.value,
      targetLang: els.targetLang.value,
      register: els.register.value,
      glossary: els.glossary.value,
      finalPass: els.finalPass.checked,
      protectNames: els.protectNames.checked,
      faithful: els.faithful.checked
    };
  }
  function getSourceSelection() {
    const el = els.source;
    if (el.selectionStart !== void 0 && el.selectionEnd !== void 0 && el.selectionStart !== el.selectionEnd) {
      return el.value.slice(el.selectionStart, el.selectionEnd);
    }
    return "";
  }
  async function translate() {
    const selected = getSourceSelection().trim();
    const isSelection = selected.length > 0;
    const sourceText = (isSelection ? selected : els.source.value).trim();
    if (!sourceText) {
      setStatus(els, "Paste some text first.");
      return;
    }
    const settings = readSettings();
    if (!settings.apiKey) {
      setStatus(els, "Enter your DeepSeek API key first.");
      return;
    }
    controller = new AbortController();
    isBusy = true;
    state.segments = [];
    state.finalEdited = false;
    state.activeSource = sourceText;
    renderAll(els, state, isBusy, actions);
    try {
      const result = await runPipeline({
        sourceText,
        settings,
        signal: controller.signal,
        onProgress: (p) => setStatus(els, p.message),
        memory
      });
      state.segments = result.segments;
      state.tokens = result.tokens;
      const base = assemble(state.segments, state.tokens);
      state.finalText = base.text;
      state.finalNotes = base.notes;
      state.finalMarkers = base.markers;
      if (result.aborted) {
        setStatus(els, "Stopped.");
      } else if (result.error) {
        const failed = state.segments.filter((s) => s.status === "error").length;
        const done = state.segments.length - failed;
        setStatus(
          els,
          `Partially translated \u2014 ${done}/${state.segments.length} segment(s) done; ${failed} failed (${result.error.message || String(result.error)}).`
        );
      } else {
        let skippedReconcile = false;
        if (settings.finalPass && state.segments.some((s) => s.status === "ok")) {
          setStatus(els, "Reconcile pass...");
          const rec = await runReconcile({
            sourceText,
            segments: state.segments,
            tokens: state.tokens,
            settings,
            signal: controller.signal
          });
          state.finalText = rec.text;
          if (!rec.skipped) state.finalMarkers = scanMarkers(rec.text).map((m) => m.offset);
          skippedReconcile = !!rec.skipped;
        }
        const failed = state.segments.filter((s) => s.status === "error").length;
        const scope = isSelection ? " (selection)" : "";
        const note = skippedReconcile ? " (reconcile skipped: document too large)" : "";
        setStatus(
          els,
          failed ? `Done \u2014 ${failed} of ${state.segments.length} segment(s) failed${note}.` : `Done \u2014 ${state.segments.length} segment(s) translated${scope}${note}.`
        );
      }
    } catch (err) {
      if (err && err.name === "AbortError") setStatus(els, "Stopped.");
      else setStatusError(els, err.message || String(err));
    } finally {
      controller = null;
      isBusy = false;
      renderAll(els, state, isBusy, actions);
    }
  }
  async function reroll(id) {
    if (isBusy) return;
    const settings = readSettings();
    controller = new AbortController();
    isBusy = true;
    renderAll(els, state, isBusy, actions);
    try {
      setStatus(els, "Re-rolling segment...");
      await rerollSegment({ segments: state.segments, segId: id, settings, signal: controller.signal, tokens: state.tokens, memory });
      if (!state.finalEdited) {
        const sourceText = state.activeSource || els.source.value.trim();
        const base = assemble(state.segments, state.tokens);
        state.finalText = base.text;
        state.finalNotes = base.notes;
        state.finalMarkers = base.markers;
        if (settings.finalPass && state.segments.some((s) => s.status === "ok")) {
          const rec = await runReconcile({
            sourceText,
            segments: state.segments,
            tokens: state.tokens,
            settings,
            signal: controller.signal
          });
          state.finalText = rec.text;
          if (!rec.skipped) state.finalMarkers = scanMarkers(rec.text).map((m) => m.offset);
        }
      }
      setStatus(
        els,
        state.finalEdited ? "Segment re-rolled (final text kept as edited)." : "Segment re-rolled."
      );
    } catch (err) {
      if (err && err.name === "AbortError") setStatus(els, "Stopped.");
      else setStatusError(els, err.message || String(err));
    } finally {
      controller = null;
      isBusy = false;
      renderAll(els, state, isBusy, actions);
    }
  }
  function onFinalEdit() {
    state.finalText = readFinalText();
    state.finalEdited = true;
    state.finalMarkers = [];
    els.finalOutput.classList.toggle("placeholder", !state.finalText);
  }
  function addFootnote() {
    els.finalOutput.focus();
    const num = state.finalNotes.length + 1;
    insertAtCursor(els.finalOutput, `[${num}]`);
    state.finalText = readFinalText();
    state.finalNotes.push("");
    state.finalMarkers = [];
    state.finalEdited = true;
    renderAll(els, state, isBusy, actions);
    const inputs = els.footnotesList.querySelectorAll(".fn-input");
    const last = inputs[inputs.length - 1];
    if (last) last.focus();
  }
  function deleteFootnote(idx) {
    const text = state.finalText;
    const offsets = state.finalMarkers;
    const verified = offsets.length === state.finalNotes.length && offsets.every((off, i) => text.slice(off, off + String(i + 1).length + 2) === `[${i + 1}]`);
    if (verified) {
      const rebuilt = rebuildAfterDelete(text, offsets, idx);
      state.finalText = rebuilt.text;
      state.finalMarkers = rebuilt.offsets;
    } else {
      const n = idx + 1;
      state.finalText = text.replace(new RegExp(`\\[${n}\\](?!\\d)`), "").replace(/\[(\d+)\]/g, (m, d) => Number(d) > n ? `[${Number(d) - 1}]` : m);
      state.finalMarkers = [];
    }
    state.finalNotes.splice(idx, 1);
    state.finalEdited = true;
    renderAll(els, state, isBusy, actions);
  }
  function insertAtCursor(el, text) {
    el.focus();
    const sel = window.getSelection();
    if (sel && sel.rangeCount) {
      const range = sel.getRangeAt(0);
      range.deleteContents();
      const node = document.createTextNode(text);
      range.insertNode(node);
      range.setStartAfter(node);
      range.setEndAfter(node);
      sel.removeAllRanges();
      sel.addRange(range);
    } else {
      el.textContent += text;
    }
  }
  function readFinalText() {
    return els.finalOutput.innerText.replace(/\n$/, "");
  }
  function getSnapshot() {
    state.finalText = readFinalText();
    const notesText = state.finalNotes.map((n, i) => `[${i + 1}] ${n}`).join("\n");
    return {
      text: state.finalText,
      plain: state.finalText + (notesText ? "\n\nFootnotes:\n" + notesText : ""),
      notesText
    };
  }
  async function copyResult() {
    const { plain } = getSnapshot();
    try {
      await navigator.clipboard.writeText(plain);
      setStatus(els, "Copied to clipboard.");
    } catch {
      setStatus(els, "Copy failed.");
    }
  }
  function exportResult(kind) {
    const { plain, text, notesText } = getSnapshot();
    if (kind === "md") {
      const md = toMarkdown(text, state.finalMarkers, state.finalNotes) + (notesText ? "\n\n" + notesText.replace(/^\[(\d+)\] /gm, "[^$1]: ") : "");
      download("translation.md", md, "text/markdown");
    } else {
      download("translation.txt", plain, "text/plain");
    }
    setStatus(els, "Exported.");
  }
  function toMarkdown(text, offsets, notes) {
    const verified = offsets.length === notes.length && offsets.every((off, i) => text.slice(off, off + String(i + 1).length + 2) === `[${i + 1}]`);
    if (!verified) return text.replace(/\[(\d+)\]/g, "[^$1]");
    let out = text;
    for (let i = offsets.length - 1; i >= 0; i--) {
      const num = i + 1;
      const off = offsets[i];
      out = out.slice(0, off) + `[^${num}]` + out.slice(off + String(num).length + 2);
    }
    return out;
  }
  init();
})();

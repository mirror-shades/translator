const DEEPSEEK_URL = "https://api.deepseek.com/chat/completions";
const GT_URL = "https://translate.googleapis.com/translate_a/single";
const CHUNK_SIZE = 1500;
const API_KEY_STORAGE = "translator.deepseek.key";
const REMEMBER_STORAGE = "translator.deepseek.remember";
const GLOSSARY_STORAGE = "translator.glossary";
const MARKER_RE = /⟨(\d+)⟩/g;
const RETRY_ATTEMPTS = 3;
const RETRY_BASE_DELAY = 1000;
const CONCURRENCY = 3;

const LANGUAGES = [
  ["zh-CN", "Chinese (Simplified)"],
  ["zh-TW", "Chinese (Traditional)"],
  ["en", "English"],
  ["es", "Spanish"],
  ["fr", "French"],
  ["de", "German"],
  ["it", "Italian"],
  ["ja", "Japanese"],
  ["ko", "Korean"],
  ["pt", "Portuguese"],
  ["ru", "Russian"],
  ["ar", "Arabic"],
  ["hi", "Hindi"],
  ["nl", "Dutch"],
  ["tr", "Turkish"],
  ["vi", "Vietnamese"],
  ["th", "Thai"],
  ["pl", "Polish"],
  ["uk", "Ukrainian"],
  ["sv", "Swedish"],
];

const SYSTEM_PROMPT =
  "You are an expert human translator and editor. You receive a source text and its raw machine translation. " +
  "Correct any errors in meaning, accuracy, grammar, naturalness, nuance, and terminology so the result reads " +
  "like a high-quality human translation that stays faithful to the source. Where a passage is genuinely difficult " +
  "to translate, culturally specific, or ambiguous, add a clarifying footnote. " +
  "Respond with valid JSON only, using this exact shape: " +
  '{"translation":"the fully corrected translation","footnotes":[{"note":"clarification"}]}. ' +
  "To attach a footnote to a specific word or phrase, insert an inline marker immediately after that word or phrase " +
  "in the translation, like ⟨1⟩, ⟨2⟩, and so on. The number in each marker is the 1-based index of the corresponding " +
  "footnote in the footnotes array. If no footnote is needed, use an empty footnotes array and no markers.";

const FINAL_PASS_PROMPT =
  "You are an expert editor reviewing a complete translated document that was assembled from separately translated " +
  "sections. Improve overall coherence: unify terminology across sections, fix pronouns and cross-references, smooth " +
  "tone and style, and correct any remaining errors. Stay faithful to the source meaning. Do not summarize or omit. " +
  "Where a passage is genuinely difficult to translate, culturally specific, or ambiguous, add a clarifying footnote. " +
  "Respond with valid JSON only, using this exact shape: " +
  '{"translation":"the polished full translation","footnotes":[{"note":"clarification"}]}. ' +
  "To attach a footnote to a specific word or phrase, insert an inline marker immediately after that word or phrase " +
  "in the translation, like ⟨1⟩, ⟨2⟩, and so on. The number in each marker is the 1-based index of the corresponding " +
  "footnote in the footnotes array. If no footnote is needed, use an empty footnotes array and no markers.";

const els = {
  apiKey: document.getElementById("apiKey"),
  rememberKey: document.getElementById("rememberKey"),
  model: document.getElementById("model"),
  targetLang: document.getElementById("targetLang"),
  glossary: document.getElementById("glossary"),
  finalPass: document.getElementById("finalPass"),
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
  status: document.getElementById("status"),
};

const state = {
  sections: [],
  finalText: "",
  finalNotes: [],
  finalMarkers: [],
  finalEdited: false,
};

function init() {
  const remember = localStorage.getItem(REMEMBER_STORAGE) === "1";
  els.rememberKey.checked = remember;
  if (remember) {
    els.apiKey.value = localStorage.getItem(API_KEY_STORAGE) || "";
  }
  els.glossary.value = localStorage.getItem(GLOSSARY_STORAGE) || "";

  for (const [code, name] of LANGUAGES) {
    const opt = document.createElement("option");
    opt.value = code;
    opt.textContent = name;
    els.targetLang.appendChild(opt);
  }
  els.targetLang.value = "en";

  els.apiKey.addEventListener("input", () => {
    if (els.rememberKey.checked) {
      localStorage.setItem(API_KEY_STORAGE, els.apiKey.value.trim());
    }
  });
  els.rememberKey.addEventListener("change", () => {
    if (els.rememberKey.checked) {
      const ok = window.confirm(
        "Remember this API key? It will be stored in plaintext in this browser's " +
          "local storage, readable by any script on this page or anyone with access " +
          "to this device.\n\nClick OK to remember, Cancel to keep it in memory only."
      );
      if (!ok) {
        els.rememberKey.checked = false;
        return;
      }
      localStorage.setItem(REMEMBER_STORAGE, "1");
      localStorage.setItem(API_KEY_STORAGE, els.apiKey.value.trim());
    } else {
      localStorage.removeItem(REMEMBER_STORAGE);
      localStorage.removeItem(API_KEY_STORAGE);
    }
  });
  els.glossary.addEventListener("input", () =>
    localStorage.setItem(GLOSSARY_STORAGE, els.glossary.value)
  );

  els.translateBtn.addEventListener("click", translate);
  els.stopBtn.addEventListener("click", () => controller?.abort());
  els.copyBtn.addEventListener("click", copyResult);
  els.exportTxtBtn.addEventListener("click", () => exportResult("txt"));
  els.exportMdBtn.addEventListener("click", () => exportResult("md"));
  els.addFootnoteBtn.addEventListener("click", addFootnote);
  els.finalOutput.addEventListener("input", () => {
    state.finalText = readFinalText();
    state.finalMarkers = [];
    state.finalEdited = true;
    els.finalOutput.classList.toggle("placeholder", !state.finalText);
  });
}

function getSettings() {
  return {
    apiKey: els.apiKey.value.trim(),
    model: els.model.value.trim() || "deepseek-v4-flash",
    targetLang: els.targetLang.value,
    finalPass: els.finalPass.checked,
    glossaryList: parseGlossary(els.glossary.value),
  };
}

function parseGlossary(text) {
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    const m = t.match(/^(.*?)\s*(?:=>|->|=)\s*(.*)$/);
    if (m && m[1] && m[2]) out.push({ src: m[1].trim(), tgt: m[2].trim() });
  }
  return out;
}

function glossaryPrompt(list) {
  if (!list.length) return "";
  return (
    "Use these fixed translations for specific terms (do not deviate):\n" +
    list.map((g) => `- "${g.src}" -> "${g.tgt}"`).join("\n")
  );
}

function splitIntoSentences(text) {
  const matches = text.match(/[^.!?]+[.!?]+["')\]]*\s*|[^.!?]+$/g);
  return (matches || [text]).map((s) => s.trim()).filter((s) => s.length > 0);
}

function chunkText(text, maxLen) {
  const paragraphs = text
    .split(/\r?\n+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  const chunks = [];

  paragraphs.forEach((para) => {
    if (para.length <= maxLen) {
      chunks.push({ text: para, breakBefore: chunks.length > 0 });
      return;
    }
    let current = "";
    let isFirst = true;
    for (const sent of splitIntoSentences(para)) {
      const candidate = current ? current + " " + sent : sent;
      if (current && candidate.length > maxLen) {
        chunks.push({ text: current.trim(), breakBefore: isFirst && chunks.length > 0 });
        current = sent;
        isFirst = false;
      } else {
        current = candidate;
      }
    }
    if (current.trim()) {
      chunks.push({ text: current.trim(), breakBefore: isFirst && chunks.length > 0 });
    }
  });

  return chunks;
}

async function googleTranslate(text, tl) {
  const url = `${GT_URL}?client=gtx&sl=auto&tl=${encodeURIComponent(
    tl
  )}&dt=t&q=${encodeURIComponent(text)}`;
  const resp = await fetch(url, { signal: controller?.signal });
  if (!resp.ok) {
    const err = new Error(`Google Translate error (${resp.status})`);
    err.status = resp.status;
    throw err;
  }
  const data = await resp.json();
  const translation = (data[0] || []).map((seg) => seg[0] || "").join("");
  const detected = data[2] || "auto";
  return { translation, detected };
}

function parseJson(content) {
  const cleaned = content.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start !== -1 && end !== -1 && end > start) {
      return JSON.parse(cleaned.slice(start, end + 1));
    }
    throw new Error("Could not parse model output");
  }
}

async function callDeepSeek(system, user, settings) {
  if (!settings.apiKey) {
    const err = new Error("Please enter your DeepSeek API key.");
    err.status = 400;
    throw err;
  }

  const resp = await fetch(DEEPSEEK_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${settings.apiKey}`,
    },
    body: JSON.stringify({
      model: settings.model,
      temperature: 0.3,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
    signal: controller?.signal,
  });

  if (!resp.ok) {
    const errText = await resp.text();
    const err = new Error(`DeepSeek error (${resp.status}): ${errText}`);
    err.status = resp.status;
    throw err;
  }

  const data = await resp.json();
  return parseJson(data.choices?.[0]?.message?.content || "");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryable(err) {
  if (err && err.name === "AbortError") return false;
  if (err && typeof err.status === "number") {
    return err.status === 429 || err.status >= 500;
  }
  return true;
}

async function withRetry(fn) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= RETRY_ATTEMPTS || !isRetryable(err)) throw err;
      els.status.textContent = `Transient error — retrying (${attempt}/${RETRY_ATTEMPTS - 1})...`;
      await sleep(RETRY_BASE_DELAY * Math.pow(2, attempt - 1));
    }
  }
}

async function deepseekReview(source, machine, targetLang, sourceLang, settings) {
  const glossary = glossaryPrompt(settings.glossaryList);
  const userContent = [
    `Source language: ${sourceLang}`,
    `Target language: ${targetLang}`,
    glossary ? `\n${glossary}` : "",
    "",
    "Source text:",
    '"""',
    source,
    '"""',
    "",
    "Machine translation:",
    '"""',
    machine,
    '"""',
  ]
    .filter((l) => l !== "")
    .join("\n");

  const parsed = await callDeepSeek(SYSTEM_PROMPT, userContent, settings);
  return {
    translation: parsed.translation || machine,
    footnotes: Array.isArray(parsed.footnotes) ? parsed.footnotes : [],
  };
}

async function deepseekFinalPass(source, draft, targetLang, settings) {
  const glossary = glossaryPrompt(settings.glossaryList);
  const userContent = [
    `Target language: ${targetLang}`,
    glossary ? `\n${glossary}` : "",
    "",
    "Source document:",
    '"""',
    source,
    '"""',
    "",
    "Draft translation (assembled from sections):",
    '"""',
    draft,
    '"""',
  ]
    .filter((l) => l !== "")
    .join("\n");

  const parsed = await callDeepSeek(FINAL_PASS_PROMPT, userContent, settings);
  return {
    translation: parsed.translation || draft,
    footnotes: Array.isArray(parsed.footnotes) ? parsed.footnotes : [],
  };
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function stripMarkers(text) {
  return text.replace(MARKER_RE, "");
}

function resolveMarkers(translation, footnotes, startNum) {
  const noteByNum = new Map();
  (Array.isArray(footnotes) ? footnotes : []).forEach((fn, i) => {
    if (fn && typeof fn.note === "string" && fn.note) {
      noteByNum.set(i + 1, fn.note);
    }
  });

  const notes = [];
  const markers = [];
  let n = startNum || 1;
  let text = "";
  let lastIndex = 0;
  const re = new RegExp(MARKER_RE.source, "g");
  let m;
  while ((m = re.exec(translation)) !== null) {
    const note = noteByNum.get(parseInt(m[1], 10));
    text += translation.slice(lastIndex, m.index);
    if (note !== undefined) {
      markers.push(text.length);
      text += `[${n++}]`;
      notes.push(note);
    }
    lastIndex = re.lastIndex;
  }
  text += translation.slice(lastIndex);
  return { text, notes, markers };
}

function combineSectionsText() {
  let text = "";
  state.sections.forEach((s, idx) => {
    if (idx > 0) text += s.breakBefore ? "\n\n" : " ";
    text += stripMarkers(s.translation);
  });
  return text;
}

function combineWithFootnotes(sections = state.sections) {
  let text = "";
  const notes = [];
  const markers = [];
  let num = 0;

  sections.forEach((s, idx) => {
    if (idx > 0) text += s.breakBefore ? "\n\n" : " ";
    const r = resolveMarkers(s.translation, s.footnotes, num + 1);
    const base = text.length;
    text += r.text;
    notes.push(...r.notes);
    for (const off of r.markers) markers.push(base + off);
    num += r.notes.length;
  });

  return { text, notes, markers };
}

function applyFootnotesToText(translation, footnotes) {
  return resolveMarkers(translation, footnotes, 1);
}

async function buildFinal() {
  if (state.finalEdited) return;
  const settings = getSettings();
  if (settings.finalPass && state.sections.length) {
    const draft = combineSectionsText();
    const source = state.sections.map((s) => s.source).join("\n\n");
    els.status.textContent = "Final coherence pass...";
    const r = await deepseekFinalPass(source, draft, settings.targetLang, settings);
    const applied = applyFootnotesToText(r.translation, r.footnotes);
    state.finalText = applied.text;
    state.finalNotes = applied.notes;
    state.finalMarkers = applied.markers;
  } else {
    const applied = combineWithFootnotes();
    state.finalText = applied.text;
    state.finalNotes = applied.notes;
    state.finalMarkers = applied.markers;
  }
}

function throwIfAborted() {
  if (controller && controller.signal.aborted) {
    const err = new Error("Stopped.");
    err.name = "AbortError";
    throw err;
  }
}

async function runSections(settings) {
  const sections = state.sections;
  const total = sections.length;
  let nextIndex = 0;
  let done = 0;
  const failures = [];

  function updateStatus() {
    els.status.textContent = `Processing section ${done + 1}/${total}...`;
  }

  async function processSection(s) {
    try {
      await withRetry(async () => {
        const mt = await googleTranslate(s.source, settings.targetLang);
        const review = await deepseekReview(
          s.source,
          mt.translation,
          settings.targetLang,
          mt.detected,
          settings
        );
        s.translation = review.translation;
        s.footnotes = review.footnotes;
      });
    } catch (err) {
      if (err && err.name === "AbortError") throw err;
      s.error = err && err.message ? err.message : String(err);
      failures.push(s);
    }
  }

  async function worker() {
    while (true) {
      throwIfAborted();
      const i = nextIndex++;
      if (i >= total) return;
      const s = sections[i];
      updateStatus();
      await processSection(s);
      throwIfAborted();
      done++;
      updateStatus();
      renderSections();
    }
  }

  const runners = [];
  for (let i = 0; i < Math.min(CONCURRENCY, total); i++) runners.push(worker());
  await Promise.all(runners);

  if (failures.length) {
    const err = new Error(
      failures.length === total
        ? `All ${total} section(s) failed — ${failures[0].error}`
        : `${failures.length} of ${total} section(s) failed.`
    );
    throw err;
  }
}

async function translate() {
  const sourceText = els.source.value.trim();
  if (!sourceText) {
    els.status.textContent = "Paste some text first.";
    return;
  }

  const settings = getSettings();
  const chunks = chunkText(sourceText, CHUNK_SIZE);

  state.sections = chunks.map((c, i) => ({
    id: "s" + i,
    source: c.text,
    translation: "",
    footnotes: [],
    breakBefore: c.breakBefore,
  }));

  state.finalEdited = false;
  controller = new AbortController();
  setBusy(true);

  try {
    await runSections(settings);
    await buildFinal();
    render();
    els.status.textContent = `Done — ${state.sections.length} section(s) processed.`;
  } catch (err) {
    renderPartial();
    if (err && err.name === "AbortError") {
      els.status.textContent = "Stopped.";
    } else {
      els.status.innerHTML = `<span class="error">${escapeHtml(err.message)}</span>`;
    }
  } finally {
    controller = null;
    setBusy(false);
  }
}

function renderPartial() {
  const completed = state.sections.filter((s) => s.translation);
  if (completed.length) {
    const applied = combineWithFootnotes(completed);
    state.finalText = applied.text;
    state.finalNotes = applied.notes;
    state.finalMarkers = applied.markers;
  }
  render();
}

async function reRollSection(id) {
  const settings = getSettings();
  const s = state.sections.find((x) => x.id === id);
  if (!s) return;

  controller = new AbortController();
  setBusy(true);
  try {
    els.status.textContent = "Re-rolling section...";
    await withRetry(async () => {
      const mt = await googleTranslate(s.source, settings.targetLang);
      const review = await deepseekReview(
        s.source,
        mt.translation,
        settings.targetLang,
        mt.detected,
        settings
      );
      s.translation = review.translation;
      s.footnotes = review.footnotes;
    });
    s.error = null;

    await buildFinal();
    render();
    els.status.textContent = state.finalEdited
      ? "Section re-rolled (final text kept as edited)."
      : "Section re-rolled.";
  } catch (err) {
    if (err && err.name === "AbortError") {
      els.status.textContent = "Stopped.";
    } else {
      els.status.innerHTML = `<span class="error">${escapeHtml(err.message)}</span>`;
    }
  } finally {
    controller = null;
    setBusy(false);
  }
}

let isBusy = false;
let controller = null;

function setBusy(busy) {
  isBusy = busy;
  els.translateBtn.disabled = busy;
  els.stopBtn.hidden = !busy;
  els.addFootnoteBtn.disabled = busy || !state.finalText;
  els.copyBtn.disabled = busy || !state.finalText;
  els.exportTxtBtn.disabled = busy || !state.finalText;
  els.exportMdBtn.disabled = busy || !state.finalText;
  if (busy) els.reviewSection.querySelectorAll(".reroll").forEach((b) => (b.disabled = true));
}

function render() {
  renderFinal();
  renderSections();
  setBusy(false);
}

function renderFinal() {
  els.finalOutput.textContent = state.finalText;
  els.finalOutput.classList.toggle("placeholder", !state.finalText);

  els.footnotesList.innerHTML = "";
  state.finalNotes.forEach((note, i) => {
    const li = document.createElement("li");

    const num = document.createElement("span");
    num.className = "fn-num";
    num.textContent = `[${i + 1}]`;

    const input = document.createElement("input");
    input.className = "fn-input";
    input.value = note;
    input.placeholder = "Add clarification...";
    input.addEventListener("input", () => {
      state.finalNotes[i] = input.value;
    });

    const del = document.createElement("button");
    del.className = "fn-del";
    del.textContent = "\u00d7";
    del.title = "Delete footnote";
    del.addEventListener("click", () => deleteFootnote(i));

    li.append(num, input, del);
    els.footnotesList.appendChild(li);
  });

  els.footnotesHint.style.display = state.finalNotes.length ? "none" : "block";
}

function renderSections() {
  els.reviewSection.hidden = state.sections.length === 0;
  els.sections.innerHTML = "";

  state.sections.forEach((s, i) => {
    const card = document.createElement("div");
    card.className = "section" + (s.error ? " failed" : "");

    const head = document.createElement("div");
    head.className = "section-head";
    const title = document.createElement("span");
    title.textContent = `Section ${i + 1} of ${state.sections.length}`;
    const btn = document.createElement("button");
    btn.className = "reroll";
    btn.textContent = "Re-roll";
    btn.disabled = isBusy;
    btn.addEventListener("click", () => reRollSection(s.id));
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
    srcText.textContent = s.source;
    srcCol.append(srcLabel, srcText);

    const dstCol = document.createElement("div");
    dstCol.className = "col";
    const dstLabel = document.createElement("div");
    dstLabel.className = "col-label";
    dstLabel.textContent = "Translation";
    const dstText = document.createElement("div");
    dstText.className = "text";
    if (s.error) dstText.classList.add("error-text");
    dstText.textContent = s.error || markLocalFootnotes(s);
    dstCol.append(dstLabel, dstText);

    cols.append(srcCol, dstCol);
    card.append(head, cols);

    if (s.footnotes.length) {
      const ol = document.createElement("ol");
      ol.className = "sec-notes";
      s.footnotes.forEach((fn) => {
        if (fn && typeof fn.note === "string" && fn.note) {
          const li = document.createElement("li");
          li.textContent = fn.note;
          ol.appendChild(li);
        }
      });
      card.appendChild(ol);
    }

    els.sections.appendChild(card);
  });
}

function markLocalFootnotes(s) {
  return resolveMarkers(s.translation, s.footnotes, 1).text;
}

function rebuildAfterDelete(text, markers, idx) {
  let out = "";
  let prev = 0;
  const outMarkers = [];
  for (let i = 0; i < markers.length; i++) {
    const off = markers[i];
    const len = String(i + 1).length + 2;
    out += text.slice(prev, off);
    if (i === idx) {
      prev = off + len;
      continue;
    }
    const newNum = i < idx ? i + 1 : i;
    outMarkers.push(out.length);
    out += `[${newNum}]`;
    prev = off + len;
  }
  out += text.slice(prev);
  return { text: out, markers: outMarkers };
}

function deleteFootnote(idx) {
  const text = state.finalText;
  const markers = state.finalMarkers;
  const notesBefore = state.finalNotes.length;

  // Content check on tracked offsets; a hand-edited literal `[n]` landing exactly
  // on a stale offset could still pass
  const verified =
    markers.length === notesBefore &&
    markers.every((off, i) => {
      const m = `[${i + 1}]`;
      return text.slice(off, off + m.length) === m;
    });

  if (verified) {
    const rebuilt = rebuildAfterDelete(text, markers, idx);
    state.finalText = rebuilt.text;
    state.finalMarkers = rebuilt.markers;
  } else {
    state.finalMarkers = [];
  }

  state.finalNotes.splice(idx, 1);
  state.finalEdited = true;
  renderFinal();
}

function addFootnote() {
  els.finalOutput.focus();
  const num = state.finalNotes.length + 1;
  const marker = `[${num}]`;
  insertAtCursor(els.finalOutput, marker);
  state.finalText = readFinalText();
  state.finalMarkers = [];
  state.finalNotes.push("");
  state.finalEdited = true;
  renderFinal();
  const inputs = els.footnotesList.querySelectorAll(".fn-input");
  const last = inputs[inputs.length - 1];
  if (last) last.focus();
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
  // innerText (not textContent) so contenteditable <br>/block elements map to newlines.
  // Strip a single trailing newline from the browser's trailing <br> artifact.
  return els.finalOutput.innerText.replace(/\n$/, "");
}

function getSnapshot() {
  state.finalText = readFinalText();
  const notesText = state.finalNotes
    .map((n, i) => `[${i + 1}] ${n}`)
    .join("\n");
  return {
    text: state.finalText,
    plain: state.finalText + (notesText ? "\n\nFootnotes:\n" + notesText : ""),
    notesText,
  };
}

async function copyResult() {
  const { plain } = getSnapshot();
  try {
    await navigator.clipboard.writeText(plain);
    els.status.textContent = "Copied to clipboard.";
  } catch {
    els.status.textContent = "Copy failed.";
  }
}

function exportResult(kind) {
  const { plain, text, notesText } = getSnapshot();
  if (kind === "md") {
    const md =
      text.replace(/\[(\d+)\]/g, "[^$1]") +
      (notesText ? "\n\n" + notesText.replace(/^\[(\d+)\] /gm, "[^$1]: ") : "");
    download("translation.md", md, "text/markdown");
  } else {
    download("translation.txt", plain, "text/plain");
  }
  els.status.textContent = "Exported.";
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

init();

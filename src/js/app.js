import { runPipeline, rerollSegment, runReconcile, assemble } from "./pipeline.js";
import { sourceOptions, targetOptions } from "./languages.js";
import { download, scanMarkers, rebuildAfterDelete } from "./util.js";
import { DEFAULT_MODEL } from "./engine.js";
import { draftOptions } from "./mtdraft.js";
import { renderAll, setStatus, setStatusError } from "./render.js";
import { KEYS, getStored, setStored, removeStored } from "./store.js";
import { TranslationMemory } from "./tm.js";

const els = {
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
  status: document.getElementById("status"),
};

const state = {
  segments: [],
  tokens: [],
  finalText: "",
  finalNotes: [],
  finalMarkers: [],
  finalEdited: false,
  activeSource: "",
};

const actions = { deleteFootnote, reroll };

const memory = new TranslationMemory();

let controller = null;
let isBusy = false;

function init() {
  populateSelect(els.sourceLang, sourceOptions());
  populateSelect(els.targetLang, targetOptions());
  populateSelect(els.draftSource, [{ value: "none", label: "None (LLM literal draft)" }, ...draftOptions()]);
  populateSelect(els.register, [
    { value: "auto", label: "Default register" },
    { value: "formal", label: "Formal" },
    { value: "informal", label: "Informal" },
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
  els.finalPass.addEventListener("change", () =>
    setStored(KEYS.finalPass, els.finalPass.checked ? "1" : "")
  );
  els.protectNames.addEventListener("change", () =>
    setStored(KEYS.protectNames, els.protectNames.checked ? "1" : "")
  );
  els.faithful.addEventListener("change", () =>
    setStored(KEYS.faithful, els.faithful.checked ? "1" : "")
  );

  els.apiKey.addEventListener("input", () => {
    if (els.rememberKey.checked) setStored(KEYS.apiKey, els.apiKey.value.trim());
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
    faithful: els.faithful.checked,
  };
}

function getSourceSelection() {
  const el = els.source;
  if (
    el.selectionStart !== undefined &&
    el.selectionEnd !== undefined &&
    el.selectionStart !== el.selectionEnd
  ) {
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
      memory,
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
        `Partially translated — ${done}/${state.segments.length} segment(s) done; ${failed} failed (${result.error.message || String(result.error)}).`
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
          signal: controller.signal,
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
        failed
          ? `Done — ${failed} of ${state.segments.length} segment(s) failed${note}.`
          : `Done — ${state.segments.length} segment(s) translated${scope}${note}.`
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
          signal: controller.signal,
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
  const verified =
    offsets.length === state.finalNotes.length &&
    offsets.every((off, i) => text.slice(off, off + String(i + 1).length + 2) === `[${i + 1}]`);

  if (verified) {
    const rebuilt = rebuildAfterDelete(text, offsets, idx);
    state.finalText = rebuilt.text;
    state.finalMarkers = rebuilt.offsets;
  } else {
    const n = idx + 1;
    state.finalText = text
      .replace(new RegExp(`\\[${n}\\](?!\\d)`), "")
      .replace(/\[(\d+)\]/g, (m, d) => (Number(d) > n ? `[${Number(d) - 1}]` : m));
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
    notesText,
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
    const md =
      toMarkdown(text, state.finalMarkers, state.finalNotes) +
      (notesText ? "\n\n" + notesText.replace(/^\[(\d+)\] /gm, "[^$1]: ") : "");
    download("translation.md", md, "text/markdown");
  } else {
    download("translation.txt", plain, "text/plain");
  }
  setStatus(els, "Exported.");
}

function toMarkdown(text, offsets, notes) {
  const verified =
    offsets.length === notes.length &&
    offsets.every((off, i) => text.slice(off, off + String(i + 1).length + 2) === `[${i + 1}]`);
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

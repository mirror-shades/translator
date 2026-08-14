import { escapeHtml } from "./util.js";
import { segmentText } from "./pipeline.js";

function languageName(code) {
  try {
    if (typeof Intl !== "undefined" && Intl.DisplayNames) {
      return new Intl.DisplayNames(["en"], { type: "language" }).of(code) || code;
    }
  } catch {
    /* ignore */
  }
  return code;
}

export function setStatus(els, text) {
  els.status.textContent = text;
}

export function setStatusError(els, text) {
  els.status.innerHTML = `<span class="error">${escapeHtml(text)}</span>`;
}

export function renderAll(els, state, isBusy, actions) {
  renderFinal(els, state, actions);
  renderSegments(els, state, isBusy, actions);
  setBusy(els, isBusy, !!state.finalText);
}

export function setBusy(els, busy, hasResult) {
  els.translateBtn.disabled = busy;
  els.stopBtn.hidden = !busy;
  els.addFootnoteBtn.disabled = busy || !hasResult;
  els.copyBtn.disabled = busy || !hasResult;
  els.exportTxtBtn.disabled = busy || !hasResult;
  els.exportMdBtn.disabled = busy || !hasResult;
  els.sections.querySelectorAll(".reroll").forEach((b) => (b.disabled = busy));
}

export function renderFinal(els, state, actions) {
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
    del.addEventListener("click", () => actions.deleteFootnote(i));

    li.append(num, input, del);
    els.footnotesList.appendChild(li);
  });

  els.footnotesHint.style.display = state.finalNotes.length ? "none" : "block";
}

export function renderSegments(els, state, isBusy, actions) {
  els.reviewSection.hidden = state.segments.length === 0;
  els.sections.innerHTML = "";

  state.segments.forEach((seg, i) => {
    const card = document.createElement("div");
    card.className = "section" + (seg.status === "error" ? " failed" : "");

    const head = document.createElement("div");
    head.className = "section-head";
    const title = document.createElement("span");
    const bits = [`Segment ${i + 1} of ${state.segments.length}`];
    if (seg.detectedLang) bits.push(languageName(seg.detectedLang));
    if (seg.fromMemory) bits.push("cached");
    title.textContent = bits.join(" · ");
    const btn = document.createElement("button");
    btn.className = "reroll";
    btn.textContent = "Re-roll";
    btn.disabled = isBusy;
    btn.addEventListener("click", () => actions.reroll(seg.id));
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
    dstText.textContent = seg.status === "error" ? seg.error || "Failed" : segmentText(seg, state.tokens);
    dstCol.append(dstLabel, dstText);

    if (seg.status === "ok" && seg.glossaryMisses.length) {
      const warn = document.createElement("div");
      warn.className = "warn";
      warn.textContent =
        "Check glossary term(s): " +
        seg.glossaryMisses
          .map((g) => `"${g.tgt}"` + (g.note ? ` — ${g.note}` : ""))
          .join("; ");
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

    els.sections.appendChild(card);
  });
}

export const FOOTNOTE_MARKER_RE = /⟨(\d+)⟩/g;

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function parseJson(content) {
  const cleaned = String(content || "")
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
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

export function isRetryable(err) {
  if (err && err.name === "AbortError") return false;
  if (err && typeof err.status === "number") return err.status === 429 || err.status >= 500;
  return true;
}

export async function withRetry(fn, { attempts = 3, baseDelay = 1000, onRetry } = {}) {
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

export async function mapConcurrent(items, limit, worker) {
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

export function chunkItems(items, measure, maxSize) {
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

export function stripMarkers(text) {
  return String(text).replace(FOOTNOTE_MARKER_RE, "");
}

export function scanMarkers(text) {
  const out = [];
  const re = /\[(\d+)\]/g;
  let m;
  while ((m = re.exec(text))) out.push({ offset: m.index, number: Number(m[1]) });
  return out;
}

export function rebuildAfterDelete(text, offsets, idx) {
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

export function resolveMarkers(translation, footnotes, startNum = 1) {
  const notes = (Array.isArray(footnotes) ? footnotes : [])
    .filter((fn) => fn && typeof fn.note === "string" && fn.note)
    .map((fn) => fn.note);

  const spots = [];
  const re = new RegExp(FOOTNOTE_MARKER_RE.source, "g");
  let m;
  while ((m = re.exec(translation))) spots.push({ index: m.index, end: re.lastIndex });

  let text = "";
  const markers = [];
  let n = startNum;
  let cursor = 0;
  let assigned = 0;

  for (const spot of spots) {
    text += translation.slice(cursor, spot.index);
    if (notes[assigned] !== undefined) {
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

export function download(filename, content, type) {
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

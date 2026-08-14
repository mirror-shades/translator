export function parseGlossary(text) {
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

export function glossaryPrompt(entries) {
  if (!entries.length) return "";
  return entries
    .map((g) => `- "${g.src}"${g.hint ? ` (${g.hint})` : ""} → "${g.tgt}"`)
    .join("\n");
}

const TOKEN_RE = /⟪(\d+)⟫/g;

const BASE_PATTERNS = [
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
  { re: /\b\d+\.\d+\b/g },
];

function nameRegex(name) {
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const lead = /^\w/.test(name) ? "\\b" : "";
  const tail = /\w$/.test(name) ? "\\b" : "";
  return new RegExp(lead + esc + tail, "g");
}

export function protect(text, { markers = null, names = [] } = {}) {
  const tokens = [];
  const patterns = [...BASE_PATTERNS];
  for (const name of [...names].sort((a, b) => b.length - a.length)) {
    patterns.push({ re: nameRegex(name) });
  }
  if (markers) patterns.push({ re: markers });

  const stash = (match) => {
    const id = tokens.length;
    tokens.push(match);
    return `⟪${id}⟫`;
  };

  let masked = String(text);
  for (const { re } of patterns) {
    masked = masked.replace(re, stash);
  }
  return { masked, tokens };
}

export function restore(text, tokens) {
  return String(text).replace(TOKEN_RE, (m, idStr) => {
    const id = Number(idStr);
    return tokens && id < tokens.length ? tokens[id] : m;
  });
}

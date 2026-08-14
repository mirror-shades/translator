let segmenterCache = null;
let segmenterTried = false;

function segmenter() {
  if (!segmenterTried) {
    segmenterTried = true;
    segmenterCache =
      typeof Intl !== "undefined" && Intl.Segmenter
        ? new Intl.Segmenter(undefined, { granularity: "sentence" })
        : null;
  }
  return segmenterCache;
}

const ABBREV_RE = /(?:Mr|Mrs|Ms|Mx|Dr|Prof|St|Jr|Sr|Rev|Hon|Gen|Sen|Rep|Gov|Capt|Lt|Sgt|Col|etc|e\.g|i\.e|vs|viz|cf|al|no|vol|ed|p|pp|fig|sec|dept|assn|inc|ltd|co|corp|approx)\.$/i;

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

export function splitIntoSentences(text) {
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

export function segmentDocument(text) {
  const paragraphs = String(text)
    .split(/\r?\n+/)
    .map((p) => p.trim())
    .filter(Boolean);
  const segments = [];
  for (let p = 0; p < paragraphs.length; p++) {
    splitIntoSentences(paragraphs[p]).forEach((sentence, i) => {
      segments.push({ source: sentence, paragraphBreak: i === 0 && p > 0 });
    });
  }
  return segments;
}

// Paragraph-preserving chunker, mirroring the original winning loop: keep each
// paragraph as a single chunk up to maxLen; split only paragraphs longer than
// maxLen, by sentence, keeping the paragraph break on its first sub-chunk.
export function chunkByParagraphs(text, maxLen = 1500) {
  const paragraphs = String(text)
    .split(/\r?\n+/)
    .map((p) => p.trim())
    .filter(Boolean);
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

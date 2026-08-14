export const WRITING_SYSTEMS = {
  latin: {
    id: "latin",
    name: "Latin",
    direction: "ltr",
    segmentation: "spaced",
    shaping: "none",
    protectCharset: null,
  },
  cyrillic: {
    id: "cyrillic",
    name: "Cyrillic",
    direction: "ltr",
    segmentation: "spaced",
    shaping: "none",
    protectCharset: null,
  },
};

export const LANGUAGES = [
  {
    code: "en",
    name: "English",
    writingSystem: "latin",
    features: { case: false, wordOrder: "SVO" },
    variants: [
      { code: "en", name: "English", locale: { quotes: { open: "\u201C", close: "\u201D" } } },
    ],
  },
  {
    code: "fr",
    name: "French",
    writingSystem: "latin",
    features: { case: false, gender: ["m", "f"], formality: ["tu", "vous"], wordOrder: "SVO" },
    variants: [
      { code: "fr", name: "French", locale: { quotes: { open: "«", close: "»" } } },
    ],
  },
  {
    code: "es",
    name: "Spanish",
    writingSystem: "latin",
    features: { case: false, gender: ["m", "f"], formality: ["tú", "usted"], wordOrder: "SVO" },
    variants: [
      { code: "es", name: "Spanish (Spain)", locale: { quotes: { open: "«", close: "»" } } },
    ],
  },
  {
    code: "pt",
    name: "Portuguese",
    writingSystem: "latin",
    features: { case: false, gender: ["m", "f"], wordOrder: "SVO" },
    variants: [
      { code: "pt-BR", name: "Portuguese (Brazil)", locale: { quotes: { open: "\"", close: "\"" }, formality: ["você", "o senhor / a senhora"] } },
      { code: "pt-PT", name: "Portuguese (Portugal)", locale: { quotes: { open: "«", close: "»" }, formality: ["tu", "você"] } },
    ],
  },
  {
    code: "de",
    name: "German",
    writingSystem: "latin",
    features: { case: 4, gender: ["m", "f", "n"], formality: ["du", "Sie"], wordOrder: "V2 (SOV in subordinate clauses)" },
    variants: [
      { code: "de", name: "German", locale: { quotes: { open: "„", close: "“" } } },
    ],
  },
  {
    code: "ru",
    name: "Russian",
    writingSystem: "cyrillic",
    features: { case: 6, gender: ["m", "f", "n"], formality: ["ты", "вы"], wordOrder: "free (SVO default)" },
    variants: [
      { code: "ru", name: "Russian", locale: { quotes: { open: "«", close: "»" } } },
    ],
  },
  {
    code: "la",
    name: "Latin",
    writingSystem: "latin",
    features: {
      case: "6–7",
      gender: ["m", "f", "n"],
      formality: ["tu", "vos"],
      wordOrder: "free (SOV default)",
      notes: "classical dead language; use established classical usage, paraphrase modern concepts or footnote them",
    },
    variants: [
      { code: "la", name: "Latin", locale: { quotes: { open: "\"", close: "\"" } } },
    ],
  },
];

const byVariant = new Map();
for (const language of LANGUAGES) {
  for (const variant of language.variants) byVariant.set(variant.code, { language, variant });
}

export function resolveTarget(code) {
  return byVariant.get(code) || null;
}

export function targetOptions() {
  const out = [];
  for (const language of LANGUAGES) {
    for (const variant of language.variants) out.push({ value: variant.code, label: variant.name });
  }
  return out;
}

export function sourceOptions() {
  const out = [{ value: "auto", label: "Auto-detect" }];
  for (const language of LANGUAGES) {
    for (const variant of language.variants) out.push({ value: variant.code, label: variant.name });
  }
  return out;
}

export function languageBrief(language, variant, register) {
  const ws = WRITING_SYSTEMS[language.writingSystem];
  const lines = [`Target: ${variant.name} (${language.name}, ${ws.name} script).`];
  const f = language.features;
  const formality =
    variant.locale && variant.locale.formality ? variant.locale.formality : f.formality;
  if (f.case) lines.push(`- case system: ${f.case}`);
  if (f.gender && f.gender.length) lines.push(`- grammatical gender: ${f.gender.join("/")}`);
  if (formality && formality.length) lines.push(`- formality (T/V): ${formality.join("/")}`);
  if (f.wordOrder) lines.push(`- word order: ${f.wordOrder}`);
  if (f.notes) lines.push(`- note: ${f.notes}`);
  if (variant.locale) {
    const parts = [];
    const q = variant.locale.quotes;
    if (q) parts.push(`quotes ${q.open}…${q.close}`);
    if (variant.locale.preferredAddress) parts.push(`preferred address "${variant.locale.preferredAddress}"`);
    if (parts.length) lines.push(`Locale: ${parts.join(", ")}.`);
  }
  if (register && register !== "auto" && formality && formality.length) {
    const idx = register === "formal" ? formality.length - 1 : 0;
    lines.push(`Register: ${register} — use "${formality[idx]}" form of address consistently.`);
  }
  return lines.join("\n");
}

const GTX_URL = "https://translate.googleapis.com/translate_a/single";

function gtxLanguage(code) {
  if (code === "pt-BR" || code === "pt-PT") return "pt";
  return code;
}

export async function googleGtxDraft({ source, sourceLang, targetLang, signal }) {
  const params = new URLSearchParams({
    client: "gtx",
    sl: sourceLang && sourceLang !== "auto" ? gtxLanguage(sourceLang) : "auto",
    tl: gtxLanguage(targetLang),
    dt: "t",
    q: source,
  });
  const resp = await fetch(`${GTX_URL}?${params}`, { signal });
  if (!resp.ok) throw new Error(`Google Translate error (${resp.status})`);
  const data = await resp.json();
  const segments = Array.isArray(data) && Array.isArray(data[0]) ? data[0] : [];
  const text = segments.map((s) => (Array.isArray(s) ? s[0] : "")).join("");
  if (!text) throw new Error("Google Translate returned no translation.");
  const detectedLang = typeof data[2] === "string" ? data[2] : "";
  return { text, detectedLang };
}

// Draft providers: each entry is a source→target string translation function with
// signature ({ source, sourceLang, targetLang, signal }) => Promise<{ text, detectedLang }>.
// Adding a better MT service means adding one entry here and exposing it in
// draftOptions(); the pipeline is unchanged.
export const DRAFT_PROVIDERS = {
  google: { id: "google", label: "Google Translate (gtx)", draft: googleGtxDraft },
};

export function getDraftProvider(id) {
  return DRAFT_PROVIDERS[id] ? DRAFT_PROVIDERS[id].draft : null;
}

export function draftOptions() {
  return Object.values(DRAFT_PROVIDERS).map(({ id, label }) => ({ value: id, label }));
}

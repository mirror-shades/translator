export const KEYS = {
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
  faithful: "translator.faithful",
};

export function getStored(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v;
  } catch {
    return fallback;
  }
}

export function setStored(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

export function removeStored(key) {
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

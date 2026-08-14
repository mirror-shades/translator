const STORAGE_KEY = "translator.tm";
const MAX_ENTRIES = 500;

export class TranslationMemory {
  constructor(storage) {
    this.entries = new Map();
    this.storage = storage || (typeof localStorage !== "undefined" ? localStorage : null);
    this.load();
  }

  load() {
    if (!this.storage) return;
    try {
      const raw = this.storage.getItem(STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (Array.isArray(data)) {
        for (const [key, value] of data) this.entries.set(key, value);
      }
    } catch {
      /* ignore corrupt or unavailable storage */
    }
  }

  save() {
    if (!this.storage) return;
    try {
      this.storage.setItem(STORAGE_KEY, JSON.stringify(Array.from(this.entries.entries())));
    } catch {
      /* quota exceeded or storage unavailable */
    }
  }

  get(key) {
    return this.entries.get(key);
  }

  set(key, value) {
    this.entries.delete(key);
    this.entries.set(key, value);
    while (this.entries.size > MAX_ENTRIES) {
      const oldest = this.entries.keys().next().value;
      this.entries.delete(oldest);
    }
    this.save();
  }
}

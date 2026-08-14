import { parseJson } from "./util.js";

const DEEPSEEK_URL = "https://api.deepseek.com/chat/completions";
const REQUEST_TIMEOUT_MS = 120000;

export const DEFAULT_MODEL = "deepseek-v4-flash";

// Engine providers: each entry maps a provider id to a factory taking (settings)
// and returning an object with translate({ system, user, signal }).
// Adding a better LLM means adding one entry here; callers get the engine via
// createEngine() and never construct a specific class.
const ENGINE_PROVIDERS = {
  deepseek: ({ apiKey, model }) => new DeepSeekEngine({ apiKey, model: model || DEFAULT_MODEL }),
};

export function createEngine(settings) {
  const id = settings.engine || "deepseek";
  const factory = ENGINE_PROVIDERS[id];
  if (!factory) throw new Error(`Unknown engine provider: ${id}`);
  return factory(settings);
}

export function engineOptions() {
  return [{ value: "deepseek", label: "DeepSeek" }];
}

function abortWithTimeout(signal, ms) {
  const controller = new AbortController();
  const onAbort = () => controller.abort(signal.reason);
  const timer = setTimeout(() => controller.abort(new DOMException("Request timed out", "TimeoutError")), ms);
  if (signal) {
    if (signal.aborted) {
      controller.abort(signal.reason);
      clearTimeout(timer);
    } else {
      signal.addEventListener("abort", onAbort, { once: true });
    }
  }
  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timer);
      if (signal) signal.removeEventListener("abort", onAbort);
    },
  };
}

export class DeepSeekEngine {
  constructor({ apiKey, model }) {
    this.apiKey = apiKey;
    this.model = model || DEFAULT_MODEL;
  }

  async translate({ system, user, signal }) {
    if (!this.apiKey) {
      const err = new Error("DeepSeek API key is required.");
      err.status = 400;
      throw err;
    }

    const request = abortWithTimeout(signal, REQUEST_TIMEOUT_MS);
    try {
      const resp = await fetch(DEEPSEEK_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          temperature: 0.3,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
        }),
        signal: request.signal,
      });

      if (!resp.ok) {
        const text = await resp.text();
        const err = new Error(`DeepSeek error (${resp.status}): ${text}`);
        err.status = resp.status;
        throw err;
      }

      const data = await resp.json();
      return parseJson(data.choices?.[0]?.message?.content || "");
    } finally {
      request.dispose();
    }
  }
}

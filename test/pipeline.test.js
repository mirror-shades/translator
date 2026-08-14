import test from "node:test";
import assert from "node:assert/strict";
import { assemble, segmentText, runPipeline, runReconcile, MAX_CALL_CHARS } from "../src/js/pipeline.js";
import { TranslationMemory } from "../src/js/tm.js";

const settings = {
  apiKey: "x",
  model: "deepseek-v4-flash",
  sourceLang: "auto",
  targetLang: "es",
  register: "auto",
  glossary: "",
  finalPass: false,
  protectNames: false,
};

test("assemble joins segments, renumbers footnotes, and reports marker offsets", () => {
  const segs = [
    { status: "ok", translation: "A ⟨1⟩", footnotes: [{ note: "x" }], paragraphBreak: false },
    { status: "ok", translation: "B ⟨1⟩", footnotes: [{ note: "y" }], paragraphBreak: true },
    { status: "error", translation: "", footnotes: [], paragraphBreak: false },
  ];
  const { text, notes, markers } = assemble(segs, []);
  assert.equal(text, "A [1]\n\nB [2]");
  assert.deepEqual(notes, ["x", "y"]);
  assert.deepEqual(markers, [2, 9]);
});

test("segmentText resolves markers", () => {
  const seg = { status: "ok", translation: "Hola ⟨1⟩", footnotes: [{ note: "n" }] };
  assert.equal(segmentText(seg, []), "Hola [1]");
});

test("runPipeline translates segments and reports detected language", async () => {
  global.fetch = async () => ({
    ok: true,
    json: async () => ({
      choices: [{ message: { content: JSON.stringify({ translation: "Hola", footnotes: [], language: "en" }) } }],
    }),
  });
  const r = await runPipeline({ sourceText: "Hello world.", settings });
  assert.equal(r.aborted, false);
  assert.equal(r.segments.length, 1);
  assert.equal(r.segments[0].status, "ok");
  assert.equal(r.segments[0].translation, "Hola");
  assert.equal(r.segments[0].detectedLang, "en");
  delete global.fetch;
});

test("runPipeline returns partial results when aborted", async () => {
  global.fetch = async () => {
    throw Object.assign(new Error("aborted"), { name: "AbortError" });
  };
  const controller = new AbortController();
  controller.abort();
  const r = await runPipeline({ sourceText: "A. B. C.", settings, signal: controller.signal });
  assert.equal(r.aborted, true);
  assert.equal(r.segments.length, 3);
  for (const seg of r.segments) {
    assert.equal(seg.status, "error");
  }
  delete global.fetch;
});

test("runPipeline returns partial results on non-abort failure", async () => {
  global.fetch = async () => ({
    ok: true,
    json: async () => ({
      choices: [{ message: { content: JSON.stringify({ translation: "T", footnotes: [], language: "en" }) } }],
    }),
  });
  const r = await runPipeline({
    sourceText: "A. B. C. D. E. F.",
    settings,
    onProgress: () => {
      throw new Error("boom");
    },
  });
  assert.equal(r.aborted, false);
  assert.ok(r.error instanceof Error);
  assert.equal(r.segments.length, 6);
  assert.ok(r.segments.some((s) => s.status === "ok"));
  delete global.fetch;
});

test("runReconcile falls back to the draft when the pass fails", async () => {
  const segments = [{ status: "ok", translation: "Hola", footnotes: [], paragraphBreak: false, masked: "Hello" }];
  global.fetch = async () => ({ ok: false, status: 400, text: async () => "bad request" });
  const r = await runReconcile({ sourceText: "Hello.", segments, tokens: [], settings });
  assert.equal(r.skipped, false);
  assert.equal(r.text, "Hola");
  delete global.fetch;
});

test("runPipeline reuses translation memory", async () => {
  let calls = 0;
  global.fetch = async () => {
    calls++;
    return {
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({ translation: "Hola", footnotes: [], language: "en" }) } }],
      }),
    };
  };
  const memory = new TranslationMemory(null);
  await runPipeline({ sourceText: "Hi.", settings, memory });
  await runPipeline({ sourceText: "Hi.", settings, memory });
  assert.equal(calls, 1);
  delete global.fetch;
});

test("runPipeline bounds name extraction into chunks", async () => {
  const nerBodies = [];
  global.fetch = async (_url, opts) => {
    const body = JSON.parse(opts.body);
    const system = body.messages[0].content;
    if (system.includes("named-entity extractor")) {
      nerBodies.push(body.messages[1].content);
      return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ names: [] }) } }] }) };
    }
    return {
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({ translation: "T", footnotes: [], language: "en" }) } }],
      }),
    };
  };

  const source = "Alpha beta gamma delta epsilon. ".repeat(1500);
  await runPipeline({ sourceText: source, settings: { ...settings, protectNames: true } });

  assert.ok(nerBodies.length > 1);
  for (const body of nerBodies) {
    assert.ok(body.length < MAX_CALL_CHARS + 100);
  }
  delete global.fetch;
});

test("runPipeline skips name extraction for caseless text", async () => {
  let nerCalls = 0;
  global.fetch = async (_url, opts) => {
    const body = JSON.parse(opts.body);
    if (body.messages[0].content.includes("named-entity extractor")) nerCalls++;
    return {
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({ translation: "T", footnotes: [], language: "en" }) } }],
      }),
    };
  };
  await runPipeline({ sourceText: "hello world.", settings: { ...settings, protectNames: true } });
  assert.equal(nerCalls, 0);
  delete global.fetch;
});

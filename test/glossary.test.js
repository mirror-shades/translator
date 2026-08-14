import test from "node:test";
import assert from "node:assert/strict";
import { parseGlossary, glossaryPrompt } from "../src/js/glossary.js";

test("parses plain, parenthesized, and bracketed hints", () => {
  assert.deepEqual(parseGlossary("Schadenfreude = malicious joy"), [
    { src: "Schadenfreude", tgt: "malicious joy", hint: null },
  ]);
  assert.deepEqual(parseGlossary("bank (finance) = banque"), [
    { src: "bank", tgt: "banque", hint: "finance" },
  ]);
  assert.deepEqual(parseGlossary("bank [river] = rive"), [
    { src: "bank", tgt: "rive", hint: "river" },
  ]);
});

test("ignores malformed and blank lines", () => {
  assert.deepEqual(parseGlossary("not a glossary line\n\nbank = banque"), [
    { src: "bank", tgt: "banque", hint: null },
  ]);
});

test("glossaryPrompt includes hints", () => {
  const prompt = glossaryPrompt(parseGlossary("bank (finance) = banque"));
  assert.equal(prompt, '- "bank" (finance) → "banque"');
});

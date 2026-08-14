import test from "node:test";
import assert from "node:assert/strict";
import { resolveTarget, targetOptions, sourceOptions, languageBrief } from "../src/js/languages.js";

test("resolveTarget resolves variants and rejects unknown codes", () => {
  const t = resolveTarget("pt-BR");
  assert.equal(t.variant.name, "Portuguese (Brazil)");
  assert.equal(t.language.writingSystem, "latin");
  assert.equal(resolveTarget("xx"), null);
});

test("resolveTarget resolves English as a target", () => {
  const t = resolveTarget("en");
  assert.equal(t.variant.name, "English");
  assert.equal(t.language.writingSystem, "latin");
});

test("targetOptions lists all seven languages' variants", () => {
  assert.equal(targetOptions().length, 8);
});

test("sourceOptions lists English exactly once", () => {
  const en = sourceOptions().filter((o) => o.value === "en");
  assert.equal(en.length, 1);
});

test("languageBrief maps register to the formal and informal forms", () => {
  const t = resolveTarget("de");
  assert.ok(languageBrief(t.language, t.variant, "formal").includes('use "Sie"'));
  assert.ok(languageBrief(t.language, t.variant, "informal").includes('use "du"'));
});

test("Portuguese formality comes from the variant, not the language", () => {
  const t = resolveTarget("pt-BR");
  assert.equal(t.language.features.formality, undefined);
  assert.ok(languageBrief(t.language, t.variant, "formal").includes('use "o senhor / a senhora"'));
});

import test from "node:test";
import assert from "node:assert/strict";
import { TranslationMemory } from "../src/js/tm.js";

function fakeStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, v),
    removeItem: (k) => map.delete(k),
  };
}

test("get/set round-trips", () => {
  const tm = new TranslationMemory(fakeStorage());
  tm.set("a", { translation: "1" });
  tm.set("b", { translation: "2" });
  assert.deepEqual(tm.get("a"), { translation: "1" });
  assert.equal(tm.get("missing"), undefined);
});

test("evicts the oldest entry beyond the cap", () => {
  const tm = new TranslationMemory(fakeStorage());
  for (let i = 0; i <= 500; i++) tm.set("k" + i, { translation: String(i) });
  assert.equal(tm.entries.size, 500);
  assert.equal(tm.get("k0"), undefined);
  assert.deepEqual(tm.get("k500"), { translation: "500" });
});

test("persists entries across instances", () => {
  const storage = fakeStorage();
  const a = new TranslationMemory(storage);
  a.set("x", { translation: "hello" });
  const b = new TranslationMemory(storage);
  assert.deepEqual(b.get("x"), { translation: "hello" });
});

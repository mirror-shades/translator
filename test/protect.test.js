import test from "node:test";
import assert from "node:assert/strict";
import { protect, restore } from "../src/js/protect.js";

test("round-trips protected tokens", () => {
  const src = "Visit https://example.com or a@b.com. Use {{name}} and `code` and 10kg.";
  const { masked, tokens } = protect(src);
  assert.equal(restore(masked, tokens), src);
  assert.ok(!masked.includes("example.com"));
  assert.ok(!masked.includes("a@b.com"));
});

test("masks names and preserves names inside URLs", () => {
  const src = "John Smith works at Microsoft. See https://example.com/JohnSmith.";
  const { masked, tokens } = protect(src, { names: ["John Smith", "Microsoft"] });
  assert.equal(restore(masked, tokens), src);
  assert.ok(!masked.includes("John Smith"));
  assert.ok(!masked.includes("Microsoft"));
});

test("protects decimals, IPv4, and ISO dates", () => {
  const src = "IP 192.168.1.1, date 2024-01-01, pi 3.14.";
  const { masked, tokens } = protect(src);
  assert.equal(restore(masked, tokens), src);
  assert.ok(!masked.includes("192.168.1.1"));
  assert.ok(!masked.includes("2024-01-01"));
});

test("round-trips a literal placeholder in the source", () => {
  const src = "price ⟪0⟫ is 10kg";
  const { masked, tokens } = protect(src);
  assert.equal(restore(masked, tokens), src);
});

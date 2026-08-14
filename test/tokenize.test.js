import test from "node:test";
import assert from "node:assert/strict";
import { splitIntoSentences, segmentDocument } from "../src/js/tokenize.js";

test("splitIntoSentences handles abbreviations and decimals", () => {
  const parts = splitIntoSentences("Mr. Smith bought 3.5 kg of apples. He left.");
  assert.equal(parts.length, 2);
  assert.ok(parts[0].includes("Mr. Smith bought 3.5 kg"));
  assert.ok(parts[1].includes("He left"));
});

test("segmentDocument marks paragraph breaks on the first sentence of later paragraphs", () => {
  const segs = segmentDocument("Hello world.\n\nSecond para. More here.");
  assert.equal(segs.length, 3);
  assert.equal(segs[0].paragraphBreak, false);
  assert.equal(segs[1].paragraphBreak, true);
  assert.equal(segs[2].paragraphBreak, false);
  assert.equal(segs[1].source, "Second para.");
});

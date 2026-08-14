import test from "node:test";
import assert from "node:assert/strict";
import { parseJson, isRetryable, withRetry, mapConcurrent, resolveMarkers, chunkItems, scanMarkers, rebuildAfterDelete } from "../src/js/util.js";

test("parseJson strips code fences", () => {
  assert.deepEqual(parseJson('```json\n{"a":1}\n```'), { a: 1 });
});

test("parseJson extracts JSON amid prose", () => {
  assert.deepEqual(parseJson('here is {"x": 2} ok'), { x: 2 });
});

test("parseJson throws on garbage", () => {
  assert.throws(() => parseJson("no json here"));
});

test("isRetryable", () => {
  assert.equal(isRetryable({ name: "AbortError" }), false);
  assert.equal(isRetryable({ status: 429 }), true);
  assert.equal(isRetryable({ status: 503 }), true);
  assert.equal(isRetryable({ status: 400 }), false);
  assert.equal(isRetryable(new Error("network")), true);
});

test("withRetry retries transient errors then succeeds", async () => {
  let calls = 0;
  const value = await withRetry(
    async () => {
      if (++calls < 3) {
        const e = new Error("transient");
        e.status = 500;
        throw e;
      }
      return "ok";
    },
    { baseDelay: 1 }
  );
  assert.equal(value, "ok");
  assert.equal(calls, 3);
});

test("withRetry stops on non-retryable", async () => {
  let calls = 0;
  await assert.rejects(
    () =>
      withRetry(
        async () => {
          calls++;
          const e = new Error("bad");
          e.status = 400;
          throw e;
        },
        { baseDelay: 1 }
      ),
    /bad/
  );
  assert.equal(calls, 1);
});

test("withRetry does not retry aborts", async () => {
  let calls = 0;
  await assert.rejects(
    () =>
      withRetry(
        async () => {
          calls++;
          throw Object.assign(new Error("aborted"), { name: "AbortError" });
        },
        { baseDelay: 1 }
      )
  );
  assert.equal(calls, 1);
});

test("mapConcurrent respects the limit and completes all items", async () => {
  let active = 0;
  let max = 0;
  const results = await mapConcurrent([1, 2, 3, 4, 5], 2, async (n) => {
    active++;
    max = Math.max(max, active);
    await new Promise((r) => setTimeout(r, 1));
    active--;
    return n * 2;
  });
  assert.deepEqual(results, [2, 4, 6, 8, 10]);
  assert.equal(max, 2);
});

test("resolveMarkers maps markers to notes by order of appearance", () => {
  const r = resolveMarkers("x ⟨1⟩ y ⟨3⟩ z", [{ note: "A" }, { note: "B" }, { note: "C" }], 1);
  assert.equal(r.text, "x [1] y [2] z [3]");
  assert.deepEqual(r.notes, ["A", "B", "C"]);
});

test("resolveMarkers appends trailing markers for unreferenced notes", () => {
  const r = resolveMarkers("only ⟨1⟩ here", [{ note: "A" }, { note: "B" }], 1);
  assert.equal(r.text, "only [1] here [2]");
  assert.deepEqual(r.notes, ["A", "B"]);
});

test("resolveMarkers drops extra markers with no note", () => {
  const r = resolveMarkers("a ⟨1⟩ b ⟨2⟩ c", [{ note: "X" }], 1);
  assert.equal(r.text, "a [1] b  c");
  assert.deepEqual(r.notes, ["X"]);
});

test("chunkItems packs items under the budget", () => {
  const chunks = chunkItems(["a", "b", "c", "d", "e"], (s) => s.length, 2);
  assert.deepEqual(chunks, [["a", "b"], ["c", "d"], ["e"]]);
});

test("scanMarkers finds bracket markers with offsets and numbers", () => {
  assert.deepEqual(scanMarkers("a [1] b [12] c"), [
    { offset: 2, number: 1 },
    { offset: 8, number: 12 },
  ]);
});

test("rebuildAfterDelete removes the target marker and renumbers", () => {
  const { text, offsets } = rebuildAfterDelete("A [1] B [2] C [3]", [2, 8, 14], 1);
  assert.equal(text, "A [1] B  C [2]");
  assert.deepEqual(offsets, [2, 11]);
});

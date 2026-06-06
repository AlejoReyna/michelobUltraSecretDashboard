import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import test from "node:test";
import { decisionSchema } from "../src/schemas.js";
import { parseJsonlLines, readJsonlFile } from "../src/jsonl.js";

test("parseJsonlLines validates JSONL and skips malformed records", () => {
  const result = parseJsonlLines(
    [
      JSON.stringify({ timestamp: "2026-06-05T00:00:00Z", action: "WAIT" }),
      "{not json",
      JSON.stringify({ timestamp: "2026-06-05T00:01:00Z", action: "SELL" }),
      JSON.stringify({ timestamp: "2026-06-05T00:02:00Z", action: "ENTER", symbol: "BNB" }),
    ],
    decisionSchema,
  );

  assert.equal(result.items.length, 2);
  assert.equal(result.errors.length, 2);
  assert.equal(result.items.at(-1)?.action, "ENTER");
});

test("readJsonlFile returns the latest requested validated entries", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "cascade-jsonl-"));
  const file = path.join(dir, "decision_log.jsonl");
  const lines = [
    { timestamp: "2026-06-05T00:00:00Z", action: "WAIT" },
    { timestamp: "2026-06-05T00:05:00Z", action: "BLOCKED" },
    { timestamp: "2026-06-05T00:10:00Z", action: "ENTER", symbol: "CAKE" },
  ].map((line) => JSON.stringify(line));

  await writeFile(file, `${lines.join("\n")}\n`, "utf8");

  const result = await readJsonlFile(file, decisionSchema, 2);

  assert.deepEqual(result.items.map((item) => item.action), ["BLOCKED", "ENTER"]);
  assert.equal(result.errors.length, 0);
});

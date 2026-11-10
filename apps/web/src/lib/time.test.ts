import test from "node:test";
import assert from "node:assert/strict";
import { freshness, manilaTime } from "./time.ts";

test("shows recent points as live and older points as last known", () => {
  const now = new Date("2026-11-10T08:00:00Z");
  assert.equal(freshness("2026-11-10T07:57:00Z", now), "Live");
  assert.equal(freshness("2026-11-10T07:54:59Z", now), "Last known");
});

test("formats timestamps in Manila time", () => {
  assert.match(manilaTime("2026-11-10T08:00:00Z"), /Nov 10, 2026.*4:00 PM/);
});

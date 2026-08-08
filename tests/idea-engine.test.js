const test = require("node:test");
const assert = require("node:assert/strict");
const engine = require("../idea-engine.js");

test("Idea Engine only accepts research-only v1 payloads", () => {
  assert.equal(engine.safePayload({ schema_version: "idea-engine-v1", research_only: true, candidates: [] }).candidates.length, 0);
  assert.equal(engine.safePayload({ schema_version: "idea-engine-v1", research_only: false, candidates: [] }), null);
});

test("status labels are Chinese and blocked is safe", () => {
  assert.equal(engine.gradeLabel("A"), "深入研究");
  assert.equal(engine.gradeLabel("blocked"), "阻断");
});

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

test("blocked provider and immature Shadow remain isolated from DCA", () => {
  const elements = { status: { textContent: "" }, maturity: { textContent: "" }, rows: { innerHTML: "" } };
  engine.render({ schema_version: "idea-engine-v1", research_only: true, status: "blocked", candidates: [] }, elements, {});
  assert.match(elements.status.textContent, /不影响本周定投/);
  assert.match(elements.maturity.textContent, /不会自动进入定投决策/);
});

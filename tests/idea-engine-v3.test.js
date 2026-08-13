const test = require("node:test");
const assert = require("node:assert/strict");
const engine = require("../idea-engine.js");

test("v3 payload is accepted while non-research payloads are rejected", () => {
  const payload = engine.safePayload({ schema_version: "idea-engine-v3", research_only: true, candidates: [] });
  assert.equal(payload.source_version, "v3");
  assert.equal(engine.safePayload({ schema_version: "idea-engine-v3", research_only: false, candidates: [] }), null);
});

test("v3 statuses, filters and sorting stay Chinese and deterministic", () => {
  assert.equal(engine.gradeLabel("A_RESEARCH"), "A级 · 深入研究");
  assert.equal(engine.gradeLabel("VALUATION_GATED"), "估值受限");
  const rows = [
    { ticker: "A", status: "B_WATCH", sector: "半导体", research_type: "QUALITY_COMPOUNDER", portfolio_fit_status: "UNKNOWN", confidence_score: 70, composite_score: 60 },
    { ticker: "B", status: "A_RESEARCH", sector: "软件", research_type: "CATALYST", portfolio_fit_status: "DIVERSIFIER", confidence_score: 90, composite_score: 80 }
  ];
  assert.deepEqual(engine.filterCandidates(rows, { status: "A_RESEARCH" }).map((item) => item.ticker), ["B"]);
  assert.deepEqual(engine.sortCandidates(rows, "confidence").map((item) => item.ticker), ["B", "A"]);
  assert.equal(engine.formatScore(82.6457), "82.6");
});

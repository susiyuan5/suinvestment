const test = require("node:test");
const assert = require("node:assert/strict");
const engine = require("../idea-engine.js");

test("v3 payload is accepted while non-research payloads are rejected", () => {
  const payload = engine.safePayload({ schema_version: "idea-engine-v3", research_only: true, candidates: [] });
  assert.equal(payload.source_version, "v3");
  assert.equal(engine.safePayload({ schema_version: "idea-engine-v3", research_only: false, candidates: [] }), null);
  const v31 = engine.safePayload({ schema_version: "idea-engine-v3.1", research_only: true, candidates: [] });
  assert.equal(v31.source_version, "v3_1");
});

test("v3 statuses, filters and sorting stay Chinese and deterministic", () => {
  assert.equal(engine.gradeLabel("A_RESEARCH"), "A级 · 深入研究");
  assert.equal(engine.gradeLabel("VALUATION_GATED"), "估值受限");
  const rows = [
    { ticker: "A", status: "B_WATCH", sector: "半导体", research_type: "QUALITY_COMPOUNDER", portfolio_fit_status: "UNKNOWN", evidence_independence_score: 70, composite_score: 60 },
    { ticker: "B", status: "A_RESEARCH", sector: "软件", research_type: "CATALYST", portfolio_fit_status: "DIVERSIFIER", evidence_independence_score: 90, composite_score: 80 }
  ];
  assert.deepEqual(engine.filterCandidates(rows, { status: "A_RESEARCH" }).map((item) => item.ticker), ["B"]);
  assert.deepEqual(engine.sortCandidates(rows, "independence").map((item) => item.ticker), ["B", "A"]);
  assert.equal(engine.formatScore(82.6457), "82.6");
});

test("research grade and short-term state stay separate", () => {
  assert.equal(engine.gradeLabel("B_WATCH"), "B级 · 研究观察");
  assert.equal(engine.workflowLabel("EARNINGS_REVIEW"), "建议复核财报与电话会");
  assert.equal(engine.rejectionLabel("free_source_scope_limited"), "免费数据限制：缺少一致预期、电话会或事件催化证据");
  const coverage = engine.coverageDetails({ evidence_coverage_score: 100, evidence_independence_score: 66.666667, evidence: [{ lineage_group: "ISSUER_DISCLOSURE" }, { lineage_group: "MARKET_PRICE" }], data_quality: { missing_fields: ["analyst_consensus", "earnings_transcript", "news_catalyst"] } });
  assert.equal(coverage.dimension, "100.0");
  assert.equal(coverage.critical, "40.0");
  assert.deepEqual(coverage.missing, ["一致预期", "电话会", "事件证据"]);
});

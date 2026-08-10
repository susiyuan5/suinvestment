const test = require("node:test");
const assert = require("node:assert/strict");
const engine = require("../idea-engine.js");

test("Idea Engine only accepts research-only v1 payloads", () => {
  assert.equal(engine.safePayload({ schema_version: "idea-engine-v1", research_only: true, candidates: [] }).candidates.length, 0);
  assert.equal(engine.safePayload({ schema_version: "idea-engine-v1", research_only: false, candidates: [] }), null);
});

test("status labels are Chinese and blocked is safe", () => {
  assert.equal(engine.gradeLabel("A"), "A级 · 深入研究");
  assert.equal(engine.gradeLabel("blocked"), "已阻断 · 暂停研究");
  assert.equal(engine.gradeLabel("B"), "B级 · 研究观察");
  assert.equal(engine.formatScore(82.6457), "82.6");
  assert.equal(engine.formatScore(61.323284), "61.3");
});

test("free-data limitation and empty detail rows are explicit", () => {
  const candidate = { status: "B", data_quality: { missing_fields: ["analyst_consensus", "earnings_transcript", "news_catalyst"], gates_failed: ["no_consensus_estimates"] }, what_makes_investable: ["有财务证据"], what_kills_thesis: [] };
  assert.equal(engine.limitation(candidate), "免费数据缺少一致预期、电话会、事件证据，仅限研究观察。");
  assert.deepEqual(engine.detailSections(candidate).map((item) => item.title), ["入选理由", "尚缺证据"]);
});

test("only safe HTTPS evidence links are exposed", () => {
  const links = engine.safeEvidenceLinks({ evidence: [{ source: "SEC", url: "https://www.sec.gov/a" }, { source: "内部", url: "javascript:alert(1)" }] });
  assert.deepEqual(links, [{ source: "SEC", url: "https://www.sec.gov/a" }]);
});

test("blocked provider and immature Shadow remain isolated from DCA", () => {
  const elements = { status: { textContent: "" }, maturity: { textContent: "" }, rows: { innerHTML: "" } };
  engine.render({ schema_version: "idea-engine-v1", research_only: true, status: "blocked", candidates: [] }, elements, {});
  assert.match(elements.status.textContent, /不影响本周定投/);
  assert.match(elements.maturity.textContent, /不会自动进入定投决策/);
});

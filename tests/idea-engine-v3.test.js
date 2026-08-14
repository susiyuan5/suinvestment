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

test("normalized robust score preserves real zero values and sorts on the displayed scale", () => {
  assert.equal(engine.robustScore({ robust_score_normalized: 72.4, robust_score_raw: 48.5, robust_score_ceiling: 67 }), 72.4);
  assert.equal(engine.robustScore({ composite_score: 71.7, leave_one_dimension_out_floor: 38.7, leave_one_source_out_floor: 0 }), 0);
  assert.match(engine.robustScoreExplanation({ robust_score_normalized: 72.4, robust_score_raw: 48.5, robust_score_ceiling: 67 }), /72.4\/100/);
  assert.match(engine.robustScoreExplanation({ robust_score_normalized: 72.4, robust_score_raw: 48.5, robust_score_ceiling: 67 }), /不是上涨概率/);
  assert.match(engine.robustScoreExplanation({ robust_score_normalized: 0, robust_score_raw: 0, robust_score_ceiling: 67, leave_one_source_out_floor: 0 }), /依赖单一证据来源/);
  const rows = [
    { ticker: "LOW", robust_score_normalized: 0, leave_one_source_out_floor: 60 },
    { ticker: "HIGH", robust_score_normalized: 80, leave_one_source_out_floor: 10 }
  ];
  assert.deepEqual(engine.sortCandidates(rows, "robust").map((item) => item.ticker), ["HIGH", "LOW"]);
});

test("research grade and short-term state stay separate", () => {
  assert.equal(engine.gradeLabel("B_WATCH"), "B级 · 研究观察");
  assert.equal(engine.workflowLabel("EARNINGS_REVIEW"), "建议复核财报与电话会");
  assert.equal(engine.rejectionLabel("free_source_scope_limited"), "免费数据限制：缺少一致预期、电话会或事件催化证据");
  const coverage = engine.coverageDetails({ evidence_coverage_score: 100, evidence_independence_score: 66.666667, evidence: [{ lineage_group: "ISSUER_DISCLOSURE" }, { lineage_group: "MARKET_PRICE" }], data_quality: { missing_fields: ["analyst_consensus", "earnings_transcript", "news_catalyst"] } });
  assert.equal(coverage.dimension, "100.0");
  assert.equal(coverage.critical, "40.0");
  assert.equal(coverage.independent, "66.7");
  assert.equal(coverage.independentCount, 2);
  assert.equal(coverage.independentTarget, 3);
  assert.deepEqual(coverage.missing, ["一致预期", "电话会", "事件证据"]);
});

test("homepage strategy summary stays compact and preserves three independent states", () => {
  const rows = engine.compactStrategyRows({ strategies: [
    { strategy_id: "oneil_volume_breakout", label: "策略一：放量突破", status: "waiting" },
    { strategy_id: "trend_pullback", label: "策略二：趋势回踩", status: "historical_edge_failed" },
    { strategy_id: "vcp_darvas_breakout", label: "策略三：VCP／箱体突破", status: "blocked" }
  ] });
  assert.deepEqual(rows.map((row) => [row.label, row.status_label]), [["放量突破", "等待"], ["趋势回踩", "历史未通过"], ["VCP／箱体突破", "阻断"]]);
  assert.equal(engine.compactStrategyRows({ strategies: [] }).length, 0);
});

test("research limitations, thesis risks and Chinese metadata stay separate", () => {
  const candidate = { first_rejection: "free_source_scope_limited", gates_failed: ["free_source_scope_limited", "model_not_calibrated"], what_kills_thesis: ["收入或经营利润同比转负"] };
  assert.equal(engine.sectorLabel("semiconductors"), "半导体");
  assert.equal(engine.researchTypeLabel("CYCLICAL_RECOVERY"), "周期复苏");
  assert.deepEqual(engine.researchLimitations(candidate), ["免费数据限制：缺少一致预期、电话会或事件催化证据", "完整模型尚未实时校准；候选已使用历史 OOS 参考"]);
  assert.deepEqual(engine.thesisKillRisks(candidate), ["收入或经营利润同比转负"]);
});

test("Shadow reliability progress uses report requirements", () => {
  const progress = engine.shadowProgress({ observation_count: 1, calendar_week_count: 1, primary_complete_count: 0, reliability_requirements: { observation_count: 52, calendar_week_count: 52, primary_complete_count: 26 } });
  assert.equal(progress, "Shadow 校准进度：观察 1/52 次 · 日历周 1/52 · 完整成熟结果 0/26");
});

test("historical OOS drives research sorting while Shadow remains monitoring only", () => {
  const payload = {
    schema_version: "historical-oos-price-timing-v1",
    research_only: true,
    no_trade: true,
    scope: "price_timing_layer_only",
    composite_score_calibrated: false,
    current_mappings: {
      A: { evidence_status: "no_historical_edge", timing_score: 90, mean_oos_net_relative_return: -0.01 },
      B: { evidence_status: "positive_skew_unconfirmed", timing_score: 70, mean_oos_net_relative_return: 0.01 },
      C: { evidence_status: "preliminary_reliable_edge", timing_score: 60, mean_oos_net_relative_return: 0.005 }
    }
  };
  const rows = ["A", "B", "C"].map(ticker => ({ ticker, composite_score: 50, historical_oos_reference: engine.historicalReference(ticker, payload) }));
  assert.deepEqual(engine.sortCandidates(rows, "historical").map(row => row.ticker), ["C", "B", "A"]);
  assert.equal(engine.historicalScreenSummary(payload), "历史 OOS 已用于候选排序：初步通过 1 只 · 正收益偏度待确认 1 只");
});

test("historical OOS is accepted only as a separate no-trade price-timing layer", () => {
  const payload = {
    schema_version: "historical-oos-price-timing-v1",
    research_only: true,
    no_trade: true,
    scope: "price_timing_layer_only",
    composite_score_calibrated: false,
    current_mappings: {
      TSM: {
        calibration_bin: 3,
        oos_samples: 975,
        oos_origin_dates: 63,
        oos_cost_adjusted_hit_rate: 0.4226,
        oos_hit_rate_ci_low: 0.3436,
        oos_hit_rate_ci_high: 0.506,
        mean_oos_net_relative_return: -0.01397,
        evidence_status: "no_historical_edge"
      }
    }
  };
  assert.equal(engine.safeHistoricalOos(payload), payload);
  assert.equal(engine.safeHistoricalOos({ ...payload, composite_score_calibrated: true }), null);
  const details = engine.historicalOosDetails("tsm", payload);
  assert.match(details.text, /永久留出 975 个样本、63 个独立周/);
  assert.match(details.text, /命中率 42.3%/);
  assert.match(details.text, /未形成历史优势/);
  assert.match(details.boundary, /不校验综合分/);
  assert.match(details.boundary, /幸存者偏差/);
});

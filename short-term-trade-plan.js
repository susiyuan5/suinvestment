(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(typeof globalThis !== "undefined" ? globalThis : root);
  else root.ShortTermTradePlan = factory(root);
})(typeof self !== "undefined" ? self : this, function (root) {
  "use strict";
  var statuses = { conditional_review: "\u6761\u4ef6\u6ee1\u8db3\uff0c\u5f85\u4eba\u5de5\u786e\u8ba4", preliminary_review: "初步门禁通过，仅可人工研究", manual_review_ready: "\u6761\u4ef6\u6ee1\u8db3\uff0c\u5f85\u4eba\u5de5\u786e\u8ba4", simulation_only: "\u4ec5\u7814\u7a76\u6f14\u7ec3", waiting_trigger: "\u7b49\u5f85\u89e6\u53d1", waiting_breakout: "\u7b49\u5f85\u7a81\u7834", waiting_pullback: "等待回踩", chase_blocked: "\u5df2\u8d85\u8fc7\u8ffd\u9ad8\u4e0a\u9650", event_blocked: "\u8d22\u62a5\u98ce\u9669\u963b\u65ad", invalidated: "\u4fe1\u53f7\u5df2\u5931\u6548", blocked: "\u6570\u636e\u963b\u65ad" };
  statuses.historical_review = "\u5386\u53f2 OOS \u5df2\u901a\u8fc7\uff0c\u53ef\u4eba\u5de5\u7814\u7a76";
  statuses.historical_watch = "\u5386\u53f2 OOS \u521d\u6b65\u4e3a\u6b63\uff0c\u4ec5\u4f9b\u89c2\u5bdf";
  function finite(value) { var number = Number(value); return Number.isFinite(number) ? number : null; }
  var supportedSchemas = ["short-term-trade-plan-v1", "short-term-trade-plan-v1.1", "short-term-trade-plan-v1.2", "short-term-trade-plan-v1.3"];
  function safePayload(payload) { return payload && supportedSchemas.indexOf(payload.schema_version) >= 0 && payload.research_only === true && payload.no_trade === true && Array.isArray(payload.plans) ? payload : null; }
  function statusLabel(status) { return statuses[status] || "仅作人工复核"; }
  var reasonLabels = { short_term_daily_bars_unavailable: "缺少经过验证的日线 OHLCV 数据", common_trading_date_alignment_insufficient: "股票与 QQQ 的共同交易日不足", stale_price_data: "\u884c\u60c5\u6570\u636e\u5df2\u8fc7\u671f", future_data_detected: "\u68c0\u6d4b\u5230\u672a\u6765\u6570\u636e", event_date_unknown: "\u4e8b\u4ef6\u65e5\u671f\u672a\u77e5\uff0c\u4ec5\u53ef\u7814\u7a76\u6f14\u7ec3", earnings_date_unknown: "\u8d22\u62a5\u65e5\u671f\u672a\u77e5\uff0c\u4ec5\u53ef\u7814\u7a76\u6f14\u7ec3", earnings_blackout_3_trading_days: "\u4e34\u8fd1\u8d22\u62a5\u7a97\u53e3", qqq_market_state_blocked: "QQQ \u5e02\u573a\u72b6\u6001\u95e8\u7981\u672a\u901a\u8fc7", relative_qqq_gate_failed: "\u76f8\u5bf9 QQQ \u8868\u73b0\u95e8\u7981\u672a\u901a\u8fc7", trend_template_failed: "趋势模板尚未通过", no_trigger: "尚未满足突破或回踩条件", invalid_stop_structure: "止损结构无效", risk_distance_out_of_bounds: "止损距离超出风险规则", sizing_inputs_missing: "\u7f3a\u5c11\u8d44\u4ea7\u3001\u73b0\u91d1\u6216\u6c47\u7387\u4fe1\u606f", idea_status_not_eligible: "\u7814\u7a76\u7b49\u7ea7\u4e0d\u6ee1\u8db3\u77ed\u7ebf\u7b5b\u9009\u95e8\u69db", historical_screen_not_eligible: "研究等级未达标，且历史 OOS 候选资格不足", valuation_gate_not_eligible: "估值／预期门禁未通过，暂不进入短线候选", exposure_not_proven: "业务受益关系尚未得到证据验证", research_candidate_rejected: "研究候选已被否决", evidence_threshold_not_met: "\u5173\u952e\u8bc1\u636e\u8986\u76d6\u4e0d\u8db3", insufficient_price_history: "\u4ef7\u683c\u5386\u53f2\u4e0d\u8db3", insufficient_daily_ohlcv_history: "日线 OHLCV 历史不足", invalid_atr: "\u6ce2\u52a8\u6307\u6807\u65e0\u6548" };
  function reasonLabel(code) { var key = String(code || ""); if (/^[A-Z0-9.-]+:rows_missing$/i.test(key)) return key.split(":")[0].toUpperCase() + " 日线数据缺失"; if (/^[A-Z0-9.-]+:insufficient_daily_history$/i.test(key)) return key.split(":")[0].toUpperCase() + " 日线历史不足"; return reasonLabels[key] || "需要人工复核的研究条件"; }
  function prioritizedReasons(plan) {
    var priority = ["future_data_detected", "short_term_daily_bars_unavailable", "stale_price_data", "qqq_market_state_blocked", "relative_qqq_gate_failed", "earnings_blackout_3_trading_days", "risk_distance_out_of_bounds", "trend_template_failed", "no_trigger", "event_date_unknown", "earnings_date_unknown"];
    var codes = Array.from(new Set(Array.isArray(plan && plan.reason_codes) ? plan.reason_codes : []));
    return codes.sort(function (left, right) { var a = priority.indexOf(left), b = priority.indexOf(right); return (a < 0 ? priority.length : a) - (b < 0 ? priority.length : b); });
  }
  function planSummary(plan) { var reasons = prioritizedReasons(plan); var blocked = ["blocked", "event_blocked", "chase_blocked", "invalidated"].indexOf(String(plan && plan.status || "")) >= 0; return reasons.length ? (blocked ? "主要阻断：" : "当前条件：") + reasonLabel(reasons[0]) : "当前没有额外阻断原因"; }
  function eligibilityLabel(plan) {
    var eligibility = plan && plan.research_eligibility || {};
    if (eligibility.mode === "historical_screen_override") return "历史 OOS 候选通道（原研究等级 " + (eligibility.research_grade || "C_SCREEN") + "）";
    if (eligibility.mode === "research_grade") return "研究等级门禁（" + (eligibility.research_grade || "A/B") + "）";
    return "尚未满足短线筛选资格";
  }
  function normalizeRows(value) { var rows = Array.isArray(value) ? value : value && (value.rows || value.points || value.data) || []; return rows.map(function (row) { var close = finite(row && row.close); return close !== null && close > 0 ? { date: String(row.date || row.time || ""), high: finite(row.high) || close, low: finite(row.low) || close, close: close, volume: finite(row.volume) } : null; }).filter(Boolean); }
  function sma(values, period) { return values.length < period ? null : values.slice(-period).reduce(function (sum, value) { return sum + value; }, 0) / period; }
  function ema(values, period) { if (values.length < period) return null; var result = values.slice(0, period).reduce(function (sum, value) { return sum + value; }, 0) / period; var multiplier = 2 / (period + 1); values.slice(period).forEach(function (value) { result = (value - result) * multiplier + result; }); return result; }
  function atr(rows, period) { if (rows.length < period + 1) return null; var ranges = rows.map(function (row, index) { var previous = rows[index - 1] ? rows[index - 1].close : row.close; return Math.max(row.high - row.low, Math.abs(row.high - previous), Math.abs(row.low - previous)); }); return ranges.slice(-period).reduce(function (sum, value) { return sum + value; }, 0) / period; }
  function computeIndicators(rows, benchmarkRows, config) {
    var stock = normalizeRows(rows), benchmark = normalizeRows(benchmarkRows); if (stock.length < 55 || benchmark.length < 21) throw new Error("insufficient_price_history");
    var closes = stock.map(function (row) { return row.close; }), qqq = benchmark.map(function (row) { return row.close; }), currentAtr = atr(stock, config && config.indicators && config.indicators.atr_period || 14); if (!currentAtr || !Number.isFinite(currentAtr)) throw new Error("invalid_atr");
    function change(values, period) { return values.length <= period ? null : values[values.length - 1] / values[values.length - period - 1] - 1; }
    var sr5 = change(closes, 5), sr20 = change(closes, 20), qr5 = change(qqq, 5), qr20 = change(qqq, 20); if ([sr5, sr20, qr5, qr20].some(function (value) { return value === null; })) throw new Error("insufficient_benchmark_history");
    var averageVolume = stock.slice(-21, -1).map(function (row) { return row.volume; }).filter(function (value) { return value !== null; }); averageVolume = averageVolume.length === 20 ? averageVolume.reduce(function (sum, value) { return sum + value; }, 0) / 20 : null;
    return { signal_date: stock[stock.length - 1].date, current_close: closes[closes.length - 1], atr14: currentAtr, sma10: sma(closes, 10), sma20: sma(closes, 20), sma50: sma(closes, 50), ema10: ema(closes, 10), ema20: ema(closes, 20), ema50: ema(closes, 50), prior20_high: Math.max.apply(Math, stock.slice(-21, -1).map(function (row) { return row.high; })), recent10_low: Math.min.apply(Math, stock.slice(-10).map(function (row) { return row.low; })), stock_return_5: sr5, stock_return_20: sr20, qqq_return_5: qr5, qqq_return_20: qr20, relative_return_5: sr5 - qr5, relative_return_20: sr20 - qr20, volume_ratio: averageVolume && stock[stock.length - 1].volume !== null ? stock[stock.length - 1].volume / averageVolume : 0, distance_sma20_atr: (closes[closes.length - 1] - sma(closes, 20)) / currentAtr, qqq_close_vs_sma20: qqq[qqq.length - 1] - sma(qqq, 20) };
  }
  function calculatePositionSize(totalAssets, cash, entry, stop, config, currentExperimentNotional, riskScale) { var assets = finite(totalAssets), available = finite(cash), price = finite(entry), stopPrice = finite(stop); if ([assets, available, price, stopPrice].some(function (value) { return value === null; }) || assets <= 0 || available <= 0 || price <= 0 || stopPrice >= price) return { shares: null, notional: 0, binding_constraint: "missing_assets_cash_or_fx", reason_codes: ["sizing_inputs_missing"] }; var scale = Math.max(0, Math.min(1, finite(riskScale) === null ? 1 : finite(riskScale))), perShare = price - stopPrice, riskBudget = assets * config.sizing.risk_budget_pct_assets * scale, maxNotional = Math.min(assets * config.sizing.maximum_notional_pct_assets * scale, assets * config.sizing.maximum_experiment_pct_assets - Number(currentExperimentNotional || 0), available), shares = Math.max(0, Math.floor(Math.min(riskBudget / perShare, maxNotional / price))); return { shares: shares, notional: shares * price, risk_per_share: perShare, risk_budget: riskBudget, risk_scale: scale, binding_constraint: "risk_or_notional_or_cash", reason_codes: shares ? [] : ["minimum_position_not_reached"] }; }
  function planForTicker(payload, ticker) { var safe = safePayload(payload); if (!safe) return null; return safe.plans.find(function (plan) { return String(plan.ticker).toUpperCase() === String(ticker).toUpperCase(); }) || null; }
  var modelLabels = { vcp_darvas_breakout: "VCP / 箱体放量突破", oneil_volume_breakout: "放量突破", trend_pullback: "强趋势回踩" };
  var regimeLabels = { green: "绿色（正常风险）", yellow: "黄色（风险减半）", red: "红色（停止新开仓）" };
  function modelLabel(value) { return modelLabels[String(value || "")] || "尚无有效触发模型"; }
  function passLabel(value) { return value === true ? "通过" : "未通过"; }
  function appendLine(body, doc, label, value, className) { var row = doc.createElement("p"); if (className) row.className = className; row.textContent = label + "：" + value; body.appendChild(row); }
  var selectionKey = "su-investment-pro:short-term-strategy-selections-v1";
  function loadSelections() { try { var value = root.localStorage && root.localStorage.getItem(selectionKey); return value ? JSON.parse(value) : {}; } catch (_) { return {}; } }
  function saveSelection(ticker, strategyId) { var values = loadSelections(); values[String(ticker || "").toUpperCase()] = strategyId; try { if (root.localStorage) root.localStorage.setItem(selectionKey, JSON.stringify(values)); } catch (_) {} return values; }
  function strategyStatusLabel(strategy) { return strategy && strategy.status_label || { waiting: "等待全部条件触发", historical_edge_failed: "已触发但历史优势未通过", historical_review: "历史 OOS 已通过，可人工研究", historical_watch: "历史 OOS 初步为正，仅供观察", triggered_simulation: "条件已触发，仅作模拟", preliminary_review: "初步门禁通过，仅可人工研究", conditional_review: "正式门禁通过，待人工复核", blocked: "研究条件阻断" }[strategy && strategy.status] || "仅作研究观察"; }
  function fixed(value) { return Number.isFinite(Number(value)) ? Number(value).toFixed(2) : "--"; }
  function conditionValue(item) {
    var value = item && item.current;
    if (!Number.isFinite(Number(value))) return value == null || value === "" ? "--" : String(value);
    var code = String(item.code || "");
    if (code.indexOf("relative_return") >= 0 || code.indexOf("contraction_pct") >= 0) return (Number(value) * 100).toFixed(2) + "%";
    if (code.indexOf("volume_ratio") >= 0) return Number(value).toFixed(2) + "x";
    return Number(value).toFixed(2);
  }
  function createStrategyCard(plan, strategy, doc, selectedId) {
    var card = doc.createElement("article"); card.className = "short-term-strategy-card" + (selectedId === strategy.strategy_id ? " is-selected" : "");
    var header = doc.createElement("div"); header.className = "short-term-strategy-header";
    var title = doc.createElement("h5"); title.textContent = strategy.label || modelLabel(strategy.strategy_id); header.appendChild(title);
    var badge = doc.createElement("span"); badge.className = "short-term-strategy-status status-" + String(strategy.status || "blocked"); badge.textContent = strategyStatusLabel(strategy); header.appendChild(badge); card.appendChild(header);
    var checks = Array.isArray(strategy.condition_checks) ? strategy.condition_checks : [];
    appendLine(card, doc, "条件进度", checks.filter(function (item) { return item.passed; }).length + " / " + checks.length + " 通过");
    appendLine(card, doc, "方向情景", "全部条件触发后观察上行延续；这不是上涨概率");
    var evidence = strategy.historical_oos || {};
    var oos = evidence.passed === true ? "通过" : "未通过或样本不足";
    if (Number.isFinite(Number(evidence.samples))) oos += " · 样本 " + evidence.samples;
    if (Number.isFinite(Number(evidence.cost_adjusted_hit_rate))) oos += " · 成本后相对 QQQ 命中 " + (Number(evidence.cost_adjusted_hit_rate) * 100).toFixed(1) + "%";
    appendLine(card, doc, "策略历史 OOS", oos, evidence.passed === true ? "" : "short-term-plan-warning");
    var signal = strategy.entry_plan;
    if (signal) {
      appendLine(card, doc, "触发参考价", fixed(signal.trigger_price));
      appendLine(card, doc, "计划入场区间", (signal.entry_range || []).map(fixed).join(" – "));
      appendLine(card, doc, "禁止追高价", fixed(signal.chase_limit));
      appendLine(card, doc, "失效／止损参考", fixed(signal.stop));
      appendLine(card, doc, "分段目标参考", (signal.targets || []).map(fixed).join(" / "));
    }
    var conditions = doc.createElement("details"); conditions.className = "short-term-strategy-conditions";
    var conditionSummary = doc.createElement("summary"); conditionSummary.textContent = "查看全部触发条件"; conditions.appendChild(conditionSummary);
    checks.forEach(function (item) { var row = doc.createElement("p"); row.className = item.passed ? "condition-pass" : "condition-wait"; row.textContent = (item.passed ? "✓ " : "○ ") + item.label + "｜当前 " + conditionValue(item) + "｜要求 " + item.required; conditions.appendChild(row); });
    card.appendChild(conditions);
    var choice = doc.createElement("label"); choice.className = "short-term-strategy-choice";
    var radio = doc.createElement("input"); radio.type = "radio"; radio.name = "short-term-strategy-" + plan.ticker; radio.value = strategy.strategy_id; radio.checked = selectedId === strategy.strategy_id; radio.disabled = strategy.research_selection_allowed !== true;
    radio.addEventListener("change", function () { if (!radio.checked) return; saveSelection(plan.ticker, strategy.strategy_id); var parent = card.parentNode; if (parent && parent.querySelectorAll) Array.prototype.forEach.call(parent.querySelectorAll(".short-term-strategy-card"), function (node) { node.classList.remove("is-selected"); }); card.classList.add("is-selected"); });
    choice.appendChild(radio); choice.appendChild(doc.createTextNode(" 选择为我的研究进场方案")); card.appendChild(choice);
    return card;
  }
  function createCardSection(plan, doc) {
    if (!plan) return null;
    var details = doc.createElement("details"); details.className = "short-term-plan-details";
    var summary = doc.createElement("summary"); summary.textContent = "查看短线研究计划（仅供人工复核）"; details.appendChild(summary);
    var body = doc.createElement("div"); body.className = "short-term-plan-body";
    appendLine(body, doc, "交易状态", statusLabel(plan.status), "short-term-plan-status");
    if (plan.research_eligibility) appendLine(body, doc, "短线筛选资格", eligibilityLabel(plan));
    appendLine(body, doc, "安全边界", "不生成订单、不进入本周定投；历史 OOS 用于当前筛选，Shadow 仅监测未来退化");
    if (plan.market_regime) appendLine(body, doc, "大盘环境", regimeLabels[plan.market_regime.state] || plan.market_regime.state);
    if (plan.trigger_models) {
      appendLine(body, doc, "趋势模板", passLabel(plan.trigger_models.trend_template));
      appendLine(body, doc, "VCP 收缩", passLabel(plan.trigger_models.vcp_contraction));
      appendLine(body, doc, "放量突破", passLabel(plan.trigger_models.volume_breakout));
      appendLine(body, doc, "趋势回踩", passLabel(plan.trigger_models.trend_pullback));
    }
    if (Array.isArray(plan.strategies) && plan.strategies.length) {
      var selectedId = loadSelections()[String(plan.ticker || "").toUpperCase()] || "";
      var heading = doc.createElement("h4"); heading.className = "short-term-strategy-title"; heading.textContent = "三种独立进场策略"; body.appendChild(heading);
      var note = doc.createElement("p"); note.className = "short-term-strategy-note"; note.textContent = "你可以保存一种研究偏好；选择不会生成订单，也不会改变模型结果。"; body.appendChild(note);
      var grid = doc.createElement("div"); grid.className = "short-term-strategy-grid"; plan.strategies.forEach(function (strategy) { grid.appendChild(createStrategyCard(plan, strategy, doc, selectedId)); }); body.appendChild(grid);
    }
    if (plan.historical_oos) {
      var evidence = plan.historical_oos.model_oos || {};
      var oosText = plan.historical_oos.passed === true ? "通过" : "未通过";
      if (Number.isFinite(Number(evidence.samples))) oosText += "（永久样本 " + evidence.samples + "）";
      appendLine(body, doc, "历史 OOS 门禁", oosText, plan.historical_oos.passed === true ? "" : "short-term-plan-warning");
      if (Number.isFinite(Number(evidence.cost_adjusted_hit_rate))) appendLine(body, doc, "成本后相对 QQQ 命中", (Number(evidence.cost_adjusted_hit_rate) * 100).toFixed(1) + "%（不是上涨概率）");
    }
    var blocked = ["blocked", "event_blocked", "chase_blocked", "invalidated"].indexOf(String(plan.status || "")) >= 0;
    prioritizedReasons(plan).forEach(function (code, index) { appendLine(body, doc, index === 0 ? (blocked ? "主要阻断" : "当前条件") : "其他条件", reasonLabel(code), "short-term-plan-reason"); });
    (plan.warnings || []).forEach(function (warning) { appendLine(body, doc, "数据说明", warning, "short-term-plan-warning"); });
    if (plan.signal) {
      [["研究模型", modelLabel(plan.signal.model)], ["信号日期", plan.signal.signal_date], ["参考收盘价", plan.signal.entry_reference], ["人工最早执行日", plan.signal.earliest_execution_date], ["入场区间", plan.signal.entry_range.map(function (value) { return Number(value).toFixed(2); }).join(" – ")], ["禁止追高价", Number(plan.signal.chase_limit).toFixed(2)], ["结构止损参考", Number(plan.signal.stop).toFixed(2)], ["目标位参考", plan.signal.targets.map(function (value) { return Number(value).toFixed(2); }).join(" / ")], ["最长研究持有", String((plan.signal.holding_window_days || [1, 20])[1]) + " 个交易日"]].forEach(function (row) { appendLine(body, doc, row[0], row[1]); });
    }
    details.appendChild(body); return details;
  }
  function renderDetail(plan, container, doc) { if (!container) return; container.innerHTML = ""; var section = createCardSection(plan, doc); if (section) { section.open = true; container.appendChild(section); } }
  return { finite: finite, safePayload: safePayload, statusLabel: statusLabel, reasonLabel: reasonLabel, prioritizedReasons: prioritizedReasons, planSummary: planSummary, eligibilityLabel: eligibilityLabel, normalizeRows: normalizeRows, sma: sma, ema: ema, atr: atr, computeIndicators: computeIndicators, calculatePositionSize: calculatePositionSize, modelLabel: modelLabel, strategyStatusLabel: strategyStatusLabel, conditionValue: conditionValue, loadSelections: loadSelections, saveSelection: saveSelection, planForTicker: planForTicker, createCardSection: createCardSection, renderDetail: renderDetail };
});

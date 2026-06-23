(function () {
    const paths = {
        review: "research/results/phase6q/phase6q-executive-review.json",
        candidates: "research/results/phase6q/shadow-candidate-review-table.csv",
        deferred: "research/results/phase6q/deferred-rejected-summary.csv",
        checklist: "research/results/phase6q/next-review-checklist.md",
        universe: "research/results/phase6j/universe-summary-38-vs-80.json",
        sector: "research/results/phase6j/sector-breakdown-38-vs-80.json",
        monitoring: "research/results/phase6o/monitoring-framework.json",
        removalRules: "research/results/phase6o/removal-rules.md",
        observation: "research/results/phase6s/shadow-observation-log.json",
        observationSummary: "research/results/phase6s/shadow-observation-summary.md",
        governance: "research/results/phase6s/shadow-observation-governance-report.json",
        governanceSummary: "research/results/phase6s/shadow-observation-governance-summary.md",
        historyManifest: "research/results/phase6s/history/shadow-observation-history-manifest.json",
        archiveValidation: "research/results/phase6s/history/shadow-observation-archive-validation-report.json",
        monthlyReview: "research/results/phase6s/shadow-monthly-review-report.json"
    };

    const state = {
        review: null,
        candidates: [],
        deferred: [],
        checklist: "",
        universe: null,
        sector: null,
        monitoring: null,
        removalRules: "",
        observation: null,
        observationSummary: "",
        governance: null,
        governanceSummary: "",
        historyManifest: null,
        archiveValidation: null,
        monthlyReview: null
    };

    function byId(id) {
        return document.getElementById(id);
    }

    function escapeHtml(value) {
        return String(value ?? "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    async function loadText(path) {
        const response = await fetch(path, { cache: "no-store" });
        if (!response.ok) {
            throw new Error("无法加载 " + path + "：" + response.status);
        }
        return response.text();
    }

    async function loadJson(path) {
        return JSON.parse(await loadText(path));
    }

    function parseCsv(text) {
        const rows = [];
        let row = [];
        let field = "";
        let quoted = false;

        for (let index = 0; index < text.length; index += 1) {
            const char = text[index];
            const next = text[index + 1];
            if (quoted) {
                if (char === '"' && next === '"') {
                    field += '"';
                    index += 1;
                } else if (char === '"') {
                    quoted = false;
                } else {
                    field += char;
                }
            } else if (char === '"') {
                quoted = true;
            } else if (char === ",") {
                row.push(field);
                field = "";
            } else if (char === "\n") {
                row.push(field);
                rows.push(row);
                row = [];
                field = "";
            } else if (char !== "\r") {
                field += char;
            }
        }
        if (field || row.length) {
            row.push(field);
            rows.push(row);
        }

        const [headers, ...body] = rows.filter((item) => item.length && item.some(Boolean));
        return body.map((item) => Object.fromEntries(headers.map((header, index) => [header, item[index] || ""])));
    }

    function renderFacts(target, facts) {
        var html = "<div class=\"facts\">";
        for (var i = 0; i < facts.length; i++) {
            var label = escapeHtml(facts[i][0]);
            var value = escapeHtml(facts[i][1]);
            var cls = facts[i][2] || "";
            html += "<div class=\"fact\"><span>" + label + "</span><strong";
            if (cls) { html += " class=\"" + cls + "\""; }
            html += ">" + value + "</strong></div>";
        }
        html += "</div>";
        target.innerHTML = html;
    }

    function renderExecutive() {
        var defaults = state.review.defaultState || {};
        var phase6j = state.review.phase6j || {};
        byId("active-count").textContent = defaults.activeUniverseCount || "38";
        byId("expanded-count").textContent = (defaults.expandedUniverseCount || 80) + " 仅研究用";
        byId("shadow-count").textContent = (defaults.shadowSymbolCount || 50) + " 仅影子用";
        byId("monitored-count").textContent = (defaults.monitoredSymbolCount || 12) + " 仅监控用";
        byId("activation-state").textContent = defaults.partialActivationDisabledByDefault ? "默认禁用" : "需要审查";

        renderFacts(byId("executive-summary"), [
            ["建议", state.review.executiveRecommendation, "warn"],
            ["Phase 6J 决策", phase6j.recommendation || "continue_research_80", "warn"],
            ["当前默认", defaults.activeUniverseCount + " 个标的", "ok"],
            ["扩展 80", "仅研究用"],
            ["影子 50", "仅影子用"],
            ["部分激活", defaults.partialActivationDisabledByDefault ? "已禁用" : "需要审查"],
            ["下一步要求", "在沙盘 UI 或实盘讨论之前需要人工审查"]
        ]);
    }

    function renderComparison() {
        var activeCategories = state.universe.activeCategoryCounts || {};
        var expandedCategories = state.universe.expandedCategoryCounts || {};
        var newCategories = Object.keys(expandedCategories).filter(function(key) { return !activeCategories[key]; });
        var entries = Object.entries(expandedCategories)
            .sort(function(a, b) { return b[1] - a[1]; })
            .slice(0, 6);
        var topExpanded = "";
        for (var ei = 0; ei < entries.length; ei++) {
            topExpanded += "<span class=\"pill\">" + escapeHtml(entries[ei][0]) + ": " + escapeHtml(entries[ei][1]) + "</span>";
        }

        byId("comparison-summary").innerHTML =
            "<div class=\"facts\">" +
            "<div class=\"fact\"><span>当前数量</span><strong>" + escapeHtml(state.universe.activeCount) + "</strong></div>" +
            "<div class=\"fact\"><span>扩展数量</span><strong>" + escapeHtml(state.universe.expandedCount) + "</strong></div>" +
            "<div class=\"fact\"><span>新增标的</span><strong>" + escapeHtml((state.universe.newSymbols || []).length) + "</strong></div>" +
            "<div class=\"fact\"><span>移除标的</span><strong>" + escapeHtml((state.universe.removedSymbols || []).length) + "</strong></div>" +
            "<div class=\"fact\"><span>新增类别覆盖</span><strong>" + escapeHtml(newCategories.join(", ") || "无") + "</strong></div>" +
            "</div>" +
            "<p class=\"muted\">扩展类别构成：</p>" +
            "<p>" + topExpanded + "</p>" +
            "<p class=\"muted\">扩展改善了行业平衡和候选多样性，但也增加了噪音，仍仅限研究用途。</p>";
    }

    function renderCandidates() {
        var tbody = byId("candidate-table").querySelector("tbody");
        var html = "";
        for (var ci = 0; ci < state.candidates.length; ci++) {
            var row = state.candidates[ci];
            html += "<tr>" +
                "<td><strong>" + escapeHtml(row.symbol) + "</strong></td>" +
                "<td>" + escapeHtml(row.sector_category) + "</td>" +
                "<td>" + escapeHtml(row.why_selected) + "</td>" +
                "<td>" + escapeHtml(row.factor_usefulness) + "</td>" +
                "<td>" + escapeHtml(row.regime_usefulness) + "</td>" +
                "<td>" + escapeHtml(row.risk_notes) + "</td>" +
                "<td>" + escapeHtml(row.monitoring_requirement) + "</td>" +
                "<td>" + escapeHtml(row.activation_readiness) + "</td>" +
                "<td>" + escapeHtml(row.rollback_trigger) + "</td>" +
                "</tr>";
        }
        tbody.innerHTML = html;
    }

    function renderDeferred() {
        var html = "";
        for (var di = 0; di < state.deferred.length; di++) {
            var row = state.deferred[di];
            html += "<section>" +
                "<h3>" + escapeHtml(row.group) + ": " + escapeHtml(row.symbol_count) + "</h3>" +
                "<p>" + escapeHtml(row.reason_summary) + "</p>" +
                "<p class=\"muted\">" + escapeHtml(row.top_categories || "该组无类别。") + "</p>" +
                "</section>";
        }
        byId("deferred-summary").innerHTML = html;
    }

    function renderRiskGates() {
        var risk = state.review.phase6m || {};
        renderFacts(byId("risk-gates"), [
            ["门控通过", risk.gate_passed, risk.gate_passed ? "ok" : "danger"],
            ["最大行业集中度", risk.max_sector_concentration],
            ["最大单标的风险敞口", risk.max_single_symbol_exposure],
            ["最低价格覆盖", risk.minimum_price_coverage_rows],
            ["12周波动率上限", risk.volatility_ceiling_12w],
            ["缺失价格回退", risk.missing_price_fallback],
            ["新标冷却期", risk.new_symbol_cooldown_weeks + " 周"],
            ["回滚基线", "当前 38 标的股票池"]
        ]);
    }

    function renderMonitoring() {
        var metrics = state.monitoring.metrics || [];
        var metricHtml = "";
        for (var mi = 0; mi < metrics.length; mi++) {
            metricHtml += "<li>" + escapeHtml(metrics[mi]) + "</li>";
        }
        byId("monitoring-framework").innerHTML =
            "<div class=\"facts\">" +
            "<div class=\"fact\"><span>状态</span><strong>" + escapeHtml(state.monitoring.status) + "</strong></div>" +
            "<div class=\"fact\"><span>审查节奏</span><strong>" + escapeHtml(state.monitoring.reviewCadence) + "</strong></div>" +
            "<div class=\"fact\"><span>标的</span><strong>" + escapeHtml((state.monitoring.symbols || []).join(", ")) + "</strong></div>" +
            "</div>" +
            "<p class=\"muted\">月审指标：</p>" +
            "<ul>" + metricHtml + "</ul>" +
            "<p class=\"muted\">" + escapeHtml(state.removalRules.replace(/^#.*\\n?/, "").trim()) + "</p>";
    }

    function renderChecklist() {
        var lines = state.checklist.split("\n");
        var html = "<ul>";
        for (var li = 0; li < lines.length; li++) {
            var line = lines[li].trim();
            if (line.startsWith("- [ ]")) {
                html += "<li>" + escapeHtml(line.replace("- [ ]", "").trim()) + "</li>";
            }
        }
        html += "</ul>";
        byId("next-checklist").innerHTML = html;
    }

    function copyText(kind) {
        var textByKind = {
            executive: "建议：" + state.review.executiveRecommendation + "\n当前默认：38\n扩展 80：仅研究用\n影子 50：仅影子用\n部分激活：默认禁用\n实盘/默认：未改变\n",
            candidates: (function() {
                var rows = [];
                for (var ci = 0; ci < state.candidates.length; ci++) {
                    rows.push(state.candidates[ci].symbol + "\t" + state.candidates[ci].sector_category + "\t" + state.candidates[ci].why_selected + "\t" + state.candidates[ci].activation_readiness);
                }
                return rows.join("\n");
            })(),
            checklist: state.checklist,
            observation: state.observationSummary || "未加载 Phase 6S 观测摘要。",
            governance: state.governanceSummary || "未加载 Phase 6T 治理摘要。"
        };
        navigator.clipboard.writeText(textByKind[kind] || "");
    }

    function formatPercent(value) {
        if (value === null || value === undefined || value === "") {
            return "无";
        }
        return (Number(value) * 100).toFixed(2) + "%";
    }

    function renderObservation() {
        var governanceTarget = byId("governance-summary");
        var target = byId("observation-summary");
        var table = byId("observation-table").querySelector("tbody");
        if (state.governance) {
            var governance = state.governance.governance || {};
            var governanceFacts = [
                ["治理状态", state.governance.anyCandidateEligibleForHumanReview ? "允许人工审查" : "观测历史不足", state.governance.anyCandidateEligibleForHumanReview ? "warn" : "ok"],
                ["可用观测轮次", String(state.governance.observationRunsAvailable)],
                ["唯一观测日期", state.governance.uniqueObservationDateCount || "无"],
                ["最低要求轮次", String(governance.minimum_observation_runs_before_review || 8)],
                ["可用日历周数", String(state.governance.calendarWeeksAvailable)],
                ["日历跨度天数", String(state.governance.calendarSpanDays ?? "无")],
                ["最低要求周数", String(governance.minimum_calendar_weeks_before_review || 8)],
                ["节奏状态", state.governance.cadenceStatus || "未知", state.governance.cadenceStatus === "cadence_ok_for_longitudinal_review" ? "ok" : "warn"],
                ["同日验证警告", state.governance.sameDayRunCount ? "是" : "否", state.governance.sameDayRunCount ? "warn" : "ok"],
                ["已归档观测", String(state.governance.archivedObservationCount || 0)],
                ["最新快照已归档", state.governance.latestSnapshotAlreadyArchived ? "是" : "否"],
                ["归档验证", state.archiveValidation ? (state.archiveValidation.archiveValid ? "有效" : "需要审查") : "未运行"],
                ["唯一归档时间戳", state.archiveValidation ? String(state.archiveValidation.uniqueObservationTimestampCount) : "无"],
                ["重复时间戳", state.archiveValidation ? String(state.archiveValidation.actualDuplicateTimestampCount) : "无"],
                ["缺失归档文件", state.archiveValidation ? String(state.archiveValidation.missingArchiveFileCount) : "无"],
                ["月审报告已生成", state.monthlyReview ? state.monthlyReview.generatedAt : "未运行"],
                ["月审人工审查资格", state.monthlyReview ? (state.monthlyReview.humanReviewEligibility ? "是" : "否") : "无"],
                ["月审实盘提升已阻止", state.monthlyReview ? (state.monthlyReview.livePromotionBlocked ? "是" : "审查中") : "无", "danger"],
                ["符合人工审查条件", state.governance.anyCandidateEligibleForHumanReview ? "是" : "否"],
                ["符合实盘提升条件", "否", "danger"]
            ];
            renderFacts(governanceTarget, governanceFacts);
        } else {
            governanceTarget.innerHTML = "<p class=\"muted\">尚未找到 Phase 6T 治理报告。请运行 <code>python research\\analyze_shadow_observation_history.py</code>。</p>";
        }
        if (!state.observation) {
            target.innerHTML = "<p class=\"muted\">尚未找到 Phase 6S 影子观测日志。请运行 <code>python research\\run_phase6s_shadow_observation.py</code>。</p>";
            table.innerHTML = "";
            return;
        }
        var counts = state.observation.statusCounts || {};
        var obsFacts = [
            ["最新观测日期", state.observation.generatedAt],
            ["监控标的", String(state.observation.monitoredSymbolCount)],
            ["持续关注", String(counts.keep_watching || 0)],
            ["需要更多数据", String(counts.needs_more_data || 0)],
            ["风险警告", String(counts.risk_warning || 0)],
            ["候选降级", String(counts.candidate_degraded || 0)],
            ["候选改善", String(counts.candidate_improved || 0)],
            ["风险警告", (state.observation.riskWarningSymbols || []).join(", ") || "无", (state.observation.riskWarningSymbols || []).length ? "warn" : "ok"]
        ];
        renderFacts(target, obsFacts);

        var rowHtml = "";
        var observations = state.observation.observations || [];
        for (var oi = 0; oi < observations.length; oi++) {
            var row = observations[oi];
            rowHtml += "<tr>" +
                "<td><strong>" + escapeHtml(row.symbol) + "</strong></td>" +
                "<td>" + escapeHtml(row.category) + "</td>" +
                "<td>" + escapeHtml(row.latest_price_date || "缺失") + "</td>" +
                "<td>" + escapeHtml(row.price_coverage_rows) + "</td>" +
                "<td>" + escapeHtml(formatPercent(row.recent_return_proxy)) + "</td>" +
                "<td>" + escapeHtml(formatPercent(row.volatility_proxy)) + "</td>" +
                "<td>" + escapeHtml(row.risk_gate_status) + "</td>" +
                "<td>" + escapeHtml(row.monitoring_status) + "</td>" +
                "<td>" + escapeHtml((row.risk_gate_warnings || []).join(", ") || "无") + "</td>" +
                "</tr>";
        }
        table.innerHTML = rowHtml;
    }

    async function init() {
        try {
            var results = await Promise.all([
                loadJson(paths.review),
                loadText(paths.candidates),
                loadText(paths.deferred),
                loadText(paths.checklist),
                loadJson(paths.universe),
                loadJson(paths.sector),
                loadJson(paths.monitoring),
                loadText(paths.removalRules)
            ]);
            state.review = results[0];
            state.candidates = parseCsv(results[1]);
            state.deferred = parseCsv(results[2]);
            state.checklist = results[3];
            state.universe = results[4];
            state.sector = results[5];
            state.monitoring = results[6];
            state.removalRules = results[7];

            state.observation = await loadJson(paths.observation).catch(function() { return null; });
            state.observationSummary = await loadText(paths.observationSummary).catch(function() { return ""; });
            state.governance = await loadJson(paths.governance).catch(function() { return null; });
            state.governanceSummary = await loadText(paths.governanceSummary).catch(function() { return ""; });
            state.historyManifest = await loadJson(paths.historyManifest).catch(function() { return null; });
            state.archiveValidation = await loadJson(paths.archiveValidation).catch(function() { return null; });
            state.monthlyReview = await loadJson(paths.monthlyReview).catch(function() { return null; });

            renderExecutive();
            renderComparison();
            renderCandidates();
            renderDeferred();
            renderRiskGates();
            renderMonitoring();
            renderChecklist();
            renderObservation();

            byId("load-state").innerHTML = "<strong class=\"ok\">已加载。</strong> 只读沙盘数据可供人工审查。";
        } catch (error) {
            byId("load-state").innerHTML = "<strong class=\"danger\">加载失败。</strong> " + escapeHtml(error.message);
        }
    }

    document.addEventListener("click", function(event) {
        var button = event.target.closest("[data-copy]");
        if (button) {
            copyText(button.dataset.copy);
            button.textContent = "已复制";
            setTimeout(function() {
                if (button.dataset.copy === "candidates") {
                    button.textContent = "复制表格";
                } else if (button.dataset.copy === "observation") {
                    button.textContent = "复制观测";
                } else if (button.dataset.copy === "governance") {
                    button.textContent = "复制治理";
                } else {
                    button.textContent = "复制";
                }
            }, 1200);
        }
    });

    init();
}());

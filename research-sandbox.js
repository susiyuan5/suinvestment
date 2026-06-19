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
            throw new Error(`Unable to load ${path}: ${response.status}`);
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
        target.innerHTML = `<div class="facts">${facts.map(([label, value, className]) => `
            <div class="fact"><span>${escapeHtml(label)}</span><strong class="${className || ""}">${escapeHtml(value)}</strong></div>
        `).join("")}</div>`;
    }

    function renderExecutive() {
        const defaults = state.review.defaultState || {};
        const phase6j = state.review.phase6j || {};
        byId("active-count").textContent = defaults.activeUniverseCount || "38";
        byId("expanded-count").textContent = `${defaults.expandedUniverseCount || 80} research-only`;
        byId("shadow-count").textContent = `${defaults.shadowSymbolCount || 50} shadow-only`;
        byId("monitored-count").textContent = `${defaults.monitoredSymbolCount || 12} monitoring-only`;
        byId("activation-state").textContent = defaults.partialActivationDisabledByDefault ? "disabled_by_default" : "review required";

        renderFacts(byId("executive-summary"), [
            ["Recommendation", state.review.executiveRecommendation, "warn"],
            ["Phase 6J decision", phase6j.recommendation || "continue_research_80", "warn"],
            ["Active default", `${defaults.activeUniverseCount} symbols`, "ok"],
            ["Expanded 80", "research-only"],
            ["Shadow 50", "shadow-only"],
            ["Partial activation", defaults.partialActivationDisabledByDefault ? "disabled" : "review required"],
            ["Next requirement", "human review before sandbox UI or live/default discussion"]
        ]);
    }

    function renderComparison() {
        const activeCategories = state.universe.activeCategoryCounts || {};
        const expandedCategories = state.universe.expandedCategoryCounts || {};
        const newCategories = Object.keys(expandedCategories).filter((key) => !activeCategories[key]);
        const topExpanded = Object.entries(expandedCategories)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 6)
            .map(([key, value]) => `<span class="pill">${escapeHtml(key)}: ${escapeHtml(value)}</span>`)
            .join("");

        byId("comparison-summary").innerHTML = `
            <div class="facts">
                <div class="fact"><span>Active count</span><strong>${escapeHtml(state.universe.activeCount)}</strong></div>
                <div class="fact"><span>Expanded count</span><strong>${escapeHtml(state.universe.expandedCount)}</strong></div>
                <div class="fact"><span>New symbols</span><strong>${escapeHtml((state.universe.newSymbols || []).length)}</strong></div>
                <div class="fact"><span>Removed symbols</span><strong>${escapeHtml((state.universe.removedSymbols || []).length)}</strong></div>
                <div class="fact"><span>New category coverage</span><strong>${escapeHtml(newCategories.join(", ") || "none")}</strong></div>
            </div>
            <p class="muted">Expanded category mix:</p>
            <p>${topExpanded}</p>
            <p class="muted">Expansion improves sector balance and candidate diversity, but also adds noise and remains research-only.</p>
        `;
    }

    function renderCandidates() {
        const tbody = byId("candidate-table").querySelector("tbody");
        tbody.innerHTML = state.candidates.map((row) => `
            <tr>
                <td><strong>${escapeHtml(row.symbol)}</strong></td>
                <td>${escapeHtml(row.sector_category)}</td>
                <td>${escapeHtml(row.why_selected)}</td>
                <td>${escapeHtml(row.factor_usefulness)}</td>
                <td>${escapeHtml(row.regime_usefulness)}</td>
                <td>${escapeHtml(row.risk_notes)}</td>
                <td>${escapeHtml(row.monitoring_requirement)}</td>
                <td>${escapeHtml(row.activation_readiness)}</td>
                <td>${escapeHtml(row.rollback_trigger)}</td>
            </tr>
        `).join("");
    }

    function renderDeferred() {
        byId("deferred-summary").innerHTML = state.deferred.map((row) => `
            <section>
                <h3>${escapeHtml(row.group)}: ${escapeHtml(row.symbol_count)}</h3>
                <p>${escapeHtml(row.reason_summary)}</p>
                <p class="muted">${escapeHtml(row.top_categories || "No categories in this group.")}</p>
            </section>
        `).join("");
    }

    function renderRiskGates() {
        const risk = state.review.phase6m || {};
        renderFacts(byId("risk-gates"), [
            ["Gate passed", risk.gate_passed, risk.gate_passed ? "ok" : "danger"],
            ["Max sector concentration", risk.max_sector_concentration],
            ["Max single symbol exposure", risk.max_single_symbol_exposure],
            ["Minimum price coverage", risk.minimum_price_coverage_rows],
            ["Volatility ceiling 12w", risk.volatility_ceiling_12w],
            ["Missing price fallback", risk.missing_price_fallback],
            ["New symbol cooldown", `${risk.new_symbol_cooldown_weeks} weeks`],
            ["Rollback baseline", "active 38-symbol research universe"]
        ]);
    }

    function renderMonitoring() {
        const metrics = state.monitoring.metrics || [];
        byId("monitoring-framework").innerHTML = `
            <div class="facts">
                <div class="fact"><span>Status</span><strong>${escapeHtml(state.monitoring.status)}</strong></div>
                <div class="fact"><span>Review cadence</span><strong>${escapeHtml(state.monitoring.reviewCadence)}</strong></div>
                <div class="fact"><span>Symbols</span><strong>${escapeHtml((state.monitoring.symbols || []).join(", "))}</strong></div>
            </div>
            <p class="muted">Monthly review metrics:</p>
            <ul>${metrics.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
            <p class="muted">${escapeHtml(state.removalRules.replace(/^#.*\\n?/, "").trim())}</p>
        `;
    }

    function renderChecklist() {
        const items = state.checklist
            .split("\n")
            .filter((line) => line.startsWith("- [ ]"))
            .map((line) => line.replace("- [ ]", "").trim());
        byId("next-checklist").innerHTML = `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
    }

    function copyText(kind) {
        const textByKind = {
            executive: `Recommendation: ${state.review.executiveRecommendation}\nActive default: 38\nExpanded 80: research-only\nShadow 50: shadow-only\nPartial activation: disabled_by_default\nLive/default: unchanged`,
            candidates: state.candidates.map((row) => `${row.symbol}\t${row.sector_category}\t${row.why_selected}\t${row.activation_readiness}`).join("\n"),
            checklist: state.checklist
            ,
            observation: state.observationSummary || "No Phase 6S observation summary loaded.",
            governance: state.governanceSummary || "No Phase 6T governance summary loaded."
        };
        navigator.clipboard.writeText(textByKind[kind] || "");
    }

    function formatPercent(value) {
        if (value === null || value === undefined || value === "") {
            return "n/a";
        }
        return `${(Number(value) * 100).toFixed(2)}%`;
    }

    function renderObservation() {
        const governanceTarget = byId("governance-summary");
        const target = byId("observation-summary");
        const table = byId("observation-table").querySelector("tbody");
        if (state.governance) {
            const governance = state.governance.governance || {};
            governanceTarget.innerHTML = `
                <div class="facts">
                    <div class="fact"><span>Governance status</span><strong class="${state.governance.anyCandidateEligibleForHumanReview ? "warn" : "ok"}">${escapeHtml(state.governance.anyCandidateEligibleForHumanReview ? "human review allowed" : "not enough observation history")}</strong></div>
                    <div class="fact"><span>Observation runs available</span><strong>${escapeHtml(state.governance.observationRunsAvailable)}</strong></div>
                    <div class="fact"><span>Unique observation dates</span><strong>${escapeHtml(state.governance.uniqueObservationDateCount || "n/a")}</strong></div>
                    <div class="fact"><span>Minimum required runs</span><strong>${escapeHtml(governance.minimum_observation_runs_before_review || 8)}</strong></div>
                    <div class="fact"><span>Calendar weeks available</span><strong>${escapeHtml(state.governance.calendarWeeksAvailable)}</strong></div>
                    <div class="fact"><span>Calendar span days</span><strong>${escapeHtml(state.governance.calendarSpanDays ?? "n/a")}</strong></div>
                    <div class="fact"><span>Minimum required weeks</span><strong>${escapeHtml(governance.minimum_calendar_weeks_before_review || 8)}</strong></div>
                    <div class="fact"><span>Cadence status</span><strong class="${state.governance.cadenceStatus === "cadence_ok_for_longitudinal_review" ? "ok" : "warn"}">${escapeHtml(state.governance.cadenceStatus || "unknown")}</strong></div>
                    <div class="fact"><span>Same-day validation warning</span><strong class="${state.governance.sameDayRunCount ? "warn" : "ok"}">${escapeHtml(state.governance.sameDayRunCount ? "yes" : "no")}</strong></div>
                    <div class="fact"><span>Archived observations</span><strong>${escapeHtml(state.governance.archivedObservationCount || 0)}</strong></div>
                    <div class="fact"><span>Latest snapshot archived</span><strong>${escapeHtml(state.governance.latestSnapshotAlreadyArchived ? "yes" : "no")}</strong></div>
                    <div class="fact"><span>Archive validation</span><strong>${escapeHtml(state.archiveValidation ? (state.archiveValidation.archiveValid ? "valid" : "review required") : "not run")}</strong></div>
                    <div class="fact"><span>Unique archived timestamps</span><strong>${escapeHtml(state.archiveValidation ? state.archiveValidation.uniqueObservationTimestampCount : "n/a")}</strong></div>
                    <div class="fact"><span>Duplicate timestamps</span><strong>${escapeHtml(state.archiveValidation ? state.archiveValidation.actualDuplicateTimestampCount : "n/a")}</strong></div>
                    <div class="fact"><span>Missing archive files</span><strong>${escapeHtml(state.archiveValidation ? state.archiveValidation.missingArchiveFileCount : "n/a")}</strong></div>
                    <div class="fact"><span>Monthly review generated</span><strong>${escapeHtml(state.monthlyReview ? state.monthlyReview.generatedAt : "not run")}</strong></div>
                    <div class="fact"><span>Monthly human-review eligible</span><strong>${escapeHtml(state.monthlyReview ? (state.monthlyReview.humanReviewEligibility ? "yes" : "no") : "n/a")}</strong></div>
                    <div class="fact"><span>Monthly live promotion blocked</span><strong class="danger">${escapeHtml(state.monthlyReview ? (state.monthlyReview.livePromotionBlocked ? "yes" : "review") : "n/a")}</strong></div>
                    <div class="fact"><span>Eligible for human review</span><strong>${escapeHtml(state.governance.anyCandidateEligibleForHumanReview ? "yes" : "no")}</strong></div>
                    <div class="fact"><span>Eligible for live promotion</span><strong class="danger">no</strong></div>
                </div>
            `;
        } else {
            governanceTarget.innerHTML = '<p class="muted">No Phase 6T governance report found yet. Run <code>python research\\analyze_shadow_observation_history.py</code>.</p>';
        }
        if (!state.observation) {
            target.innerHTML = '<p class="muted">No Phase 6S shadow observation log found yet. Run <code>python research\\run_phase6s_shadow_observation.py</code>.</p>';
            table.innerHTML = "";
            return;
        }
        const counts = state.observation.statusCounts || {};
        target.innerHTML = `
            <div class="facts">
                <div class="fact"><span>Latest observation date</span><strong>${escapeHtml(state.observation.generatedAt)}</strong></div>
                <div class="fact"><span>Monitored symbols</span><strong>${escapeHtml(state.observation.monitoredSymbolCount)}</strong></div>
                <div class="fact"><span>keep_watching</span><strong>${escapeHtml(counts.keep_watching || 0)}</strong></div>
                <div class="fact"><span>needs_more_data</span><strong>${escapeHtml(counts.needs_more_data || 0)}</strong></div>
                <div class="fact"><span>risk_warning</span><strong>${escapeHtml(counts.risk_warning || 0)}</strong></div>
                <div class="fact"><span>candidate_degraded</span><strong>${escapeHtml(counts.candidate_degraded || 0)}</strong></div>
                <div class="fact"><span>candidate_improved</span><strong>${escapeHtml(counts.candidate_improved || 0)}</strong></div>
                <div class="fact"><span>Risk warnings</span><strong class="${(state.observation.riskWarningSymbols || []).length ? "warn" : "ok"}">${escapeHtml((state.observation.riskWarningSymbols || []).join(", ") || "none")}</strong></div>
            </div>
        `;
        table.innerHTML = (state.observation.observations || []).map((row) => `
            <tr>
                <td><strong>${escapeHtml(row.symbol)}</strong></td>
                <td>${escapeHtml(row.category)}</td>
                <td>${escapeHtml(row.latest_price_date || "missing")}</td>
                <td>${escapeHtml(row.price_coverage_rows)}</td>
                <td>${escapeHtml(formatPercent(row.recent_return_proxy))}</td>
                <td>${escapeHtml(formatPercent(row.volatility_proxy))}</td>
                <td>${escapeHtml(row.risk_gate_status)}</td>
                <td>${escapeHtml(row.monitoring_status)}</td>
                <td>${escapeHtml((row.risk_gate_warnings || []).join(", ") || "none")}</td>
            </tr>
        `).join("");
    }

    async function init() {
        try {
            const [review, candidatesCsv, deferredCsv, checklist, universe, sector, monitoring, removalRules] = await Promise.all([
                loadJson(paths.review),
                loadText(paths.candidates),
                loadText(paths.deferred),
                loadText(paths.checklist),
                loadJson(paths.universe),
                loadJson(paths.sector),
                loadJson(paths.monitoring),
                loadText(paths.removalRules)
            ]);
            const observation = await loadJson(paths.observation).catch(() => null);
            const observationSummary = await loadText(paths.observationSummary).catch(() => "");
            const governance = await loadJson(paths.governance).catch(() => null);
            const governanceSummary = await loadText(paths.governanceSummary).catch(() => "");
            const historyManifest = await loadJson(paths.historyManifest).catch(() => null);
            const archiveValidation = await loadJson(paths.archiveValidation).catch(() => null);
            const monthlyReview = await loadJson(paths.monthlyReview).catch(() => null);
            state.review = review;
            state.candidates = parseCsv(candidatesCsv);
            state.deferred = parseCsv(deferredCsv);
            state.checklist = checklist;
            state.universe = universe;
            state.sector = sector;
            state.monitoring = monitoring;
            state.removalRules = removalRules;
            state.observation = observation;
            state.observationSummary = observationSummary;
            state.governance = governance;
            state.governanceSummary = governanceSummary;
            state.historyManifest = historyManifest;
            state.archiveValidation = archiveValidation;
            state.monthlyReview = monthlyReview;

            renderExecutive();
            renderComparison();
            renderCandidates();
            renderDeferred();
            renderRiskGates();
            renderMonitoring();
            renderChecklist();
            renderObservation();

            byId("load-state").innerHTML = '<strong class="ok">Loaded.</strong> Read-only sandbox data is available for human review.';
        } catch (error) {
            byId("load-state").innerHTML = `<strong class="danger">Load failed.</strong> ${escapeHtml(error.message)}`;
        }
    }

    document.addEventListener("click", (event) => {
        const button = event.target.closest("[data-copy]");
        if (button) {
            copyText(button.dataset.copy);
            button.textContent = "Copied";
            setTimeout(() => {
                if (button.dataset.copy === "candidates") {
                    button.textContent = "Copy Table";
                } else if (button.dataset.copy === "observation") {
                    button.textContent = "Copy Observation";
                } else if (button.dataset.copy === "governance") {
                    button.textContent = "Copy Governance";
                } else {
                    button.textContent = "Copy";
                }
            }, 1200);
        }
    });

    init();
}());

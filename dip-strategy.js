(function (root, factory) {
  const api =
    typeof module === "object" && module.exports
      ? factory(
          require("./market-analysis"),
          require("./wealthsimple-execution-policy"),
        )
      : factory(root.MarketAnalysis, root.WealthsimpleExecutionPolicy);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.DipStrategy = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (M, E) {
  "use strict";
  const symbols = ["SPY", "QQQ", "NVDA", "AAPL", "ASML", "KO"],
    etfs = ["SPY", "QQQ"];
  const finite = Number.isFinite,
    clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  const cents = (x) => Math.floor((x + 1e-9) * 100),
    money = (x) => Math.round(x * 100) / 100;
  const nyDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  function day(value) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return value;
    const parts = nyDate.formatToParts(new Date(value));
    const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
    return `${p.year}-${p.month}-${p.day}`;
  }
  function week(value) {
    const d = new Date(day(value) + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    return d.toISOString().slice(0, 10);
  }
  const previousWeek = (value) =>
    week(
      new Date(Date.parse(week(value)) - 7 * 86400000)
        .toISOString()
        .slice(0, 10),
    );
  function completeWeeks(rows, asOf) {
    const end = week(asOf),
      grouped = new Map();
    for (const r of [...rows].sort((a, b) => a.date.localeCompare(b.date))) {
      if (r.date >= end) continue;
      grouped.set(week(r.date), {
        date: r.date,
        close: r.adjusted_close,
        week: week(r.date),
      });
    }
    return [...grouped.values()];
  }
  function signal(rows, asOf) {
    const history = completeWeeks(rows, asOf).slice(-52),
      closes = history.map((r) => r.close);
    const valid =
      history.length === 52 &&
      history.at(-1).week === previousWeek(asOf) &&
      closes.every((x) => finite(x) && x > 0) &&
      history.every(
        (r, i) =>
          !i ||
          Date.parse(r.week) - Date.parse(history[i - 1].week) === 7 * 86400000,
      );
    if (!valid)
      return { valid: false, reasons: ["WEEKLY_HISTORY_MISSING_OR_STALE"] };
    const last = closes.at(-1),
      ma4 = M.movingAverage(closes, 4, 0),
      priorMa4 = M.movingAverage(closes, 4, 1);
    const weeklyReturn = M.percentChange(closes, 1),
      priorReturn = (closes.at(-2) / closes.at(-3) - 1) * 100;
    const strong = weeklyReturn > 0 && priorReturn > 0 && last >= ma4;
    const preliminary =
      weeklyReturn > 0 || (closes.at(-2) <= priorMa4 && last > ma4);
    return {
      valid: true,
      asOf: history.at(-1).date,
      week: history.at(-1).week,
      drawdown: M.recentDrawdown(closes, 52),
      volatility: M.weeklyVolatility(closes, 12) * 100,
      weeklyReturn,
      ma4,
      ma20: M.movingAverage(closes, 20, 0),
      trend: M.tickerTrend(closes, weeklyReturn),
      stabilization: strong ? "strong" : preliminary ? "preliminary" : "none",
      regime: M.marketRegime(history).type,
    };
  }
  function candidate(symbol, s, target, current, regime, globalReasons = []) {
    const reasons = [...globalReasons],
      etf = etfs.includes(symbol),
      dd = s.drawdown;
    if (!s.valid || !finite(dd) || !finite(s.volatility))
      reasons.push(...(s.reasons || ["INVALID_SIGNAL"]));
    const tier = !finite(dd)
      ? "unknown"
      : dd < 10
        ? "below"
        : dd < 15
          ? "10-15"
          : dd < 25
            ? "15-25"
            : dd <= 35
              ? "25-35"
              : "over35";
    if (finite(dd) && dd < (etf ? 10 : 15))
      reasons.push("BELOW_DRAWDOWN_THRESHOLD");
    if (s.volatility >= 6) reasons.push("EXTREME_TICKER_VOLATILITY");
    if (!["strong", "preliminary"].includes(s.stabilization))
      reasons.push("NO_STABILIZATION");
    if (dd >= 25 && s.stabilization !== "strong")
      reasons.push("STRONG_STABILIZATION_REQUIRED");
    if (etf && tier === "10-15" && s.trend?.status === "strong_downtrend")
      reasons.push("SHALLOW_STRONG_DOWNTREND");
    if (regime === "Bear" && (!etf || s.stabilization !== "strong"))
      reasons.push("BEAR_RESTRICTION");
    if (dd > 35 && ["Bear", "Panic"].includes(regime))
      reasons.push("DEEP_MARKET_RESTRICTION");
    if (!finite(target) || target <= 0 || target > 1)
      reasons.push("INVALID_TARGET");
    if (!finite(current) || current >= target + 0.02 - Number.EPSILON)
      reasons.push("OVERWEIGHT");
    const depth = finite(dd) ? clamp(dd / 35, 0, 1) : 0,
      stabilization =
        s.stabilization === "strong"
          ? 1
          : s.stabilization === "preliminary"
            ? 0.5
            : 0;
    const underweight =
      target > 0 ? clamp((target - current) / target, 0, 1) : 0;
    return {
      symbol,
      tier,
      drawdown: finite(dd) ? dd : null,
      volatility: finite(s.volatility) ? s.volatility : null,
      stabilization: s.stabilization || "none",
      strongDowntrend: s.trend?.status === "strong_downtrend",
      score: 100 * (0.5 * depth + 0.3 * stabilization + 0.2 * underweight),
      scoreParts: { depth, stabilization, underweight },
      reasons: [...new Set(reasons)],
      capFraction: etf ? (tier === "10-15" ? 0.25 : 0.5) : 0.25,
    };
  }
  function plan(input) {
    const {
      signals = {},
      targets = {},
      values = {},
      accounts = {},
      securities = {},
      quotes = {},
      ledger = {},
      now = Date.now(),
    } = input;
    const global = [];
    if (
      !etfs.every(
        (s) => signals[s]?.valid && signals[s].week === previousWeek(now),
      )
    )
      global.push("MARKET_DATA_UNAVAILABLE");
    if (etfs.some((s) => signals[s]?.volatility >= 6))
      global.push("EXTREME_MARKET_VOLATILITY");
    const regime = input.panic ? "Panic" : signals.QQQ?.regime;
    if (regime === "Panic") global.push("PANIC");
    if (!["Bull", "Neutral", "Correction", "Bear", "Panic"].includes(regime))
      global.push("MARKET_DATA_UNAVAILABLE");
    if (
      ledger.blocked ||
      ![ledger.balance, ledger.weekLimit, ledger.weekSpent].every(finite)
    )
      global.push("LEDGER_UNAVAILABLE_OR_EXCEEDED");
    if (
      !symbols.every((s) => finite(values[s]) && values[s] >= 0) ||
      Math.abs(Object.values(targets).reduce((a, b) => a + b, 0) - 1) > 1e-6
    )
      global.push("HOLDINGS_OR_TARGETS_INVALID");
    const totalValue = Object.values(values).reduce(
      (a, b) => a + (finite(b) ? b : 0),
      0,
    );
    const budget = Math.max(
      0,
      Math.min(
        ledger.balance || 0,
        (ledger.weekLimit || 0) - (ledger.weekSpent || 0),
      ),
    );
    const cash = Object.fromEntries(
      Object.entries(accounts).map(([id, a]) => [
        id,
        finite(a.cash) && finite(a.reserved)
          ? Math.max(0, cents(a.cash - a.reserved))
          : null,
      ]),
    );
    const rows = symbols
      .map((symbol) => {
        const r = candidate(
          symbol,
          signals[symbol] || {},
          targets[symbol],
          totalValue ? values[symbol] / totalValue : 0,
          regime,
          global,
        );
        if (signals[symbol]?.week !== previousWeek(now))
          r.reasons.push("WEEKLY_HISTORY_MISSING_OR_STALE");
        const security = securities[symbol] || {},
          account = accounts[security.accountId] || {},
          quote = quotes[symbol] || {};
        if (security.currency !== "USD")
          r.reasons.push("SECURITY_CURRENCY_UNKNOWN_OR_MISMATCH");
        if (
          cash[security.accountId] === null ||
          cash[security.accountId] === undefined
        )
          r.reasons.push("ACCOUNT_CASH_UNKNOWN");
        const cap = Math.max(
          0,
          cents((ledger.weekLimit || 0) * r.capFraction) -
            cents(ledger.bySymbol?.[symbol] || 0),
        );
        return {
          ...r,
          cap,
          amount: 0,
          accountId: security.accountId,
          security,
          account,
          quote,
        };
      })
      .sort((a, b) => b.score - a.score || a.symbol.localeCompare(b.symbol));
    function execute(r, amount) {
      const result = E.execute(
        {
          symbol: r.symbol,
          marketType: "listed",
          price: r.quote.price,
          planningAmount: amount / 100,
          planningCurrency: "USD",
          availableAfterReserve:
            cash[r.accountId] === null ? 0 : (cash[r.accountId] || 0) / 100,
          accountCurrency: r.account.currency,
          accountType: r.account.type,
          tradingCurrency: r.security.currency,
          fractionalSupported: r.security.fractional,
          minimumFractionalAmount: r.security.minimum || 1,
          quoteTimestamp: r.quote.asOf,
          fxRate: input.fxRate,
          fxAsOf: input.fxAsOf,
          fxMaxAgeDays: input.fxMaxAgeDays || 3,
          fxFeeRate: 0.015,
        },
        { now },
      );
      if (result.executable) {
        const debitUSD = E.convert(
          result.accountDebit,
          r.account.currency,
          "USD",
          input.fxRate,
        );
        // Account-currency cent rounding must never create extra USD spending.
        if (debitUSD > amount / 100 + 1e-9 && amount > 0)
          return execute(r, amount - 1);
        result.executableAmountPlanning =
          Math.ceil(debitUSD * 100 - 1e-9) / 100;
        result.retainedBudgetPlanning = money(
          amount / 100 - result.executableAmountPlanning,
        );
      }
      return result;
    }
    // Validate broker inputs even when no signal qualifies; never give each order the full account cash.
    for (const r of rows) {
      const check = execute(r, Math.max(100, r.cap));
      const hard = check.reasonCodes.filter(
        (c) =>
          ![
            "NO_WHOLE_SHARE",
            "BELOW_FRACTIONAL_MINIMUM",
            "ZERO_SUGGESTION",
          ].includes(c),
      );
      r.reasons.push(...hard);
      r.reasons = [...new Set(r.reasons)];
    }
    let remaining = cents(budget),
      active = rows.filter((r) => !r.reasons.length && r.cap > 0);
    // Capped proportional allocation in cents; deterministic residual distribution.
    while (remaining > 0 && active.length) {
      const score = active.reduce((a, r) => a + r.score, 0),
        before = remaining;
      const shares = active.map((r) =>
        Math.min(r.cap - r.amount, Math.floor((before * r.score) / score)),
      );
      active.forEach((r, i) => {
        r.amount += shares[i];
        remaining -= shares[i];
      });
      if (remaining === before)
        for (const r of active) {
          if (remaining > 0 && r.amount < r.cap) {
            r.amount++;
            remaining--;
          }
        }
      active = active.filter((r) => r.amount < r.cap);
    }
    // Reallocate broker-limited amounts, using shared account balances each pass.
    const originalCash = { ...cash };
    function materialize() {
      Object.assign(cash, originalCash);
      for (const r of rows) {
        r.execution = execute(r, r.amount);
        r.spent = r.execution.executable
          ? cents(r.execution.executableAmountPlanning)
          : 0;
        if (r.spent)
          cash[r.accountId] -= Math.round(r.execution.accountDebit * 100);
      }
    }
    materialize();
    for (let pass = 0; pass < rows.length; pass++) {
      let left = cents(budget) - rows.reduce((a, r) => a + r.spent, 0),
        changed = false;
      for (const r of rows) r.amount = r.spent;
      const eligible = rows.filter(
        (r) => !r.reasons.length && r.amount < r.cap && cash[r.accountId] > 0,
      );
      const weight = eligible.reduce((a, r) => a + r.score, 0);
      for (const r of eligible) {
        const extra = Math.min(
          r.cap - r.amount,
          Math.floor((left * r.score) / weight),
        );
        if (extra > 0) {
          r.amount += extra;
          changed = true;
        }
      }
      if (!changed) break;
      materialize();
    }
    // Post-buy weights use security notionals, excluding fees and cash. Reductions converge monotonically.
    for (let pass = 0; pass < 100; pass++) {
      const added = rows.reduce(
        (a, r) =>
          a +
          (r.execution.executable ? r.execution.executableNotionalTrading : 0),
        0,
      );
      let changed = false;
      for (const r of rows) {
        const notional = r.execution.executable
          ? r.execution.executableNotionalTrading
          : 0;
        const weightCap = targets[r.symbol] + 0.02;
        const allowed =
          weightCap >= 1
            ? Infinity
            : Math.max(
                0,
                (weightCap * (totalValue + added - notional) -
                  (values[r.symbol] || 0)) /
                  (1 - weightCap),
              );
        if (notional > allowed + 1e-9 && r.amount > 0) {
          r.amount = Math.max(
            0,
            Math.min(r.amount - 1, Math.floor((r.amount * allowed) / notional)),
          );
          r.weightLimited = true;
          r.cap = Math.min(r.cap, r.amount);
          changed = true;
        }
      }
      if (!changed) break;
      materialize();
      let residual = cents(budget) - rows.reduce((a, r) => a + r.spent, 0);
      for (const r of rows) r.amount = r.spent;
      const receivers = rows.filter(
        (r) => !r.reasons.length && r.amount < r.cap && cash[r.accountId] > 0,
      );
      const receiverScore = receivers.reduce((a, r) => a + r.score, 0);
      const distribution = residual;
      for (const r of receivers) {
        const extra = Math.min(
          r.cap - r.amount,
          Math.floor((distribution * r.score) / receiverScore),
        );
        r.amount += extra;
        residual -= extra;
      }
      while (residual > 0 && receivers.some((r) => r.amount < r.cap))
        for (const r of receivers) {
          if (residual > 0 && r.amount < r.cap) {
            r.amount++;
            residual--;
          }
        }
      materialize();
      if (pass === 99) {
        rows.forEach((r) => {
          r.amount = 0;
          r.weightLimited = true;
        });
        materialize();
      }
    }
    for (const r of rows) {
      if (r.weightLimited) r.reasons.push("POST_BUY_WEIGHT_LIMIT");
      if (!r.spent) r.reasons.push(...r.execution.reasonCodes);
      r.reasons = [...new Set(r.reasons)];
    }
    const allocated = money(rows.reduce((a, r) => a + r.spent, 0) / 100);
    return {
      version: "independent-dip-v1",
      regime,
      rows: rows.map((r) => ({
        symbol: r.symbol,
        tier: r.tier,
        stabilization: r.stabilization,
        score: r.score,
        scoreParts: r.scoreParts,
        drawdown: r.drawdown,
        volatility: r.volatility,
        strongDowntrend: r.strongDowntrend,
        reasons: r.reasons,
        eligible:
          !candidate(
            r.symbol,
            signals[r.symbol] || {},
            targets[r.symbol],
            totalValue ? values[r.symbol] / totalValue : 0,
            regime,
            global,
          ).reasons.length && signals[r.symbol]?.week === previousWeek(now),
        accountId: r.accountId,
        amountUSD: r.spent / 100,
        quantity: r.execution.executable
          ? r.security.fractional === false
            ? Math.round(r.execution.executableNotionalTrading / r.quote.price)
            : Math.floor(
                (r.execution.executableNotionalTrading / r.quote.price) * 1e6,
              ) / 1e6
          : 0,
        notional: r.execution.executableNotionalTrading,
        securityCurrency: r.security.currency,
        accountDebit: r.execution.accountDebit,
        accountCurrency: r.account.currency,
        fxFee: r.execution.fxFeeAccount,
        execution: r.execution,
      })),
      weekSpent: ledger.weekSpent || 0,
      weekLimit: ledger.weekLimit || 0,
      allocated,
      remainingWeek: money(
        Math.max(
          0,
          (ledger.weekLimit || 0) - (ledger.weekSpent || 0) - allocated,
        ),
      ),
      balance: ledger.balance || 0,
      remainingReserve: money((ledger.balance || 0) - allocated),
      reasons: [...new Set(global)],
    };
  }
  return Object.freeze({
    version: "independent-dip-v1",
    symbols,
    day,
    week,
    previousWeek,
    completeWeeks,
    signal,
    candidate,
    plan,
    money,
  });
});

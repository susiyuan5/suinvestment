(function (root) {
  "use strict";
  const S = root.DipStrategy,
    L = root.DipLedger,
    el = document.getElementById("dipOpportunities");
  if (!el || !S || !L) return;
  const status = document.getElementById("dipStatus"),
    summaryEl = document.getElementById("dipSummary"),
    rowsEl = document.getElementById("dipRows");
  let book,
    latest,
    history,
    sequence = 0;
  const channel =
    typeof BroadcastChannel !== "undefined"
      ? new BroadcastChannel("independent-dip")
      : null;
  const currency = (n, c = "USD") =>
    !["USD", "CAD"].includes(c)
      ? "币种待确认"
      : Number.isFinite(n)
        ? new Intl.NumberFormat("zh-CN", {
            style: "currency",
            currency: c,
          }).format(n)
        : "未知";
  const names = {
    below: "未达到门槛",
    "10-15": "10%–15%",
    "15-25": "15%–25%",
    "25-35": "25%–35%",
    over35: "超过35%",
    unknown: "数据不足",
    strong: "强止跌",
    preliminary: "初步止跌",
    none: "未止跌",
  };
  const reasonNames = {
    MARKET_DATA_UNAVAILABLE: "市场周线不足或过期",
    EXTREME_MARKET_VOLATILITY: "市场周波动率达到6%",
    PANIC: "市场恐慌暂停",
    LEDGER_UNAVAILABLE_OR_EXCEEDED: "账本不可用或存在预算超用",
    HOLDINGS_OR_TARGETS_INVALID: "持仓或目标权重未就绪",
    WEEKLY_HISTORY_MISSING_OR_STALE: "需连续52周且最新完整周有效",
    INVALID_SIGNAL: "信号不完整",
    BELOW_DRAWDOWN_THRESHOLD: "回撤未达到门槛",
    EXTREME_TICKER_VOLATILITY: "标的周波动率达到6%",
    NO_STABILIZATION: "尚未止跌",
    STRONG_STABILIZATION_REQUIRED: "需要强止跌",
    SHALLOW_STRONG_DOWNTREND: "浅层回撤仍处于强下跌",
    BEAR_RESTRICTION: "熊市只开放强止跌ETF",
    DEEP_MARKET_RESTRICTION: "深层回撤且处于熊市或恐慌",
    INVALID_TARGET: "目标权重无效",
    OVERWEIGHT: "已达到目标权重加2个百分点",
    ACCOUNT_CASH_UNKNOWN: "账户可交易现金尚未填写",
    SECURITY_CURRENCY_UNKNOWN_OR_MISMATCH: "证券币种需确认为所选美股代码的USD报价",
    POST_BUY_WEIGHT_LIMIT: "买入后权重上限限制",
    ZERO_SUGGESTION: "本次未分配金额",
    INVALID_PRICE: "证券价格无效",
    STALE_QUOTE: "证券报价过期",
    ACCOUNT_RULES_UNKNOWN: "账户或证券币种未确认",
    FX_RATE_UNAVAILABLE_OR_STALE: "汇率无效或过期",
    INSUFFICIENT_ACCOUNT_FUNDS: "扣除其他计划后现金不足",
    FRACTIONAL_SUPPORT_UNKNOWN: "请确认该账户的碎股资格",
    NO_WHOLE_SHARE: "额度不足一整股",
    BELOW_FRACTIONAL_MINIMUM: "低于碎股最低金额",
  };
  function json(key, fallback) {
    try {
      return JSON.parse(localStorage.getItem(key)) || fallback;
    } catch {
      return fallback;
    }
  }
  function node(tag, text) {
    const n = document.createElement(tag);
    if (text !== undefined) n.textContent = text;
    return n;
  }
  function context(snapshot) {
    const saved = json("su-investment-pro:wealthsimple-accounts-v1", {
        accounts: [],
      }),
      settings = root.WealthsimpleCurrency.load(localStorage);
    const defaultAccount = saved.defaultId || saved.accounts?.[0]?.id,
      accounts = {};
    for (const a of saved.accounts || [])
      accounts[a.id || a.account_id] = {
        currency: a.account_currency,
        type: a.account_type,
        cash:
          a.available_to_trade === "" || a.available_to_trade == null
            ? null
            : Number(a.available_to_trade),
        reserved: Number(a.pending_order_reserve || 0),
      };
    const existing = root.__SUINVESTMENT_WEALTHSIMPLE_PLAN__,
      risk = root.__SUINVESTMENT_PORTFOLIO_RISK__,
      targets = root.__SUINVESTMENT_SETTINGS_API__?.currentAllocation() || {};
    // Reserve the full old plan in account currency, even if its broker checklist is incomplete.
    for (const row of existing?.plan?.items || []) {
      const a = accounts[row.accountId || defaultAccount];
      if (a) {
        const debit = root.WealthsimpleExecutionPolicy.convert(
          Number(row.finalAmount || 0),
          "USD",
          a.currency,
          settings.fxRate,
        );
        if (debit === null) a.cash = null;
        else a.reserved += debit;
      }
    }
    const prefs = json("su-investment-pro:dip-security-rules-v1", {}),
      quotes = {},
      securities = {},
      values = {};
    for (const symbol of S.symbols) {
      const sig = (root.__SUINVESTMENT_SIGNALS__ || []).find(
          (s) => s.symbol === symbol,
        ),
        meta = sig?.field_provenance?.price;
      quotes[symbol] = {
        price: meta?.freshness === "fresh" ? sig.latest_price : null,
        asOf: Number.isFinite(meta?.timestamp)
          ? new Date(meta.timestamp).toISOString()
          : null,
      };
      securities[symbol] = {
        accountId: defaultAccount,
        currency: "USD",
        fractional: prefs[defaultAccount]?.[symbol] ?? "unknown",
      };
      values[symbol] = risk?.positions?.[symbol]?.current_value;
    }
    return {
      now: Date.now(),
      signals: Object.fromEntries(
        S.symbols.map((s) => [
          s,
          S.signal(history?.symbols?.[s] || [], Date.now()),
        ]),
      ),
      targets,
      values,
      accounts,
      securities,
      quotes,
      fxRate: settings.fxRate,
      fxAsOf: settings.fxAsOf,
      fxMaxAgeDays: settings.fxMaxAgeDays,
      panic: existing?.panicActive,
      ledger: snapshot,
    };
  }
  function render(plan, snapshot) {
    summaryEl.replaceChildren();
    for (const [label, value] of [
      ["储备余额", currency(snapshot.balance)],
      ["本月新增", currency(snapshot.monthAdded)],
      ["本周上限", currency(snapshot.weekLimit)],
      ["本周已记录", currency(snapshot.weekSpent)],
      ["本次建议", currency(plan.allocated)],
      ["建议后周额度", currency(plan.remainingWeek)],
      ["建议后储备", currency(plan.remainingReserve)],
    ]) {
      const box = node("div");
      box.append(node("span", label), node("strong", value));
      summaryEl.append(box);
    }
    status.textContent = snapshot.blocked
      ? "存在超额成交记录，新增建议已暂停"
      : plan.allocated > 0
        ? "已生成建议；请人工核对，建议不会扣款"
        : "本次保留现金；请查看各标的原因";
    rowsEl.replaceChildren();
    for (const row of plan.rows) {
      const card = node("article");
      card.className = "dip-candidate";
      card.append(
        node("h3", row.symbol + " · 独立抄底"),
        node(
          "p",
          `${names[row.tier]} · ${names[row.stabilization]} · 得分 ${row.score.toFixed(1)}`,
        ),
      );
      card.append(
        node(
          "p",
          `回撤 ${row.drawdown === null ? "未知" : row.drawdown.toFixed(2) + "%"} · 周波动率 ${row.volatility === null ? "未知" : row.volatility.toFixed(2) + "%"} · 建议 ${row.quantity.toFixed(6)} 股`,
        ),
      );
      card.append(
        node(
          "p",
          `证券成交额 ${currency(row.notional, row.securityCurrency || "")} · 账户扣款 ${currency(row.accountDebit, row.accountCurrency || "")} · FX ${currency(row.fxFee, row.accountCurrency || "")}`,
        ),
      );
      const scoreDetail = node("details");
      scoreDetail.append(
        node("summary", "评分明细"),
        node(
          "p",
          `回撤 ${(0.5 * row.scoreParts.depth * 100).toFixed(1)}/50 · 止跌 ${(0.3 * row.scoreParts.stabilization * 100).toFixed(1)}/30 · 低配 ${(0.2 * row.scoreParts.underweight * 100).toFixed(1)}/20`,
        ),
      );
      card.append(scoreDetail);
      card.append(
        node(
          "p",
          row.reasons.length
            ? row.reasons.map((c) => reasonNames[c] || c).join("；")
            : "止跌及资金条件满足，请核对碎股资格和成交价格",
        ),
      );
      const label = node("label", row.symbol + " 碎股资格 "),
        select = node("select");
      select.setAttribute("aria-label", row.symbol + " 碎股资格");
      for (const [value, text] of [
        ["unknown", "未确认"],
        ["true", "支持碎股"],
        ["false", "仅整股"],
      ]) {
        const opt = node("option", text);
        opt.value = value;
        select.append(opt);
      }
      const prefs = json("su-investment-pro:dip-security-rules-v1", {});
      select.value = String(prefs[row.accountId]?.[row.symbol] ?? "unknown");
      select.addEventListener("change", () => {
        const next = json("su-investment-pro:dip-security-rules-v1", {});
        next[row.accountId] ??= {};
        next[row.accountId][row.symbol] =
          select.value === "unknown" ? "unknown" : select.value === "true";
        localStorage.setItem(
          "su-investment-pro:dip-security-rules-v1",
          JSON.stringify(next),
        );
        refresh();
      });
      label.append(select);
      card.append(label);
      rowsEl.append(card);
    }
    const log = document.getElementById("dipLedgerEntries");
    log.replaceChildren();
    const reversed = new Set(
      book.entries
        .filter((e) => e.type === "reversal")
        .map((e) => e.originalId),
    );
    for (const entry of book.entries
      .filter((e) => e.type === "buy")
      .slice()
      .reverse()) {
      const item = node(
        "li",
        `${entry.symbol} · ${entry.tradeAt} · ${currency(entry.amountUSD)}${entry.anomaly ? " · 超额异常" : ""}${reversed.has(entry.id) ? " · 已冲正" : ""} `,
      );
      if (!reversed.has(entry.id)) {
        const button = node("button", "冲正此记录");
        button.type = "button";
        button.addEventListener("click", async () => {
          try {
            await L.transact(indexedDB, (b) =>
              L.reverse(b, entry.id, Date.now()),
            );
            channel?.postMessage("changed");
            refresh();
          } catch (e) {
            fail(e);
          }
        });
        item.append(button);
      }
      log.append(item);
    }
  }
  function fail(e) {
    const reasons = {
      LEDGER_VERSION_INVALID: "账本文件版本不支持",
      LEDGER_ENTRY_INVALID: "账本流水格式错误",
      WEEK_INVALID: "账本周额度校验失败",
      DEPOSIT_INVALID: "月度入账记录校验失败",
      ANOMALY_FLAG_INVALID: "预算超用标记校验失败",
      RESTORE_WOULD_REWRITE_HISTORY: "备份缺少当前流水，不能覆盖历史",
      EXECUTION_TOTAL_MISMATCH: "数量乘成交价加费用与账户扣款不一致",
      BUY_INVALID: "实际买入字段无效，请核对数量、金额和币种",
      FX_INVALID: "CAD 账户需要有效的实际 USD/CAD 汇率",
      TRADE_DATE_INVALID: "成交时间无效或晚于现在",
      HISTORICAL_WEEK_NOT_INITIALIZED: "该历史周没有冻结额度，无法归账",
      ID_CONFLICT: "同一提交编号的内容不一致",
      INDEXEDDB_UNAVAILABLE: "浏览器不支持账本存储",
    };
    status.textContent = "抄底建议已停止：" + (reasons[e.message] || e.message);
    rowsEl.replaceChildren();
    latest = null;
  }
  async function refresh() {
    const seq = ++sequence;
    try {
      const next = await L.transact(indexedDB, (b) => L.ensure(b, Date.now()));
      if (!history) {
        const response = await fetch("data/v2/backtest-adjusted-daily.json", {
          cache: "no-cache",
        });
        if (!response.ok) throw Error("周线数据无法加载");
        history = await response.json();
      }
      if (seq !== sequence) return;
      book = next;
      const snapshot = L.summary(book, Date.now());
      latest = S.plan(context(snapshot));
      render(latest, snapshot);
    } catch (e) {
      if (seq === sequence) fail(e);
    }
  }
  document.getElementById("dipRecalculate").addEventListener("click", () => {
    history = null;
    refresh();
  });
  document.getElementById("dipExport").addEventListener("click", async () => {
    try {
      const b = await L.transact(indexedDB, (x) => x);
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(b, null, 2)], { type: "application/json" }),
      );
      const a = node("a");
      a.href = url;
      a.download = "independent-dip-ledger.json";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      fail(e);
    }
  });
  document
    .getElementById("dipImport")
    .addEventListener("change", async (event) => {
      try {
        const file = event.target.files[0];
        if (!file) return;
        const incoming = JSON.parse(await file.text());
        await L.transact(indexedDB, (b) => L.restore(b, incoming));
        channel?.postMessage("changed");
        refresh();
      } catch (e) {
        fail(e);
      } finally {
        event.target.value = "";
      }
    });
  document
    .getElementById("dipTradeForm")
    .addEventListener("submit", async (event) => {
      event.preventDefault();
      const button = event.submitter;
      button.disabled = true;
      try {
        const data = new FormData(event.target),
          symbol = data.get("symbol"),
          row = latest?.rows.find((r) => r.symbol === symbol);
        const trade = {
          id: "",
          symbol,
          quantity: Number(data.get("quantity")),
          price: Number(data.get("price")),
          accountDebit: Number(data.get("debit")),
          fxFee: Number(data.get("fee")),
          accountCurrency: data.get("currency"),
          fxRate: Number(data.get("fxRate")),
          tradeAt: new Date(data.get("tradeAt")).toISOString(),
          tier: row?.tier || "10-15",
          accountId: row?.accountId || "manual",
        };
        const reference = String(data.get("reference") || "").trim();
        const identity = reference
          ? { accountId: trade.accountId, reference }
          : {
              accountId: trade.accountId,
              symbol: trade.symbol,
              quantity: trade.quantity,
              price: trade.price,
              accountCurrency: trade.accountCurrency,
              accountDebit: trade.accountDebit,
              fxFee: trade.fxFee,
              fxRate: trade.fxRate,
              tradeAt: trade.tradeAt,
            };
        const digest = await crypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode(JSON.stringify(identity)),
        );
        trade.id =
          "buy:" +
          Array.from(new Uint8Array(digest), (x) =>
            x.toString(16).padStart(2, "0"),
          ).join("");
        await L.transact(indexedDB, (b) => L.buy(b, trade, Date.now()));
        event.target.reset();
        channel?.postMessage("changed");
        await refresh();
      } catch (e) {
        fail(e);
      } finally {
        button.disabled = false;
      }
    });
  root.addEventListener("wealthsimple:plan-updated", () => refresh());
  root.addEventListener("storage", () => refresh());
  if (channel) channel.onmessage = () => refresh();
  refresh();
})(window);

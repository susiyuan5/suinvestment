"""Paired, next-open exit experiments; these cohorts are not a portfolio.

Run: python -m research.take_profit_backtest
This writes only research/results/take_profit_v1 and never live policy/data.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import random
from collections import defaultdict
from dataclasses import asdict, replace
from pathlib import Path
from statistics import mean, median

from .take_profit_indicator import (
    TakeProfitParameters, new_position, normalize_adjusted_bars,
    update_take_profit, wilder_atr,
)

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "research" / "results" / "take_profit_v1"
STRATEGIES = ("no_take_profit", "fixed_20", "trail_10", "atr_3", "profit_50", "profit_lock_v1")
LABELS = {
    "no_take_profit": "无止盈＋共同止损", "fixed_20": "收盘涨20%止盈",
    "trail_10": "激活后峰值回落10%", "atr_3": "激活后3ATR跟踪",
    "profit_50": "激活后保留50%浮盈", "profit_lock_v1": "浮盈＋波动止盈V1",
}
PROTOCOL = {
    "schema_version": "take-profit-experiment-v1", "research_only": True,
    "parameters": asdict(TakeProfitParameters()), "horizon_sessions": 63,
    "cost_bps_per_side": 15, "common_initial_stop_atr": 3,
    "development": ["2016-01-01", "2020-12-31"],
    "test": ["2021-01-01", "2026-10-02"],
    "entry": "First observed session each month: prior close > SMA50 > SMA200; next observed open",
    "exit": "Completed close trigger; next observed session open; no intraday stop/limit assumptions",
    "cash": "After exit, zero-interest USD cash until shared 63-session end; no re-entry",
    "inference": "Paired monthly cohorts with overlapping 63-session windows; bootstrap all symbols together by entry calendar half-year",
    "claim_limit": "Chronological historical validation, not blind OOS or portfolio performance; no parameter fitting",
}


def simulate(rows, atr_values, signal_index, strategy="profit_lock_v1", *,
             params=None, horizon=63, cost_bps_per_side=15):
    """Use prior-bar ATR at entry; keep capital in cash through common end."""
    params = params or TakeProfitParameters()
    if strategy not in STRATEGIES:
        raise ValueError("unknown_strategy")
    if not isinstance(horizon, int) or horizon < 1:
        raise ValueError("invalid_horizon")
    if not 0 <= cost_bps_per_side < 10000:
        raise ValueError("invalid_cost")
    entry_index = signal_index + 1
    end = entry_index + horizon
    if signal_index < 0 or end >= len(rows) or len(atr_values) != len(rows):
        raise ValueError("insufficient_history_or_horizon")
    entry_atr = atr_values[signal_index]
    if entry_atr is None or entry_atr <= 0:
        raise ValueError("entry_atr_unavailable")
    entry = rows[entry_index]["open"]
    state = new_position(entry, entry_atr, parameters=params, entry_date=rows[entry_index]["date"])
    risk_line = entry - 3 * entry_atr
    cost = cost_bps_per_side / 10000
    path = [{"index": entry_index, "wealth": 1 - cost, "phase": "entry_open"}]
    reason, exit_index, exit_signal_date = "time_63", end, rows[end - 1]["date"]
    alternative_line = None
    peak = entry
    for index in range(entry_index, end):
        bar = rows[index]
        close = bar["close"]
        if atr_values[index] is None:
            raise ValueError("current_atr_unavailable")
        peak = max(peak, close)
        state = update_take_profit(state, close, atr_values[index], date=bar["date"])
        path.append({"index": index, "wealth": close / entry * (1 - cost), "phase": "held_close"})
        trigger = None
        if close <= risk_line:
            trigger = "common_risk_stop"
        elif strategy == "fixed_20" and close >= entry * 1.2:
            trigger = "fixed_target"
        elif strategy == "profit_lock_v1" and state.signal:
            trigger = "take_profit_line"
        elif state.active and strategy in ("trail_10", "atr_3", "profit_50"):
            candidate = {
                "trail_10": peak * 0.90,
                "atr_3": peak - params.atr_multiple * atr_values[index],
                "profit_50": entry + params.retain_profit * (peak - entry),
            }[strategy]
            alternative_line = max(alternative_line or candidate, candidate)
            if close <= alternative_line:
                trigger = "take_profit_line"
        if trigger:
            reason, exit_index, exit_signal_date = trigger, index + 1, bar["date"]
            break
    exit_price = rows[exit_index]["open"]
    peak = max(peak, exit_price)
    terminal = exit_price / entry * (1 - cost) ** 2
    for index in range(exit_index, end + 1):
        path.append({"index": index, "wealth": terminal, "phase": "cash"})
    running_peak, max_drawdown = 1.0, 0.0
    for point in path:
        running_peak = max(running_peak, point["wealth"])
        max_drawdown = max(max_drawdown, 1 - point["wealth"] / running_peak)
    peak_gain = max(0.0, peak / entry - 1)
    net_return = terminal - 1
    return {
        "strategy": strategy, "entry_date": rows[entry_index]["date"],
        "entry_price": entry, "entry_atr": entry_atr, "risk_line": risk_line,
        "exit_signal_date": exit_signal_date, "exit_date": rows[exit_index]["date"],
        "exit_price": exit_price, "exit_reason": reason,
        "time_end_date": rows[end]["date"], "net_return": net_return,
        "max_drawdown": max_drawdown, "held_sessions": exit_index - entry_index,
        "activated": state.active, "peak_gain": peak_gain,
        "giveback_pct_entry": max(0.0, peak_gain - net_return),
        "profit_to_loss": state.active and net_return < 0,
        "path": path,
    }


def entry_indices(rows, atr_values):
    """Monthly entry schedule and SMA filter use only the previous close."""
    closes = [row["close"] for row in rows]
    prefix = [0.0]
    for close in closes:
        prefix.append(prefix[-1] + close)
    for entry in range(200, len(rows) - 63):
        if rows[entry]["date"][:7] == rows[entry - 1]["date"][:7]:
            continue
        signal = entry - 1
        sma50 = (prefix[entry] - prefix[entry - 50]) / 50
        sma200 = (prefix[entry] - prefix[entry - 200]) / 200
        if closes[signal] > sma50 > sma200 and atr_values[signal]:
            yield signal


def split_for(entry_date, end_date):
    for split in ("development", "test"):
        start, end = PROTOCOL[split]
        if start <= entry_date and end_date <= end:
            return split
    return None


def summarize(trades):
    if not trades:
        return {"n": 0}
    activated = [t for t in trades if t["activated"]]
    returns = sorted(t["net_return"] for t in trades)
    return {
        "n": len(trades), "mean_net_return": mean(returns), "median_net_return": median(returns),
        "p10_net_return": returns[int((len(returns) - 1) * .1)],
        "mean_max_drawdown": mean(t["max_drawdown"] for t in trades),
        "mean_held_sessions": mean(t["held_sessions"] for t in trades),
        "mean_giveback_pct_entry": mean(t["giveback_pct_entry"] for t in trades),
        "activation_rate": len(activated) / len(trades),
        "activated_profit_to_loss_rate": (mean(t["profit_to_loss"] for t in activated) if activated else None),
        "take_profit_exit_rate": mean(t["exit_reason"] in ("take_profit_line", "fixed_target") for t in trades),
    }


def paired_comparison(trades, strategy, *, resamples=2000):
    baseline = {(t["symbol"], t["entry_date"]): t for t in trades if t["strategy"] == "no_take_profit"}
    pairs = []
    for trade in trades:
        if trade["strategy"] == strategy:
            base = baseline[(trade["symbol"], trade["entry_date"])]
            pairs.append((trade, trade["net_return"] - base["net_return"]))
    if not pairs:
        return {"n": 0}
    blocks = defaultdict(list)
    for trade, difference in pairs:
        year, month = trade["entry_date"][:4], int(trade["entry_date"][5:7])
        blocks[f"{year}-H{1 if month <= 6 else 2}"].append(difference)
    groups = list(blocks.values())
    rng = random.Random(20261004)
    bootstrap = []
    for _ in range(resamples):
        selected = [groups[rng.randrange(len(groups))] for _ in groups]
        bootstrap.append(sum(sum(group) for group in selected) / sum(map(len, selected)))
    bootstrap.sort()
    return {
        "n": len(pairs), "calendar_half_year_blocks": len(groups),
        "mean_paired_net_return": mean(d for _, d in pairs),
        "paired_outperformance_rate": mean(d > 0 for _, d in pairs),
        "ci95_low": bootstrap[int(resamples * .025)], "ci95_high": bootstrap[int(resamples * .975)],
        "ci_note": "Descriptive half-year block bootstrap; current-universe bias and boundary overlap remain",
    }


def write_csv(path, rows):
    if not rows:
        return
    with path.open("w", encoding="utf-8-sig", newline="") as file:
        writer = csv.DictWriter(file, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)


def run(prices_path, output):
    output.mkdir(parents=True, exist_ok=True)
    raw_bytes = prices_path.read_bytes()
    payload = json.loads(raw_bytes)
    if (payload.get("schema_version") != "take-profit-research-daily-prices-v1"
            or payload.get("research_only") is not True
            or payload.get("frequency") != "1d" or payload.get("currency") != "USD"):
        raise ValueError("invalid_research_price_snapshot")
    symbols = payload["symbols"]
    if not isinstance(symbols, dict) or not symbols:
        raise ValueError("empty_research_price_snapshot")
    checksum = hashlib.sha256(raw_bytes).hexdigest()
    coverage_path = prices_path.with_name("coverage.json")
    coverage = json.loads(coverage_path.read_text()) if coverage_path.exists() else None
    if coverage and coverage.get("prices_sha256") != checksum:
        raise ValueError("coverage_snapshot_checksum_mismatch")
    universe = json.loads((ROOT / "data" / "research-universe-sector-balanced-80.json").read_text())
    categories = {symbol: category for category, names in universe["category_metadata"].items() for symbol in names}
    # Persist the fixed design/protocol before computing any historical result.
    (output / "protocol.json").write_text(json.dumps(PROTOCOL, indent=2), encoding="utf-8")
    all_trades, examples, validation, sensitivity = [], {}, [], []
    variants = {
        "atr_2_5": replace(TakeProfitParameters(), atr_multiple=2.5),
        "atr_3_5": replace(TakeProfitParameters(), atr_multiple=3.5),
        "retain_40": replace(TakeProfitParameters(), retain_profit=.4),
        "retain_60": replace(TakeProfitParameters(), retain_profit=.6),
        "activation_3pct": replace(TakeProfitParameters(), activation_pct=.03),
        "activation_8pct": replace(TakeProfitParameters(), activation_pct=.08),
    }
    for symbol, raw_rows in sorted(symbols.items()):
        if symbol in {"BYDDY", "TCEHY"}:
            continue
        try:
            rows = normalize_adjusted_bars(raw_rows)
            if not rows or rows[-1]["date"] > PROTOCOL["test"][1]:
                raise ValueError("empty_or_future_rows")
            atr_values = wilder_atr(rows)
        except ValueError as exc:
            validation.append({"symbol": symbol, "valid": False, "error": str(exc)})
            continue
        validation.append({"symbol": symbol, "valid": True, "rows": len(rows),
                           "first": rows[0]["date"], "last": rows[-1]["date"]})
        category = "reference" if symbol in universe["reference_symbols"] else categories.get(symbol, "unknown")
        for signal in entry_indices(rows, atr_values):
            end = signal + 1 + 63
            split = split_for(rows[signal + 1]["date"], rows[end]["date"])
            if not split:
                continue
            cohort = []
            for strategy in STRATEGIES:
                trade = simulate(rows, atr_values, signal, strategy)
                path = trade.pop("path")
                trade.update(symbol=symbol, category=category, split=split, year=trade["entry_date"][:4])
                cohort.append(trade)
                if symbol == "SPY" and split == "test" and strategy == "profit_lock_v1" and trade["exit_reason"] == "take_profit_line":
                    examples.setdefault("SPY", {"signal_index": signal, "trade": trade, "path": path, "rows": rows, "atr": atr_values})
            all_trades.extend(cohort)
            if split == "development" and category != "reference":
                base = next(t for t in cohort if t["strategy"] == "no_take_profit")
                for name, parameters in variants.items():
                    trade = simulate(rows, atr_values, signal, params=parameters)
                    sensitivity.append({"variant": name, "symbol": symbol, "entry_date": trade["entry_date"],
                                        "net_return": trade["net_return"], "max_drawdown": trade["max_drawdown"],
                                        "paired_return": trade["net_return"] - base["net_return"]})
    summaries, comparisons = [], []
    for split in ("development", "test"):
        for population in ("stocks", "references", "stocks_ex_nvda", "stocks_ex_semiconductors"):
            selected = [t for t in all_trades if t["split"] == split and (
                (t["category"] == "reference") if population == "references" else
                t["category"] != "reference" and (population != "stocks_ex_nvda" or t["symbol"] != "NVDA")
                and (population != "stocks_ex_semiconductors" or t["category"] != "semiconductors")
            )]
            for strategy in STRATEGIES:
                summaries.append({"split": split, "population": population, "strategy": strategy,
                                  **summarize([t for t in selected if t["strategy"] == strategy])})
                if strategy != "no_take_profit":
                    comparisons.append({"split": split, "population": population, "strategy": strategy,
                                        **paired_comparison(selected, strategy)})
    annual, by_symbol, costs = [], [], []
    for grouping, result in (("year", annual), ("symbol", by_symbol)):
        for key in sorted({t[grouping] for t in all_trades}):
            for strategy in STRATEGIES:
                selected = [t for t in all_trades if t["split"] == "test" and t["category"] != "reference" and t[grouping] == key and t["strategy"] == strategy]
                if selected:
                    result.append({grouping: key, "strategy": strategy, **summarize(selected)})
    # All strategies make exactly one entry and exit. Cost changes are arithmetic,
    # and do not affect the price-coordinate signal; reprice independently.
    for cost in (0, 15, 30):
        for strategy in STRATEGIES:
            selected = [t for t in all_trades if t["split"] == "test" and t["category"] != "reference" and t["strategy"] == strategy]
            if selected:
                costs.append({"cost_bps_per_side": cost, "strategy": strategy, "n": len(selected),
                              "mean_net_return": mean(t["exit_price"] / t["entry_price"] * (1 - cost / 10000) ** 2 - 1 for t in selected)})
    sensitivity_summary = []
    for name, parameters in variants.items():
        selected = [t for t in sensitivity if t["variant"] == name]
        if selected:
            sensitivity_summary.append({"variant": name, **asdict(parameters), "n": len(selected),
                                        "mean_net_return": mean(t["net_return"] for t in selected),
                                        "mean_paired_return": mean(t["paired_return"] for t in selected),
                                        "mean_max_drawdown": mean(t["max_drawdown"] for t in selected)})
    result = {
        "protocol": PROTOCOL, "input": str(prices_path.relative_to(ROOT)) if prices_path.is_relative_to(ROOT) else str(prices_path),
        "sha256": checksum, "source": payload.get("source"),
        "validation": validation, "summaries": summaries, "comparisons": comparisons,
        "annual": annual, "by_symbol": by_symbol, "costs": costs,
        "development_sensitivity": sensitivity_summary,
        "acquisition_coverage": coverage,
        "fetch_failed_symbols": coverage.get("failed_symbols") if coverage else None,
    }
    (output / "summary.json").write_text(json.dumps(result, indent=2, ensure_ascii=False), encoding="utf-8")
    for name, records in (("trades", all_trades), ("summary", summaries), ("paired_comparison", comparisons),
                          ("annual", annual), ("by_symbol", by_symbol), ("costs", costs),
                          ("development_sensitivity", sensitivity_summary)):
        write_csv(output / f"{name}.csv", records)
    render_report(result, output, examples)
    return result


def pct(value):
    return "—" if value is None else f"{value * 100:.2f}%"


def render_report(result, output, examples):
    primary = [s for s in result["summaries"] if s["split"] == "test" and s["population"] == "stocks" and s["n"]]
    valid = [v for v in result["validation"] if v["valid"]]
    lines = [
        "# 美股止盈指标：浮盈＋波动止盈 V1", "",
        "用途：持有数周到数月的单次多头波段。状态为研究候选，历史比较不构成自动下单规则。", "",
        "## 可直接计算的规则", "",
        "E 是本次入场成本；H 是买入后最高收盘价（初始值 E）；A₀ 是买入前最后一根完整日线的 ATR14；Aₜ 是当日完整日线的 ATR14。", "",
        "1. 当 H−E ≥ max(5%×E, 2×A₀) 时激活，此后持续激活。",
        "2. 激活后：Lₜ = max(Lₜ₋₁, H−3×Aₜ, E+50%×(H−E))，首次激活省去前一日项。",
        "3. 收盘价 Cₜ ≤ Lₜ 时给出退出提示，研究回测按下一真实交易日开盘成交。止盈线只上移。",
        "4. 接近度 = clip[100×(H−C)/(H−L), 0, 100]；0 表示在峰值，100 表示触发。未激活显示空值；它不是下跌概率。", "",
        "ATR14 用 Wilder 平滑：首14根真实波幅取均值，此后 (13×前ATR+当日TR)/14。TR 为日内高低差、最高价与前收盘差、最低价与前收盘差的最大值。", "",
        "50%浮盈保留项在刚激活时通常比3ATR更紧，因此必须同时比较不含此项的3ATR版本。5%、2ATR、3ATR和50%均为事前设计值，没有由回测拟合为最优。", "",
        "**算例（仅演示）**：成本100，入场ATR=2；峰值升至120，当日ATR=3。激活门槛为5，候选线为 max(120−9,100+10)=111；若此前线更高，则沿用更高值。收盘跌到111或以下提示退出，次日跳空可能成交更低。", "",
        "## 数据与验证范围", "",
        f"来源：{result['source']}；有效证券 {len(valid)} 只；实际日线覆盖 {min(v['first'] for v in valid) if valid else '无'}—{max(v['last'] for v in valid) if valid else '无'}。",
        "股票池复用项目现有80只研究证券，排除BYDDY/TCEHY两个OTC标的；SPY/QQQ/DIA/IWM单列为ETF参考。美股上市ADR仍包括在个股组，海外业务和汇率影响没有单独建模。",
        "所有OHLC先统一复权。数据快照具有拆股/股息调整，回测收益属于复权总回报近似；实时应用必须把入场价、峰值和ATR统一到同一坐标，不能直接混用原始成本与复权线。", "",
        "2016—2020为开发期，2021—数据末日为较晚测试期。跨越区间边界的完整评价窗口剔除。按时间分段可减少调参泄漏，但这些市场历史及当前股票池已经可见，不能称为盲测。", "",
        "每月首个观察到的交易日，如果前日收盘>SMA50>SMA200，则当日开盘买入；共同初始风险线为E−3ATR₀，收盘触发、次日开盘退出。每组按63个完整交易日后的开盘统一评价，提前退出后现金收益为0、无重入，默认每边15基点成本。", "",
        "月度窗口会重叠，这些是配对退出实验，非可执行组合；下表收益是每个63日评价窗口的平均净收益，不能年化为组合CAGR、Sharpe或资金盈利预测。回撤是窗口内资金路径最大回撤的平均值，仅采样完整收盘及入场/退出开盘，不包含盘中最深回撤。", "",
        "## 较晚测试期：个股", "",
        "|退出规则|样本数|平均63日净收益|中位数|10%分位收益|平均窗口回撤|平均持仓日数|",
        "|---|---:|---:|---:|---:|---:|---:|",
    ]
    for item in primary:
        lines.append(f"|{LABELS[item['strategy']]}|{item['n']}|{pct(item['mean_net_return'])}|{pct(item['median_net_return'])}|{pct(item['p10_net_return'])}|{pct(item['mean_max_drawdown'])}|{item['mean_held_sessions']:.1f}|")
    lines += ["", "## 与无止盈＋共同止损的配对差异", "", "|范围|V1平均收益差（百分点）|描述性95%区间|半年度块数|", "|---|---:|---:|---:|"]
    for item in result["comparisons"]:
        if item["split"] == "test" and item["strategy"] == "profit_lock_v1" and item["n"]:
            lines.append(f"|{item['population']}|{item['mean_paired_net_return']*100:+.2f}|[{item['ci95_low']*100:+.2f}, {item['ci95_high']*100:+.2f}]|{item['calendar_half_year_blocks']}|")
    pair = next((p for p in result["comparisons"] if p["split"] == "test" and p["population"] == "stocks" and p["strategy"] == "profit_lock_v1" and p["n"]), None)
    if pair:
        if pair["mean_paired_net_return"] < 0:
            lines += ["", "**结论：V1在该测试中牺牲了平均收益。** 它只能按保护浮盈的工具评估，不能作为提高收益的推荐方案；如果追求长期趋势收益，应慎用过早收紧的盈利保留线。"]
        else:
            lines += ["", "V1在该测试中平均收益高于基准，但当前股票池偏差、相关样本和信号入场依赖仍限制结论，不能据此确认未来优势。"]
    v1 = next((s for s in primary if s["strategy"] == "profit_lock_v1"), None)
    base = next((s for s in primary if s["strategy"] == "no_take_profit"), None)
    if v1 and base:
        lines += ["", f"在达到相同激活门槛的窗口中，最终净收益转负的比例从基准 {pct(base['activated_profit_to_loss_rate'])} 降至V1 {pct(v1['activated_profit_to_loss_rate'])}。这描述了浮盈保护效果，同时仍存在亏损成交。"]
    lines += ["", "成本敏感性（较晚测试期个股，双边成本独立重算）：", "", "|每边成本|无止盈平均净收益|V1平均净收益|", "|---|---:|---:|"]
    for cost in (0, 15, 30):
        lookup = {c["strategy"]: c for c in result["costs"] if c["cost_bps_per_side"] == cost}
        if "no_take_profit" in lookup and "profit_lock_v1" in lookup:
            lines.append(f"|{cost}bp|{pct(lookup['no_take_profit']['mean_net_return'])}|{pct(lookup['profit_lock_v1']['mean_net_return'])}|")
    lines += ["", "![历史退出规则比较](comparison.png)", "", "## 使用边界与可复现证据", "",
        "- 只有实际盈利达到激活门槛才启动；未激活时本指标不承担亏损保护，初始风险止损需另设。",
        "- 当前股票池回填历史，缺少退市股票和逐时成分数据，有幸存者/选择偏差；某些拆分公司历史也可能经过供应商重写。没有纳入税、真实成交量冲击、CAD汇率或现金利息。",
        "- 接近度只显示价格位置，未验证任何分数阈值的减仓效果。该版本比较的是全部退出，不含分批止盈。",
        "- 半年度块自助区间保留同一时期股票相关性，但样本块不多且边界仍可相互重叠，区间仅作描述性参考。",
        "- 历史资料按提供商复权方式研究；实时落地需要持仓状态持久化、拆股与股息处理、数据新鲜度检查和人工决定，当前未接入交易面板。", "",
        "复现：`python -m research.fetch_take_profit_prices` 然后 `python -m research.take_profit_backtest`。",
        "`protocol.json`保存固定参数和区间；`prices.json`与`coverage.json`保存原始行情和缺失情况；`trades.csv`保存每笔配对结果；`summary.json`记录输入SHA256、验证、年度/证券、排除NVDA/半导体、成本和仅开发期的单参数敏感性。", "",
        f"输入SHA256：`{result['sha256']}`。", "",
        "## 方法来源", "",
        "ATR定义与平滑：[Fidelity ATR](https://www.fidelity.com/learning-center/trading-investing/technical-analysis/technical-indicator-guide/atr)。",
        "波动跟踪退出的既有思路：[TradingView Chandelier Exit](https://www.tradingview.com/support/solutions/43000773013-chandelier-exit/)。本设计使用入场后的最高收盘及浮盈保留，公式与标准Chandelier不同。",
        "止损触发价不是保证成交价：[SEC Investor Bulletin](https://www.investor.gov/introduction-investing/general-resources/news-alerts/alerts-bulletins/investor-bulletins-15)。",
    ]
    (output / "REPORT.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    draw_charts(result, output, examples)


def draw_charts(result, output, examples):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    plt.rcParams["font.sans-serif"] = ["Microsoft YaHei", "DejaVu Sans"]
    plt.rcParams["axes.unicode_minus"] = False
    selected = [s for s in result["summaries"] if s["split"] == "test" and s["population"] == "stocks" and s["n"]]
    if not selected:
        return
    fig, axes = plt.subplots(1, 2, figsize=(13, 5.2), constrained_layout=True)
    labels = [LABELS[s["strategy"]] for s in selected]
    colors = ["#47789a" if s["strategy"] != "profit_lock_v1" else "#cb693f" for s in selected]
    for axis, metric, title in ((axes[0], "mean_net_return", "平均63日窗口净收益（%）"),
                                (axes[1], "mean_max_drawdown", "平均窗口最大回撤（%，越低越小）")):
        values = [s[metric] * 100 for s in selected]
        bars = axis.barh(labels, values, color=colors)
        axis.axvline(0, color="#aaaaaa", linewidth=.8)
        axis.bar_label(bars, fmt="%.2f", padding=4)
        axis.set_title(title)
        axis.invert_yaxis()
        axis.margins(x=.15)
        axis.spines[["top", "right"]].set_visible(False)
    fig.suptitle(f"2021—2026 较晚历史测试 · {selected[0]['n']} 个配对入场窗口\n共同初始止损；次日开盘；每边15bp；当前股票池有幸存者偏差", fontsize=12)
    fig.savefig(output / "comparison.png", dpi=170)
    plt.close(fig)
    for symbol, example in examples.items():
        rows, atr_values = example["rows"], example["atr"]
        signal = example["signal_index"]
        entry_index, end = signal + 1, signal + 64
        state = new_position(rows[entry_index]["open"], atr_values[signal])
        line, close = [], []
        for index in range(entry_index, end):
            state = update_take_profit(state, rows[index]["close"], atr_values[index], date=rows[index]["date"])
            line.append(state.line if state.active else float("nan"))
            close.append(rows[index]["close"])
        fig, ax = plt.subplots(figsize=(10, 4), constrained_layout=True)
        ax.plot(close, label="复权收盘")
        held = example["trade"]["held_sessions"]
        ax.plot(range(held), line[:held], label="研究止盈线", color="#cb693f")
        ax.plot(range(held - 1, len(line)), line[held - 1:], linestyle=":", color="#cb693f", label="持有反事实")
        ax.axvline(held, linestyle="--", color="#666666", label="次日开盘退出")
        ax.set_title(f"{symbol} 示例 {rows[entry_index]['date']} · 退出后虚线右侧为持有反事实，指标实际应停止")
        ax.set_xlabel("入场后的交易日")
        ax.set_ylabel("统一复权价格坐标（USD）")
        ax.legend()
        fig.savefig(output / "example.png", dpi=170)
        plt.close(fig)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--prices", type=Path, default=OUT / "prices.json")
    parser.add_argument("--output", type=Path, default=OUT)
    args = parser.parse_args()
    result = run(args.prices.resolve(), args.output.resolve())
    selected = [s for s in result["summaries"] if s["split"] == "test" and s["population"] == "stocks"]
    print(json.dumps({"output": str(args.output), "test_stocks": selected}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()

"""compare_algorithms.py - compare old simple vs v1 vs v2."""
import json, math
from datetime import date
from backtest import run_backtest
from config import BacktestConfig, StrategyConfig
from data_loader import PricePoint

def _v1_multiplier(wr, rr=None, cd=0, dd=0.0, sens=4.0, mn=0.3, mx=2.0, tv=0.04):
    m = 1.0 - sens * wr * 100 / 100.0
    if rr and len(rr) >= 4:
        rv = math.sqrt(sum((x - sum(rr)/len(rr))**2 for x in rr)/(len(rr)-1))
        if rv > 0 and tv > 0: m *= max(0.7, min(1.1, tv / rv))
    if cd >= 8: m = min(m, 1.2)
    elif cd >= 4: m = min(m, 1.5)
    if dd > 0.35: m = min(m, 1.1)
    elif dd > 0.20: m = min(m, 1.3)
    return max(mn, min(mx, round(m+1e-9, 2)))

def load_prices(path="data/backtest-prices.json"):
    with open(path) as fp:
        data = json.load(fp)
    return {sym: [PricePoint(date(*[int(x) for x in p["date"].split("-")]), p["close"]) for p in prices]
            for sym, prices in data["symbols"].items()}

def max_dd_pct(vals):
    peak = 0.0; dd = 0.0
    for v in vals:
        peak = max(peak, v)
        if peak > 0: dd = max(dd, (peak - v) / peak)
    return dd * 100

def ann_vol_pct(ret):
    if len(ret) < 2: return 0.0
    n = len(ret); m = sum(ret)/n
    return math.sqrt(sum((r-m)**2 for r in ret)/(n-1)) * math.sqrt(52) * 100

def fmt(v): return "{:>8.0f}".format(v)
def pct_str(n, d): return "{:>+8.2f}%".format((n/d-1)*100) if d != 0 else "     N/A"

def main():
    data = load_prices()
    symbols = ["NVDA", "MSFT", "AAPL", "ASML", "KO", "BYDDY"]
    cfg = BacktestConfig(strategy=StrategyConfig(base_buy_amount=100,sensitivity=4,min_multiplier=0.3,max_multiplier=2.0,initial_cash=10000,commission_rate=0.001,slippage_rate=0.0005,strategy_mode="dip_buy",fractional_shares=True))

    print("{:>6} {:>20} {:>12} {:>12} {:>12}".format("Symbol","Metric","Old","v1","v2"))
    print("-" * 64)
    sf = [0,0,0]; si = [0,0,0]

    for sym in symbols:
        pts = data.get(sym, [])
        if len(pts) < 2: continue
        res_old = run_backtest(sym, pts, cfg, save_results=False)
        res_v2 = run_backtest(sym, pts, cfg, save_results=False, use_risk_adjusted=True)

        cash = cfg.strategy.initial_cash; shares = 0.0; invested = 0.0
        v1_vals = [cash]; recent_ret = []; prev_peak = pts[0].close; cd_streak = 0
        for idx in range(1, len(pts)):
            wr = (pts[idx].close - pts[idx-1].close) / pts[idx-1].close
            recent_ret.append(wr)
            if len(recent_ret) > 52: recent_ret.pop(0)
            cd_streak = cd_streak + 1 if wr < 0 else 0
            peak = max(prev_peak, pts[idx].close); prev_peak = peak
            dd_raw = 1 - pts[idx].close / peak if peak > 0 else 0
            mult = _v1_multiplier(wr, recent_ret[-12:] if recent_ret else None, cd_streak, dd_raw)
            amt = min(cfg.strategy.base_buy_amount * mult, cash * 0.3)
            amt = min(amt, cash / (1 + cfg.strategy.commission_rate))
            if amt > 0 and pts[idx].close > 0:
                cost = amt * (1 + cfg.strategy.commission_rate)
                if cost <= cash: cash -= cost; shares += amt / pts[idx].close; invested += cost
            v1_vals.append(cash + shares * pts[idx].close)

        old_vals = [p.portfolio_value for p in res_old.history]
        v2_vals = [p.portfolio_value for p in res_v2.history]
        o_ret = [(old_vals[i]/old_vals[i-1]-1) for i in range(1,len(old_vals)) if old_vals[i-1]>0]
        v_ret = [(v2_vals[i]/v2_vals[i-1]-1) for i in range(1,len(v2_vals)) if v2_vals[i-1]>0]

        roi = [0,0,0]
        roi[0] = (old_vals[-1]/res_old.total_invested-1)*100 if res_old.total_invested>0 else 0
        roi[1] = (v1_vals[-1]/invested-1)*100 if invested>0 else 0
        roi[2] = (v2_vals[-1]/res_v2.total_invested-1)*100 if res_v2.total_invested>0 else 0

        dds = [max_dd_pct(old_vals), max_dd_pct(v1_vals), max_dd_pct(v2_vals)]
        vols = [ann_vol_pct(o_ret), 0.0, ann_vol_pct(v_ret)]
        fvs = [old_vals[-1], v1_vals[-1], v2_vals[-1]]
        invs = [res_old.total_invested, invested, res_v2.total_invested]

        print()
        print("  {:>4} {:>20} {:>12} {:>12} {:>12}".format(sym,"Final Value",fmt(fvs[0]),fmt(fvs[1]),fmt(fvs[2])))
        print("  {:>4} {:>20} {:>12} {:>12} {:>12}".format("","Invested",fmt(invs[0]),fmt(invs[1]),fmt(invs[2])))
        print("  {:>4} {:>20} {:>11}% {:>11}% {:>11}%".format("","ROI vs Investigated","{:.2f}".format(roi[0]),"{:.2f}".format(roi[1]),"{:.2f}".format(roi[2])))
        print("  {:>4} {:>20} {:>11}% {:>11}% {:>11}%".format("","Max Drawdown","{:.2f}".format(dds[0]),"{:.2f}".format(dds[1]),"{:.2f}".format(dds[2])))

        for k in range(3): sf[k] += fvs[k]; si[k] += invs[k]

    print(); print("=" * 64); print("SUMMARY"); print("=" * 64)
    print("  {:>20}: {:>10.0f}  {:>10.0f}  {:>10.0f}".format("Final Value Total", sf[0], sf[1], sf[2]))
    print("  {:>20}: {:>10.0f}  {:>10.0f}  {:>10.0f}".format("Invested Total", si[0], si[1], si[2]))
    print()
    if sf[0]: print("  v1 vs Old: {:+>8.2f}%".format((sf[1]/sf[0]-1)*100))
    if sf[0]: print("  v2 vs Old: {:+>8.2f}%".format((sf[2]/sf[0]-1)*100))

if __name__ == "__main__":
    main()

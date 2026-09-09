'use strict';
const DAY = 86400000;
function xirr(flows) {
  if (!flows.some(x => x.amount < 0) || !flows.some(x => x.amount > 0)) return null;
  const first = Date.parse(flows[0].date);
  const terms = flows.map(x => [x.amount, (Date.parse(x.date) - first) / (365 * DAY)]);
  if (!terms.some(x => x[1] > 0)) return null;
  const npv = logRate => terms.reduce((s, [amount, years]) => s + amount * Math.exp(-logRate * years), 0);
  let lo = -20, hi = 20;
  if (npv(lo) * npv(hi) > 0) return null;
  for (let i = 0; i < 160; i++) { const mid = (lo + hi) / 2; if (npv(mid) > 0) lo = mid; else hi = mid; }
  const result = Math.expm1((lo + hi) / 2);
  return Number.isFinite(result) ? result : null;
}
function performance(curve, flows) {
  let nav = 1, peak = 1, maxDrawdown = 0, previous = 0, cashFraction = 0;
  for (const row of curve) {
    const denominator = previous + (row.deposit || 0);
    if (denominator > 0) nav *= row.value / denominator;
    peak = Math.max(peak, nav);
    maxDrawdown = Math.max(maxDrawdown, 1 - nav / peak);
    cashFraction += row.value > 0 ? row.cash / row.value : 0;
    previous = row.value;
  }
  const last = curve.at(-1);
  const years = curve.length > 1 ? (Date.parse(last.date) - Date.parse(curve[0].date)) / (365 * DAY) : 0;
  const annualized = years > 0 && nav > 0 ? Math.pow(nav, 1 / years) - 1 : null;
  return { xirr: last ? xirr(flows.concat([{ date: last.date, amount: last.value }])) : null,
    timeWeightedReturn: nav - 1, annualizedTimeWeightedReturn: annualized, maxDrawdown,
    calmar: annualized !== null && maxDrawdown > 0 ? annualized / maxDrawdown : null,
    averageCashFraction: curve.length ? cashFraction / curve.length : null };
}
module.exports = { xirr, performance };

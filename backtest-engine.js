(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.BacktestEngine = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function cagr(finalValue, totalInvested, numberOfWeeks) {
    if (totalInvested <= 0 || numberOfWeeks < 1) return null;
    const years = numberOfWeeks / 52;
    return years > 0 ? Math.pow(finalValue / totalInvested, 1 / years) - 1 : null;
  }
  function annualizedVolatility(returns) {
    if (!Array.isArray(returns) || returns.length < 2) return null;
    const average = returns.reduce((sum, value) => sum + value, 0) / returns.length;
    const variance = returns.reduce((sum, value) => sum + Math.pow(value - average, 2), 0) / (returns.length - 1);
    return variance > 0 ? Math.sqrt(variance) * Math.sqrt(52) : null;
  }
  function downsideDeviation(returns) {
    if (!Array.isArray(returns) || returns.length < 2) return null;
    const negatives = returns.filter((value) => value < 0);
    if (negatives.length < 2) return 0;
    const average = negatives.reduce((sum, value) => sum + value, 0) / negatives.length;
    const variance = negatives.reduce((sum, value) => sum + Math.pow(value - average, 2), 0) / (negatives.length - 1);
    return variance > 0 ? Math.sqrt(variance) * Math.sqrt(52) : 0;
  }
  function returnVolatility(returns) {
    if (!Array.isArray(returns) || returns.length < 2) return 0;
    const average = returns.reduce((sum, value) => sum + value, 0) / returns.length;
    return Math.sqrt(returns.reduce((sum, value) => sum + Math.pow(value - average, 2), 0) / (returns.length - 1));
  }
  function sharpe(growth, volatility) { return growth == null || volatility == null || volatility <= 0 ? null : growth / volatility; }
  function sortino(growth, downside) { return growth == null || downside == null || downside <= 0 ? null : growth / downside; }
  function calmar(growth, maxDrawdownPct) { return growth == null || maxDrawdownPct == null || maxDrawdownPct <= 0 ? null : growth / (Math.abs(maxDrawdownPct) / 100); }

  function simulateStrategy(aligned, mode, config) {
    const positions = aligned.reduce(function (items, item) {
      items[item.stock.symbol] = { shares: 0, invested: 0, buys: 0 };
      return items;
    }, {});
    const history = [];
    const returnHistory = [];
    let totalInvested = 0;
    let totalBuys = 0;
    let totalFrictionCost = 0;
    let peakValue = 0;
    let maxDrawdown = 0;
    for (let index = 1; index < aligned[0].prices.length; index += 1) {
      const regime = config.marketRegime(aligned, index);
      aligned.forEach(function (item) {
        const current = item.prices[index].close;
        const previous = item.prices[index - 1].close;
        const weeklyReturn = previous > 0 ? ((current - previous) / previous) * 100 : 0;
        const baseAmount = config.weeklyAmount * item.stock.allocation;
        let multiplier = 1;
        if (mode === "enhanced") multiplier = config.enhancedMultiplier(item.prices, index, weeklyReturn, regime);
        else if (mode === "smooth") multiplier = config.smoothMultiplier(weeklyReturn);
        else if (mode === "old") multiplier = config.oldMultiplier(weeklyReturn);
        const rawAmount = mode === "dca" ? baseAmount : baseAmount * multiplier;
        if (rawAmount <= 0 || current <= 0) return;
        const effectiveAmount = rawAmount * (1 - config.frictionCostRate);
        const position = positions[item.stock.symbol];
        position.shares += effectiveAmount / current;
        position.invested += rawAmount;
        position.buys += 1;
        totalInvested += rawAmount;
        totalBuys += 1;
        totalFrictionCost += rawAmount - effectiveAmount;
      });
      const value = aligned.reduce((sum, item) => sum + positions[item.stock.symbol].shares * item.prices[index].close, 0);
      const previousValue = history.length ? history.at(-1).value : 0;
      if (previousValue > 0) returnHistory.push((value - previousValue) / previousValue);
      peakValue = Math.max(peakValue, value);
      maxDrawdown = Math.max(maxDrawdown, peakValue > 0 ? ((peakValue - value) / peakValue) * 100 : 0);
      history.push({ date: aligned[0].prices[index].date, value });
    }
    let weightedAverageNumerator = 0;
    const finalValue = history.length ? history.at(-1).value : 0;
    const tickerRows = aligned.map(function (item) {
      const position = positions[item.stock.symbol];
      const averagePrice = position.shares > 0 ? position.invested / position.shares : 0;
      weightedAverageNumerator += averagePrice * position.invested;
      return { symbol: item.stock.symbol, invested: config.round2(position.invested), buys: position.buys, avg_buy_price: config.round2(averagePrice), final_value: config.round2(position.shares * item.prices.at(-1).close) };
    });
    const numberOfWeeks = aligned[0].prices.length - 1;
    const totalPotential = numberOfWeeks * config.weeklyDeployment;
    return {
      final_value: config.round2(finalValue), total_invested: config.round2(totalInvested),
      total_return: totalInvested > 0 ? config.round2(((finalValue - totalInvested) / totalInvested) * 100) : 0,
      max_drawdown: config.round2(maxDrawdown), volatility: config.round2(returnVolatility(returnHistory) * 100),
      number_of_buys: totalBuys, average_buy_price: totalInvested > 0 ? config.round2(weightedAverageNumerator / totalInvested) : 0,
      tickers: tickerRows, equity_curve: history, return_history: returnHistory,
      worst_week_return: config.round2((returnHistory.length ? Math.min.apply(null, returnHistory) : 0) * 100),
      best_week_return: config.round2((returnHistory.length ? Math.max.apply(null, returnHistory) : 0) * 100),
      total_friction_cost: config.round2(totalFrictionCost), average_weekly_buy: numberOfWeeks > 0 ? config.round2(totalInvested / numberOfWeeks) : 0,
      cash_usage_ratio: totalPotential > 0 ? config.round2(totalInvested / totalPotential * 100) : 0, number_of_weeks: numberOfWeeks
    };
  }

  return Object.freeze({ cagr, annualizedVolatility, downsideDeviation, returnVolatility, sharpe, sortino, calmar, simulateStrategy });
});

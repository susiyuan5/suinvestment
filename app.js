(function () {
  "use strict";

  const CONFIG = {
    cacheHours: 24,
    weeklySnapshotUrl: "data/market-data.json",
    backtestSnapshotUrl: "data/backtest-prices.json",
    requestTimeoutMs: 9000,
    qqqPanicThreshold: -10,
    panicMultiplier: 1.3,
    panicSymbols: new Set(["MSFT", "NVDA", "AAPL", "ASML"]),
    defaultStocks: [
      { symbol: "BYDDY", name: "BYD Company Limited", allocation: 0.3 },
      { symbol: "MSFT", name: "Microsoft Corporation", allocation: 0.22 },
      { symbol: "NVDA", name: "NVIDIA Corporation", allocation: 0.18 },
      { symbol: "AAPL", name: "Apple Inc.", allocation: 0.15 },
      { symbol: "ASML", name: "ASML Holding N.V.", allocation: 0.1 },
      { symbol: "KO", name: "The Coca-Cola Company", allocation: 0.05 }
    ]
  };

  const STORAGE_KEYS = {
    apiKey: "su-investment-pro:finnhub-key",
    cache: "su-investment-pro:market-cache",
    overrides: "su-investment-pro:manual-overrides",
    portfolio: "su-investment-pro:portfolio",
    portfolioRisk: "su-investment-pro:portfolio-risk",
    language: "su-investment-pro:language",
    deployment: "su-investment-pro:deployment"
  };

  const DEFAULT_DEPLOYMENT = {
    monthlyBudget: 400,
    normalPool: 300,
    crashFund: 100
  };

  const WEEKS_PER_MONTH = 52 / 12;

  const ALGORITHM_PARAMS = {
    sensitivity: 4,
    minMultiplier: 0.3,
    maxMultiplier: 2.0,
    strongDropThreshold: -15,
    strongRiseThreshold: 10,
    volatilityDailyThreshold: 8,
    volatilityWeeklyThreshold: 15,
    extremeWeeklyThreshold: 25,
    maxDowntrendMultiplier: 1.5,
    severeDowntrendMultiplier: 1.2,
    crashBoost: 0.12,
    volatilityReduction: 0.9,
    underAllocationScoreBonus: 5,
    overAllocationScorePenalty: 10,
    farOverAllocationScorePenalty: 25
  };

  const LOW_FREQ_ALGO_PARAMS = {
    marketRegimeEnabled: true,
    trendFilterEnabled: true,
    volatilityAdjustmentEnabled: true,
    drawdownFilterEnabled: true,
    targetWeeklyVolatility: 0.04,
    maxBullMultiplier: 2.0,
    maxNeutralMultiplier: 1.5,
    maxCorrectionMultiplier: 1.3,
    maxBearMultiplier: 1.1,
    maxDrawdown20Multiplier: 1.3,
    maxDrawdown35Multiplier: 1.1,
    overTargetReduceThreshold: 0.05,
    overTargetBlockThreshold: 0.10,
    overTargetSellWatchThreshold: 0.15
  };
  const NEWS_FACTOR_PARAMS = {
    enabled: true,
    lookbackDays: 14,
    materialNewsLookbackDays: 7,
    positiveSentimentBonus: 5,
    negativeSentimentPenalty: 10,
    severeNegativePenalty: 20,
    maxPositiveScoreBonus: 8,
    maxNegativeScorePenalty: 25,
    reduceBuyOnSevereNegativeNews: true
  };

  const FUNDAMENTAL_FACTOR_PARAMS = {
    enabled: true,
    revenueGrowthWeight: 0.25,
    epsGrowthWeight: 0.25,
    marginTrendWeight: 0.20,
    debtRiskWeight: 0.15,
    freeCashFlowWeight: 0.15,
    strongFundamentalBonus: 8,
    weakFundamentalPenalty: 15,
    severeFundamentalPenalty: 25
  };

  const I18N = {
    en: {
      pageTitle: "Quant Decision Dashboard",
      heroEyebrow: "Quant decision support",
      heroTitle: "Quant Decision Dashboard",
      heroCopy: "Review signals, portfolio risk, and manual trade plans before placing your own orders.",
      scheduleLabel: "Every Tuesday",
      monthlySettings: "Monthly settings",
      deploymentPlan: "Deployment Plan",
      settings: "Settings",
      monthlyBudget: "Monthly Budget",
      normalPool: "Normal Pool",
      crashFund: "Crash Fund",
      weeklyDeployment: "Weekly Deployment",
      deploymentSettings: "Deployment Settings",
      save: "Save",
      resetDefaults: "Reset",
      deploymentSaved: "Deployment settings saved.",
      deploymentReset: "Deployment settings reset to defaults.",
      invalidDeploymentInput: "Enter a valid non-negative number.",
      backtestEyebrow: "Backtest comparison",
      backtestTitle: "Enhanced low-frequency strategy vs Smooth dip-buy vs Old threshold dip-buy vs Fixed DCA",
      runBacktest: "Run Backtest",
      backtestIntro: "Compare enhanced low-frequency strategy, smooth dip-buy, old threshold dip-buy, and fixed DCA using current tickers, allocations, and deployment settings.",
      backtestRunning: "Running backtest...",
      backtestFailed: "Backtest failed. Historical data may be unavailable.",
      backtestNeedData: "Need at least two weekly prices per ticker.",
      dipBuyStrategy: "Smooth weekly dip-buy",
      fixedDcaStrategy: "Fixed weekly DCA",
      finalValue: "Final Value",
      totalReturn: "Total Return",
      maxDrawdown: "Max Drawdown",
      numberOfBuys: "Number of Buys",
      avgBuyPrice: "Avg Buy Price",
      beatsDca: "Beats Fixed DCA",
      yes: "Yes",
      no: "No",
      strategy: "Strategy",
      ticker: "Ticker",
      invested: "Invested",
      backtestWindow: "Backtest window",
      enhancedDipBuyStrategy: "Enhanced low-frequency strategy",
      smoothDipBuyStrategy: "Smooth dip-buy",
      oldDipBuyStrategy: "Old threshold dip-buy",
      beatsOld: "Beats Old Strategy",
      beatsSmooth: "Beats Smooth Strategy",
      bestStrategy: "Best Strategy",
      worstStrategy: "Worst Strategy",
      volatility: "Volatility",
      algorithmDetails: "Algorithm Details",
      marketRegime: "Market regime",
      trendStatus: "Trend status",
      volatilityStatus: "Volatility status",
      drawdownStatus: "Drawdown status",
      finalMultiplier: "Final multiplier",
      rawSmooth: "raw",
      volAdj: "vol",
      regimeCap: "regime cap",
      trendCap: "trend cap",
      drawdownCap: "drawdown cap",
      portfolioAdj: "portfolio",
      finalMultiplierShort: "final",
      regimeBull: "Bull",
      regimeNeutral: "Neutral",
      regimeCorrection: "Correction",
      regimeBear: "Bear",
      trendHealthyPullback: "Pullback within uptrend",
      trendStrongDowntrend: "Strong downtrend",
      trendMixed: "Mixed trend",
      volatilityLow: "Low volatility",
      volatilityNormal: "Normal volatility",
      volatilityHigh: "High volatility",
      drawdownNormal: "Normal drawdown",
      drawdownModerate: "Moderate drawdown",
      drawdownDeep: "Deep drawdown",
      drawdownSevere: "Severe drawdown",
      pullbackWithinUptrendReason: "Pullback within uptrend supports the dip-buy amount.",
      marketRegimeReason: "Market regime is {regime}, so the maximum multiplier is capped at {cap}.",
      volatilityAdjustmentReason: "Realized weekly volatility adjusted the multiplier by {adjustment}.",
      drawdownCapReason: "Recent drawdown is {drawdown}, so the multiplier is capped for risk control.",
      enhancedAlgorithmSummary: "Recent pullback supports buying, but trend, volatility, drawdown, market regime, and portfolio rules may cap the final amount.",
      marketCorrectionWarning: "Market correction regime; multiplier capped",
      marketBearWarning: "Bear market regime; multiplier capped",
      highVolatilityWarning: "High weekly volatility",
      severeDrawdownWarning: "Severe drawdown; manual review required",
      algorithmTestEyebrow: "Algorithm test",
      algorithmTestTitle: "Algorithm Test Panel",
      algorithmTestInput: "decision_change",
      algorithmTestSafety: "This test panel is manual decision support only. It does not change real portfolio data, market data, signals, or trade plans.",
      invalidAlgorithmTestInput: "Enter a valid decision_change number.",
      testScenario: "Test scenario",
      testOnly: "Test only",
      smoothMultiplierReason: "Recent pullback is {move}, so the smooth dip-buy model set the multiplier to {multiplier}.",
      smoothRiseReason: "Recent strength is {move}, so the smooth model reduced the multiplier to {multiplier}.",
      smoothNeutralReason: "Recent move is mild, so the smooth model keeps the multiplier near {multiplier}.",
      volatilityReducedReason: "Large recent volatility reduced the multiplier by 10%.",
      downtrendCappedReason: "Strong downtrend detected; buy amount capped.",
      portfolioNearTargetReason: "Position is near target allocation, so no portfolio adjustment was applied.",
      dataQualityReason: "Data quality affected the score and action.",
      volatilityReducedWarning: "Volatility reduced the buy amount",
      downtrendCappedWarning: "Strong downtrend detected; buy amount capped",
      extremeMoveWarning: "Extreme weekly move; manual review required",
      panicTitle: "PANIC MODE ACTIVE",
      panicBody: "QQQ buy signal is at or below -10%",
      allocations: "Allocations",
      thisTuesday: "This Tuesday",
      searchStock: "Search stock",
      searchPlaceholder: "Ticker or name, e.g. TSLA or Visa",
      allocationPercent: "Allocation %",
      search: "Search",
      dataSourcePriority: "Data source priority",
      liveMarketData: "Live Market Data",
      finnhub: "Finnhub",
      yahooFallback: "Yahoo Finance fallback",
      cache: "Cache",
      manualOverride: "Manual Override",
      dataFinePrint: "Buy signal uses the lower of the latest 1-day and 5-day moves. Manual overrides always take priority for that stock.",
      portfolioRiskDashboard: "Portfolio risk dashboard",
      portfolioRisk: "Portfolio Risk",
      savePortfolio: "Save Portfolio",
      availableCash: "Available Cash",
      availableCashPlaceholder: "CAD available cash",
      copyOrderList: "Copy order list",
      manualTradePlan: "Manual Trade Plan",
      copy: "Copy",
      liveMarketDataEyebrow: "Live market data",
      priceSettings: "Price Settings",
      closePriceSettings: "Close price settings",
      finnhubApiKey: "Finnhub API Key",
      apiKeyPlaceholder: "Enter key for live prices",
      refreshPrices: "Refresh Prices",
      sourcePriority: "Source priority",
      sourcePriorityLine: "Finnhub → Yahoo fallback → Cache → Manual Override",
      signalScore: "signal_score",
      signalStrength: "signal_strength",
      riskLevel: "risk_level",
      multiplier: "Multiplier",
      buy: "Buy",
      suggestedBuy: "Suggested Buy",
      symbol: "Symbol",
      action: "Action",
      source: "Source",
      controls: "Controls",
      reason: "reason",
      warning: "warning",
      overridePlaceholder: "Manual weekly %, e.g. -9.2",
      applyOverride: "Apply Override",
      clearOverride: "Clear Override",
      remove: "Remove",
      loading: "Loading",
      priceLoading: "Price loading",
      waitingForMarketData: "Waiting for market data.",
      fetchingMarketData: "Fetching market data",
      refreshingMarketData: "Refreshing market data.",
      refreshing: "Refreshing...",
      updated: "Updated",
      noLiveData: "No live data yet",
      price: "Price",
      priceUnavailable: "Price unavailable",
      allocation: "allocation",
      totalAllocation: "Total allocation",
      none: "None",
      notProvided: "Not provided",
      totalPortfolioValue: "Total Portfolio Value",
      plannedBuyTotal: "Planned Buy Total",
      plannedCashUsage: "Planned Cash Usage",
      largestPosition: "Largest Position",
      overallRisk: "Overall Risk",
      overAllocated: "Over-allocated",
      underAllocated: "Under-allocated",
      riskWarnings: "Risk warnings",
      shares: "Shares",
      avgCost: "Avg Cost",
      currentValue: "Current Value",
      targetPercent: "Target %",
      notes: "Notes",
      manualPlanHeader: "MANUAL TRADE PLAN",
      actionStrongBuy: "STRONG_BUY",
      actionBuy: "BUY",
      actionNormalBuy: "NORMAL_BUY",
      actionReduceBuy: "REDUCE_BUY",
      actionHold: "HOLD",
      actionConsiderSell: "CONSIDER_SELL",
      actionDoNotBuy: "DO_NOT_BUY",
      reasonLabel: "Reason",
      warningLabel: "Warning",
      total: "Total",
      scoreLabel: "Score",
      riskLabel: "Risk",
      actionLabel: "suggested_action",
      safetyDisclaimer: "This is manual decision support only. It does not place trades automatically, does not require broker login, and does not execute real orders. Review all signals, prices, risks, and available cash before placing any order yourself.",
      enterTicker: "Enter a ticker or company name.",
      searching: "Searching...",
      addExactTicker: "Add exact ticker",
      manual: "Manual",
      searchFailed: "Search failed. Try a ticker like TSLA or V.",
      noMatches: "No matching stocks found.",
      updatedSymbol: "{symbol} updated.",
      addedSymbol: "{symbol} added. Set allocation if needed.",
      keepOneStock: "Keep at least one stock in the portfolio.",
      removedSymbol: "{symbol} removed.",
      overrideNumber: "{symbol} override must be a number like -9.2, +12, or 10.5.",
      overrideApplied: "{symbol} manual override applied.",
      overrideCleared: "{symbol} manual override cleared.",
      orderCopied: "Order list copied.",
      copyManually: "Select the order text and copy it manually.",
      portfolioSaved: "Portfolio risk inputs saved.",
      signalDataNeeded: "Data Needed",
      signalStrong: "Strong",
      signalPositive: "Positive",
      signalNeutral: "Neutral",
      signalReduced: "Reduced",
      signalSellWatch: "Sell Watch",
      signalAvoid: "Avoid",
      riskLow: "Low",
      riskMedium: "Medium",
      riskHigh: "High",
      riskExtreme: "Extreme",
      marketUnavailableReason: "Market data is unavailable, so buying is blocked until fresh data is available.",
      staleReason: "Market data is stale, so buying is blocked until fresh live or scheduled data is available.",
      dropReason: "The stock dropped {move} based on the lower of 1D and 5D changes, so the dip-buy strategy increases the manual buy amount.",
      riseReason: "The stock rose {move}, so the system reduces the manual buy amount to avoid chasing price strength.",
      neutralReason: "Neutral signal; base buy amount is used for manual review.",
      farAboveTargetReason: "Position is far above target allocation, so the portfolio risk rule blocks additional buying.",
      aboveTargetReason: "Position is above target allocation, so the portfolio risk rule reduces the manual buy amount.",
      belowTargetReason: "Position is below target allocation, so the favorable signal is allowed within risk limits.",
      marketDataUnavailable: "Market data unavailable",
      dataMayBeStale: "Data may be stale",
      usingCacheData: "Using cache data",
      manualOverrideActive: "Manual override active",
      panicModeActive: "Panic mode active",
      sharpWeeklyDrop: "Sharp weekly drop",
      strongRecentRise: "Strong recent rise",
      reducedByRiskRule: "Suggested buy amount reduced by risk rule",
      positionAboveTarget: "Position is above target allocation",
      availableCashTooLow: "Available cash is too low",
      plannedExceedsCashRule: "Planned buy amount exceeds portfolio cash rule",
      availableCashBelow5: "Available cash is below 5% of portfolio value",
      plannedExceedsCash: "Planned buy amount exceeds available cash",
      plannedExceeds30: "Planned buy amount exceeds 30% of available cash",
      tickerAbove30: "One ticker is above 30% of portfolio value",
      equityAbove95: "Total equity exposure is above 95%",
      multipleHighRisk: "Multiple tickers are High or Extreme risk",
      useManualOverride: "Use manual override",
      details: "Details",
      hide: "Hide",
      overview: "Overview",
      dashboardSummary: "Dashboard Summary",
      researchEyebrow: "Secondary tools",
      researchTesting: "Research & Testing",
      editHoldings: "Edit holdings",
      copyTextDetails: "Copy text details",
      showDetails: "Show details",
      hideDetails: "Hide details",
      newsSentiment: "News Sentiment",
      recentNews: "Recent News",
      financialReports: "Financial Reports",
      fundamentals: "Fundamentals",
      strongFundamentals: "Strong Fundamentals",
      stableFundamentals: "Stable Fundamentals",
      weakFundamentals: "Weak Fundamentals",
      deterioratingFundamentals: "Deteriorating Fundamentals",
      positiveNews: "Positive News",
      neutralNews: "Neutral News",
      negativeNews: "Negative News",
      severeNegativeNews: "Severe Negative News",
      upcomingEarningsRisk: "Upcoming earnings risk",
      newsDataUnavailable: "News data unavailable",
      fundamentalsDataUnavailable: "Fundamentals data unavailable",
      externalFactorAdjustment: "External factor adjustment",
      newsDelta: "News factor",
      fundamentalsDelta: "Fundamentals factor",
      upcomingEarningsDelta: "Earnings event risk"

    },
    zh: {
      pageTitle: "量化投资助手",
      heroEyebrow: "量化决策辅助",
      heroTitle: "量化投资助手",
      heroCopy: "下单前，先检查信号、组合风险和本次操作计划。",
      scheduleLabel: "每周二",
      monthlySettings: "月度设置",
      deploymentPlan: "投入计划",
      settings: "设置",
      monthlyBudget: "月度预算",
      normalPool: "常规资金池",
      crashFund: "下跌备用金",
      weeklyDeployment: "每周投入",
      deploymentSettings: "投入设置",
      save: "保存",
      resetDefaults: "恢复默认",
      deploymentSaved: "投入设置已保存。",
      deploymentReset: "已恢复默认投入设置。",
      invalidDeploymentInput: "请输入有效的非负数字。",
      backtestEyebrow: "回测比较",
      backtestTitle: "增强低频策略 vs 平滑逢低买入 vs 旧阈值逢低买入 vs 固定定投",
      runBacktest: "运行回测",
      backtestIntro: "使用当前股票、配置比例和投入设置，对比增强低频策略、平滑逢低买入、旧阈值逢低买入和固定定投。",
      backtestRunning: "正在回测...",
      backtestFailed: "回测失败，可能缺少历史数据。",
      backtestNeedData: "每只股票至少需要两条周线价格。",
      dipBuyStrategy: "平滑逢低买入",
      fixedDcaStrategy: "固定每周定投",
      finalValue: "最终价值",
      totalReturn: "总收益率",
      maxDrawdown: "最大回撤",
      numberOfBuys: "买入次数",
      avgBuyPrice: "平均买入价",
      beatsDca: "是否跑赢定投",
      yes: "是",
      no: "否",
      strategy: "策略",
      ticker: "股票",
      invested: "投入金额",
      backtestWindow: "回测区间",
      oldDipBuyStrategy: "旧阈值逢低买入",
      beatsOld: "是否跑赢旧策略",
      smoothMultiplierReason: "近期回调 {move}，平滑逢低买入模型将买入倍数调整为 {multiplier}。",
      smoothRiseReason: "近期上涨 {move}，平滑模型将买入倍数降低为 {multiplier}。",
      smoothNeutralReason: "近期波动不大，平滑模型将买入倍数保持在 {multiplier} 附近。",
      volatilityReducedReason: "近期波动较大，买入倍数已下调 10%。",
      downtrendCappedReason: "检测到较强下行趋势，已限制买入金额。",
      portfolioNearTargetReason: "当前持仓接近目标配置，未进行组合风控调整。",
      dataQualityReason: "数据质量已影响信号分和操作建议。",
      volatilityReducedWarning: "波动较大，已降低买入金额",
      downtrendCappedWarning: "下行趋势较强，买入金额已封顶",
      extremeMoveWarning: "周波动极大，请手动复核",
      panicTitle: "恐慌模式已开启",
      panicBody: "QQQ 买入信号小于或等于 -10%",
      allocations: "配置",
      thisTuesday: "本周二",
      searchStock: "搜索股票",
      searchPlaceholder: "股票代码或名称，例如 TSLA 或 Visa",
      allocationPercent: "配置比例 %",
      search: "搜索",
      dataSourcePriority: "数据源优先级",
      liveMarketData: "市场数据",
      finnhub: "Finnhub",
      yahooFallback: "Yahoo Finance 备用",
      cache: "缓存数据",
      manualOverride: "手动输入",
      dataFinePrint: "买入信号使用最新 1 日和 5 日变化中的较低值。单只股票的手动输入优先。",
      portfolioRiskDashboard: "组合风控",
      portfolioRisk: "组合风险",
      savePortfolio: "保存组合",
      availableCash: "可用资金",
      availableCashPlaceholder: "CAD 可用资金",
      copyOrderList: "复制操作清单",
      manualTradePlan: "手动操作计划",
      copy: "复制",
      liveMarketDataEyebrow: "市场数据",
      priceSettings: "价格设置",
      closePriceSettings: "关闭价格设置",
      finnhubApiKey: "Finnhub API Key",
      apiKeyPlaceholder: "输入实时价格 API Key",
      refreshPrices: "刷新价格",
      sourcePriority: "数据源优先级",
      sourcePriorityLine: "Finnhub → Yahoo 备用 → 缓存数据 → 手动输入",
      signalScore: "信号分",
      signalStrength: "信号强度",
      riskLevel: "风险等级",
      multiplier: "买入倍数",
      buy: "建议买入",
      suggestedBuy: "建议买入",
      symbol: "代码",
      action: "建议",
      source: "来源",
      controls: "操作",
      reason: "原因",
      warning: "提示",
      overridePlaceholder: "手动周涨跌 %, 例如 -9.2",
      applyOverride: "应用",
      clearOverride: "清除",
      remove: "移除",
      loading: "加载中",
      priceLoading: "价格加载中",
      waitingForMarketData: "等待市场数据。",
      fetchingMarketData: "正在获取市场数据",
      refreshingMarketData: "正在刷新市场数据。",
      refreshing: "刷新中...",
      updated: "已更新",
      noLiveData: "暂无实时数据",
      price: "价格",
      priceUnavailable: "价格不可用",
      allocation: "配置",
      totalAllocation: "总配置",
      none: "无",
      notProvided: "未填写",
      totalPortfolioValue: "组合总值",
      plannedBuyTotal: "计划买入总额",
      plannedCashUsage: "现金使用比例",
      largestPosition: "最大持仓",
      overallRisk: "总体风险",
      overAllocated: "超配",
      underAllocated: "低配",
      riskWarnings: "风险提示",
      shares: "股数",
      avgCost: "平均成本",
      currentValue: "当前价值",
      targetPercent: "目标 %",
      notes: "备注",
      manualPlanHeader: "手动操作计划",
      actionStrongBuy: "强烈买入",
      actionBuy: "买入",
      actionNormalBuy: "正常买入",
      actionReduceBuy: "减少买入",
      actionHold: "观望",
      actionConsiderSell: "考虑减仓",
      actionDoNotBuy: "暂不买入",
      reasonLabel: "原因",
      warningLabel: "提示",
      total: "合计",
      scoreLabel: "分数",
      riskLabel: "风险",
      actionLabel: "建议动作",
      safetyDisclaimer: "本工具只提供手动决策参考，不会自动下单，也不需要券商登录。实际买卖前，请自行确认信号、价格、风险和可用资金。",
      enterTicker: "请输入股票代码或公司名称。",
      searching: "搜索中...",
      addExactTicker: "添加精确代码",
      manual: "手动",
      searchFailed: "搜索失败。可以尝试 TSLA 或 V 这样的代码。",
      noMatches: "没有找到匹配的股票。",
      updatedSymbol: "{symbol} 已更新。",
      addedSymbol: "{symbol} 已添加。如有需要请设置配置比例。",
      keepOneStock: "组合中至少保留一只股票。",
      removedSymbol: "{symbol} 已移除。",
      overrideNumber: "{symbol} 的覆盖值必须是数字，例如 -9.2、+12 或 10.5。",
      overrideApplied: "{symbol} 手动覆盖已应用。",
      overrideCleared: "{symbol} 手动覆盖已清除。",
      orderCopied: "交易清单已复制。",
      copyManually: "请选择交易文本并手动复制。",
      portfolioSaved: "组合风险输入已保存。",
      signalDataNeeded: "待数据",
      signalStrong: "强",
      signalPositive: "偏强",
      signalNeutral: "中性",
      signalReduced: "降低",
      signalSellWatch: "减仓观察",
      signalAvoid: "暂避",
      riskLow: "低",
      riskMedium: "中",
      riskHigh: "高",
      riskExtreme: "极高",
      marketUnavailableReason: "市场数据不可用，暂不建议买入。",
      staleReason: "数据可能已过期，刷新后再判断。",
      dropReason: "近期回调 {move}，逢低买入策略提高了建议买入金额。",
      riseReason: "近期上涨 {move}，为避免追高，系统降低了建议买入金额。",
      neutralReason: "信号中性，按基础金额作为参考。",
      farAboveTargetReason: "当前持仓明显高于目标配置，暂不建议继续买入。",
      aboveTargetReason: "当前持仓高于目标配置，已降低建议买入金额。",
      belowTargetReason: "当前持仓低于目标配置，信号允许时可按策略参考。",
      marketDataUnavailable: "市场数据不可用",
      dataMayBeStale: "数据可能已过期",
      usingCacheData: "使用缓存数据",
      manualOverrideActive: "已使用手动输入",
      panicModeActive: "恐慌模式生效",
      sharpWeeklyDrop: "周跌幅较大",
      strongRecentRise: "近期涨幅较大",
      reducedByRiskRule: "建议买入金额已降低",
      positionAboveTarget: "持仓高于目标配置",
      availableCashTooLow: "可用资金过低",
      plannedExceedsCashRule: "计划买入超过现金规则",
      availableCashBelow5: "可用资金低于组合总值的 5%",
      plannedExceedsCash: "计划买入超过可用资金",
      plannedExceeds30: "计划买入超过可用资金的 30%",
      tickerAbove30: "单只持仓超过组合总值的 30%",
      equityAbove95: "股票仓位超过 95%",
      multipleHighRisk: "多只股票风险偏高",
      enhancedDipBuyStrategy: "增强低频策略",
      smoothDipBuyStrategy: "平滑逢低买入",
      beatsSmooth: "是否跑赢当前平滑策略",
      bestStrategy: "最佳策略",
      worstStrategy: "最弱策略",
      volatility: "波动率",
      algorithmDetails: "算法细节",
      marketRegime: "市场环境",
      trendStatus: "趋势状态",
      volatilityStatus: "波动状态",
      drawdownStatus: "回撤状态",
      finalMultiplier: "最终倍数",
      rawSmooth: "原始",
      volAdj: "波动",
      regimeCap: "市场上限",
      trendCap: "趋势上限",
      drawdownCap: "回撤上限",
      portfolioAdj: "组合",
      finalMultiplierShort: "最终",
      regimeBull: "牛市",
      regimeNeutral: "震荡",
      regimeCorrection: "调整",
      regimeBear: "熊市",
      trendHealthyPullback: "上升趋势中的回调",
      trendStrongDowntrend: "明显下行趋势",
      trendMixed: "趋势混合",
      volatilityLow: "低波动",
      volatilityNormal: "正常波动",
      volatilityHigh: "高波动",
      drawdownNormal: "回撤正常",
      drawdownModerate: "中等回撤",
      drawdownDeep: "较深回撤",
      drawdownSevere: "严重回撤",
      pullbackWithinUptrendReason: "属于上升趋势中的回调，可支持正常逢低买入。",
      marketRegimeReason: "当前市场为{regime}，买入倍数上限为 {cap}。",
      volatilityAdjustmentReason: "近期周波动率将买入倍数调整为 {adjustment}。",
      drawdownCapReason: "近期回撤 {drawdown}，为控制风险已限制买入倍数。",
      enhancedAlgorithmSummary: "近期回调支持买入，但趋势、波动、回撤、市场环境和组合风险会限制最终金额。",
      marketCorrectionWarning: "市场处于调整阶段，买入倍数已限制",
      marketBearWarning: "市场处于熊市阶段，买入倍数已限制",
      highVolatilityWarning: "周波动率偏高",
      severeDrawdownWarning: "回撤较深，请手动复核",
      algorithmTestEyebrow: "算法测试",
      algorithmTestTitle: "算法测试面板",
      algorithmTestInput: "decision_change",
      algorithmTestSafety: "此面板仅用于手动决策测试，不会修改真实组合、市场数据、信号或操作计划。",
      invalidAlgorithmTestInput: "请输入有效的 decision_change 数字。",
      testScenario: "测试场景",
      testOnly: "仅测试",
      useManualOverride: "使用手动输入",
      details: "详情",
      hide: "收起",
      overview: "总览",
      dashboardSummary: "面板总览",
      researchEyebrow: "辅助工具",
      researchTesting: "研究与测试",
      editHoldings: "编辑持仓",
      copyTextDetails: "复制文本详情",
      showDetails: "查看详情",
      hideDetails: "收起详情"
      newsSentiment: "新闻情绪",
      recentNews: "近期新闻",
      financialReports: "财务报告",
      fundamentals: "基本面",
      strongFundamentals: "基本面强",
      stableFundamentals: "基本面稳定",
      weakFundamentals: "基本面偏弱",
      deterioratingFundamentals: "基本面恶化",
      positiveNews: "新闻偏正面",
      neutralNews: "新闻中性",
      negativeNews: "新闻偏负面",
      severeNegativeNews: "重大负面新闻",
      upcomingEarningsRisk: "财报发布前事件风险",
      newsDataUnavailable: "新闻数据暂不可用",
      fundamentalsDataUnavailable: "基本面数据暂不可用",
      externalFactorAdjustment: "外部因素调整",
      newsDelta: "新闻因素",
      fundamentalsDelta: "基本面因素",
      upcomingEarningsDelta: "财报事件风险"
    }
  };

  const state = {
    marketRows: new Map(),
    rows: new Map(),
    qqqSignal: null,
    marketRegime: null,
    backtestResult: null,
    panicActive: false,
    loading: false,
    pendingRefresh: false,
    weeklySnapshot: null,
    backtestSnapshot: null,
    portfolio: normalizePortfolio(loadJson(STORAGE_KEYS.portfolio, CONFIG.defaultStocks), { allowCustom: true }),
    portfolioRiskInput: normalizePortfolioRiskInput(loadJson(STORAGE_KEYS.portfolioRisk, {})),
    deployment: normalizeDeployment(loadJson(STORAGE_KEYS.deployment, DEFAULT_DEPLOYMENT)),
    cache: loadJson(STORAGE_KEYS.cache, {}),
    overrides: loadJson(STORAGE_KEYS.overrides, {}),
    language: normalizeLanguage(localStorage.getItem(STORAGE_KEYS.language))
  };

  const cardsEl = document.getElementById("cards");
  const orderTextEl = document.getElementById("orderText");
  const copyStatusEl = document.getElementById("copyStatus");
  const refreshBtn = document.getElementById("refreshBtn");
  const copyBtn = document.getElementById("copyBtn");
  const apiKeyInput = document.getElementById("apiKey");
  const openSettingsBtn = document.getElementById("openSettingsBtn");
  const closeSettingsBtn = document.getElementById("closeSettingsBtn");
  const settingsModal = document.getElementById("settingsModal");
  const lastUpdatedEl = document.getElementById("lastUpdated");
  const panicBanner = document.getElementById("panicBanner");
  const template = document.getElementById("stockCardTemplate");
  const stockSearchInput = document.getElementById("stockSearchInput");
  const stockAllocationInput = document.getElementById("stockAllocationInput");
  const stockSearchBtn = document.getElementById("stockSearchBtn");
  const stockSearchResultsEl = document.getElementById("stockSearchResults");
  const portfolioTotalEl = document.getElementById("portfolioTotal");
  const availableCashInput = document.getElementById("availableCashInput");
  const savePortfolioRiskBtn = document.getElementById("savePortfolioRiskBtn");
  const portfolioPositionInputsEl = document.getElementById("portfolioPositionInputs");
  const portfolioRiskSummaryEl = document.getElementById("portfolioRiskSummary");
  const overviewWeeklyDeploymentEl = document.getElementById("overviewWeeklyDeployment");
  const overviewPlannedBuyTotalEl = document.getElementById("overviewPlannedBuyTotal");
  const overviewOverallRiskEl = document.getElementById("overviewOverallRisk");
  const overviewMarketRegimeEl = document.getElementById("overviewMarketRegime");
  const overviewAvailableCashEl = document.getElementById("overviewAvailableCash");
  const runBacktestBtn = document.getElementById("runBacktestBtn");
  const backtestSummaryEl = document.getElementById("backtestSummary");
  const algorithmTestInput = document.getElementById("algorithmTestInput");
  const algorithmTestPresetsEl = document.getElementById("algorithmTestPresets");
  const algorithmTestResultEl = document.getElementById("algorithmTestResult");
  const languageToggle = document.getElementById("languageToggle");
  const deploymentStatusEl = document.getElementById("deploymentStatus");
  const saveDeploymentBtn = document.getElementById("saveDeploymentBtn");
  const resetDeploymentBtn = document.getElementById("resetDeploymentBtn");
  const deploymentInputs = {
    monthlyBudget: document.getElementById("monthlyBudgetInput"),
    normalPool: document.getElementById("normalPoolInput"),
    crashFund: document.getElementById("crashFundInput"),
    weeklyDeployment: document.getElementById("weeklyDeploymentInput")
  };

  if (!state.portfolio.length) {
    state.portfolio = normalizePortfolio(CONFIG.defaultStocks, { allowCustom: true });
  }

  apiKeyInput.value = localStorage.getItem(STORAGE_KEYS.apiKey) || "";

  apiKeyInput.addEventListener("input", function () {
    localStorage.setItem(STORAGE_KEYS.apiKey, apiKeyInput.value.trim());
  });

  openSettingsBtn.addEventListener("click", openSettings);
  closeSettingsBtn.addEventListener("click", closeSettings);

  refreshBtn.addEventListener("click", refreshMarketData);
  copyBtn.addEventListener("click", copyOrderList);
  if (runBacktestBtn) runBacktestBtn.addEventListener("click", function (event) {
    event.preventDefault();
    event.stopPropagation();
    const backtestDetails = runBacktestBtn.closest("details");
    if (backtestDetails) backtestDetails.open = true;
    runBacktestComparison();
  });
  if (algorithmTestInput) algorithmTestInput.addEventListener("input", renderAlgorithmTestPanel);
  if (languageToggle) languageToggle.addEventListener("click", toggleLanguage);
  if (saveDeploymentBtn) saveDeploymentBtn.addEventListener("click", saveDeploymentFromForm);
  if (resetDeploymentBtn) resetDeploymentBtn.addEventListener("click", resetDeploymentDefaults);
  Object.keys(deploymentInputs).forEach(function (field) {
    const input = deploymentInputs[field];
    if (!input) return;
    input.addEventListener("input", clearDeploymentStatus);
    input.addEventListener("focus", function () {
      input.dataset.lastEditedAt = String(Date.now());
    });
    input.addEventListener("keydown", handleDeploymentInputKeydown);
  });
  stockSearchBtn.addEventListener("click", searchStocks);
  savePortfolioRiskBtn.addEventListener("click", savePortfolioRiskForm);
  availableCashInput.addEventListener("change", savePortfolioRiskForm);
  availableCashInput.addEventListener("keydown", function (event) {
    if (event.key === "Enter") savePortfolioRiskForm();
  });
  stockSearchInput.addEventListener("keydown", function (event) {
    if (event.key === "Enter") searchStocks();
  });
  document.querySelectorAll(".holdings-details, .order-copy-details").forEach(function (details) {
    details.addEventListener("toggle", function () {
      setDetailLabels(".holdings-details", t("editHoldings"), t("hideDetails"));
      setDetailLabels(".order-copy-details", t("copyTextDetails"), t("hideDetails"));
    });
  });

  applyLanguage();
  renderDeploymentSettings();
  renderPortfolioTotal();
  renderPortfolioRiskInputs();
  renderAlgorithmTestPresets();
  renderAlgorithmTestPanel();
  renderSkeleton();
  refreshMarketData();

  async function refreshMarketData() {
    if (state.loading) {
      state.pendingRefresh = true;
      return;
    }

    state.loading = true;
    state.pendingRefresh = false;
    refreshBtn.disabled = true;
    refreshBtn.textContent = t("refreshing");
    lastUpdatedEl.textContent = t("refreshingMarketData");
    copyStatusEl.textContent = "";
    markCardsLoading();

    state.weeklySnapshot = await fetchWeeklySnapshot();
    state.backtestSnapshot = await fetchBacktestSnapshot();
    state.marketRegime = await fetchMarketRegime();

    const symbols = Array.from(new Set(state.portfolio.map(function (stock) {
      return stock.symbol;
    }).concat("QQQ")));
    const results = await Promise.all(symbols.map(fetchSymbolSnapshot));

    results.forEach(function (result) {
      if (!result) return;
      if (result.symbol === "QQQ") {
        state.qqqSignal = getDecisionChange(result);
      } else {
        state.marketRows.set(result.symbol, result);
      }
    });

    state.panicActive = typeof state.qqqSignal === "number" && state.qqqSignal <= CONFIG.qqqPanicThreshold;
    applyManualOverrides();
    render();
    renderAlgorithmTestPanel();

    state.loading = false;
    refreshBtn.disabled = false;
    refreshBtn.textContent = t("refreshPrices");

    if (state.pendingRefresh) {
      refreshMarketData();
    }
  }

  function openSettings() {
    settingsModal.classList.remove("hidden");
    apiKeyInput.focus();
  }

  function closeSettings() {
    settingsModal.classList.add("hidden");
    openSettingsBtn.focus();
  }

  async function searchStocks() {
    const query = stockSearchInput.value.trim();
    if (!query) {
      renderSearchMessage(t("enterTicker"));
      return;
    }

    stockSearchBtn.disabled = true;
    stockSearchBtn.textContent = t("searching");
    renderSearchMessage(t("searching"));

    try {
      const results = await fetchStockSearchResults(query);
      renderSearchResults(results, query);
    } catch (error) {
      console.warn("Stock search failed", error);
      const fallbackSymbol = normalizeSymbol(query);
      if (fallbackSymbol) {
        renderSearchResults([{ symbol: fallbackSymbol, name: t("addExactTicker"), exchange: t("manual") }], query);
      } else {
        renderSearchMessage(t("searchFailed"));
      }
    } finally {
      stockSearchBtn.disabled = false;
      stockSearchBtn.textContent = t("search");
    }
  }

  async function fetchStockSearchResults(query) {
    const url = "https://query1.finance.yahoo.com/v1/finance/search?q=" + encodeURIComponent(query) + "&quotesCount=8&newsCount=0";
    const payload = await fetchJson(url);
    const quotes = Array.isArray(payload.quotes) ? payload.quotes : [];
    const seen = new Set();

    return quotes.reduce(function (items, quote) {
      const symbol = normalizeSymbol(quote.symbol);
      if (!symbol || seen.has(symbol)) return items;

      const quoteType = String(quote.quoteType || "").toUpperCase();
      if (quoteType && !["EQUITY", "ETF", "MUTUALFUND"].includes(quoteType)) return items;

      seen.add(symbol);
      items.push({
        symbol,
        name: quote.longname || quote.shortname || quote.name || symbol,
        exchange: quote.exchDisp || quote.exchange || quoteType || "Market"
      });
      return items;
    }, []);
  }

  function renderSearchResults(results, query) {
    stockSearchResultsEl.innerHTML = "";

    const exactSymbol = normalizeSymbol(query);
    if (exactSymbol && !results.some(function (item) { return item.symbol === exactSymbol; })) {
      results.unshift({ symbol: exactSymbol, name: "Add exact ticker", exchange: "Manual" });
    }

    if (!results.length) {
      renderSearchMessage(t("noMatches"));
      return;
    }

    results.slice(0, 8).forEach(function (result) {
      const button = document.createElement("button");
      button.className = "search-result";
      button.type = "button";
      button.innerHTML = "<strong></strong><span></span><em></em>";
      button.querySelector("strong").textContent = result.symbol;
      button.querySelector("span").textContent = result.name;
      button.querySelector("em").textContent = result.exchange;
      button.addEventListener("click", function () {
        addStock(result);
      });
      stockSearchResultsEl.appendChild(button);
    });
  }

  function renderSearchMessage(message) {
    stockSearchResultsEl.innerHTML = "";
    const note = document.createElement("p");
    note.className = "search-message";
    note.textContent = message;
    stockSearchResultsEl.appendChild(note);
  }

  function addStock(result) {
    const symbol = normalizeSymbol(result.symbol);
    if (!symbol) return;

    const allocation = parseAllocation(stockAllocationInput.value);
    const existing = state.portfolio.find(function (stock) {
      return stock.symbol === symbol;
    });

    if (existing) {
      existing.name = result.name || existing.name || symbol;
      if (allocation > 0) existing.allocation = allocation;
      copyStatusEl.textContent = t("updatedSymbol", { symbol });
    } else {
      state.portfolio.push({
        symbol,
        name: result.name || symbol,
        allocation
      });
      copyStatusEl.textContent = t("addedSymbol", { symbol });
    }

    state.portfolio = normalizePortfolio(state.portfolio, { allowCustom: true });
    savePortfolio();
    clearBacktestResult();
    stockSearchInput.value = "";
    stockAllocationInput.value = "";
    stockSearchResultsEl.innerHTML = "";
    renderPortfolioTotal();
    renderPortfolioRiskInputs();
    renderSkeleton();
    refreshMarketData();
  }

  function removeStock(symbol) {
    if (state.portfolio.length <= 1) {
      copyStatusEl.textContent = t("keepOneStock");
      return;
    }

    state.portfolio = state.portfolio.filter(function (stock) {
      return stock.symbol !== symbol;
    });
    delete state.overrides[symbol];
    delete state.cache[symbol];
    state.marketRows.delete(symbol);
    state.rows.delete(symbol);
    savePortfolio();
    saveOverrides();
    saveJson(STORAGE_KEYS.cache, state.cache);
    clearBacktestResult();
    renderPortfolioTotal();
    renderPortfolioRiskInputs();
    renderSkeleton();
    refreshMarketData();
    copyStatusEl.textContent = t("removedSymbol", { symbol });
  }

  async function fetchSymbolSnapshot(symbol) {
    const apiKey = apiKeyInput.value.trim();
    const cached = getValidCache(symbol);
    const weeklyData = getWeeklySnapshot(symbol);
    const failures = [];

    if (apiKey) {
      try {
        const finnhub = await fetchFinnhubSnapshot(symbol, apiKey);
        const mergedFinnhub = mergeWeeklySnapshot(finnhub, weeklyData);
        saveCache(symbol, mergedFinnhub);
        return mergedFinnhub;
      } catch (error) {
        console.warn("Finnhub failed for", symbol, error);
        failures.push("Finnhub: " + describeError(error));
      }
    }

    try {
      const yahoo = await fetchYahooSnapshot(symbol);
      const mergedYahoo = mergeWeeklySnapshot(yahoo, weeklyData);
      saveCache(symbol, mergedYahoo);
      return mergedYahoo;
    } catch (error) {
      console.warn("Yahoo failed for", symbol, error);
      failures.push("Yahoo: " + describeError(error));
    }

    if (weeklyData) {
      return {
        symbol,
        price: weeklyData.price,
        latestClose: weeklyData.latestClose,
        previousClose: weeklyData.previousClose,
        weekAgoClose: weeklyData.weekAgoClose,
        dailyChange: weeklyData.dailyChange,
        weeklyChange: weeklyData.weeklyChange,
        decisionChange: weeklyData.decisionChange,
        source: "Weekly",
        note: "Scheduled close snapshot",
        fetchedAt: weeklyData.fetchedAt
      };
    }

    if (cached) {
      return {
        ...cached,
        source: "Cache",
        note: "API failed; using saved snapshot"
      };
    }

    const note = failures.length ? failures.join(" | ") : "Enter Finnhub key or use manual override";
    return {
      symbol,
      price: null,
      latestClose: null,
      weekAgoClose: null,
      weeklyChange: null,
      source: "Unavailable",
      note
    };
  }

  async function fetchWeeklySnapshot() {
    try {
      return await fetchJson(CONFIG.weeklySnapshotUrl + "?v=" + Date.now());
    } catch (error) {
      console.warn("Weekly snapshot failed", error);
      return null;
    }
  }

  function getWeeklySnapshot(symbol) {
    const item = state.weeklySnapshot && state.weeklySnapshot.symbols && state.weeklySnapshot.symbols[symbol];
    if (!item || !isFiniteNumber(item.weeklyChange)) return null;
    return {
      price: isFiniteNumber(item.price) ? item.price : null,
      latestClose: isFiniteNumber(item.latestClose) ? item.latestClose : null,
      previousClose: isFiniteNumber(item.previousClose) ? item.previousClose : null,
      weekAgoClose: isFiniteNumber(item.weekAgoClose) ? item.weekAgoClose : null,
      dailyChange: isFiniteNumber(item.dailyChange) ? item.dailyChange : null,
      weeklyChange: item.weeklyChange,
      decisionChange: isFiniteNumber(item.decisionChange) ? item.decisionChange : calculateDecisionChange(item.weeklyChange, item.dailyChange),
      fetchedAt: state.weeklySnapshot.generatedAt ? Date.parse(state.weeklySnapshot.generatedAt) : Date.now()
    };
  }

  function mergeWeeklySnapshot(row, weeklyData) {
    if (!weeklyData) return row;
    if (isFiniteNumber(row.weeklyChange) && isFiniteNumber(row.dailyChange) && !isFiniteNumber(weeklyData.dailyChange)) {
      return {
        ...row,
        decisionChange: calculateDecisionChange(row.weeklyChange, row.dailyChange)
      };
    }
    const mergedDailyChange = calculateDecisionChange(row.dailyChange, weeklyData.dailyChange);
    const mergedWeeklyChange = isFiniteNumber(row.weeklyChange) ? row.weeklyChange : weeklyData.weeklyChange;
    return {
      ...row,
      latestClose: isFiniteNumber(row.latestClose) ? row.latestClose : weeklyData.latestClose,
      previousClose: isFiniteNumber(row.previousClose) ? row.previousClose : weeklyData.previousClose,
      weekAgoClose: isFiniteNumber(row.weekAgoClose) ? row.weekAgoClose : weeklyData.weekAgoClose,
      dailyChange: mergedDailyChange,
      weeklyChange: mergedWeeklyChange,
      decisionChange: calculateDecisionChange(mergedWeeklyChange, mergedDailyChange, weeklyData.decisionChange),
      note: row.note + "; scheduled snapshot"
    };
  }

  async function fetchFinnhubSnapshot(symbol, apiKey) {
    const now = Math.floor(Date.now() / 1000);
    const from = now - 45 * 24 * 60 * 60;
    const candleUrl = new URL("https://finnhub.io/api/v1/stock/candle");
    candleUrl.search = new URLSearchParams({
      symbol,
      resolution: "D",
      from: String(from),
      to: String(now),
      token: apiKey
    }).toString();

    const quoteUrl = new URL("https://finnhub.io/api/v1/quote");
    quoteUrl.search = new URLSearchParams({ symbol, token: apiKey }).toString();

    const quote = await fetchJson(quoteUrl);
    if (!isFiniteNumber(quote.c) || quote.c <= 0) {
      throw new Error("quote unavailable");
    }

    let comparison = null;
    const quoteDailyChange = isFiniteNumber(quote.pc) && quote.pc > 0 ? round2(((quote.c - quote.pc) / quote.pc) * 100) : null;
    let candleNote = "Live quote; daily candles unavailable";

    try {
      const candle = await fetchJson(candleUrl);
      if (candle.s !== "ok" || !Array.isArray(candle.c) || candle.c.length < 6) {
        throw new Error(candle.s === "no_data" ? "no daily candle data" : "insufficient daily candles");
      }

      const closes = candle.c.filter(isFiniteNumber);
      comparison = calculateMarketSignals(closes);
      candleNote = "Live quote and daily candles";
    } catch (error) {
      console.warn("Finnhub candles failed for", symbol, error);
    }

    return {
      symbol,
      price: quote.c,
      latestClose: comparison ? comparison.latestClose : null,
      previousClose: comparison ? comparison.previousClose : isFiniteNumber(quote.pc) ? quote.pc : null,
      weekAgoClose: comparison ? comparison.weekAgoClose : null,
      dailyChange: comparison ? comparison.dailyChange : quoteDailyChange,
      weeklyChange: comparison ? comparison.weeklyChange : null,
      decisionChange: comparison ? comparison.decisionChange : quoteDailyChange,
      source: "Finnhub",
      note: candleNote,
      fetchedAt: Date.now()
    };
  }

  async function fetchYahooSnapshot(symbol) {
    const url = "https://query1.finance.yahoo.com/v8/finance/chart/" + encodeURIComponent(symbol) + "?range=14d&interval=1d";
    const payload = await fetchJson(url);
    const result = payload.chart && payload.chart.result && payload.chart.result[0];
    if (!result || !result.indicators || !result.indicators.quote) {
      throw new Error("Yahoo payload missing result");
    }

    const quote = result.indicators.quote[0] || {};
    const closes = (quote.close || []).filter(isFiniteNumber);
    if (closes.length < 6) throw new Error("Yahoo returned insufficient candles");

    const comparison = calculateMarketSignals(closes);
    const metaPrice = result.meta && result.meta.regularMarketPrice;

    return {
      symbol,
      price: isFiniteNumber(metaPrice) ? metaPrice : comparison.latestClose,
      latestClose: comparison.latestClose,
      previousClose: comparison.previousClose,
      weekAgoClose: comparison.weekAgoClose,
      dailyChange: comparison.dailyChange,
      weeklyChange: comparison.weeklyChange,
      decisionChange: comparison.decisionChange,
      source: "Yahoo",
      note: "Yahoo Finance fallback",
      fetchedAt: Date.now()
    };
  }

  async function fetchBacktestWeeklyPrices(symbol) {
    const snapshot = await fetchBacktestSnapshot();
    const staticRows = snapshot && snapshot.symbols ? snapshot.symbols[symbol] : null;
    if (Array.isArray(staticRows) && staticRows.length >= 2) {
      return staticRows.map(function (row) {
        return { date: row.date, close: Number(row.close) };
      }).filter(function (row) {
        return row.date && Number.isFinite(row.close) && row.close > 0;
      });
    }

    const url = "https://query1.finance.yahoo.com/v8/finance/chart/" + encodeURIComponent(symbol) + "?range=5y&interval=1wk";
    const payload = await fetchJson(url);
    const result = payload.chart && payload.chart.result && payload.chart.result[0];
    const timestamps = result && Array.isArray(result.timestamp) ? result.timestamp : [];
    const quote = result && result.indicators && result.indicators.quote ? result.indicators.quote[0] || {} : {};
    const closes = Array.isArray(quote.close) ? quote.close : [];

    return timestamps.reduce(function (items, timestamp, index) {
      const close = Number(closes[index]);
      if (!Number.isFinite(close) || close <= 0) return items;
      items.push({
        date: new Date(timestamp * 1000).toISOString().slice(0, 10),
        close
      });
      return items;
    }, []);
  }

  async function fetchBacktestSnapshot() {
    if (state.backtestSnapshot) return state.backtestSnapshot;
    try {
      state.backtestSnapshot = await fetchJson(CONFIG.backtestSnapshotUrl + "?v=" + Date.now());
      return state.backtestSnapshot;
    } catch (error) {
      console.warn("Backtest snapshot failed", error);
      state.backtestSnapshot = { symbols: {} };
      return state.backtestSnapshot;
    }
  }

  async function fetchMarketRegime() {
    if (!LOW_FREQ_ALGO_PARAMS.marketRegimeEnabled) return getNeutralMarketRegime("QQQ");
    try {
      const qqqRows = await fetchBacktestWeeklyPrices("QQQ");
      if (qqqRows.length >= 50) return calculateMarketRegimeFromPrices(qqqRows, "QQQ");
    } catch (error) {
      console.warn("QQQ regime data failed", error);
    }
    try {
      const spyRows = await fetchBacktestWeeklyPrices("SPY");
      if (spyRows.length >= 50) return calculateMarketRegimeFromPrices(spyRows, "SPY");
    } catch (error) {
      console.warn("SPY regime data failed", error);
    }
    return getNeutralMarketRegime("QQQ");
  }

  function calculateMarketSignals(closes) {
    const latestClose = closes[closes.length - 1];
    const previousClose = closes[closes.length - 2];
    const lookback = Math.min(5, closes.length - 1);
    const weekAgoClose = closes[closes.length - 1 - lookback];
    const dailyChange = round2(((latestClose - previousClose) / previousClose) * 100);
    const weeklyChange = round2(((latestClose - weekAgoClose) / weekAgoClose) * 100);
    const decisionChange = calculateDecisionChange(weeklyChange, dailyChange);
    return { latestClose, previousClose, weekAgoClose, dailyChange, weeklyChange, decisionChange };
  }

  function calculateDecisionChange() {
    const values = Array.prototype.slice.call(arguments).filter(isFiniteNumber);
    if (!values.length) return null;
    return Math.min.apply(null, values);
  }

  function getDecisionChange(row) {
    if (!row) return null;
    if (isFiniteNumber(row.decisionChange)) return row.decisionChange;
    return calculateDecisionChange(row.weeklyChange, row.dailyChange);
  }

  function getMultiplier(decisionChange, dailyChange, weeklyChange) {
    return calculateSmoothMultiplier(decisionChange, dailyChange, weeklyChange).multiplier;
  }

  function getOldHardThresholdMultiplier(change) {
    if (!isFiniteNumber(change)) return 1;
    if (change <= -15) return 2;
    if (change <= -8) return 1.5;
    if (change >= 10) return 0.5;
    return 1;
  }

  function calculateSmoothMultiplier(decisionChange, dailyChange, weeklyChange) {
    if (!isFiniteNumber(decisionChange)) {
      return {
        multiplier: 1,
        rawMultiplier: 1,
        volatilityReduced: false,
        downtrendCapped: false,
        severeDowntrend: false,
        crashBoostApplied: false
      };
    }

    let multiplier = 1 - ALGORITHM_PARAMS.sensitivity * decisionChange / 100;
    const crashBoostApplied = decisionChange <= ALGORITHM_PARAMS.strongDropThreshold;
    if (crashBoostApplied) multiplier += ALGORITHM_PARAMS.crashBoost;

    const volatilityReduced = (
      isFiniteNumber(dailyChange) && Math.abs(dailyChange) >= ALGORITHM_PARAMS.volatilityDailyThreshold
    );
    if (volatilityReduced) multiplier *= ALGORITHM_PARAMS.volatilityReduction;

    const weeklyAbs = isFiniteNumber(weeklyChange) ? Math.abs(weeklyChange) : 0;
    const severeDowntrend = isFiniteNumber(weeklyChange) && weeklyChange <= -ALGORITHM_PARAMS.extremeWeeklyThreshold;
    const downtrendCapped = (
      isFiniteNumber(weeklyChange) &&
      isFiniteNumber(dailyChange) &&
      weeklyChange <= -ALGORITHM_PARAMS.volatilityWeeklyThreshold &&
      dailyChange < 0
    );

    if (severeDowntrend) {
      multiplier = Math.min(multiplier, ALGORITHM_PARAMS.severeDowntrendMultiplier);
    } else if (downtrendCapped || weeklyAbs >= ALGORITHM_PARAMS.extremeWeeklyThreshold) {
      multiplier = Math.min(multiplier, ALGORITHM_PARAMS.maxDowntrendMultiplier);
    }

    return {
      multiplier: round2(clamp(multiplier, ALGORITHM_PARAMS.minMultiplier, ALGORITHM_PARAMS.maxMultiplier)),
      rawMultiplier: round2(multiplier),
      volatilityReduced,
      downtrendCapped: downtrendCapped || severeDowntrend,
      severeDowntrend,
      crashBoostApplied
    };
  }

  function calculateEnhancedLowFrequencyMultiplier(symbol, decisionChange, dailyChange, weeklyChange, marketRegime) {
    const smooth = calculateSmoothMultiplier(decisionChange, dailyChange, weeklyChange);
    const history = getHistoricalPriceRows(symbol);
    const closes = history.map(function (row) { return row.close; });
    const trend = analyzeTickerTrend(closes, decisionChange);
    const realizedVolatility = calculateWeeklyVolatility(closes, 12);
    const drawdown = calculateRecentDrawdown(closes, 52);

    let multiplier = smooth.multiplier;
    let volatilityAdjustment = 1;
    let regimeCap = LOW_FREQ_ALGO_PARAMS.maxBullMultiplier;
    let trendCap = ALGORITHM_PARAMS.maxMultiplier;
    let drawdownCap = ALGORITHM_PARAMS.maxMultiplier;

    if (LOW_FREQ_ALGO_PARAMS.volatilityAdjustmentEnabled && isFiniteNumber(realizedVolatility) && realizedVolatility > 0) {
      volatilityAdjustment = clamp(
        LOW_FREQ_ALGO_PARAMS.targetWeeklyVolatility / realizedVolatility,
        0.7,
        1.1
      );
      multiplier *= volatilityAdjustment;
    }

    if (LOW_FREQ_ALGO_PARAMS.marketRegimeEnabled) {
      regimeCap = getMarketRegimeMultiplierCap(marketRegime && marketRegime.type);
      multiplier = Math.min(multiplier, regimeCap);
    }

    if (LOW_FREQ_ALGO_PARAMS.trendFilterEnabled && trend.status === "strong_downtrend") {
      trendCap = trend.severe ? ALGORITHM_PARAMS.severeDowntrendMultiplier : ALGORITHM_PARAMS.maxDowntrendMultiplier;
      multiplier = Math.min(multiplier, trendCap);
    }

    if (LOW_FREQ_ALGO_PARAMS.drawdownFilterEnabled && isFiniteNumber(drawdown)) {
      if (drawdown > 35) drawdownCap = LOW_FREQ_ALGO_PARAMS.maxDrawdown35Multiplier;
      else if (drawdown >= 20) drawdownCap = LOW_FREQ_ALGO_PARAMS.maxDrawdown20Multiplier;
      multiplier = Math.min(multiplier, drawdownCap);
    }

    const finalMultiplier = round2(clamp(multiplier, ALGORITHM_PARAMS.minMultiplier, ALGORITHM_PARAMS.maxMultiplier));
    return {
      multiplier: finalMultiplier,
      rawMultiplier: smooth.rawMultiplier,
      raw_smooth_multiplier: smooth.multiplier,
      volatility_adjustment: round2(volatilityAdjustment),
      regime_adjustment: round2(regimeCap),
      trend_adjustment: round2(trendCap),
      drawdown_adjustment: round2(drawdownCap),
      portfolio_adjustment: 1,
      final_multiplier: finalMultiplier,
      volatilityReduced: smooth.volatilityReduced || volatilityAdjustment < 0.99,
      downtrendCapped: smooth.downtrendCapped || trend.status === "strong_downtrend",
      severeDowntrend: smooth.severeDowntrend || (trend.status === "strong_downtrend" && trend.severe),
      crashBoostApplied: smooth.crashBoostApplied,
      trend,
      market_regime: marketRegime || getNeutralMarketRegime(),
      realized_weekly_volatility: isFiniteNumber(realizedVolatility) ? round2(realizedVolatility * 100) : null,
      drawdown: isFiniteNumber(drawdown) ? round2(drawdown) : null,
      explanation: ""
    };
  }

  function getHistoricalPriceRows(symbol) {
    const rows = state.backtestSnapshot && state.backtestSnapshot.symbols
      ? state.backtestSnapshot.symbols[symbol]
      : null;
    if (!Array.isArray(rows)) return [];
    return rows.map(function (row) {
      return { date: row.date, close: Number(row.close) };
    }).filter(function (row) {
      return row.date && Number.isFinite(row.close) && row.close > 0;
    });
  }

  function analyzeTickerTrend(closes, decisionChange) {
    if (!Array.isArray(closes) || closes.length < 21) {
      return {
        status: "mixed",
        label: t("trendMixed"),
        return_4w: null,
        return_12w: null,
        ma20_trend: null,
        severe: false,
        healthy_pullback: false
      };
    }

    const latest = closes[closes.length - 1];
    const return4 = percentChangeFromCloses(closes, 4);
    const return12 = percentChangeFromCloses(closes, 12);
    const ma20 = movingAverage(closes, 20, 0);
    const priorMa20 = movingAverage(closes, 20, 4);
    const ma20Trend = isFiniteNumber(ma20) && isFiniteNumber(priorMa20) && priorMa20 > 0
      ? ((ma20 - priorMa20) / priorMa20) * 100
      : null;
    const strongDowntrend = (
      (isFiniteNumber(return4) && return4 <= -8 && isFiniteNumber(return12) && return12 <= -12) ||
      (isFiniteNumber(ma20) && latest < ma20 && isFiniteNumber(ma20Trend) && ma20Trend < 0 && isFiniteNumber(return12) && return12 < 0)
    );
    const severe = isFiniteNumber(return12) && return12 <= -25;
    const healthyPullback = (
      isFiniteNumber(decisionChange) &&
      decisionChange < 0 &&
      isFiniteNumber(return12) &&
      return12 > 5 &&
      isFiniteNumber(ma20) &&
      latest >= ma20 * 0.95 &&
      (!isFiniteNumber(ma20Trend) || ma20Trend >= 0)
    );

    if (strongDowntrend) {
      return {
        status: "strong_downtrend",
        label: t("trendStrongDowntrend"),
        return_4w: round2(return4),
        return_12w: round2(return12),
        ma20_trend: isFiniteNumber(ma20Trend) ? round2(ma20Trend) : null,
        severe,
        healthy_pullback: false
      };
    }

    if (healthyPullback) {
      return {
        status: "healthy_pullback",
        label: t("trendHealthyPullback"),
        return_4w: round2(return4),
        return_12w: round2(return12),
        ma20_trend: isFiniteNumber(ma20Trend) ? round2(ma20Trend) : null,
        severe: false,
        healthy_pullback: true
      };
    }

    return {
      status: "mixed",
      label: t("trendMixed"),
      return_4w: isFiniteNumber(return4) ? round2(return4) : null,
      return_12w: isFiniteNumber(return12) ? round2(return12) : null,
      ma20_trend: isFiniteNumber(ma20Trend) ? round2(ma20Trend) : null,
      severe: false,
      healthy_pullback: false
    };
  }

  function calculateWeeklyVolatility(closes, periods) {
    if (!Array.isArray(closes) || closes.length < 3) return null;
    const start = Math.max(1, closes.length - periods);
    const returns = [];
    for (let index = start; index < closes.length; index += 1) {
      const previous = closes[index - 1];
      const current = closes[index];
      if (previous > 0 && current > 0) returns.push((current - previous) / previous);
    }
    if (returns.length < 2) return null;
    const average = returns.reduce(function (sum, value) { return sum + value; }, 0) / returns.length;
    const variance = returns.reduce(function (sum, value) {
      return sum + Math.pow(value - average, 2);
    }, 0) / (returns.length - 1);
    return Math.sqrt(variance);
  }

  function calculateRecentDrawdown(closes, lookback) {
    if (!Array.isArray(closes) || !closes.length) return null;
    const window = closes.slice(Math.max(0, closes.length - lookback));
    const high = Math.max.apply(null, window);
    const latest = closes[closes.length - 1];
    return high > 0 ? ((high - latest) / high) * 100 : null;
  }

  function movingAverage(closes, length, offset) {
    if (!Array.isArray(closes) || closes.length < length + offset) return null;
    const end = closes.length - offset;
    const slice = closes.slice(end - length, end);
    return slice.reduce(function (sum, value) { return sum + value; }, 0) / slice.length;
  }

  function percentChangeFromCloses(closes, periods) {
    if (!Array.isArray(closes) || closes.length <= periods) return null;
    const current = closes[closes.length - 1];
    const previous = closes[closes.length - 1 - periods];
    return previous > 0 ? ((current - previous) / previous) * 100 : null;
  }

  function getMarketRegimeMultiplierCap(type) {
    if (type === "Bull") return LOW_FREQ_ALGO_PARAMS.maxBullMultiplier;
    if (type === "Correction") return LOW_FREQ_ALGO_PARAMS.maxCorrectionMultiplier;
    if (type === "Bear") return LOW_FREQ_ALGO_PARAMS.maxBearMultiplier;
    return LOW_FREQ_ALGO_PARAMS.maxNeutralMultiplier;
  }

  function calculateMarketRegimeFromPrices(rows, proxy) {
    const closes = Array.isArray(rows) ? rows.map(function (row) { return Number(row.close); }).filter(function (value) {
      return Number.isFinite(value) && value > 0;
    }) : [];
    if (closes.length < 50) return getNeutralMarketRegime(proxy);

    const latest = closes[closes.length - 1];
    const ma20 = movingAverage(closes, 20, 0);
    const ma50 = movingAverage(closes, 50, 0);
    const drawdown = calculateRecentDrawdown(closes, 52);
    let type = "Neutral";

    if (isFiniteNumber(drawdown) && drawdown > 20) type = "Bear";
    else if (isFiniteNumber(ma50) && latest < ma50) type = "Bear";
    else if (isFiniteNumber(ma20) && isFiniteNumber(ma50) && latest > ma20 && ma20 > ma50) type = "Bull";
    else if (isFiniteNumber(ma20) && latest < ma20) type = "Correction";

    return {
      type,
      label: displayMarketRegime(type),
      proxy: proxy || "QQQ",
      latest_price: round2(latest),
      ma20: round2(ma20),
      ma50: round2(ma50),
      drawdown: isFiniteNumber(drawdown) ? round2(drawdown) : null,
      max_multiplier: getMarketRegimeMultiplierCap(type)
    };
  }

  function getNeutralMarketRegime(proxy) {
    return {
      type: "Neutral",
      label: displayMarketRegime("Neutral"),
      proxy: proxy || "QQQ",
      latest_price: null,
      ma20: null,
      ma50: null,
      drawdown: null,
      max_multiplier: LOW_FREQ_ALGO_PARAMS.maxNeutralMultiplier
    };
  }

  function displayMarketRegime(type) {
    if (type === "Bull") return t("regimeBull");
    if (type === "Correction") return t("regimeCorrection");
    if (type === "Bear") return t("regimeBear");
    return t("regimeNeutral");
  }

  function localizeMarketRegime(regime) {
    return displayMarketRegime(regime && regime.type);
  }

  function calculateNewsSignal(stock, row) {
    if (!row || !row.news) {
      return {
        score: null,
        label: "Unavailable",
        sentiment_score: null,
        article_count: null,
        material_negative_count: null,
        latest_headlines: [],
        source: null,
        explanation: t("newsDataUnavailable")
      };
    }
    try {
      var news = row.news;
      var avgSentiment = isFiniteNumber(news.overall_sentiment_score) ? news.overall_sentiment_score : 0;
      var articles = Array.isArray(news.articles) ? news.articles : [];
      var headlineText = articles.map(function (a) { return a.title || ""; }).join(" ").toLowerCase();
      var materialKeywords = ["fraud", "investigation", "lawsuit", "regulatory probe", "accounting issue", "guidance cut", "earnings miss", "recall", "sanction", "bankruptcy", "default", "downgrade", "supply chain issue"];
      var materialCount = 0;
      materialKeywords.forEach(function (kw) {
        if (headlineText.indexOf(kw) >= 0) materialCount++;
      });
      var label, score;
      if (avgSentiment > 0.25) { label = t("positiveNews"); score = 65; }
      else if (avgSentiment >= -0.25) { label = t("neutralNews"); score = 50; }
      else if (materialCount >= 2 || avgSentiment < -0.5) { label = t("severeNegativeNews"); score = 15; }
      else { label = t("negativeNews"); score = 30; }
      return {
        score: score,
        label: label,
        sentiment_score: avgSentiment,
        article_count: articles.length,
        material_negative_count: materialCount,
        latest_headlines: articles.slice(0, 3).map(function (a) { return a.title || ""; }),
        source: news.source || "Alpha Vantage",
        explanation: news.explanation || ""
      };
    } catch (e) {
      return { score: null, label: "Unavailable", sentiment_score: null, article_count: null, material_negative_count: null, latest_headlines: [], source: null, explanation: t("newsDataUnavailable") };
    }
  }

  function calculateFundamentalsSignal(stock, row) {
    if (!row || !row.fundamentals) {
      return {
        score: null,
        label: "Unavailable",
        revenue_growth_yoy: null,
        eps_growth_yoy: null,
        gross_margin_trend: null,
        operating_margin_trend: null,
        free_cash_flow_trend: null,
        debt_to_equity: null,
        earnings_surprise: null,
        next_earnings_date: null,
        source: null,
        explanation: t("fundamentalsDataUnavailable")
      };
    }
    try {
      var f = row.fundamentals;
      var score = 50;
      var revGrowth = isFiniteNumber(f.revenue_growth_yoy) ? f.revenue_growth_yoy : 0;
      var epsGrowth = isFiniteNumber(f.eps_growth_yoy) ? f.eps_growth_yoy : 0;
      var marginTrend = f.gross_margin_trend || "stable";
      var fcfPositive = f.free_cash_flow_positive === true;
      var debtEq = isFiniteNumber(f.debt_to_equity) ? f.debt_to_equity : null;
      var earningsMiss = f.earnings_surprise === "miss";
      var hasUpcomingEarnings = f.next_earnings_date && f.next_earnings_date.length > 0;

      if (revGrowth > 0.05) score += 10;
      else if (revGrowth < -0.05) score -= 10;
      if (epsGrowth > 0.05) score += 10;
      else if (epsGrowth < -0.05) score -= 10;
      if (marginTrend === "improving") score += 8;
      else if (marginTrend === "deteriorating") score -= 8;
      if (fcfPositive) score += 8;
      else score -= 10;
      if (debtEq !== null && debtEq > 1.5) score -= 10;
      if (earningsMiss) score -= 8;
      if (isFiniteNumber(f.earnings_surprise_pct) && f.earnings_surprise_pct > 2) score += 5;

      var label;
      if (score >= 75) label = t("strongFundamentals");
      else if (score >= 55) label = t("stableFundamentals");
      else if (score >= 35) label = t("weakFundamentals");
      else label = t("deterioratingFundamentals");

      return {
        score: score,
        label: label,
        revenue_growth_yoy: revGrowth,
        eps_growth_yoy: epsGrowth,
        gross_margin_trend: marginTrend,
        operating_margin_trend: f.operating_margin_trend || null,
        free_cash_flow_trend: fcfPositive ? "positive" : "negative",
        debt_to_equity: debtEq,
        earnings_surprise: f.earnings_surprise || null,
        next_earnings_date: f.next_earnings_date || null,
        source: f.source || "Fundamental data",
        explanation: f.explanation || ""
      };
    } catch (e) {
      return { score: null, label: "Unavailable", revenue_growth_yoy: null, eps_growth_yoy: null, gross_margin_trend: null, operating_margin_trend: null, free_cash_flow_trend: null, debt_to_equity: null, earnings_surprise: null, next_earnings_date: null, source: null, explanation: t("fundamentalsDataUnavailable") };
    }
  }

  function calculateNewsFundamentalsScoreAdjustment(signal) {
    var newsDelta = 0;
    var fundamentalsDelta = 0;
    var upcomingEarningsDelta = 0;
    var newsSig = signal.news_signal || {};
    var fundSig = signal.fundamentals_signal || {};
    var explanations = [];

    // News factor
    if (newsSig.label === t("positiveNews")) {
      newsDelta = NEWS_FACTOR_PARAMS.positiveSentimentBonus;
      explanations.push(t("newsDelta") + " +" + newsDelta);
    } else if (newsSig.label === t("negativeNews")) {
      newsDelta = -NEWS_FACTOR_PARAMS.negativeSentimentPenalty;
      explanations.push(t("newsDelta") + " " + newsDelta);
    } else if (newsSig.label === t("severeNegativeNews")) {
      newsDelta = -NEWS_FACTOR_PARAMS.severeNegativePenalty;
      explanations.push(t("newsDelta") + " " + newsDelta);
    }

    // Fundamentals factor
    var fundScore = fundSig.score;
    if (fundScore !== null && fundScore >= 75) {
      fundamentalsDelta = FUNDAMENTAL_FACTOR_PARAMS.strongFundamentalBonus;
      explanations.push(t("fundamentalsDelta") + " +" + fundamentalsDelta);
    } else if (fundScore !== null && fundScore <= 34) {
      fundamentalsDelta = -FUNDAMENTAL_FACTOR_PARAMS.severeFundamentalPenalty;
      explanations.push(t("fundamentalsDelta") + " " + fundamentalsDelta);
    } else if (fundScore !== null && fundScore < 55) {
      fundamentalsDelta = -FUNDAMENTAL_FACTOR_PARAMS.weakFundamentalPenalty;
      explanations.push(t("fundamentalsDelta") + " " + fundamentalsDelta);
    }

    // Upcoming earnings risk
    if (fundSig.next_earnings_date) {
      var now = new Date();
      var earningsDate = new Date(fundSig.next_earnings_date);
      var daysUntil = (earningsDate - now) / (1000 * 60 * 60 * 24);
      if (daysUntil >= 0 && daysUntil <= 7) {
        upcomingEarningsDelta = -5;
        explanations.push(t("upcomingEarningsDelta") + " " + upcomingEarningsDelta);
      }
    }

    var totalDelta = newsDelta + fundamentalsDelta + upcomingEarningsDelta;
    var explanation = explanations.length > 0 ? explanations.join("; ") + "，" + t("externalFactorAdjustment") + " " + totalDelta : t("externalFactorAdjustment") + " " + totalDelta;

    return {
      total_delta: totalDelta,
      news_delta: newsDelta,
      fundamentals_delta: fundamentalsDelta,
      upcoming_earnings_delta: upcomingEarningsDelta,
      explanation: explanation
    };
  }

  function buildSignalObject(stock, row) {
    const decisionChange = getDecisionChange(row);
    const manualOverrideActive = isFiniteNumber(state.overrides[stock.symbol]);
    const panicSupported = state.panicActive && CONFIG.panicSymbols.has(stock.symbol);
    const enhancedMultiplier = calculateEnhancedLowFrequencyMultiplier(
      stock.symbol,
      decisionChange,
      row && isFiniteNumber(row.dailyChange) ? row.dailyChange : null,
      row && isFiniteNumber(row.weeklyChange) ? row.weeklyChange : null,
      state.marketRegime
    );
    const normalMultiplier = enhancedMultiplier.multiplier;
    const panicMultiplier = panicSupported ? CONFIG.panicMultiplier : 1;
    const multiplier = round2(clamp(normalMultiplier * panicMultiplier, ALGORITHM_PARAMS.minMultiplier, ALGORITHM_PARAMS.maxMultiplier));
    enhancedMultiplier.final_multiplier = multiplier;
    const baseBuyAmount = round2(state.deployment.weeklyDeployment * stock.allocation);
    const suggestedBuyAmount = round2(baseBuyAmount * multiplier);
    const dataAgeHours = row && row.fetchedAt ? (Date.now() - row.fetchedAt) / (60 * 60 * 1000) : null;

    const signal = {
      symbol: stock.symbol,
      latest_price: row && isFiniteNumber(row.price) ? row.price : null,
      daily_change: row && isFiniteNumber(row.dailyChange) ? row.dailyChange : null,
      weekly_change: row && isFiniteNumber(row.weeklyChange) ? row.weeklyChange : null,
      decision_change: isFiniteNumber(decisionChange) ? decisionChange : null,
      multiplier,
      base_buy_amount: baseBuyAmount,
      suggested_buy_amount: suggestedBuyAmount,
      signal_score: 0,
      signal_strength: t("signalDataNeeded"),
      suggested_action: "DO_NOT_BUY",
      risk_level: "High",
      reason: "",
      warning: "",
      data_source: row && row.source ? row.source : "Unavailable",
      data_freshness: getDataFreshness(row, dataAgeHours),
      data_age_hours: isFiniteNumber(dataAgeHours) ? round2(dataAgeHours) : null,
      manual_override_active: manualOverrideActive,
      panic_active: panicSupported,
      algorithm: enhancedMultiplier,
      raw_smooth_multiplier: enhancedMultiplier.raw_smooth_multiplier,
      volatility_adjustment: enhancedMultiplier.volatility_adjustment,
      regime_adjustment: enhancedMultiplier.regime_adjustment,
      trend_adjustment: enhancedMultiplier.trend_adjustment,
      drawdown_adjustment: enhancedMultiplier.drawdown_adjustment,
      portfolio_adjustment: enhancedMultiplier.portfolio_adjustment,
      final_multiplier: multiplier,
      final_suggested_buy_amount: suggestedBuyAmount,
      note: row && row.note ? row.note : "",
      news_signal: calculateNewsSignal(stock, row),
      fundamentals_signal: calculateFundamentalsSignal(stock, row)
    };

    signal.signal_score = calculateSignalScore({
      decisionChange: signal.decision_change,
      weeklyChange: signal.weekly_change,
      dailyChange: signal.daily_change,
      multiplier: signal.multiplier,
      panicActive: signal.panic_active,
      dataSource: signal.data_source,
      dataAgeHours: signal.data_age_hours,
      manualOverrideActive: signal.manual_override_active,
      algorithm: signal.algorithm
    });
    // External factor adjustment (news, fundamentals)
    var externalAdjustment = calculateNewsFundamentalsScoreAdjustment(signal);
    signal.news_fundamentals_adjustment = externalAdjustment;
    signal.signal_score = clamp(signal.signal_score + externalAdjustment.total_delta, 0, 100);
    signal.risk_level = calculateRiskLevel(signal);
    signal.suggested_action = getSuggestedAction(signal);
    signal.signal_strength = getSignalStrength(signal);
    signal.suggested_buy_amount = calculateRiskAdjustedBuyAmount(signal);
    signal.reason = generateSignalReason(signal);
    signal.warning = generateSignalWarning(signal);
    return signal;
  }

  function calculateSignalScore(input) {
    if (!isFiniteNumber(input.decisionChange)) return 10;

    let score = 50;
    const move = input.decisionChange;

    if (move < 0) score += Math.min(36, Math.abs(move) * 2.4);
    if (move > 0) score -= Math.min(36, move * 2.8);

    if (isFiniteNumber(input.weeklyChange) && input.weeklyChange <= -20) score += 4;
    if (isFiniteNumber(input.dailyChange) && input.dailyChange <= -8) score += 3;
    if (isFiniteNumber(input.weeklyChange) && Math.abs(input.weeklyChange) >= ALGORITHM_PARAMS.extremeWeeklyThreshold) score -= 12;
    if (isFiniteNumber(input.dailyChange) && Math.abs(input.dailyChange) >= ALGORITHM_PARAMS.volatilityDailyThreshold) score -= 5;

    if (input.algorithm) {
      const trend = input.algorithm.trend || {};
      const regime = input.algorithm.market_regime || {};
      if (trend.status === "healthy_pullback") score += 9;
      if (trend.status === "strong_downtrend") score -= trend.severe ? 18 : 12;
      if (isFiniteNumber(input.algorithm.realized_weekly_volatility) && input.algorithm.realized_weekly_volatility >= 6) score -= 8;
      if (isFiniteNumber(input.algorithm.drawdown)) {
        if (input.algorithm.drawdown > 35) score -= 20;
        else if (input.algorithm.drawdown >= 20) score -= 10;
        else if (input.algorithm.drawdown >= 10) score -= 3;
      }
      if (regime.type === "Bull") score += 4;
      if (regime.type === "Correction") score -= 7;
      if (regime.type === "Bear") score -= 15;
    }

    if (isFiniteNumber(input.dataAgeHours)) {
      if (input.dataAgeHours > 24) score -= 20;
      else if (input.dataAgeHours > 6) score -= 8;
    } else {
      score -= 25;
    }

    if (/cache/i.test(input.dataSource)) score -= 15;
    if (/manual/i.test(input.dataSource) || input.manualOverrideActive) score -= 10;
    if (/unavailable/i.test(input.dataSource)) score -= 45;

    if (input.panicActive) score += 6;
    score += (input.multiplier - 1) * 18;

    return clamp(Math.round(score), 0, 100);
  }

  function getSuggestedAction(signal) {
    if (signal.data_source === "Unavailable" || signal.data_freshness === "missing" || signal.data_freshness === "stale") return "DO_NOT_BUY";
    if (!isFiniteNumber(signal.decision_change)) return "DO_NOT_BUY";
    if (signal.decision_change >= 15) return "CONSIDER_SELL";
    if (signal.risk_level === "Extreme") return "DO_NOT_BUY";
    if (signal.algorithm && isFiniteNumber(signal.algorithm.drawdown) && signal.algorithm.drawdown > 35) return "DO_NOT_BUY";
    if (signal.algorithm && signal.algorithm.trend && signal.algorithm.trend.status === "strong_downtrend" && signal.signal_score <= 60) return "REDUCE_BUY";
    if (signal.signal_score <= 20) return "DO_NOT_BUY";
    if (signal.signal_score <= 40) return "REDUCE_BUY";
    if (signal.signal_score <= 60) return "NORMAL_BUY";
    if (signal.signal_score <= 80) return "BUY";
    if (signal.algorithm && signal.algorithm.market_regime && signal.algorithm.market_regime.type === "Bear") return "BUY";
    return "STRONG_BUY";
  }

  function getSignalStrength(signal) {
    if (signal.suggested_action === "STRONG_BUY") return t("signalStrong");
    if (signal.suggested_action === "BUY") return t("signalPositive");
    if (signal.suggested_action === "NORMAL_BUY") return t("signalNeutral");
    if (signal.suggested_action === "REDUCE_BUY") return t("signalReduced");
    if (signal.suggested_action === "CONSIDER_SELL") return t("signalSellWatch");
    return t("signalAvoid");
  }

  function getActionLabelFromMultiplier(signal) {
    const m = isFiniteNumber(signal.multiplier) ? signal.multiplier : 1;
    const sc = isFiniteNumber(signal.signal_score) ? signal.signal_score : 0;
    const rl = signal.risk_level || "Low";
    const wc = isFiniteNumber(signal.weekly_change) ? signal.weekly_change : 0;

    // Hard stops
    if (m < 0.40) return { label: "暂停买入", cls: "action-pause-buy" };
    if (sc < 20 && wc < 0) return { label: "暂停买入", cls: "action-pause-buy" };
    if (rl === "Extreme") return { label: "暂停买入", cls: "action-pause-buy" };

    // Base label from multiplier
    var label, cls;
    if (m >= 1.60) { label = "强烈买入"; cls = "action-strong-buy"; }
    else if (m >= 1.20) { label = "买入"; cls = "action-buy"; }
    else if (m >= 1.00) { label = "小幅买入"; cls = "action-light-buy"; }
    else if (m >= 0.90) { label = "观望"; cls = "action-watch"; }
    else if (m >= 0.70) { label = "小幅减少买入"; cls = "action-light-reduce"; }
    else if (m >= 0.40) { label = "减少买入"; cls = "action-reduce"; }
    else { label = "暂停买入"; cls = "action-pause-buy"; }

    // Level map: higher number = more cautious
    var LEVELS = { "action-strong-buy": 1, "action-buy": 2, "action-light-buy": 3, "action-watch": 4, "action-light-reduce": 5, "action-reduce": 6, "action-pause-buy": 7 };
    var currentLevel = LEVELS[cls] || 7;

    // High risk safety caps
    if (rl === "High") {
      var cap = 7;
      if (sc < 30) cap = 5;
      else if (sc < 45) cap = 4;

      if (currentLevel < cap) {
        var capMap = { 4: { label: "观望", cls: "action-watch" }, 5: { label: "小幅减少买入", cls: "action-light-reduce" } };
        return capMap[cap] || { label: label, cls: cls };
      }

      // Strong buy downgrade for High risk
      if (cls === "action-strong-buy" && m >= 1.60 && !(sc >= 80 && wc > 0)) {
        return { label: "买入", cls: "action-buy" };
      }
    }

    return { label: label, cls: cls };
  }

  function ensureActionExplanation(card, signal) {
    var row = card.querySelector(".stock-details-row");
    if (!row) return;

    var m = isFiniteNumber(signal.multiplier) ? signal.multiplier : 1;
    var sc = isFiniteNumber(signal.signal_score) ? signal.signal_score : null;
    var rl = signal.risk_level || null;
    var dc = isFiniteNumber(signal.daily_change) ? signal.daily_change : null;
    var wc = isFiniteNumber(signal.weekly_change) ? signal.weekly_change : null;
    var ns = signal.news_signal || {};
    var fs = signal.fundamentals_signal || {};
    var nfa = signal.news_fundamentals_adjustment || {};

    // Find portfolio allocation for this stock
    var allocPct = null;
    var symbol = card.dataset.symbol;
    if (symbol && state && state.portfolio) {
      state.portfolio.forEach(function (stock) {
        if (stock.symbol === symbol) allocPct = (stock.allocation * 100).toFixed(1) + "%";
      });
    }

    var action = getActionLabelFromMultiplier(signal);
    var isPaused = action.cls === "action-pause-buy";

    // Find or create the explanation container
    var el = row.querySelector(".action-explanation");
    if (!el) {
      el = document.createElement("div");
      el.className = "action-explanation";
      // Insert after summary, before existing content
      var summary = row.querySelector(":scope > summary");
      if (summary && summary.nextElementSibling) {
        row.insertBefore(el, summary.nextElementSibling);
      } else {
        row.appendChild(el);
      }
    }

    // Build reason text
    var reasons = [];
    if (m >= 1.60) reasons.push("当前买入倍数为 " + m.toFixed(2) + "x，较高的买入倍数表明市场下跌较大，策略建议加仓。");
    else if (m >= 1.20) reasons.push("当前买入倍数为 " + m.toFixed(2) + "x，高于正常买入水平。");
    else if (m >= 1.00) reasons.push("当前买入倍数为 " + m.toFixed(2) + "x，接近正常买入水平。");
    else if (m >= 0.90) reasons.push("当前买入倍数为 " + m.toFixed(2) + "x，略低于正常水平，建议观望。");
    else if (m >= 0.70) reasons.push("当前买入倍数为 " + m.toFixed(2) + "x，低于正常买入水平，因此建议小幅减少买入。");
    else if (m >= 0.40) reasons.push("当前买入倍数为 " + m.toFixed(2) + "x，较低的买入倍数表明市场上涨较大，策略建议减少买入。");
    else reasons.push("当前买入倍数为 " + m.toFixed(2) + "x，已触发暂停买入条件。");

    if (sc !== null && sc < 30) reasons.push("信号分为 " + sc + "，说明当前信号很弱，不适合激进加仓。");
    else if (sc !== null && sc < 45) reasons.push("信号分为 " + sc + "，说明当前信号偏弱。");
    else if (sc !== null && sc >= 80) reasons.push("信号分为 " + sc + "，说明当前信号较强。");

    if (rl === "High") reasons.push("风险等级为高，说明不适合激进加仓。");
    else if (rl === "Extreme") reasons.push("风险等级为极高，已暂停买入。");

    if (dc !== null && dc < 0 && wc !== null && wc > 0) {
      reasons.push("虽然 1D 表现为负（" + dc.toFixed(2) + "%），但 5D 仍为正（+" + wc.toFixed(2) + "%），因此不是完全暂停买入，而是降低买入金额。");
    }

    // Build positive factors
    var posFactors = [];
    if (ns.label && ns.label !== "Unavailable" && ns.label !== t("neutralNews")) {
      if (ns.label === t("positiveNews")) posFactors.push(t("newsSentiment") + ": " + ns.label);
      else negFactors.push(t("newsSentiment") + ": " + ns.label);
    }
    if (fs.label && fs.label !== "Unavailable" && fs.label !== t("stableFundamentals")) {
      if (fs.label === t("strongFundamentals")) posFactors.push(t("fundamentals") + ": " + fs.label);
      else negFactors.push(t("fundamentals") + ": " + fs.label);
    }
    if (isFiniteNumber(nfa.upcoming_earnings_delta) && nfa.upcoming_earnings_delta < 0) {
      negFactors.push(t("upcomingEarningsRisk"));
    }
    if (wc !== null && wc > 0) posFactors.push("5D 表现仍为正（+" + wc.toFixed(2) + "%）");
    if (!isPaused) posFactors.push("当前仍允许保留部分买入计划");
    if (sc !== null && sc >= 45) posFactors.push("信号分较高（" + sc + "）");
    if (m >= 1.00) posFactors.push("买入倍数较高（" + m.toFixed(2) + "x）");
    if (m >= 0.40 && !(sc < 20 && wc < 0)) posFactors.push("未触发暂停买入条件");

    // Build negative factors
    var negFactors = [];
    if (sc !== null && sc < 45) negFactors.push("信号分偏低（" + sc + "）");
    if (rl === "High" || rl === "Extreme") negFactors.push("风险等级较高（" + displayRiskLevel(rl) + "）");
    if (m < 1.00) negFactors.push("买入倍数低于 1.00x（" + m.toFixed(2) + "x）");
    if (dc !== null && dc < 0) negFactors.push("1D 表现为负（" + dc.toFixed(2) + "%）");
    if (wc !== null && wc < 0) negFactors.push("5D 表现为负（" + wc.toFixed(2) + "%）");

    // Build final sentence
    var pct = (m * 100).toFixed(0);
    var finalSentence = "本次建议：按照正常计划的 " + pct + "% 买入。";
    if (isPaused) finalSentence = "本次建议：完全暂停买入，等待信号回暖后再考虑。";
    else if (m <= 0.40) finalSentence = "本次建议：买入倍数过低，建议暂停买入。";

    // Build DOM content
    el.innerHTML = [
      "<div class=\"explanation-section\">",
      "<h4>建议结论</h4>",
      "<p class=\"explanation-conclusion\"></p>",
      "</div>",
      "<div class=\"explanation-section\">",
      "<h4>判断依据</h4>",
      "<div class=\"explanation-fields\">",
      "<span class=\"field-label\">买入倍数</span><span class=\"field-value\" data-field=\"multiplier\"></span>",
      "<span class=\"field-label\">信号分</span><span class=\"field-value\" data-field=\"score\"></span>",
      "<span class=\"field-label\">风险等级</span><span class=\"field-value\" data-field=\"risk\"></span>",
      "<span class=\"field-label\">1D 表现</span><span class=\"field-value\" data-field=\"1d\"></span>",
      "<span class=\"field-label\">5D 表现</span><span class=\"field-value\" data-field=\"5d\"></span>",
      "<span class=\"field-label\">当前配置比例</span><span class=\"field-value\" data-field=\"allocation\"></span>",
      "<span class=\"field-label\">最终建议</span><span class=\"field-value\" data-field=\"final-action\"></span>",
      "</div>",
      "</div>",
      "<div class=\"explanation-section\">",
      "<h4>为什么是这个建议</h4>",
      "<p class=\"explanation-reason\"></p>",
      "</div>",
      "<div class=\"explanation-section\">",
      "<h4>新闻情绪</h4>",
      "<div class=\"explanation-fields\">",
      "<span class=\"field-label\">" + t("newsSentiment") + "</span><span class=\"field-value\" data-field=\"news-label\"></span>",
      "<span class=\"field-label\">" + t("signalScore") + "</span><span class=\"field-value\" data-field=\"news-score\"></span>",
      "<span class=\"field-label\">" + t("recentNews") + "</span><span class=\"field-value\" data-field=\"news-articles\"></span>",
      "</div>",
      "<p class=\"explanation-reason\" data-field=\"news-explanation\"></p>",
      "</div>",
      "<div class=\"explanation-section\">",
      "<h4>基本面</h4>",
      "<div class=\"explanation-fields\">",
      "<span class=\"field-label\">" + t("fundamentals") + "</span><span class=\"field-value\" data-field=\"fund-label\"></span>",
      "<span class=\"field-label\">" + t("signalScore") + "</span><span class=\"field-value\" data-field=\"fund-score\"></span>",
      "</div>",
      "<p class=\"explanation-reason\" data-field=\"fund-explanation\"></p>",
      "</div>",
      "<div class=\"explanation-section\">",
      "<h4>" + t("externalFactorAdjustment") + "</h4>",
      "<div class=\"explanation-fields\">",
      "<span class=\"field-label\">" + t("newsDelta") + "</span><span class=\"field-value\" data-field=\"adj-news\"></span>",
      "<span class=\"field-label\">" + t("fundamentalsDelta") + "</span><span class=\"field-value\" data-field=\"adj-fund\"></span>",
      "<span class=\"field-label\">" + t("upcomingEarningsDelta") + "</span><span class=\"field-value\" data-field=\"adj-earnings\"></span>",
      "<span class=\"field-label\">" + t("externalFactorAdjustment") + "</span><span class=\"field-value\" data-field=\"adj-total\"></span>",
      "</div>",
      "</div>",
      "<div class=\"explanation-section\">",
      "<h4>正面因素</h4>",
      "<ul class=\"positive-factors\"></ul>",
      "</div>",
      "<div class=\"explanation-section\">",
      "<h4>负面因素</h4>",
      "<ul class=\"negative-factors\"></ul>",
      "</div>",
      "<p class=\"final-sentence\"></p>"
    ].join("");

    // Fill data fields
    el.querySelector(".explanation-conclusion").textContent = action.label;
    el.querySelector('[data-field="multiplier"]').textContent = formatMultiplier(m);
    el.querySelector('[data-field="score"]').textContent = sc !== null ? String(sc) : "暂无数据";
    el.querySelector('[data-field="risk"]').textContent = rl ? displayRiskLevel(rl) : "暂无数据";
    el.querySelector('[data-field="1d"]').textContent = dc !== null ? formatSigned(dc) + "%" : "暂无数据";
    el.querySelector('[data-field="5d"]').textContent = wc !== null ? formatSigned(wc) + "%" : "暂无数据";
    el.querySelector('[data-field="allocation"]').textContent = allocPct || "暂无数据";
    el.querySelector('[data-field="final-action"]').textContent = action.label;
    el.querySelector(".explanation-reason").textContent = reasons.join(" ");

    // Fill news sentiment data
    el.querySelector('[data-field="news-label"]').textContent = ns.label === "Unavailable" ? t("newsDataUnavailable") : (ns.label || t("newsDataUnavailable"));
    el.querySelector('[data-field="news-score"]').textContent = ns.sentiment_score !== null && ns.sentiment_score !== undefined ? ns.sentiment_score.toFixed(3) : t("newsDataUnavailable");
    el.querySelector('[data-field="news-articles"]').textContent = ns.article_count !== null ? String(ns.article_count) + " articles" : t("newsDataUnavailable");
    var newsExpl = el.querySelector('[data-field="news-explanation"]');
    if (newsExpl) {
      newsExpl.textContent = ns.explanation || (ns.label === "Unavailable" ? t("newsDataUnavailable") : "");
    }

    // Fill fundamentals data
    el.querySelector('[data-field="fund-label"]').textContent = fs.label === "Unavailable" ? t("fundamentalsDataUnavailable") : (fs.label || t("fundamentalsDataUnavailable"));
    el.querySelector('[data-field="fund-score"]').textContent = fs.score !== null && fs.score !== undefined ? String(fs.score) : t("fundamentalsDataUnavailable");
    var fundExpl = el.querySelector('[data-field="fund-explanation"]');
    if (fundExpl) {
      fundExpl.textContent = fs.explanation || (fs.label === "Unavailable" ? t("fundamentalsDataUnavailable") : "");
    }

    // Fill external factor adjustment
    el.querySelector('[data-field="adj-news"]').textContent = isFiniteNumber(nfa.news_delta) ? (nfa.news_delta > 0 ? "+" : "") + nfa.news_delta : "0";
    el.querySelector('[data-field="adj-fund"]').textContent = isFiniteNumber(nfa.fundamentals_delta) ? (nfa.fundamentals_delta > 0 ? "+" : "") + nfa.fundamentals_delta : "0";
    el.querySelector('[data-field="adj-earnings"]').textContent = isFiniteNumber(nfa.upcoming_earnings_delta) ? (nfa.upcoming_earnings_delta > 0 ? "+" : "") + nfa.upcoming_earnings_delta : "0";
    el.querySelector('[data-field="adj-total"]').textContent = isFiniteNumber(nfa.total_delta) ? (nfa.total_delta > 0 ? "+" : "") + nfa.total_delta : "0";

    // Fill factors

    var posUl = el.querySelector(".positive-factors");
    posUl.innerHTML = "";
    if (posFactors.length === 0) {
      var li = document.createElement("li");
      li.textContent = "暂无";
      li.className = "explanation-empty";
      posUl.appendChild(li);
    } else {
      posFactors.forEach(function (f) {
        var li = document.createElement("li");
        li.textContent = f;
        posUl.appendChild(li);
      });
    }

    var negUl = el.querySelector(".negative-factors");
    negUl.innerHTML = "";
    if (negFactors.length === 0) {
      var li = document.createElement("li");
      li.textContent = "暂无";
      li.className = "explanation-empty";
      negUl.appendChild(li);
    } else {
      negFactors.forEach(function (f) {
        var li = document.createElement("li");
        li.textContent = f;
        negUl.appendChild(li);
      });
    }

    el.querySelector(".final-sentence").textContent = finalSentence;
  }

  function calculateRiskAdjustedBuyAmount(signal) {
    const strategyAmount = signal.base_buy_amount * signal.multiplier;
    if (signal.risk_level === "Extreme") return 0;
    if (signal.suggested_action === "DO_NOT_BUY" || signal.suggested_action === "CONSIDER_SELL") return 0;

    let amount = strategyAmount;
    if (signal.suggested_action === "REDUCE_BUY") amount = Math.min(strategyAmount, signal.base_buy_amount * 0.5);
    if (signal.suggested_action === "NORMAL_BUY") amount = signal.base_buy_amount;
    if (signal.risk_level === "High") amount *= 0.5;
    return round2(amount);
  }

  function calculateRiskLevel(signal) {
    if (signal.data_source === "Unavailable" || signal.data_freshness === "missing" || !isFiniteNumber(signal.decision_change)) return "Extreme";
    if (signal.data_freshness === "stale") return "High";

    let risk = 0;
    if (/cache|manual/i.test(signal.data_source) || signal.manual_override_active) risk += 1;
    if (isFiniteNumber(signal.weekly_change) && Math.abs(signal.weekly_change) >= ALGORITHM_PARAMS.extremeWeeklyThreshold) risk += 3;
    else if (isFiniteNumber(signal.weekly_change) && Math.abs(signal.weekly_change) >= ALGORITHM_PARAMS.volatilityWeeklyThreshold) risk += 2;
    if (isFiniteNumber(signal.decision_change) && Math.abs(signal.decision_change) >= 15) risk += 2;
    else if (isFiniteNumber(signal.decision_change) && Math.abs(signal.decision_change) >= 8) risk += 1;
    if (isFiniteNumber(signal.daily_change) && Math.abs(signal.daily_change) >= ALGORITHM_PARAMS.volatilityDailyThreshold) risk += 1;
    if (signal.algorithm && signal.algorithm.downtrendCapped) risk += 1;
    if (signal.algorithm && signal.algorithm.trend && signal.algorithm.trend.status === "strong_downtrend") risk += signal.algorithm.trend.severe ? 2 : 1;
    if (signal.algorithm && isFiniteNumber(signal.algorithm.realized_weekly_volatility) && signal.algorithm.realized_weekly_volatility >= 6) risk += 1;
    if (signal.algorithm && isFiniteNumber(signal.algorithm.drawdown)) {
      if (signal.algorithm.drawdown > 35) risk += 3;
      else if (signal.algorithm.drawdown >= 20) risk += 2;
      else if (signal.algorithm.drawdown >= 10) risk += 1;
    }
    if (signal.algorithm && signal.algorithm.market_regime && signal.algorithm.market_regime.type === "Correction") risk += 1;
    if (signal.algorithm && signal.algorithm.market_regime && signal.algorithm.market_regime.type === "Bear") risk += 2;
    if (signal.panic_active) risk += 1;
    if (signal.multiplier >= 2) risk += 2;
    else if (signal.multiplier > 1.5) risk += 1;

    if (risk >= 5) return "Extreme";
    if (risk >= 3) return "High";
    if (risk >= 1) return "Medium";
    return "Low";
  }

  function generateSignalReason(signal) {
    if (signal.data_source === "Unavailable" || signal.data_freshness === "missing" || !isFiniteNumber(signal.decision_change)) {
      return t("marketUnavailableReason");
    }
    if (signal.data_freshness === "stale") {
      return t("staleReason");
    }

    const move = formatPercent(Math.abs(signal.decision_change));
    const multiplier = formatMultiplier(signal.multiplier);
    const reasons = [];

    if (signal.decision_change < 0) {
      reasons.push(t("smoothMultiplierReason", { move, multiplier }));
    } else if (signal.decision_change > 0) {
      reasons.push(t("smoothRiseReason", { move, multiplier }));
    } else {
      reasons.push(t("smoothNeutralReason", { move, multiplier }));
    }

    if (signal.algorithm && signal.algorithm.volatilityReduced) reasons.push(t("volatilityReducedReason"));
    if (signal.algorithm && signal.algorithm.downtrendCapped) reasons.push(t("downtrendCappedReason"));
    if (signal.algorithm && signal.algorithm.trend && signal.algorithm.trend.status === "healthy_pullback") {
      reasons.push(t("pullbackWithinUptrendReason"));
    }
    if (signal.algorithm && signal.algorithm.market_regime) {
      reasons.push(t("marketRegimeReason", {
        regime: localizeMarketRegime(signal.algorithm.market_regime),
        cap: formatMultiplier(signal.algorithm.market_regime.max_multiplier)
      }));
    }
    if (signal.algorithm && signal.algorithm.volatility_adjustment !== 1) {
      reasons.push(t("volatilityAdjustmentReason", {
        adjustment: formatMultiplier(signal.algorithm.volatility_adjustment)
      }));
    }
    if (signal.algorithm && isFiniteNumber(signal.algorithm.drawdown) && signal.algorithm.drawdown >= 20) {
      reasons.push(t("drawdownCapReason", {
        drawdown: formatPercent(signal.algorithm.drawdown)
      }));
    }
    if (/cache|manual|unavailable/i.test(signal.data_source) || signal.manual_override_active) reasons.push(t("dataQualityReason"));
    return reasons.join(" ");
  }

  function generateSignalWarning(signal) {
    const warnings = [];
    if (signal.data_source === "Unavailable" || signal.data_freshness === "missing" || !isFiniteNumber(signal.decision_change)) warnings.push(t("marketDataUnavailable"));
    if (signal.data_freshness === "stale") warnings.push(t("dataMayBeStale"));
    if (/cache/i.test(signal.data_source)) warnings.push(t("usingCacheData"));
    if (signal.manual_override_active) warnings.push(t("manualOverrideActive"));
    if (signal.panic_active) warnings.push(t("panicModeActive"));
    if (isFiniteNumber(signal.weekly_change) && signal.weekly_change <= -15) warnings.push(t("sharpWeeklyDrop"));
    if (isFiniteNumber(signal.weekly_change) && Math.abs(signal.weekly_change) >= ALGORITHM_PARAMS.extremeWeeklyThreshold) warnings.push(t("extremeMoveWarning"));
    if (isFiniteNumber(signal.decision_change) && signal.decision_change >= 10) warnings.push(t("strongRecentRise"));
    if (signal.algorithm && signal.algorithm.volatilityReduced) warnings.push(t("volatilityReducedWarning"));
    if (signal.algorithm && signal.algorithm.downtrendCapped) warnings.push(t("downtrendCappedWarning"));
    if (signal.algorithm && isFiniteNumber(signal.algorithm.realized_weekly_volatility) && signal.algorithm.realized_weekly_volatility >= 6) warnings.push(t("highVolatilityWarning"));
    if (signal.algorithm && isFiniteNumber(signal.algorithm.drawdown) && signal.algorithm.drawdown > 35) warnings.push(t("severeDrawdownWarning"));
    if (signal.algorithm && signal.algorithm.market_regime && signal.algorithm.market_regime.type === "Correction") warnings.push(t("marketCorrectionWarning"));
    if (signal.algorithm && signal.algorithm.market_regime && signal.algorithm.market_regime.type === "Bear") warnings.push(t("marketBearWarning"));
    if (
      signal.suggested_action === "REDUCE_BUY" ||
      signal.suggested_action === "CONSIDER_SELL" ||
      signal.suggested_action === "DO_NOT_BUY" ||
      signal.suggested_buy_amount < round2(signal.base_buy_amount * signal.multiplier)
    ) {
      warnings.push(t("reducedByRiskRule"));
    }
    return warnings.length ? joinWarnings(warnings) : t("none");
  }

  function getDataFreshness(row, dataAgeHours) {
    if (!row || row.source === "Unavailable") return "missing";
    if (isFiniteNumber(dataAgeHours) && dataAgeHours > CONFIG.cacheHours) return "stale";
    return "fresh";
  }

  function applyManualOverrides() {
    state.portfolio.forEach(function (stock) {
      const base = state.marketRows.get(stock.symbol) || {
        symbol: stock.symbol,
        price: null,
        weeklyChange: null,
        source: "Unavailable",
        note: t("useManualOverride")
      };

      const override = state.overrides[stock.symbol];
      if (isFiniteNumber(override)) {
        state.rows.set(stock.symbol, {
          ...base,
          weeklyChange: override,
          dailyChange: null,
          decisionChange: override,
          source: "Manual",
          note: t("manualOverrideActive")
        });
      } else {
        state.rows.set(stock.symbol, base);
      }
    });
  }

  function renderSkeleton() {
    cardsEl.innerHTML = "";
    state.portfolio.forEach(function (stock) {
      const card = template.content.firstElementChild.cloneNode(true);
      ensureSignalFields(card);
      card.dataset.symbol = stock.symbol;
      card.querySelector("h3").textContent = stock.symbol;
      card.querySelector(".allocation").textContent = formatPercent(stock.allocation * 100) + " " + t("allocation");

      const input = card.querySelector(".override-input");
      input.value = state.overrides[stock.symbol] === undefined ? "" : formatSignedInput(state.overrides[stock.symbol]);
      card.querySelector(".source-badge").textContent = t("loading");
      card.querySelector(".action-badge").textContent = t("loading");
      card.querySelector(".weekly-change").textContent = t("loading");
      card.querySelector(".daily-change").textContent = "--";
      card.querySelector(".five-day-change").textContent = "--";
      card.querySelector(".signal-strength").textContent = t("loading");
      card.querySelector(".risk-level").textContent = t("loading");
      card.querySelector(".multiplier").textContent = "1x";
      card.querySelector(".buy-amount").textContent = "CAD " + round2(state.deployment.weeklyDeployment * stock.allocation).toFixed(2);
      card.querySelector(".price").textContent = t("priceLoading");
      card.querySelector(".decision-reason").textContent = t("waitingForMarketData");
      card.querySelector(".decision-warning").textContent = t("none");

      card.querySelector(".apply-override").addEventListener("click", function () {
        applyOverride(stock.symbol, input.value);
      });
      card.querySelector(".clear-override").addEventListener("click", function () {
        clearOverride(stock.symbol);
      });
      card.querySelector(".remove-stock").addEventListener("click", function () {
        removeStock(stock.symbol);
      });
      input.addEventListener("keydown", function (event) {
        if (event.key === "Enter") applyOverride(stock.symbol, input.value);
      });

      cardsEl.appendChild(card);
    });
    translateTemplateLabels();
  }

  function markCardsLoading() {
    cardsEl.querySelectorAll(".stock-card").forEach(function (card) {
      card.querySelector(".source-badge").textContent = t("loading");
      card.querySelector(".source-badge").className = "source-badge";
      card.querySelector(".action-badge").textContent = t("loading");
      card.querySelector(".action-badge").className = "action-badge";
      card.querySelector(".note").textContent = t("fetchingMarketData");
      card.querySelector(".weekly-change").textContent = t("loading");
      const dailyMetric = card.querySelector(".daily-change");
      const fiveDayMetric = card.querySelector(".five-day-change");
      if (dailyMetric) dailyMetric.textContent = "--";
      if (fiveDayMetric) fiveDayMetric.textContent = "--";
      card.querySelector(".signal-strength").textContent = t("loading");
      card.querySelector(".risk-level").textContent = t("loading");
      card.querySelector(".decision-reason").textContent = t("refreshingMarketData");
      card.querySelector(".decision-warning").textContent = t("none");
    });
  }

  function calculatePortfolioRisk(entries) {
    const availableCash = readPositiveNumber(state.portfolioRiskInput.available_cash);
    const availableCashProvided = state.portfolioRiskInput.available_cash_provided === true;
    const positions = {};
    let totalStockValue = 0;

    entries.forEach(function (entry) {
      const input = getPositionInput(entry.stock.symbol, entry.stock);
      const shares = readPositiveNumber(input.shares);
      const averageCost = readPositiveNumber(input.average_cost);
      const manualCurrentValue = readPositiveNumber(input.current_value);
      const estimatedCurrentValue = isFiniteNumber(entry.signal.latest_price) ? round2(entry.signal.latest_price * shares) : 0;
      const currentValue = manualCurrentValue > 0 ? manualCurrentValue : estimatedCurrentValue;
      const targetAllocation = clampPercent(readPositiveNumber(input.target_allocation), entry.stock.allocation * 100);

      positions[entry.stock.symbol] = {
        symbol: entry.stock.symbol,
        shares,
        average_cost: averageCost,
        current_value: round2(currentValue),
        target_allocation: round2(targetAllocation),
        target_allocation_ratio: targetAllocation / 100,
        current_allocation: 0,
        allocation_drift: 0,
        notes: String(input.notes || "")
      };
      totalStockValue += currentValue;
    });

    const totalPortfolioValue = round2(totalStockValue + availableCash);
    const symbols = Object.keys(positions);
    let largestPosition = { symbol: "None", current_value: 0, current_allocation: 0 };

    symbols.forEach(function (symbol) {
      const position = positions[symbol];
      position.current_allocation = totalPortfolioValue > 0 ? round2((position.current_value / totalPortfolioValue) * 100) : 0;
      position.allocation_drift = round2(position.current_allocation - position.target_allocation);
      if (position.current_allocation > largestPosition.current_allocation) {
        largestPosition = {
          symbol,
          current_value: position.current_value,
          current_allocation: position.current_allocation
        };
      }
    });

    return {
      total_portfolio_value: totalPortfolioValue,
      total_stock_value: round2(totalStockValue),
      available_cash: availableCash,
      available_cash_provided: availableCashProvided,
      cash_percentage: totalPortfolioValue > 0 ? round2((availableCash / totalPortfolioValue) * 100) : 0,
      equity_exposure_percentage: totalPortfolioValue > 0 ? round2((totalStockValue / totalPortfolioValue) * 100) : 0,
      positions,
      largest_position: largestPosition,
      total_planned_buy_amount: 0,
      planned_cash_usage_percentage: 0,
      portfolio_risk_level: "Low",
      over_allocated_tickers: symbols.filter(function (symbol) { return positions[symbol].allocation_drift > 2; }),
      under_allocated_tickers: symbols.filter(function (symbol) { return positions[symbol].allocation_drift < -2; }),
      risk_warnings: []
    };
  }

  function applyPortfolioRiskAdjustments(entries, portfolioRisk) {
    entries.forEach(function (entry) {
      const signal = entry.signal;
      const position = portfolioRisk.positions[signal.symbol];
      if (!position) return;

      signal.portfolio = {
        current_allocation: position.current_allocation,
        target_allocation: position.target_allocation,
        allocation_drift: position.allocation_drift,
        current_value: position.current_value,
        available_cash: portfolioRisk.available_cash
      };

      const originalAmount = signal.suggested_buy_amount;
      const driftRatio = position.allocation_drift / 100;
      if (driftRatio >= LOW_FREQ_ALGO_PARAMS.overTargetBlockThreshold || position.current_allocation >= 30) {
        signal.signal_score = clamp(signal.signal_score - ALGORITHM_PARAMS.farOverAllocationScorePenalty, 0, 100);
        signal.suggested_buy_amount = 0;
        signal.portfolio_adjustment = 0;
        if (signal.algorithm) signal.algorithm.portfolio_adjustment = 0;
        signal.suggested_action = driftRatio >= LOW_FREQ_ALGO_PARAMS.overTargetSellWatchThreshold ? "CONSIDER_SELL" : "DO_NOT_BUY";
        signal.signal_strength = getSignalStrength(signal);
        addSignalReason(signal, t("farAboveTargetReason"));
        addSignalWarning(signal, t("positionAboveTarget"));
        addSignalWarning(signal, t("reducedByRiskRule"));
        return;
      }

      if (driftRatio >= LOW_FREQ_ALGO_PARAMS.overTargetReduceThreshold) {
        signal.signal_score = clamp(signal.signal_score - ALGORITHM_PARAMS.overAllocationScorePenalty, 0, 100);
        signal.suggested_buy_amount = round2(Math.min(signal.suggested_buy_amount, signal.base_buy_amount * 0.5));
        signal.portfolio_adjustment = 0.5;
        if (signal.algorithm) signal.algorithm.portfolio_adjustment = 0.5;
        if (["STRONG_BUY", "BUY", "NORMAL_BUY"].includes(signal.suggested_action)) {
          signal.suggested_action = "REDUCE_BUY";
          signal.signal_strength = getSignalStrength(signal);
        }
        addSignalReason(signal, t("aboveTargetReason"));
        addSignalWarning(signal, t("positionAboveTarget"));
      } else if (position.allocation_drift < -2 && ["STRONG_BUY", "BUY", "NORMAL_BUY"].includes(signal.suggested_action)) {
        signal.signal_score = clamp(signal.signal_score + ALGORITHM_PARAMS.underAllocationScoreBonus, 0, 100);
        signal.suggested_action = getSuggestedAction(signal);
        signal.signal_strength = getSignalStrength(signal);
        signal.suggested_buy_amount = calculateRiskAdjustedBuyAmount(signal);
        signal.portfolio_adjustment = 1;
        if (signal.algorithm) signal.algorithm.portfolio_adjustment = 1;
        addSignalReason(signal, t("belowTargetReason"));
      } else {
        signal.portfolio_adjustment = 1;
        if (signal.algorithm) signal.algorithm.portfolio_adjustment = 1;
        addSignalReason(signal, t("portfolioNearTargetReason"));
      }

      if (signal.suggested_buy_amount < originalAmount) {
        addSignalWarning(signal, t("reducedByRiskRule"));
      }
    });

    enforcePortfolioCashLimits(entries, portfolioRisk);
  }

  function enforcePortfolioCashLimits(entries, portfolioRisk) {
    if (!portfolioRisk.available_cash_provided) return;

    const maxCashUse = portfolioRisk.available_cash > 0 ? round2(portfolioRisk.available_cash * 0.3) : 0;
    let planned = round2(entries.reduce(function (sum, entry) {
      return sum + entry.signal.suggested_buy_amount;
    }, 0));

    if (portfolioRisk.available_cash <= 0 && planned > 0) {
      entries.forEach(function (entry) {
        entry.signal.suggested_buy_amount = 0;
        entry.signal.suggested_action = "DO_NOT_BUY";
        entry.signal.signal_strength = getSignalStrength(entry.signal);
        addSignalWarning(entry.signal, t("availableCashTooLow"));
        addSignalWarning(entry.signal, t("reducedByRiskRule"));
      });
      return;
    }

    const cashLimit = Math.min(portfolioRisk.available_cash, maxCashUse);
    if (planned <= cashLimit || cashLimit <= 0) return;

    const ratio = cashLimit / planned;
    entries.forEach(function (entry) {
      if (entry.signal.suggested_buy_amount <= 0) return;
      entry.signal.suggested_buy_amount = round2(entry.signal.suggested_buy_amount * ratio);
      if (entry.signal.suggested_action === "STRONG_BUY" || entry.signal.suggested_action === "BUY") {
        entry.signal.suggested_action = "REDUCE_BUY";
        entry.signal.signal_strength = getSignalStrength(entry.signal);
      }
      addSignalWarning(entry.signal, t("plannedExceedsCashRule"));
      addSignalWarning(entry.signal, t("reducedByRiskRule"));
    });
  }

  function finalizePortfolioRisk(portfolioRisk, entries) {
    const warnings = [];
    const highRiskCount = entries.filter(function (entry) {
      return entry.signal.risk_level === "High" || entry.signal.risk_level === "Extreme";
    }).length;

    if (portfolioRisk.available_cash_provided && portfolioRisk.available_cash <= 0) warnings.push(t("availableCashTooLow"));
    else if (portfolioRisk.available_cash_provided && portfolioRisk.cash_percentage < 5) warnings.push(t("availableCashBelow5"));
    if (portfolioRisk.available_cash_provided && portfolioRisk.total_planned_buy_amount > portfolioRisk.available_cash) warnings.push(t("plannedExceedsCash"));
    if (portfolioRisk.available_cash_provided && portfolioRisk.available_cash > 0 && portfolioRisk.planned_cash_usage_percentage > 30) warnings.push(t("plannedExceeds30"));
    if (portfolioRisk.largest_position.current_allocation > 30) warnings.push(t("tickerAbove30"));
    if (portfolioRisk.equity_exposure_percentage > 95) warnings.push(t("equityAbove95"));
    if (highRiskCount >= 2) warnings.push(t("multipleHighRisk"));

    portfolioRisk.risk_warnings = warnings;
    portfolioRisk.portfolio_risk_level = calculatePortfolioRiskLevel(portfolioRisk, highRiskCount);
  }

  function calculatePortfolioRiskLevel(portfolioRisk, highRiskCount) {
    if (
      (portfolioRisk.available_cash_provided && portfolioRisk.total_planned_buy_amount > portfolioRisk.available_cash) ||
      portfolioRisk.largest_position.current_allocation > 40 ||
      portfolioRisk.equity_exposure_percentage > 98 ||
      highRiskCount >= 4
    ) {
      return "Extreme";
    }

    if (
      (portfolioRisk.available_cash_provided && portfolioRisk.planned_cash_usage_percentage > 30) ||
      portfolioRisk.largest_position.current_allocation > 30 ||
      portfolioRisk.equity_exposure_percentage > 95 ||
      (portfolioRisk.available_cash_provided && portfolioRisk.cash_percentage < 5) ||
      highRiskCount >= 2
    ) {
      return "High";
    }

    if (
      (portfolioRisk.available_cash_provided && portfolioRisk.planned_cash_usage_percentage > 15) ||
      portfolioRisk.largest_position.current_allocation > 25 ||
      highRiskCount === 1 ||
      portfolioRisk.over_allocated_tickers.length > 0
    ) {
      return "Medium";
    }

    return "Low";
  }

  function addSignalReason(signal, text) {
    if (!text) return;
    signal.reason = signal.reason ? signal.reason + " " + text : text;
  }

  function addSignalWarning(signal, text) {
    if (!text) return;
    const parts = signal.warning && signal.warning !== t("none") ? splitWarnings(signal.warning) : [];
    if (!parts.includes(text)) parts.push(text);
    signal.warning = parts.length ? joinWarnings(parts) : t("none");
  }

  async function runBacktestComparison() {
    if (!backtestSummaryEl || !runBacktestBtn) return;
    runBacktestBtn.disabled = true;
    runBacktestBtn.textContent = t("backtestRunning");
    renderBacktestMessage(t("backtestRunning"));

    try {
      const priceSets = await Promise.all(state.portfolio.map(async function (stock) {
        const prices = await fetchBacktestWeeklyPrices(stock.symbol);
        return { stock, prices };
      }));
      const result = calculateBacktestComparison(priceSets);
      state.backtestResult = result;
      renderBacktestResult(result);
    } catch (error) {
      console.warn("Backtest failed", error);
      renderBacktestMessage(t("backtestFailed"), true);
    } finally {
      runBacktestBtn.disabled = false;
      runBacktestBtn.textContent = t("runBacktest");
    }
  }

  function calculateBacktestComparison(priceSets) {
    const validSets = priceSets.filter(function (item) {
      return item.prices.length >= 2;
    });
    if (validSets.length !== state.portfolio.length) {
      throw new Error(t("backtestNeedData"));
    }

    const commonLength = Math.min.apply(null, validSets.map(function (item) {
      return item.prices.length;
    }));
    if (commonLength < 2) throw new Error(t("backtestNeedData"));

    const aligned = validSets.map(function (item) {
      return {
        stock: item.stock,
        prices: item.prices.slice(item.prices.length - commonLength)
      };
    });

    const enhanced = simulateBacktestStrategy(aligned, "enhanced");
    const smooth = simulateBacktestStrategy(aligned, "smooth");
    const old = simulateBacktestStrategy(aligned, "old");
    const dca = simulateBacktestStrategy(aligned, "dca");
    const strategies = [
      { label: t("enhancedDipBuyStrategy"), data: enhanced },
      { label: t("smoothDipBuyStrategy"), data: smooth },
      { label: t("oldDipBuyStrategy"), data: old },
      { label: t("fixedDcaStrategy"), data: dca }
    ];
    const ranked = strategies.slice().sort(function (left, right) {
      return riskAdjustedBacktestScore(right.data) - riskAdjustedBacktestScore(left.data);
    });

    return {
      start_date: aligned[0].prices[1].date,
      end_date: aligned[0].prices[commonLength - 1].date,
      enhanced,
      smooth,
      old,
      dca,
      beats_dca: enhanced.final_value > dca.final_value,
      beats_old: enhanced.final_value > old.final_value,
      beats_smooth: enhanced.final_value > smooth.final_value,
      best_strategy: ranked[0].label,
      worst_strategy: ranked[ranked.length - 1].label
    };
  }

  function simulateBacktestStrategy(aligned, mode) {
    const positions = aligned.reduce(function (items, item) {
      items[item.stock.symbol] = {
        shares: 0,
        invested: 0,
        buys: 0,
        avg_buy_price: 0
      };
      return items;
    }, {});
    const history = [];
    let totalInvested = 0;
    let totalBuys = 0;
    let weightedAverageNumerator = 0;
    let peakValue = 0;
    let maxDrawdown = 0;
    const returnHistory = [];

    for (let index = 1; index < aligned[0].prices.length; index += 1) {
      const marketRegime = calculateBacktestMarketRegime(aligned, index);
      aligned.forEach(function (item) {
        const symbol = item.stock.symbol;
        const current = item.prices[index].close;
        const previous = item.prices[index - 1].close;
        const weeklyReturn = previous > 0 ? ((current - previous) / previous) * 100 : 0;
        const baseAmount = state.deployment.weeklyDeployment * item.stock.allocation;
        let multiplier = 1;
        if (mode === "enhanced") multiplier = calculateBacktestEnhancedMultiplier(item.prices, index, weeklyReturn, marketRegime);
        else if (mode === "smooth") multiplier = getMultiplier(weeklyReturn, null, weeklyReturn);
        else if (mode === "old") multiplier = getOldHardThresholdMultiplier(weeklyReturn);
        const amount = mode === "dca" ? baseAmount : baseAmount * multiplier;
        if (amount <= 0 || current <= 0) return;

        const sharesBought = amount / current;
        const position = positions[symbol];
        position.shares += sharesBought;
        position.invested += amount;
        position.buys += 1;
        totalInvested += amount;
        totalBuys += 1;
      });

      const value = aligned.reduce(function (sum, item) {
        return sum + positions[item.stock.symbol].shares * item.prices[index].close;
      }, 0);
      const previousValue = history.length ? history[history.length - 1].value : 0;
      if (previousValue > 0) returnHistory.push((value - previousValue) / previousValue);
      peakValue = Math.max(peakValue, value);
      const drawdown = peakValue > 0 ? ((peakValue - value) / peakValue) * 100 : 0;
      maxDrawdown = Math.max(maxDrawdown, drawdown);
      history.push({ date: aligned[0].prices[index].date, value });
    }

    const finalValue = history.length ? history[history.length - 1].value : 0;
    const tickerRows = aligned.map(function (item) {
      const position = positions[item.stock.symbol];
      const avgBuyPrice = position.shares > 0 ? position.invested / position.shares : 0;
      position.avg_buy_price = avgBuyPrice;
      weightedAverageNumerator += avgBuyPrice * position.invested;
      return {
        symbol: item.stock.symbol,
        invested: round2(position.invested),
        buys: position.buys,
        avg_buy_price: round2(avgBuyPrice),
        final_value: round2(position.shares * item.prices[item.prices.length - 1].close)
      };
    });

    return {
      final_value: round2(finalValue),
      total_invested: round2(totalInvested),
      total_return: totalInvested > 0 ? round2(((finalValue - totalInvested) / totalInvested) * 100) : 0,
      max_drawdown: round2(maxDrawdown),
      volatility: round2(calculateReturnVolatility(returnHistory) * 100),
      number_of_buys: totalBuys,
      average_buy_price: totalInvested > 0 ? round2(weightedAverageNumerator / totalInvested) : 0,
      tickers: tickerRows
    };
  }

  function calculateBacktestEnhancedMultiplier(prices, index, weeklyReturn, marketRegime) {
    const rows = prices.slice(0, index + 1);
    const closes = rows.map(function (row) { return row.close; });
    const smooth = calculateSmoothMultiplier(weeklyReturn, null, weeklyReturn);
    const trend = analyzeTickerTrend(closes, weeklyReturn);
    const volatility = calculateWeeklyVolatility(closes, 12);
    const drawdown = calculateRecentDrawdown(closes, 52);
    let multiplier = smooth.multiplier;

    if (LOW_FREQ_ALGO_PARAMS.volatilityAdjustmentEnabled && isFiniteNumber(volatility) && volatility > 0) {
      multiplier *= clamp(LOW_FREQ_ALGO_PARAMS.targetWeeklyVolatility / volatility, 0.7, 1.1);
    }
    if (LOW_FREQ_ALGO_PARAMS.marketRegimeEnabled) {
      multiplier = Math.min(multiplier, getMarketRegimeMultiplierCap(marketRegime.type));
    }
    if (LOW_FREQ_ALGO_PARAMS.trendFilterEnabled && trend.status === "strong_downtrend") {
      multiplier = Math.min(multiplier, trend.severe ? ALGORITHM_PARAMS.severeDowntrendMultiplier : ALGORITHM_PARAMS.maxDowntrendMultiplier);
    }
    if (LOW_FREQ_ALGO_PARAMS.drawdownFilterEnabled && isFiniteNumber(drawdown)) {
      if (drawdown > 35) multiplier = Math.min(multiplier, LOW_FREQ_ALGO_PARAMS.maxDrawdown35Multiplier);
      else if (drawdown >= 20) multiplier = Math.min(multiplier, LOW_FREQ_ALGO_PARAMS.maxDrawdown20Multiplier);
    }
    return round2(clamp(multiplier, ALGORITHM_PARAMS.minMultiplier, ALGORITHM_PARAMS.maxMultiplier));
  }

  function calculateBacktestMarketRegime(aligned, index) {
    const synthetic = [];
    for (let rowIndex = 0; rowIndex <= index; rowIndex += 1) {
      const close = aligned.reduce(function (sum, item) {
        return sum + item.prices[rowIndex].close * item.stock.allocation;
      }, 0);
      synthetic.push({ date: aligned[0].prices[rowIndex].date, close });
    }
    return calculateMarketRegimeFromPrices(synthetic, "Portfolio proxy");
  }

  function calculateReturnVolatility(returns) {
    if (!Array.isArray(returns) || returns.length < 2) return 0;
    const average = returns.reduce(function (sum, value) { return sum + value; }, 0) / returns.length;
    const variance = returns.reduce(function (sum, value) {
      return sum + Math.pow(value - average, 2);
    }, 0) / (returns.length - 1);
    return Math.sqrt(variance);
  }

  function riskAdjustedBacktestScore(data) {
    return data.total_return - data.max_drawdown - data.volatility;
  }

  function renderBacktestMessage(message, warning) {
    if (!backtestSummaryEl) return;
    backtestSummaryEl.dataset.hasResult = "false";
    backtestSummaryEl.innerHTML = "";
    const note = document.createElement("p");
    note.className = "fine-print";
    note.textContent = message;
    if (warning) note.classList.add("risk-high");
    backtestSummaryEl.appendChild(note);
  }

  function renderBacktestIntro() {
    if (!backtestSummaryEl || backtestSummaryEl.dataset.hasResult === "true") return;
    renderBacktestMessage(t("backtestIntro"));
  }

  function renderAlgorithmTestPresets() {
    if (!algorithmTestPresetsEl) return;
    algorithmTestPresetsEl.innerHTML = "";
    [-2, -5, -10, -15, -25, 5, 10].forEach(function (value) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "algorithm-test-preset";
      button.textContent = formatSignedInput(value);
      button.addEventListener("click", function () {
        if (algorithmTestInput) algorithmTestInput.value = String(value);
        renderAlgorithmTestPanel();
      });
      algorithmTestPresetsEl.appendChild(button);
    });
  }

  function renderAlgorithmTestPanel() {
    if (!algorithmTestResultEl || !algorithmTestInput) return;
    const decisionChange = Number(String(algorithmTestInput.value || "").replace("%", "").trim());
    if (!Number.isFinite(decisionChange)) {
      algorithmTestResultEl.innerHTML = "";
      const note = document.createElement("p");
      note.className = "fine-print risk-high";
      note.textContent = t("invalidAlgorithmTestInput");
      algorithmTestResultEl.appendChild(note);
      return;
    }

    const signal = buildAlgorithmTestSignal(decisionChange);
    const metrics = [
      [t("testScenario"), formatSigned(decisionChange) + "%"],
      [t("multiplier"), formatMultiplier(signal.multiplier)],
      [t("signalScore"), String(signal.signal_score)],
      [t("signalStrength"), signal.signal_strength],
      [t("riskLevel"), displayRiskLevel(signal.risk_level)],
      [t("actionLabel"), displayAction(signal.suggested_action)],
      [t("marketRegime"), localizeMarketRegime(signal.algorithm.market_regime) + " / " + formatMultiplier(signal.algorithm.regime_adjustment)],
      [t("trendStatus"), signal.algorithm.trend.label + " / " + formatMultiplier(signal.algorithm.trend_adjustment)],
      [t("volatilityStatus"), formatMultiplier(signal.algorithm.volatility_adjustment)],
      [t("drawdownStatus"), formatMultiplier(signal.algorithm.drawdown_adjustment)],
      [t("finalMultiplier"), formatMultiplier(signal.final_multiplier)]
    ];

    algorithmTestResultEl.innerHTML = "";
    const grid = document.createElement("div");
    grid.className = "algorithm-test-grid";
    metrics.forEach(function (item) {
      const block = document.createElement("div");
      block.innerHTML = "<span></span><strong></strong>";
      block.querySelector("span").textContent = item[0];
      block.querySelector("strong").textContent = item[1];
      grid.appendChild(block);
    });
    algorithmTestResultEl.appendChild(grid);
    algorithmTestResultEl.appendChild(createAlgorithmTestTextBlock(t("reason"), signal.reason));
    algorithmTestResultEl.appendChild(createAlgorithmTestTextBlock(t("warning"), signal.warning));
  }

  function buildAlgorithmTestSignal(decisionChange) {
    const marketRegime = state.marketRegime || getNeutralMarketRegime("QQQ");
    const algorithm = calculateEnhancedLowFrequencyMultiplier(
      "__TEST__",
      decisionChange,
      null,
      decisionChange,
      marketRegime
    );
    const baseBuyAmount = 100;
    const signal = {
      symbol: "__TEST__",
      latest_price: null,
      daily_change: null,
      weekly_change: decisionChange,
      decision_change: decisionChange,
      multiplier: algorithm.multiplier,
      base_buy_amount: baseBuyAmount,
      suggested_buy_amount: round2(baseBuyAmount * algorithm.multiplier),
      signal_score: 0,
      signal_strength: t("signalDataNeeded"),
      suggested_action: "DO_NOT_BUY",
      risk_level: "Medium",
      reason: "",
      warning: "",
      data_source: t("testOnly"),
      data_freshness: "fresh",
      data_age_hours: 0,
      manual_override_active: false,
      panic_active: false,
      algorithm,
      raw_smooth_multiplier: algorithm.raw_smooth_multiplier,
      volatility_adjustment: algorithm.volatility_adjustment,
      regime_adjustment: algorithm.regime_adjustment,
      trend_adjustment: algorithm.trend_adjustment,
      drawdown_adjustment: algorithm.drawdown_adjustment,
      portfolio_adjustment: 1,
      final_multiplier: algorithm.final_multiplier,
      final_suggested_buy_amount: round2(baseBuyAmount * algorithm.final_multiplier),
      note: ""
    };
    signal.signal_score = calculateSignalScore({
      decisionChange: signal.decision_change,
      weeklyChange: signal.weekly_change,
      dailyChange: signal.daily_change,
      multiplier: signal.multiplier,
      panicActive: signal.panic_active,
      dataSource: signal.data_source,
      dataAgeHours: signal.data_age_hours,
      manualOverrideActive: signal.manual_override_active,
      algorithm: signal.algorithm
    });
    signal.risk_level = calculateRiskLevel(signal);
    signal.suggested_action = getSuggestedAction(signal);
    signal.signal_strength = getSignalStrength(signal);
    signal.suggested_buy_amount = calculateRiskAdjustedBuyAmount(signal);
    signal.final_suggested_buy_amount = signal.suggested_buy_amount;
    signal.reason = generateSignalReason(signal);
    signal.warning = generateSignalWarning(signal);
    return signal;
  }

  function createAlgorithmTestTextBlock(label, value) {
    const block = document.createElement("div");
    block.className = "algorithm-test-note";
    block.innerHTML = "<span></span><p></p>";
    block.querySelector("span").textContent = label;
    block.querySelector("p").textContent = value;
    return block;
  }

  function clearBacktestResult() {
    state.backtestResult = null;
    if (backtestSummaryEl) {
      backtestSummaryEl.dataset.hasResult = "false";
      renderBacktestMessage(t("backtestIntro"));
    }
  }

  function renderBacktestResult(result) {
    if (!backtestSummaryEl) return;
    backtestSummaryEl.dataset.hasResult = "true";
    backtestSummaryEl.innerHTML = "";

    const metrics = document.createElement("div");
    metrics.className = "backtest-metrics";
    [
      [t("backtestWindow"), result.start_date + " - " + result.end_date],
      [t("beatsDca"), result.beats_dca ? t("yes") : t("no")],
      [t("beatsOld"), result.beats_old ? t("yes") : t("no")],
      [t("beatsSmooth"), result.beats_smooth ? t("yes") : t("no")],
      [t("bestStrategy"), result.best_strategy],
      [t("worstStrategy"), result.worst_strategy],
      [t("finalValue") + " (" + t("enhancedDipBuyStrategy") + ")", formatCurrency(result.enhanced.final_value)],
      [t("finalValue") + " (" + t("smoothDipBuyStrategy") + ")", formatCurrency(result.smooth.final_value)],
      [t("finalValue") + " (" + t("oldDipBuyStrategy") + ")", formatCurrency(result.old.final_value)],
      [t("finalValue") + " (" + t("fixedDcaStrategy") + ")", formatCurrency(result.dca.final_value)],
      [t("totalReturn") + " (" + t("enhancedDipBuyStrategy") + ")", formatPercent(result.enhanced.total_return)],
      [t("totalReturn") + " (" + t("smoothDipBuyStrategy") + ")", formatPercent(result.smooth.total_return)],
      [t("totalReturn") + " (" + t("oldDipBuyStrategy") + ")", formatPercent(result.old.total_return)],
      [t("totalReturn") + " (" + t("fixedDcaStrategy") + ")", formatPercent(result.dca.total_return)],
      [t("maxDrawdown") + " (" + t("enhancedDipBuyStrategy") + ")", formatPercent(result.enhanced.max_drawdown)],
      [t("maxDrawdown") + " (" + t("smoothDipBuyStrategy") + ")", formatPercent(result.smooth.max_drawdown)],
      [t("maxDrawdown") + " (" + t("oldDipBuyStrategy") + ")", formatPercent(result.old.max_drawdown)],
      [t("maxDrawdown") + " (" + t("fixedDcaStrategy") + ")", formatPercent(result.dca.max_drawdown)]
    ].forEach(function (item) {
      const metric = document.createElement("div");
      metric.className = "backtest-metric";
      metric.innerHTML = "<span></span><strong></strong>";
      metric.querySelector("span").textContent = item[0];
      metric.querySelector("strong").textContent = item[1];
      metrics.appendChild(metric);
    });
    backtestSummaryEl.appendChild(metrics);

    backtestSummaryEl.appendChild(createBacktestStrategyTable(result));
  }

  function createBacktestStrategyTable(result) {
    const wrap = document.createElement("div");
    wrap.className = "backtest-table-wrap";
    const table = document.createElement("table");
    table.className = "backtest-table";
    table.innerHTML = [
      "<thead><tr>",
      "<th>" + escapeHtml(t("strategy")) + "</th>",
      "<th>" + escapeHtml(t("finalValue")) + "</th>",
      "<th>" + escapeHtml(t("invested")) + "</th>",
      "<th>" + escapeHtml(t("totalReturn")) + "</th>",
      "<th>" + escapeHtml(t("maxDrawdown")) + "</th>",
      "<th>" + escapeHtml(t("volatility")) + "</th>",
      "<th>" + escapeHtml(t("numberOfBuys")) + "</th>",
      "<th>" + escapeHtml(t("avgBuyPrice")) + "</th>",
      "</tr></thead><tbody></tbody>"
    ].join("");
    const tbody = table.querySelector("tbody");
    [
      createBacktestRow(t("enhancedDipBuyStrategy"), result.enhanced),
      createBacktestRow(t("smoothDipBuyStrategy"), result.smooth),
      createBacktestRow(t("oldDipBuyStrategy"), result.old),
      createBacktestRow(t("fixedDcaStrategy"), result.dca)
    ].forEach(function (row) {
      tbody.appendChild(row);
    });
    wrap.appendChild(table);
    return wrap;
  }

  function createBacktestRow(label, data) {
    const row = document.createElement("tr");
    [
      label,
      formatCurrency(data.final_value),
      formatCurrency(data.total_invested),
      formatPercent(data.total_return),
      formatPercent(data.max_drawdown),
      formatPercent(data.volatility),
      String(data.number_of_buys),
      formatPrice(data.average_buy_price)
    ].forEach(function (value, index) {
      const cell = document.createElement("td");
      if (index === 0) {
        const strong = document.createElement("strong");
        strong.textContent = value;
        cell.appendChild(strong);
      } else {
        cell.textContent = value;
      }
      row.appendChild(cell);
    });
    return row;
  }

  function render() {
    panicBanner.classList.toggle("hidden", !state.panicActive);
    renderDeploymentSummary();

    const orderLines = [t("manualPlanHeader"), ""];
    const entries = [];
    let rawTotal = 0;
    let roundedTotal = 0;
    let latestTimestamp = 0;

    state.portfolio.forEach(function (stock) {
      const row = state.rows.get(stock.symbol);
      const signal = buildSignalObject(stock, row);
      entries.push({ stock, row, signal, rawAmount: signal.suggested_buy_amount });
      latestTimestamp = Math.max(latestTimestamp, row && row.fetchedAt ? row.fetchedAt : 0);
    });

    const portfolioRisk = calculatePortfolioRisk(entries);
    applyPortfolioRiskAdjustments(entries, portfolioRisk);
    portfolioRisk.total_planned_buy_amount = round2(entries.reduce(function (sum, entry) {
      return sum + entry.signal.suggested_buy_amount;
    }, 0));
    portfolioRisk.planned_cash_usage_percentage = portfolioRisk.available_cash_provided && portfolioRisk.available_cash > 0
      ? round2((portfolioRisk.total_planned_buy_amount / portfolioRisk.available_cash) * 100)
      : null;
    finalizePortfolioRisk(portfolioRisk, entries);

    entries.forEach(function (entry) {
      const rawAmount = entry.signal.suggested_buy_amount;
      const amount = round2(rawAmount);
      entry.rawAmount = rawAmount;
      entry.signal.suggested_buy_amount = amount;
      entry.signal.final_suggested_buy_amount = amount;
      rawTotal += rawAmount;
      roundedTotal = round2(roundedTotal + amount);
    });

    const targetTotal = round2(rawTotal);
    const pennyDifference = round2(targetTotal - roundedTotal);
    if (pennyDifference !== 0 && entries.length) {
      entries[0].signal.suggested_buy_amount = round2(entries[0].signal.suggested_buy_amount + pennyDifference);
      entries[0].signal.final_suggested_buy_amount = entries[0].signal.suggested_buy_amount;
    }

    entries.forEach(function (entry) {
      const card = cardsEl.querySelector('[data-symbol="' + entry.stock.symbol + '"]');
      updateCard(card, entry.signal);
      orderLines.push(formatManualTradePlanEntry(entry.signal));
    });

    window.__SUINVESTMENT_SIGNALS__ = entries.map(function (entry) {
      return entry.signal;
    });
    window.__SUINVESTMENT_PORTFOLIO_RISK__ = portfolioRisk;

    orderLines.push("");
    orderLines.push(t("total") + ":");
    orderLines.push("CAD " + targetTotal.toFixed(2));
    orderLines.push("");
    orderLines.push(t("safetyDisclaimer"));
    orderTextEl.textContent = orderLines.join("\n");
    lastUpdatedEl.textContent = latestTimestamp ? t("updated") + " " + formatDateTime(latestTimestamp) : t("noLiveData");
    renderPortfolioTotal();
    renderPortfolioRiskSummary(portfolioRisk);
    renderOverviewSummary(portfolioRisk);
  }

  function updateCard(card, signal) {
    ensureSignalFields(card);
    const badge = card.querySelector(".source-badge");
    const weeklyEl = card.querySelector(".weekly-change");

    badge.textContent = signal.data_source;
    badge.className = "source-badge " + sourceClass(signal.data_source);

    weeklyEl.className = "weekly-change";
    if (isFiniteNumber(signal.signal_score)) {
      weeklyEl.textContent = String(signal.signal_score);
      weeklyEl.classList.add(signal.signal_score >= 61 ? "positive" : "negative");
    } else {
      weeklyEl.textContent = "--";
    }

    card.querySelector(".signal-strength").textContent = signal.signal_strength;
    var labelResult = getActionLabelFromMultiplier(signal);
    card.querySelector(".action-badge").textContent = labelResult.label;
    card.querySelector(".action-badge").className = "action-badge " + labelResult.cls;
    card.querySelector(".risk-level").textContent = displayRiskLevel(signal.risk_level);
    card.querySelector(".multiplier").textContent = formatMultiplier(signal.multiplier);
    card.querySelector(".buy-amount").textContent = "CAD " + signal.suggested_buy_amount.toFixed(2);
    const priceText = isFiniteNumber(signal.latest_price) ? formatPrice(signal.latest_price) : "--";
    card.querySelector(".price").textContent = isFiniteNumber(signal.latest_price) ? priceText : "--";
    setChangeMetric(card.querySelector(".daily-change"), signal.daily_change);
    setChangeMetric(card.querySelector(".five-day-change"), signal.weekly_change);
    card.querySelector(".decision-reason").textContent = signal.reason;
    card.querySelector(".decision-warning").textContent = signal.warning;
    updateAlgorithmDetails(card, signal);

    const panicText = signal.panic_active ? " + panic 1.3x" : "";
    card.querySelector(".note").textContent = [signal.note, panicText.trim()]
      .filter(Boolean)
      .join("; ");
    ensureActionExplanation(card, signal);
  }

  function ensureSignalFields(card) {
    const stockValues = card.querySelector(".stock-values");
    if (stockValues) {
      if (!stockValues.querySelector(".daily-change")) {
        stockValues.insertBefore(createMetric("1D", "daily-change"), stockValues.firstChild || null);
      }

      if (!stockValues.querySelector(".five-day-change")) {
        stockValues.insertBefore(createMetric("5D", "five-day-change"), stockValues.children[1] || null);
      }

      const signalScore = stockValues.querySelector(".weekly-change");
      if (signalScore && signalScore.previousElementSibling) {
        signalScore.previousElementSibling.textContent = t("signalScore");
      }

      if (!stockValues.querySelector(".signal-strength")) {
        stockValues.insertBefore(createMetric(t("signalStrength"), "signal-strength"), stockValues.children[1] || null);
      }

      if (!stockValues.querySelector(".risk-level")) {
        stockValues.insertBefore(createMetric(t("riskLevel"), "risk-level"), stockValues.children[2] || null);
      }
    }

    if (!card.querySelector(".action-badge")) {
      const actions = card.querySelector(".stock-actions");
      if (actions) {
        const badge = document.createElement("span");
        badge.className = "action-badge";
        actions.insertBefore(badge, actions.firstChild);
      }
    }

    if (!card.querySelector(".decision-context")) {
      const context = document.createElement("details");
      context.className = "decision-context";
      const summary = document.createElement("summary");
      summary.textContent = t("reason") + " / " + t("warning");
      context.appendChild(summary);
      context.appendChild(createTextBlock(t("reason"), "decision-reason"));
      context.appendChild(createTextBlock(t("warning"), "decision-warning"));
      const anchor = card.querySelector(".algorithm-details") || card.querySelector(".override-row");
      card.insertBefore(context, anchor || null);
    }

    if (!card.querySelector(".algorithm-details")) {
      const details = document.createElement("details");
      details.className = "algorithm-details";
      details.innerHTML = [
        "<summary></summary>",
        "<div class=\"algorithm-grid\">",
        "<div><span></span><strong data-algo-field=\"market\"></strong></div>",
        "<div><span></span><strong data-algo-field=\"trend\"></strong></div>",
        "<div><span></span><strong data-algo-field=\"volatility\"></strong></div>",
        "<div><span></span><strong data-algo-field=\"drawdown\"></strong></div>",
        "<div><span></span><strong data-algo-field=\"final\"></strong></div>",
        "</div>",
        "<p class=\"algorithm-explanation\"></p>"
      ].join("");
      const anchor = card.querySelector(".override-row");
      card.insertBefore(details, anchor || null);
    }
  }

  function updateAlgorithmDetails(card, signal) {
    const details = card.querySelector(".algorithm-details");
    if (!details || !signal.algorithm) return;
    details.querySelector("summary").textContent = t("algorithmDetails");
    const labels = details.querySelectorAll(".algorithm-grid span");
    if (labels[0]) labels[0].textContent = t("marketRegime");
    if (labels[1]) labels[1].textContent = t("trendStatus");
    if (labels[2]) labels[2].textContent = t("volatilityStatus");
    if (labels[3]) labels[3].textContent = t("drawdownStatus");
    if (labels[4]) labels[4].textContent = t("finalMultiplier");
    setAlgoField(details, "market", signal.algorithm.market_regime ? localizeMarketRegime(signal.algorithm.market_regime) : t("regimeNeutral"));
    setAlgoField(details, "trend", signal.algorithm.trend ? signal.algorithm.trend.label : t("trendMixed"));
    setAlgoField(details, "volatility", describeVolatility(signal.algorithm.realized_weekly_volatility));
    setAlgoField(details, "drawdown", describeDrawdown(signal.algorithm.drawdown));
    setAlgoField(details, "final", formatMultiplier(signal.final_multiplier || signal.multiplier));
    const explanation = details.querySelector(".algorithm-explanation");
    if (explanation) explanation.textContent = buildAlgorithmExplanation(signal);
  }

  function setAlgoField(root, field, value) {
    const element = root.querySelector('[data-algo-field="' + field + '"]');
    if (element) element.textContent = value;
  }

  function setChangeMetric(element, value) {
    if (!element) return;
    element.className = element.className.replace(/\bpositive\b|\bnegative\b/g, "").trim();
    if (!isFiniteNumber(value)) {
      element.textContent = "--";
      return;
    }
    element.textContent = formatSigned(value) + "%";
    element.classList.add(value >= 0 ? "positive" : "negative");
  }

  function describeVolatility(value) {
    if (!isFiniteNumber(value)) return t("notProvided");
    if (value >= 6) return t("volatilityHigh") + " " + formatPercent(value);
    if (value <= 2.5) return t("volatilityLow") + " " + formatPercent(value);
    return t("volatilityNormal") + " " + formatPercent(value);
  }

  function describeDrawdown(value) {
    if (!isFiniteNumber(value)) return t("notProvided");
    if (value > 35) return t("drawdownSevere") + " " + formatPercent(value);
    if (value >= 20) return t("drawdownDeep") + " " + formatPercent(value);
    if (value >= 10) return t("drawdownModerate") + " " + formatPercent(value);
    return t("drawdownNormal") + " " + formatPercent(value);
  }

  function buildAlgorithmExplanation(signal) {
    if (!signal.algorithm) return t("enhancedAlgorithmSummary");
    const parts = [
      t("rawSmooth") + " " + formatMultiplier(signal.algorithm.raw_smooth_multiplier || signal.multiplier),
      t("volAdj") + " " + formatMultiplier(signal.algorithm.volatility_adjustment || 1),
      t("regimeCap") + " " + formatMultiplier(signal.algorithm.regime_adjustment || LOW_FREQ_ALGO_PARAMS.maxNeutralMultiplier),
      t("trendCap") + " " + formatMultiplier(signal.algorithm.trend_adjustment || ALGORITHM_PARAMS.maxMultiplier),
      t("drawdownCap") + " " + formatMultiplier(signal.algorithm.drawdown_adjustment || ALGORITHM_PARAMS.maxMultiplier),
      t("portfolioAdj") + " " + formatMultiplier(signal.portfolio_adjustment || 1),
      t("finalMultiplierShort") + " " + formatMultiplier(signal.final_multiplier || signal.multiplier)
    ];
    return t("enhancedAlgorithmSummary") + " (" + parts.join(", ") + ")";
  }

  function createMetric(label, className) {
    const wrapper = document.createElement("div");
    const labelEl = document.createElement("span");
    const valueEl = document.createElement("strong");
    labelEl.textContent = label;
    valueEl.className = className;
    valueEl.textContent = t("loading");
    wrapper.appendChild(labelEl);
    wrapper.appendChild(valueEl);
    return wrapper;
  }

  function createTextBlock(label, className) {
    const wrapper = document.createElement("div");
    const labelEl = document.createElement("span");
    const valueEl = document.createElement("p");
    labelEl.textContent = label;
    valueEl.className = className;
    valueEl.textContent = t("waitingForMarketData");
    wrapper.appendChild(labelEl);
    wrapper.appendChild(valueEl);
    return wrapper;
  }

  function formatManualTradePlanEntry(signal) {
    return [
      signal.symbol + " - " + displayAction(signal.suggested_action) + " - CAD " + signal.suggested_buy_amount.toFixed(2) + " - " + t("scoreLabel") + " " + signal.signal_score + " - " + t("riskLabel") + " " + displayRiskLevel(signal.risk_level),
      t("reasonLabel") + ": " + signal.reason,
      t("warningLabel") + ": " + signal.warning + sentenceEnd()
    ].join("\n");
  }

  function formatSignalNote(signal) {
    const parts = [];
    if (isFiniteNumber(signal.daily_change)) parts.push("1d " + formatSigned(signal.daily_change) + "%");
    if (isFiniteNumber(signal.weekly_change)) parts.push("5d " + formatSigned(signal.weekly_change) + "%");
    return parts.length ? parts.join(" / ") : "";
  }

  function applyOverride(symbol, rawValue) {
    const normalized = String(rawValue).trim().replace("%", "");
    if (!/^[+-]?(\d+(\.\d*)?|\.\d+)$/.test(normalized)) {
      copyStatusEl.textContent = t("overrideNumber", { symbol });
      return;
    }

    state.overrides[symbol] = Number(normalized);
    saveOverrides();
    applyManualOverrides();
    render();
    copyStatusEl.textContent = t("overrideApplied", { symbol });
  }

  function clearOverride(symbol) {
    delete state.overrides[symbol];
    saveOverrides();

    const card = cardsEl.querySelector('[data-symbol="' + symbol + '"]');
    if (card) card.querySelector(".override-input").value = "";

    applyManualOverrides();
    render();
    copyStatusEl.textContent = t("overrideCleared", { symbol });
  }

  async function copyOrderList() {
    copyStatusEl.textContent = "";
    try {
      await navigator.clipboard.writeText(orderTextEl.textContent);
      copyStatusEl.textContent = t("orderCopied");
    } catch (error) {
      copyStatusEl.textContent = t("copyManually");
    }
  }

  function saveCache(symbol, snapshot) {
    state.cache[symbol] = {
      ...snapshot,
      fetchedAt: Date.now()
    };
    saveJson(STORAGE_KEYS.cache, state.cache);
  }

  function getValidCache(symbol) {
    const cached = state.cache[symbol];
    if (!cached || !cached.fetchedAt) return null;

    const ageMs = Date.now() - cached.fetchedAt;
    if (ageMs > CONFIG.cacheHours * 60 * 60 * 1000) return null;
    return cached;
  }

  function normalizePortfolio(items, options) {
    const allowCustom = options && options.allowCustom;
    const defaultSymbols = new Set(CONFIG.defaultStocks.map(function (stock) { return stock.symbol; }));
    const seen = new Set();
    return (Array.isArray(items) ? items : []).reduce(function (portfolio, item) {
      const symbol = normalizeSymbol(item && item.symbol);
      const allocation = Number(item && item.allocation);
      const supported = defaultSymbols.has(symbol);
      if (!symbol || (!supported && !allowCustom) || seen.has(symbol) || !Number.isFinite(allocation) || allocation < 0) {
        return portfolio;
      }

      seen.add(symbol);
      portfolio.push({
        symbol,
        name: String(item.name || symbol).trim() || symbol,
        allocation: round2(allocation * 100) / 100
      });
      return portfolio;
    }, []);
  }

  function normalizeSymbol(value) {
    const symbol = String(value || "").trim().toUpperCase();
    if (!/^[A-Z0-9.-]{1,12}$/.test(symbol)) return "";
    return symbol;
  }

  function parseAllocation(value) {
    const number = Number(String(value).trim().replace("%", ""));
    if (!Number.isFinite(number) || number < 0) return 0;
    return round2(number) / 100;
  }

  function normalizePortfolioRiskInput(value) {
    const input = value && typeof value === "object" ? value : {};
    const positions = input.positions && typeof input.positions === "object" ? input.positions : {};
    const hasAvailableCash = Object.prototype.hasOwnProperty.call(input, "available_cash") && String(input.available_cash).trim() !== "";
    return {
      available_cash: hasAvailableCash ? readPositiveNumber(input.available_cash) : 0,
      available_cash_provided: hasAvailableCash,
      positions: Object.keys(positions).reduce(function (items, symbol) {
        const normalizedSymbol = normalizeSymbol(symbol);
        if (!normalizedSymbol) return items;
        const position = positions[symbol] || {};
        items[normalizedSymbol] = {
          shares: readPositiveNumber(position.shares),
          average_cost: readPositiveNumber(position.average_cost),
          current_value: readPositiveNumber(position.current_value),
          target_allocation: readPositiveNumber(position.target_allocation),
          notes: String(position.notes || "")
        };
        return items;
      }, {})
    };
  }

  function normalizeDeployment(value) {
    const input = value && typeof value === "object" ? value : {};
    const normalPool = readNonNegativeNumber(input.normalPool, DEFAULT_DEPLOYMENT.normalPool);
    const crashFund = readNonNegativeNumber(input.crashFund, DEFAULT_DEPLOYMENT.crashFund);
    const monthlyBudget = round2(normalPool + crashFund);
    return {
      monthlyBudget,
      normalPool,
      crashFund,
      weeklyDeployment: round2(normalPool / WEEKS_PER_MONTH)
    };
  }

  function updateDeploymentFromInput(field, value) {
    const parsed = parseDeploymentNumber(value);
    if (!parsed.valid) {
      showDeploymentStatus(t("invalidDeploymentInput"), true);
      return;
    }

    const current = state.deployment;
    let normalPool = current.normalPool;
    let crashFund = current.crashFund;

    if (field === "monthlyBudget") {
      const total = current.normalPool + current.crashFund;
      const normalRatio = total > 0 ? current.normalPool / total : 0.75;
      normalPool = round2(parsed.value * normalRatio);
      crashFund = round2(parsed.value - normalPool);
    } else if (field === "normalPool") {
      normalPool = parsed.value;
    } else if (field === "crashFund") {
      crashFund = parsed.value;
    } else if (field === "weeklyDeployment") {
      normalPool = round2(parsed.value * WEEKS_PER_MONTH);
    }

    state.deployment = normalizeDeployment({ normalPool, crashFund });
    saveDeployment();
    clearBacktestResult();
    renderDeploymentSettings(field);
    showDeploymentStatus(t("deploymentSaved"), false);
    applyManualOverrides();
    renderSkeleton();
    render();
  }

  function resetDeploymentDefaults() {
    state.deployment = normalizeDeployment(DEFAULT_DEPLOYMENT);
    saveDeployment();
    clearBacktestResult();
    renderDeploymentSettings();
    showDeploymentStatus(t("deploymentReset"), false);
    applyManualOverrides();
    renderSkeleton();
    render();
  }

  function handleDeploymentInputKeydown(event) {
    if (event.ctrlKey || event.metaKey) {
      const key = event.key.toLowerCase();
      if (["a", "c", "v", "x"].includes(key)) return;
    }

    if ([
      "Backspace",
      "Delete",
      "ArrowLeft",
      "ArrowRight",
      "ArrowUp",
      "ArrowDown",
      "Home",
      "End",
      "Tab",
      "Enter"
    ].includes(event.key)) {
      return;
    }

    if (/^\d$/.test(event.key)) return;
    if (event.key === "." && !event.currentTarget.value.includes(".")) return;
    event.preventDefault();
  }

  function saveDeploymentFromForm() {
    const parsed = {};
    const fields = Object.keys(deploymentInputs);
    for (let index = 0; index < fields.length; index += 1) {
      const field = fields[index];
      const input = deploymentInputs[field];
      if (!input) continue;
      const value = parseDeploymentNumber(input.value);
      if (!value.valid) {
        showDeploymentStatus(t("invalidDeploymentInput"), true);
        input.focus();
        return;
      }
      parsed[field] = value.value;
    }

    state.deployment = calculateDeploymentFromEditedField(getLastEditedDeploymentField(), parsed);
    saveDeployment();
    clearBacktestResult();
    renderDeploymentSettings();
    showDeploymentStatus(t("deploymentSaved"), false);
    applyManualOverrides();
    renderSkeleton();
    render();
  }

  function calculateDeploymentFromEditedField(field, parsed) {
    let normalPool = parsed.normalPool;
    let crashFund = parsed.crashFund;

    if (field === "monthlyBudget") {
      const currentTotal = state.deployment.normalPool + state.deployment.crashFund;
      const normalRatio = currentTotal > 0 ? state.deployment.normalPool / currentTotal : 0.75;
      normalPool = round2(parsed.monthlyBudget * normalRatio);
      crashFund = round2(parsed.monthlyBudget - normalPool);
    } else if (field === "weeklyDeployment") {
      normalPool = round2(parsed.weeklyDeployment * WEEKS_PER_MONTH);
    }

    return normalizeDeployment({ normalPool, crashFund });
  }

  function getLastEditedDeploymentField() {
    return Object.keys(deploymentInputs).reduce(function (latestField, field) {
      const input = deploymentInputs[field];
      if (!input) return latestField;
      const latestTime = deploymentInputs[latestField] ? Number(deploymentInputs[latestField].dataset.lastEditedAt || 0) : 0;
      const fieldTime = Number(input.dataset.lastEditedAt || 0);
      return fieldTime > latestTime ? field : latestField;
    }, "monthlyBudget");
  }

  function parseDeploymentNumber(value) {
    const text = String(value || "").trim().replace(/CAD/ig, "").replace(/,/g, "");
    if (!/^\d*(?:\.\d*)?$/.test(text) || text === "" || text === ".") {
      return { valid: false, value: 0 };
    }
    const number = Number(text);
    if (!Number.isFinite(number) || number < 0) return { valid: false, value: 0 };
    return { valid: true, value: round2(number) };
  }

  function readNonNegativeNumber(value, fallback) {
    const parsed = parseDeploymentNumber(value);
    return parsed.valid ? parsed.value : fallback;
  }

  function saveDeployment() {
    saveJson(STORAGE_KEYS.deployment, {
      monthlyBudget: state.deployment.monthlyBudget,
      normalPool: state.deployment.normalPool,
      crashFund: state.deployment.crashFund,
      weeklyDeployment: state.deployment.weeklyDeployment
    });
  }

  function renderDeploymentSettings(activeField) {
    Object.keys(deploymentInputs).forEach(function (field) {
      const input = deploymentInputs[field];
      if (!input || field === activeField) return;
      input.value = state.deployment[field].toFixed(2);
    });
    renderDeploymentSummary();
  }

  function renderDeploymentSummary() {
    setMetricValue(0, formatCurrency(state.deployment.monthlyBudget));
    setMetricValue(1, formatCurrency(state.deployment.normalPool));
    setMetricValue(2, formatCurrency(state.deployment.crashFund));
    setMetricValue(3, formatCurrency(state.deployment.weeklyDeployment));
    renderOverviewSummary();
  }

  function renderOverviewSummary(portfolioRisk) {
    if (overviewWeeklyDeploymentEl) overviewWeeklyDeploymentEl.textContent = formatCurrency(state.deployment.weeklyDeployment);
    if (overviewMarketRegimeEl) {
      overviewMarketRegimeEl.textContent = localizeMarketRegime(state.marketRegime || getNeutralMarketRegime("QQQ"));
    }
    if (!portfolioRisk) {
      if (overviewPlannedBuyTotalEl) overviewPlannedBuyTotalEl.textContent = formatCurrency(0);
      if (overviewOverallRiskEl) {
        overviewOverallRiskEl.textContent = t("loading");
        overviewOverallRiskEl.className = "";
      }
      if (overviewAvailableCashEl) overviewAvailableCashEl.textContent = state.portfolioRiskInput.available_cash_provided ? formatCurrency(readPositiveNumber(state.portfolioRiskInput.available_cash)) : t("notProvided");
      return;
    }
    if (overviewPlannedBuyTotalEl) overviewPlannedBuyTotalEl.textContent = formatCurrency(portfolioRisk.total_planned_buy_amount);
    if (overviewOverallRiskEl) {
      overviewOverallRiskEl.textContent = displayRiskLevel(portfolioRisk.portfolio_risk_level);
      overviewOverallRiskEl.className = "risk-" + String(portfolioRisk.portfolio_risk_level || "").toLowerCase();
    }
    if (overviewAvailableCashEl) {
      overviewAvailableCashEl.textContent = portfolioRisk.available_cash_provided ? formatCurrency(portfolioRisk.available_cash) : t("notProvided");
    }
  }

  function showDeploymentStatus(message, warning) {
    if (!deploymentStatusEl) return;
    deploymentStatusEl.textContent = message;
    deploymentStatusEl.classList.toggle("warning", warning);
  }

  function clearDeploymentStatus() {
    if (!deploymentStatusEl) return;
    deploymentStatusEl.textContent = "";
    deploymentStatusEl.classList.remove("warning");
  }

  function getPositionInput(symbol, stock) {
    const existing = state.portfolioRiskInput.positions[symbol] || {};
    return {
      shares: existing.shares || 0,
      average_cost: existing.average_cost || 0,
      current_value: existing.current_value || 0,
      target_allocation: existing.target_allocation || round2(stock.allocation * 100),
      notes: existing.notes || ""
    };
  }

  function renderPortfolioRiskInputs() {
    availableCashInput.value = state.portfolioRiskInput.available_cash_provided ? state.portfolioRiskInput.available_cash : "";
    portfolioPositionInputsEl.innerHTML = "";

    state.portfolio.forEach(function (stock) {
      const input = getPositionInput(stock.symbol, stock);
      const row = document.createElement("div");
      row.className = "portfolio-position-row";
      row.dataset.symbol = stock.symbol;
      row.innerHTML = [
        "<h3></h3>",
        "<div class=\"portfolio-position-fields\">",
        "<label><span>" + escapeHtml(t("shares")) + "</span><input data-field=\"shares\" type=\"text\" inputmode=\"decimal\" autocomplete=\"off\"></label>",
        "<label><span>" + escapeHtml(t("avgCost")) + "</span><input data-field=\"average_cost\" type=\"text\" inputmode=\"decimal\" autocomplete=\"off\"></label>",
        "<label><span>" + escapeHtml(t("currentValue")) + "</span><input data-field=\"current_value\" type=\"text\" inputmode=\"decimal\" autocomplete=\"off\"></label>",
        "<label><span>" + escapeHtml(t("targetPercent")) + "</span><input data-field=\"target_allocation\" type=\"text\" inputmode=\"decimal\" autocomplete=\"off\"></label>",
        "<label><span>" + escapeHtml(t("notes")) + "</span><input data-field=\"notes\" type=\"text\" autocomplete=\"off\"></label>",
        "</div>"
      ].join("");

      row.querySelector("h3").textContent = stock.symbol;
      row.querySelector('[data-field="shares"]').value = input.shares || "";
      row.querySelector('[data-field="average_cost"]').value = input.average_cost || "";
      row.querySelector('[data-field="current_value"]').value = input.current_value || "";
      row.querySelector('[data-field="target_allocation"]').value = input.target_allocation || "";
      row.querySelector('[data-field="notes"]').value = input.notes || "";
      row.querySelectorAll("input").forEach(function (field) {
        field.addEventListener("change", savePortfolioRiskForm);
        field.addEventListener("keydown", function (event) {
          if (event.key === "Enter") savePortfolioRiskForm();
        });
      });
      portfolioPositionInputsEl.appendChild(row);
    });
  }

  function savePortfolioRiskForm() {
    const next = {
      available_cash: availableCashInput.value.trim() === "" ? "" : readPositiveNumber(availableCashInput.value),
      available_cash_provided: availableCashInput.value.trim() !== "",
      positions: {}
    };

    portfolioPositionInputsEl.querySelectorAll(".portfolio-position-row").forEach(function (row) {
      const symbol = row.dataset.symbol;
      next.positions[symbol] = {
        shares: readPositiveNumber(row.querySelector('[data-field="shares"]').value),
        average_cost: readPositiveNumber(row.querySelector('[data-field="average_cost"]').value),
        current_value: readPositiveNumber(row.querySelector('[data-field="current_value"]').value),
        target_allocation: readPositiveNumber(row.querySelector('[data-field="target_allocation"]').value),
        notes: row.querySelector('[data-field="notes"]').value.trim()
      };
    });

    state.portfolioRiskInput = normalizePortfolioRiskInput(next);
    saveJson(STORAGE_KEYS.portfolioRisk, state.portfolioRiskInput);
    applyManualOverrides();
    render();
    copyStatusEl.textContent = t("portfolioSaved");
  }

  function renderPortfolioRiskSummary(portfolioRisk) {
    if (!portfolioRiskSummaryEl) return;
    portfolioRiskSummaryEl.innerHTML = "";
    const metrics = document.createElement("div");
    metrics.className = "risk-metrics-grid";
    [
      [t("availableCash"), portfolioRisk.available_cash_provided ? "CAD " + portfolioRisk.available_cash.toFixed(2) : t("notProvided")],
      [t("totalPortfolioValue"), "CAD " + portfolioRisk.total_portfolio_value.toFixed(2)],
      [t("plannedBuyTotal"), "CAD " + portfolioRisk.total_planned_buy_amount.toFixed(2)],
      [t("plannedCashUsage"), portfolioRisk.available_cash_provided && isFiniteNumber(portfolioRisk.planned_cash_usage_percentage) ? portfolioRisk.planned_cash_usage_percentage.toFixed(2) + "%" : t("notProvided")],
      [t("largestPosition"), portfolioRisk.largest_position.symbol + " " + portfolioRisk.largest_position.current_allocation.toFixed(2) + "%"],
      [t("overallRisk"), displayRiskLevel(portfolioRisk.portfolio_risk_level)]
    ].forEach(function (item) {
      const metric = document.createElement("div");
      metric.className = "risk-metric";
      metric.innerHTML = "<span></span><strong></strong>";
      metric.querySelector("span").textContent = item[0];
      metric.querySelector("strong").textContent = item[1];
      if (item[0] === t("overallRisk")) metric.querySelector("strong").className = "risk-" + portfolioRisk.portfolio_risk_level.toLowerCase();
      metrics.appendChild(metric);
    });

    portfolioRiskSummaryEl.appendChild(metrics);
    portfolioRiskSummaryEl.appendChild(createRiskList(t("overAllocated"), portfolioRisk.over_allocated_tickers));
    portfolioRiskSummaryEl.appendChild(createRiskList(t("underAllocated"), portfolioRisk.under_allocated_tickers));
    portfolioRiskSummaryEl.appendChild(createRiskList(t("riskWarnings"), portfolioRisk.risk_warnings));
  }

  function createRiskList(label, items) {
    const block = document.createElement("div");
    block.className = "risk-list";
    block.innerHTML = "<span></span><p></p>";
    block.querySelector("span").textContent = label;
    block.querySelector("p").textContent = items.length ? items.join(", ") : t("none");
    return block;
  }

  function readPositiveNumber(value) {
    const normalized = String(value || "").replace(/[$,%CADcad\s]/g, "");
    const number = Number(normalized);
    return Number.isFinite(number) && number > 0 ? round2(number) : 0;
  }

  function clampPercent(value, fallback) {
    const number = Number.isFinite(value) && value > 0 ? value : fallback;
    return clamp(round2(number), 0, 100);
  }

  function renderPortfolioTotal() {
    const total = state.portfolio.reduce(function (sum, stock) {
      return sum + stock.allocation;
    }, 0);
    portfolioTotalEl.textContent = t("totalAllocation") + " " + formatPercent(total * 100);
    portfolioTotalEl.classList.toggle("warning", Math.abs(total - 1) > 0.001);
  }

  function savePortfolio() {
    saveJson(STORAGE_KEYS.portfolio, state.portfolio);
  }

  function saveOverrides() {
    saveJson(STORAGE_KEYS.overrides, state.overrides);
  }

  function saveJson(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function loadJson(key, fallback) {
    try {
      return JSON.parse(localStorage.getItem(key)) || fallback;
    } catch (error) {
      return fallback;
    }
  }

  function normalizeLanguage(value) {
    return value === "zh" ? "zh" : "en";
  }

  function toggleLanguage() {
    state.language = state.language === "en" ? "zh" : "en";
    localStorage.setItem(STORAGE_KEYS.language, state.language);
    applyLanguage();
    applyManualOverrides();
    renderPortfolioRiskInputs();
    renderSkeleton();
    render();
    renderAlgorithmTestPresets();
    renderAlgorithmTestPanel();
  }

  function t(key, params) {
    const table = I18N[state.language] || I18N.en;
    const fallback = I18N.en[key] || key;
    let value = table[key] || fallback;
    if (params) {
      Object.keys(params).forEach(function (name) {
        value = value.replace(new RegExp("\\{" + name + "\\}", "g"), params[name]);
      });
    }
    return value;
  }

  function applyLanguage() {
    document.documentElement.lang = state.language === "zh" ? "zh-Hans" : "en";
    document.title = t("pageTitle");
    setText(".hero > div .eyebrow", t("heroEyebrow"));
    setText(".hero h1", t("heroTitle"));
    setText(".hero-copy", t("heroCopy"));
    setText(".schedule-card span", t("scheduleLabel"));
    setText(".overview-panel .eyebrow", t("overview"));
    setText("#overview-title", t("dashboardSummary"));
    setOverviewLabel(0, t("weeklyDeployment"));
    setOverviewLabel(1, t("plannedBuyTotal"));
    setOverviewLabel(2, t("overallRisk"));
    setOverviewLabel(3, t("marketRegime"));
    setOverviewLabel(4, t("availableCash"));
    setText("#settings-title", t("deploymentPlan"));
    setText(".settings-panel .eyebrow", t("monthlySettings"));
    setText("#openSettingsBtn", t("settings"));
    setMetricLabel(0, t("monthlyBudget"));
    setMetricLabel(1, t("normalPool"));
    setMetricLabel(2, t("crashFund"));
    setMetricLabel(3, t("weeklyDeployment"));
    setText("#deployment-settings-title", t("deploymentSettings"));
    setText("#saveDeploymentBtn", t("save"));
    setText("#resetDeploymentBtn", t("resetDefaults"));
    setDeploymentInputLabel("monthlyBudget", t("monthlyBudget"));
    setDeploymentInputLabel("normalPool", t("normalPool"));
    setDeploymentInputLabel("crashFund", t("crashFund"));
    setDeploymentInputLabel("weeklyDeployment", t("weeklyDeployment"));
    setText("#panicBanner span", t("panicTitle"));
    setText("#panicBanner strong", t("panicBody"));
    setText(".signals-panel .eyebrow", t("allocations"));
    setText("#holdings-title", t("thisTuesday"));
    setText(".algorithm-test-panel .eyebrow", t("algorithmTestEyebrow"));
    setText("#algorithm-test-title", t("algorithmTestTitle"));
    setText("label[for='algorithmTestInput'] span", t("algorithmTestInput"));
    setText(".algorithm-test-safety", t("algorithmTestSafety"));
    renderAlgorithmTestPanel();
    setText(".research-panel > .section-heading .eyebrow", t("researchEyebrow"));
    setText("#research-title", t("researchTesting"));
    setToolDetailLabels(".algorithm-test-panel");
    setToolDetailLabels(".backtest-panel");
    setText(".backtest-panel .eyebrow", t("backtestEyebrow"));
    setText("#backtest-title", t("backtestTitle"));
    setText("#runBacktestBtn", t("runBacktest"));
    if (state.backtestResult) renderBacktestResult(state.backtestResult);
    else renderBacktestIntro();
    setText("label[for='stockSearchInput'] span", t("searchStock"));
    setText("label[for='stockAllocationInput'] span", t("allocationPercent"));
    setText("#stockSearchBtn", state.loading ? t("searching") : t("search"));
    setPlaceholder("#stockSearchInput", t("searchPlaceholder"));
    setStockListHeaderLabels();
    setText(".data-panel .eyebrow", t("dataSourcePriority"));
    setText("#data-title", t("liveMarketData"));
    const dataSummary = document.querySelector(".data-panel summary");
    if (dataSummary) {
      dataSummary.setAttribute("data-label", t("details"));
      dataSummary.setAttribute("data-open-label", t("hide"));
    }
    setSourceList();
    setText(".data-panel .fine-print", t("dataFinePrint"));
    setText(".portfolio-risk-panel .eyebrow", t("portfolioRiskDashboard"));
    setText("#portfolio-risk-title", t("portfolioRisk"));
    setText("#savePortfolioRiskBtn", t("savePortfolio"));
    setText("label[for='availableCashInput'] span", t("availableCash"));
    setPlaceholder("#availableCashInput", t("availableCashPlaceholder"));
    setDetailLabels(".holdings-details", t("editHoldings"), t("hideDetails"));
    setDetailLabels(".order-copy-details", t("copyTextDetails"), t("hideDetails"));
    setText(".order-panel .eyebrow", t("copyOrderList"));
    setText("#order-title", t("manualTradePlan"));
    setText("#copyBtn", t("copy"));
    setText(".modal-heading .eyebrow", t("liveMarketDataEyebrow"));
    setText("#price-settings-title", t("priceSettings"));
    setText(".api-key-row span", t("finnhubApiKey"));
    setText("#refreshBtn", state.loading ? t("refreshing") : t("refreshPrices"));
    setText(".modal-note strong", t("sourcePriority"));
    setText(".modal-note span", t("sourcePriorityLine"));
    setPlaceholder("#apiKey", t("apiKeyPlaceholder"));
    setAria("#closeSettingsBtn", t("closePriceSettings"));
    if (languageToggle) languageToggle.textContent = "中文 / EN";
    translateTemplateLabels();
    renderOverviewSummary(window.__SUINVESTMENT_PORTFOLIO_RISK__);
  }

  function setText(selector, value) {
    const element = document.querySelector(selector);
    if (element) element.textContent = value;
  }

  function setPlaceholder(selector, value) {
    const element = document.querySelector(selector);
    if (element) element.placeholder = value;
  }

  function setAria(selector, value) {
    const element = document.querySelector(selector);
    if (element) element.setAttribute("aria-label", value);
  }

  function setMetricLabel(index, value) {
    const element = document.querySelectorAll(".metrics-grid .metric span")[index];
    if (element) element.textContent = value;
  }

  function setOverviewLabel(index, value) {
    const element = document.querySelectorAll(".overview-grid .overview-card span")[index];
    if (element) element.textContent = value;
  }

  function setDetailLabels(selector, closedLabel, openLabel) {
    const details = document.querySelector(selector);
    const summary = details ? details.querySelector(":scope > summary") : null;
    if (!summary) return;
    summary.setAttribute("data-label", closedLabel);
    summary.setAttribute("data-open-label", openLabel);
    summary.textContent = details.open ? openLabel : closedLabel;
  }

  function setToolDetailLabels(selector) {
    const details = document.querySelector(selector);
    const summary = details ? details.querySelector(":scope > summary") : null;
    if (!summary) return;
    summary.setAttribute("data-label", t("showDetails"));
    summary.setAttribute("data-open-label", t("hideDetails"));
  }

  function setMetricValue(index, value) {
    const element = document.querySelectorAll(".metrics-grid .metric strong")[index];
    if (element) element.textContent = value;
  }

  function setDeploymentInputLabel(field, value) {
    const input = deploymentInputs[field];
    if (!input) return;
    const label = input.closest("label");
    const span = label ? label.querySelector("span") : null;
    if (span) span.textContent = value;
  }

  function setSourceList() {
    const labels = [t("finnhub"), t("yahooFallback"), t("cache"), t("manualOverride")];
    document.querySelectorAll(".source-list li").forEach(function (item, index) {
      item.textContent = labels[index] || item.textContent;
    });
  }

  function setStockListHeaderLabels() {
    const labels = [
      t("symbol"),
      t("allocationPercent").replace(" %", ""),
      t("action"),
      t("price"),
      "1D",
      "5D",
      t("scoreLabel"),
      t("signalStrength"),
      t("riskLabel"),
      t("multiplier"),
      t("suggestedBuy"),
      t("source"),
      t("controls")
    ];
    document.querySelectorAll(".stock-list-header span").forEach(function (item, index) {
      item.textContent = labels[index] || item.textContent;
    });
  }

  function translateTemplateLabels() {
    document.querySelectorAll(".stock-card").forEach(function (card) {
      const labels = card.querySelectorAll(".stock-values span");
      if (labels[0]) labels[0].textContent = "1D";
      if (labels[1]) labels[1].textContent = "5D";
      if (labels[2]) labels[2].textContent = t("signalScore");
      if (labels[3]) labels[3].textContent = t("signalStrength");
      if (labels[4]) labels[4].textContent = t("riskLevel");
      if (labels[5]) labels[5].textContent = t("multiplier");
      if (labels[6]) labels[6].textContent = t("suggestedBuy");
      const rowSummary = card.querySelector(".stock-details-row > summary");
      if (rowSummary) rowSummary.textContent = t("details");
      const reason = card.querySelector(".decision-reason");
      const warning = card.querySelector(".decision-warning");
      if (reason && reason.previousElementSibling) reason.previousElementSibling.textContent = t("reason");
      if (warning && warning.previousElementSibling) warning.previousElementSibling.textContent = t("warning");
      const decisionSummary = card.querySelector(".decision-context > summary");
      if (decisionSummary) decisionSummary.textContent = t("reason") + " / " + t("warning");
      if (card.querySelector(".algorithm-details")) updateAlgorithmDetails(card, window.__SUINVESTMENT_SIGNALS__ && window.__SUINVESTMENT_SIGNALS__.find(function (signal) {
        return signal.symbol === card.dataset.symbol;
      }) || { algorithm: null, multiplier: 1 });
      const input = card.querySelector(".override-input");
      if (input) input.placeholder = t("overridePlaceholder");
      const overrideSummary = card.querySelector(".override-row > summary");
      if (overrideSummary) overrideSummary.textContent = t("manualOverride");
      const apply = card.querySelector(".apply-override");
      if (apply) apply.textContent = t("applyOverride");
      const clear = card.querySelector(".clear-override");
      if (clear) clear.textContent = t("clearOverride");
      const remove = card.querySelector(".remove-stock");
      if (remove) remove.textContent = t("remove");
    });
  }

  function displayRiskLevel(level) {
    if (level === "Low") return t("riskLow");
    if (level === "Medium") return t("riskMedium");
    if (level === "High") return t("riskHigh");
    if (level === "Extreme") return t("riskExtreme");
    return level;
  }

  function displayAction(action) {
    if (action === "STRONG_BUY") return t("actionStrongBuy");
    if (action === "BUY") return t("actionBuy");
    if (action === "NORMAL_BUY") return t("actionNormalBuy");
    if (action === "REDUCE_BUY") return t("actionReduceBuy");
    if (action === "HOLD") return t("actionHold");
    if (action === "CONSIDER_SELL") return t("actionConsiderSell");
    if (action === "DO_NOT_BUY") return t("actionDoNotBuy");
    return action;
  }

  function joinWarnings(items) {
    return items.join(state.language === "zh" ? "；" : "; ");
  }

  function splitWarnings(value) {
    return String(value || "").split(/; |；/).filter(Boolean);
  }

  function sentenceEnd() {
    return state.language === "zh" ? "。" : ".";
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, function (char) {
      return {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        "\"": "&quot;",
        "'": "&#39;"
      }[char];
    });
  }

  async function fetchJson(url) {
    const controller = new AbortController();
    const timeoutId = setTimeout(function () {
      controller.abort();
    }, CONFIG.requestTimeoutMs);

    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) {
        const body = await response.text();
        throw new Error("Request failed with status " + response.status + " " + body.slice(0, 120));
      }
      return response.json();
    } catch (error) {
      if (error && error.name === "AbortError") {
        throw new Error("request timed out");
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  function describeError(error) {
    const message = error && error.message ? error.message : String(error);
    if (/Failed to fetch/i.test(message)) return "browser blocked request";
    if (/401|403/.test(message)) return "check API key permissions";
    return message;
  }

  function round2(value) {
    return Math.round((value + Number.EPSILON) * 100) / 100;
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function isFiniteNumber(value) {
    return typeof value === "number" && Number.isFinite(value);
  }

  function formatSigned(value) {
    return (value > 0 ? "+" : "") + value.toFixed(2);
  }

  function formatSignedInput(value) {
    return value > 0 ? "+" + value : String(value);
  }

  function formatMultiplier(value) {
    return value.toFixed(2).replace(/\.00$/, "") + "x";
  }

  function formatPercent(value) {
    const rounded = round2(value);
    return (Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(2)) + "%";
  }

  function formatPrice(value) {
    return Number(value).toFixed(2);
  }

  function formatCurrency(value) {
    return "CAD " + Number(value).toFixed(2);
  }

  function formatDateTime(timestamp) {
    return new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit"
    }).format(new Date(timestamp));
  }

  function sourceClass(source) {
    return String(source || "").toLowerCase().replace(/[^a-z]/g, "") || "error";
  }
})();

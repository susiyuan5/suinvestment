const fs = require("node:fs/promises");
const path = require("node:path");

const symbols = ["BYDDY", "MSFT", "NVDA", "AAPL", "ASML", "KO", "QQQ"];
const outFile = path.join(process.cwd(), "data", "market-data.json");
const requestTimeoutMs = 12000;
const retryDelayMs = 900;
const maxAttempts = 3;

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

async function main() {
  const previous = await loadPreviousSnapshot();
  const result = {
    generatedAt: new Date().toISOString(),
    source: "Yahoo Finance chart via GitHub Actions",
    comparison: "decision signal uses the lower of latest close vs previous close and latest close vs 5 trading sessions earlier",
    symbols: {},
    errors: {}
  };

  await fs.mkdir(path.dirname(outFile), { recursive: true });

  for (const symbol of symbols) {
    try {
      result.symbols[symbol] = await fetchYahooWeekly(symbol);
      await sleep(250);
    } catch (error) {
      const message = error.message || String(error);
      result.errors[symbol] = message;

      const previousSymbol = previous.symbols && previous.symbols[symbol];
      if (previousSymbol) {
        result.symbols[symbol] = {
          ...previousSymbol,
          stale: true,
          staleReason: message,
          staleFrom: previous.generatedAt || null
        };
      }
    }
  }

  const freshCount = Object.values(result.symbols).filter((item) => !item.stale).length;
  if (freshCount === 0) {
    throw new Error("No fresh market data could be fetched.");
  }

  await fs.writeFile(outFile, JSON.stringify(result, null, 2) + "\n", "utf8");
  console.log(`Wrote ${outFile} with ${freshCount}/${symbols.length} fresh symbols`);

  if (Object.keys(result.errors).length) {
    console.warn("Some symbols used previous snapshot data:", result.errors);
  }
}

async function loadPreviousSnapshot() {
  try {
    const raw = await fs.readFile(outFile, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    return { symbols: {} };
  }
}

async function fetchYahooWeekly(symbol) {
  const encoded = encodeURIComponent(symbol);
  const urls = [
    `https://query1.finance.yahoo.com/v8/finance/chart/${encoded}?range=1mo&interval=1d`,
    `https://query2.finance.yahoo.com/v8/finance/chart/${encoded}?range=1mo&interval=1d`
  ];

  let payload;
  let lastError;

  for (let attempt = 1; attempt <= maxAttempts && !payload; attempt += 1) {
    for (const url of urls) {
      try {
        payload = await fetchJson(url);
        break;
      } catch (error) {
        lastError = error;
      }
    }

    if (!payload && attempt < maxAttempts) {
      await sleep(retryDelayMs * attempt);
    }
  }

  if (!payload) throw lastError || new Error("Yahoo request failed");

  const chart = payload.chart;
  const yahooResult = chart && chart.result && chart.result[0];
  if (!yahooResult) {
    const description = chart && chart.error && chart.error.description;
    throw new Error(description || "Yahoo payload missing result");
  }

  const timestamps = yahooResult.timestamp || [];
  const quote = yahooResult.indicators && yahooResult.indicators.quote && yahooResult.indicators.quote[0];
  const closes = quote && quote.close ? quote.close : [];
  const points = [];

  closes.forEach((close, index) => {
    if (typeof close === "number" && Number.isFinite(close) && timestamps[index]) {
      points.push({
        date: new Date(timestamps[index] * 1000).toISOString().slice(0, 10),
        close
      });
    }
  });

  if (points.length < 6) {
    throw new Error("Not enough daily closes");
  }

  const latest = points[points.length - 1];
  const previous = points[points.length - 2];
  const weekAgo = points[points.length - 6];
  const dailyChange = round2(((latest.close - previous.close) / previous.close) * 100);
  const weeklyChange = round2(((latest.close - weekAgo.close) / weekAgo.close) * 100);
  const decisionChange = Math.min(weeklyChange, dailyChange);
  const metaPrice = yahooResult.meta && yahooResult.meta.regularMarketPrice;

  return {
    symbol,
    price: Number.isFinite(metaPrice) ? round2(metaPrice) : round2(latest.close),
    latestClose: round2(latest.close),
    latestDate: latest.date,
    previousClose: round2(previous.close),
    previousDate: previous.date,
    weekAgoClose: round2(weekAgo.close),
    weekAgoDate: weekAgo.date,
    dailyChange,
    weeklyChange,
    decisionChange
  };
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), requestTimeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        accept: "application/json",
        "user-agent": "Mozilla/5.0 SuInvestmentPro/1.0"
      }
    });

    if (!response.ok) {
      throw new Error(`Yahoo status ${response.status}`);
    }

    return response.json();
  } catch (error) {
    if (error && error.name === "AbortError") {
      throw new Error("Yahoo request timed out");
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

function round2(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

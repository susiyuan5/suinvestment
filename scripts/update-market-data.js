const fs = require("node:fs/promises");
const path = require("node:path");

const symbols = ["BYDDY", "MSFT", "NVDA", "AAPL", "ASML", "KO", "QQQ"];
const outFile = path.join(process.cwd(), "data", "market-data.json");

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

async function main() {
  const result = {
    generatedAt: new Date().toISOString(),
    source: "Yahoo Finance chart via GitHub Actions",
    comparison: "latest close vs 5 trading sessions earlier",
    symbols: {},
    errors: {}
  };

  await fs.mkdir(path.dirname(outFile), { recursive: true });

  for (const symbol of symbols) {
    try {
      result.symbols[symbol] = await fetchYahooWeekly(symbol);
    } catch (error) {
      result.errors[symbol] = error.message || String(error);
    }
  }

  if (Object.keys(result.symbols).length === 0) {
    throw new Error("No market data could be fetched.");
  }

  await fs.writeFile(outFile, JSON.stringify(result, null, 2) + "\n", "utf8");
  console.log(`Wrote ${outFile}`);
}

async function fetchYahooWeekly(symbol) {
  const encoded = encodeURIComponent(symbol);
  const urls = [
    `https://query1.finance.yahoo.com/v8/finance/chart/${encoded}?range=1mo&interval=1d`,
    `https://query2.finance.yahoo.com/v8/finance/chart/${encoded}?range=1mo&interval=1d`
  ];

  let payload;
  let lastError;

  for (const url of urls) {
    try {
      const response = await fetch(url, {
        headers: {
          "accept": "application/json",
          "user-agent": "Mozilla/5.0 SuInvestmentPro/1.0"
        }
      });

      if (!response.ok) {
        throw new Error(`Yahoo status ${response.status}`);
      }

      payload = await response.json();
      break;
    } catch (error) {
      lastError = error;
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
  const weekAgo = points[points.length - 6];
  const weeklyChange = round2(((latest.close - weekAgo.close) / weekAgo.close) * 100);
  const metaPrice = yahooResult.meta && yahooResult.meta.regularMarketPrice;

  return {
    symbol,
    price: Number.isFinite(metaPrice) ? round2(metaPrice) : round2(latest.close),
    latestClose: round2(latest.close),
    latestDate: latest.date,
    weekAgoClose: round2(weekAgo.close),
    weekAgoDate: weekAgo.date,
    weeklyChange
  };
}

function round2(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

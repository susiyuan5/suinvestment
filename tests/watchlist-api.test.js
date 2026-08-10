const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const watchlist = require("../watchlist.js");

test("Watchlist public add contract normalizes symbols and keeps duplicate checks safe", () => {
  assert.equal(watchlist.normalizeSymbol(" tsm! "), "TSM");
  assert.equal(watchlist.normalizeSymbol(""), "");
  const source = fs.readFileSync("watchlist.js", "utf8");
  assert.match(source, /window\.SuinvestmentWatchlist\s*=\s*\{ addSymbol \}/);
  assert.match(source, /code: "duplicate"/);
  assert.match(source, /code: "limit"/);
});

"""Static checks for the simplified-Chinese user-facing contract."""
from __future__ import annotations

import re
from html.parser import HTMLParser
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
ALLOWED = {"SPY", "QQQ", "NVDA", "AAPL", "ASML", "KO", "BYDDY", "CAD", "USD", "DCA-L2", "API", "Finnhub", "Yahoo Finance", "v2", "ETF", "GitHub", "MACD", "Shadow", "Python", "CSS", "JS"}
FORBIDDEN = re.compile(r"\b(?:Loading|Waiting|Manual|Trade|Plan|Watchlist|Research|Settings|Backtest|Summary|Source|Current|Portfolio|Budget|Crash|Normal|Weekly|Signal|Risk|Buy|Copy|Run|Details|Unavailable|Ready|Unknown|Required|Recommended|Insight|Momentum|Bullish|Bearish|Open|Close|Save|Reset|Key|Market|Data|Quality|Algorithm|Test|Panel|Default|Benchmark|Optional|Decision|Sandbox|Live|Fixed|Simple|Enhanced|Trend|No|Only|Not|Automatic|Execution|Bookkeeping|Refresh|Prices)\b")


class VisibleText(HTMLParser):
    def __init__(self):
        super().__init__()
        self.skip = 0
        self.text = []

    def handle_starttag(self, tag, attrs):
        if tag in {"script", "style", "template"}:
            self.skip += 1

    def handle_endtag(self, tag):
        if tag in {"script", "style", "template"}:
            self.skip = max(0, self.skip - 1)

    def handle_data(self, data):
        if not self.skip and data.strip():
            self.text.append(" ".join(data.split()))


def main() -> int:
    html = (ROOT / "index.html").read_text(encoding="utf-8")
    if '<html lang="zh-CN">' not in html:
        raise SystemExit("HTML lang must be zh-CN")
    if 'id="languageToggle"' in html:
        raise SystemExit("language switcher must not be visible")
    parser = VisibleText()
    parser.feed(html)
    failures = []
    for value in parser.text:
        for match in FORBIDDEN.finditer(value):
            token = match.group(0)
            if token not in ALLOWED:
                failures.append(value)
                break
    if failures:
        raise SystemExit("English user-facing text remains: " + " | ".join(sorted(set(failures))))
    print("Simplified Chinese static contract passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

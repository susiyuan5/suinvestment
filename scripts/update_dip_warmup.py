"""Fetch isolated dip warmup; align adjusted units at the existing first session."""
import json
import sys
from pathlib import Path
from datetime import datetime, timezone

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from data_loader import load_yahoo_daily_prices
from scripts.update_backtest_daily_prices import adjusted_row


def main():
    source = json.loads(Path('data/v2/backtest-adjusted-daily.json').read_text())
    result = {'version': 'dip-warmup-v1', 'generatedAt': datetime.now(timezone.utc).isoformat(),
              'source': 'Yahoo Finance adjusted daily OHLC, scaled to source start-date adjusted close', 'symbols': {}, 'errors': {}}
    for symbol in ['SPY', 'QQQ', 'NVDA', 'AAPL', 'ASML', 'KO']:
        try:
            anchor = source['symbols'][symbol][0]
            fetched = [adjusted_row(p) for p in load_yahoo_daily_prices(symbol, '2020-05-01', anchor['date'])]
            overlap = next(r for r in fetched if r['date'] == anchor['date'])
            factor = anchor['adjusted_close'] / overlap['adjusted_close']
            rows = []
            for row in fetched:
                if row['date'] >= anchor['date']:
                    continue
                for key in ['adjusted_open', 'adjusted_high', 'adjusted_low', 'adjusted_close']:
                    row[key] = round(row[key] * factor, 8)
                rows.append(row)
            if len(rows) < 260:
                raise ValueError('Insufficient warmup')
            result['symbols'][symbol] = rows
            print(symbol, len(rows), flush=True)
        except Exception as error:
            result['errors'][symbol] = str(error)
            print(symbol, str(error), flush=True)
    Path('data/dip-warmup-daily.json').write_text(json.dumps(result, separators=(',', ':')), encoding='utf-8')


if __name__ == '__main__':
    main()

# Frozen weekly DCA v2 regression evidence

These fixtures preserve the price input (generated 2026-09-12, through
2026-09-11) and matching `results/weekly_dca_v2/summary.json` from repository
revision `0266d29`. `adjusted-daily.json.gz` is a lossless gzip copy of
`data/v2/backtest-adjusted-daily.json`; its gzip timestamp is zero for
reproducibility.

The live-data overlay removes generated reports absent from the data branch,
and the historical updater replaces daily prices. Regression tests must use
this fixed input/output pair rather than depend on either live artifact.
Keep the fixtures under `tests/`, outside the publication allowlist. Do not
regenerate them during routine price refreshes.

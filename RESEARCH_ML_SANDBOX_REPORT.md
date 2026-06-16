# Phase 6E Research Universe ML Sandbox Report

Generated at: `2026-06-16T11:42:02.195949+00:00`

This ML sandbox is research-only. ML predictions do not affect live recommendations, buy amounts, signal scores, multipliers, risk levels, action thresholds, the default Python strategy, or the market regime formula.

## Scope

- Uses the Phase 6C research-universe factor table for 38 research symbols.
- Writes research-only ML outputs under results/phase6/ml.
- Reference symbols QQQ/SPY/DIA/IWM are excluded when running research-universe mode.

## Data Split

- Train: `2015-01-02` to `2024-03-01` (`18202` rows)
- Test: `2024-03-08` to `2026-06-15` (`4526` rows)
- Split method: time-based, last 20% of dates held out, no shuffling.
- Pipelines fit imputers, scalers, encoders, and models on training data only.

## Outputs

- `results/phase6/ml/research_ml_regression_results.csv`
- `results/phase6/ml/research_ml_classification_results.csv`
- `results/phase6/ml/research_ml_feature_importance.csv`
- `results/phase6/ml/research_ml_predictions.csv`

## Best Out-of-Sample Models

- Regression by RMSE: `baseline_mean` on `forward_1w_return` with RMSE `0.04897514` and Spearman `0.0`.
- Classification by balanced accuracy: `logistic_regression` on `forward_12w_positive` with balanced accuracy `0.53779906` and ROC AUC `0.53544648`.

## Baseline Context

- Regression baseline `forward_1w_return` RMSE `0.04897514`, directional accuracy `0.54367201`.
- Regression baseline `forward_4w_return` RMSE `0.10470985`, directional accuracy `0.55121171`.
- Regression baseline `forward_12w_return` RMSE `0.18895005`, directional accuracy `0.6027027`.
- Classification baseline `forward_4w_positive` balanced accuracy `0.5`, accuracy `0.55121171`.
- Classification baseline `forward_12w_positive` balanced accuracy `0.5`, accuracy `0.6027027`.

## Model vs Baseline

- `ridge` on `forward_12w_return` beat baseline by `rmse` (0.18501825 vs 0.18895005).
- `ridge` on `forward_1w_return` did not beat baseline by `rmse` (0.04897718 vs 0.04897514).
- `random_forest_regressor` on `forward_4w_return` beat baseline by `rmse` (0.10434203 vs 0.10470985).
- `logistic_regression` on `forward_12w_positive` beat baseline by `balanced_accuracy` (0.53779906 vs 0.50000000).
- `logistic_regression` on `forward_4w_positive` beat baseline by `balanced_accuracy` (0.51006583 vs 0.50000000).

## Phase 5 Reference Comparison

- Phase 5E best regression reference: baseline_mean on forward_1w_return, RMSE 0.04030839.
- Phase 5E best classification reference: logistic_regression on forward_12w_positive, balanced accuracy 0.57350427 and ROC AUC 0.57948718.
- Research best regression: `baseline_mean` on `forward_1w_return`, RMSE `0.04897514`.
- Research best classification: `logistic_regression` on `forward_12w_positive`, balanced accuracy `0.53779906`, ROC AUC `0.53544648`.

## Feature Diagnostics

- `logistic_regression` `forward_12w_positive` `categorical__ticker_BABA`: `-0.7094330536`
- `logistic_regression` `forward_12w_positive` `categorical__ticker_MSFT`: `0.6856188838`
- `logistic_regression` `forward_12w_positive` `categorical__ticker_GE`: `-0.5966964233`
- `logistic_regression` `forward_12w_positive` `categorical__ticker_INTC`: `-0.5880851579`
- `logistic_regression` `forward_12w_positive` `categorical__ticker_V`: `0.5639894035`
- `logistic_regression` `forward_12w_positive` `categorical__ticker_MA`: `0.5528709396`
- `logistic_regression` `forward_12w_positive` `categorical__ticker_BYDDY`: `-0.5299058235`
- `logistic_regression` `forward_12w_positive` `categorical__ticker_TCEHY`: `-0.4717249536`

## Interpretation Notes

- The 38-symbol research universe is broader than Phase 5, but still limited.
- Poor or unstable ML results are acceptable and should not be hidden.
- Any promising result requires walk-forward, out-of-sample, larger-universe, regime testing, ex-sector checks, and transaction-cost validation before live use.
- This phase does not implement PyPortfolioOpt and does not promote ML to the dashboard.

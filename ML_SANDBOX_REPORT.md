# Phase 5E ML Sandbox Report

Generated at: `2026-06-16T00:28:24.293692+00:00`

This ML sandbox is research-only. ML predictions do not affect live recommendations, buy amounts, signal scores, multipliers, risk levels, action thresholds, the default Python strategy, or the market regime formula.

## Data Split

- Train: `2021-06-07` to `2025-06-02` (`1254` rows)
- Test: `2025-06-09` to `2026-06-05` (`318` rows)
- Split method: time-based, last 20% of dates held out, no shuffling.
- Pipelines fit imputers, scalers, encoders, and models on training data only.

## Outputs

- `results/phase5/ml/ml_regression_results.csv`
- `results/phase5/ml/ml_classification_results.csv`
- `results/phase5/ml/ml_feature_importance.csv`
- `results/phase5/ml/ml_predictions.csv`

## Best Out-of-Sample Models

- Regression by RMSE: `baseline_mean` on `forward_1w_return` with RMSE `0.04030839` and Spearman `0.0`.
- Classification by balanced accuracy: `logistic_regression` on `forward_12w_positive` with balanced accuracy `0.57350427` and ROC AUC `0.57948718`.

## Baseline Context

- Regression baseline `forward_1w_return` RMSE `0.04030839`, directional accuracy `0.52564103`.
- Regression baseline `forward_4w_return` RMSE `0.07811511`, directional accuracy `0.59183673`.
- Regression baseline `forward_12w_return` RMSE `0.13820921`, directional accuracy `0.63414634`.
- Classification baseline `forward_4w_positive` balanced accuracy `0.5`, accuracy `0.59183673`.
- Classification baseline `forward_12w_positive` balanced accuracy `0.5`, accuracy `0.63414634`.

## Feature Diagnostics

- `logistic_regression` `forward_12w_positive` `numeric__rsi_14`: `-0.6987220975`
- `logistic_regression` `forward_12w_positive` `categorical__ticker_NVDA`: `0.6281824618`
- `logistic_regression` `forward_4w_positive` `numeric__sma_20_distance`: `0.5493096902`
- `logistic_regression` `forward_4w_positive` `categorical__ticker_NVDA`: `0.3462599336`
- `logistic_regression` `forward_12w_positive` `categorical__ticker_ASML`: `-0.3170350297`
- `random_forest_regressor` `forward_12w_return` `numeric__macd`: `0.3047689246`
- `random_forest_regressor` `forward_1w_return` `numeric__weekly_return`: `0.284236411`
- `logistic_regression` `forward_12w_positive` `categorical__ticker_KO`: `-0.2795465847`

## Interpretation Notes

- Small universe and limited history make results preliminary.
- Poor or unstable ML results are acceptable and should not be hidden.
- Any promising result requires walk-forward, out-of-sample, larger-universe, and regime testing before live use.
- This phase does not implement PyPortfolioOpt and does not promote ML to the dashboard.

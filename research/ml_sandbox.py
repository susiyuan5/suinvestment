from __future__ import annotations

import csv
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
FACTOR_PATH = ROOT / "results" / "phase5" / "factor_report.csv"
OUT_DIR = ROOT / "results" / "phase5" / "ml"
REGRESSION_PATH = OUT_DIR / "ml_regression_results.csv"
CLASSIFICATION_PATH = OUT_DIR / "ml_classification_results.csv"
IMPORTANCE_PATH = OUT_DIR / "ml_feature_importance.csv"
PREDICTIONS_PATH = OUT_DIR / "ml_predictions.csv"
REPORT_PATH = ROOT / "ML_SANDBOX_REPORT.md"
PORTFOLIO_SYMBOLS = ("BYDDY", "MSFT", "NVDA", "AAPL", "ASML", "KO")
FEATURES = (
    "weekly_return",
    "momentum_4w",
    "momentum_12w",
    "volatility_12w",
    "drawdown_from_52w_high",
    "sma_10_distance",
    "sma_20_distance",
    "rsi_14",
    "macd",
    "ticker",
)
REGRESSION_TARGETS = ("forward_1w_return", "forward_4w_return", "forward_12w_return")
CLASSIFICATION_TARGETS = ("forward_4w_positive", "forward_12w_positive")


def main() -> int:
    try:
        deps = load_dependencies()
    except ImportError as error:
        print(
            "Missing optional research dependency. Install the research stack with:\n"
            "  python -m pip install -r requirements-research.txt\n\n"
            f"Import error: {error}",
            file=sys.stderr,
        )
        return 2

    frame = load_ml_table(deps["pd"], FACTOR_PATH)
    train, test, split_info = time_split(frame)
    regression_rows, classification_rows, importance_rows, prediction_rows = run_models(deps, train, test)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    write_csv(REGRESSION_PATH, regression_rows)
    write_csv(CLASSIFICATION_PATH, classification_rows)
    write_csv(IMPORTANCE_PATH, importance_rows)
    write_csv(PREDICTIONS_PATH, prediction_rows)
    write_report(regression_rows, classification_rows, importance_rows, split_info)

    print(f"Wrote {REGRESSION_PATH}")
    print(f"Wrote {CLASSIFICATION_PATH}")
    print(f"Wrote {IMPORTANCE_PATH}")
    print(f"Wrote {PREDICTIONS_PATH}")
    print(f"Wrote {REPORT_PATH}")
    return 0


def load_dependencies() -> dict[str, Any]:
    try:
        import pandas as pd
    except ImportError as error:
        raise ImportError("pandas is required for research/ml_sandbox.py") from error
    try:
        from scipy import stats as scipy_stats
    except ImportError as error:
        raise ImportError("scipy is required for research/ml_sandbox.py") from error
    try:
        from sklearn.compose import ColumnTransformer
        from sklearn.ensemble import RandomForestClassifier, RandomForestRegressor
        from sklearn.impute import SimpleImputer
        from sklearn.linear_model import LogisticRegression, Ridge
        from sklearn.metrics import (
            accuracy_score,
            balanced_accuracy_score,
            mean_absolute_error,
            mean_squared_error,
            precision_score,
            r2_score,
            recall_score,
            roc_auc_score,
        )
        from sklearn.pipeline import Pipeline
        from sklearn.preprocessing import OneHotEncoder, StandardScaler
    except ImportError as error:
        raise ImportError("scikit-learn is required for research/ml_sandbox.py") from error
    return {
        "pd": pd,
        "scipy_stats": scipy_stats,
        "ColumnTransformer": ColumnTransformer,
        "RandomForestClassifier": RandomForestClassifier,
        "RandomForestRegressor": RandomForestRegressor,
        "SimpleImputer": SimpleImputer,
        "LogisticRegression": LogisticRegression,
        "Ridge": Ridge,
        "mean_absolute_error": mean_absolute_error,
        "mean_squared_error": mean_squared_error,
        "r2_score": r2_score,
        "accuracy_score": accuracy_score,
        "balanced_accuracy_score": balanced_accuracy_score,
        "precision_score": precision_score,
        "recall_score": recall_score,
        "roc_auc_score": roc_auc_score,
        "Pipeline": Pipeline,
        "OneHotEncoder": OneHotEncoder,
        "StandardScaler": StandardScaler,
    }


def load_ml_table(pd: Any, path: Path) -> Any:
    frame = pd.read_csv(path)
    frame = frame[frame["ticker"].isin(PORTFOLIO_SYMBOLS)].copy()
    frame["date"] = pd.to_datetime(frame["date"])
    frame = frame.sort_values(["ticker", "date"]).reset_index(drop=True)
    frame["sma_10_distance"] = frame["close"] / frame["sma_10"] - 1
    frame["sma_20_distance"] = frame["close"] / frame["sma_20"] - 1
    for horizon in (1, 4, 12):
        frame[f"forward_{horizon}w_return"] = frame.groupby("ticker")["close"].shift(-horizon) / frame["close"] - 1
    frame["forward_4w_positive"] = (frame["forward_4w_return"] > 0).astype("float")
    frame.loc[frame["forward_4w_return"].isna(), "forward_4w_positive"] = None
    frame["forward_12w_positive"] = (frame["forward_12w_return"] > 0).astype("float")
    frame.loc[frame["forward_12w_return"].isna(), "forward_12w_positive"] = None
    return frame


def time_split(frame: Any) -> tuple[Any, Any, dict[str, Any]]:
    dates = sorted(frame["date"].dropna().unique())
    split_index = max(int(len(dates) * 0.80), 1)
    split_date = dates[split_index]
    train = frame[frame["date"] < split_date].copy()
    test = frame[frame["date"] >= split_date].copy()
    return train, test, {
        "train_start": train["date"].min().date().isoformat(),
        "train_end": train["date"].max().date().isoformat(),
        "test_start": test["date"].min().date().isoformat(),
        "test_end": test["date"].max().date().isoformat(),
        "train_rows": len(train),
        "test_rows": len(test),
    }


def run_models(deps: dict[str, Any], train: Any, test: Any) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
    regression_rows: list[dict[str, Any]] = []
    classification_rows: list[dict[str, Any]] = []
    importance_rows: list[dict[str, Any]] = []
    prediction_rows: list[dict[str, Any]] = []

    for target in REGRESSION_TARGETS:
        train_clean, test_clean = clean_for_target(train, test, target)
        if train_clean.empty or test_clean.empty:
            continue
        y_train = train_clean[target]
        y_test = test_clean[target]
        mean_pred = [float(y_train.mean())] * len(test_clean)
        regression_rows.append(regression_metrics(deps, target, "baseline_mean", y_test, mean_pred, train_clean, test_clean, None))
        add_prediction_rows(prediction_rows, test_clean, target, "baseline_mean", y_test, mean_pred, None)

        for model_name, model in regression_models(deps).items():
            pipeline = make_pipeline(deps, model)
            pipeline.fit(train_clean[list(FEATURES)], y_train)
            predictions = pipeline.predict(test_clean[list(FEATURES)])
            regression_rows.append(regression_metrics(deps, target, model_name, y_test, predictions, train_clean, test_clean, pipeline))
            add_prediction_rows(prediction_rows, test_clean, target, model_name, y_test, predictions, None)
            importance_rows.extend(feature_diagnostics(pipeline, model_name, target, "regression"))

    for target in CLASSIFICATION_TARGETS:
        train_clean, test_clean = clean_for_target(train, test, target)
        if train_clean.empty or test_clean.empty:
            continue
        y_train = train_clean[target].astype(int)
        y_test = test_clean[target].astype(int)
        majority = int(y_train.mode().iloc[0])
        majority_pred = [majority] * len(test_clean)
        classification_rows.append(classification_metrics(deps, target, "baseline_majority", y_test, majority_pred, None, train_clean, test_clean, None))
        add_prediction_rows(prediction_rows, test_clean, target, "baseline_majority", y_test, majority_pred, None)

        for model_name, model in classification_models(deps).items():
            pipeline = make_pipeline(deps, model)
            pipeline.fit(train_clean[list(FEATURES)], y_train)
            predictions = pipeline.predict(test_clean[list(FEATURES)])
            probabilities = positive_probabilities(pipeline, test_clean[list(FEATURES)])
            classification_rows.append(classification_metrics(deps, target, model_name, y_test, predictions, probabilities, train_clean, test_clean, pipeline))
            add_prediction_rows(prediction_rows, test_clean, target, model_name, y_test, predictions, probabilities)
            importance_rows.extend(feature_diagnostics(pipeline, model_name, target, "classification"))

    return regression_rows, classification_rows, importance_rows, prediction_rows


def clean_for_target(train: Any, test: Any, target: str) -> tuple[Any, Any]:
    required = list(dict.fromkeys(list(FEATURES) + [target, "date"]))
    return train[required].dropna(subset=[target]).copy(), test[required].dropna(subset=[target]).copy()


def regression_models(deps: dict[str, Any]) -> dict[str, Any]:
    return {
        "ridge": deps["Ridge"](alpha=1.0),
        "random_forest_regressor": deps["RandomForestRegressor"](
            n_estimators=200,
            max_depth=4,
            min_samples_leaf=8,
            random_state=42,
        ),
    }


def classification_models(deps: dict[str, Any]) -> dict[str, Any]:
    return {
        "logistic_regression": deps["LogisticRegression"](max_iter=1000, class_weight="balanced", random_state=42),
        "random_forest_classifier": deps["RandomForestClassifier"](
            n_estimators=200,
            max_depth=4,
            min_samples_leaf=8,
            class_weight="balanced",
            random_state=42,
        ),
    }


def make_pipeline(deps: dict[str, Any], model: Any) -> Any:
    numeric_features = [feature for feature in FEATURES if feature != "ticker"]
    categorical_features = ["ticker"]
    preprocessor = deps["ColumnTransformer"](
        transformers=[
            (
                "numeric",
                deps["Pipeline"](
                    [
                        ("imputer", deps["SimpleImputer"](strategy="median")),
                        ("scaler", deps["StandardScaler"]()),
                    ]
                ),
                numeric_features,
            ),
            (
                "categorical",
                deps["OneHotEncoder"](handle_unknown="ignore"),
                categorical_features,
            ),
        ]
    )
    return deps["Pipeline"]([("preprocessor", preprocessor), ("model", model)])


def regression_metrics(deps: dict[str, Any], target: str, model_name: str, y_true: Any, y_pred: Any, train_clean: Any, test_clean: Any, pipeline: Any) -> dict[str, Any]:
    rmse = deps["mean_squared_error"](y_true, y_pred) ** 0.5
    spearman = deps["scipy_stats"].spearmanr(y_true, y_pred).correlation if len(set(y_pred)) > 1 else 0.0
    directional = ((y_true > 0).astype(int).to_numpy() == ([1 if value > 0 else 0 for value in y_pred])).mean()
    return {
        "target": target,
        "model": model_name,
        "train_rows": len(train_clean),
        "test_rows": len(test_clean),
        "train_start": train_clean["date"].min().date().isoformat(),
        "train_end": train_clean["date"].max().date().isoformat(),
        "test_start": test_clean["date"].min().date().isoformat(),
        "test_end": test_clean["date"].max().date().isoformat(),
        "mae": round(float(deps["mean_absolute_error"](y_true, y_pred)), 8),
        "rmse": round(float(rmse), 8),
        "r2": round(float(deps["r2_score"](y_true, y_pred)), 8),
        "spearman_rank_corr": round(float(spearman), 8),
        "directional_accuracy": round(float(directional), 8),
        "walk_forward_spearman": walk_forward_regression(deps, train_clean, target, pipeline) if pipeline is not None else "",
    }


def classification_metrics(deps: dict[str, Any], target: str, model_name: str, y_true: Any, y_pred: Any, probabilities: Any, train_clean: Any, test_clean: Any, pipeline: Any) -> dict[str, Any]:
    roc_auc = ""
    if probabilities is not None and len(set(y_true)) == 2:
        roc_auc = round(float(deps["roc_auc_score"](y_true, probabilities)), 8)
    return {
        "target": target,
        "model": model_name,
        "train_rows": len(train_clean),
        "test_rows": len(test_clean),
        "train_start": train_clean["date"].min().date().isoformat(),
        "train_end": train_clean["date"].max().date().isoformat(),
        "test_start": test_clean["date"].min().date().isoformat(),
        "test_end": test_clean["date"].max().date().isoformat(),
        "accuracy": round(float(deps["accuracy_score"](y_true, y_pred)), 8),
        "balanced_accuracy": round(float(deps["balanced_accuracy_score"](y_true, y_pred)), 8),
        "roc_auc": roc_auc,
        "precision": round(float(deps["precision_score"](y_true, y_pred, zero_division=0)), 8),
        "recall": round(float(deps["recall_score"](y_true, y_pred, zero_division=0)), 8),
        "walk_forward_accuracy": walk_forward_classification(deps, train_clean, target, pipeline) if pipeline is not None else "",
    }


def walk_forward_regression(deps: dict[str, Any], train_clean: Any, target: str, fitted_pipeline: Any) -> Any:
    # Expanding validation inside the training window. Reuse model class/params, fit only on past dates.
    dates = sorted(train_clean["date"].unique())
    if len(dates) < 80:
        return ""
    scores = []
    model = fitted_pipeline.named_steps["model"]
    for index in range(60, len(dates), 20):
        cutoff = dates[index]
        next_dates = dates[index : min(index + 20, len(dates))]
        train_part = train_clean[train_clean["date"] < cutoff]
        valid_part = train_clean[train_clean["date"].isin(next_dates)]
        if len(valid_part) < 12:
            continue
        pipeline = make_pipeline(deps, model.__class__(**model.get_params()))
        pipeline.fit(train_part[list(FEATURES)], train_part[target])
        predictions = pipeline.predict(valid_part[list(FEATURES)])
        corr = deps["scipy_stats"].spearmanr(valid_part[target], predictions).correlation if len(set(predictions)) > 1 else 0.0
        scores.append(float(corr))
    return round(sum(scores) / len(scores), 8) if scores else ""


def walk_forward_classification(deps: dict[str, Any], train_clean: Any, target: str, fitted_pipeline: Any) -> Any:
    dates = sorted(train_clean["date"].unique())
    if len(dates) < 80:
        return ""
    scores = []
    model = fitted_pipeline.named_steps["model"]
    for index in range(60, len(dates), 20):
        cutoff = dates[index]
        next_dates = dates[index : min(index + 20, len(dates))]
        train_part = train_clean[train_clean["date"] < cutoff]
        valid_part = train_clean[train_clean["date"].isin(next_dates)]
        if len(valid_part) < 12 or train_part[target].nunique() < 2:
            continue
        pipeline = make_pipeline(deps, model.__class__(**model.get_params()))
        pipeline.fit(train_part[list(FEATURES)], train_part[target].astype(int))
        predictions = pipeline.predict(valid_part[list(FEATURES)])
        scores.append(float(deps["accuracy_score"](valid_part[target].astype(int), predictions)))
    return round(sum(scores) / len(scores), 8) if scores else ""


def positive_probabilities(pipeline: Any, features: Any) -> Any:
    if hasattr(pipeline, "predict_proba"):
        probabilities = pipeline.predict_proba(features)
        if probabilities.shape[1] > 1:
            return probabilities[:, 1]
    return None


def feature_diagnostics(pipeline: Any, model_name: str, target: str, task: str) -> list[dict[str, Any]]:
    feature_names = list(pipeline.named_steps["preprocessor"].get_feature_names_out())
    model = pipeline.named_steps["model"]
    values = None
    kind = ""
    if hasattr(model, "coef_"):
        values = model.coef_[0] if getattr(model.coef_, "ndim", 1) > 1 else model.coef_
        kind = "coefficient"
    elif hasattr(model, "feature_importances_"):
        values = model.feature_importances_
        kind = "feature_importance"
    if values is None:
        return []
    rows = []
    for feature, value in zip(feature_names, values):
        rows.append(
            {
                "task": task,
                "target": target,
                "model": model_name,
                "importance_type": kind,
                "feature": feature,
                "value": round(float(value), 10),
            }
        )
    return rows


def add_prediction_rows(rows: list[dict[str, Any]], test_clean: Any, target: str, model: str, y_true: Any, predictions: Any, probabilities: Any) -> None:
    for idx, (_, row) in enumerate(test_clean.iterrows()):
        rows.append(
            {
                "date": row["date"].date().isoformat(),
                "ticker": row["ticker"],
                "target": target,
                "model": model,
                "actual": round(float(y_true.iloc[idx]), 8),
                "prediction": round(float(predictions[idx]), 8),
                "probability_positive": round(float(probabilities[idx]), 8) if probabilities is not None else "",
            }
        )


def write_csv(path: Path, rows: list[dict[str, Any]]) -> None:
    if not rows:
        return
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)


def write_report(regression_rows: list[dict[str, Any]], classification_rows: list[dict[str, Any]], importance_rows: list[dict[str, Any]], split_info: dict[str, Any]) -> None:
    best_reg = min(regression_rows, key=lambda row: float(row["rmse"]))
    best_cls = max(classification_rows, key=lambda row: float(row["balanced_accuracy"]))
    baseline_reg = [row for row in regression_rows if row["model"] == "baseline_mean"]
    baseline_cls = [row for row in classification_rows if row["model"] == "baseline_majority"]
    top_importance = sorted(importance_rows, key=lambda row: abs(float(row["value"])), reverse=True)[:8]
    generated_at = datetime.now(timezone.utc).isoformat()
    lines = [
        "# Phase 5E ML Sandbox Report",
        "",
        f"Generated at: `{generated_at}`",
        "",
        "This ML sandbox is research-only. ML predictions do not affect live recommendations, buy amounts, signal scores, multipliers, risk levels, action thresholds, the default Python strategy, or the market regime formula.",
        "",
        "## Data Split",
        "",
        f"- Train: `{split_info['train_start']}` to `{split_info['train_end']}` (`{split_info['train_rows']}` rows)",
        f"- Test: `{split_info['test_start']}` to `{split_info['test_end']}` (`{split_info['test_rows']}` rows)",
        "- Split method: time-based, last 20% of dates held out, no shuffling.",
        "- Pipelines fit imputers, scalers, encoders, and models on training data only.",
        "",
        "## Outputs",
        "",
        "- `results/phase5/ml/ml_regression_results.csv`",
        "- `results/phase5/ml/ml_classification_results.csv`",
        "- `results/phase5/ml/ml_feature_importance.csv`",
        "- `results/phase5/ml/ml_predictions.csv`",
        "",
        "## Best Out-of-Sample Models",
        "",
        f"- Regression by RMSE: `{best_reg['model']}` on `{best_reg['target']}` with RMSE `{best_reg['rmse']}` and Spearman `{best_reg['spearman_rank_corr']}`.",
        f"- Classification by balanced accuracy: `{best_cls['model']}` on `{best_cls['target']}` with balanced accuracy `{best_cls['balanced_accuracy']}` and ROC AUC `{best_cls['roc_auc']}`.",
        "",
        "## Baseline Context",
        "",
    ]
    for row in baseline_reg:
        lines.append(f"- Regression baseline `{row['target']}` RMSE `{row['rmse']}`, directional accuracy `{row['directional_accuracy']}`.")
    for row in baseline_cls:
        lines.append(f"- Classification baseline `{row['target']}` balanced accuracy `{row['balanced_accuracy']}`, accuracy `{row['accuracy']}`.")
    lines.extend(["", "## Feature Diagnostics", ""])
    for row in top_importance:
        lines.append(f"- `{row['model']}` `{row['target']}` `{row['feature']}`: `{row['value']}`")
    lines.extend(
        [
            "",
            "## Interpretation Notes",
            "",
            "- Small universe and limited history make results preliminary.",
            "- Poor or unstable ML results are acceptable and should not be hidden.",
            "- Any promising result requires walk-forward, out-of-sample, larger-universe, and regime testing before live use.",
            "- This phase does not implement PyPortfolioOpt and does not promote ML to the dashboard.",
            "",
        ]
    )
    REPORT_PATH.write_text("\n".join(lines), encoding="utf-8")


if __name__ == "__main__":
    raise SystemExit(main())

"""Nested walk-forward ML validation with a permanent outer OOS set."""

from __future__ import annotations

import argparse
import hashlib
import json
from datetime import timedelta
from pathlib import Path
from statistics import mean
from typing import Any, Callable

from research import ml_sandbox


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUT = ROOT / "research" / "results" / "v2" / "validation" / "ml-validation.json"
PURGE_WEEKS = 12
EMBARGO_WEEKS = 1
MAX_INNER_WINDOWS = 4


def inner_walk_forward_windows(
    dates: list[Any], *, min_train_dates: int = 60, validation_dates: int = 20,
    purge_weeks: int = PURGE_WEEKS, embargo_weeks: int = EMBARGO_WEEKS,
) -> list[dict[str, Any]]:
    ordered = sorted(set(dates))
    windows = []
    for position in range(min_train_dates, len(ordered) - embargo_weeks, validation_dates):
        boundary = ordered[position]
        train_end = boundary - timedelta(weeks=purge_weeks)
        valid_start = boundary + timedelta(weeks=embargo_weeks)
        valid = [value for value in ordered if value >= valid_start][:validation_dates]
        train = [value for value in ordered if value < train_end]
        if train and valid:
            windows.append({"train_dates": train, "validation_dates": valid, "boundary": boundary})
    return windows


def candidate_specs(deps: dict[str, Any], task: str) -> list[tuple[str, Callable[[], Any]]]:
    if task == "regression":
        return [
            (f"ridge_alpha_{alpha}", lambda alpha=alpha: deps["Ridge"](alpha=alpha))
            for alpha in (0.1, 1.0, 10.0)
        ] + [
            (f"rf_reg_depth_{depth}", lambda depth=depth: deps["RandomForestRegressor"](
                n_estimators=80, max_depth=depth, min_samples_leaf=8, random_state=42, n_jobs=-1
            ))
            for depth in (3, 5)
        ]
    return [
        (f"logistic_c_{value}", lambda value=value: deps["LogisticRegression"](
            C=value, max_iter=1000, class_weight="balanced", random_state=42
        ))
        for value in (0.1, 1.0, 10.0)
    ] + [
        (f"rf_cls_depth_{depth}", lambda depth=depth: deps["RandomForestClassifier"](
            n_estimators=80, max_depth=depth, min_samples_leaf=8, class_weight="balanced", random_state=42, n_jobs=-1
        ))
        for depth in (3, 5)
    ]


def regression_score(deps: dict[str, Any], truth: Any, predictions: Any) -> float:
    if len(set(float(value) for value in predictions)) < 2:
        return 0.0
    value = deps["scipy_stats"].spearmanr(truth, predictions).correlation
    return float(value) if value == value else 0.0


def select_candidate(deps: dict[str, Any], frame: Any, target: str, task: str) -> tuple[str, Callable[[], Any], list[dict]]:
    windows = inner_walk_forward_windows(list(frame["date"].dropna().unique()))[-MAX_INNER_WINDOWS:]
    if not windows:
        raise RuntimeError(f"Not enough dates for nested walk-forward selection of {target}")
    selection_rows = []
    candidates = candidate_specs(deps, task)
    for name, factory in candidates:
        scores = []
        for window in windows:
            train = frame[frame["date"].isin(window["train_dates"])].dropna(subset=[target])
            valid = frame[frame["date"].isin(window["validation_dates"])].dropna(subset=[target])
            if train.empty or valid.empty or (task == "classification" and train[target].nunique() < 2):
                continue
            pipeline = ml_sandbox.make_pipeline(deps, factory())
            pipeline.fit(train[list(ml_sandbox.FEATURES)], train[target].astype(int) if task == "classification" else train[target])
            predictions = pipeline.predict(valid[list(ml_sandbox.FEATURES)])
            score = (
                float(deps["balanced_accuracy_score"](valid[target].astype(int), predictions))
                if task == "classification" else regression_score(deps, valid[target], predictions)
            )
            scores.append(score)
        average = mean(scores) if scores else float("-inf")
        selection_rows.append({"candidate": name, "inner_score": round(average, 8), "inner_windows": len(scores)})
    best = max(selection_rows, key=lambda row: row["inner_score"])
    factory = next(factory for name, factory in candidates if name == best["candidate"])
    return best["candidate"], factory, selection_rows


def evaluate_oos(deps: dict[str, Any], train: Any, test: Any, target: str, task: str) -> dict:
    train_clean = train.dropna(subset=[target])
    test_clean = test.dropna(subset=[target])
    selected, factory, selection = select_candidate(deps, train_clean, target, task)
    pipeline = ml_sandbox.make_pipeline(deps, factory())
    y_train = train_clean[target].astype(int) if task == "classification" else train_clean[target]
    pipeline.fit(train_clean[list(ml_sandbox.FEATURES)], y_train)
    predictions = pipeline.predict(test_clean[list(ml_sandbox.FEATURES)])
    if task == "classification":
        metric = float(deps["balanced_accuracy_score"](test_clean[target].astype(int), predictions))
        metric_name = "balanced_accuracy"
    else:
        metric = regression_score(deps, test_clean[target], predictions)
        metric_name = "spearman"
    return {
        "target": target,
        "task": task,
        "selected_candidate": selected,
        "selection_source": "inner_training_windows_only",
        "outer_oos_rows": len(test_clean),
        "outer_oos_metric": metric_name,
        "outer_oos_value": round(metric, 8),
        "inner_candidates": selection,
    }


def run() -> dict:
    deps = ml_sandbox.load_dependencies()
    config = ml_sandbox.build_config("research")
    frame = ml_sandbox.load_ml_table(deps["pd"], config)
    train, test, split = ml_sandbox.time_split(frame, purge_weeks=PURGE_WEEKS, embargo_weeks=EMBARGO_WEEKS)
    results = []
    for target in ml_sandbox.REGRESSION_TARGETS:
        results.append(evaluate_oos(deps, train, test, target, "regression"))
    for target in ml_sandbox.CLASSIFICATION_TARGETS:
        results.append(evaluate_oos(deps, train, test, target, "classification"))
    source_hash = hashlib.sha256(config.factor_path.read_bytes()).hexdigest()
    return {
        "version": "v2-nested-walk-forward",
        "research_only": True,
        "permanent_oos": True,
        "maximum_inner_windows": MAX_INNER_WINDOWS,
        "input_path": str(config.factor_path.relative_to(ROOT)).replace("\\", "/"),
        "input_hash": source_hash,
        "outer_split": split,
        "results": results,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Run isolated v2 nested ML validation.")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUT)
    args = parser.parse_args()
    payload = run()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {args.output}")


if __name__ == "__main__":
    main()

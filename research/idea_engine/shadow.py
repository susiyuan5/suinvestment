"""Shadow observation maturity and outcome calculations."""

from __future__ import annotations

from datetime import date


def relative_return(stock_return: float, benchmark_return: float) -> float:
    return round(float(stock_return) - float(benchmark_return), 10)


def false_positive(observation: dict) -> bool:
    return observation.get("status") in {"A", "B"} and float(observation.get("return_12w", 0)) <= 0


def maturity(observations: list[dict], outcomes: list[dict], *, min_observations=8, min_calendar_weeks=8, min_complete=4) -> dict:
    weeks = set()
    for row in observations:
        try:
            observed = date.fromisoformat(str(row.get("as_of", ""))[:10])
        except ValueError:
            continue
        iso = observed.isocalendar()
        weeks.add((iso.year, iso.week))
    complete = sum(all(row.get("horizons", {}).get(str(week), {}).get("status") == "matured" for week in (1, 4, 12)) for row in outcomes)
    return {"status": "mature" if len(observations) >= min_observations and len(weeks) >= min_calendar_weeks and complete >= min_complete else "not_mature", "observation_count": len(observations), "calendar_week_count": len(weeks), "complete_count": complete}

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from research.research_universe.governance import input_hash, validate_source


def main() -> None:
    parser = argparse.ArgumentParser(); parser.add_argument("--source", type=Path, default=Path("data/research-universe-sector-balanced-80.json")); parser.add_argument("--bars", type=Path, default=Path("data/short-term-daily-bars-v1.json")); parser.add_argument("--output", type=Path, default=Path("data/research-universe/v2/current.json")); args = parser.parse_args()
    source = json.loads(args.source.read_text(encoding="utf-8")); bars = json.loads(args.bars.read_text(encoding="utf-8")); check = validate_source(source); as_of = bars.get("as_of") or datetime.now(timezone.utc).date().isoformat()
    symbols = list(source.get("research_universe_symbols", [])); rows = bars.get("symbols", {}); today = datetime.now(timezone.utc).date().isoformat()
    if str(as_of)[:10] > today:
        check["valid"] = False; check.setdefault("errors", []).append("snapshot_as_of_in_future")
    records = [{"ticker": symbol, "category": next((category for category, values in source.get("category_metadata", {}).items() if symbol in values), None), "accepted": symbol in rows, "data_completeness": None if symbol not in rows else min(100.0, round(len(rows[symbol]) / 250 * 100, 2)), "reasons": [] if symbol in rows else ["daily_data_unavailable"]} for symbol in symbols]
    payload = {"as_of": as_of, "universe_version": "research-universe-v2", "source_version": source.get("version", "unknown"), "symbols": symbols, "records": records, "source_scope_limited": True, "status": "ready" if check["valid"] else "blocked", "research_only": True, "input_hash": input_hash({"source": source, "bars": bars}), "code_version": "governance-v1", "source_validation": check, "change_summary": {"added": [], "removed": [], "retained": symbols, "reason": "initial reproducible snapshot from repository source"}}
    args.output.parent.mkdir(parents=True, exist_ok=True); serialized = json.dumps(payload, ensure_ascii=False, indent=2) + "\n"; args.output.write_text(serialized, encoding="utf-8"); history = args.output.parent / "history" / (str(as_of)[:10] + ".json"); history.parent.mkdir(parents=True, exist_ok=True)
    if not history.exists(): history.write_text(serialized, encoding="utf-8")
    results = Path("results/research-universe"); results.mkdir(parents=True, exist_ok=True); (results / "latest.json").write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"); (results / "latest.md").write_text("# 研究股票池治理\n\n- 版本：`research-universe-v2`\n- 研究用途：`research_only=true`\n- 来源范围受限：`source_scope_limited=true`\n- 股票数量：" + str(len(symbols)) + "\n- 说明：普通扫描不会替换股票池，月度治理才允许变更。\n", encoding="utf-8")
    print(json.dumps({"valid": check["valid"], "count": len(symbols), "as_of": as_of, "research_only": True}, ensure_ascii=False))


if __name__ == "__main__": main()

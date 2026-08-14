from __future__ import annotations
import argparse, json, os, tempfile
from datetime import datetime, timezone
from pathlib import Path

def main() -> None:
    parser = argparse.ArgumentParser(); parser.add_argument("--task", choices=("today", "universe"), required=True); parser.add_argument("--status", required=True); parser.add_argument("--run-id", default=None); args = parser.parse_args()
    path = Path("data/research-refresh-status.json"); payload = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {"schema_version": "research-refresh-status-v1", "research_only": True}
    payload.setdefault(args.task, {}) .update({"status": args.status, "run_id": args.run_id, "updated_at": datetime.now(timezone.utc).isoformat()}); path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=path.parent, delete=False, suffix=".tmp") as handle: json.dump(payload, handle, ensure_ascii=False, indent=2); handle.write("\n"); temp = handle.name
    os.replace(temp, path)
if __name__ == "__main__": main()

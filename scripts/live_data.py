"""Publish validated generated files without touching the Pages source branch.

All git trees are built with a temporary index. Normal fast-forward pushes are the
only publication operation; a failed push never changes the advertised manifest.
"""
from __future__ import annotations

import argparse
import fnmatch
import json
import os
from pathlib import Path, PurePosixPath
import re
import subprocess
import tempfile
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = "live-data-manifest.json"
BRANCH = "live-data"
TASKS = json.loads((ROOT / "scripts/live-data-tasks.json").read_text(encoding="utf-8"))
PATTERNS = sorted({p for task in TASKS.values() for p in task["outputs"]} | {
    "results/**", "research/results/**", "data/backtest-daily-prices.json",
    "data/research-prices.json", "data/dip-warmup-daily.json"})


def allowed(path, patterns=PATTERNS):
    return (not PurePosixPath(path).is_absolute() and ".." not in PurePosixPath(path).parts
            and "\\" not in path and any(fnmatch.fnmatchcase(path, p) for p in patterns)
            and (not path.startswith("data/private/") or path == "data/private/wealthsimple-holdings.enc.json"))


def git(*args, data=None, env=None):
    return subprocess.check_output(["git", *args], cwd=ROOT, input=data, env=env).decode().strip()


def latest():
    git("fetch", "origin", BRANCH)
    return git("rev-parse", "FETCH_HEAD")


def tree_files(ref):
    return {row.split("\t", 1)[1]: row.split()[2] for row in git("ls-tree", "-r", ref).splitlines() if row}


def overlay(ref):
    """Load all current generated inputs, including deletes, never code/config."""
    files = tree_files(ref)
    if any(not allowed(path) and path != MANIFEST for path in files):
        raise ValueError("Data branch contains files outside the publication allowlist")
    for path in ROOT.glob("data/**/*"):
        if path.is_file() and allowed(path.relative_to(ROOT).as_posix()) and path.relative_to(ROOT).as_posix() not in files:
            path.unlink()
    for folder in ("results", "research/results"):
        for path in (ROOT / folder).rglob("*"):
            if path.is_file() and allowed(path.relative_to(ROOT).as_posix()) and path.relative_to(ROOT).as_posix() not in files:
                path.unlink()
    for path in files:
        if allowed(path):
            dest = ROOT / path
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(subprocess.check_output(["git", "show", f"{ref}:{path}"], cwd=ROOT))


def collect(patterns, tracked_only=False):
    paths = git("ls-files").splitlines() if tracked_only else [p.relative_to(ROOT).as_posix() for pattern in patterns for p in ROOT.glob(pattern.replace("/**", "/**/*")) if p.is_file()]
    result = {}
    for path in sorted(set(paths)):
        if not allowed(path, patterns):
            continue
        file = ROOT / path
        if file.is_symlink():
            raise ValueError(f"Symlink cannot be published: {path}")
        content = file.read_bytes()
        if path.endswith(".json"):
            json.loads(content)
        result[path] = content
    return result


def commit_files(base, changes, message):
    with tempfile.TemporaryDirectory(prefix="live-data-index-") as temp:
        env = dict(os.environ, GIT_INDEX_FILE=str(Path(temp) / "index"),
                   GIT_AUTHOR_NAME="github-actions[bot]", GIT_COMMITTER_NAME="github-actions[bot]",
                   GIT_AUTHOR_EMAIL="41898282+github-actions[bot]@users.noreply.github.com",
                   GIT_COMMITTER_EMAIL="41898282+github-actions[bot]@users.noreply.github.com")
        git("read-tree", base if base else "--empty", env=env)
        for path, content in sorted(changes.items()):
            if content is None:
                git("update-index", "--force-remove", "--", path, env=env)
            else:
                blob = git("hash-object", "-w", "--stdin", data=content, env=env)
                git("update-index", "--add", "--cacheinfo", f"100644,{blob},{path}", env=env)
        tree = git("write-tree", env=env)
        if base and tree == git("rev-parse", f"{base}^{{tree}}"):
            return base
        return git("commit-tree", tree, *(["-p", base] if base else []), "-m", message, env=env)


def release(base, changes, code_sha):
    data_sha = commit_files(base, changes, "Refresh validated live data")
    if data_sha == base:
        return base
    manifest = {"formatVersion": 1, "dataCommit": data_sha, "codeCommit": code_sha,
                "publishedAt": datetime.now(timezone.utc).isoformat()}
    return commit_files(data_sha, {MANIFEST: (json.dumps(manifest, indent=2) + "\n").encode()}, "Publish immutable live-data manifest")


def commands(task):
    env = dict(os.environ, PYTHONUTF8="1")
    failed = False
    with tempfile.NamedTemporaryFile(delete=False) as temp:
        env["GITHUB_ENV"] = temp.name
    try:
        for step in task["commands"]:
            condition = step.get("if", "success()")
            if condition == "failure()":
                run = failed
            elif condition == "success()":
                run = not failed
            elif condition == "env.SHADOW_UPDATE_DUE == 'true'":
                run = not failed and env.get("SHADOW_UPDATE_DUE") == "true"
            else:
                raise ValueError(f"Unsupported condition: {condition}")
            if not run:
                continue
            step_env = dict(env)
            for key, value in step.get("env", {}).items():
                if "${{" not in str(value):
                    step_env[key] = str(value)
            print(f"::group::{step.get('name', 'Generate / validate')}", flush=True)
            result = subprocess.run(["bash", "-eo", "pipefail", "-c", step["run"]], cwd=ROOT, env=step_env)
            print("::endgroup::", flush=True)
            if result.returncode and not step.get("continue-on-error"):
                failed = True
            for line in Path(temp.name).read_text(encoding="utf-8").splitlines():
                if "=" in line:
                    key, value = line.split("=", 1)
                    env[key] = value
        if failed:
            raise RuntimeError("Generation/validation failed; previous published version retained")
    finally:
        Path(temp.name).unlink(missing_ok=True)


def market_outcome(report):
    if report.get("publishStatus") == "published":
        return "行情检查完成：行情已替换。行情时间仍以 quoteTimestamp 为准。"
    return "行情检查完成：行情未替换，保留此前快照。原因：" + str(report.get("publishReason") or "检查结果不可用")


def report_market_outcome(name):
    if name != "update-market-data":
        return
    report = json.loads((ROOT / "results/data_freshness/market_price_freshness.json").read_text(encoding="utf-8"))
    message = market_outcome(report)
    print(message)
    if report.get("publishStatus") != "published":
        print("::warning::" + message)
    if os.environ.get("GITHUB_STEP_SUMMARY"):
        with open(os.environ["GITHUB_STEP_SUMMARY"], "a", encoding="utf-8") as handle:
            handle.write("\n" + message + "\n\n检查时间：" + str(report.get("generatedAt")) + "\n")


def publish_task(name, review=False):
    task = TASKS[name]
    if (name == "sync-snaptrade-holdings") != review:
        raise ValueError("Encrypted holdings require a manual review PR")
    code_sha = git("rev-parse", "HEAD")
    previous = None
    for attempt in range(3):
        base = latest()
        files = tree_files(base)
        # Conservatively treat all generated data as inputs. Any competing change
        # regenerates and revalidates; no stale history can overwrite a new input.
        inputs = {p: sha for p, sha in files.items() if p != MANIFEST}
        if inputs != previous:
            overlay(base)
            commands(task)
            subprocess.run(["node", "scripts/validate-encrypted-holdings.mjs"], check=True, cwd=ROOT)
            subprocess.run(["node", "--test", "tests/live-data.test.js"], check=True, cwd=ROOT)
            status_task = {"update-short-term-signals": "today", "update-idea-engine": "universe"}.get(name)
            if status_task:
                subprocess.run(["python", "scripts/write_refresh_status.py", "--task", status_task,
                                "--status", "success", "--run-id", os.environ["GITHUB_RUN_ID"]], check=True, cwd=ROOT)
            output = collect(task["outputs"])
            changes = dict(output)
            for path in files:
                if allowed(path, task["outputs"]) and path not in output:
                    changes[path] = None
            previous = inputs
        if review:
            head = commit_files(base, changes, "Review encrypted holdings snapshot")
            if head == base:
                print("No holdings changes")
                return
            branch = f"automation/live-holdings-{os.environ['GITHUB_RUN_ID']}"
            git("push", "origin", f"{head}:refs/heads/{branch}")
            subprocess.run(["gh", "pr", "create", "--base", BRANCH, "--head", branch,
                            "--title", "Review encrypted holdings snapshot", "--body",
                            "Encrypted snapshot only. Manual review required. After merge the reviewed-holdings workflow validates and updates the data manifest. No Pages deployment."], check=True, cwd=ROOT)
            return
        head = release(base, changes, code_sha)
        if head == base:
            print("No data changes")
            report_market_outcome(name)
            return
        result = subprocess.run(["git", "push", "origin", f"{head}:refs/heads/{BRANCH}"], cwd=ROOT)
        if result.returncode == 0:
            print(f"Published {head}; Pages source unchanged")
            report_market_outcome(name)
            return
        print(f"Publication conflict/failure ({attempt + 1}/3); reloading latest inputs")
    raise RuntimeError("Publication failed after three attempts; no force push attempted")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--task", choices=TASKS)
    parser.add_argument("--review", action="store_true")
    parser.add_argument("--initialize", action="store_true")
    parser.add_argument("--publish-reviewed", action="store_true")
    args = parser.parse_args()
    if args.initialize:
        if git("ls-remote", "--heads", "origin", BRANCH):
            raise ValueError("live-data already exists")
        subprocess.run(["node", "scripts/validate-encrypted-holdings.mjs"], check=True, cwd=ROOT)
        head = release(None, collect(PATTERNS, tracked_only=True), git("rev-parse", "HEAD"))
        git("push", "origin", f"{head}:refs/heads/{BRANCH}")
    elif args.publish_reviewed:
        for _ in range(3):
            base = latest()
            old = json.loads(git("show", f"{base}:{MANIFEST}"))
            changed = git("diff", "--name-only", old["dataCommit"], base).splitlines()
            changed = [p for p in changed if p != MANIFEST]
            if not changed:
                print("No reviewed data awaiting publication")
                return
            if changed != ["data/private/wealthsimple-holdings.enc.json"]:
                raise ValueError("Unexpected unadvertised data changes; manual inspection required")
            overlay(base)
            subprocess.run(["node", "scripts/validate-encrypted-holdings.mjs"], check=True, cwd=ROOT)
            manifest = {"formatVersion": 1, "dataCommit": base, "codeCommit": git("rev-parse", "HEAD"), "publishedAt": datetime.now(timezone.utc).isoformat()}
            head = commit_files(base, {MANIFEST: (json.dumps(manifest, indent=2) + "\n").encode()}, "Publish reviewed holdings manifest")
            if subprocess.run(["git", "push", "origin", f"{head}:refs/heads/{BRANCH}"], cwd=ROOT).returncode == 0:
                return
        raise RuntimeError("Reviewed publication failed after three attempts")
    elif args.task:
        publish_task(args.task, args.review)
    else:
        parser.error("Choose a task or initialization")


if __name__ == "__main__":
    main()

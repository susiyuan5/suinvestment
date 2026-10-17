# AGENTS.md — Su Investment Pro

Shared working rules for every coding agent on this repo (Codex, Claude, others).
This file is the single source of truth; `CLAUDE.md` only points here.
Owner: Su (`susiyuan5`). UI text is Simplified Chinese; code/docs are English.

## What this project is

A **manual decision-support** dashboard (GitHub Pages: https://susiyuan5.github.io/suinvestment/)
plus Python/Node backtest and research tooling for Su's weekly DCA investing in Wealthsimple.
It is **not** a trading bot. Start with `PROJECT_NAVIGATION.md`, then the dated sections at the top of `README.md`.

Main surfaces: `index.html` + `app.js` (workspace: weekly plan, dip reserve, take-profit, holdings),
`holdings.html`, `stock-detail.html`, `research-sandbox.html` (read-only research).
Data snapshots live in `data/`; refresh jobs in `.github/workflows/` and `scripts/`.

## Hard safety boundaries (never cross without Su explicitly asking)

- No order placement, broker login, or broker write API. SnapTrade use is **read-only** holdings sync.
- No activate / promote / trade buttons. Every suggestion stays manual.
- Research or shadow symbols never appear in the live weekly plan / Manual Trade Plan.
- Do not modify `data/backtest-prices.json` or generated `research/results/**` evidence by hand.
- Do not change strategy formulas in a UI-, docs- or QA-only task.
- Never commit secrets, holdings keys, or plaintext holdings. Encrypted snapshots only.
- Never relabel CAD costs as USD or convert historical cost with today's FX.

## Verify before every PR (CI runs the same in `quality.yml`)

```bash
python -m unittest discover -s tests      # needs pandas>=2,<3
npm test                                  # node --test tests/*.test.js (Node >= 24 in CI)
python scripts/check_static_contracts.py
npm run check:js                          # syntax check of browser/scripts JS
```

Feature-specific smokes (Playwright): `npm run audit:workspace`, `audit:take-profit`, `audit:dca`, `audit:dip`, `audit:data`, `audit:pages`.
Add or update tests with every behaviour change; prefer frozen fixtures in `tests/fixtures/` over live network data.

## Collaboration protocol (Codex + Claude)

- **Branches**: Codex uses `codex/<topic>`, Claude uses `claude/<topic>`. Never push directly to `main`; one topic per PR.
- **Before starting**: `git pull`, check open PRs/branches so two agents don't edit the same feature. If a PR from the other agent touches the same files, review or rebase on it instead of duplicating work.
- **PR description**: what changed, why, which checks were run (with pass counts), and any open risks. Su merges.
- **Review swap**: when one agent opens a PR, the other may be asked to review it. Review against this file's boundaries and the tests, not personal style.
- **Handoff notes**: if work is left unfinished, write the status in the PR description (done / not done / next step) so the other agent can pick it up cold.
- **Reports**: put new design/validation reports in `docs/` (not the repo root, which is already crowded) and link them from `PROJECT_NAVIGATION.md`.
- **Language**: user-facing UI strings in Simplified Chinese (`scripts/check_simplified_chinese.py`); keep wording calm and non-promotional.

## Conventions

- Static site, no bundler: plain ES scripts loaded by the HTML pages; keep new modules small and add them to `check:js`.
- Python 3.11, standard library + pandas for tests; research extras in `requirements-research.txt`.
- Browser storage keys are namespaced `su-investment-pro:*`; don't rename existing keys without a migration.
- Element ids are contract-checked by `scripts/check_static_contracts.py` — update it when ids change.

# Pure Insights Command Centre

Admin dashboard for the post-Tableau analytics portal: report health, orphaned-report tracking, live alerting, and Snowflake cost allocation. Built for Case Study 3 (Technical Data AI Validation, Monetization).

| Deliverable | Where |
|---|---|
| Runnable full-stack code (React + Node/Express) | `frontend/`, `backend/` |
| REST API and WebSocket specification | [`docs/API_SPEC.md`](docs/API_SPEC.md) |
| Snowflake cost allocation SQL suite | [`sql/`](sql/) |
| Data validation (notebook + report) | [`notebooks/01_data_validation.ipynb`](notebooks/01_data_validation.ipynb) |
| Design, assumptions, limitations | [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md), [`docs/ASSUMPTIONS.md`](docs/ASSUMPTIONS.md) |

## Quick start

Requires Node 18+ (tested on 22). Python 3.10+ is only needed to re-run the notebook and SQL suite; their outputs are already committed in `data/`.

```bash
npm run setup      # installs root, backend and frontend dependencies
npm run dev        # API on :4000, web app on :5173
```

Open http://localhost:5173 and click a demo account on the login screen.

| Role | Email | Password |
|---|---|---|
| admin | admin@pureinsights.local | Admin#123 |
| analyst | analyst@pureinsights.local | Analyst#123 |
| viewer | viewer@pureinsights.local | Viewer#123 |

**To see live alerts:** sign in as admin → *Live alerts* → *Start*. The simulator replays the dataset as live events; alerts appear in the feed, critical ones also pop up as toasts.

```bash
npm test           # 15 backend tests: alert rules, RBAC matrix, WebSocket delivery
npm run build      # production build of the frontend
```

## What each role sees

- **viewer**: overview and live alerts only.
- **analyst**: + reports, orphaned reports, cost allocation, data-quality log; can acknowledge alerts.
- **admin**: + assign owners to orphaned reports; start/stop the simulator.

The server enforces this; the UI only mirrors it (tested in `backend/test/api.test.js`).

## Re-running the data steps (optional)

```bash
python -m venv .venv && source .venv/bin/activate     # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cd notebooks && jupyter nbconvert --to notebook --execute --inplace 01_data_validation.ipynb && cd ..
python sql/run_all.py                                  # runs 01–05 on DuckDB and exports the cost tables
```

The pipeline is: raw CSV → notebook (clean + issue log) → SQL suite (cost tables) → backend serves the results.

## Key findings and decisions

- The file is **100 reports × 20 snapshots**, not 2,000 reports. Rows are kept as snapshots (assumption A1).
- **245** snapshots have no owner (two encodings: `nan` and `ORPHANED_REPORT`), **24** have negative credits, **100** have `UNKNOWN` refresh status.
- **74.5%** of rows exceed the 15s latency threshold, so a flat alert rule would fire constantly. Alerts use warning/critical tiers and a per-report cooldown.
- All numeric columns are uncorrelated, so the data is synthetic. Insights **rank and flag**; they do not claim causes.
- Credit allocation splits warehouse credits by share of query execution time and reconciles exactly to metered credits.

Everything that is simulated or assumed is listed in [`docs/ASSUMPTIONS.md`](docs/ASSUMPTIONS.md). Read it before trusting any dollar figure.

## Project layout

```
data/        raw CSV, cleaned CSV, issue log, SQL-suite outputs
notebooks/   01_data_validation.ipynb (+ HTML export)
validation/  cleaning.py (shared cleaning rules)
sql/         01–05 .sql scripts + run_all.py
backend/     Express API, JWT/RBAC, alert engine, simulator, WebSocket, tests
frontend/    React app (Vite)
docs/        API spec, architecture, assumptions
```

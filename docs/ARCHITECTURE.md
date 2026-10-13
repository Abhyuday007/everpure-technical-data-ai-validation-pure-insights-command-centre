# Architecture

```
 data/pure_insights_raw.csv
        │
        ▼
 notebooks/01_data_validation.ipynb ──uses──▶ validation/cleaning.py
        │  writes
        ▼
 data/pure_insights_clean.csv · data/dq_issues.csv
        │
        ▼
 sql/run_all.py  (DuckDB)   01 setup → 02 checks → 03 attribution → 04 unit cost → 05 insights
        │  writes
        ▼
 data/cost_by_report.csv · cost_by_warehouse.csv · cost_params.csv
        │
        ▼
 backend/ (Node + Express)
   ├─ REST + JWT + RBAC
   ├─ AlertEngine (pure logic, unit-tested)
   ├─ Simulator (replays rows as live events)
   └─ WebSocket hub  ──────────────┐
        ▲ REST                     │ WS push
        │                          ▼
 frontend/ (React + Vite) ◀───────┘
```

## Why it is split this way

**Cleaning and cost logic live in one place each.** The notebook owns data cleaning (`validation/cleaning.py`). The SQL suite owns cost allocation. The backend does not re-implement either: it loads the files they produce. That avoids two sources of truth. A backend test checks that metered credits equal attributed credits, so a break in the hand-off is caught.

**The alert engine is pure.** `alertEngine.js` takes an event and returns alerts. It has no timers, sockets or database, so tests can pin exact thresholds and cooldown behaviour. The simulator and WebSocket hub sit around it.

**The data layer is files, not a database.** The dataset is 2,000 rows, so an in-memory store loaded at start-up is simpler and has fewer failure modes than running a database. The trade-off: owner assignments reset on restart. A production version would write to a table (see ASSUMPTIONS.md).

## Backend modules

| File | Responsibility |
|---|---|
| `src/app.js` | Express routes, WebSocket upgrade, wiring |
| `src/auth.js` | Demo users, JWT sign/verify, `authenticate`, `requireRole` |
| `src/alertEngine.js` | Rules, severity tiers, cooldown |
| `src/simulator.js` | Timed replay of dataset rows |
| `src/data.js` | Loads CSVs, derives "current state" per report |
| `src/config.js` | Environment-driven settings |

## Frontend structure

`App.jsx` holds auth state and navigation; `useLive.js` owns the WebSocket (connect, reconnect, alert list, toasts); `pages/*` are one file per screen. There is no state library or router: the app has six screens and one shared live feed, so React state is enough.

## Security notes

- Passwords are bcrypt-hashed at start-up, but the demo users are hard-coded. A real system would use SSO or a user store.
- `JWT_SECRET` falls back to an insecure default and the server prints a warning. Set it in any shared environment.
- Authorization is enforced on the server; the UI only mirrors it.
- Request bodies are limited to 10 KB, `sort` parameters are checked against an allow-list, and the owner email is validated.
- Not implemented: login rate limiting, HTTPS termination, token revocation, audit logging.

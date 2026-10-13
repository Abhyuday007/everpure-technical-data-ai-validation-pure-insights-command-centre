# REST API and WebSocket Specification

Base URL (dev): `http://localhost:4000` · the frontend dev server proxies `/api` and `/ws` to it.
All bodies are JSON. All timestamps are ISO 8601 UTC.

## Authentication

`POST /api/auth/login` returns a JWT. Send it on every other request as `Authorization: Bearer <token>`.
Tokens expire after `JWT_EXPIRES_IN` (default 8h). The only unauthenticated routes are `login` and `healthz`.

Demo accounts (hard-coded for the assessment, see ASSUMPTIONS.md):

| Role | Email | Password |
|---|---|---|
| admin | admin@pureinsights.local | Admin#123 |
| analyst | analyst@pureinsights.local | Analyst#123 |
| viewer | viewer@pureinsights.local | Viewer#123 |

## Roles (RBAC)

| Capability | viewer | analyst | admin |
|---|:-:|:-:|:-:|
| Health summary, list alerts, WebSocket feed | ✓ | ✓ | ✓ |
| Reports, orphaned reports, costs, data-quality log | | ✓ | ✓ |
| Acknowledge alerts | | ✓ | ✓ |
| Assign report owner, start/stop simulator | | | ✓ |

Enforced server-side in middleware (`requireRole`). The UI hides pages the same way, but hiding is a convenience, not the control.

## Errors

Every error has the shape `{ "error": "<code>", "message": "<human readable>" }`.

| Status | `error` | When |
|---|---|---|
| 400 | `bad_request` | Invalid query or body |
| 401 | `unauthorized` / `invalid_credentials` | Missing, invalid or expired token; wrong login |
| 403 | `forbidden` | Authenticated but role not allowed |
| 404 | `not_found` | Unknown report, alert or route |
| 500 | `internal` | Unexpected; details are logged, not returned |

## Endpoints

### Auth
| Method & path | Role | Description |
|---|---|---|
| `POST /api/auth/login` | public | Body `{email, password}` → `{token, user:{email,role,name}}` |
| `GET /api/auth/me` | any | → `{user}` |
| `GET /api/healthz` | public | → `{status:"ok"}` |

### Health
| `GET /api/health/summary` | any | Current state across reports |

```json
{
  "reports": 100,
  "refreshStatus": { "SUCCESS": 70, "FAILED": 16, "TIMED_OUT": 9, "UNKNOWN": 5 },
  "orphanedReports": 14, "avgLoadTimeSec": 26.3,
  "slowReports": 76, "criticalSlowReports": 43,
  "thresholds": { "warnSec": 15, "critSec": 30 },
  "alerts": { "open": 0, "openCritical": 0, "evaluated": 0, "raised": 0, "suppressed": 0 },
  "simulator": { "running": false, "intervalMs": 500, "emitted": 0, "position": 0, "total": 2000 }
}
```
"Current state" uses each report's latest snapshot.

### Reports
| Method & path | Role | Description |
|---|---|---|
| `GET /api/reports` | analyst+ | Query: `q`, `status` (SUCCESS/FAILED/TIMED_OUT/UNKNOWN), `orphaned` (true/false), `latency` (ok/warning/critical), `sort` (reportId, views, loadTimeSec, totalCostUsd, totalCostPerView, refreshStatus), `order` (asc/desc), `page`, `pageSize` (max 100). → `{total,page,pageSize,items[]}` |
| `GET /api/reports/orphaned` | analyst+ | Reports whose latest snapshot has no owner, highest cost first. → `{count, items[]}` |
| `GET /api/reports/:id` | analyst+ | One report plus its full snapshot `history[]` |
| `PATCH /api/reports/:id/owner` | admin | Body `{ownerEmail}` (validated). → updated report. Broadcasts `owner_assigned` |

A report item: `reportId, reportName, ownerEmail|null, isOrphaned, refreshStatus, loadTimeSec, latencySeverity, views, peakConcurrent, queryCount, awsCostUsd, snapshotSeq, cost{...}`.

### Costs (produced by the SQL suite)
| Method & path | Role | Description |
|---|---|---|
| `GET /api/costs/summary` | analyst+ | Totals, credit price, cost per view, orphaned spend, metered credits per warehouse |
| `GET /api/costs/reports?sort=&limit=` | analyst+ | `sort` = totalCostUsd (default), totalCostPerView, totalViews; `limit` ≤ 200 |

### Alerts
| Method & path | Role | Description |
|---|---|---|
| `GET /api/alerts` | any | Query: `severity`, `acknowledged` (true/false), `limit` ≤ 200. Newest first; the server keeps the latest 500 |
| `POST /api/alerts/:id/ack` | analyst+ | Marks acknowledged. Broadcasts `alert_ack` |

### Data quality
| `GET /api/dq/issues` | analyst+ | The issue log from notebook 01: issue, column, rowsAffected, pctOfRows, action |

### Simulator
| Method & path | Role | Description |
|---|---|---|
| `GET /api/simulator` | any | Status |
| `POST /api/simulator/start` | admin | Optional body `{intervalMs}` (50 to 10000) |
| `POST /api/simulator/stop` | admin | Stops replay |

## WebSocket

`ws://localhost:4000/ws?token=<JWT>`

The token goes in the query string because browsers cannot set headers on a WebSocket. Query strings can appear in server logs, so use TLS (`wss://`) in any real deployment. A missing or invalid token is refused at upgrade with HTTP 401. Messages are server → client only; anything the client sends is ignored.

Envelope: `{ "type": "<name>", "data": { ... } }`

| `type` | When | `data` |
|---|---|---|
| `hello` | On connect | `{user, simulator}` |
| `telemetry` | Each replayed event | `{reportId, reportName, loadTimeSec, refreshStatus, ts}` |
| `alert` | An alert rule fires | Alert object (below) |
| `alert_ack` | Someone acknowledged | `{id, acknowledgedBy}` |
| `owner_assigned` | Admin assigned an owner | `{reportId, ownerEmail, by}` |
| `simulator_status` | Simulator started/stopped | Simulator status |

Alert object:
```json
{
  "id": "A000042", "ts": "2026-10-13T08:42:11.120Z",
  "reportId": "RPT_221", "reportName": "Analytics Dashboard 22",
  "rule": "LATENCY", "severity": "critical",
  "value": 46.3, "threshold": 30, "message": "Load time 46.3s exceeds 30s",
  "acknowledged": false, "acknowledgedBy": null
}
```

### Alert rules
| Rule | Condition | Severity |
|---|---|---|
| `LATENCY` | load time > 15s | warning |
| `LATENCY` | load time > 30s | critical |
| `REFRESH` | status `FAILED` | critical |
| `REFRESH` | status `TIMED_OUT` | warning |
| | status `UNKNOWN` or `SUCCESS` | no alert |

Cooldown: after an alert fires for a (report, rule) pair, repeats inside `ALERT_COOLDOWN_MS` (default 90s) are suppressed unless the severity escalates (warning → critical). Suppressed events are counted in `/api/health/summary`.

### Client behaviour
The reference client reconnects with exponential backoff (capped at 10s) and reloads recent alerts over REST after each reconnect, so a dropped connection never leaves it silently stale.

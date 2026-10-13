# Assumptions and Limitations

Stated up front so a reviewer can disagree with them quickly.

## About the data

| # | Assumption | Effect if wrong |
|---|---|---|
| A1 | The file holds 100 reports × 20 rows. With no timestamp, each repeated row is a **snapshot**, ordered by file position (`snapshot_seq`). | If they are true duplicates, deduplicate by `report_id` in `validation/cleaning.py`. All counts and costs change. |
| A2 | The owner differs between snapshots of the same report, so a report is "orphaned" if its **latest** snapshot has no owner. | A different rule (for example, never had an owner) gives a different orphan list. |
| A3 | Each snapshot is a 30-day period. | Cost totals scale with the number of periods. Per-view figures do not. |
| A4 | Negative credits are errors. The row is kept, the value is nulled and excluded from cost sums. | If they are legitimate refunds, they should be netted instead. |
| A5 | `UNKNOWN` refresh status is neither success nor failure and raises no alert. | Treating it as failure adds 5% more alerts. |
| A6 | The columns in the source are statistically independent (all pairwise correlations ≈ 0), so it is treated as synthetic. No causal claims are made. | n/a |

## About the simulation

- **No Snowflake account was available.** `QUERY_HISTORY` and `WAREHOUSE_METERING_HISTORY` are simulated with Snowflake's column names. Query history is pre-aggregated to one row per report per period; the real table has one row per query (about 25 million rows at this scale).
- **Metering is derived from the reported credits.** So the attributed-vs-reported gap in `05_insights.sql` Q7 comes from the allocation method, not from a real billing discrepancy.
- **Credit price is $3.00**, a placeholder (real price depends on edition and region). It is one parameter in `01_setup_tables.sql`.
- **Warehouse assignment** (small/medium/large by report number) is invented to give the allocation something to split.
- **"Real-time" is a replay.** The simulator feeds dataset rows through the same code path a live feed would use. Nothing is monitored for real.
- The SQL was run on DuckDB. Porting notes for Snowflake are in `sql/05_insights.sql`; it has not been run on Snowflake.

## About alert design

- The 15s threshold comes from the brief. The **30s critical tier and 90s cooldown are my choices**, because a flat 15s rule fires on about 75% of rows. Both are environment variables.
- `FAILED` is critical and `TIMED_OUT` is a warning. That split is a judgement call.

## Limitations

- Owner assignments and alerts live in server memory and reset on restart.
- Single server process; a second instance would not share alerts or WebSocket clients.
- Hard-coded demo users; no password change, rate limiting or audit log.
- No automated browser tests are committed. The UI was exercised end-to-end manually with a headless browser.
- No Docker setup is provided.

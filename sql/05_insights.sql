-- =============================================================================
-- 05_insights.sql
-- Questions the business would actually ask. Each query is independent.
-- NOTE: the source columns are statistically independent (see notebook 01),
-- so these queries RANK and FLAG. They do not claim causal relationships.
--
-- SNOWFLAKE PORTING NOTES (tested on DuckDB):
--   QUANTILE_CONT(x, 0.95)  ->  PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY x)
--   read_csv_auto(...)      ->  COPY INTO ... FROM @stage  (see 01_setup_tables.sql)
--   QUALIFY, NTILE, RANK, NULLIF, CTEs, window functions work unchanged.
-- =============================================================================

-- Q1. Top 10 most expensive reports overall
SELECT report_id, total_cost_usd, total_views, total_cost_per_view
FROM report_cost
ORDER BY total_cost_usd DESC
LIMIT 10;

-- Q2. Worst unit cost: most expensive PER VIEW (reports with real traffic only)
SELECT report_id, total_views, total_cost_usd, total_cost_per_view,
       RANK() OVER (ORDER BY total_cost_per_view DESC) AS cost_per_view_rank
FROM report_cost
WHERE total_views >= 100
ORDER BY total_cost_per_view DESC
LIMIT 10;

-- Q3. Retirement candidates: bottom quartile of views but top quartile of cost
WITH q AS (
    SELECT *,
           NTILE(4) OVER (ORDER BY total_views ASC)  AS views_quartile,   -- 1 = fewest views
           NTILE(4) OVER (ORDER BY total_cost_usd DESC) AS cost_quartile  -- 1 = highest cost
    FROM report_cost
)
SELECT report_id, total_views, total_cost_usd, total_cost_per_view
FROM q
WHERE views_quartile = 1 AND cost_quartile = 1
ORDER BY total_cost_usd DESC;

-- Q4. Orphaned reports ranked by what they cost (no owner to ask for justification)
SELECT report_id, latest_owner, latest_refresh_status, total_cost_usd, total_views
FROM report_cost
WHERE latest_is_orphaned
ORDER BY total_cost_usd DESC;

-- Q5. Chargeback by owner (orphaned cost shown as its own line, not hidden)
SELECT
    COALESCE(latest_owner, '(ORPHANED - no owner)') AS owner,
    COUNT(*)                                        AS reports,
    ROUND(SUM(total_cost_usd), 2)                   AS total_cost_usd,
    ROUND(SUM(total_cost_usd) / NULLIF(SUM(total_views), 0), 4) AS cost_per_view
FROM report_cost
GROUP BY COALESCE(latest_owner, '(ORPHANED - no owner)')
ORDER BY total_cost_usd DESC;

-- Q6. AWS hosting cost vs usage mismatch: snapshots in the top 5% of AWS cost per view
WITH per_snapshot AS (
    SELECT report_id, snapshot_seq, monthly_active_views, aws_hosting_cost_usd,
           aws_hosting_cost_usd / NULLIF(monthly_active_views, 0) AS aws_cost_per_view
    FROM report_snapshots
),
threshold AS (
    SELECT QUANTILE_CONT(aws_cost_per_view, 0.95) AS p95 FROM per_snapshot
)
SELECT p.*
FROM per_snapshot p, threshold t
WHERE p.aws_cost_per_view > t.p95
ORDER BY p.aws_cost_per_view DESC
LIMIT 20;

-- Q7. Where does the self-reported credit figure disagree with usage-based attribution?
-- CAUTION: in this simulation warehouse metering is built FROM the reported credits
-- (see 01_setup_tables.sql), so gaps here come from the allocation method (elapsed-time
-- share) versus the catalogue figure, not from a real billing discrepancy. On a real
-- account, the same query would flag reports whose catalogue credits disagree with
-- what the warehouse actually billed.
SELECT report_id, credits_reported, credits_attributed,
       ROUND(credits_attributed - credits_reported, 2)                          AS diff,
       ROUND((credits_attributed - credits_reported) / NULLIF(credits_reported, 0) * 100, 1) AS diff_pct
FROM report_cost
ORDER BY ABS(credits_attributed - credits_reported) DESC
LIMIT 10;

-- Q8. Cost of failing refreshes: spend on snapshots whose refresh FAILED / TIMED_OUT
SELECT last_refresh_status,
       COUNT(*)                                       AS snapshots,
       ROUND(SUM(credits_reported), 1)                AS credits,
       ROUND(SUM(credits_reported) * (SELECT credit_price_usd FROM params), 2) AS snowflake_usd
FROM report_snapshots
GROUP BY last_refresh_status
ORDER BY snowflake_usd DESC;

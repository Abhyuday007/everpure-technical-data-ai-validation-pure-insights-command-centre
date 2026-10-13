-- =============================================================================
-- 03_credit_attribution.sql
-- Splits each warehouse's metered credits across the reports that ran on it.
--
-- METHOD (execution-time share):
--   report_credits = warehouse_credits_in_period
--                    x report_elapsed_ms / total_elapsed_ms_on_that_warehouse_in_period
--
-- WHY elapsed time and not query count: one 40-second dashboard load keeps the
-- warehouse running far longer than forty 1-second lookups, and compute time is
-- what Snowflake bills. Query count would over-charge chatty-but-cheap reports.
-- =============================================================================

CREATE OR REPLACE TABLE credit_attribution AS
WITH warehouse_period_totals AS (
    SELECT
        warehouse_name,
        period_id,
        SUM(total_elapsed_time_ms) AS wh_elapsed_ms
    FROM query_history
    GROUP BY warehouse_name, period_id
),
shares AS (
    SELECT
        q.report_id,
        q.warehouse_name,
        q.period_id,
        q.query_count,
        q.total_elapsed_time_ms,
        q.total_elapsed_time_ms * 1.0 / NULLIF(t.wh_elapsed_ms, 0) AS elapsed_share
    FROM query_history q
    JOIN warehouse_period_totals t
      ON t.warehouse_name = q.warehouse_name AND t.period_id = q.period_id
)
SELECT
    sh.report_id,
    sh.warehouse_name,
    sh.period_id,
    sh.query_count,
    sh.elapsed_share,
    m.credits_used                         AS warehouse_credits,
    sh.elapsed_share * m.credits_used      AS credits_attributed
FROM shares sh
JOIN warehouse_metering_history m
  ON m.warehouse_name = sh.warehouse_name AND m.period_id = sh.period_id;

-- ---- RECONCILIATION: allocated credits must equal metered credits -------------
-- If this returns any row with abs_diff > 0.01 the allocation leaks or double counts.
SELECT
    m.warehouse_name,
    ROUND(SUM(m.credits_used), 2)                                       AS metered_credits,
    ROUND((SELECT SUM(a.credits_attributed) FROM credit_attribution a
           WHERE a.warehouse_name = m.warehouse_name), 2)               AS attributed_credits,
    ROUND(ABS(SUM(m.credits_used) -
         (SELECT SUM(a.credits_attributed) FROM credit_attribution a
          WHERE a.warehouse_name = m.warehouse_name)), 4)               AS abs_diff
FROM warehouse_metering_history m
GROUP BY m.warehouse_name
ORDER BY m.warehouse_name;

-- =============================================================================
-- 04_unit_cost.sql
-- Per-report totals and unit cost per active view.
-- Cost = Snowflake credits x credit price + AWS hosting cost.
-- NULLIF guards the 4 snapshots with zero monthly views (no divide-by-zero).
-- =============================================================================

CREATE OR REPLACE TABLE report_cost AS
WITH per_report AS (
    SELECT
        s.report_id,
        MAX(s.report_name)                         AS report_name,
        COUNT(*)                                   AS snapshots,
        SUM(s.monthly_active_views)                AS total_views,
        SUM(s.query_count_last_30d)                AS total_queries,
        SUM(s.aws_hosting_cost_usd)                AS aws_cost_usd,
        SUM(s.credits_reported)                    AS credits_reported_total
    FROM report_snapshots s
    GROUP BY s.report_id
),
attributed AS (
    SELECT report_id, SUM(credits_attributed) AS credits_attributed_total
    FROM credit_attribution
    GROUP BY report_id
),
latest AS (
    -- state of the report in its most recent snapshot
    SELECT report_id, owner_email, is_orphaned, last_refresh_status, avg_load_time_sec
    FROM report_snapshots
    QUALIFY ROW_NUMBER() OVER (PARTITION BY report_id ORDER BY snapshot_seq DESC) = 1
),
priced AS (
    SELECT
        p.*,
        a.credits_attributed_total,
        a.credits_attributed_total * (SELECT credit_price_usd FROM params) AS snowflake_cost_usd
    FROM per_report p
    JOIN attributed a USING (report_id)
)
SELECT
    pr.report_id,
    pr.report_name,
    l.owner_email                                    AS latest_owner,
    l.is_orphaned                                    AS latest_is_orphaned,
    l.last_refresh_status                            AS latest_refresh_status,
    pr.snapshots,
    pr.total_views,
    pr.total_queries,
    ROUND(pr.credits_attributed_total, 2)            AS credits_attributed,
    ROUND(pr.credits_reported_total, 2)              AS credits_reported,
    ROUND(pr.snowflake_cost_usd, 2)                  AS snowflake_cost_usd,
    ROUND(pr.aws_cost_usd, 2)                        AS aws_cost_usd,
    ROUND(pr.snowflake_cost_usd + pr.aws_cost_usd, 2) AS total_cost_usd,
    ROUND(pr.snowflake_cost_usd / NULLIF(pr.total_views, 0), 4)                       AS snowflake_cost_per_view,
    ROUND((pr.snowflake_cost_usd + pr.aws_cost_usd) / NULLIF(pr.total_views, 0), 4)   AS total_cost_per_view,
    ROUND((pr.snowflake_cost_usd + pr.aws_cost_usd) / NULLIF(pr.total_queries, 0), 6) AS total_cost_per_query
FROM priced pr
JOIN latest l USING (report_id);

SELECT * FROM report_cost ORDER BY total_cost_usd DESC LIMIT 10;

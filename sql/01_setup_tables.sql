-- =============================================================================
-- 01_setup_tables.sql
-- Creates the simulated Snowflake ACCOUNT_USAGE tables used by the cost suite.
--
-- WHY SIMULATED: no Snowflake account was available. Table and column names
-- mirror SNOWFLAKE.ACCOUNT_USAGE.QUERY_HISTORY and WAREHOUSE_METERING_HISTORY so
-- the attribution queries (03-05) port to a real account by changing the
-- source names only. Written in portable SQL and tested on DuckDB.
--
-- RUN FROM: project root (paths are relative to it).
-- INPUT   : data/pure_insights_clean.csv  (output of notebooks/01_data_validation)
-- =============================================================================

-- ---- Parameters -------------------------------------------------------------
-- Price per Snowflake credit is an ASSUMPTION (real price depends on edition and
-- region, roughly USD 2-4). Change it here and everything downstream follows.
CREATE OR REPLACE TABLE params AS SELECT 3.00 AS credit_price_usd;

-- ---- Report snapshots (cleaned data) ----------------------------------------
-- Snowflake equivalent: COPY INTO report_snapshots FROM @stage/pure_insights_clean.csv
CREATE OR REPLACE TABLE report_snapshots AS
SELECT
    report_id,
    report_name,
    snapshot_seq,
    owner_email_clean                       AS owner_email,
    is_orphaned,
    last_refresh_status,
    monthly_active_views,
    snowflake_credits_consumed              AS credits_reported_raw,
    credits_clean                           AS credits_reported,   -- negatives already NULL
    credits_invalid,
    avg_load_time_sec,
    aws_hosting_cost_usd,
    query_count_last_30d,
    concurrent_user_peak
FROM read_csv_auto('data/pure_insights_clean.csv', header = true);

-- ---- Warehouse assignment ----------------------------------------------------
-- Which warehouse serves which report. Deterministic from the report number so
-- every run produces identical tables.
CREATE OR REPLACE TABLE report_warehouse AS
SELECT DISTINCT
    report_id,
    CASE (CAST(SUBSTR(report_id, 5) AS INTEGER) % 3)
        WHEN 0 THEN 'WH_BI_SMALL'
        WHEN 1 THEN 'WH_BI_MEDIUM'
        ELSE        'WH_BI_LARGE'
    END AS warehouse_name
FROM report_snapshots;

-- ---- Simulated QUERY_HISTORY -------------------------------------------------
-- Real QUERY_HISTORY has one row per query. A full-size version would hold
-- ~25 million rows here (sum of query_count_last_30d), so this table is
-- PRE-AGGREGATED to one row per report per snapshot period. Columns are the
-- real column names where a real one exists:
--   QUERY_TAG            -> 'report_id=RPT_xxx' (how a BI tool labels its queries)
--   TOTAL_ELAPSED_TIME   -> milliseconds, summed over the period
--   WAREHOUSE_NAME, QUERY_COUNT (aggregate added by the simulation)
CREATE OR REPLACE TABLE query_history AS
SELECT
    'report_id=' || s.report_id                          AS query_tag,
    s.report_id,
    s.snapshot_seq                                       AS period_id,
    w.warehouse_name                                     AS warehouse_name,
    s.query_count_last_30d                               AS query_count,
    -- elapsed = queries x average load time (s -> ms)
    CAST(s.query_count_last_30d * s.avg_load_time_sec * 1000 AS BIGINT) AS total_elapsed_time_ms
FROM report_snapshots s
JOIN report_warehouse w USING (report_id);

-- ---- Simulated WAREHOUSE_METERING_HISTORY -----------------------------------
-- What Snowflake actually bills: credits per warehouse per period. It knows
-- nothing about reports, which is the whole problem this suite solves.
-- Built so that metered credits = sum of the valid reported credits of the
-- reports on that warehouse (negative/invalid values excluded).
CREATE OR REPLACE TABLE warehouse_metering_history AS
SELECT
    w.warehouse_name,
    s.snapshot_seq                       AS period_id,
    ROUND(SUM(s.credits_reported), 2)    AS credits_used
FROM report_snapshots s
JOIN report_warehouse w USING (report_id)
GROUP BY w.warehouse_name, s.snapshot_seq;

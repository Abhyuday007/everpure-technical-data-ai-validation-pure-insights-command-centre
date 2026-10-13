-- =============================================================================
-- 02_clean_filter.sql
-- Data-quality checks in SQL. These must reproduce the counts in
-- data/dq_issues.csv (notebook 01). If they disagree, one of them is wrong.
-- =============================================================================

-- Row-level view used by every later script: only rows that are safe for COST maths.
CREATE OR REPLACE VIEW v_cost_eligible AS
SELECT *
FROM report_snapshots
WHERE credits_reported IS NOT NULL;      -- drops the negative-credit rows from cost sums only

-- DQ summary
CREATE OR REPLACE VIEW v_dq_summary AS
SELECT 'orphaned snapshots'            AS check_name, COUNT(*) AS rows_affected FROM report_snapshots WHERE is_orphaned
UNION ALL
SELECT 'negative credits (raw)',        COUNT(*) FROM report_snapshots WHERE credits_reported_raw < 0
UNION ALL
SELECT 'refresh status UNKNOWN',        COUNT(*) FROM report_snapshots WHERE last_refresh_status = 'UNKNOWN'
UNION ALL
SELECT 'zero monthly views',            COUNT(*) FROM report_snapshots WHERE monthly_active_views = 0
UNION ALL
SELECT 'peak concurrent > monthly views', COUNT(*) FROM report_snapshots WHERE concurrent_user_peak > monthly_active_views
UNION ALL
SELECT 'load time > 15s',               COUNT(*) FROM report_snapshots WHERE avg_load_time_sec > 15
UNION ALL
SELECT 'load time > 30s',               COUNT(*) FROM report_snapshots WHERE avg_load_time_sec > 30;

SELECT * FROM v_dq_summary ORDER BY check_name;

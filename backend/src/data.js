import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'csv-parse/sync';

const num = (v) => (v === '' || v === undefined || v === null ? null : Number(v));
const bool = (v) => String(v).toLowerCase() === 'true';

function readCsv(file) {
  return parse(fs.readFileSync(file, 'utf8'), { columns: true, skip_empty_lines: true });
}

/**
 * In-memory store built from the files produced by the notebook (clean CSV, issue log)
 * and the SQL suite (cost tables). The backend never re-implements cleaning or cost
 * logic: it serves what those two steps produced.
 */
export function loadStore(dataDir) {
  const snapshots = readCsv(path.join(dataDir, 'pure_insights_clean.csv')).map((r) => ({
    reportId: r.report_id,
    reportName: r.report_name,
    snapshotSeq: num(r.snapshot_seq),
    ownerEmail: r.owner_email_clean || null,
    isOrphaned: bool(r.is_orphaned),
    orphanReason: r.orphan_reason || null,
    refreshStatus: r.last_refresh_status,
    views: num(r.monthly_active_views),
    credits: num(r.credits_clean),           // never the raw column (may be negative)
    creditsInvalid: bool(r.credits_invalid),
    loadTimeSec: num(r.avg_load_time_sec),
    awsCostUsd: num(r.aws_hosting_cost_usd),
    queryCount: num(r.query_count_last_30d),
    peakConcurrent: num(r.concurrent_user_peak),
    latencySeverity: r.latency_severity,
  }));

  const costRows = readCsv(path.join(dataDir, 'cost_by_report.csv')).map((r) => ({
    reportId: r.report_id,
    snapshots: num(r.snapshots),
    totalViews: num(r.total_views),
    totalQueries: num(r.total_queries),
    creditsAttributed: num(r.credits_attributed),
    creditsReported: num(r.credits_reported),
    snowflakeCostUsd: num(r.snowflake_cost_usd),
    awsCostUsd: num(r.aws_cost_usd),
    totalCostUsd: num(r.total_cost_usd),
    snowflakeCostPerView: num(r.snowflake_cost_per_view),
    totalCostPerView: num(r.total_cost_per_view),
    totalCostPerQuery: num(r.total_cost_per_query),
  }));
  const costById = new Map(costRows.map((c) => [c.reportId, c]));

  const warehouses = readCsv(path.join(dataDir, 'cost_by_warehouse.csv')).map((r) => ({
    warehouse: r.warehouse_name,
    credits: num(r.credits),
  }));
  const creditPriceUsd = num(readCsv(path.join(dataDir, 'cost_params.csv'))[0].credit_price_usd);

  const dqIssues = readCsv(path.join(dataDir, 'dq_issues.csv')).map((r) => ({
    issue: r.issue,
    column: r.column,
    rowsAffected: num(r.rows_affected),
    pctOfRows: num(r.pct_of_rows),
    action: r.action,
  }));

  // latest snapshot per report = "current state"
  const latestById = new Map();
  const historyById = new Map();
  for (const s of snapshots) {
    if (!historyById.has(s.reportId)) historyById.set(s.reportId, []);
    historyById.get(s.reportId).push(s);
    const cur = latestById.get(s.reportId);
    if (!cur || s.snapshotSeq > cur.snapshotSeq) latestById.set(s.reportId, s);
  }

  // Owner assignments made through the API (in-memory; see docs/ASSUMPTIONS.md)
  const ownerOverrides = new Map();

  function currentReport(reportId) {
    const l = latestById.get(reportId);
    if (!l) return null;
    const owner = ownerOverrides.has(reportId) ? ownerOverrides.get(reportId) : l.ownerEmail;
    const cost = costById.get(reportId) ?? null;
    return {
      reportId,
      reportName: l.reportName,
      ownerEmail: owner,
      isOrphaned: !owner,
      ownerAssignedViaApi: ownerOverrides.has(reportId),
      refreshStatus: l.refreshStatus,
      loadTimeSec: l.loadTimeSec,
      latencySeverity: l.latencySeverity,
      views: l.views,
      peakConcurrent: l.peakConcurrent,
      queryCount: l.queryCount,
      awsCostUsd: l.awsCostUsd,
      snapshotSeq: l.snapshotSeq,
      cost,
    };
  }

  return {
    snapshots,
    costRows,
    warehouses,
    creditPriceUsd,
    dqIssues,
    historyById,
    reportIds: [...latestById.keys()].sort(),
    currentReport,
    setOwner(reportId, email) {
      if (!latestById.has(reportId)) return null;
      ownerOverrides.set(reportId, email);
      return currentReport(reportId);
    },
    listCurrent() {
      return this.reportIds.map(currentReport);
    },
  };
}

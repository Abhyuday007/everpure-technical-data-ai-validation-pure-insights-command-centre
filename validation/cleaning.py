"""Data validation and cleaning for the Pure Insights report-monitoring dataset.

Used by notebooks/01_data_validation.ipynb and by the backend seeding step,
so the cleaning rules live in exactly one place.

Design rule: never silently drop rows. Bad values are flagged, and excluded
only from the specific calculation they would corrupt.
"""
import numpy as np
import pandas as pd

ORPHAN_TOKENS = {"nan", "ORPHANED_REPORT", ""}

# Alert thresholds. 15s comes from the case brief; the critical tier is my addition.
LATENCY_WARN_SEC = 15.0
LATENCY_CRIT_SEC = 30.0


def load_raw(path: str) -> pd.DataFrame:
    # keep_default_na=False so the literal strings "nan" / "ORPHANED_REPORT"
    # reach us untouched and we handle them explicitly.
    return pd.read_csv(path, keep_default_na=False)


def clean(raw: pd.DataFrame) -> pd.DataFrame:
    df = raw.copy()

    # Rows share report_ids (100 ids x 20 rows). No timestamp exists, so file
    # order is treated as snapshot order. This is an assumption, documented in the notebook.
    df["snapshot_seq"] = df.groupby("report_id").cumcount() + 1

    # 1. Orphaned reports: two different encodings of "no owner".
    owner = df["owner_email"].astype(str).str.strip()
    df["orphan_reason"] = np.select(
        [owner.eq("nan"), owner.eq("ORPHANED_REPORT"), owner.eq("")],
        ["missing_owner_nan", "flagged_orphaned", "missing_owner_blank"],
        default="",
    )
    df["is_orphaned"] = df["orphan_reason"].ne("")
    df["owner_email_clean"] = owner.where(~df["is_orphaned"], np.nan)

    # 2. Negative Snowflake credits: physically impossible. Keep the row,
    # blank the value so it cannot enter any cost sum.
    df["credits_invalid"] = df["snowflake_credits_consumed"] < 0
    df["credits_clean"] = df["snowflake_credits_consumed"].where(~df["credits_invalid"])

    # 3. Refresh status: UNKNOWN is its own state, never counted as success.
    df["status_unknown"] = df["last_refresh_status"].eq("UNKNOWN")
    df["refresh_failed"] = df["last_refresh_status"].isin(["FAILED", "TIMED_OUT"])

    # 4. Latency severity tiers for alerting.
    df["latency_severity"] = pd.cut(
        df["avg_load_time_sec"],
        bins=[-np.inf, LATENCY_WARN_SEC, LATENCY_CRIT_SEC, np.inf],
        labels=["ok", "warning", "critical"],
    ).astype(str)

    # 5. Usage vs cost consistency.
    df["zero_views"] = df["monthly_active_views"].eq(0)
    # More concurrent users at peak than total monthly views is not plausible.
    df["peak_exceeds_views"] = df["concurrent_user_peak"] > df["monthly_active_views"]
    views = df["monthly_active_views"].replace(0, np.nan)  # avoid divide-by-zero
    df["aws_cost_per_view"] = df["aws_hosting_cost_usd"] / views
    df["credits_per_view"] = df["credits_clean"] / views
    return df


def build_issue_log(raw: pd.DataFrame, df: pd.DataFrame) -> pd.DataFrame:
    n = len(df)
    p95 = df["aws_cost_per_view"].quantile(0.95)
    rows = [
        ("Orphaned report (owner 'nan')", "owner_email", int((df.orphan_reason == "missing_owner_nan").sum()),
         "Flag is_orphaned, keep row, show in Orphaned Reports view"),
        ("Orphaned report ('ORPHANED_REPORT')", "owner_email", int((df.orphan_reason == "flagged_orphaned").sum()),
         "Same flag as above; two encodings of the same condition"),
        ("Negative Snowflake credits", "snowflake_credits_consumed", int(df.credits_invalid.sum()),
         "Keep row, null the value in credits_clean, exclude from cost sums"),
        ("Refresh status UNKNOWN", "last_refresh_status", int(df.status_unknown.sum()),
         "Own status; not counted as success or failure"),
        ("Load time 15-30s (warning tier)", "avg_load_time_sec", int((df.latency_severity == "warning").sum()),
         "Alert, severity=warning, with per-report cooldown"),
        ("Load time above 30s (critical)", "avg_load_time_sec", int((df.latency_severity == "critical").sum()),
         "Alert, severity=critical"),
        ("Zero monthly views", "monthly_active_views", int(df.zero_views.sum()),
         "Per-view metrics set to NULL (no divide-by-zero)"),
        ("Peak concurrent users > monthly views", "concurrent_user_peak", int(df.peak_exceeds_views.sum()),
         "Flag as suspicious; keep values"),
        (f"AWS cost per view above 95th percentile (> {p95:.2f} USD)", "aws_hosting_cost_usd",
         int((df.aws_cost_per_view > p95).sum()),
         "Flag as cost-vs-usage mismatch for review"),
        ("Report IDs repeated across rows", "report_id", int(raw.report_id.duplicated().sum()),
         "Not deleted: treated as snapshots (snapshot_seq). See notebook assumption."),
    ]
    log = pd.DataFrame(rows, columns=["issue", "column", "rows_affected", "action"])
    log["pct_of_rows"] = (log.rows_affected / n * 100).round(1)
    return log

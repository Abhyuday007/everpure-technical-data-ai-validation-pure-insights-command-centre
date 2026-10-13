"""Runs the SQL suite on DuckDB, prints each result, and exports the tables the
backend serves. Run from the project root:  python sql/run_all.py
"""
import pathlib, re, sys
import duckdb

ROOT = pathlib.Path(__file__).resolve().parents[1]
SQL_DIR = ROOT / "sql"
OUT = ROOT / "data"

con = duckdb.connect(":memory:")
import os
os.chdir(ROOT)  # scripts use paths relative to the project root

def statements(text):
    # strip full-line comments, split on ';' (no semicolons inside our strings)
    text = "\n".join(l for l in text.splitlines() if not l.strip().startswith("--"))
    return [s.strip() for s in text.split(";") if s.strip()]

for f in sorted(SQL_DIR.glob("0*.sql")):
    print(f"\n===== {f.name} =====")
    for stmt in statements(f.read_text()):
        res = con.execute(stmt)
        if stmt.lstrip().upper().startswith(("SELECT", "WITH")):
            df = res.fetchdf()
            print(df.head(12).to_string(index=False), "\n")

# ---- exports consumed by the backend ----
con.execute(f"COPY report_cost TO '{OUT/'cost_by_report.csv'}' (HEADER, DELIMITER ',')")
con.execute(f"""COPY (
    SELECT warehouse_name, ROUND(SUM(credits_used),2) AS credits
    FROM warehouse_metering_history GROUP BY 1 ORDER BY 1
) TO '{OUT/'cost_by_warehouse.csv'}' (HEADER, DELIMITER ',')""")
con.execute(f"COPY params TO '{OUT/'cost_params.csv'}' (HEADER, DELIMITER ',')")
print("\nexported data/cost_by_report.csv, cost_by_warehouse.csv, cost_params.csv")

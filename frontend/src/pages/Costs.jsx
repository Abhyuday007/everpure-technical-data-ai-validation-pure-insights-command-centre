import React, { useEffect, useState } from 'react';
import { api, fmt } from '../api.js';

export default function Costs() {
  const [sum, setSum] = useState(null);
  const [sort, setSort] = useState('totalCostUsd');
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => { api('/api/costs/summary').then(setSum).catch((e) => setErr(e.message)); }, []);
  useEffect(() => { api(`/api/costs/reports?sort=${sort}&limit=15`).then((r) => setRows(r.items)).catch((e) => setErr(e.message)); }, [sort]);

  if (err) return <div className="error">{err}</div>;
  if (!sum || !rows) return <div className="muted">Loading…</div>;
  const maxWh = Math.max(...sum.warehouses.map((w) => w.credits));

  return (
    <>
      <div className="kpis">
        <div className="kpi"><div className="kpi-label">Total cost</div><div className="kpi-value">{fmt.usd(sum.totalCostUsd)}</div><div className="kpi-hint">Snowflake + AWS</div></div>
        <div className="kpi"><div className="kpi-label">Snowflake</div><div className="kpi-value">{fmt.usd(sum.snowflakeCostUsd)}</div><div className="kpi-hint">{fmt.num(Math.round(sum.credits))} credits @ ${sum.creditPriceUsd.toFixed(2)}</div></div>
        <div className="kpi"><div className="kpi-label">AWS hosting</div><div className="kpi-value">{fmt.usd(sum.awsCostUsd)}</div></div>
        <div className="kpi"><div className="kpi-label">Cost per view</div><div className="kpi-value">${sum.costPerViewUsd.toFixed(2)}</div></div>
        <div className="kpi warn"><div className="kpi-label">Cost of orphaned reports</div><div className="kpi-value">{fmt.usd(sum.orphanedCostUsd)}</div><div className="kpi-hint">{Math.round((sum.orphanedCostUsd / sum.totalCostUsd) * 100)}% of total</div></div>
      </div>

      <section className="card">
        <h2>Metered credits by warehouse</h2>
        {sum.warehouses.map((w) => (
          <div key={w.warehouse} className="bar-row">
            <span className="bar-label">{w.warehouse}</span>
            <div className="bar"><div style={{ width: `${(w.credits / maxWh) * 100}%` }} /></div>
            <span className="bar-val">{fmt.num(Math.round(w.credits))}</span>
          </div>
        ))}
        <p className="muted small">
          Credits are split across reports by share of query execution time (SQL suite, script 03). Allocated credits reconcile exactly to metered credits.
        </p>
      </section>

      <div className="chips">
        <button className={sort === 'totalCostUsd' ? 'chip on' : 'chip'} onClick={() => setSort('totalCostUsd')}>Highest total cost</button>
        <button className={sort === 'totalCostPerView' ? 'chip on' : 'chip'} onClick={() => setSort('totalCostPerView')}>Highest cost per view</button>
      </div>
      <section className="card flush">
        <table>
          <thead><tr><th>Report</th><th>Owner</th><th>Views</th><th>Snowflake</th><th>AWS</th><th>Total</th><th>Per view</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.reportId}>
                <td>{r.reportId}<div className="muted small">{r.reportName}</div></td>
                <td>{r.isOrphaned ? <span className="pill warn">orphaned</span> : <span className="small">{r.ownerEmail}</span>}</td>
                <td>{fmt.num(r.totalViews)}</td>
                <td>{fmt.usd(r.snowflakeCostUsd)}</td>
                <td>{fmt.usd(r.awsCostUsd)}</td>
                <td>{fmt.usd(r.totalCostUsd)}</td>
                <td>${r.totalCostPerView?.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <p className="muted small">
        Costs cover all 20 snapshots per report, each treated as a 30-day period. The Snowflake price per credit is an assumption set in the SQL suite.
      </p>
    </>
  );
}

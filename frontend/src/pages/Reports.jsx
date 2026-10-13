import React, { useEffect, useState } from 'react';
import { api, fmt } from '../api.js';

const COLS = [
  ['reportId', 'Report'], ['refreshStatus', 'Refresh'], ['loadTimeSec', 'Load (s)'],
  ['views', 'Views'], ['totalCostUsd', 'Total cost'], ['totalCostPerView', 'Cost / view'],
];

function Spark({ values, warn }) {
  const w = 220; const h = 48; const max = Math.max(...values, warn + 5);
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * w},${h - (v / max) * h}`).join(' ');
  return (
    <svg width={w} height={h} role="img" aria-label="Load time history">
      <line x1="0" x2={w} y1={h - (warn / max) * h} y2={h - (warn / max) * h} stroke="var(--crit)" strokeDasharray="3 3" />
      <polyline points={pts} fill="none" stroke="var(--accent)" strokeWidth="2" />
    </svg>
  );
}

export default function Reports() {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [orphaned, setOrphaned] = useState('');
  const [sort, setSort] = useState('reportId');
  const [order, setOrder] = useState('asc');
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [detail, setDetail] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    const p = new URLSearchParams({ sort, order, page, pageSize: 15 });
    if (q) p.set('q', q); if (status) p.set('status', status); if (orphaned) p.set('orphaned', orphaned);
    const t = setTimeout(() => api(`/api/reports?${p}`).then(setData).catch((e) => setErr(e.message)), 200);
    return () => clearTimeout(t);
  }, [q, status, orphaned, sort, order, page]);

  const toggle = (c) => { if (sort === c) setOrder(order === 'asc' ? 'desc' : 'asc'); else { setSort(c); setOrder('desc'); } setPage(1); };
  const open = (id) => api(`/api/reports/${id}`).then(setDetail).catch((e) => setErr(e.message));
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <>
      <div className="filters">
        <input placeholder="Search id, name or owner" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
        <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
          <option value="">All refresh states</option>
          {['SUCCESS', 'FAILED', 'TIMED_OUT', 'UNKNOWN'].map((s) => <option key={s}>{s}</option>)}
        </select>
        <select value={orphaned} onChange={(e) => { setOrphaned(e.target.value); setPage(1); }}>
          <option value="">Owned + orphaned</option><option value="true">Orphaned only</option><option value="false">Owned only</option>
        </select>
        {data && <span className="muted small">{data.total} reports</span>}
      </div>
      {err && <div className="error">{err}</div>}
      <section className="card flush">
        <table>
          <thead>
            <tr>
              {COLS.map(([c, l]) => (
                <th key={c}><button className="th" onClick={() => toggle(c)}>{l}{sort === c ? (order === 'asc' ? ' ▲' : ' ▼') : ''}</button></th>
              ))}
              <th>Owner</th>
            </tr>
          </thead>
          <tbody>
            {data?.items.map((r) => (
              <tr key={r.reportId} className="click" onClick={() => open(r.reportId)}>
                <td>{r.reportId}<div className="muted small">{r.reportName}</div></td>
                <td><span className={`pill ${r.refreshStatus === 'SUCCESS' ? 'ok' : r.refreshStatus === 'FAILED' ? 'crit' : r.refreshStatus === 'TIMED_OUT' ? 'warn' : ''}`}>{r.refreshStatus}</span></td>
                <td className={r.loadTimeSec > 30 ? 'crit-text' : r.loadTimeSec > 15 ? 'warn-text' : ''}>{r.loadTimeSec}</td>
                <td>{fmt.num(r.views)}</td>
                <td>{fmt.usd(r.cost?.totalCostUsd)}</td>
                <td>{r.cost?.totalCostPerView == null ? '–' : `$${r.cost.totalCostPerView.toFixed(2)}`}</td>
                <td>{r.isOrphaned ? <span className="pill warn">orphaned</span> : <span className="small">{r.ownerEmail}</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <div className="pager">
        <button disabled={page <= 1} onClick={() => setPage(page - 1)}>Prev</button>
        <span className="muted small">Page {page} of {pages}</span>
        <button disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</button>
      </div>

      {detail && (
        <div className="drawer" role="dialog" aria-label="Report detail">
          <button className="link close" onClick={() => setDetail(null)}>Close</button>
          <h2>{detail.reportId}</h2>
          <div className="muted">{detail.reportName}</div>
          <h3>Load time across {detail.history.length} snapshots</h3>
          <Spark values={detail.history.map((h) => h.loadTimeSec)} warn={15} />
          <p className="muted small">Dashed line = 15s alert threshold. Snapshot order is file order (no timestamps in the source).</p>
          <h3>Cost</h3>
          {detail.cost ? (
            <dl>
              <dt>Total</dt><dd>{fmt.usd(detail.cost.totalCostUsd)}</dd>
              <dt>Snowflake</dt><dd>{fmt.usd(detail.cost.snowflakeCostUsd)}</dd>
              <dt>AWS hosting</dt><dd>{fmt.usd(detail.cost.awsCostUsd)}</dd>
              <dt>Per view</dt><dd>{detail.cost.totalCostPerView == null ? '–' : `$${detail.cost.totalCostPerView.toFixed(2)}`}</dd>
            </dl>
          ) : <p className="muted">No cost data.</p>}
          <h3>Owner</h3>
          <p>{detail.isOrphaned ? 'No owner (orphaned)' : detail.ownerEmail}</p>
        </div>
      )}
    </>
  );
}

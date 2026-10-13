import React, { useEffect, useState, useCallback } from 'react';
import { api, fmt } from '../api.js';

function Row({ r, canAssign, onDone }) {
  const [email, setEmail] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const assign = async () => {
    setBusy(true); setErr('');
    try { await api(`/api/reports/${r.reportId}/owner`, { method: 'PATCH', body: { ownerEmail: email } }); onDone(); }
    catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <tr>
      <td>{r.reportId}<div className="muted small">{r.reportName}</div></td>
      <td>{r.refreshStatus}</td>
      <td>{fmt.num(r.views)}</td>
      <td>{fmt.usd(r.cost?.totalCostUsd)}</td>
      <td>
        {canAssign ? (
          <div className="assign">
            <input placeholder="owner@company.com" value={email} onChange={(e) => setEmail(e.target.value)} aria-label={`Owner for ${r.reportId}`} />
            <button disabled={busy || !email} onClick={assign}>Assign</button>
            {err && <div className="error small">{err}</div>}
          </div>
        ) : <span className="muted small">Admin can assign</span>}
      </td>
    </tr>
  );
}

export default function Orphans({ user }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const load = useCallback(() => api('/api/reports/orphaned').then(setData).catch((e) => setErr(e.message)), []);
  useEffect(() => { load(); }, [load]);

  if (err) return <div className="error">{err}</div>;
  if (!data) return <div className="muted">Loading…</div>;
  const spend = data.items.reduce((s, r) => s + (r.cost?.totalCostUsd ?? 0), 0);

  return (
    <>
      <p>
        <b>{data.count}</b> reports have no owner in their latest snapshot, accounting for <b>{fmt.usd(spend)}</b> of spend.
        Nobody is accountable for these. They are listed by cost, highest first.
      </p>
      <section className="card flush">
        <table>
          <thead><tr><th>Report</th><th>Refresh</th><th>Views</th><th>Total cost</th><th>Assign owner</th></tr></thead>
          <tbody>{data.items.map((r) => <Row key={r.reportId} r={r} canAssign={user.role === 'admin'} onDone={load} />)}</tbody>
        </table>
      </section>
      <p className="muted small">Assignments are held in server memory for this demo and reset on restart.</p>
    </>
  );
}

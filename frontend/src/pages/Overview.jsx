import React, { useEffect, useState } from 'react';
import { api } from '../api.js';

const STATUS_COLORS = { SUCCESS: 'var(--ok)', FAILED: 'var(--crit)', TIMED_OUT: 'var(--warn)', UNKNOWN: 'var(--muted-bar)' };

function Kpi({ label, value, hint, tone }) {
  return (
    <div className={`kpi ${tone ?? ''}`}>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
      {hint && <div className="kpi-hint">{hint}</div>}
    </div>
  );
}

export default function Overview({ live }) {
  const [s, setS] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    const load = () => api('/api/health/summary').then(setS).catch((e) => setErr(e.message));
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, []);

  if (err) return <div className="error">{err}</div>;
  if (!s) return <div className="muted">Loading…</div>;

  const total = s.reports;
  const failed = (s.refreshStatus.FAILED ?? 0) + (s.refreshStatus.TIMED_OUT ?? 0);

  return (
    <>
      <div className="kpis">
        <Kpi label="Reports monitored" value={s.reports} hint="latest snapshot of each" />
        <Kpi label="Avg load time" value={`${s.avgLoadTimeSec}s`} hint={`${s.slowReports} over ${s.thresholds.warnSec}s`} tone={s.avgLoadTimeSec > s.thresholds.warnSec ? 'warn' : ''} />
        <Kpi label="Failed or timed-out refresh" value={failed} hint={`${Math.round((failed / total) * 100)}% of reports`} tone={failed ? 'crit' : ''} />
        <Kpi label="Orphaned reports" value={s.orphanedReports} hint="no owner assigned" tone={s.orphanedReports ? 'warn' : ''} />
        <Kpi label="Open alerts" value={live.alerts.filter((a) => !a.acknowledged).length} hint={`${s.alerts.raised} raised · ${s.alerts.suppressed} suppressed`} />
      </div>

      <section className="card">
        <h2>Refresh status</h2>
        <div className="stack" role="img" aria-label="Refresh status distribution">
          {Object.entries(s.refreshStatus).map(([k, v]) => (
            <div key={k} style={{ width: `${(v / total) * 100}%`, background: STATUS_COLORS[k] }} title={`${k}: ${v}`} />
          ))}
        </div>
        <div className="legend">
          {Object.entries(s.refreshStatus).map(([k, v]) => (
            <span key={k}><i style={{ background: STATUS_COLORS[k] }} />{k.replace('_', ' ')} <b>{v}</b></span>
          ))}
        </div>
        <p className="muted small">UNKNOWN means the refresh outcome could not be determined. It is shown separately and never counted as success.</p>
      </section>

      <section className="card">
        <h2>Latency</h2>
        <p>
          <b>{s.slowReports}</b> of {total} reports currently load slower than {s.thresholds.warnSec}s,
          and <b>{s.criticalSlowReports}</b> slower than {s.thresholds.critSec}s (critical).
        </p>
        <p className="muted small">
          Because so many reports are slow, alerts use two severity tiers and a per-report cooldown so the feed stays readable.
        </p>
      </section>

      {live.lastEvent && (
        <section className="card ticker">
          <span className="muted small">Latest telemetry</span>
          <span>{live.lastEvent.reportId} · {live.lastEvent.loadTimeSec}s · {live.lastEvent.refreshStatus}</span>
        </section>
      )}
    </>
  );
}

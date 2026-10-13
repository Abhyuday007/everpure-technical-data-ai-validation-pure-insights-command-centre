import React, { useState } from 'react';
import { api, fmt } from '../api.js';

export default function Alerts({ live, user }) {
  const [filter, setFilter] = useState('all');
  const [err, setErr] = useState('');
  const canAck = user.role !== 'viewer';
  const isAdmin = user.role === 'admin';
  const sim = live.simulator;

  const list = live.alerts.filter((a) => (filter === 'all' ? true : filter === 'open' ? !a.acknowledged : a.severity === filter));

  const ack = (id) => api(`/api/alerts/${id}/ack`, { method: 'POST' }).catch((e) => setErr(e.message));
  const control = (action) => api(`/api/simulator/${action}`, { method: 'POST', body: action === 'start' ? { intervalMs: 300 } : undefined }).catch((e) => setErr(e.message));

  return (
    <>
      <section className="card row">
        <div>
          <b>Telemetry simulator</b>{' '}
          <span className={sim?.running ? 'pill ok' : 'pill'}>{sim?.running ? 'running' : 'stopped'}</span>
          <div className="muted small">
            Replays the dataset as live events (no timestamps exist in the source, so this is a replay, not real monitoring).
            {` ${fmt.num(live.eventsSeen)} events received this session.`}
          </div>
        </div>
        {isAdmin ? (
          <div className="actions">
            <button className="primary" disabled={sim?.running} onClick={() => control('start')}>Start</button>
            <button disabled={!sim?.running} onClick={() => control('stop')}>Stop</button>
          </div>
        ) : <span className="muted small">Admin only</span>}
      </section>

      {err && <div className="error">{err}</div>}

      <div className="chips">
        {['all', 'open', 'critical', 'warning'].map((f) => (
          <button key={f} className={filter === f ? 'chip on' : 'chip'} onClick={() => setFilter(f)}>{f}</button>
        ))}
      </div>

      <section className="card flush">
        <table>
          <thead><tr><th>Time</th><th>Severity</th><th>Report</th><th>Rule</th><th>Detail</th><th /></tr></thead>
          <tbody>
            {list.length === 0 && <tr><td colSpan="6" className="muted empty">No alerts yet. {isAdmin ? 'Start the simulator to generate live events.' : 'Waiting for events.'}</td></tr>}
            {list.map((a) => (
              <tr key={a.id} className={a.acknowledged ? 'dim' : ''}>
                <td className="nowrap">{fmt.time(a.ts)}</td>
                <td><span className={`pill ${a.severity === 'critical' ? 'crit' : 'warn'}`}>{a.severity}</span></td>
                <td>{a.reportId}<div className="muted small">{a.reportName}</div></td>
                <td>{a.rule}</td>
                <td>{a.message}</td>
                <td className="right">
                  {a.acknowledged ? <span className="muted small">acked by {a.acknowledgedBy}</span>
                    : canAck ? <button onClick={() => ack(a.id)}>Acknowledge</button> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}

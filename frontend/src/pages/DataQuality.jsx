import React, { useEffect, useState } from 'react';
import { api } from '../api.js';

export default function DataQuality() {
  const [items, setItems] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => { api('/api/dq/issues').then((r) => setItems(r.items)).catch((e) => setErr(e.message)); }, []);
  if (err) return <div className="error">{err}</div>;
  if (!items) return <div className="muted">Loading…</div>;

  return (
    <>
      <p>
        Issues found while validating the source file and what was done about each. Rows are flagged, not deleted, and bad values are
        excluded only from the calculation they would corrupt. Full reasoning is in <code>notebooks/01_data_validation.ipynb</code>.
      </p>
      <section className="card flush">
        <table>
          <thead><tr><th>Issue</th><th>Column</th><th className="right">Rows</th><th className="right">% of rows</th><th>Handling</th></tr></thead>
          <tbody>
            {items.map((i) => (
              <tr key={i.issue}>
                <td>{i.issue}</td>
                <td><code>{i.column}</code></td>
                <td className="right">{i.rowsAffected.toLocaleString()}</td>
                <td className="right">{i.pctOfRows}%</td>
                <td className="small">{i.action}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}

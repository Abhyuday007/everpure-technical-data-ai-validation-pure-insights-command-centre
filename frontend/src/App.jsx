import React, { useEffect, useState } from 'react';
import { api, tokenStore } from './api.js';
import { useLive } from './useLive.js';
import Login from './pages/Login.jsx';
import Overview from './pages/Overview.jsx';
import Alerts from './pages/Alerts.jsx';
import Reports from './pages/Reports.jsx';
import Orphans from './pages/Orphans.jsx';
import Costs from './pages/Costs.jsx';
import DataQuality from './pages/DataQuality.jsx';

// which pages each role may see (the server enforces the same rules)
const PAGES = [
  { id: 'overview', label: 'Overview', roles: ['viewer', 'analyst', 'admin'] },
  { id: 'alerts', label: 'Live alerts', roles: ['viewer', 'analyst', 'admin'] },
  { id: 'reports', label: 'Reports', roles: ['analyst', 'admin'] },
  { id: 'orphans', label: 'Orphaned reports', roles: ['analyst', 'admin'] },
  { id: 'costs', label: 'Cost allocation', roles: ['analyst', 'admin'] },
  { id: 'dq', label: 'Data quality', roles: ['analyst', 'admin'] },
];

export default function App() {
  const [user, setUser] = useState(null);
  const [booting, setBooting] = useState(true);
  const [page, setPage] = useState('overview');

  useEffect(() => {
    if (!tokenStore.get()) { setBooting(false); return; }
    api('/api/auth/me').then((r) => setUser(r.user)).catch(() => tokenStore.clear()).finally(() => setBooting(false));
  }, []);

  const live = useLive(Boolean(user));

  if (booting) return <div className="center muted">Loading…</div>;
  if (!user) return <Login onLogin={(u) => { setUser(u); setPage('overview'); }} />;

  const visible = PAGES.filter((p) => p.roles.includes(user.role));
  const openAlerts = live.alerts.filter((a) => !a.acknowledged).length;
  const logout = () => { tokenStore.clear(); setUser(null); };

  return (
    <div className="shell">
      <aside className="side">
        <div className="brand">Pure Insights<span>Command Centre</span></div>
        <nav>
          {visible.map((p) => (
            <button key={p.id} className={page === p.id ? 'nav active' : 'nav'} onClick={() => setPage(p.id)}>
              {p.label}
              {p.id === 'alerts' && openAlerts > 0 && <b className="pill crit">{openAlerts > 99 ? '99+' : openAlerts}</b>}
            </button>
          ))}
        </nav>
        <div className="who">
          <div className="name">{user.name}</div>
          <div className="muted small">{user.email}</div>
          <span className={`role role-${user.role}`}>{user.role}</span>
          <button className="link" onClick={logout}>Sign out</button>
        </div>
      </aside>

      <main className="main">
        <header className="top">
          <h1>{visible.find((p) => p.id === page)?.label}</h1>
          <div className={live.connected ? 'conn on' : 'conn off'} title="WebSocket connection">
            <i /> {live.connected ? 'Live' : 'Reconnecting…'}
          </div>
        </header>

        {page === 'overview' && <Overview live={live} />}
        {page === 'alerts' && <Alerts live={live} user={user} />}
        {page === 'reports' && <Reports />}
        {page === 'orphans' && <Orphans user={user} />}
        {page === 'costs' && <Costs />}
        {page === 'dq' && <DataQuality />}
      </main>

      <div className="toasts" aria-live="polite">
        {live.toasts.map((t) => (
          <div key={t.id} className="toast" onClick={() => live.dismissToast(t.id)}>
            <b>Critical</b> {t.reportId}: {t.message}
          </div>
        ))}
      </div>
    </div>
  );
}

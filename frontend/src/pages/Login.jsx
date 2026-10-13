import React, { useState } from 'react';
import { api, tokenStore } from '../api.js';

const DEMO = [
  ['admin', 'admin@pureinsights.local', 'Admin#123'],
  ['analyst', 'analyst@pureinsights.local', 'Analyst#123'],
  ['viewer', 'viewer@pureinsights.local', 'Viewer#123'],
];

export default function Login({ onLogin }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const r = await api('/api/auth/login', { method: 'POST', body: { email, password } });
      tokenStore.set(r.token);
      onLogin(r.user);
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  return (
    <div className="center">
      <form className="card login" onSubmit={submit}>
        <h1>Pure Insights<br /><span className="muted">Command Centre</span></h1>
        <label>Email<input value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required /></label>
        <label>Password<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required /></label>
        {error && <div className="error" role="alert">{error}</div>}
        <button className="primary" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        <div className="demo">
          <div className="muted small">Demo accounts (click to fill)</div>
          {DEMO.map(([role, e, p]) => (
            <button type="button" key={role} className="link" onClick={() => { setEmail(e); setPassword(p); }}>{role}</button>
          ))}
        </div>
      </form>
    </div>
  );
}

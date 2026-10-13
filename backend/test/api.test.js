import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { buildServer } from '../src/app.js';

let srv, base, wsBase;
const tokens = {};
const creds = {
  admin: ['admin@pureinsights.local', 'Admin#123'],
  analyst: ['analyst@pureinsights.local', 'Analyst#123'],
  viewer: ['viewer@pureinsights.local', 'Viewer#123'],
};
const call = (path, { method = 'GET', role, body } = {}) =>
  fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', ...(role ? { authorization: `Bearer ${tokens[role]}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });

before(async () => {
  srv = buildServer({ simIntervalMs: 50, alertCooldownMs: 60_000 });
  await new Promise((r) => srv.server.listen(0, r));
  const port = srv.server.address().port;
  base = `http://localhost:${port}`;
  wsBase = `ws://localhost:${port}`;
  for (const [role, [email, password]] of Object.entries(creds)) {
    tokens[role] = (await (await call('/api/auth/login', { method: 'POST', body: { email, password } })).json()).token;
  }
});
after(() => srv.close());

test('login rejects wrong password and accepts the right one', async () => {
  assert.equal((await call('/api/auth/login', { method: 'POST', body: { email: creds.admin[0], password: 'nope' } })).status, 401);
  assert.ok(tokens.admin);
});

test('every /api route except login and healthz needs a token', async () => {
  assert.equal((await call('/api/healthz')).status, 200);
  assert.equal((await call('/api/health/summary')).status, 401);
  assert.equal((await call('/api/reports')).status, 401);
});

test('RBAC matrix: viewer / analyst / admin', async () => {
  const cases = [
    ['/api/health/summary', 'GET', { viewer: 200, analyst: 200, admin: 200 }],
    ['/api/alerts',         'GET', { viewer: 200, analyst: 200, admin: 200 }],
    ['/api/reports',        'GET', { viewer: 403, analyst: 200, admin: 200 }],
    ['/api/reports/orphaned','GET', { viewer: 403, analyst: 200, admin: 200 }],
    ['/api/costs/summary',  'GET', { viewer: 403, analyst: 200, admin: 200 }],
    ['/api/dq/issues',      'GET', { viewer: 403, analyst: 200, admin: 200 }],
    ['/api/simulator/start','POST',{ viewer: 403, analyst: 403, admin: 200 }],
    ['/api/simulator/stop', 'POST',{ viewer: 403, analyst: 403, admin: 200 }],
  ];
  for (const [path, method, expect] of cases) {
    for (const [role, status] of Object.entries(expect)) {
      const r = await call(path, { method, role, body: method === 'POST' ? {} : undefined });
      assert.equal(r.status, status, `${role} ${method} ${path}`);
    }
  }
});

test('only admin can assign an owner, and it removes the report from orphaned', async () => {
  const orphans = await (await call('/api/reports/orphaned', { role: 'analyst' })).json();
  assert.ok(orphans.count > 0);
  const id = orphans.items[0].reportId;
  assert.equal((await call(`/api/reports/${id}/owner`, { method: 'PATCH', role: 'analyst', body: { ownerEmail: 'a@b.co' } })).status, 403);
  assert.equal((await call(`/api/reports/${id}/owner`, { method: 'PATCH', role: 'admin', body: { ownerEmail: 'not-an-email' } })).status, 400);
  assert.equal((await call(`/api/reports/${id}/owner`, { method: 'PATCH', role: 'admin', body: { ownerEmail: 'new.owner@company.com' } })).status, 200);
  const after = await (await call('/api/reports/orphaned', { role: 'analyst' })).json();
  assert.equal(after.count, orphans.count - 1);
});

test('reports list: filtering, sorting, pagination and input validation', async () => {
  const r = await (await call('/api/reports?status=FAILED&sort=totalCostUsd&order=desc&pageSize=5', { role: 'analyst' })).json();
  assert.ok(r.items.every((x) => x.refreshStatus === 'FAILED'));
  assert.ok(r.items.length <= 5);
  const costs = r.items.map((x) => x.cost.totalCostUsd);
  assert.deepEqual(costs, [...costs].sort((a, b) => b - a));
  assert.equal((await call('/api/reports?sort=__proto__', { role: 'analyst' })).status, 400);
  assert.equal((await call('/api/reports/NOPE', { role: 'analyst' })).status, 404);
});

test('cost summary is consistent with the SQL-suite output', async () => {
  const s = await (await call('/api/costs/summary', { role: 'analyst' })).json();
  assert.equal(s.reports, 100);
  assert.ok(Math.abs(s.snowflakeCostUsd + s.awsCostUsd - s.totalCostUsd) < 1);
  // attributed credits must equal metered credits (reconciliation done in 03_credit_attribution.sql)
  const metered = s.warehouses.reduce((a, w) => a + w.credits, 0);
  assert.ok(Math.abs(metered - s.credits) < 1, `metered ${metered} vs attributed ${s.credits}`);
});

test('WebSocket: rejects bad token, delivers alerts live, ack is broadcast', async () => {
  // bad token -> upgrade refused
  await new Promise((resolve) => {
    const bad = new WebSocket(`${wsBase}/ws?token=garbage`);
    bad.on('unexpected-response', (_req, res) => { assert.equal(res.statusCode, 401); resolve(); });
    bad.on('error', () => {});
  });

  const ws = new WebSocket(`${wsBase}/ws?token=${tokens.viewer}`);
  const seen = [];
  ws.on('message', (m) => seen.push(JSON.parse(m)));
  await new Promise((r) => ws.on('open', r));

  await call('/api/simulator/start', { method: 'POST', role: 'admin', body: { intervalMs: 50 } });
  const deadline = Date.now() + 5000;
  while (!seen.some((m) => m.type === 'alert') && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
  await call('/api/simulator/stop', { method: 'POST', role: 'admin' });

  assert.equal(seen[0].type, 'hello');
  assert.ok(seen.some((m) => m.type === 'telemetry'), 'telemetry received');
  const alert = seen.find((m) => m.type === 'alert')?.data;
  assert.ok(alert, 'alert received over WebSocket');
  assert.ok(['warning', 'critical'].includes(alert.severity));

  // acknowledge as analyst, viewer socket should see the broadcast
  const acked = new Promise((resolve) => ws.on('message', (m) => { const j = JSON.parse(m); if (j.type === 'alert_ack') resolve(j.data); }));
  assert.equal((await call(`/api/alerts/${alert.id}/ack`, { method: 'POST', role: 'viewer' })).status, 403);
  assert.equal((await call(`/api/alerts/${alert.id}/ack`, { method: 'POST', role: 'analyst' })).status, 200);
  assert.equal((await acked).id, alert.id);
  ws.close();
});

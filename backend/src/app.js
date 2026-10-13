import http from 'node:http';
import express from 'express';
import cors from 'cors';
import { WebSocketServer } from 'ws';
import { config } from './config.js';
import { loadStore } from './data.js';
import { AlertEngine } from './alertEngine.js';
import { Simulator } from './simulator.js';
import { authenticate, requireRole, login, verifyToken } from './auth.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SORTABLE = {
  reportId: (r) => r.reportId,
  views: (r) => r.views,
  loadTimeSec: (r) => r.loadTimeSec,
  totalCostUsd: (r) => r.cost?.totalCostUsd ?? -1,
  totalCostPerView: (r) => r.cost?.totalCostPerView ?? -1,
  refreshStatus: (r) => r.refreshStatus,
};

export function buildServer(overrides = {}) {
  const cfg = { ...config, ...overrides };
  const store = loadStore(cfg.dataDir);
  const engine = new AlertEngine({ warnSec: cfg.latencyWarnSec, critSec: cfg.latencyCritSec, cooldownMs: cfg.alertCooldownMs });
  const alerts = [];                       // newest first, capped
  const clients = new Set();

  const broadcast = (msg) => {
    const data = JSON.stringify(msg);
    for (const ws of clients) if (ws.readyState === 1) ws.send(data);
  };

  const simulator = new Simulator({
    rows: store.snapshots,
    intervalMs: cfg.simIntervalMs,
    onEvent: (row) => {
      broadcast({ type: 'telemetry', data: { reportId: row.reportId, reportName: row.reportName, loadTimeSec: row.loadTimeSec, refreshStatus: row.refreshStatus, ts: new Date().toISOString() } });
      const { alerts: raised } = engine.evaluate(row);
      for (const a of raised) {
        alerts.unshift(a);
        if (alerts.length > cfg.maxAlertsKept) alerts.pop();
        broadcast({ type: 'alert', data: a });
      }
    },
  });

  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '10kb' }));

  app.get('/api/healthz', (_req, res) => res.json({ status: 'ok' }));

  // ---- auth -----------------------------------------------------------------
  app.post('/api/auth/login', (req, res) => {
    const result = login(req.body?.email, req.body?.password);
    if (!result) return res.status(401).json({ error: 'invalid_credentials', message: 'Wrong email or password' });
    res.json(result);
  });
  app.get('/api/auth/me', authenticate, (req, res) => res.json({ user: req.user }));

  // everything below needs a valid token
  app.use('/api', authenticate);

  const analyst = requireRole('analyst', 'admin');
  const admin = requireRole('admin');

  // ---- health (all roles) -----------------------------------------------------
  app.get('/api/health/summary', (_req, res) => {
    const current = store.listCurrent();
    const byStatus = {};
    for (const r of current) byStatus[r.refreshStatus] = (byStatus[r.refreshStatus] ?? 0) + 1;
    const avg = current.reduce((s, r) => s + r.loadTimeSec, 0) / current.length;
    res.json({
      reports: current.length,
      refreshStatus: byStatus,
      orphanedReports: current.filter((r) => r.isOrphaned).length,
      avgLoadTimeSec: Number(avg.toFixed(1)),
      slowReports: current.filter((r) => r.loadTimeSec > cfg.latencyWarnSec).length,
      criticalSlowReports: current.filter((r) => r.loadTimeSec > cfg.latencyCritSec).length,
      thresholds: { warnSec: cfg.latencyWarnSec, critSec: cfg.latencyCritSec },
      alerts: {
        open: alerts.filter((a) => !a.acknowledged).length,
        openCritical: alerts.filter((a) => !a.acknowledged && a.severity === 'critical').length,
        ...engine.stats,
      },
      simulator: simulator.status(),
    });
  });

  // ---- reports (analyst, admin) -----------------------------------------------
  app.get('/api/reports/orphaned', analyst, (_req, res) => {
    const list = store.listCurrent().filter((r) => r.isOrphaned)
      .sort((a, b) => (b.cost?.totalCostUsd ?? 0) - (a.cost?.totalCostUsd ?? 0));
    res.json({ count: list.length, items: list });
  });

  app.get('/api/reports', analyst, (req, res) => {
    const { status, orphaned, latency, q, sort = 'reportId', order = 'asc' } = req.query;
    const page = Math.max(1, Number(req.query.page ?? 1));
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize ?? 25)));
    if (!Object.hasOwn(SORTABLE, sort)) return res.status(400).json({ error: 'bad_request', message: `sort must be one of ${Object.keys(SORTABLE).join(', ')}` });

    let list = store.listCurrent();
    if (status) list = list.filter((r) => r.refreshStatus === String(status).toUpperCase());
    if (orphaned === 'true') list = list.filter((r) => r.isOrphaned);
    if (orphaned === 'false') list = list.filter((r) => !r.isOrphaned);
    if (latency) list = list.filter((r) => r.latencySeverity === latency);
    if (q) {
      const needle = String(q).toLowerCase();
      list = list.filter((r) => `${r.reportId} ${r.reportName} ${r.ownerEmail ?? ''}`.toLowerCase().includes(needle));
    }
    const key = SORTABLE[sort];
    const dir = order === 'desc' ? -1 : 1;
    list.sort((a, b) => (key(a) > key(b) ? 1 : key(a) < key(b) ? -1 : 0) * dir);

    res.json({ total: list.length, page, pageSize, items: list.slice((page - 1) * pageSize, page * pageSize) });
  });

  app.get('/api/reports/:id', analyst, (req, res) => {
    const report = store.currentReport(req.params.id);
    if (!report) return res.status(404).json({ error: 'not_found', message: 'No such report' });
    res.json({ ...report, history: store.historyById.get(req.params.id) });
  });

  app.patch('/api/reports/:id/owner', admin, (req, res) => {
    const email = String(req.body?.ownerEmail ?? '').trim().toLowerCase();
    if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'bad_request', message: 'ownerEmail must be a valid email address' });
    const updated = store.setOwner(req.params.id, email);
    if (!updated) return res.status(404).json({ error: 'not_found', message: 'No such report' });
    broadcast({ type: 'owner_assigned', data: { reportId: updated.reportId, ownerEmail: email, by: req.user.email } });
    res.json(updated);
  });

  // ---- costs (analyst, admin) -------------------------------------------------
  app.get('/api/costs/summary', analyst, (_req, res) => {
    const rows = store.costRows;
    const sum = (f) => rows.reduce((s, r) => s + (r[f] ?? 0), 0);
    const totalViews = sum('totalViews');
    const totalCost = sum('totalCostUsd');
    const orphanCost = store.listCurrent().filter((r) => r.isOrphaned).reduce((s, r) => s + (r.cost?.totalCostUsd ?? 0), 0);
    res.json({
      creditPriceUsd: store.creditPriceUsd,
      reports: rows.length,
      credits: Number(sum('creditsAttributed').toFixed(2)),
      snowflakeCostUsd: Number(sum('snowflakeCostUsd').toFixed(2)),
      awsCostUsd: Number(sum('awsCostUsd').toFixed(2)),
      totalCostUsd: Number(totalCost.toFixed(2)),
      costPerViewUsd: Number((totalCost / totalViews).toFixed(4)),
      orphanedCostUsd: Number(orphanCost.toFixed(2)),
      warehouses: store.warehouses,
    });
  });

  app.get('/api/costs/reports', analyst, (req, res) => {
    const sort = ['totalCostUsd', 'totalCostPerView', 'totalViews'].includes(req.query.sort) ? req.query.sort : 'totalCostUsd';
    const limit = Math.min(200, Math.max(1, Number(req.query.limit ?? 20)));
    const names = new Map(store.listCurrent().map((r) => [r.reportId, r]));
    const items = store.costRows
      .filter((c) => c[sort] !== null)
      .sort((a, b) => b[sort] - a[sort])
      .slice(0, limit)
      .map((c) => ({ ...c, reportName: names.get(c.reportId)?.reportName, ownerEmail: names.get(c.reportId)?.ownerEmail, isOrphaned: names.get(c.reportId)?.isOrphaned }));
    res.json({ sort, items });
  });

  // ---- alerts -----------------------------------------------------------------
  app.get('/api/alerts', (req, res) => {
    const limit = Math.min(200, Math.max(1, Number(req.query.limit ?? 50)));
    let list = alerts;
    if (req.query.severity) list = list.filter((a) => a.severity === req.query.severity);
    if (req.query.acknowledged === 'true') list = list.filter((a) => a.acknowledged);
    if (req.query.acknowledged === 'false') list = list.filter((a) => !a.acknowledged);
    res.json({ total: list.length, items: list.slice(0, limit) });
  });

  app.post('/api/alerts/:id/ack', analyst, (req, res) => {
    const a = alerts.find((x) => x.id === req.params.id);
    if (!a) return res.status(404).json({ error: 'not_found', message: 'No such alert' });
    a.acknowledged = true;
    a.acknowledgedBy = req.user.email;
    broadcast({ type: 'alert_ack', data: { id: a.id, acknowledgedBy: a.acknowledgedBy } });
    res.json(a);
  });

  // ---- data quality (analyst, admin) -------------------------------------------
  app.get('/api/dq/issues', analyst, (_req, res) => res.json({ items: store.dqIssues }));

  // ---- simulator (admin) -------------------------------------------------------
  app.get('/api/simulator', (_req, res) => res.json(simulator.status()));
  app.post('/api/simulator/start', admin, (req, res) => {
    const ms = req.body?.intervalMs === undefined ? undefined : Number(req.body.intervalMs);
    if (ms !== undefined && (!Number.isFinite(ms) || ms < 50 || ms > 10_000)) {
      return res.status(400).json({ error: 'bad_request', message: 'intervalMs must be between 50 and 10000' });
    }
    const s = simulator.start(ms);
    broadcast({ type: 'simulator_status', data: s });
    res.json(s);
  });
  app.post('/api/simulator/stop', admin, (_req, res) => {
    const s = simulator.stop();
    broadcast({ type: 'simulator_status', data: s });
    res.json(s);
  });

  app.use((_req, res) => res.status(404).json({ error: 'not_found', message: 'Unknown route' }));
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    console.error(err);
    res.status(500).json({ error: 'internal', message: 'Unexpected server error' });
  });

  // ---- http + websocket -------------------------------------------------------
  const server = http.createServer(app);
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, 'http://localhost');
    const user = url.pathname === '/ws' ? verifyToken(url.searchParams.get('token') ?? '') : null;
    if (!user) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      return socket.destroy();
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      ws.user = user;
      clients.add(ws);
      ws.on('close', () => clients.delete(ws));
      ws.on('error', () => clients.delete(ws));
      ws.send(JSON.stringify({ type: 'hello', data: { user, simulator: simulator.status() } }));
    });
  });

  if (cfg.autoStartSimulator) simulator.start();

  return {
    server, app, simulator, engine, store,
    close: () => new Promise((resolve) => {
      simulator.stop();
      for (const ws of clients) ws.terminate();
      server.close(() => resolve());
    }),
  };
}

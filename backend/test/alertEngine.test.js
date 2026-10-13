import test from 'node:test';
import assert from 'node:assert/strict';
import { AlertEngine } from '../src/alertEngine.js';

const ev = (o = {}) => ({ reportId: 'RPT_1', reportName: 'R1', loadTimeSec: 5, refreshStatus: 'SUCCESS', ...o });
const engine = (o = {}) => { let t = 0; const e = new AlertEngine({ now: () => t, ...o }); e.advance = (ms) => { t += ms; }; return e; };

test('no alert at or below the 15s threshold', () => {
  const e = engine();
  assert.equal(e.evaluate(ev({ loadTimeSec: 15 })).alerts.length, 0);   // boundary is exclusive
  assert.equal(e.evaluate(ev({ loadTimeSec: 2 })).alerts.length, 0);
});

test('15s < latency <= 30s is a warning, > 30s is critical', () => {
  const e = engine();
  assert.equal(e.evaluate(ev({ reportId: 'A', loadTimeSec: 15.1 })).alerts[0].severity, 'warning');
  assert.equal(e.evaluate(ev({ reportId: 'B', loadTimeSec: 30 })).alerts[0].severity, 'warning');
  assert.equal(e.evaluate(ev({ reportId: 'C', loadTimeSec: 30.1 })).alerts[0].severity, 'critical');
});

test('FAILED refresh is critical, TIMED_OUT is warning, UNKNOWN and SUCCESS do not alert', () => {
  const e = engine();
  assert.equal(e.evaluate(ev({ reportId: 'A', refreshStatus: 'FAILED' })).alerts[0].severity, 'critical');
  assert.equal(e.evaluate(ev({ reportId: 'B', refreshStatus: 'TIMED_OUT' })).alerts[0].severity, 'warning');
  assert.equal(e.evaluate(ev({ reportId: 'C', refreshStatus: 'UNKNOWN' })).alerts.length, 0);
  assert.equal(e.evaluate(ev({ reportId: 'D', refreshStatus: 'SUCCESS' })).alerts.length, 0);
});

test('slow AND failed raises two separate alerts', () => {
  const e = engine();
  const { alerts } = e.evaluate(ev({ loadTimeSec: 44, refreshStatus: 'FAILED' }));
  assert.deepEqual(alerts.map((a) => a.rule).sort(), ['LATENCY', 'REFRESH']);
});

test('cooldown suppresses a repeat of the same report and rule', () => {
  const e = engine({ cooldownMs: 1000 });
  assert.equal(e.evaluate(ev({ loadTimeSec: 20 })).alerts.length, 1);
  e.advance(500);
  const second = e.evaluate(ev({ loadTimeSec: 21 }));
  assert.equal(second.alerts.length, 0);
  assert.equal(second.suppressed, 1);
  e.advance(600);                                                       // 1100ms after the first
  assert.equal(e.evaluate(ev({ loadTimeSec: 22 })).alerts.length, 1);
});

test('escalation warning -> critical bypasses the cooldown', () => {
  const e = engine({ cooldownMs: 10_000 });
  assert.equal(e.evaluate(ev({ loadTimeSec: 20 })).alerts.length, 1);
  e.advance(100);
  const esc = e.evaluate(ev({ loadTimeSec: 40 }));
  assert.equal(esc.alerts.length, 1);
  assert.equal(esc.alerts[0].severity, 'critical');
});

test('cooldown is per report and per rule', () => {
  const e = engine({ cooldownMs: 10_000 });
  e.evaluate(ev({ reportId: 'A', loadTimeSec: 20 }));
  assert.equal(e.evaluate(ev({ reportId: 'B', loadTimeSec: 20 })).alerts.length, 1);               // other report
  assert.equal(e.evaluate(ev({ reportId: 'A', loadTimeSec: 5, refreshStatus: 'FAILED' })).alerts.length, 1); // other rule
});

test('stats count evaluated, raised and suppressed', () => {
  const e = engine({ cooldownMs: 10_000 });
  e.evaluate(ev({ loadTimeSec: 20 }));
  e.evaluate(ev({ loadTimeSec: 20 }));
  assert.deepEqual(e.stats, { evaluated: 2, raised: 1, suppressed: 1 });
});

/**
 * Pure alert logic: no I/O, no timers, so it is fully unit-testable.
 *
 * Rules
 *   LATENCY  avg load time > warnSec  -> warning ; > critSec -> critical
 *   REFRESH  FAILED -> critical ; TIMED_OUT -> warning ; UNKNOWN / SUCCESS -> no alert
 *
 * Why tiers + cooldown: on this dataset ~75% of rows exceed 15s, so a flat rule
 * would alert on almost every event. After a (report, rule) alert fires, repeats
 * inside the cooldown window are suppressed UNLESS the severity escalates.
 */
const RANK = { warning: 1, critical: 2 };

export class AlertEngine {
  constructor({ warnSec = 15, critSec = 30, cooldownMs = 90_000, now = () => Date.now() } = {}) {
    this.warnSec = warnSec;
    this.critSec = critSec;
    this.cooldownMs = cooldownMs;
    this.now = now;
    this.last = new Map();           // `${reportId}|${rule}` -> { ts, severity }
    this.stats = { evaluated: 0, raised: 0, suppressed: 0 };
    this.seq = 0;
  }

  /** @returns {{ alerts: object[], suppressed: number }} */
  evaluate(ev) {
    this.stats.evaluated += 1;
    const candidates = [];

    if (typeof ev.loadTimeSec === 'number' && ev.loadTimeSec > this.warnSec) {
      const critical = ev.loadTimeSec > this.critSec;
      candidates.push({
        rule: 'LATENCY',
        severity: critical ? 'critical' : 'warning',
        value: ev.loadTimeSec,
        threshold: critical ? this.critSec : this.warnSec,
        message: `Load time ${ev.loadTimeSec}s exceeds ${critical ? this.critSec : this.warnSec}s`,
      });
    }
    if (ev.refreshStatus === 'FAILED' || ev.refreshStatus === 'TIMED_OUT') {
      candidates.push({
        rule: 'REFRESH',
        severity: ev.refreshStatus === 'FAILED' ? 'critical' : 'warning',
        value: ev.refreshStatus,
        threshold: null,
        message: `Scheduled refresh ${ev.refreshStatus === 'FAILED' ? 'failed' : 'timed out'}`,
      });
    }

    const ts = this.now();
    const alerts = [];
    let suppressed = 0;
    for (const c of candidates) {
      const key = `${ev.reportId}|${c.rule}`;
      const prev = this.last.get(key);
      const inCooldown = prev && ts - prev.ts < this.cooldownMs;
      const escalated = prev && RANK[c.severity] > RANK[prev.severity];
      if (inCooldown && !escalated) {
        suppressed += 1;
        continue;
      }
      this.last.set(key, { ts, severity: c.severity });
      this.seq += 1;
      alerts.push({
        id: `A${String(this.seq).padStart(6, '0')}`,
        ts: new Date(ts).toISOString(),
        reportId: ev.reportId,
        reportName: ev.reportName,
        ...c,
        acknowledged: false,
        acknowledgedBy: null,
      });
    }
    this.stats.raised += alerts.length;
    this.stats.suppressed += suppressed;
    return { alerts, suppressed };
  }
}

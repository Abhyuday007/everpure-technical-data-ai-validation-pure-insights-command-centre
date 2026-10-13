import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export const config = {
  port: Number(process.env.PORT ?? 4000),
  dataDir: process.env.DATA_DIR ?? path.resolve(here, '../../data'),
  jwtSecret: process.env.JWT_SECRET ?? 'dev-only-secret-change-me',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '8h',
  // Alert rules. 15s comes from the case brief; the critical tier is a design choice.
  latencyWarnSec: Number(process.env.LATENCY_WARN_SEC ?? 15),
  latencyCritSec: Number(process.env.LATENCY_CRIT_SEC ?? 30),
  // Same report + same rule will not alert again inside this window (unless severity escalates).
  alertCooldownMs: Number(process.env.ALERT_COOLDOWN_MS ?? 90_000),
  maxAlertsKept: Number(process.env.MAX_ALERTS_KEPT ?? 500),
  simIntervalMs: Number(process.env.SIM_INTERVAL_MS ?? 500),
  autoStartSimulator: (process.env.AUTO_START_SIM ?? 'false') === 'true',
};

export const usingDefaultSecret = !process.env.JWT_SECRET;

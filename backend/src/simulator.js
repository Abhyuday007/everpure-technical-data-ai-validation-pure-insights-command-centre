/**
 * Replays the dataset rows as if they were live telemetry events.
 * (The dataset has no timestamps, so this is a replay, not real monitoring.
 *  In production the same `onEvent` would be fed by Snowflake / BI-tool webhooks.)
 */
export class Simulator {
  constructor({ rows, intervalMs, onEvent }) {
    this.rows = rows;
    this.intervalMs = intervalMs;
    this.onEvent = onEvent;
    this.timer = null;
    this.index = 0;
    this.emitted = 0;
  }

  get running() {
    return this.timer !== null;
  }

  start(intervalMs) {
    if (intervalMs) this.intervalMs = intervalMs;
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => this.tick(), this.intervalMs);
    return this.status();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    return this.status();
  }

  tick() {
    const row = this.rows[this.index];
    this.index = (this.index + 1) % this.rows.length;   // loop forever
    this.emitted += 1;
    this.onEvent(row);
  }

  status() {
    return { running: this.running, intervalMs: this.intervalMs, emitted: this.emitted, position: this.index, total: this.rows.length };
  }
}

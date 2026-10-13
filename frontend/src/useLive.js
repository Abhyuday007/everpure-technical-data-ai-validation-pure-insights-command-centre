import { useEffect, useRef, useState, useCallback } from 'react';
import { api, tokenStore } from './api.js';

/**
 * Live feed: loads recent alerts over REST, then keeps them current over the
 * WebSocket. Reconnects with backoff. Exposes connection state so the UI never
 * silently shows stale data.
 */
export function useLive(enabled) {
  const [alerts, setAlerts] = useState([]);
  const [connected, setConnected] = useState(false);
  const [lastEvent, setLastEvent] = useState(null);
  const [simulator, setSimulator] = useState(null);
  const [toasts, setToasts] = useState([]);
  const [eventsSeen, setEventsSeen] = useState(0);
  const retry = useRef(0);

  const loadAlerts = useCallback(async () => {
    const { items } = await api('/api/alerts?limit=100');
    setAlerts(items);
  }, []);

  useEffect(() => {
    if (!enabled) return undefined;
    let ws; let timer; let closed = false;

    const connect = () => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      ws = new WebSocket(`${proto}://${location.host}/ws?token=${encodeURIComponent(tokenStore.get() ?? '')}`);
      ws.onopen = () => { retry.current = 0; setConnected(true); loadAlerts().catch(() => {}); };
      ws.onclose = () => {
        setConnected(false);
        if (closed) return;
        retry.current += 1;
        timer = setTimeout(connect, Math.min(10_000, 500 * 2 ** retry.current));
      };
      ws.onmessage = (m) => {
        const msg = JSON.parse(m.data);
        if (msg.type === 'hello') setSimulator(msg.data.simulator);
        if (msg.type === 'simulator_status') setSimulator(msg.data);
        if (msg.type === 'telemetry') { setLastEvent(msg.data); setEventsSeen((n) => n + 1); }
        if (msg.type === 'alert') {
          setAlerts((prev) => [msg.data, ...prev].slice(0, 200));
          if (msg.data.severity === 'critical') {
            const id = msg.data.id;
            setToasts((t) => [{ ...msg.data }, ...t].slice(0, 3));
            setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 6000);
          }
        }
        if (msg.type === 'alert_ack') {
          setAlerts((prev) => prev.map((a) => (a.id === msg.data.id ? { ...a, acknowledged: true, acknowledgedBy: msg.data.acknowledgedBy } : a)));
        }
      };
    };
    connect();
    return () => { closed = true; clearTimeout(timer); ws?.close(); };
  }, [enabled, loadAlerts]);

  return { alerts, connected, lastEvent, eventsSeen, simulator, toasts, dismissToast: (id) => setToasts((t) => t.filter((x) => x.id !== id)) };
}

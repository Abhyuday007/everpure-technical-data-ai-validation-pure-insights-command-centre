const TOKEN_KEY = 'pi_token';

export const tokenStore = {
  get: () => { try { return sessionStorage.getItem(TOKEN_KEY); } catch { return null; } },
  set: (t) => { try { sessionStorage.setItem(TOKEN_KEY, t); } catch { /* storage unavailable */ } },
  clear: () => { try { sessionStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ } },
};

export async function api(path, { method = 'GET', body } = {}) {
  const token = tokenStore.get();
  const res = await fetch(path, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.message ?? `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

export const fmt = {
  usd: (n) => (n == null ? '–' : n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: n < 10 ? 2 : 0 })),
  num: (n) => (n == null ? '–' : n.toLocaleString('en-US')),
  time: (iso) => new Date(iso).toLocaleTimeString(),
};

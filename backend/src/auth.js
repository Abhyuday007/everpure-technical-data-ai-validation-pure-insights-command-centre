import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { config } from './config.js';

/**
 * DEMO USERS ONLY. Passwords are hashed at start-up so no plaintext is compared,
 * but credentials are still hard-coded. A real deployment would use SSO / a user store.
 */
const DEMO = [
  { email: 'admin@pureinsights.local',   password: 'Admin#123',   role: 'admin',   name: 'Ada Admin' },
  { email: 'analyst@pureinsights.local', password: 'Analyst#123', role: 'analyst', name: 'Ana Analyst' },
  { email: 'viewer@pureinsights.local',  password: 'Viewer#123',  role: 'viewer',  name: 'Vik Viewer' },
];
const users = DEMO.map((u) => ({ email: u.email, role: u.role, name: u.name, hash: bcrypt.hashSync(u.password, 8) }));

export const ROLES = ['viewer', 'analyst', 'admin'];

export function login(email, password) {
  const u = users.find((x) => x.email === String(email ?? '').toLowerCase());
  // compare even on unknown user to keep timing similar
  const ok = bcrypt.compareSync(String(password ?? ''), u ? u.hash : '$2a$08$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalid');
  if (!u || !ok) return null;
  const user = { email: u.email, role: u.role, name: u.name };
  const token = jwt.sign(user, config.jwtSecret, { expiresIn: config.jwtExpiresIn });
  return { token, user };
}

export function verifyToken(token) {
  try {
    const p = jwt.verify(token, config.jwtSecret);
    return { email: p.email, role: p.role, name: p.name };
  } catch {
    return null;
  }
}

/** Express middleware: 401 without a valid token. */
export function authenticate(req, res, next) {
  const h = req.headers.authorization ?? '';
  const user = h.startsWith('Bearer ') ? verifyToken(h.slice(7)) : null;
  if (!user) return res.status(401).json({ error: 'unauthorized', message: 'Missing or invalid token' });
  req.user = user;
  next();
}

/** Express middleware factory: 403 unless the caller has one of the roles. */
export function requireRole(...allowed) {
  return (req, res, next) => {
    if (!allowed.includes(req.user.role)) {
      return res.status(403).json({ error: 'forbidden', message: `Requires role: ${allowed.join(' or ')}` });
    }
    next();
  };
}

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { getDb } = require('./db');

const SESSION_COOKIE_NAME = 'ghosted_session';
const SESSION_DURATION_MS = 24 * 60 * 60 * 1000; // 24 hours

// Middleware to enforce authentication
function requireAuth(req, res, next) {
  // Allow API login and status checks, and the login page
  if (req.path === '/api/login' || req.path === '/api/auth-status' || req.path === '/login.html') {
    return next();
  }

  // Allow static assets, wait... no we want to protect the dashboard
  // Let express static serve login.html, but intercept / (or index.html)
  
  const token = req.cookies[SESSION_COOKIE_NAME];
  if (!token) return sendUnauthorized(req, res);

  const db = getDb();
  const session = db.prepare('SELECT user_id, expires_at FROM sessions WHERE token = ?').get(token);
  
  if (!session) return sendUnauthorized(req, res);
  
  // Check expiration
  if (new Date(session.expires_at) < new Date()) {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    res.clearCookie(SESSION_COOKIE_NAME);
    return sendUnauthorized(req, res);
  }

  // Extend session
  const newExpiry = new Date(Date.now() + SESSION_DURATION_MS).toISOString();
  db.prepare('UPDATE sessions SET expires_at = ? WHERE token = ?').run(newExpiry, token);
  
  const user = db.prepare('SELECT username FROM users WHERE id = ?').get(session.user_id);
  req.user = { id: session.user_id, username: user.username };
  
  next();
}

function sendUnauthorized(req, res) {
  // If it's an API request, return 401
  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  // If it's a page request, redirect to login
  res.redirect('/login.html');
}

// Login route handler
function handleLogin(req, res) {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

  const db = getDb();
  const user = db.prepare('SELECT id, password_hash FROM users WHERE username = ?').get(username);
  
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }

  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + SESSION_DURATION_MS).toISOString();

  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(token, user.id, expiresAt);

  res.cookie(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    maxAge: SESSION_DURATION_MS,
    sameSite: 'lax'
  });

  res.json({ success: true, username });
}

// Logout route handler
function handleLogout(req, res) {
  const token = req.cookies[SESSION_COOKIE_NAME];
  if (token) {
    const db = getDb();
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  }
  res.clearCookie(SESSION_COOKIE_NAME);
  res.json({ success: true });
}

// Clean up expired sessions periodically
function cleanExpiredSessions() {
  const db = getDb();
  try {
    db.prepare('DELETE FROM sessions WHERE datetime(expires_at) < datetime(\'now\')').run();
  } catch (e) {
    console.error('Failed to clean expired sessions:', e);
  }
}
setInterval(cleanExpiredSessions, 60 * 60 * 1000); // Every hour

module.exports = { requireAuth, handleLogin, handleLogout, SESSION_COOKIE_NAME };

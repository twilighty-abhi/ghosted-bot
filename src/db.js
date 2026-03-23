const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const path = require('path');

let db = null;

function initDb() {
  if (db) return db;

  const dbPath = path.join(__dirname, '../ghosted.db');
  db = new Database(dbPath);

  // Enable WAL mode for better concurrency
  db.pragma('journal_mode = WAL');

  // Create tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER REFERENCES users(id),
      expires_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS cohorts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cohort_number INTEGER NOT NULL,
      guild_id TEXT NOT NULL,
      sheet_url TEXT,
      status TEXT DEFAULT 'active',
      provisioned_at TEXT DEFAULT (datetime('now')),
      archived_at TEXT,
      UNIQUE(cohort_number, guild_id)
    );
    CREATE TABLE IF NOT EXISTS activity_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      action TEXT NOT NULL,
      cohort_number INTEGER,
      username TEXT,
      details TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  // Create default admin user if no users exist
  const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
  if (userCount === 0) {
    const defaultPassword = process.env.DASHBOARD_PASSWORD;
    if (!defaultPassword) {
      console.error('❌ DASHBOARD_PASSWORD not set in .env. Needed to create initial admin user.');
      process.exit(1);
    }
    const hash = bcrypt.hashSync(defaultPassword, 10);
    db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run('admin', hash);
    console.log('✅ Created default admin user from DASHBOARD_PASSWORD.');
  }

  return db;
}

function getDb() {
  if (!db) return initDb();
  return db;
}

module.exports = { initDb, getDb };

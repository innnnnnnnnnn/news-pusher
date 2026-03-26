import Database from 'better-sqlite3';

const dbPath = process.env.DATABASE_PATH || './news-pusher.sqlite';
const db = new Database(dbPath);

// Initialize DB schema
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS config (
    key TEXT PRIMARY KEY,
    value TEXT
  );
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS subscriptions (
    site_name TEXT PRIMARY KEY,
    enabled INTEGER DEFAULT 1
  );
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS pushed_articles (
    url TEXT PRIMARY KEY,
    pushed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
`);

export default db;

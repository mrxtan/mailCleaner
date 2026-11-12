import Database from 'better-sqlite3';
import { closeSync, openSync, chmodSync } from 'node:fs';
import lockfile from 'proper-lockfile';

export async function openStore(path) {
  // Restrict permissions before SQLite creates its journal and acquire one writer.
  closeSync(openSync(path, 'a', 0o600));
  chmodSync(path, 0o600);
  const release = await lockfile.lock(path, { stale: 300000, update: 10000, retries: 0 });
  let db;
  try {
    db = new Database(path);
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = FULL');
    db.exec(`
      CREATE TABLE IF NOT EXISTS jobs (
        id INTEGER PRIMARY KEY, account TEXT NOT NULL, patterns TEXT NOT NULL,
        phase TEXT NOT NULL DEFAULT 'discover', created TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS messages (
        job INTEGER NOT NULL REFERENCES jobs(id), id TEXT NOT NULL,
        state TEXT NOT NULL DEFAULT 'pending', PRIMARY KEY(job,id)
      );
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY, job INTEGER, time TEXT DEFAULT CURRENT_TIMESTAMP,
        kind TEXT NOT NULL, details TEXT NOT NULL
      );
    `);
    return {
      db,
      async close() { db.close(); await release(); },
    };
  } catch (error) {
    db?.close();
    await release();
    throw error;
  }
}

export function selectJob(db, account, patterns, fresh) {
  const key = JSON.stringify([...patterns].sort());
  let job = fresh ? null : db.prepare("SELECT * FROM jobs WHERE account=? AND patterns=? AND phase!='complete' ORDER BY id DESC LIMIT 1").get(account, key);
  if (!job) {
    const result = db.prepare('INSERT INTO jobs(account,patterns) VALUES (?,?)').run(account, key);
    job = db.prepare('SELECT * FROM jobs WHERE id=?').get(result.lastInsertRowid);
  }
  return job;
}

// Store a small allowlist of diagnostics. HTTP objects may contain OAuth secrets.
export function recordEvent(db, job, kind, details = {}) {
  db.prepare('INSERT INTO events(job,kind,details) VALUES (?,?,?)').run(job, kind, JSON.stringify(details));
}

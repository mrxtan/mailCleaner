import Database from 'better-sqlite3';
import { existsSync } from 'node:fs';

// Read-only snapshots also work while a CLI process writes SQLite's WAL.
export function snapshot(path, type) {
  if (!existsSync(path)) return { jobs: [], events: [], rankings: [] };
  const db = new Database(path, { readonly: true, fileMustExist: true });
  try {
    const has = name => Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));
    const events = has('events') ? db.prepare('SELECT * FROM events ORDER BY id DESC LIMIT 50').all() : [];
    if (type === 'report' && has('reports')) {
      const jobs = db.prepare('SELECT * FROM reports ORDER BY id DESC LIMIT 20').all().map(job => ({
        ...job, counts: db.prepare('SELECT count(*) AS total, sum(done) AS done, count(sender) AS counted FROM report_messages WHERE report=?').get(job.id),
      }));
      const rankings = jobs.length ? db.prepare('SELECT sender,count(*) AS emails FROM report_messages WHERE report=? AND sender IS NOT NULL GROUP BY sender ORDER BY emails DESC,sender').all(jobs[0].id) : [];
      return { jobs, rankings, events };
    }
    const jobs = has('jobs') ? db.prepare('SELECT * FROM jobs ORDER BY id DESC LIMIT 30').all().map(job => ({
      ...job, counts: Object.fromEntries(db.prepare('SELECT state,count(*) AS n FROM messages WHERE job=? GROUP BY state').all(job.id).map(row => [row.state, row.n])),
    })) : [];
    return { jobs, events, rankings: [] };
  } finally { db.close(); }
}

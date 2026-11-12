import addressparser from 'nodemailer/lib/addressparser/index.js';
import { openStore, recordEvent } from './storage.js';
import { duration, progress } from '../queue.js';

export function senderAddress(message) {
  const headers = (message.payload?.headers || []).filter(header => header.name.toLowerCase() === 'from');
  if (headers.length !== 1 || typeof headers[0].value !== 'string') return null;
  const addresses = addressparser(headers[0].value);
  return addresses.length === 1 && addresses[0].address?.includes('@')
    ? addresses[0].address.toLowerCase() : null;
}

export async function senderReport(gmail, request, config) {
  const { values, account, quota } = config;
  // Reports use separate tables so their checkpoints cannot become deletion jobs.
  const store = await openStore(values.database);
  const { db } = store;
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS reports (
      id INTEGER PRIMARY KEY, account TEXT NOT NULL, phase TEXT DEFAULT 'discover');
      CREATE TABLE IF NOT EXISTS report_messages (
      report INTEGER NOT NULL, id TEXT NOT NULL, done INTEGER DEFAULT 0,
      sender TEXT, PRIMARY KEY(report,id));`);
    let report = values.fresh ? null : db.prepare("SELECT * FROM reports WHERE account=? AND phase!='complete' ORDER BY id DESC LIMIT 1").get(account);
    if (!report) {
      const inserted = db.prepare('INSERT INTO reports(account) VALUES (?)').run(account);
      report = db.prepare('SELECT * FROM reports WHERE id=?').get(inserted.lastInsertRowid);
    }
    config.onDiagnostic = (kind, details) => recordEvent(db, null, kind, { report: report.id, ...details });
    console.log(`Inbox sender report ${report.id} | saved in ${values.database}`);
    if (report.phase === 'discover') {
      let pageToken;
      const pages = new Set();
      const insert = db.prepare('INSERT OR IGNORE INTO report_messages(report,id) VALUES (?,?)');
      do {
        const { data } = await request(5, () => gmail.users.messages.list({ userId: 'me', labelIds: ['INBOX'], maxResults: 500, pageToken }));
        // Restarted discovery repeats pages; the primary key prevents double counting.
        db.transaction(() => { for (const { id } of data.messages || []) insert.run(report.id, id); })();
        pageToken = data.nextPageToken;
        if (pageToken && pages.has(pageToken)) throw new Error('Repeated Gmail page token. Rerun the report.');
        if (pageToken) pages.add(pageToken);
      } while (pageToken);
      db.prepare("UPDATE reports SET phase='scan' WHERE id=?").run(report.id);
    }
    const pending = db.prepare('SELECT id FROM report_messages WHERE report=? AND done=0').all(report.id);
    console.log(`Inbox messages awaiting inspection: ${pending.length} | ETA ${duration(pending.length * 1200000 / quota)}`);
    const save = db.prepare('UPDATE report_messages SET done=1,sender=? WHERE report=? AND id=?');
    const started = Date.now();
    let completed = 0;
    for (const { id } of pending) {
      let sender = null;
      try {
        const { data } = await request(20, () => gmail.users.messages.get({ userId: 'me', id, format: 'metadata', metadataHeaders: ['From'] }));
        // Mail may be archived or trashed while this report is running.
        if (data.labelIds?.includes('INBOX') && !data.labelIds.some(label => ['TRASH', 'DRAFT'].includes(label))) sender = senderAddress(data);
      } catch (error) {
        if (Number(error.response?.status || error.code) !== 404) throw error;
      }
      save.run(sender, report.id, id);
      completed++;
      if (completed % 100 === 0 || completed === pending.length) progress('Inbox scan', completed, pending.length, started, quota);
    }
    const rows = db.prepare(`SELECT sender, count(*) AS emails FROM report_messages
      WHERE report=? AND sender IS NOT NULL GROUP BY sender ORDER BY emails DESC,sender LIMIT ?`).all(report.id, values.top);
    const totals = db.prepare('SELECT count(*) AS inspected, count(sender) AS counted FROM report_messages WHERE report=?').get(report.id);
    console.log(`Inspected ${totals.inspected}; counted ${totals.counted}; skipped ${totals.inspected - totals.counted}.`);
    console.table(rows.map((row, index) => ({ rank: index + 1, ...row })));
    db.prepare("UPDATE reports SET phase='complete' WHERE id=?").run(report.id);
    return rows;
  } catch (error) {
    recordEvent(db, null, 'report-failed', { name: error.name, code: String(error.code || ''), status: error.response?.status });
    console.error('Inbox report progress saved. Repeat the command to resume.');
    throw error;
  } finally {
    config.onDiagnostic = undefined;
    await store.close();
  }
}

import { openStore, selectJob, recordEvent } from './storage.js';
import { discover } from './discover.js';
import { compilePatterns } from './patterns.js';
import { matchesSender } from './sender.js';
import { duration, progress } from '../queue.js';

async function metadata(gmail, request, id) {
  try {
    return (await request(20, () => gmail.users.messages.get({
      userId: 'me', id, format: 'metadata', metadataHeaders: ['From', 'Subject'],
    }))).data;
  } catch (error) {
    if (Number(error.response?.status || error.code) === 404) return null;
    throw error;
  }
}

export async function runJob(gmail, request, config) {
  const { values, patterns, quota, account } = config;
  const store = await openStore(values.database);
  const { db } = store;
  let job;
  try {
    job = selectJob(db, account, patterns, values.fresh);
    config.onDiagnostic = (kind, details) => recordEvent(db, job.id, kind, details);
    recordEvent(db, job.id, 'started', { mode: values.delete ? 'delete' : 'dry-run' });
    console.log(`Saved job ${job.id} | phase ${job.phase} | database ${values.database}`);
    const matchers = compilePatterns(patterns);
    const setState = db.prepare('UPDATE messages SET state=? WHERE job=? AND id=?');
    if (job.phase === 'discover') {
      console.log('Discovering candidates. Wildcard patterns scan all eligible mail.');
      // Commit each page. A restarted discovery repeats listing, while INSERT OR
      // IGNORE preserves saved IDs. Verification starts only after discovery ends.
      await discover(gmail, request, patterns, ids => {
        const insert = db.prepare('INSERT OR IGNORE INTO messages(job,id) VALUES (?,?)');
        db.transaction(() => { for (const id of ids) insert.run(job.id, id); })();
      });
      db.prepare("UPDATE jobs SET phase='scan' WHERE id=?").run(job.id);
      job.phase = 'scan';
    }
    const pending = db.prepare("SELECT id FROM messages WHERE job=? AND state='pending'").all(job.id);
    console.log(`Remaining verification: ${pending.length} | ETA ${duration(pending.length * 1200000 / quota)}`);
    let processed = 0;
    let samples = 0;
    const started = Date.now();
    for (const { id } of pending) {
      const message = await metadata(gmail, request, id);
      const matched = message && matchesSender(message, matchers);
      setState.run(matched ? 'matched' : 'excluded', job.id, id);
      if (matched && samples++ < 10) {
        const headers = message.payload?.headers || [];
        console.log(`Match: ${JSON.stringify({
          from: headers.find(header => header.name.toLowerCase() === 'from')?.value,
          pattern: patterns.find((_, index) => matchesSender(message, [matchers[index]])),
          subject: headers.find(header => header.name.toLowerCase() === 'subject')?.value,
        })}`);
      }
      processed++;
      if (processed % 100 === 0 || processed === pending.length) progress('Scan', processed, pending.length, started, quota);
    }
    db.prepare("UPDATE jobs SET phase='ready' WHERE id=?").run(job.id);
    const matches = db.prepare("SELECT id FROM messages WHERE job=? AND state='matched'").all(job.id);
    console.log(`Verified queued emails: ${matches.length}`);
    // Rechecking saved messages costs another metadata request before each Trash call.
    console.log(`Estimated deletion including rechecks: ${duration(matches.length * 2400000 / quota)}, plus API delays.`);
    if (!values.delete) {
      console.log('Dry run saved. Run with the same senders and --delete to process this queue.');
      return;
    }
    db.prepare("UPDATE jobs SET phase='delete' WHERE id=?").run(job.id);
    const deleteStarted = Date.now();
    let finished = 0;
    for (const { id } of matches) {
      // Recheck after a restart or older dry run. If a previous Trash request
      // succeeded before a crash, the TRASH label prevents another mutation.
      const message = await metadata(gmail, request, id);
      let state = 'skipped';
      if (message && matchesSender(message, matchers)) {
        try {
          await request(20, () => gmail.users.messages.trash({ userId: 'me', id }));
          state = 'trashed';
        } catch (error) {
          if (Number(error.response?.status || error.code) !== 404) throw error;
        }
      }
      setState.run(state, job.id, id);
      finished++;
      if (finished % 100 === 0 || finished === matches.length) progress('Trash queue', finished, matches.length, deleteStarted, quota / 2);
    }
    db.prepare("UPDATE jobs SET phase='complete' WHERE id=?").run(job.id);
    const totals = db.prepare('SELECT state, count(*) AS count FROM messages WHERE job=? GROUP BY state').all(job.id);
    console.log(`Job ${job.id} complete: ${totals.map(row => `${row.count} ${row.state}`).join(', ')}`);
    recordEvent(db, job.id, 'complete', { totals });
  } catch (error) {
    recordEvent(db, job?.id ?? null, 'failed', {
      name: error.name, code: String(error.code || ''), status: error.response?.status,
    });
    console.error('Progress saved. Rerun the same command to resume pending work.');
    throw error;
  } finally {
    config.onDiagnostic = undefined;
    await store.close();
  }
}

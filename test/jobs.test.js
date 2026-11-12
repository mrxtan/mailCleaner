import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { runJob } from '../lib/jobs.js';
import { createQueue } from '../queue.js';

const request = async (_, operation) => operation();

test('scan restart and dry-run promotion preserve work and recheck before trash', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mail-job-test-'));
  const path = join(directory, 'jobs.sqlite');
  let fail = true;
  let lists = 0;
  const reads = [];
  const trashed = [];
  const gmail = { users: { messages: {
    list: async () => { lists++; return { data: { messages: [{ id: 'a' }, { id: 'b' }] } }; },
    get: async ({ id }) => {
      reads.push(id);
      if (id === 'b' && fail) throw new Error('simulated interruption');
      return { data: { payload: { headers: [{ name: 'From', value: 'user@example.com' }] } } };
    },
    trash: async ({ id }) => { trashed.push(id); return { data: {} }; },
  } } };
  const config = { values: { database: path }, patterns: ['user@example.com'], quota: 5400, account: 'owner@example.com' };
  try {
    await assert.rejects(runJob(gmail, request, config), /simulated interruption/);
    fail = false;
    await runJob(gmail, request, config);
    assert.equal(lists, 1);
    assert.deepEqual(reads, ['a', 'b', 'b']);
    assert.deepEqual(trashed, []);
    config.values.delete = true;
    await runJob(gmail, request, config);
    assert.equal(lists, 1);
    assert.deepEqual(trashed, ['a', 'b']);
    assert.deepEqual(reads, ['a', 'b', 'b', 'a', 'b']);
    const db = new Database(path);
    assert.equal(db.prepare('SELECT phase FROM jobs').get().phase, 'complete');
    assert.equal(db.prepare("SELECT count(*) AS n FROM events WHERE kind='failed'").get().n, 1);
    db.close();
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('aborted requests retry and record structured diagnostics', async () => {
  const events = [];
  const queued = createQueue(5400, { wait: async () => {}, log: () => {}, diagnostic: (kind, data) => events.push({kind, data}) });
  let attempts = 0;
  await queued(20, async () => {
    if (++attempts === 1) throw Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' });
  });
  assert.equal(attempts, 2);
  assert.equal(events[0].data.aborted, true);
});

test('resume recognizes a Trash operation completed before the checkpoint', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mail-crash-test-'));
  let inTrash = false;
  let mutations = 0;
  const gmail = { users: { messages: {
    list: async () => ({ data: { messages: [{ id: 'a' }] } }),
    get: async () => ({ data: { labelIds: inTrash ? ['TRASH'] : [], payload: { headers: [{ name: 'From', value: 'user@example.com' }] } } }),
    trash: async () => { mutations++; inTrash = true; throw new Error('connection lost after success'); },
  } } };
  const config = { values: { database: join(directory, 'jobs.sqlite'), delete: true }, patterns: ['user@example.com'], quota: 5400, account: 'owner@example.com' };
  try {
    await assert.rejects(runJob(gmail, request, config), /connection lost/);
    await runJob(gmail, request, config);
    assert.equal(mutations, 1);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { senderReport } from '../lib/report.js';

test('report resumes, deduplicates IDs, ranks senders and skips archived messages', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'inbox-report-test-'));
  let fail = true;
  let lists = 0;
  const reads = [];
  const gmail = { users: { messages: {
    list: async options => {
      assert.deepEqual(options.labelIds, ['INBOX']);
      lists++;
      return { data: { messages: ['a', 'b', 'a', 'c', 'd'].map(id => ({ id })) } };
    },
    get: async ({ id }) => {
      reads.push(id);
      if (id === 'b' && fail) throw new Error('interrupted');
      return { data: { labelIds: id === 'd' ? [] : ['INBOX'], payload: { headers: [{ name: 'From', value: id === 'c' ? 'other@example.com' : 'Person <USER@example.com>' }] } } };
    },
    trash: async () => assert.fail('Report must never mutate Gmail'),
  } } };
  const config = { account: 'owner@example.com', quota: 5400, values: { database: join(directory, 'report.sqlite'), top: 20 } };
  try {
    await assert.rejects(senderReport(gmail, async (_, op) => op(), config), /interrupted/);
    fail = false;
    const rows = await senderReport(gmail, async (_, op) => op(), config);
    assert.deepEqual(rows, [{ sender: 'user@example.com', emails: 2 }, { sender: 'other@example.com', emails: 1 }]);
    assert.equal(lists, 1);
    assert.equal(reads.filter(id => id === 'a').length, 1);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

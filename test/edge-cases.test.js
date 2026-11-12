import test from 'node:test';
import assert from 'node:assert/strict';
import { createQueue } from '../queue.js';
import { matchesSender } from '../lib/sender.js';

const message = from => ({ payload: { headers: [{ name: 'From', value: from }] } });

test('exact sender matching rejects ambiguous and excluded messages', () => {
  assert.equal(matchesSender(message('Person <USER@example.com>'), 'user@example.com'), true);
  for (const from of ['other@example.com', 'user@example.com, other@example.com', 'Friends: user@example.com;']) {
    assert.equal(matchesSender(message(from), 'user@example.com'), false);
  }
  assert.equal(matchesSender({ ...message('user@example.com'), labelIds: ['TRASH'] }, 'user@example.com'), false);
  assert.equal(matchesSender({}, 'user@example.com'), false);
});

test('queue paces retries and honors long server cooldowns', async () => {
  let clock = 0;
  const waits = [];
  const request = createQueue(6000, { now: () => clock, wait: async ms => { waits.push(ms); clock += ms; }, log: () => {} });
  await request(20, async () => true);
  let attempts = 0;
  await request(20, async () => {
    if (++attempts === 1) throw { response: { status: 429, headers: { 'retry-after': '180' } } };
  });
  assert.equal(attempts, 2);
  assert.equal(clock, 180200);
  assert(waits.every(ms => ms <= 60000));
  await assert.rejects(request(20, async () => { throw new Error('permission denied'); }), /permission denied/);
});

test('queue stops after ten retries', async () => {
  let calls = 0;
  const request = createQueue(6000, { wait: async () => {}, log: () => {} });
  await assert.rejects(request(20, async () => { calls++; throw { response: { status: 503 } }; }));
  assert.equal(calls, 11);
});

import { compilePatterns, loadPatterns } from '../lib/patterns.js';
test('wildcards are anchored and literal dots remain literal', () => {
  const matches = (pattern, address) => matchesSender(message(address), compilePatterns([pattern]));
  assert(matches('*@alibaba.com', 'a@alibaba.com'));
  assert(!matches('*@alibaba.com', 'a@fakealibaba.com'));
  assert(matches('*@*.alibaba.com', 'a@notice.alibaba.com'));
  assert(!matches('*@*.alibaba.com', 'a@alibaba.com'));
  assert(matches('*@**.*alibaba*.com', 'a@notice.alibaba.com'));
  assert(!matches('*@alibaba.com', 'a@alibabaXcom'));
  assert.throws(() => loadPatterns('x@example.com from:other', undefined));
});

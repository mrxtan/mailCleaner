#!/usr/bin/env node
import 'dotenv/config';
import { senderReport } from './lib/report.js';
import { google } from 'googleapis';
import { configuration } from './lib/config.js';
import { authorize } from './lib/auth.js';
import { runJob } from './lib/jobs.js';
import { createQueue } from './queue.js';

// Keep the entry point focused on wiring configuration, auth and processing.
async function main() {
  const config = configuration();
  if (!config) return;
  const auth = await authorize(config.values.token);
  // Our queue owns retry timing so library retries cannot bypass quota accounting.
  const gmail = google.gmail({ version: 'v1', auth, retry: false, timeout: 60000 });
  const request = createQueue(config.quota, { diagnostic: (kind, details) => config.onDiagnostic?.(kind, details) });
  const profile = await request(1, () => gmail.users.getProfile({ userId: 'me' }));
  config.account = profile.data.emailAddress.toLowerCase();
  if (config.values['scan-inbox']) {
    console.log(`Account: ${config.account}`);
    await senderReport(gmail, request, config);
    return;
  }
  console.log(`Account: ${profile.data.emailAddress}\nSender patterns: ${config.patterns.join(', ')}\nMode: ${config.values.delete ? 'move to Trash' : 'dry run'}`);
  config.account = profile.data.emailAddress.toLowerCase();
  await runJob(gmail, request, config);
}

main().catch(error => {
  console.error(`Error: ${error.message}`);
  process.exitCode = 1;
});

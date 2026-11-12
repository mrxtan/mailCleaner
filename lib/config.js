import { HELP } from './help.js';
import { loadPatterns } from './patterns.js';
import { parseArgs } from 'node:util';

// Validate all CLI inputs before opening a browser or contacting Gmail.
export function configuration() {
  const { values } = parseArgs({ options: {
    'scan-inbox': { type: 'boolean' },
    top: { type: 'string', default: '20' },
    database: { type: 'string', default: 'mail-cleaner.sqlite' },
    fresh: { type: 'boolean' },
    file: { type: 'string' },
    sender: { type: 'string' },
    'dry-run': { type: 'boolean' },
    delete: { type: 'boolean' },
    help: { type: 'boolean', short: 'h' },
    'quota-per-minute': { type: 'string', default: '5400' },
    token: { type: 'string', default: 'token.json' },
  } });
  if (values.help) {
    console.log(HELP);
    return null;
  }
  if (values['scan-inbox'] && (values.sender || values.file || values.delete || values['dry-run'])) {
    throw new Error('--scan-inbox is a standalone report. Use it with --top, --fresh, and quota options.');
  }
  values.top = Number(values.top);
  if (!Number.isSafeInteger(values.top) || values.top < 1) throw new Error('--top must be a positive integer.');
  if (values['scan-inbox'] && values.database === 'mail-cleaner.sqlite') values.database = 'inbox-report.sqlite';
  const patterns = values['scan-inbox'] ? [] : loadPatterns(values.sender, values.file);
  if (values.delete && values['dry-run']) throw new Error('Choose --dry-run or --delete.');
  const quota = Number(values['quota-per-minute']);
  if (!Number.isFinite(quota) || quota < 20) throw new Error('--quota-per-minute must be at least 20.');
  return { values, patterns, quota };
}

# Mail Cleaner

Node.js 20+ CLI for moving messages from one exact sender to Gmail Trash. Matching ignores capitalization. Includes archived mail and Spam, excludes drafts and existing Trash. Dry run is the default and reports an exact verified count plus up to ten sample subjects. Search results are collected before any messages are moved.

## Setup

1. Enable Gmail API in a Google Cloud project.
2. Configure the OAuth consent screen. For a personal account, select External and add yourself as a test user while the app is in Testing.
3. Create an OAuth client of type Desktop app. Copy its client ID and client secret into .env using the template below.
4. Run npm install and copy .env.example to .env. Fill in GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET, then run the preview command below. A browser opens for Google authorization on first use.

Google setup guide: https://developers.google.com/workspace/gmail/api/quickstart/nodejs

```sh
node index.js --sender sender@example.com --dry-run
node index.js --sender sender@example.com --delete
npm start -- --sender sender@example.com
```

The --delete option moves messages to Trash. Review the displayed account and preview before running it. Matching account and sender patterns resume saved work. Use --fresh to include newly arrived messages in a new job.

The script loads `.env` from your current directory. Existing environment variables take precedence. `GOOGLE_REFRESH_TOKEN` is optional. When omitted, the script reuses `token.json` or opens browser authorization and saves a refresh token there. Client secrets are read from `.env`. The login helper uses an owner-only temporary credentials file and removes it afterward.

Use `--token PATH` for a custom token location. Keep custom token files outside the repository or add their paths to `.gitignore`. Remove the saved token and clear `GOOGLE_REFRESH_TOKEN` to select another account. If Google reports `invalid_grant`, authorize again.

Commit `.env.example`, source files, `package.json`, and `package-lock.json`. `.gitignore` excludes `.env` variants, downloaded OAuth credentials, saved tokens, dependencies, and logs. It keeps `.env.example` trackable.

Large mailboxes can take time because every candidate's From header is checked. If a run fails during deletion, it prints the number already moved and exits with an error. Rerunning processes remaining matches. A failed scan makes no changes.


## Queue and estimates

Requests run sequentially with a default budget of 5,400 quota units/minute, leaving headroom below the documented 6,000 limit. Set --quota-per-minute UNITS to match your Google Cloud quota and other app usage. Each metadata check and Trash request costs 20 units. At the default budget, 60,000 matches take roughly 222 minutes to scan and another 222 minutes to move, plus API delays.

A fast initial pass lists all candidate IDs and prints their count and estimated verification scan time. The deletion count and ETA follow after verification. Progress bars use the collected candidate count during scanning and the verified match count during deletion. The mailbox can change during a run, and exact sender verification may reduce the initial count. ETA uses both the configured quota and observed speed. Scan and Trash estimates are separate.

Rate-limit errors pause automatically for at least one minute. Transient failures retry with exponential backoff, honoring Retry-After, up to ten retries per request. Requests time out after 60 seconds. The queue is persisted in SQLite. Keep the process running and your computer awake. After a restart, rerun the same command to resume saved work.


## Sender files and wildcards

Use `--file senders.txt` with one address or pattern per line. Blank lines and lines beginning with # are ignored. `--sender` can be combined with `--file`. Duplicate patterns and matching message IDs are deduplicated into one queue.

```text
transaction@notice.aliexpress.com
*@alibaba.com
*@*.alibaba.com
*@*alibaba*.com
```

```sh
node index.js --file senders.txt --dry-run
node index.js --file senders.txt --delete
node index.js --sender '*@alibaba.com' --dry-run
```

Quote patterns in shell commands. Matching is case-insensitive and covers the entire From address. `*` matches zero or more characters within either side of @. Repeated stars behave like one star. Dots are literal, so `*.@alibaba.com` requires a dot immediately before @. `*@alibaba.com` covers that exact domain. `*@*.alibaba.com` covers subdomains. `*@*alibaba*.com` also matches domains such as notalibaba.com.

Wildcard searches scan all eligible mailbox messages because Gmail search does not support these wildcard rules. This can take substantially longer. Initial counts and time estimates describe candidate messages. The verified match count and deletion ETA appear before any messages are moved to Trash.


## Saved jobs and diagnostics

`mail-cleaner.sqlite` stores job metadata, message IDs, processing states, and sanitized diagnostic events. OAuth secrets and email subjects/bodies are excluded from this database. SQLite files and sidecars are Git-ignored. Use `--database PATH` for a custom location.

Repeat the same command to resume the latest unfinished job for the authenticated account and the same sender patterns. Pattern order does not matter. Scan progress is committed after each message. Interrupted discovery repeats listing and deduplicates previously saved IDs. `--fresh` creates a new job and includes current mail. Completed jobs are retained for diagnostics and a subsequent invocation starts a new job.

A completed dry run is reusable with `--delete`. Before every Trash operation, the saved message is fetched and checked again. This adds 20 quota units per queued email to deletion estimates. Already-trashed, missing, or ineligible messages are skipped. An interruption after Gmail succeeds but before the database update is recovered by this recheck.

One process can use a database at a time. Locks left by a crashed process expire after five minutes. Retry and failure diagnostics are stored in the `events` table with timestamps and error codes. Up to ten retries handle transient failures, including aborted API requests. Previous runs made before SQLite support cannot be recovered.

```sh
node index.js --file senders.txt --dry-run
node index.js --file senders.txt --delete
node index.js --file senders.txt --dry-run --fresh
sqlite3 mail-cleaner.sqlite 'SELECT time, kind, details FROM events ORDER BY id DESC LIMIT 20;'
```


## Most frequent inbox senders

Run `node index.js --scan-inbox --top 20` to rank sender addresses by individual message count across the Inbox, including read messages. Archived mail, Spam, Trash and drafts are excluded. Addresses are normalized to lowercase. Missing messages and ambiguous From headers are skipped. The result reflects observations during the scan, since mail can change while it runs.

Progress is saved in `inbox-report.sqlite`. Repeat an interrupted command to resume. Completed reports remain in SQLite for inspection; the next invocation creates a new report. Use `--fresh` to start over or `--database PATH` to choose storage. This report can run after cleanup without changing its saved jobs. Concurrent commands share Gmail quotas, so prefer running them sequentially or lower their combined quota budgets. The existing running cleanup continues using its loaded code.


## Local dashboard

Run `npm run ui` and open http://127.0.0.1:3210. The dark dashboard includes sender rules, text-file imports, wildcard previews, Trash cleanup, resumable jobs, inbox sender rankings, live output, diagnostics, quota controls, fresh jobs, and custom token/database paths. Gmail credentials stay in the local .env file. Starting a task reuses the CLI and its OAuth browser flow.

The dashboard runs on localhost. Closing the browser leaves its task running while the server remains open. Stop & keep progress ends the dashboard's child process; SQLite checkpoints remain. A separate terminal task continues independently and shares Gmail quota. Saved jobs in the selected databases can be inspected while a CLI writer runs. Use the exact printed 127.0.0.1 URL.

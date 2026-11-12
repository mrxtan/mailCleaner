// Keep user-facing guidance separate from argument parsing and validation.
export const HELP = `Mail Cleaner — find sender matches and move them to Gmail Trash

Usage
  node index.js [--sender PATTERN] [--file PATH] [--dry-run | --delete]

Provide --sender, --file, or both. Matching ignores capitalization.

Inbox sender report
  node index.js --scan-inbox --top 20
  Ranks From addresses by message count across the Inbox, including read mail.
  Uses inbox-report.sqlite by default and resumes interrupted reports.
  Completed reports start a new scan on the next invocation. --fresh restarts.
  Reports share the Gmail account quota with cleanup commands.

Options
  --scan-inbox              Scan Inbox and display the most frequent senders.
  --top NUMBER              Number of ranked senders to show. Default 20.
  --sender PATTERN          One email address or wildcard pattern.
  --file PATH               UTF-8 file with one address or pattern per line.
                           Blank lines and lines starting with # are ignored.
                           Combined inputs and overlapping matches are deduplicated.
  --dry-run                Preview verified matches and up to 10 sample subjects.
                           This is the default mode.
  --delete                 Scan, verify, then move matching messages to Trash.
                           This starts deletion automatically after verification.
  --quota-per-minute UNITS API quota budget per minute. Default 5400; minimum 20.
                           Metadata checks and Trash operations each cost 20 units.
                           Choose a budget within your Google Cloud quota.
  --database PATH          SQLite job store. Default mail-cleaner.sqlite.
  --fresh                  Start a new job and rediscover current mail.
  --token PATH             Saved OAuth token location. Default token.json.
  --help, -h               Show this help.

Examples
  node index.js --sender transaction@notice.aliexpress.com --dry-run
  node index.js --sender transaction@notice.aliexpress.com --delete
  node index.js --file senders.txt --dry-run
  node index.js --file senders.txt --delete
  node index.js --sender '*@alibaba.com' --dry-run
  node index.js --sender '*@*.alibaba.com' --file senders.txt --dry-run
  npm start -- --file senders.txt --dry-run

Example senders.txt
  # One address or pattern per line; quotes are only needed in shell commands.
  transaction@notice.aliexpress.com
  *@alibaba.com
  *@*.alibaba.com

Wildcard rules
  Quote patterns in your shell to prevent filename expansion.
  * matches zero or more characters within either side of @.
  Repeated stars behave like one star. Dots are literal.
  *@alibaba.com       Matches the exact domain alibaba.com.
  *@*.alibaba.com     Matches subdomains such as notice.alibaba.com.
  *@*alibaba*.com     Matches domains containing alibaba, including notalibaba.com.
  *.@alibaba.com      Requires a dot immediately before @ in the sender address.

Counts, progress and timing
  A quick listing pass counts candidates and estimates verification scan time.
  Sender verification produces the final match count and deletion estimate.
  Wildcards scan all eligible mailbox messages, so the initial candidate count
  can be much larger than the final match count. API delays can extend estimates.
  Progress is printed every 100 processed emails, with a final summary.
  Rate limits trigger automatic pauses; temporary failures retry up to 10 times.

Setup and scope
  Run from the project directory. Copy .env.example to .env and fill in
  GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET from a Desktop app OAuth client.
  Leave GOOGLE_REFRESH_TOKEN empty to authorize through your browser.
  The script saves browser authorization in the token file for future runs.
  Includes archived messages and Spam. Excludes drafts and existing Trash.
  --dry-run and --delete are mutually exclusive. Matching account and sender
  patterns resume the latest unfinished saved job. --fresh starts a new job.
  A saved dry run can be reused with --delete. Each queued message is rechecked.
  Completed jobs remain for diagnostics; the next run starts a new job.
  Keep your computer awake. After interruption, rerun the same command.
  Retry/error diagnostics are stored in the database events table.
  Keep .env and token files private. Add custom token paths to .gitignore.
`;

#!/usr/bin/env node
import 'dotenv/config';
import { createServer } from 'node:http';
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { snapshot } from './lib/dashboard-data.js';
import { loadPatterns } from './lib/patterns.js';

const root = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.MAIL_CLEANER_PORT || 3210);
const origin = `http://127.0.0.1:${port}`;
const session = randomUUID();
let active = null;
let starting = false;
let lastRun = null;
let paths = { cleanup: resolve(root, 'mail-cleaner.sqlite'), report: resolve(root, 'inbox-report.sqlite') };

async function body(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (Buffer.byteLength(raw) > 100000) throw new Error('Request too large.');
  }
  return JSON.parse(raw || '{}');
}

async function start(input) {
  if (active) throw new Error('A dashboard task is already running.');
  if (!['preview', 'delete', 'report'].includes(input.mode)) throw new Error('Choose a valid mode.');
  const quota = Number(input.quota ?? 5400);
  const top = Number(input.top ?? 20);
  if (!Number.isFinite(quota) || quota < 20 || !Number.isSafeInteger(top) || top < 1) throw new Error('Invalid quota or ranking limit.');
  const type = input.mode === 'report' ? 'report' : 'cleanup';
  const database = resolve(root, input.database || (type === 'report' ? 'inbox-report.sqlite' : 'mail-cleaner.sqlite'));
  const token = resolve(root, input.token || 'token.json');
  const directory = await mkdtemp(join(tmpdir(), 'mail-cleaner-ui-'));
  try {
    const args = [join(root, 'index.js'), '--database', database, '--token', token, '--quota-per-minute', String(quota)];
    if (type === 'report') args.push('--scan-inbox', '--top', String(top));
    else {
      const file = join(directory, 'senders.txt');
      await writeFile(file, String(input.patterns || ''), { mode: 0o600 });
      loadPatterns(undefined, file); // Validate before creating a child process.
      args.push('--file', file, input.mode === 'delete' ? '--delete' : '--dry-run');
    }
    if (input.fresh) args.push('--fresh');
    paths[type] = database;
    const run = { id: randomUUID(), mode: input.mode, started: new Date().toISOString(), status: 'running', lines: [], database };
    const child = spawn(process.execPath, args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
    active = { child, run };
    lastRun = run;
    const capture = stream => {
      let partial = '';
      stream.on('data', chunk => {
        partial += chunk.toString();
        const lines = partial.split('\n');
        partial = lines.pop();
        run.lines.push(...lines);
        run.lines = run.lines.slice(-400);
      });
      stream.on('end', () => { if (partial) run.lines.push(partial); });
    };
    capture(child.stdout);
    capture(child.stderr);
    child.on('error', error => { run.lines.push(error.message); });
    child.on('close', async code => {
      run.status = run.status === 'stopping' ? 'stopped' : code === 0 ? 'complete' : 'failed';
      run.ended = new Date().toISOString();
      active = null;
      await rm(directory, { recursive: true, force: true });
    });
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}

const server = createServer(async (req, res) => {
  const send = (status, data) => {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(data));
  };
  try {
    // Loopback binding, exact Host and same-origin POST checks protect local actions.
    if (req.headers.host !== `127.0.0.1:${port}`) return send(403, { error: 'Use the printed local URL.' });
    const url = new URL(req.url, origin);
    if (req.method === 'POST') {
      if (req.headers.origin !== origin || req.headers['x-session'] !== session) return send(403, { error: 'Invalid dashboard session. Refresh the page.' });
      const input = await body(req);
      if (url.pathname === '/api/start') {
        if (starting || active) throw new Error('A dashboard task is already running.');
        starting = true;
        try { await start(input); } finally { starting = false; }
      }
      else if (url.pathname === '/api/stop') {
        if (active) { active.run.status = 'stopping'; active.child.kill('SIGTERM'); }
      } else return send(404, { error: 'Unknown action.' });
      return send(200, { ok: true });
    }
    if (req.method !== 'GET') return send(405, { error: 'Method not allowed.' });
    if (url.pathname === '/api/state') {
      const safeSnapshot = (path, type) => { try { return snapshot(path, type); } catch (error) { return { jobs: [], events: [], rankings: [], error: error.message }; } };
      return send(200, { session, run: lastRun, active: Boolean(active), paths,
        configured: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
        tokenSaved: existsSync(join(root, 'token.json')),
        cleanup: safeSnapshot(paths.cleanup, 'cleanup'), report: safeSnapshot(paths.report, 'report'),
      });
    }
    const assets = { '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/style.css': ['style.css', 'text/css'] };
    if (!assets[url.pathname]) return send(404, { error: 'Not found.' });
    const [file, type] = assets[url.pathname];
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'" });
    res.end(await readFile(join(root, 'web', file)));
  } catch (error) { send(400, { error: error.message }); }
});
server.listen(port, '127.0.0.1', () => console.log(`Mail Cleaner dashboard: ${origin}`));
server.on('error', error => { console.error(error.message); process.exitCode = 1; });
process.on('SIGINT', () => { active?.child.kill('SIGTERM'); server.close(); });
process.on('SIGTERM', () => { active?.child.kill('SIGTERM'); server.close(); });

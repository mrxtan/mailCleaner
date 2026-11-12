const $ = id => document.getElementById(id);
let state;
let view = 'cleanup';
let posting = false;
let outputText = '';
const names = { cleanup: ['Make room for what matters.', 'Find the senders taking up space. Clean up with confidence.'], insights: ['Know who fills your inbox.', 'Discover the senders you hear from most.'], jobs: ['Pick up where you left off.', 'Your saved cleanup queues and their latest checkpoints.'], activity: ['Every step, accounted for.', 'Inspect saved errors, retries, and completed jobs.'], settings: ['Make it work your way.', 'Connection setup, processing limits, and a little guidance.'] };
const labels = { cleanup: 'Cleanup', insights: 'Inbox insights', jobs: 'Saved jobs', activity: 'Activity', settings: 'Settings & help' };
function navigate(next) {
  view = next;
  document.querySelectorAll('[data-panel]').forEach(panel => { panel.hidden = panel.dataset.panel !== next; });
  document.querySelectorAll('[data-view]').forEach(button => button.classList.toggle('selected', button.dataset.view === next));
  $('title').textContent = names[next][0]; $('subtitle').textContent = names[next][1]; $('crumb').textContent = labels[next];
}
document.querySelectorAll('[data-view]').forEach(button => button.onclick = () => navigate(button.dataset.view));
function rules() {
  const count = $('patterns').value.split('\n').filter(line => line.trim() && !line.trim().startsWith('#')).length;
  $('rule-count').textContent = `${count} rule${count === 1 ? '' : 's'}`;
  $('wildcard-note').hidden = !$('patterns').value.includes('*');
}
$('patterns').oninput = rules;
$('top').oninput = () => { if (state) paint(); };
$('file').onchange = async event => {
  const file = event.target.files[0];
  if (!file) return;
  if (file.size > 90000) return showError('Please use a sender file smaller than 90 KB.');
  $('patterns').value = [$('patterns').value.trim(), await file.text()].filter(Boolean).join('\n'); rules();
  event.target.value = '';
};
function showError(message) { $('error').textContent = message; $('error').hidden = !message; }
async function action(path, data) {
  if (posting) return;
  posting = true;
  try {
    const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Session': state.session }, body: JSON.stringify(data) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    showError(''); await refresh();
  } catch (error) { showError(error.message); }
  finally { posting = false; }
}
function launch(mode) {
  action('/api/start', { mode, patterns: $('patterns').value, fresh: $(mode === 'report' ? 'report-fresh' : 'fresh').checked, quota: $('quota').value, top: $('top').value, token: $('token').value, database: $(mode === 'report' ? 'report-db' : 'cleanup-db').value });
}
$('preview').onclick = () => launch('preview');
$('delete').onclick = () => {
  if (!$('patterns').value.trim()) return showError('Add at least one sender rule.');
  $('confirm-rules').textContent = $('patterns').value; $('confirm').showModal();
};
$('cancel-delete').onclick = () => $('confirm').close();
$('confirm-delete').onclick = () => { $('confirm').close(); launch('delete'); };
$('scan-inbox').onclick = () => launch('report');
$('stop').onclick = () => action('/api/stop', {});
// All mailbox-derived strings become text nodes, never HTML.
function table(target, headings, rows, empty) {
  const host = $(target); host.replaceChildren();
  if (!rows.length) { const box = document.createElement('div'); box.className = 'empty'; box.textContent = empty; host.append(box); return; }
  const grid = document.createElement('table'); const header = grid.createTHead().insertRow();
  headings.forEach(title => { const cell = document.createElement('th'); cell.textContent = title; header.append(cell); });
  const body = grid.createTBody();
  rows.forEach(row => { const tr = body.insertRow(); row.forEach(value => { const td = tr.insertCell(); if (value instanceof Node) td.append(value); else td.textContent = value; }); });
  host.append(grid);
}
function paint() {
  $('connection').textContent = state.configured ? '● Gmail credentials configured' : '○ Gmail setup needed';
  const jobs = state.cleanup.jobs;
  const counts = jobs[0]?.counts || {};
  $('stat-total').textContent = jobs.length ? Object.values(counts).reduce((a,b) => a+b,0).toLocaleString() : '—';
  $('stat-matched').textContent = jobs.length ? (counts.matched || 0).toLocaleString() : '—';
  $('stat-trashed').textContent = jobs.length ? jobs.reduce((sum, job) => sum + (job.counts.trashed || 0),0).toLocaleString() : '—';
  const run = state.run;
  $('stat-status').textContent = run ? run.status[0].toUpperCase()+run.status.slice(1) : 'Idle';
  $('stat-detail').textContent = run ? ({preview:'Sender preview',delete:'Move to Trash',report:'Inbox sender report'})[run.mode] : 'Ready when you are';
  $('run-badge').textContent = run?.status.toUpperCase() || 'READY';
  const lines = run?.lines || [];
  const progress = [...lines].reverse().map(line => line.match(/^(Scan|Trash queue|Inbox scan) \[[#-]+\] (\d+)\/(\d+) \| ETA (.*)$/)).find(Boolean);
  if (progress) {
    const percent = Number(progress[3]) ? Math.round(Number(progress[2])/Number(progress[3])*100) : 100;
    $('percent').textContent = `${percent}%`; $('progress-bar').style.width = `${percent}%`;
    $('phase').textContent = progress[1]; $('processed').textContent = `${Number(progress[2]).toLocaleString()} / ${Number(progress[3]).toLocaleString()}`; $('eta').textContent = `ETA ${progress[4]}`;
  } else { $('percent').textContent = state.active ? '…' : '—'; $('phase').textContent = state.active ? 'Preparing task' : 'Awaiting a task'; $('processed').textContent = state.active ? 'Connecting or discovering messages' : 'No active task'; $('eta').textContent = '—'; $('progress-bar').style.width = '0%'; }
  $('stop').disabled = !state.active || run?.status === 'stopping';
  ['preview','delete','scan-inbox'].forEach(id => { $(id).disabled = state.active; });
  const text = lines.join('\n');
  if (text !== outputText) { outputText = text; $('output').textContent = text || 'Start a preview or inbox scan to see live output here.'; $('output').scrollTop = $('output').scrollHeight; }
  table('jobs', ['Job / account', 'Phase', 'Queued', 'Trashed', ''], jobs.map(job => {
    const button = document.createElement('button'); button.className = 'secondary'; button.textContent = 'Load rules';
    button.onclick = () => { $('patterns').value = JSON.parse(job.patterns).join('\n'); $('fresh').checked = false; rules(); navigate('cleanup'); };
    return [`#${job.id} · ${job.account}`, job.phase, job.counts.matched || 0, job.counts.trashed || 0, button];
  }), 'Your saved cleanup jobs will appear here.');
  const report = state.report.jobs[0];
  $('report-status').textContent = report ? `Report #${report.id} · ${report.account} · ${report.phase === 'complete' ? 'Completed' : 'Partial results — scan in progress or paused'} · ${report.counts.done || 0} / ${report.counts.total} inspected` : '';
  table('rankings', ['Rank', 'Sender', 'Messages', ''], state.report.rankings.slice(0, Number($('top').value) || 20).map((row,index) => {
    const button = document.createElement('button'); button.textContent = 'Add to cleanup'; button.className = 'secondary';
    button.onclick = () => { $('patterns').value = [$('patterns').value.trim(), row.sender].filter(Boolean).join('\n'); rules(); navigate('cleanup'); };
    return [index+1, row.sender, row.emails.toLocaleString(), button];
  }), 'Run an inbox scan to discover your most frequent senders.');
  const events = [...state.cleanup.events, ...state.report.events].sort((a,b) => b.time.localeCompare(a.time)).slice(0,50);
  table('events', ['Time', 'Event', 'Details'], events.map(event => [event.time, event.kind, event.details]), 'Diagnostic events will appear as jobs run.');
  if (state.cleanup.error || state.report.error) showError(state.cleanup.error || state.report.error);
}
async function refresh() {
  try { const response = await fetch('/api/state'); if (!response.ok) throw new Error('Cannot read dashboard state.'); state = await response.json(); paint(); }
  catch (error) { showError(`${error.message} Check that npm run ui is still running.`); }
}
refresh(); setInterval(refresh, 2000);

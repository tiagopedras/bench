'use strict';

/* =========================================================================
   Where an agent's run on a task stands, as one line on its card.

   A task handed over carries its agent's part as sub-tasks (handOver(),
   04-tier-two-the-one-thing.js), and those say whose move it is. They cannot
   say whether the Plan agent has started, is stuck or failed: an agent never
   writes todo.md. The agents keep that in data/<dataset>/agent-runs.json
   (core/agent_runs.py), one record per sub-task, and the board reads it from
   /agent-runs.json.

   The line is "Plan agent · waiting for you · 02:05": whose part the task is at,
   what it is doing, and when that last changed. Worked out from the sub-tasks
   first and the record second, so a task whose run the board has never heard of
   still reads "queued" rather than nothing.
   ========================================================================= */

/* The records, by sub-task id. Empty until the first read comes back. */
let agentRuns = {};
let agentRunsSig = '';

/* A run marked running for longer than this died without saying so. Both
   agents stop a task well inside it (20 minutes for the Implement agent). */
const RUN_STALE_MS = 3 * 60 * 60 * 1000;

async function loadAgentRuns(){
  let got;
  try {
    const res = await fetch('/agent-runs.json?t=' + Date.now(), { cache: 'no-store' });
    if (!res.ok) return;
    got = await res.json();
  } catch (err) { return; }
  const subs = got && typeof got.subs === 'object' && got.subs ? got.subs : {};
  const sig = JSON.stringify(subs);
  if (sig === agentRunsSig) return;
  agentRunsSig = sig;
  agentRuns = subs;
  if (state.doc && typeof refreshView === 'function') refreshView();
}

/* Read on load, when the tab comes back, and once a minute while it is up:
   a run started overnight lands while the tab sits open. */
loadAgentRuns();
setInterval(() => { if (!document.hidden) loadAgentRuns(); }, 60 * 1000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) loadAgentRuns(); });

function agentRunFor(sub){
  return (sub && sub.stableId && agentRuns[sub.stableId]) || null;
}

/* "02:05" today, "26 Sep" before. */
function runWhen(iso){
  if (!iso) return '';
  const d = new Date(String(iso).replace(' ', 'T'));
  if (isNaN(d)) return '';
  const now = new Date();
  if (d.toDateString() === now.toDateString())
    return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

/* The four sub-tasks a handover lays out, those this task has, in order. */
const HANDOVER_KINDS = ['plan', 'plan-review', 'implement', 'work-review'];
function handoverSteps(t){
  if (!t || !t.stableId) return [];
  const steps = subSteps(t);
  return HANDOVER_KINDS.map(kind => ({ kind, step: steps.find(s => s.slug === t.stableId + '-' + kind) }))
    .filter(x => x.step);
}

/* A record's state, with a run left running for hours read as failed. */
function runState(rec){
  if (!rec) return '';
  if (rec.state === 'running') {
    const at = Date.parse(String(rec.started || rec.at || '').replace(' ', 'T'));
    if (at && Date.now() - at > RUN_STALE_MS) return 'stale';
  }
  return rec.state || '';
}

/* The line, as data: { text, tone, title, sub, failed }, or null for a task
   with no agent part left open. `tone` is one of running, queued, you, failed. */
function agentRunStatus(t){
  if (!t || t.done) return null;
  const hs = handoverSteps(t);
  if (!hs.some(x => x.kind === 'plan' || x.kind === 'implement')) return null;
  const at = hs.findIndex(x => !x.step.done);
  if (at < 0) return null;
  const cur = hs[at];
  const agentStep = cur.kind === 'plan' || cur.kind === 'implement';
  if (agentStep) {
    const who = agentOf(cur.step.to);
    // Taken back: the step is his now, and "your move" already says so.
    if (!who) return null;
    const rec = agentRunFor(cur.step);
    const st = runState(rec);
    const base = { sub: cur.step.stableId, agent: who };
    if (st === 'running')
      return Object.assign(base, { tone: 'running', text: who + ' · working · since ' + runWhen(rec.started || rec.at),
        title: who + ' started on this at ' + runWhen(rec.started || rec.at) });
    if (st === 'failed' || st === 'stale')
      return Object.assign(base, { tone: 'failed', failed: true,
        text: who + ' · failed · ' + runWhen(rec.at),
        title: st === 'stale' ? 'It started and never finished.' : (rec.why || 'The run failed.') });
    if (st === 'queued')
      return Object.assign(base, { tone: 'queued',
        text: who + ' · retrying ' + (who === 'Plan agent' ? 'tonight' : 'on the next /do'),
        title: 'You asked for it to be tried again at ' + runWhen(rec.retry || rec.at) });
    if (st === 'done')
      return Object.assign(base, { tone: 'queued', text: who + ' · finished · ' + runWhen(rec.at),
        title: 'Finished. The board ticks the sub-task when it next drains what the agent asked for.' });
    return Object.assign(base, { tone: 'queued',
      text: who + ' · queued' + (who === 'Plan agent' ? ' for tonight' : ''),
      title: who === 'Plan agent' ? 'Not started. The Plan agent works overnight.'
        : 'Not started. The Implement agent takes it on its next run, or through /do.' });
  }
  /* His review. The agent named is the one whose work it is. */
  const prev = hs.slice(0, at).reverse().find(x => x.kind === 'plan' || x.kind === 'implement');
  const who = (prev && agentOf(prev.step.to)) || (cur.kind === 'plan-review' ? 'Plan agent' : 'Implement agent');
  const rec = prev && agentRunFor(prev.step);
  const when = rec ? runWhen(rec.at) : '';
  const decide = rec && rec.label === 'needs a decision';
  return { sub: cur.step.stableId, agent: who, tone: 'you',
    text: who + ' · ' + (decide ? 'needs a decision from you' : 'waiting for you') + (when ? ' · ' + when : ''),
    title: cur.kind === 'plan-review' ? 'The plan is written and waits for your review.'
      : 'The work is done and waits for your review.' };
}

/* =========================================================================
   A failed run, and the three ways out of it.

   A run that errors or gives up shows as "Implement agent · failed · 02:05" on
   the card, and the companion puts up a banner for it (core/agent_runs.py
   fail(), failures only). Opening the task shows the same line with three
   buttons:

     Read the log   the run's own error output, in a sheet
     Retry          the same run again: tonight for the Plan agent, on the next
                    /do (or its next unattended run) for the Implement agent.
                    The agents fold the retry into the item's fingerprint, so a
                    run the shared runner had set aside after failing goes again.
     Take it back   the agent comes off every open step of the handover, and off
                    the task, so the task is his again.
   ========================================================================= */

function runLineHTML(st){
  return '<div class="runline runline--' + esc(st.tone) + '"' + (st.title ? ' title="' + esc(st.title) + '"' : '') + '>' +
    esc(st.text) + '</div>';
}

function runBlockHTML(t, st){
  if (!st) return '';
  const ro = state.locked ? ' disabled' : '';
  const btns = !st.failed ? '' :
    '<div class="reviewbtns">' +
      '<button type="button" class="btn small" data-run="log">Read the log</button>' +
      '<button type="button" class="btn small" data-run="retry"' + ro + '>Retry</button>' +
      '<button type="button" class="btn small reject" data-run="takeback"' + ro + '>Take it back</button>' +
    '</div>' +
    '<span class="help">' + esc(st.agent === 'Plan agent'
      ? 'Retry runs it again tonight. Take it back makes the task yours.'
      : 'Retry runs it again on the next /do. Take it back makes the task yours.') + '</span>';
  return '<div class="field runblock"><span>Agent</span>' + runLineHTML(st) + btns + '</div>';
}

function wireRunBlock(box, t, st){
  if (!box || !st) return;
  box.querySelectorAll('[data-run]').forEach(b => {
    b.onclick = () => {
      if (b.dataset.run === 'log') openRunLog(st.sub, t.title);
      else if (b.dataset.run === 'retry') retryRun(st.sub, t);
      else if (b.dataset.run === 'takeback') takeBackTask(t);
    };
  });
}

/* The task drawer: the line at the top of its main column. */
function mountRunBlock(t){
  const old = document.querySelector('#dbody .runblock');
  if (old) old.remove();
  const st = agentRunStatus(t);
  const main = document.querySelector('#dbody .dcol-main');
  if (!st || !main) return;
  main.insertAdjacentHTML('afterbegin', runBlockHTML(t, st));
  wireRunBlock(main.querySelector('.runblock'), t, st);
}

function openRunLog(sub, title){
  const rec = agentRuns[sub] || {};
  const stale = runState(rec) === 'stale';
  const said = stale
    ? 'It started at ' + runWhen(rec.started || rec.at) + ' and never said it had finished. ' +
      'The agent\'s own log under data/runner/ has the rest.'
    : (rec.error || rec.why || 'The run left no output.');
  showModal('What the run said', esc((rec.agent || 'The agent') + ' on ' + (title || rec.title || 'this task') +
      (rec.at ? ', ' + runWhen(rec.at) : '')),
    '<pre class="runlog">' + esc(said) + '</pre>',
    [{ label: 'Close', primary: true }], { wide: true });
}

async function postAgentRuns(action, sub){
  const got = await postJSON('/agent-runs', { action, sub });
  if (got && got.subs && typeof got.subs === 'object') {
    agentRuns = got.subs;
    agentRunsSig = JSON.stringify(got.subs);
  }
  return got;
}

async function retryRun(sub, t){
  if (state.locked) return;
  try {
    await postAgentRuns('retry', sub);
  } catch (err) {
    showToast('Could not ask for a retry: ' + (err.message || err), 'bad');
    return;
  }
  const st = agentRunStatus(t);
  showToast(st && st.agent === 'Implement agent' ? 'It will run again on the next /do.' : 'It will run again tonight.', 'good');
  refreshView();
  if (state.openTask) openDrawer(state.openTask);
}

/* The agent comes off every open step of the handover and off the task. The
   steps stay, now his, so what was planned is still there to work from. */
function takeBackTask(t){
  if (state.locked) return;
  const subs = [];
  handoverSteps(t).forEach(({ step }) => {
    if (step.done || !agentOf(step.to)) return;
    const f = readSub(t, step.line);
    if (!f) return;
    f.to = OWNER_NAME;
    writeSub(t, step.line, f);
    subs.push(step.stableId);
  });
  if (agentOf(t.to)) { t.to = ''; t.dirty = true; }
  markDirty();
  refreshView();
  subs.filter(Boolean).forEach(sub => { postAgentRuns('clear', sub).catch(() => {}); });
  showToast('Taken back. The task is yours again.', 'good');
  if (state.openTask) openDrawer(state.openTask);
}

/* The sub-task's panel: the same block on the agent's own step. */
function mountSubRun(t, step){
  const box = document.querySelector('#sbody .dcol-main');
  if (!box) return;
  const old = box.querySelector('.runblock');
  if (old) old.remove();
  const st = agentRunStatus(t);
  if (!st || st.sub !== step.stableId) return;
  const title = box.querySelector('label.field');
  const html = runBlockHTML(t, st);
  if (title) title.insertAdjacentHTML('afterend', html); else box.insertAdjacentHTML('afterbegin', html);
  wireRunBlock(box.querySelector('.runblock'), t, st);
}

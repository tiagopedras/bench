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

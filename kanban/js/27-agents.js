'use strict';

/* =========================================================================
   4d. Agents — what each agent does, and the Plan and Implement agents'
   switches, hours and runs.

   The switches and hours are the agents dashboard's own page,
   PACKAGES/agents-engine/react, reached as BoardUI.AgentsApp, so this view and
   ~/Code/agents-dashboard draw one hour track rather than two. It asks
   /agents-api/* (kanban/server.py), which runs agents-engine's routes over this
   repo's agents/ folder only, so the agents on it are the two the board hands
   work to. Every change goes through the agent's own `apply` command; nothing
   here or in the server opens a schedule file.

   Under it, one card per agent from AGENT_CARDS (02-state.js): what it does,
   what it cannot do and what it needs from the person. Plain HTML beside the
   React root rather than inside it, since the component is shared with the
   dashboard and the cards are this board's own words.

   The component owns everything on screen, including its twenty-second poll of
   every agent's state. That poll is why leaving the view unmounts it: a root
   left behind on a node the next view has replaced keeps polling, and each
   poll runs both agents' state commands.
   ========================================================================= */

let agentsRoot = null;

/* ---- Is there an agent on this list yet? ----

   Someone who only uses the PA to keep their list has no use for the agent
   half of the board, so until the list has an agent set up the board leaves
   it out: no agents under Delegate to, no Delegate to Claude on Overview, and
   this tab shows the cards and the way to set one up instead of the hour
   tracks. The agent filter chip already hides itself while nothing is
   delegated.

   A list counts as set up when any of these holds:
     - a bucket has a planner of its own on disk (`fallback` false in
       /bucket-brief.json), which is how the lists this board was built on
       came to have agents before any of this existed;
     - a bucket's brief has a section the person wrote, rather than the
       template's own prose — a new list's wizard scaffolds every brief with a
       one-line summary and no marker, so `filled` alone would count every
       new list as set up;
     - a task, or one of its sub-tasks, is already delegated to an agent.
   Until the briefs have answered, or where there is no server to ask (the
   demo build), it counts as set up, so nothing is hidden on a guess. */
function agentsSetUp(){
  if (state.agentsSetup !== false) return true;
  return listHasAgentWork();
}

function listHasAgentWork(){
  if (!state.doc) return false;
  return state.doc.buckets.some(b => b.tiers.some(ti => ti.tasks.some(t => delegatedToAgent(t))));
}

/* A brief with at least one section that is neither empty nor the template's
   own text for it. */
function briefWritten(brief){
  if (!brief || !brief.exists || !brief.filled) return false;
  const mine = parseBriefText(brief.text).sections;
  const tpl = parseBriefText(brief.template || '').sections;
  return BRIEF_SECTIONS.some(n => {
    const v = (mine[n] || '').trim();
    return !!v && v !== (tpl[n] || '').trim();
  });
}

let agentsSetupAsk = 0;
async function checkAgentsSetup(){
  if (!state.doc) return;
  const ask = ++agentsSetupAsk;
  const answers = await Promise.all(state.doc.buckets.map(b =>
    getJSON('/bucket-brief.json?bucket=' + encodeURIComponent(b.name)).catch(() => null)));
  if (ask !== agentsSetupAsk) return;
  const got = answers.filter(Boolean);
  const was = agentsSetUp();
  state.agentsSetup = got.length ? got.some(a => !a.fallback || briefWritten(a)) : null;
  if (agentsSetUp() !== was && state.doc) refreshView();
}

/* One card per agent. `highlight` names the card to mark, which is how the
   setup wizard ends on the agent it has just set up. */
function agentCardsHTML(highlight){
  const row = (label, text) =>
    '<div class="agentcard-row"><dt>' + esc(label) + '</dt><dd>' + esc(text) + '</dd></div>';
  return '<section class="agentcards" aria-label="What each agent does">' +
    '<h2>What each agent does</h2>' +
    '<div class="agentcards-grid">' +
    AGENT_CARDS.map(c =>
      '<article class="agentcard' + (c.name === highlight ? ' on' : '') + '" data-agent-card="' + esc(c.name) + '">' +
        '<header><span class="avatar" aria-hidden="true">' + avatarSvg(c.name, 28) + '</span>' +
        '<h3>' + esc(c.name) + '</h3></header>' +
        '<dl>' + row('Does', c.does) + row('Cannot', c.cannot) + row('Needs from you', c.needs) + '</dl>' +
      '</article>').join('') +
    '</div></section>';
}

function renderAgentsView(){
  const lists = $('#lists');
  if (!lists) return;
  if (!agentsSetUp()) {
    /* Nothing to schedule yet, so the hour tracks wait until there is. */
    leaveAgentsView();
    lists.innerHTML = '<div class="agentsview">' + agentSetupIntroHTML() +
      '<div id="agentsCards">' + agentCardsHTML() + '</div></div>';
    wireAgentSetupButtons(lists);
    return;
  }
  let host = lists.querySelector('#agentsRoot');
  if (!host) {
    leaveAgentsView();
    lists.innerHTML = '<div class="agentsview"><div id="agentsRoot"></div>' +
      '<div id="agentsCards"></div></div>';
    host = lists.querySelector('#agentsRoot');
    agentsRoot = host;
  }
  lists.querySelector('#agentsCards').innerHTML = agentCardsHTML() +
    '<p class="agentsetup-more"><button type="button" class="btn small" data-agent-setup>' +
    'Set up an agent for another bucket</button></p>';
  wireAgentSetupButtons(lists);
  BoardUI.mount(host, BoardUI.h(BoardUI.AgentsApp, {
    base: '/agents-api',
    title: 'Agents',
    // Its own names in localStorage, so which reading and order he last had on
    // the dashboard does not decide this one, or the other way round.
    storagePrefix: 'board-agents.',
    embedded: true,
  }));
}

/* What the tab says on a list with no agent yet. */
function agentSetupIntroHTML(){
  return '<section class="agentsetup">' +
    '<h1>Agents</h1>' +
    '<p>No agent is set up on this list yet. An agent can plan a task for you ' +
    'overnight, then carry out the plan once you approve it. Setting one up is ' +
    'four questions about one of your buckets.</p>' +
    '<button type="button" class="btn primary" data-agent-setup>Set up an agent</button>' +
    '</section>';
}

function wireAgentSetupButtons(root){
  root.querySelectorAll('[data-agent-setup]').forEach(btn => {
    btn.onclick = () => openAgentSetup();
  });
}

/* Until the setup wizard lands, the way in is the bucket's own brief. */
function openAgentSetup(){
  openBucketEditor();
}

/* Called by renderView() for every view but this one. */
function leaveAgentsView(){
  if (!agentsRoot) return;
  BoardUI.unmount(agentsRoot);
  agentsRoot = null;
}

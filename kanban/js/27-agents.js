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
  let host = lists.querySelector('#agentsRoot');
  if (!host) {
    leaveAgentsView();
    lists.innerHTML = '<div class="agentsview"><div id="agentsRoot"></div>' +
      '<div id="agentsCards"></div></div>';
    host = lists.querySelector('#agentsRoot');
    agentsRoot = host;
  }
  lists.querySelector('#agentsCards').innerHTML = agentCardsHTML();
  BoardUI.mount(host, BoardUI.h(BoardUI.AgentsApp, {
    base: '/agents-api',
    title: 'Agents',
    // Its own names in localStorage, so which reading and order he last had on
    // the dashboard does not decide this one, or the other way round.
    storagePrefix: 'board-agents.',
    embedded: true,
  }));
}

/* Called by renderView() for every view but this one. */
function leaveAgentsView(){
  if (!agentsRoot) return;
  BoardUI.unmount(agentsRoot);
  agentsRoot = null;
}

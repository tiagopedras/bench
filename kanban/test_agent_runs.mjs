/* Where an agent's run on a task stands: the line on its card
 * (agentRunStatus(), kanban/js/28-agent-runs.js), and what the sub-task's panel
 * offers from it.
 *
 * Run through scripts/test-board.sh, which gives it a throwaway server. The run
 * records are set in the page rather than written to disk, and every non-GET is
 * torn out of fetch and recorded, so nothing here reaches todo.md or
 * agent-runs.json; the last check says so.
 */
import { spawn } from 'node:child_process'

const PORT = Number(process.env.CDP_PORT) || 9461
const BOARD = process.env.BOARD_PORT || 8765
if (!process.env.BOARD_PORT) console.error('Note: this runs against the live board on 8765. For a throwaway copy: scripts/test-board.sh test_agent_runs.mjs')
const checks = []
const check = (name, pass, detail = '') => {
  checks.push(pass)
  console.log(`${pass ? '  ok  ' : ' FAIL '} ${name}${detail ? ` — ${detail}` : ''}`)
}

const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
  '--headless=new', `--remote-debugging-port=${PORT}`, '--no-first-run',
  `--user-data-dir=${process.env.CHROME_PROFILE || '/tmp/todo-board-test-profile-runs'}`, '--window-size=1500,1000',
  `http://127.0.0.1:${BOARD}/kanban/index.html`
], { stdio: ['ignore', 'pipe', 'pipe'] })

async function page () {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`)
      const t = (await r.json()).find(t => t.type === 'page' && t.url.includes('index.html'))
      if (t?.webSocketDebuggerUrl) return t.webSocketDebuggerUrl
    } catch {}
    await new Promise(r => setTimeout(r, 250))
  }
  throw new Error('no page')
}

const ws = new WebSocket(await page())
await new Promise(r => (ws.onopen = r))
let id = 0
const pending = new Map()
ws.onmessage = e => {
  const m = JSON.parse(e.data)
  if (pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
}
const send = (method, params) => new Promise(res => {
  const n = ++id
  pending.set(n, res)
  ws.send(JSON.stringify({ id: n, method, params }))
})
async function evalJS (expr) {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 500))
  return r.result?.result?.value
}
const wait = ms => new Promise(r => setTimeout(r, ms))

await wait(2500)
check('the board loaded', await evalJS(`typeof agentRunStatus === 'function' && typeof renderBoard === 'function'`))

/* Two tasks handed to the Plan agent, one to nobody. handOver() lays out the
   sub-tasks, so the test reads their ids back rather than writing them. */
await evalJS(`(() => {
  const real = window.fetch;
  window.__blocked = [];
  window.fetch = (u, o) => {
    const m = (o && o.method) || 'GET';
    if (m !== 'GET') { window.__blocked.push(m + ' ' + u); return Promise.resolve(new Response('{"subs":{}}', { status: 200 })) }
    if (String(u).startsWith('/agent-runs.json')) return Promise.resolve(new Response(JSON.stringify({ subs: window.__runs || {} }), { status: 200 }));
    return real(u, o);
  };
  state.view = 'board';
  load([
    '# To-do', '', '## 1. People', '',
    '### To do', '',
    '- [ ] Alpha [impact:: high] [effort:: S]',
    '- [ ] Beta [impact:: low] [effort:: M]',
    '- [ ] Gamma [impact:: med] [effort:: M] [to:: Plan agent]',
    ''
  ].join('\\n'), 'demo.md', {});
  state.locked = false;
  const byTitle = n => allItems().find(x => !x.sub && x.title === n).task;
  handOver(byTitle('Alpha'), 'Plan agent');
  handOver(byTitle('Beta'), 'Plan agent');
  window.__t = byTitle;
  window.__sub = (n, kind) => subSteps(byTitle(n)).find(s => s.slug === byTitle(n).stableId + '-' + kind);
  window.__line = n => { const el = document.querySelector('#board .tenon-card[data-id="' + byTitle(n).id + '"] .runline'); return el ? el.textContent : ''; };
  window.__tone = n => { const el = document.querySelector('#board .tenon-card[data-id="' + byTitle(n).id + '"] .runline'); return el ? el.className : ''; };
  window.__set = runs => { window.__runs = runs; agentRuns = runs; agentRunsSig = JSON.stringify(runs); refreshView(); };
  renderView();
})()`)
await wait(200)

/* ---- the status line ---- */

check('a task handed over with no run yet reads queued',
  await evalJS(`__line('Alpha')`) === 'Plan agent · queued for tonight', await evalJS(`__line('Alpha')`))
check('a task tagged to an agent with no handover has no line',
  await evalJS(`__line('Gamma')`) === '')

await evalJS(`(() => {
  const now = new Date(); now.setHours(2, 5, 0, 0);
  const iso = now.toISOString().slice(0, 19);
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 19);
  const a = __sub('Alpha', 'plan').stableId, b = __sub('Beta', 'plan').stableId;
  const soon = new Date(Date.now() - 10 * 60000);
  window.__soon = new Date(soon.getTime() - soon.getTimezoneOffset() * 60000).toISOString().slice(0, 19);
  __set({ [a]: { sub: a, state: 'running', started: __soon, at: __soon, agent: 'Plan agent' },
          [b]: { sub: b, state: 'done', at: local, label: 'planned', agent: 'Plan agent' } });
})()`)
await wait(200)
check('a run in progress reads working, with when it started',
  await evalJS(`__line('Alpha') === 'Plan agent · working · since ' + runWhen(__soon)`), await evalJS(`__line('Alpha')`))
check('and is drawn in the running tone', /runline--running/.test(await evalJS(`__tone('Alpha')`)))

/* The board applies the Plan agent's tick; its review is then his. */
await evalJS(`(() => {
  const t = __t('Beta'), s = __sub('Beta', 'plan');
  const f = readSub(t, s.line); f.done = true; writeSub(t, s.line, f); refreshView();
})()`)
await wait(200)
check('a written plan reads waiting for you, with when it landed',
  await evalJS(`__line('Beta')`) === 'Plan agent · waiting for you · 02:05', await evalJS(`__line('Beta')`))
check('in the tone that says it is his', /runline--you/.test(await evalJS(`__tone('Beta')`)))

check('a card with no agent part has the same body as before',
  await evalJS(`!document.querySelector('#board .tenon-card[data-id="' + __t('Gamma').id + '"] .tenon-card__body')`))

/* ---- nothing written ---- */

check('no write was attempted but the board saving its own file', await evalJS(`
  window.__blocked.every(b => /^(PUT|HEAD) \\/data\\/todo\\.md/.test(b))
`), await evalJS(`window.__blocked.join(' | ')`))

ws.close()
chrome.kill()
const failed = checks.filter(c => !c).length
console.log(failed ? `\n${failed} failed` : `\nall ${checks.length} checks passed`)
process.exit(failed ? 1 : 0)

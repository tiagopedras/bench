#!/usr/bin/env node
/* Two tabs on one list, both saving: the merge in kanban/js/22a-merging.js as
 * the board runs it (mergeOrAsk() in 23-conflict-modal.js).
 *
 *   node kanban/test_two_tabs.mjs   # or scripts/test-board.sh test_two_tabs.mjs
 *
 * Starts a server of its own over a temp data root, the way test_settings.mjs
 * does, because every check here is a real save. The real data/ and the
 * shared test server are never touched.
 */
import { spawn, execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CHROME_BIN } from './test_browser.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const checks = []
const check = (name, pass, detail = '') => {
  checks.push(pass)
  console.log(`${pass ? '  ok  ' : ' FAIL '} ${name}${detail && !pass ? ` — ${detail}` : ''}`)
}
const wait = ms => new Promise(r => setTimeout(r, ms))
const freePort = () => Number(execFileSync('python3', ['-c',
  'import socket;s=socket.socket();s.bind(("127.0.0.1",0));print(s.getsockname()[1])']).toString())

const LIST = `# To-do

## 1. Work

### To do

- [ ] Alpha \`id:aaa111\`
- [ ] Beta \`id:bbb222\`
- [ ] Gamma \`id:ccc333\`

### Doing

- [ ] Delta \`id:ddd444\`

## 2. Home

### To do

- [ ] Epsilon \`id:eee555\`
`

const root = mkdtempSync(join(tmpdir(), 'bench-two-tabs-test-'))
const data = join(root, 'data')
mkdirSync(join(data, '_test', 'backups'), { recursive: true })
writeFileSync(join(data, '_test', 'todo.md'), LIST)
writeFileSync(join(data, '.current'), '_test')
writeFileSync(join(data, 'profile.md'), '- Name: Morgan\n')
const PORT = freePort()
const CDP = freePort()
const base = `http://127.0.0.1:${PORT}`
const server = spawn('python3', ['-u', join(HERE, 'server.py')], {
  env: { ...process.env, TODOS_SHOW_HIDDEN: '1', TODOS_DATA_ROOT: data, TODOS_PORT: String(PORT), TODOS_NO_BROWSER: '1' },
  stdio: 'ignore',
})
let chrome
const sockets = []
const cleanup = () => {
  sockets.forEach(s => { try { s.close() } catch {} })
  chrome?.kill(); server.kill()
  try { rmSync(root, { recursive: true, force: true }) } catch {}
}
process.on('exit', cleanup)

/* One page's evaluate, over its own DevTools socket. */
async function tab (wsUrl) {
  const ws = new WebSocket(wsUrl)
  sockets.push(ws)
  await new Promise(r => (ws.onopen = r))
  let id = 0
  const pending = new Map()
  ws.onmessage = e => { const m = JSON.parse(e.data); if (pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) } }
  const send = (method, params) => new Promise(res => { const n = ++id; pending.set(n, res); ws.send(JSON.stringify({ id: n, method, params })) })
  return async expr => {
    const x = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })
    if (x.result?.exceptionDetails) throw new Error(JSON.stringify(x.result.exceptionDetails).slice(0, 400))
    return x.result?.result?.value
  }
}

const disk = () => fetch(`${base}/data/todo.md?t=${Date.now()}`, { cache: 'no-store' }).then(r => r.text())
/* A card's title changed the way the drawer changes it. */
const retitle = (key, title) => `(() => { const t = findTaskByKey(${JSON.stringify(key)}); t.title = ${JSON.stringify(title)};
  t.dirty = true; markDirty(); renderView(); })()`
const ready = async evalJS => {
  for (let i = 0; i < 40; i++) {
    try { if (await evalJS(`!!(state.doc && state.diskHash) && !modalEl`)) return true } catch {}  // still loading
    await wait(250)
  }
  return false
}

try {
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`${base}/datasets.json`)).ok) break } catch {}
    await wait(250)
  }
  chrome = spawn(CHROME_BIN, [
    '--headless=new', `--remote-debugging-port=${CDP}`, '--no-first-run',
    `--user-data-dir=${join(root, 'chrome')}`, '--window-size=1400,1000', `${base}/kanban/index.html`,
  ], { stdio: 'ignore' })
  let first
  for (let i = 0; i < 60 && !first; i++) {
    try {
      first = (await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json())
        .find(t => t.type === 'page' && t.url.includes('index.html'))?.webSocketDebuggerUrl
    } catch {}
    if (!first) await wait(250)
  }
  const second = (await (await fetch(`http://127.0.0.1:${CDP}/json/new?${base}/kanban/index.html`, { method: 'PUT' })).json())
    .webSocketDebuggerUrl
  const A = await tab(first)
  const B = await tab(second)
  check('both tabs open the list', await ready(A) && await ready(B))
  // The autosave and the watcher run on their own clocks; the checks below
  // drive saves and reads themselves so the order is the test's, not a race.
  for (const T of [A, B]) await T(`lastSaveAt = Date.now() + 3600e3; lastWatchAt = Date.now() + 3600e3; true`)

  /* ---- different cards, the save refused and merged ---- */
  await A(retitle('aaa111', 'Alpha from A'))
  await B(retitle('eee555', 'Epsilon from B'))
  await A(`saveFile(false)`)
  check('the first tab saves', (await disk()).includes('Alpha from A'))
  await B(`saveFile(false)`)
  check('the second tab is not asked anything', await B(`!modalEl`))
  check('and says it merged', /merged/.test(await B(`$('#status').textContent`)), await B(`$('#status').textContent`))
  await B(`saveFile(false)`)
  let now = await disk()
  check('its save holds both edits', now.includes('Alpha from A') && now.includes('Epsilon from B'), now)
  await A(`watchTick()`)
  await wait(300)
  check('and the first tab picks up the second one', await A(`!!findTaskByKey('eee555') && findTaskByKey('eee555').title === 'Epsilon from B'`))

  /* ---- unsaved here, saved there: the watcher merges ---- */
  await A(retitle('ccc333', 'Gamma from A'))
  await B(retitle('ddd444', 'Delta from B'))
  await B(`saveFile(false)`)
  await A(`watchTick()`)
  await wait(300)
  check('the watcher merges without asking', await A(`!modalEl && state.dirty && findTaskByKey('ddd444').title === 'Delta from B' && findTaskByKey('ccc333').title === 'Gamma from A'`))
  await A(`saveFile(false)`)
  now = await disk()
  check('and the merged save holds both', now.includes('Gamma from A') && now.includes('Delta from B'), now)
  await B(`watchTick()`)
  await wait(300)

  /* ---- the same card on both sides ---- */
  await A(retitle('bbb222', 'Beta from A'))
  await B(retitle('bbb222', 'Beta from B'))
  await A(`saveFile(false)`)
  await B(`saveFile(false)`)
  check('a card changed in both tabs asks', await B(`!!(modalEl && modalEl.textContent.includes('Two versions of a card') && modalEl.textContent.includes('Beta from B'))`))
  await B(`[...modalEl.querySelectorAll('button')].find(b => b.textContent.trim() === 'Keep mine').click()`)
  await wait(200)
  check('keep mine closes it', await B(`!modalEl`))
  await B(`saveFile(false)`)
  now = await disk()
  check('and saves mine for that card, with the rest kept', now.includes('Beta from B') && !now.includes('Beta from A') &&
        now.includes('Gamma from A') && now.includes('Delta from B'), now)

  /* ---- the shared board checks sooner ---- */
  const ticks = await A(`(async () => {
    const real = watchTick; let n = 0; watchTick = () => { n++ };
    state.who = null; lastWatchAt = Date.now() - 4000; watchClockTick();
    state.who = { email: 'a@example.com' }; lastWatchAt = Date.now() - 4000; watchClockTick();
    watchTick = real; state.who = null; return n })()`)
  check('signed in, the file is checked every 3 seconds; on the Mac every 15', ticks === 1, `ticks ${ticks}`)
} catch (err) {
  check('ran to the end', false, err.message)
}

const failed = checks.filter(x => !x).length
console.log(failed ? `\n${failed} failed` : '\nall checks passed')
process.exit(failed ? 1 : 0)

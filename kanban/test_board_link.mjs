#!/usr/bin/env node
/* A banner's link names its board: #!board=<name>!task=<key>.
 *
 *   scripts/test-board.sh test_board_link.mjs
 *
 * Written 26 Oct 2026. Two lists, a link into the one that is not showing: the
 * board switches (through the list menu's own route), opens the card, and takes
 * the board segment off the address. A link naming a list that does not exist,
 * or the one already up, opens the card where it is. It makes a second list, so
 * it runs only against the throwaway server.
 */
import { spawn } from 'node:child_process'
import { CHROME_BIN } from './test_browser.mjs'

const PORT = Number(process.env.CDP_PORT) || 9463
const BOARD = process.env.BOARD_PORT
const BASE = `http://127.0.0.1:${BOARD}`
const checks = []
const check = (name, pass, detail = '') => {
  checks.push(pass)
  console.log(`${pass ? '  ok  ' : ' FAIL '} ${name}${detail ? ` — ${detail}` : ''}`)
}
if (!BOARD) {
  console.error('This makes a list. Run it through: scripts/test-board.sh test_board_link.mjs')
  process.exit(2)
}
const lists = await (await fetch(`${BASE}/datasets.json`)).json()
if (lists.current !== '_test') {
  console.error(`Refusing: the server on ${BOARD} is on "${lists.current}", not _test.`)
  process.exit(2)
}
const post = (path, body) => fetch(`${BASE}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json())
const until = async (fn, ms = 8000) => {
  const end = Date.now() + ms
  while (Date.now() < end) {
    try { if (await fn()) return true } catch {}
    await new Promise(r => setTimeout(r, 200))
  }
  return false
}

/* A second list with one card the first does not have, then back to _test. */
await post('/datasets', { name: 'elsewhere' })
const base = await (await fetch(`${BASE}/data/todo.md`, { cache: 'no-store' })).text()
const doc = ['# To-do', '', '## 1. Work', '', '### Doing', '', '- [ ] **Only on the other list** `#only-there`', ''].join('\n')
const saved = await fetch(`${BASE}/data/todo.md`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: doc, base }) })
await post('/dataset/select', { name: '_test' })

const chrome = spawn(CHROME_BIN, [
  '--headless=new', `--remote-debugging-port=${PORT}`, '--no-first-run',
  `--user-data-dir=${process.env.CHROME_PROFILE || '/tmp/todo-board-link-test-profile'}`, '--window-size=1400,1000',
  `${BASE}/kanban/index.html`
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
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 400))
  return r.result?.result?.value
}

const go = async url => {
  await send('Page.navigate', { url: 'about:blank' })
  await new Promise(r => setTimeout(r, 300))
  await send('Page.navigate', { url })
  await until(() => evalJS(`!!window.state && !!state.doc`))
}
const OPEN = `(state.openTask ? (locate(state.openTask)?.task.title || '') : '')`
const link = frag => `${BASE}/kanban/index.html${frag}`

try {
  check('the second list exists with its card', saved.ok && (await (await fetch(`${BASE}/datasets.json`)).json()).datasets.includes('elsewhere'))

  await go(link('#!board=elsewhere!task=only-there'))
  check('a link naming the other list switches to it', await until(() => evalJS(`state.dataset === 'elsewhere'`)))
  check('and opens the card there', await until(async () => (await evalJS(OPEN)) === 'Only on the other list'),
    await evalJS(`JSON.stringify({ open: state.openTask, titles: state.doc.buckets.flatMap(b => b.tiers).flatMap(t => t.tasks).map(t => t.title), hash: location.hash, pend: state.pendingTask })`))
  check('and the board segment is gone from the address', await evalJS(`!location.hash.includes('board=')`), await evalJS('location.hash'))
  await send('Page.reload', {})
  await new Promise(r => setTimeout(r, 800))
  await until(() => evalJS(`!!window.state && !!state.doc`))
  check('a reload stays on that list rather than switching again', await evalJS(`state.dataset`) === 'elsewhere')

  await post('/dataset/select', { name: '_test' })
  const known = 'Chase the 360 responses'
  await go(link('#!board=no-such-list!task=' + encodeURIComponent(known)))
  check('an unknown list is ignored and the card opens where it is', await until(async () => (await evalJS(OPEN)) === known))
  check('still on _test, and the board segment is gone', await evalJS(`state.dataset === '_test' && !location.hash.includes('board=')`), await evalJS('location.hash'))

  await go(link('#!board=_test!task=' + encodeURIComponent(known)))
  check('naming the list already up opens the card without switching', await until(async () => (await evalJS(OPEN)) === known) && await evalJS(`state.dataset`) === '_test')

  await go(link('#!task=' + encodeURIComponent(known)))
  check('a link with no board behaves as before', await until(async () => (await evalJS(OPEN)) === known))

  await evalJS(`closeDrawer()`)
  await evalJS(`location.hash = '#!board=elsewhere!task=only-there'`)
  check('a link arriving at a tab that is already open switches too', await until(() => evalJS(`state.dataset === 'elsewhere'`)))
} catch (err) {
  check('the suite ran to the end', false, String(err.message || err))
} finally {
  await post('/dataset/select', { name: '_test' }).catch(() => {})
  ws.close()
  chrome.kill()
}

const failed = checks.filter(p => !p).length
console.log(`\n${checks.length - failed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)

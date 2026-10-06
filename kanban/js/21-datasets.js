'use strict';

/* =========================================================================
   Data sets — which private folder under data/ the board reads and writes.

   The dropdown lists every folder the server found; picking one asks the
   server to make it current, then reloads the page rather than trying to
   patch state in place. A switch changes the list, its backups, its Claude
   sessions and its Jira config all at once, so a full reload is the only way
   to be sure nothing from the old one lingers in this tab.

   Which list is loaded is on the button rather than only inside the panel it
   opens. Everything on the board — every count, every date, every name — is
   true of one data set and wrong of the other, and with the switcher buried
   in a menu there was nothing on the page saying which one you were reading.
   ========================================================================= */

/* The button reads "Work And Career ▾", with a plain "Data" label beside it in
   the page. The name is tidied for display only: data/.current, the folder and
   every request keep the raw name ("work-and-career"). Falls back to "Lists ▾"
   when there is no name, which is the board behaving as it did before lists
   existed. */
function prettyDataset(name){
  return String(name || '').replace(/[-_]+/g, ' ').trim()
    .replace(/(^|\s)(\S)/g, (m, sp, ch) => sp + ch.toUpperCase());
}
function setDataMenuLabel(name){
  $('#dataMenuBtn').textContent = (name ? prettyDataset(name) : 'Lists') + ' \u25BE';
}
/* Every list is a row of its own under a "Lists" heading, rather than a name
   inside a closed <select>. A picker that has to be opened to say what it
   holds is one more click on a menu that is already open, and it hid how many
   lists there even are — which for two or three rows is the whole of the
   information. The current one is ticked and does nothing when clicked.

   They are `dropdown-item`s, the same object as Undo and Backups above them,
   because picking a list is an action the menu performs like any other. */
function datasetItemHTML(name, current){
  return '<button class="dropdown-item dsitem' + (current ? ' current' : '') + '"' +
    ' role="menuitem" data-dataset="' + esc(name) + '"' +
    ' title="' + esc(name) + '"' +
    (current ? ' aria-current="true"' : '') + '>' +
    '<span class="dstick" aria-hidden="true">' + (current ? '\u2713' : '') + '</span>' +
    esc(prettyDataset(name)) + '</button>';
}

async function loadDatasets(){
  try {
    const data = await getJSON(DATASETS_URL);
    $('#datasetList').innerHTML =
      (data.datasets || []).map(name => datasetItemHTML(name, name === data.current)).join('') +
      '<button class="dropdown-item dsitem" role="menuitem" data-dataset="__new__">' +
        '<span class="dstick" aria-hidden="true"></span>+ New list…</button>';
    state.datasets = true;
    state.dataset = data.current || '';
    setDataMenuLabel(data.current);
    if (!state.locked) $('#datasetMenu').classList.remove('hidden');
    // A server that answers with no lists at all, which is a fresh checkout.
    welcomeIfEmpty(data);
  } catch (err) {
    // No /datasets.json — an older server, or none at all. One list, no
    // picker, exactly as the board behaved before this existed.
    state.datasets = false;
    setDataMenuLabel(listFolder ? listFolder.name : '');
    $('#datasetMenu').classList.add('hidden');
  }
}

async function switchDataset(name){
  try {
    await postJSON('/dataset/select', { name });
    location.reload();
  } catch (err) {
    alert('Could not switch lists.\n\n' + (err.message || err));
    loadDatasets();
  }
}

/* ---- Making a list ------------------------------------------------------
   One `prompt()` for a name until 17 Sep 2026, which produced a shell: a
   todo.md with one bucket called Tasks and nothing else. Everything that makes
   a list actually work — a brief per bucket, and the README saying which
   buckets the list has — was left unmade, so every task in a new list planned
   against the fallback agent with nothing to read. `personal` behaved that way
   from the day it was made.

   So it is a wizard: the name, then the buckets, then a line about each saying
   what kind of work lands in it. That last one is the part worth collecting —
   it becomes the opening of the bucket's own brief rather than boilerplate
   under a "not filled in yet" marker, which is the difference between a brief
   an agent is pointed at and one it is not. Everything else is scaffolded from
   it by create_dataset() in kanban/server.py. */

const WIZARD_BUCKETS = ['People', 'Work oversight', 'Design System', 'Strategic'];

let wizard = null;

function wizardHTML(){
  if (wizard.step === 0) {
    return '<div class="repdoc">' +
      '<p>What is this list called? It becomes a folder under <code>data/</code>, ' +
      'and the name on the switcher.</p>' +
      '<input id="wizName" class="field" type="text" placeholder="Personal" ' +
        'value="' + esc(wizard.name) + '">' +
    '</div>';
  }
  if (wizard.step === 1) {
    return '<div class="repdoc">' +
      '<p>Which buckets? One per line, in the order they should read on the board. ' +
      'Each gets its own folder, its own brief and its own planner.</p>' +
      '<textarea id="wizBuckets" class="redowhy" rows="6" ' +
        'placeholder="' + esc(WIZARD_BUCKETS.join('\n')) + '">' +
        esc(wizard.buckets.map(b => b.name).join('\n')) + '</textarea>' +
    '</div>';
  }
  const b = wizard.buckets[wizard.step - 2];
  return '<div class="repdoc">' +
    '<p>What kind of work lands in <strong>' + esc(b.name) + '</strong>? One line. ' +
    'It opens the bucket\u2019s brief, which is what the planning agent reads ' +
    'before it plans anything in here.</p>' +
    '<textarea id="wizAbout" class="redowhy" rows="3" ' +
      'placeholder="Probation reviews, performance, hiring, objectives, growth conversations.">' +
      esc(b.about || '') + '</textarea>' +
    '<p class="qwhy">You can leave it blank and write the brief later \u2014 while it is ' +
    'empty, no agent is pointed at it.</p>' +
  '</div>';
}

function wizardRead(){
  if (wizard.step === 0) {
    const el = $('#wizName');
    if (el) wizard.name = el.value.trim();
    return !!wizard.name;
  }
  if (wizard.step === 1) {
    const el = $('#wizBuckets');
    const was = wizard.buckets;
    if (el) {
      const names = el.value.split('\n').map(n => n.trim()).filter(Boolean);
      // Keep a description already typed against a bucket whose name has not
      // changed, so stepping back and forward does not lose it.
      wizard.buckets = names.map(name => ({
        name, about: (was.find(b => b.name === name) || {}).about || ''
      }));
    }
    return wizard.buckets.length > 0;
  }
  const el = $('#wizAbout');
  if (el) wizard.buckets[wizard.step - 2].about = el.value.trim();
  return true;
}

function wizardSteps(){ return 2 + wizard.buckets.length; }

function showWizard(){
  const last = wizard.step === wizardSteps() - 1;
  const buttons = [];
  if (wizard.step > 0) buttons.push({ label:'Back', run: () => { wizard.step--; showWizard(); } });
  buttons.push({ label: last ? 'Make the list' : 'Next', primary:true, run: () => {
    if (!wizardRead()) {
      showToast(wizard.step === 0 ? 'A list needs a name.' : 'A list needs at least one bucket.', 'bad');
      showWizard();
      return;
    }
    // Read again after the buckets step, since the count it just set is what
    // says how many steps there are.
    if (wizard.step >= wizardSteps() - 1) { finishWizard(); return; }
    wizard.step++;
    showWizard();
  } });
  buttons.push({ label:'Cancel', run: () => { wizard = null; loadDatasets(); } });
  const sub = wizard.step === 0 ? 'Step 1 of 2, at least'
    : 'Step ' + (wizard.step + 1) + ' of ' + wizardSteps();
  showModal('A new list', esc(sub), wizardHTML(), buttons, { cls:'wizard' });
  const first = $('#wizName') || $('#wizBuckets') || $('#wizAbout');
  if (first) { first.focus(); if (first.select) first.select(); }
}

async function finishWizard(){
  const body = { name: wizard.name, buckets: wizard.buckets };
  wizard = null;
  try {
    await postJSON('/datasets', body);
    location.reload();
  } catch (err) {
    alert('Could not create that list.\n\n' + (err.message || err));
    loadDatasets();
  }
}

function createDataset(){
  wizard = { step: 0, name: '', buckets: WIZARD_BUCKETS.map(name => ({ name, about: '' })) };
  showWizard();
}

/* Nothing to switch into, which is what a fresh clone looks like: `data/` is
   gitignored, so the first time the board is opened on a new machine there is
   no list at all and every route past current_dataset() resolves a path
   through None. A board with no lists drew a bare, broken board and said
   nothing; it opens the wizard instead. */
function welcomeIfEmpty(data){
  if ((data.datasets || []).length) return false;
  showModal('Nothing here yet', 'No list on this machine',
    '<div class="repdoc">' +
      '<p>There is no list in <code>data/</code> yet \u2014 which is what a fresh ' +
      'checkout looks like, since that folder is never committed.</p>' +
      '<p>Make one now and the board has something to draw.</p>' +
    '</div>',
    [{ label:'Make a list', primary:true, run: () => createDataset() }], {});
  return true;
}

$('#datasetList').onclick = e => {
  const btn = e.target.closest('[data-dataset]');
  if (!btn) return;
  const name = btn.dataset.dataset;
  if (name === '__new__') { createDataset(); return; }
  // The list already being read. Nothing to switch to, and reloading the page
  // onto the same folder would only look like a fault.
  if (btn.classList.contains('current')) return;
  if (state.dirty) {
    alert('You have unsaved changes on this list.\n\nSave or discard them first, then switch lists.');
    return;
  }
  switchDataset(name);
};

/* Stand an example list in for a missing todo.md, and say plainly that is what
   happened. Two situations reach here: a host serving this page as static files,
   where there is no data/ folder at all because git never had one, and the local
   board opened before the launcher is running.

   It reuses the Backup Preview lock rather than adding a mode of its own. The
   reason is the same one: invented tasks must never be able to reach disk as the
   live list. Locking is what already guarantees that everywhere — every write
   path checks it — so the example data gets it for free rather than needing a
   second set of guards that could fall out of step with the first.

   Returns false rather than throwing when there is no example file either, so
   loadFile can fall through to its real error. */
async function loadDemo(){
  try {
    const res = await fetch(DEMO_URL + '?t=' + Date.now(), { cache:'no-store' });
    if (!res.ok) return false;
    const text = await res.text();
    if (!parseDoc(text).buckets.length) return false;
    closeDrawer();
    load(text, 'demo.md', { readOnly:true });
    state.diskStamp = null;
    state.diskHash = null;
    state.demo = true;
    state.locked = true;
    state.lockedLabel = 'an example list, not yours';
    updateLockUI();
    markClean('');
    renderView();
    applyPendingTask();
    syncFolderButton();
    reopenRememberedFolder();
    return true;
  } catch (err) {
    return false;
  }
}

/* ---- A folder on this computer ------------------------------------------
   The hosted copy (Vercel) serves static files and nothing else, so on its own
   it can only ever show demo.md. In Chrome and Edge the page can instead be
   pointed at a list folder on the person's own disk through the File System
   Access API, and read and write todo.md there itself with no helper running.
   Where the browser has no showDirectoryPicker the demo stays exactly as it
   was: read-only, with nothing new on the lock bar.

   Only reached from the demo. The local board served by kanban/server.py
   never gets here, because loadFile() reads /data/todo.md first and a real
   list always wins, so nothing below changes how the local board behaves.

   The folder is one list, the same shape as data/<dataset>/: todo.md at its
   root, and backups/ beside it. What the page does with it:
     - reads and writes todo.md, with the same change-on-disk check the server
       makes (a hash of what this tab last read, compared before every write);
     - writes one backup of the file as it found it into backups/ before the
       first save of each visit, named the way the server names its own;
     - keeps a crash copy of unsaved work in localStorage, dropped after every
       good save and offered back the next time the folder is opened.
   Everything else the board asks the server for stays unanswered, exactly as
   on the demo: /plans.json, /reports.json, /backups.json, /projects.json,
   /schedule.json and /queue.json are plain file reads and could be answered
   from the folder in a later pass; the terminal, the planning agent, the
   companion and the Claude chat need a process and never can be.

   The page's code is fetched from a public URL on every visit, so a real list
   opened here is only as safe as that copy of the code. The dialog before the
   picker says so. */

let listFolder = null;          // FileSystemDirectoryHandle while a folder is open
let folderBackedUp = false;     // one backup per visit, before the first save
let rememberedFolder = null;    // a handle from last visit, waiting for a click

function folderSupported(){ return typeof window.showDirectoryPicker === 'function'; }

/* Handles survive a reload only in IndexedDB — localStorage holds strings. */
function folderDB(){
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('todo-board-folder', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('handles');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function folderStore(mode, fn){
  try {
    const db = await folderDB();
    return await new Promise(resolve => {
      const tx = db.transaction('handles', mode);
      const req = fn(tx.objectStore('handles'));
      tx.oncomplete = () => resolve(req && req.result);
      tx.onerror = () => resolve(null);
    });
  } catch (err) { return null; }
}
const rememberFolder = h => folderStore('readwrite', s => s.put(h, 'list'));
const forgetFolder = () => folderStore('readwrite', s => s.delete('list'));
const recallFolder = () => folderStore('readonly', s => s.get('list'));

/* Stands in for the server's X-Todo-Hash. Only ever compared with itself, so
   it does not have to match the server's digest, only to change when the
   bytes do. FNV-1a, 32 bits. */
function textHash(text){
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0') + ':' + text.length;
}

async function folderRead(){
  const file = await (await listFolder.getFileHandle('todo.md')).getFile();
  const text = await file.text();
  return { text, stamp: new Date(file.lastModified).toUTCString(), hash: textHash(text) };
}

/* Every read of the list goes through here, so loadFile, reload and the
   watcher do not need to know which of the two places it came from. With no
   folder open it is the same fetch they always made. In folder mode the
   answer is shaped like the server's, headers and all. */
async function fetchList(method){
  if (!listFolder) {
    return method === 'HEAD'
      ? fetch(FILE_URL, { method:'HEAD', cache:'no-store' })
      : fetch(FILE_URL + '?t=' + Date.now(), { cache:'no-store' });
  }
  try {
    const v = await folderRead();
    return new Response(method === 'HEAD' ? null : v.text,
      { headers: { 'Last-Modified': v.stamp, 'X-Todo-Hash': v.hash } });
  } catch (err) {
    return new Response(null, { status: 404 });
  }
}

const crashKey = () => 'bench-crash:' + (listFolder ? listFolder.name : '');
function keepCrashCopy(text){ try { localStorage.setItem(crashKey(), text); } catch (err) {} }
function dropCrashCopy(){ try { localStorage.removeItem(crashKey()); } catch (err) {} }

function backupStamp(){
  const d = new Date(), p = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + '-' +
    p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
}
async function folderBackup(text){
  const dir = await listFolder.getDirectoryHandle('backups', { create:true });
  const name = 'todo-backup-' + backupStamp() + '.md';
  const w = await (await dir.getFileHandle(name, { create:true })).createWritable();
  await w.write(text);
  await w.close();
  return name;
}

/* saveFile() hands over here when a folder is open. Same order as the
   server's do_PUT: refuse a write built on a version that has moved, back up,
   then write. */
async function saveToFolder(auto){
  const text = serializeDoc(state.doc);
  keepCrashCopy(text);
  try {
    const disk = await folderRead();
    if (state.diskHash && disk.hash !== state.diskHash) {
      state.diskStamp = disk.stamp;
      state.diskHash = disk.hash;
      markDirty();
      autoStatus('not saved — todo.md changed on disk since this tab read it');
      await reload();
      return;
    }
    let backup = '';
    if (!folderBackedUp) { backup = await folderBackup(disk.text); folderBackedUp = true; }
    const w = await (await listFolder.getFileHandle('todo.md')).createWritable();
    await w.write(text);
    await w.close();
    dropCrashCopy();
    state.originalText = text;
    lastSaveAt = Date.now();
    markClean((auto ? 'auto-saved' : 'saved ' + new Date().toLocaleTimeString()) +
      (backup ? ' · backup: backups/' + backup : '') + ' · ' + listFolder.name + '/todo.md', auto);
    await rememberStamp();
  } catch (err) {
    markDirty();
    if (auto) {
      autoStatus('auto-save failed at ' + new Date().toLocaleTimeString() + ' — your changes are still here');
      $('#status').classList.add('dirty');
      return;
    }
    alert('Could not save todo.md in ' + listFolder.name + ': ' + (err.message || err) +
          '\n\nNothing was written. Your changes are also kept in this browser and are offered back ' +
          'the next time you open this folder. Use “Download copy” if you need them out now.');
  }
}

/* The lock bar's button. Shown on the demo only, and only where the browser
   can open a folder at all. */
function syncFolderButton(){
  const btn = $('#openFolder');
  if (!btn) return;
  btn.classList.toggle('hidden', !(state.demo && folderSupported()));
  btn.textContent = rememberedFolder ? 'Reopen ' + rememberedFolder.name : 'Open a folder…';
  /* In folder mode the Data menu is open for the first time on this page, and
     three of its items only talk to the helper. Off rather than failing. */
  ['#closeFolder'].forEach(id => $(id) && $(id).classList.toggle('hidden', !listFolder));
  ['#backupsBtn', '#refCardsBtn', '#runAgentBtn'].forEach(id => $(id) && $(id).classList.toggle('hidden', !!listFolder));
}

/* Last visit's folder. Opened straight away if the browser still grants it;
   otherwise the button offers it by name, because asking again needs a click. */
async function reopenRememberedFolder(){
  if (!folderSupported() || listFolder) return;
  const h = await recallFolder();
  if (!h) return;
  rememberedFolder = h;
  syncFolderButton();
  try {
    if (await h.queryPermission({ mode:'readwrite' }) === 'granted') await openFolder(h);
  } catch (err) { /* stays on the button */ }
}

function askForFolder(){
  if (rememberedFolder) {
    const h = rememberedFolder;
    h.requestPermission({ mode:'readwrite' })
      .then(p => p === 'granted' ? openFolder(h) : null)
      .catch(err => alert('Could not open ' + h.name + '.\n\n' + (err.message || err)));
    return;
  }
  showModal('Open a list folder', 'On this computer, in this browser',
    '<div class="repdoc">' +
      '<p>Pick the folder that holds your <code>todo.md</code>. The board reads and saves it ' +
      'there, and keeps a copy of the file as it found it in <code>backups/</code> before ' +
      'the first save.</p>' +
      '<p>Nothing is uploaded: the list stays on this computer. This page’s code is ' +
      'fetched from <strong>' + esc(location.host) + '</strong> each time you open it, so the ' +
      'list is only as safe as that copy of the code.</p>' +
      '<p class="qwhy">Plans, reports, agents and chat need the board helper on your own ' +
      'machine, so they stay off here.</p>' +
    '</div>',
    [{ label:'Choose folder', primary:true, run: async () => {
        let h;
        try { h = await window.showDirectoryPicker({ id:'todo-list', mode:'readwrite' }); }
        catch (err) { return; }   // cancelled
        openFolder(h);
      } },
     { label:'Cancel' }], {});
}

async function openFolder(handle){
  try {
    await (await handle.getFileHandle('todo.md')).getFile();
  } catch (err) {
    alert('There is no todo.md in ' + handle.name + '.\n\nPick the folder that holds the list itself.');
    return;
  }
  listFolder = handle;
  folderBackedUp = false;
  rememberedFolder = null;
  rememberFolder(handle);
  closeDrawer();
  await loadFile();
  if (!listFolder) return;   // loadFile could not read it and fell back
  setDataMenuLabel(handle.name);
  syncFolderButton();
  offerCrashCopy();
}

async function closeFolder(){
  if (state.dirty) {
    alert('You have unsaved changes on this list.\n\nSave or discard them first, then close the folder.');
    return;
  }
  listFolder = null;
  // Awaited, or the demo would find the handle still stored and reopen it.
  await forgetFolder();
  setDataMenuLabel('');
  loadDemo();
}

/* Changes that never reached the file last time, because the tab or the
   browser closed first. Only offered when they differ from what is on disk. */
function offerCrashCopy(){
  let copy = null;
  try { copy = localStorage.getItem(crashKey()); } catch (err) {}
  if (!copy || copy === state.originalText) { dropCrashCopy(); return; }
  showModal('Unsaved changes from last time', esc(listFolder.name + '/todo.md'),
    changesHTML('Not saved last time', describeChanges(state.originalText, copy),
      'Nothing found that differs from the file.'),
    [{ label:'Put them back', primary:true, run: () => {
        const disk = state.originalText;
        load(copy, 'todo.md');
        state.originalText = disk;   // the file is still the old version
        markDirty();
      } },
     { label:'Download them', run: () => downloadText(copy, 'todo-unsaved.md') },
     { label:'Throw them away', danger:true, run: () => dropCrashCopy() }]);
}

if ($('#openFolder')) $('#openFolder').onclick = askForFolder;
if ($('#closeFolder')) $('#closeFolder').onclick = closeFolder;

/* auto: this save was the timer's idea, not his, so a failure must not throw a
   dialog in front of whatever he is doing. It shows in the status line instead,
   and the changes stay in the tab either way. */
async function saveFile(auto, forceBackup){
  // The one guard that actually matters: state.doc can hold an old backup while
  // locked, and this must never let that overwrite the live todo.md.
  if (state.locked || !state.doc || !state.dirty) return;
  // A folder opened on the hosted page: written by the page itself.
  if (listFolder) return saveToFolder(auto);
  const text = serializeDoc(state.doc);
  try {
    /* The stamp this tab last agreed with, so the server can refuse a write
       built on a version of the file that has since moved. Absent on the very
       first save of a session, before any HEAD has run — the server treats a
       missing header as "no opinion" and writes, which is the old behaviour and
       the right one for a tab that has not yet read the file. */
    const headers = { 'Content-Type':'text/markdown; charset=utf-8' };
    if (state.diskStamp) headers['If-Unmodified-Since'] = state.diskStamp;
    /* And the content this document was built on, which is the check the stamp
       cannot make: Last-Modified carries one second, so a write landing inside
       the same second as this tab's last read looks unchanged to it. */
    if (state.diskHash) headers['If-Match'] = state.diskHash;
    const res = await fetch(FILE_URL + (forceBackup ? '?backup=force' : ''), {
      method: 'PUT', headers, body: text
    });
    const info = await res.json().catch(() => ({}));
    /* 409 is the file having moved under this tab, or a migration holding the
       list. Handled here rather than thrown, because the catch below calls
       markDirty() and the autosave would come straight back in four seconds and
       get the same answer, forever.

       Taking the server's stamp first is what stops the same loop through the
       modal: reload() may leave his changes in place if he keeps them, and
       without this the next autosave would still be carrying the old stamp. The
       watcher takes a changed stamp once per outside change for the same
       reason. */
    if (res.status === 409) {
      if (info.disk) state.diskStamp = info.disk;
      if (info.hash) state.diskHash = info.hash;
      if (info.migrating) {
        markDirty();
        autoStatus('not saved — a migration is running on this list. Your changes are still here.');
        return;
      }
      markDirty();
      autoStatus('not saved — todo.md changed on disk since this tab read it');
      await reload();
      return;
    }
    if (!res.ok) throw new Error(info.error || ('the server answered ' + res.status));
    state.originalText = text;
    lastSaveAt = Date.now();
    // The relative stamp is the timestamp on an auto-save, so the clock time
    // would only repeat it. A manual save keeps the clock.
    markClean((auto ? 'auto-saved' : 'saved ' + new Date().toLocaleTimeString()) +
      (info.backup ? ' · backup: data/backups/' + info.backup : '') +
      (info.weekly ? ' · weekly: data/backups/' + info.weekly : '') + ' · todo.md', auto);
    // Our own write moved the file, so record it — otherwise the watcher would
    // read the new timestamp as somebody else's edit.
    await rememberStamp();
  } catch (err) {
    markDirty();
    if (auto) {
      // markDirty has just written "unsaved changes" over the line; this replaces
      // it, and keeps the clock as well as the stamp because a failure is worth
      // being able to pin to a moment.
      autoStatus('auto-save failed at ' + new Date().toLocaleTimeString() + ' — your changes are still here');
      $('#status').classList.add('dirty');
      return;
    }
    // A failed fetch means the local helper is not answering, not a bad file.
    const helperGone = err instanceof TypeError || /failed to fetch|networkerror|load failed/i.test(String(err.message || err));
    if (helperGone) {
      $('#status').textContent = 'not saved — the board helper has stopped';
      alert('Nothing was saved, because the board helper is not running.\n\n' +
            'Your changes are still here in this tab, so do not close it.\n\n' +
            'Open Bench.app again, or double-click run.command in the bench folder. It saves on ' +
            'its own every few seconds once it can reach the file again.\n\n' +
            'If you cannot restart it, use “Download copy” to get the changes out.');
    } else {
      alert('Could not save todo.md: ' + (err.message || err) +
            '\n\nNothing was written. Use “Download copy” if you need the changes out of the browser.');
    }
  }
}

function downloadText(text, name){
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type:'text/markdown' }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}


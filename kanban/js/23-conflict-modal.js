'use strict';

/* =========================================================================
   Conflict modal
   ========================================================================= */

/* The open modal's outermost node (Tenon's .tenon-modal), or null. Callers
   query their own body through it straight after showModal() returns. */
let modalEl = null;
/* The node the React root lives on. The Modal portals to body beside it. */
let modalHost = null;
/* Set by a modal whose body is a React tree, so shutting it lets the tree go
   rather than leaving a root subscribed to a node that has left the page. */
let modalOnClose = null;

function closeModal(){
  if (modalHost) { BoardUI.unmountBoardModal(modalHost); modalHost.remove(); modalHost = null; }
  modalEl = null;
  if (modalOnClose) { const done = modalOnClose; modalOnClose = null; done(); }
}

/* buttons: [{ label, primary, danger, agree, reject, run }] — the first is the
   safe default, and takes focus. The × in the head, the scrim and Escape all
   close without running anything. ⌘↵ / Ctrl+↵ presses the primary button, but
   only from inside a text field, so a plain confirmation like offerReload()'s
   cannot be answered by a stray shortcut aimed at something else. Tenon's
   Modal does both; this function only says what the buttons run.
   opts: { wide, cls, onClose, required, keepOpen } — required takes the × away and
   makes Escape and the scrim do nothing (first-run setup); required and keepOpen
   both stop a button closing the modal for its run(), which closes it itself
   once it has what it needs; wide is the document-width variant a written
   report opens in, rather than the confirmation-sized default; cls is one more
   class on the box, for a modal with a body shape of its own (the plan
   reader); onClose runs once when the modal goes, whichever way it goes.
   The body is drawn into .mid, which callers query. */
function showModal(heading, sub, bodyHTML, buttons, opts){
  closeModal();
  modalOnClose = (opts && opts.onClose) || null;
  modalHost = document.createElement('div');
  document.body.appendChild(modalHost);
  modalEl = BoardUI.mountBoardModal(modalHost, {
    heading, subHTML: sub || '', bodyHTML, wide: !!(opts && opts.wide), cls: (opts && opts.cls) || '', required: !!(opts && opts.required),
    buttons: buttons.map(b => ({ label: b.label, primary: !!b.primary, danger: !!b.danger, agree: !!b.agree, reject: !!b.reject })),
    onPick: i => { const b = buttons[i]; if (!(opts && (opts.required || opts.keepOpen))) closeModal(); if (b.run) b.run(); },
    onClose: closeModal,
  });
}

/* Changes of the owner's own, as against the board's own tidy-up on load. Only the
   first kind is worth stopping for. */
function hasOwnChanges(){ return state.dirty && !state.migratedOnly; }

async function reload(){
  if (state.locked) return;
  if (!hasOwnChanges()) return loadFile();
  // Same collision as an outside edit, so it gets the same answer: merged when
  // the two touched different cards, the modal when they did not.
  await mergeOrAsk(true);
}

/* The file moved while this tab had changes of its own: a save refused with a
   409, or the watcher seeing a new version. Merged card by card first
   (mergeLists() in 22a-merging.js), so two people on the shared board who
   edited different cards never see a modal. Cards both changed ask which
   version to keep. A change outside the cards on both sides, or a file that
   cannot be read, falls back to choosing a whole copy.

   The stamp and hash adopted are the ones that came with the text merged
   against, so the save that follows is checked against exactly that. */
async function mergeOrAsk(manual){
  let disk = null;
  try {
    const res = await fetchList();
    if (res.ok) disk = { text: await res.text(),
                         stamp: res.headers.get('Last-Modified') || null,
                         hash: res.headers.get('X-Todo-Hash') || null };
  } catch (err) { /* handled below by the null check */ }
  if (!disk) return offerReload(null, manual);
  state.diskStamp = disk.stamp;
  state.diskHash = disk.hash;

  const base = state.originalText;
  const mineText = serializeDoc(state.doc);
  const merged = mergeLists(base, mineText, disk.text, 'mine');
  if (!merged) return offerReload(disk.text, manual);
  if (!merged.clashes.length) return applyMerge(disk, merged.text, mineText);

  const one = merged.clashes.length === 1;
  const sub = 'Someone else saved this list while you were editing it. Everything else is merged, ' +
    'but ' + (one ? 'this card was' : 'these cards were') + ' changed in both copies.';
  const body = '<div class="changes"><h3>Changed in both copies (' + merged.clashes.length + ')</h3><ul>' +
    merged.clashes.map(title => '<li><span><strong>' + mdInline(title) + '</strong></span></li>').join('') +
    '</ul></div>';
  const pick = prefer => () => {
    closeModal();
    applyMerge(disk, mergeLists(base, mineText, disk.text, prefer).text, mineText);
  };
  showModal('Two versions of ' + (one ? 'a card' : 'some cards'), sub, body, [
    { label: 'Keep mine', primary: true, run: pick('mine') },
    { label: 'Use the other copy', run: pick('theirs') },
    { label: 'Download my copy first', run: () => downloadText(mineText, state.fileName) },
  ], { required: true });
}

/* The merged list on the board, with the drawer still on the card that was
   open. What disk holds becomes the version this tab last read, so the merge
   itself is the unsaved change the autosave writes next. */
function applyMerge(disk, text, mineText){
  const changes = describeChanges(mineText, text);
  const open = state.openTask != null && locate(state.openTask);
  const openKey = open && open.task.stableId;
  closeDrawer();                                   // ids are rebuilt by the parse
  const before = cardPlaces();
  load(text, state.fileName);
  settleChanges(before, changes, null);
  if (openKey) openTaskByKey(openKey);
  state.originalText = disk.text;
  // Nothing of this tab's was left to add. load() may still have found its own
  // tidy-up to save, which stands.
  if (text === disk.text) { if (!state.dirty) markClean('reloaded — the file changed on disk'); return; }
  const n = changes ? changes.length : 0;
  applyDirty('merged ' + (n ? n + ' change' + (n > 1 ? 's' : '') + ' from' : 'with') + ' the other copy');
}

/* The modal both Reload and the outside-edit watcher land in when there is
   something here it would overwrite. diskText may be null if the file could
   not be read, in which case discarding is not offered. */
function offerReload(diskText, manual){
  const mine = describeChanges(state.originalText, serializeDoc(state.doc));
  const theirs = diskText === null ? null : describeChanges(state.originalText, diskText);

  const sub = '<strong>todo.md changed on disk</strong> while you had unsaved changes here. ' +
    'Nothing has been overwritten either way — pick which version wins.';

  const body =
    changesHTML('Your unsaved changes', mine, 'Nothing — your tab matches the file.') +
    (diskText === null
      ? '<div class="changes"><h3>Changed on disk</h3><div class="none">Could not read the file to compare.</div></div>'
      : changesHTML('Changed on disk', theirs, 'Nothing found — the file may only have been re-saved.'));

  const buttons = [{ label:'Keep my changes', primary:true }];
  buttons.push({ label:'Download my copy first', run: () => downloadText(serializeDoc(state.doc), state.fileName) });
  if (diskText !== null) {
    buttons.push({ label:'Discard mine, use the file', danger:true, run: () => {
      try { load(diskText, 'todo.md'); rememberStamp(); closeDrawer(); markClean('reloaded from disk'); }
      catch (err) { alert('Could not read the file on disk: ' + (err.message || err)); }
    }});
  }
  showModal('Two versions of this list', sub, body, buttons);
}


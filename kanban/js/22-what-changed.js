'use strict';

/* =========================================================================
   Telling the owner what actually changed

   Both halves of the conflict modal need the same answer to the same question:
   what is different between these two versions of the file? Tasks are matched
   by title, because a title is what the owner recognises — an id would be accurate and
   useless. Repeated titles are matched in the order they appear.
   ========================================================================= */

function flattenDoc(doc){
  const seen = Object.create(null);
  const out = new Map();
  doc.buckets.forEach(b => b.tiers.forEach(tier => tier.tasks.forEach(t => {
    /* A slug is a real identity — a task carrying one is still the same task
       after it is renamed. Everything else falls back to its title. */
    const base = t.slug ? 'slug:' + t.slug : t.title.trim().toLowerCase();
    seen[base] = (seen[base] || 0) + 1;
    const lines = serializeTask(t);
    out.set(base + '#' + seen[base], {
      title: t.title, bucket: b.name, tier: tier.name, done: t.done,
      block: lines.join('\n'),
      body: lines.slice(1).join('\n').trim()
    });
  })));
  return out;
}

/* An added task and a removed one in the same column, carrying the same
   sub-steps, is one task that was renamed. Saying so is worth the pass: "new"
   plus "deleted" reads like work was lost when nothing was. */
function foldRenames(changes){
  const added = changes.filter(c => c.what === 'added' && c.body);
  const removed = changes.filter(c => c.what === 'removed' && c.body);
  const used = new Set();
  removed.forEach(r => {
    const hit = added.find(x => !used.has(x) && x.body === r.body &&
                                x.bucket === r.bucket && x.tier === r.tier);
    if (!hit) return;
    used.add(hit);
    hit.what = 'renamed';
    hit.where = 'was “' + r.title + '”';
    r.drop = true;
  });
  return changes.filter(c => !c.drop);
}

/* One line per task that moved, in the order they appear in the file. */
function describeChanges(fromText, toText){
  let a, b;
  try { a = flattenDoc(parseDoc(fromText)); b = flattenDoc(parseDoc(toText)); }
  catch (err) { return null; }          // unparseable: better to say nothing than to guess

  const changes = [];
  b.forEach((to, key) => {
    const from = a.get(key);
    if (!from) {
      changes.push({ what:'added', title:to.title, bucket:to.bucket, tier:to.tier, body:to.body,
                     where:to.bucket + ' · ' + (to.done ? DONE_COL : to.tier) });
      return;
    }
    if (from.done !== to.done) {
      changes.push({ what: to.done ? 'ticked' : 'untick', title: to.title,
                     where: to.done ? 'marked done' : 'put back to ' + to.tier });
      return;
    }
    if (from.tier !== to.tier || from.bucket !== to.bucket) {
      changes.push({ what:'moved', title:to.title,
                     where: (from.bucket !== to.bucket ? from.bucket + ' · ' : '') + from.tier +
                            ' → ' + (to.bucket !== from.bucket ? to.bucket + ' · ' : '') + to.tier });
      return;
    }
    if (from.block !== to.block) changes.push({ what:'edited', title:to.title, where:to.bucket + ' · ' + to.tier });
  });
  a.forEach((from, key) => {
    if (!b.has(key)) changes.push({ what:'removed', title:from.title, bucket:from.bucket,
                                    tier:from.tier, body:from.body,
                                    where:'was in ' + from.bucket + ' · ' + from.tier });
  });
  return foldRenames(changes);
}

const CHANGE_LABEL = { added:'new', removed:'deleted', ticked:'done', untick:'reopened',
                       moved:'moved', edited:'edited', renamed:'renamed' };

function changesHTML(title, changes, blank, limit){
  let body;
  if (changes === null) body = '<div class="none">Could not read the details — treat both versions as different.</div>';
  else if (!changes.length) body = '<div class="none">' + esc(blank) + '</div>';
  else {
    const cap = limit || 12;
    const shown = changes.slice(0, cap);
    body = '<ul>' + shown.map(c =>
      '<li><span class="what ' + c.what + '">' + CHANGE_LABEL[c.what] + '</span>' +
      '<span><strong>' + mdInline(c.title) + '</strong>' +
      (c.where ? ' <span class="where">' + esc(c.where) + '</span>' : '') + '</span></li>').join('') +
      '</ul>';
    if (changes.length > cap) {
      body += '<div class="none">…and ' + (changes.length - cap) + ' more.</div>';
    }
  }
  return '<div class="changes"><h3>' + esc(title) +
    (Array.isArray(changes) && changes.length ? ' (' + changes.length + ')' : '') + '</h3>' + body + '</div>';
}


/* A title as something to match on: case, runs of spaces and the bold marks
   a pasted title can carry all ignored. Shared by the change list below and
   by pa-working.json, which names tasks the way pa saw them. */
function titleKey(s){
  return String(s || '').replace(/\*\*/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

/* The tasks a change list leaves standing on the board, by titleKey, for the
   glow that follows a reload from disk (settleChanges() in
   24-autosave-watching.js). A deleted task has no card left to light. */
function changedTitles(changes){
  return new Set((changes || []).filter(c => c.what !== 'removed').map(c => titleKey(c.title)));
}

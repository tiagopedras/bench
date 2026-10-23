'use strict';

/* =========================================================================
   Merging two copies of the list

   On the shared board two people edit one todo.md. Each tab holds the whole
   list and saves all of it, and the server refuses a save built on a version
   that has since moved (do_PUT's 409). Until this, the board then asked which
   whole copy wins, even when the two people had touched different cards.

   mergeLists() is the three-way merge that runs first. It takes the version
   this tab last read (base), this tab's document (mine) and the file now
   (theirs). A card only one side changed takes that side's version, a card
   both changed the same way is that version, and a card both changed
   differently is a clash, settled by `prefer`. A move between columns is a
   change to the card like any other.

   What sits outside the cards (the lines above the first bucket, a bucket's
   heading and intro, a column's heading) may have moved on one side only.
   When both moved it differently, or a card lands in a column the merged
   frame has no room for, it answers null and the choose-a-copy modal
   decides, as before.
   ========================================================================= */

/* The list with its cards taken out, as a string to compare. The blank lines
   between and after cards are not part of it, and nor is a Done column the
   parser made up because something was ticked (raw null): one side ticking
   the first card in a bucket is a card change, not a new column. */
function listSkeleton(doc){
  return JSON.stringify({ pre: doc.pre, post: doc.post, buckets: doc.buckets.map(b => ({
    raw: b.raw, intro: b.intro, tail: b.tail,
    tiers: b.tiers.filter(t => t.raw != null || t.name !== DONE_HEADING)
                  .map(t => ({ name: t.name, raw: t.raw })) })) });
}

/* Every card by a key that names the same card in all three copies. The `id:`
   the board gives each card is the key, as long as base has it too. A card
   base had without one would get a different id in each tab that loaded it,
   so those, and new cards, fall back to their #slug or title, counted in
   order the way flattenDoc() does. */
function cardEntries(doc, baseIds){
  const seen = Object.create(null);
  const out = new Map();
  doc.buckets.forEach(b => b.tiers.forEach(tier => tier.tasks.forEach(t => {
    let key;
    if (t.stableId && (!baseIds || baseIds.has(t.stableId))) key = 'id:' + t.stableId;
    else {
      const k = t.slug ? 'slug:' + t.slug : 'title:' + titleKey(t.title);
      seen[k] = (seen[k] || 0) + 1;
      key = k + '#' + seen[k];
    }
    out.set(key, { task: t, at: b.name + '\n' + tier.name, block: serializeTask(t).join('\n') });
  })));
  return out;
}

function sameCard(a, b){
  return a === b || (!!a && !!b && a.block === b.block && a.at === b.at);
}

/* Each column's cards in order, by key: column → [key, …]. */
function columnsOf(entries){
  const out = new Map();
  entries.forEach((e, key) => {
    if (!out.has(e.at)) out.set(e.at, []);
    out.get(e.at).push(key);
  });
  return out;
}

/* Whether a side changed the order of the cards base already had in a column. */
function reorderedColumn(side, base, at){
  const was = base.get(at) || [];
  const now = (side.get(at) || []).filter(k => was.includes(k));
  return now.join('\u0001') !== was.filter(k => now.includes(k)).join('\u0001');
}

/* {text, clashes: [title, …]} or null. prefer is 'mine' or 'theirs'. */
function mergeLists(baseText, mineText, theirsText, prefer){
  let base, mine, theirs;
  try { base = parseDoc(baseText); mine = parseDoc(mineText); theirs = parseDoc(theirsText); }
  catch (err) { return null; }

  const skel = listSkeleton(base), mineSkel = listSkeleton(mine), theirsSkel = listSkeleton(theirs);
  if (mineSkel !== skel && theirsSkel !== skel && mineSkel !== theirsSkel) return null;
  // The copy whose frame the merge is written into: the one that changed it,
  // if either did.
  const frame = mineSkel !== skel ? mine : theirs;

  const baseIds = new Set();
  base.buckets.forEach(b => b.tiers.forEach(tier => tier.tasks.forEach(t => {
    if (t.stableId) baseIds.add(t.stableId);
  })));
  const B = cardEntries(base, null), M = cardEntries(mine, baseIds), T = cardEntries(theirs, baseIds);

  const won = new Map();
  const clashes = [];
  new Set([...B.keys(), ...M.keys(), ...T.keys()]).forEach(key => {
    const b = B.get(key), m = M.get(key), t = T.get(key);
    let pick;
    if (sameCard(m, t) || sameCard(b, m)) pick = t;
    else if (sameCard(b, t)) pick = m;
    else {
      pick = prefer === 'mine' ? m : t;
      clashes.push((m || t || b).task.title);
    }
    if (pick) won.set(key, pick);
  });

  const CB = columnsOf(B), CM = columnsOf(M), CT = columnsOf(T);
  const placed = new Set();
  const frameColumn = at => {
    const [bucket, name] = at.split('\n');
    const b = frame.buckets.find(x => x.name === bucket);
    if (!b) return null;
    let tier = b.tiers.find(x => x.name === name);
    if (!tier && name === DONE_HEADING) {
      tier = { name: DONE_HEADING, raw: null, lead: [''], tasks: [], tail: [''] };
      b.tiers.unshift(tier);
    }
    return tier;
  };
  // Every column a card ends up in must exist in the frame, Done aside.
  for (const e of won.values()) if (!frameColumn(e.at)) return null;

  frame.buckets.forEach(b => b.tiers.forEach(tier => {
    const at = b.name + '\n' + tier.name;
    const here = new Set([...won].filter(([, e]) => e.at === at).map(([k]) => k));
    // The order of whichever side reordered this column, theirs when neither
    // or both did. The other side's cards go in after the card they followed.
    const [first, second] = reorderedColumn(CM, CB, at) && !reorderedColumn(CT, CB, at) ? [CM, CT] : [CT, CM];
    const order = (first.get(at) || []).filter(k => here.has(k));
    (second.get(at) || []).forEach((k, i, seq) => {
      if (!here.has(k) || order.includes(k)) return;
      let j = i - 1;
      while (j >= 0 && !order.includes(seq[j])) j--;
      order.splice(j < 0 ? 0 : order.indexOf(seq[j]) + 1, 0, k);
    });
    here.forEach(k => { if (!order.includes(k)) order.push(k); });

    const wasEmpty = !tier.tasks.length;
    tier.tasks = order.map(k => won.get(k).task);
    order.forEach(k => placed.add(k));
    // An empty column keeps its blank line under the heading and anything
    // after it as its tail (parseDoc), so filling or emptying one keeps that
    // shape rather than running a card into the next heading.
    const tail = tier.tail || [];
    if (wasEmpty && tier.tasks.length && !(tail.length && tail[0].trim() === '')) tier.tail = [''].concat(tail);
    if (!wasEmpty && !tier.tasks.length) {
      tier.lead = tier.lead && tier.lead.length ? tier.lead : [''];
      tier.tail = (tier.tail || []).some(l => l.trim() !== '') ? tier.tail : [];
    }
  }));
  if (placed.size !== won.size) return null;

  return { text: serializeDoc(frame), clashes };
}

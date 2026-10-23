#!/usr/bin/env node
/* Checks mergeLists() in kanban/js/22a-merging.js: two copies of one list,
 * edited apart from the same version, merged card by card.
 *
 * No browser. The merge is a pure function over three texts, so it runs in a
 * `vm` context with core/todo.js and the two board files it leans on, the way
 * core/test_todo.mjs runs todo.js. scripts/test-board.sh --all runs it with
 * the browser suites, where it ignores the throwaway server.
 *
 *     node kanban/test_merging.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import vm from 'node:vm';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const read = rel => fs.readFileSync(path.join(HERE, '..', rel), 'utf8');
/* Classic scripts declare into the context's lexical scope, so the trailing
   expression is what hands the functions back (see core/test_todo.mjs). */
const source = [read('core/todo.js'), read('kanban/js/22-what-changed.js'), read('kanban/js/22a-merging.js')]
  .join('\n;\n') + '\n;({ mergeLists, parseDoc, serializeDoc });\n';
const { mergeLists, parseDoc, serializeDoc } = vm.runInNewContext(source, {}, { filename: 'merging' });

let failures = 0;
const ok = (label, cond, detail = '') => {
  console.log(`${cond ? '  ok  ' : ' FAIL '} ${label}${cond || !detail ? '' : ` — ${detail}`}`);
  if (!cond) failures++;
};

const BASE = `# To-do

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
`;

/* A copy of BASE with each [from, to] swapped in, every one required to hit. */
const edit = (text, ...pairs) => pairs.reduce((t, [from, to]) => {
  if (!t.includes(from)) throw new Error('fixture edit missed: ' + from);
  return t.replace(from, to);
}, text);

/* Each column's card titles, as "Bucket/Column: A, B". */
const layout = text => {
  const doc = parseDoc(text);
  return doc.buckets.flatMap(b => b.tiers.map(t =>
    `${b.name}/${t.name}: ${t.tasks.map(x => x.title).join(', ')}`));
};
const has = (text, line) => layout(text).includes(line);
const stable = text => serializeDoc(parseDoc(text)) === text;

ok('the fixture ids are read', parseDoc(BASE).buckets[0].tiers[0].tasks[0].stableId === 'aaa111');

/* ---- nothing to merge ---- */
{
  const r = mergeLists(BASE, BASE, BASE, 'mine');
  ok('three equal copies give the same text back', r && r.text === BASE && !r.clashes.length);
  const theirs = edit(BASE, ['Alpha', 'Alpha 2']);
  const r2 = mergeLists(BASE, BASE, theirs, 'mine');
  ok('only the other copy changed: its text, byte for byte', r2 && r2.text === theirs);
  const r3 = mergeLists(BASE, theirs, theirs, 'mine');
  ok('both made the same change: that text, no clash', r3 && r3.text === theirs && !r3.clashes.length);
}

/* ---- different cards ---- */
{
  const mine = edit(BASE, ['- [ ] Alpha', '- [ ] Alpha mine']);
  const theirs = edit(BASE, ['- [ ] Epsilon', '- [ ] Epsilon theirs']);
  const r = mergeLists(BASE, mine, theirs, 'mine');
  ok('edits to different cards both land', r && !r.clashes.length &&
     has(r.text, 'Work/To do: Alpha mine, Beta, Gamma') && has(r.text, 'Home/To do: Epsilon theirs'),
     r && layout(r.text).join(' | '));
  ok('and the merged text reads back unchanged', r && stable(r.text));
}

/* ---- the same card, changed differently ---- */
{
  const mine = edit(BASE, ['- [ ] Alpha', '- [ ] Alpha mine']);
  const theirs = edit(BASE, ['- [ ] Alpha', '- [ ] Alpha theirs']);
  const r = mergeLists(BASE, mine, theirs, 'mine');
  ok('a card both changed is a clash', r && r.clashes.length === 1, r && JSON.stringify(r.clashes));
  ok('prefer mine keeps mine', r && has(r.text, 'Work/To do: Alpha mine, Beta, Gamma'));
  const t = mergeLists(BASE, mine, theirs, 'theirs');
  ok('prefer theirs keeps theirs', t && has(t.text, 'Work/To do: Alpha theirs, Beta, Gamma'));
}

/* ---- a move on one side, an edit on the other ---- */
{
  const mine = edit(BASE, ['- [ ] Gamma `id:ccc333`\n', ''],
                          ['- [ ] Delta `id:ddd444`', '- [ ] Delta `id:ddd444`\n- [ ] Gamma `id:ccc333`']);
  const theirs = edit(BASE, ['- [ ] Beta', '- [ ] Beta theirs']);
  const r = mergeLists(BASE, mine, theirs, 'mine');
  ok('a card moved here and another edited there: both land', r && !r.clashes.length &&
     has(r.text, 'Work/To do: Alpha, Beta theirs') && has(r.text, 'Work/Doing: Delta, Gamma'),
     r && layout(r.text).join(' | '));
  const theirs2 = edit(BASE, ['- [ ] Gamma', '- [ ] Gamma theirs']);
  const r2 = mergeLists(BASE, mine, theirs2, 'mine');
  ok('moved here and edited there is a clash', r2 && r2.clashes.length === 1);
  ok('and prefer mine leaves it moved', r2 && has(r2.text, 'Work/Doing: Delta, Gamma'));
}

/* ---- new cards on both sides ---- */
{
  const mine = edit(BASE, ['- [ ] Gamma `id:ccc333`', '- [ ] Gamma `id:ccc333`\n- [ ] Zeta `id:zzz999`']);
  const theirs = edit(BASE, ['- [ ] Alpha `id:aaa111`', '- [ ] Eta `id:hhh888`\n- [ ] Alpha `id:aaa111`']);
  const r = mergeLists(BASE, mine, theirs, 'mine');
  ok('cards added on both sides are all kept, each where it was put', r && !r.clashes.length &&
     has(r.text, 'Work/To do: Eta, Alpha, Beta, Gamma, Zeta'), r && layout(r.text).join(' | '));
  ok('and the merged text reads back unchanged', r && stable(r.text));
  const empty = edit(BASE, ['- [ ] Delta `id:ddd444`\n', '']);
  const intoEmpty = edit(empty, ['### Doing\n\n', '### Doing\n\n- [ ] Theta `id:ttt777`\n']);
  const r2 = mergeLists(empty, intoEmpty, edit(empty, ['- [ ] Epsilon', '- [ ] Epsilon theirs']), 'mine');
  ok('a card added to an empty column', r2 && has(r2.text, 'Work/Doing: Theta') && stable(r2.text),
     r2 && r2.text);
}

/* ---- deletes ---- */
{
  const mine = edit(BASE, ['- [ ] Beta `id:bbb222`\n', '']);
  const r = mergeLists(BASE, mine, edit(BASE, ['- [ ] Epsilon', '- [ ] Epsilon theirs']), 'mine');
  ok('a card deleted here stays deleted', r && !r.clashes.length &&
     has(r.text, 'Work/To do: Alpha, Gamma') && has(r.text, 'Home/To do: Epsilon theirs'));
  const r2 = mergeLists(BASE, mine, edit(BASE, ['- [ ] Beta', '- [ ] Beta theirs']), 'theirs');
  ok('deleted here and edited there is a clash', r2 && r2.clashes.length === 1);
  ok('and prefer theirs keeps the edited card', r2 && has(r2.text, 'Work/To do: Alpha, Beta theirs, Gamma'));
  const r3 = mergeLists(BASE, mine, edit(BASE, ['- [ ] Delta `id:ddd444`\n', '']), 'mine');
  ok('a column both copies emptied of different cards', r3 && has(r3.text, 'Work/Doing: ') && stable(r3.text));
}

/* ---- ticks, which move a card to Done ---- */
{
  const mine = edit(BASE, ['- [ ] Delta', '- [x] Delta']);
  const theirs = edit(BASE, ['- [ ] Alpha', '- [ ] Alpha theirs']);
  const r = mergeLists(BASE, mine, theirs, 'mine');
  ok('a tick here and an edit there both land, the first tick making Done', r && !r.clashes.length &&
     has(r.text, 'Work/Done: Delta') && has(r.text, 'Work/To do: Alpha theirs, Beta, Gamma'),
     r && layout(r.text).join(' | '));
  ok('with one blank line between the new Done column and the next', r && !r.text.includes('\n\n\n'),
     r && JSON.stringify(r.text));
  const r2 = mergeLists(BASE, mine, edit(BASE, ['- [ ] Delta `id:ddd444`', '- [ ] Delta theirs `id:ddd444`'],
                                           ['### Doing\n\n', '### Doing\n\n- [ ] Kappa `id:kkk222`\n']), 'mine');
  ok('the other side made a Done column the frame did not have: one blank line', r2 && !r2.text.includes('\n\n\n'),
     r2 && JSON.stringify(r2.text));
}

/* ---- order ---- */
{
  const mine = edit(BASE, ['- [ ] Alpha `id:aaa111`\n- [ ] Beta `id:bbb222`\n- [ ] Gamma `id:ccc333`',
                           '- [ ] Gamma `id:ccc333`\n- [ ] Alpha `id:aaa111`\n- [ ] Beta `id:bbb222`']);
  const r = mergeLists(BASE, mine, edit(BASE, ['- [ ] Epsilon', '- [ ] Epsilon theirs']), 'mine');
  ok('a column reordered here keeps that order', r && has(r.text, 'Work/To do: Gamma, Alpha, Beta'));
}

/* ---- outside the cards ---- */
{
  const theirs = edit(BASE, ['## 2. Home\n', '## 2. Home\n\nThe house and the garden.\n']);
  const r = mergeLists(BASE, edit(BASE, ['- [ ] Alpha', '- [ ] Alpha mine']), theirs, 'mine');
  ok('a bucket intro written there and a card edited here: both land', r && !r.clashes.length &&
     r.text.includes('The house and the garden.') && has(r.text, 'Work/To do: Alpha mine, Beta, Gamma'));
  const mineToo = edit(BASE, ['## 2. Home\n', '## 2. Home\n\nJust the house.\n']);
  ok('outside the cards changed differently on both sides: no merge', mergeLists(BASE, mineToo, theirs, 'mine') === null);
  const mineCol = edit(BASE, ['### Doing\n\n- [ ] Delta `id:ddd444`\n', '']);
  const theirsIntoCol = edit(BASE, ['- [ ] Delta `id:ddd444`', '- [ ] Delta `id:ddd444`\n- [ ] Iota `id:iii666`']);
  ok('a card added to a column the other side removed: no merge', mergeLists(BASE, mineCol, theirsIntoCol, 'mine') === null);
}

console.log(failures ? `\n${failures} failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);

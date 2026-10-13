'use strict';

/* =========================================================================
   Spotlight

   Dims everything on the page except one element, for as long as it is in focus
   (hold.ts keeps a hold on after release; BoardUI.endFocus() ends it), so it can be used on any
   element, not only a card (the card hold in TaskCard.tsx is the first caller).

   It dims by opacity on the siblings of the element and of each of its
   ancestors, never on an ancestor itself. An ancestor's opacity would dim the
   spotlit element too, and an overlay behind it would be capped by whatever
   stacking context a column or a transform has made. Opacity on the other
   branches of the tree has neither problem.
   ========================================================================= */

let spotlit = [];
let spotEl = null;

/* Also shuts hover out of everything else for as long as it lasts: the body
   gets `spotlit`, which takes pointer events from every element but this one
   and its insides (board.css), and every [data-focus-keep] element, which is
   also never dimmed (a floating prompt for the focused element). The pointer events the caller listens for on
   window and document still arrive; they land on the page itself. */
function spotlight(el){
  clearSpotlight(true);
  spotEl = el;
  el.classList.add('spot-on');
  document.body.classList.add('spotlit');
  for (let node = el; node && node !== document.documentElement; node = node.parentElement) {
    const parent = node.parentElement;
    if (!parent) break;
    Array.from(parent.children).forEach(sib => {
      if (sib === node || /^(SCRIPT|STYLE|LINK|META)$/.test(sib.tagName) || sib.hasAttribute('data-focus-keep')) return;
      sib.classList.add('spot-dim');
      spotlit.push(sib);
    });
  }
}

/* Fades back over 150ms: `spot-undim` carries the slower-out transition while
   the opacity returns to whatever the element had before. Each call cleans up
   its own set on its own timer, so a second call inside the 150ms cannot leave
   the class behind. */
function clearSpotlight(now){
  const els = spotlit;
  spotlit = [];
  if (spotEl) spotEl.classList.remove('spot-on');
  spotEl = null;
  document.body.classList.remove('spotlit');
  els.forEach(e => { e.classList.remove('spot-dim'); if (!now) e.classList.add('spot-undim'); });
  if (!now) window.setTimeout(() => els.forEach(e => e.classList.remove('spot-undim')), 160);
}
